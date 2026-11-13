import { useEffect, useRef, useState } from "react";
import { AREA_BOUNDS, carryCapacity, ECONOMY, formatTokens, inventoryWeight, RESOURCES, type OwnPet, shopPrice } from "@catchami/shared";
import { centerOf, flyIcons, floatLabel, screenCenter } from "./fx.ts";
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
      <button className={`wallet-btn ${open ? "open" : ""}`} onClick={() => { if (store.get().onboarding?.stage !== "tutorial") setOpen((v) => !v); }} aria-label="Wallet">
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

const ONE = 10n ** 18n;
const COIN_HTML = `<img src="${genUrl("ui-coin")}" alt="" />`;
const BOLT_HTML = `<svg viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" /></svg>`;

/** Tween a number toward its new value (coins counting up / down). */
function useTween(target: number, ms = 800) {
  const [v, setV] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    const a = cur.current, b = target;
    if (a === b) return;
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      cur.current = a + (b - a) * e;
      setV(cur.current);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return v;
}

/** Coins fly between the shop and the pet's piggy bank; energy bolts fly from the badge to the gather button. */
function usePetFx(p: OwnPet | null) {
  const prev = useRef<{ id: string; bal: bigint; en: number } | null>(null);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    if (!p) return;
    const bal = BigInt(p.balance), was = prev.current;
    prev.current = { id: p.id, bal, en: p.energy };
    if (!was || was.id !== p.id) return;
    const d = bal - was.bal;
    if (d >= ONE || d <= -ONE) {
      const wallet = centerOf(".pc-coins") ?? screenCenter();
      const shop = centerOf(".sheet .btn.leaf.block") ?? centerOf(".sheet") ?? screenCenter();
      const n = Math.min(8, 3 + Math.floor(Math.log10(Number((d < 0n ? -d : d) / ONE) + 1)));
      if (d > 0n) { flyIcons({ from: shop, to: wallet, html: COIN_HTML, count: n, cls: "coin" }); setTimeout(() => floatLabel(wallet, `+${formatTokens(d)}`, "gain"), 650); }
      else { flyIcons({ from: wallet, to: centerOf(".sheet") ?? screenCenter(), html: COIN_HTML, count: n, cls: "coin" }); floatLabel(wallet, `−${formatTokens(-d)}`, "spend"); }
      setFlash(d > 0n ? "up" : "down");
      const t = setTimeout(() => setFlash(null), 900);
      void t;
    }
    const spent = was.en - p.energy;
    const gathering = !!store.get().mgSession || p.activity.startsWith("Gathering");
    if (spent >= 3 && gathering) {
      const from = centerOf(".pc-stat.en") ?? screenCenter();
      const to = centerOf(".mg-tap") ?? centerOf(".actions .big-action") ?? screenCenter();
      flyIcons({ from, to, html: BOLT_HTML, count: Math.min(6, 2 + Math.floor(spent / 20)), cls: "bolt", spread: 18 });
      floatLabel({ x: from.x + 40, y: from.y }, `−${Math.round(spent)} ⚡`, "energy");
    }
  }, [p?.id, p?.balance, p?.energy]);
  return flash;
}

export function PetCard() {
  const p = useStore(controlledPet);
  const flash = usePetFx(p);
  const coins = useTween(p ? Number(BigInt(p.balance) / ONE) : 0);
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
    <button className="petcard2" onClick={() => { if (store.get().onboarding?.stage !== "tutorial") store.set({ screen: "pets", petScreen: p.id }); }} aria-label={`${p.name} — open pet`}>
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
      <span className={`pc-coins ${flash ?? ""}`}><img src={genUrl("ui-coin")} alt="" />{fmt(BigInt(Math.max(0, Math.round(coins))) * ONE)}</span>
    </button>
  );
}

function statusText(p: OwnPet) {
  if (p.status === "knocked_out") return "0 HP";
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
      const why = p.status === "knocked_out" ? `${p.name} has 0 HP and walks slowly — buy medicine to recover` : p.energy < ECONOMY.stats.exhaustedEnergy ? `${p.name} is exhausted and moves slowly — rest or eat` : null;
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
/** Big, obvious warning when the pet's bag is full. */
export function BagFullBanner() {
  const p = useStore(controlledPet);
  const tut = useStore((s) => s.onboarding?.stage === "tutorial");
  if (p?.status === "knocked_out") return (
    <div className="bagfull ko" role="status">
      <span className="bagfull-ico">💔</span>
      <span><b>0 HP!</b><small>Buy medicine at a merchant</small></span>
    </div>
  );
  if (!p || inventoryWeight(p.carried) < carryCapacity(p.stats) * 0.98) return null;
  return (
    <div className="bagfull" role="status">
      <span className="bagfull-ico">🎒</span>
      <span><b>Bag full!</b><small>{tut ? "Sell your loot to Merchant Mari" : "Sell your loot to a merchant to gather more"}</small></span>
    </div>
  );
}

export function ActionBar() {
  const p = useStore(controlledPet);
  const merchants = useStore((s) => s.merchants);
  const nodesDef = useStore((s) => s.nodesDef);
  const nodes = useStore((s) => s.nodes);
  const ticker = useStore((s) => s.ticker);
  const own = useStore((s) => s.own);
  const tut = useStore((s) => s.onboarding?.stage === "tutorial");
  const [, force] = useState(0);
  useEffect(() => { const id = setInterval(() => force((n) => n + 1), 500); return () => clearInterval(id); }, []);

  if (!p) return <>{!own.length && <FirstPetGuide />}</>;

  const e = entities.get(p.id);
  const pos = e?.samples.at(-1);
  const px = pos?.[1] ?? p.x, py = pos?.[2] ?? p.y;
  const m = merchants.find((mm) => mm.state !== "at_hq" && mm.state !== "unavailable" && Math.hypot(mm.x - px, mm.y - py) <= ECONOMY.merchants.interactRangePx);
  const node = nodesDef.map((n) => ({ n, d: Math.hypot(n.tx * 32 + 16 - px, n.ty * 32 + 16 - py) })).filter((x) => x.d < 120).sort((a, b) => a.d - b.d)[0]?.n;
  const ko = p.status === "knocked_out";
  const koReady = ko;
  const btns: React.ReactNode[] = [];
  const touch = window.matchMedia("(pointer: coarse)").matches;
  const full = inventoryWeight(p.carried) >= carryCapacity(p.stats) * 0.98;
  void full; void node; void nodes;
  if (touch && m && !store.get().sheet) btns.push(<button key="shop" className="btn big-action" onClick={() => store.set({ sheet: { kind: "merchant", id: m.id } })}>Open shop</button>);
  // (Gather lives on the map, right under each spot.)
  // The tutorial teaches one thing per stage: only selling and gathering show up there.
  if (tut) {
    // Tutorial 6: walk up to Coach Kiki, then press Battle.
    const k = store.get().bandits.find((b) => b[0] === "bandit-practice");
    if (k && !ko && Math.hypot(k[1] - px, k[2] - py) <= 130 && k[3] !== 2 && !store.get().bubble)
      btns.unshift(<button key="battle" className="btn big-action battle" onClick={() => send({ t: "fight_bandit", petId: p.id, banditId: "bandit-practice" })}>⚔️ Battle Coach Kiki</button>);
    return btns.length ? <div className="actions">{btns}</div> : null;
  }
  const foe = !ko ? nearbyFoe(px, py) : null;
  if (foe) {
    const gathering = !!store.get().mgSession || p.activity.startsWith("Gathering");
    btns.unshift(<button key="battle" className="btn big-action battle" disabled={gathering} title={gathering ? "Stop gathering to battle" : ""}
      onClick={() => send(foe.kind === "pet" ? { t: "br_challenge", petId: p.id, targetId: foe.id } : { t: "fight_bandit", petId: p.id, banditId: foe.id })}>
      {gathering ? "Busy gathering" : `⚔️ Battle ${foe.name}`}
    </button>);
  }
  // (Meals and medicine are bought at a merchant's shop, not from this bar.)
  void ticker; void koReady;
  return btns.length ? <div className="actions">{btns.slice(0, 3)}</div> : null;
}

/** The nearest other Keeper's pet or demo rival in battle range, out in the wild. */
function nearbyFoe(px: number, py: number): { kind: "pet" | "rival"; id: string; name: string } | null {
  const tx = px / 32, ty = py / 32;
  const wild = (["forest", "mines"] as const).some((a) => { const [x0, y0, x1, y1] = AREA_BOUNDS[a]; return tx >= x0 && tx <= x1 && ty >= y0 && ty <= y1; });
  if (!wild) return null;
  const s = store.get(), range: number = ECONOMY.battle.challengeRangePx;
  let best: { kind: "pet" | "rival"; id: string; name: string } | null = null, bd: number = range;
  for (const e of entities.values()) {
    if (!e.meta || e.meta.ownerId === s.userId || e.meta.status !== "active") continue;
    const q = e.samples.at(-1);
    if (!q) continue;
    const d = Math.hypot(q[1] - px, q[2] - py);
    if (d <= bd) { bd = d; best = { kind: "pet", id: e.id, name: e.meta.name }; }
  }
  for (const [id, bx, by, st, , name] of s.bandits) {
    if (id === "bandit-practice" || st === 2) continue;
    const d = Math.hypot(bx - px, by - py);
    if (d <= bd) { bd = d; best = { kind: "rival", id, name }; }
  }
  return best;
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
      {btn("bag", "Profile", "ui-backpack", screen === "pets" && !!petScreen, () => go({ screen: "pets", petScreen: store.get().controlled }))}
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

export { BanditFightPopup } from "./BanditBattle.tsx";
