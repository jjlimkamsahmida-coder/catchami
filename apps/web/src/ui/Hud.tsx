import { useEffect, useRef, useState } from "react";
import { carryCapacity, ECONOMY, inventoryWeight, RESOURCES, type OwnPet } from "@catchami/shared";
import { controlledPet, entities, store, useStore } from "../net/store.ts";
import { api, forgetDevice, refreshWallet, send, rid } from "../net/api.ts";
import { toast } from "../net/store.ts";
import { fmt, fmtQty, Icon, PetArt, ResIcon } from "./common.tsx";
import { genUrl } from "../game/assets.ts";
import { sfx } from "./sfx.ts";

export function TopBar() {
  const ticker = useStore((s) => s.ticker);
  return (
    <>
      {ticker && (
        <div className="market-top" title="Market demand right now — high demand means merchants pay more">
          <span className="mt-label">Demand</span>
          {RESOURCES.map((r) => {
            const lvl = ticker.demand[r].level;
            return (
              <span className={`mt-item ${lvl}`} key={r}>
                <ResIcon r={r} size={22} />
                <i>{lvl === "high" ? "▲" : lvl === "low" ? "▼" : "•"}</i>
              </span>
            );
          })}
        </div>
      )}
      <WalletButton />
    </>
  );
}

/** Top-right wallet: balance + address, with a dropdown (open wallet / disconnect). */
function WalletButton() {
  const wallet = useStore((s) => s.wallet);
  const connected = useStore((s) => s.connected);
  const near = useStore((s) => s.nearAccount);
  const userId = useStore((s) => s.userId);
  const name = useStore((s) => s.displayName);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  const address = near ?? `guest·${(userId ?? "").slice(2, 8)}`;
  const short = address.length > 16 ? `${address.slice(0, 7)}…${address.slice(-6)}` : address;
  return (
    <div className="wallet-top" ref={ref}>
      <button className={`wallet-btn ${open ? "open" : ""}`} onClick={() => setOpen((v) => !v)} aria-label="Wallet">
        <img src={genUrl("ui-coin")} alt="" />
        <span className="wb-text">
          <b className="num">{fmt(wallet?.available)}</b>
          <small><span className={`conn ${connected ? "on" : ""}`} />{short}</small>
        </span>
        <span className="wb-caret">▾</span>
      </button>
      {open && (
        <div className="wallet-menu panel">
          <div className="wm-head">
            <span className={`wm-avatar ${near ? "near" : ""}`}>{near ? "N" : "G"}</span>
            <div className="col" style={{ gap: 0, minWidth: 0 }}>
              <b className="wm-addr">{near ?? name}</b>
              <small className="muted">{near ? "NEAR testnet wallet" : "Guest on this device"}</small>
            </div>
          </div>
          <div className="wm-bal"><img src={genUrl("ui-coin")} alt="" /><b className="num">{fmt(wallet?.available)}</b><small>$CATCHAMI</small></div>
          <button className="btn block" onClick={() => { setOpen(false); store.set({ screen: "wallet", sheet: null }); }}>Open wallet</button>
          <button className="btn paper block" onClick={() => { forgetDevice(); location.assign("/"); }}>{near ? "Disconnect wallet" : "Sign out"}</button>
        </div>
      )}
    </div>
  );
}

export function PetCard() {
  const p = useStore(controlledPet);
  if (!p) return null;
  const hp = p.hp / p.stats.maxHp, en = p.energy / p.stats.maxEnergy, fed = 1 - p.hunger / ECONOMY.stats.hungerMax;
  const w = inventoryWeight(p.carried), cap = carryCapacity(p.stats);
  const stat = (k: string, v: number, icon: React.ReactNode) => (
    <div className={`pc-stat ${k} ${v < 0.25 ? "low" : ""}`}>
      <span className="pc-ico">{icon}</span>
      <span className="pc-bar"><i style={{ width: `${Math.max(4, v * 100)}%` }} /></span>
    </div>
  );
  return (
    <button className="petcard2" onClick={() => store.set({ screen: "pets", petScreen: p.id })} aria-label={`${p.name} — open pet`}>
      <span className={`pc-avatar r-${p.rarity}`}>
        <PetArt sticker={p.sticker} species={p.species} look={p.look} />
        <span className="pc-rarity">{p.rarity.slice(0, 1).toUpperCase()}</span>
      </span>
      <span className="pc-body">
        <span className="pc-name"><b>{p.name}</b><span className={`pc-status ${p.status}`}>{statusText(p)}</span></span>
        {stat("hp", hp, <svg viewBox="0 0 24 24"><path d="M12 21s-8-5.3-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.7-8 11-8 11Z" /></svg>)}
        {stat("en", en, <svg viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" /></svg>)}
        {stat("fd", fed, <svg viewBox="0 0 24 24"><path d="M15.5 3a5.5 5.5 0 0 0-5.3 7l-6.4 6.4a2 2 0 1 0 2.8 2.8L13 12.8a5.5 5.5 0 1 0 2.5-9.8Z" /></svg>)}
        <span className="pc-bag">
          {RESOURCES.map((r) => <span key={r} className={p.carried[r] ? "" : "zero"}><ResIcon r={r} size={15} />{fmtQty(p.carried[r])}</span>)}
          <span className="pc-fill" title={`Bag ${fmtQty(w)}/${fmtQty(cap)}`}><i style={{ width: `${Math.min(100, (w / cap) * 100)}%` }} /></span>
        </span>
      </span>
      <span className="pc-coins"><img src={genUrl("ui-coin")} alt="" />{fmt(p.balance)}</span>
    </button>
  );
}

function statusText(p: OwnPet) {
  if (p.status === "knocked_out") return "knocked out";
  if (p.status === "inactive") return "inactive";
  if (p.autopilotResumesAt) return "manual";
  return p.strategy.auto ? "autopilot" : p.status;
}

/**
 * Virtual joystick. After touching the pad, the finger is tracked on the whole
 * window (pointer + touch events), so the stick keeps working when the finger
 * slides off the pad. It also tells you when your pet can't walk.
 */
export function Joystick() {
  const ref = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [held, setHeld] = useState(false);
  const active = useRef<number | null>(null);
  const vec = useRef({ dx: 0, dy: 0 });
  const warned = useRef(0);
  const emit = (v: { dx: number; dy: number }) => window.dispatchEvent(new CustomEvent("catchami:joystick", { detail: v }));
  useEffect(() => {
    const id = setInterval(() => { if (active.current !== null) emit(vec.current); }, 90);
    return () => clearInterval(id);
  }, []);
  const update = (cx: number, cy: number) => {
    const r = ref.current!.getBoundingClientRect();
    const R = r.width / 2;
    let x = cx - (r.left + R), y = cy - (r.top + R);
    const d = Math.hypot(x, y), max = R - 18;
    if (d > max) { x = (x / d) * max; y = (y / d) * max; }
    setKnob({ x, y });
    vec.current = { dx: x / max, dy: y / max };
    emit(vec.current);
  };
  const end = () => {
    active.current = null;
    setHeld(false);
    setKnob({ x: 0, y: 0 });
    vec.current = { dx: 0, dy: 0 };
    emit({ dx: 0, dy: 0 });
  };
  const start = (id: number, cx: number, cy: number) => {
    active.current = id;
    setHeld(true);
    update(cx, cy);
    const p = controlledPet(store.get());
    if (p && Date.now() - warned.current > 4000) {
      const why = p.status === "knocked_out" ? `${p.name} is knocked out — use medicine to get moving again` : p.energy < ECONOMY.stats.exhaustedEnergy ? `${p.name} is exhausted and moves slowly — rest or eat` : null;
      if (why) { warned.current = Date.now(); toast("info", why); }
    }
  };
  // Track the finger anywhere on screen from the very first touch (listeners attach synchronously).
  const detach = useRef<(() => void) | null>(null);
  const track = () => {
    detach.current?.();
    const move = (e: PointerEvent) => { if (e.pointerId === active.current) update(e.clientX, e.clientY); };
    const up = (e: PointerEvent) => { if (e.pointerId === active.current) stop(); };
    const tmove = (e: TouchEvent) => { const t = e.touches[0]; if (t && active.current === -1) { e.preventDefault(); update(t.clientX, t.clientY); } };
    const tend = () => { if (active.current === -1) stop(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('touchmove', tmove, { passive: false });
    window.addEventListener('touchend', tend);
    window.addEventListener('touchcancel', tend);
    detach.current = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      window.removeEventListener('touchmove', tmove); window.removeEventListener('touchend', tend); window.removeEventListener('touchcancel', tend);
      detach.current = null;
    };
  };
  const stop = () => { detach.current?.(); end(); };
  useEffect(() => () => detach.current?.(), []);
  return (
    <div className={`joystick ${held ? "held" : ""}`} ref={ref} aria-label="Move"
      onPointerDown={(e) => { e.preventDefault(); start(e.pointerId, e.clientX, e.clientY); track(); }}
      onTouchStart={(e) => { if (active.current === null) { const t = e.touches[0]; if (t) { start(-1, t.clientX, t.clientY); track(); } } }}>
      <div className="base" />
      <div className="knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}

/** Context-sensitive actions for the controlled pet. Each one maps to a real server action. */
export function ActionBar() {
  const p = useStore(controlledPet);
  const merchants = useStore((s) => s.merchants);
  const nodesDef = useStore((s) => s.nodesDef);
  const nodes = useStore((s) => s.nodes);
  const ticker = useStore((s) => s.ticker);
  const own = useStore((s) => s.own);
  const [, force] = useState(0);
  useEffect(() => { const id = setInterval(() => force((n) => n + 1), 500); return () => clearInterval(id); }, []);

  if (!p) return <>{!own.length && <FirstPetGuide />}</>;

  const e = entities.get(p.id);
  const pos = e?.samples.at(-1);
  const px = pos?.[1] ?? p.x, py = pos?.[2] ?? p.y;
  const m = merchants.find((mm) => mm.state !== "at_hq" && mm.state !== "unavailable" && Math.hypot(mm.x - px, mm.y - py) <= ECONOMY.merchants.interactRangePx);
  const node = nodesDef.map((n) => ({ n, d: Math.hypot(n.tx * 32 + 16 - px, n.ty * 32 + 16 - py) })).filter((x) => x.d < 70).sort((a, b) => a.d - b.d)[0]?.n;
  const ko = p.status === "knocked_out";
  const koReady = ko && p.koUntil !== null && Date.now() >= p.koUntil;
  const btns: React.ReactNode[] = [];
  if (m && inventoryWeight(p.carried) > 0) btns.push(<button key="sell" className="btn leaf" onClick={() => store.set({ sheet: { kind: "merchant", id: m.id } })}>Sell to {m.name.split(" ")[0]}</button>);
  if (node && !ko) btns.push(<button key="gather" className="btn" disabled={(nodes[node.id] ?? 1) <= 0} onClick={() => send({ t: "gather", petId: p.id, nodeId: node.id })}><ResIcon r={node.resource} /> Gather</button>);
  if (p.hunger > 300 && !ko) {
    if (p.carried.fish > 0) btns.push(<button key="eat" className="btn paper" onClick={() => send({ t: "eat_own", petId: p.id })}><ResIcon r="fish" /> Eat fish</button>);
    btns.push(<button key="food" className="btn paper" disabled={(ticker?.hqStock.fish ?? 0) < 1} title={(ticker?.hqStock.fish ?? 0) < 1 ? "HQ kitchen is out of fish" : ""} onClick={() => send({ t: "buy", petId: p.id, item: "food", rid: rid() })}>Buy meal · {fmt(ECONOMY.food.price)}</button>);
  }
  if ((ko && koReady) || (!ko && p.hp < p.stats.maxHp * 0.6)) btns.push(<button key="med" className="btn coral" disabled={(ticker?.hqStock.herbs ?? 0) < ECONOMY.medicine.herbsPerDose} onClick={() => send({ t: "buy", petId: p.id, item: "medicine", rid: rid() })}>Medicine · {fmt(ECONOMY.medicine.price)}</button>);
  if (ko && !koReady && p.koUntil) btns.push(<div key="ko" className="panel small" style={{ padding: "6px 10px" }}>Recovering · {Math.ceil((p.koUntil - Date.now()) / 60000)} min</div>);
  if (!ko && p.energy < p.stats.maxEnergy * 0.5 && p.status !== "sleeping") btns.push(<button key="rest" className="btn paper" onClick={() => send({ t: "rest", petId: p.id })}>Nap</button>);
  return btns.length ? <div className="actions">{btns.slice(0, 3)}</div> : null;
}

/** Shown until the player owns a pet: movement and play need one. */
function FirstPetGuide() {
  const wallet = useStore((s) => s.wallet);
  const network = useStore((s) => s.network);
  const [busy, setBusy] = useState(false);
  const hasTokens = wallet ? BigInt(wallet.available) >= ECONOMY.catch.tiers.basic.cost : false;
  const getTokens = async () => {
    setBusy(true);
    try { await api("/api/dev/faucet", {}); await refreshWallet(); toast("good", "Added 20M test coins"); }
    catch (e) { toast("bad", (e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="panel firstpet">
      <img src={genUrl("cube-excited")} alt="" />
      <div className="col" style={{ gap: 8 }}>
        <h3>Get your first pet</h3>
        <p className="small" style={{ margin: 0 }}>You don't have a pet yet, so there's nothing to move. Catch a real cat or dog and it becomes your sticker pet in this world. Until then, WASD/arrows look around.</p>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {network === "dev" && <button className="btn sm" disabled={busy || hasTokens} onClick={getTokens}>{hasTokens ? "✓ Test tokens ready" : "1. Get free test tokens"}</button>}
          <button className="btn coral sm" onClick={() => store.set({ screen: "catch" })}>{network === "dev" ? "2. " : ""}Catch an animal</button>
        </div>
        {network === "dev" && <p className="small muted" style={{ margin: 0 }}>No camera? The catch screen has "Use a photo instead".</p>}
      </div>
    </div>
  );
}

export function BottomNav() {
  const screen = useStore((s) => s.screen);
  const petScreen = useStore((s) => s.petScreen);
  const go = (patch: Parameters<typeof store.set>[0]) => store.set({ sheet: null, ...(patch as object) });
  const btn = (key: string, label: string, icon: string, on: boolean, onClick: () => void, extra = "") => (
    <button key={key} className={`gbtn ${extra} ${on ? "on" : ""}`} onClick={onClick} aria-label={label}>
      <span className="gbtn-face"><img src={genUrl(icon)} alt="" draggable={false} /></span>
      <span className="gbtn-label">{label}</span>
    </button>
  );
  return (
    <nav className="gamebar" aria-label="Game menu">
      {btn("map", "Map", "ui-map", screen === "map", () => go({ screen: screen === "map" ? "world" : "map" }))}
      {btn("bag", "Bag", "ui-backpack", screen === "pets" && !!petScreen, () => go({ screen: "pets", petScreen: store.get().controlled }))}
      {btn("pets", "Collection", "ui-heart", screen === "pets" && !petScreen, () => go({ screen: "pets", petScreen: null }))}
      {btn("market", "Market", "prop-stall-0", screen === "market", () => go({ screen: "market", petScreen: null }))}
      {btn("ranks", "Ranks", "ui-trophy", screen === "ranks", () => go({ screen: "ranks", petScreen: null }))}
      {btn("catch", "Catch", "cube-excited", false, () => go({ screen: "catch" }), "gbtn-catch")}
    </nav>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return <div className="toasts">{toasts.map((t) => <div key={t.id} className={`toast panel ${t.kind}`}>{t.text}</div>)}</div>;
}

/** Quick "bandit battle" popup: both fighters clash, then the result. */
export function BanditFightPopup() {
  const f = useStore((s) => s.banditFight);
  const pet = useStore(controlledPet);
  const [phase, setPhase] = useState<"clash" | "result" | null>(null);
  useEffect(() => {
    if (!f) return;
    setPhase("clash"); sfx.whoosh();
    const t1 = setTimeout(() => { setPhase("result"); if (f.won) sfx.win(); else sfx.bad(); }, 1200);
    const t2 = setTimeout(() => setPhase(null), 3600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [f?.at]);
  if (!f || !phase) return null;
  return (
    <div className={`bfight ${phase} ${f.won ? "won" : "lost"}`} onClick={() => setPhase(null)}>
      <div className="bfight-title">{f.brave ? "⚔️ You challenged a bandit!" : "⚠️ Bandit ambush!"}</div>
      <div className="bfight-stage">
        <div className="bf-side pet">{pet ? <PetArt sticker={pet.sticker} species={pet.species} look={pet.look} /> : null}<b>{f.petName}</b></div>
        <span className="bf-vs">VS</span>
        <div className="bf-side bandit"><span className="bf-bandit">🦝</span><b>{f.banditName}</b></div>
        {phase === "clash" && <span className="bf-boom">💥</span>}
      </div>
      {phase === "result" && <div className="bfight-result">{f.won ? `${f.petName} wins! The bandit ran off.` : f.stolen ? `${f.banditName} stole ${f.stolen}!` : f.banditName === "Training Bandit" ? "It dodged! Tap it and try again." : `${f.banditName} won — but your bag was empty!`}</div>}
    </div>
  );
}
