import { useEffect, useRef, useState } from "react";
import { ECONOMY, inventoryWeight, RESOURCES, type OwnPet } from "@catchami/shared";
import { controlledPet, entities, store, useStore } from "../net/store.ts";
import { api, refreshWallet, send, rid } from "../net/api.ts";
import { toast } from "../net/store.ts";
import { fmt, Icon, PetArt, ResIcon } from "./common.tsx";
import { MiniMap } from "./WorldHud.tsx";
import { genUrl } from "../game/assets.ts";

export function TopBar() {
  const wallet = useStore((s) => s.wallet);
  const connected = useStore((s) => s.connected);
  const network = useStore((s) => s.network);
  const ticker = useStore((s) => s.ticker);
  return (
    <div className="topbar">
      <button className="chip wallet-chip" onClick={() => store.set({ screen: "wallet" })} aria-label="Wallet">
        <img src={genUrl("ui-coin")} alt="" width={28} height={28} />
        <span className="num">{fmt(wallet?.available)}</span>
        {network === "dev" && <span className="tag dev" title="Dev network: test units with no value">TEST</span>}
        <span className={`conn ${connected ? "on" : ""}`} title={connected ? "Connected" : "Reconnecting…"} />
      </button>
      <div className="grow" />
      <div className="col" style={{ alignItems: "flex-end", gap: 8 }}>
      <MiniMap />
      {ticker && (
        <div className="panel market-widget" title="Global market demand from real recorded activity">
          {RESOURCES.map((r) => (
            <div className="m" key={r}>
              <ResIcon r={r} size={22} />
              <span className={`lvl ${ticker.demand[r].level}`}>{ticker.demand[r].level === "medium" ? "med" : ticker.demand[r].level}</span>
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

export function PetCard() {
  const p = useStore(controlledPet);
  if (!p) return null;
  const hp = p.hp / p.stats.maxHp, en = p.energy / p.stats.maxEnergy, fed = 1 - p.hunger / ECONOMY.stats.hungerMax;
  const w = inventoryWeight(p.carried);
  return (
    <button className="panel petcard" onClick={() => store.set({ screen: "pets", petScreen: p.id })} style={{ textAlign: "left", cursor: "pointer" }}>
      <div className="thumb"><PetArt sticker={p.sticker} species={p.species} look={p.look} /></div>
      <div className="grow col" style={{ gap: 4 }}>
        <div className="row" style={{ gap: 6 }}>
          <b style={{ fontSize: 16 }}>{p.name}</b>
          <span className="small muted">{statusText(p)}</span>
          <span className="right num" style={{ fontWeight: 700, fontSize: 14 }}>{fmt(p.balance)}</span>
        </div>
        <div className="bars">
          <span>HP</span><div className="bar hp"><i style={{ width: `${hp * 100}%` }} /></div>
          <span>EN</span><div className="bar en"><i style={{ width: `${en * 100}%` }} /></div>
          <span>FD</span><div className="bar hu"><i style={{ width: `${fed * 100}%` }} /></div>
        </div>
        <div className="inv">
          {RESOURCES.map((r) => <span key={r}><ResIcon r={r} size={16} />{p.carried[r]}</span>)}
          <span className="right muted">{w}/{p.stats.carry}</span>
        </div>
      </div>
    </button>
  );
}

function statusText(p: OwnPet) {
  if (p.status === "knocked_out") return "knocked out";
  if (p.status === "inactive") return "inactive";
  if (p.autopilotResumesAt) return "manual";
  return p.strategy.auto ? "autopilot" : p.status;
}

export function Joystick() {
  const ref = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const active = useRef<number | null>(null);
  const vec = useRef({ dx: 0, dy: 0 });
  useEffect(() => {
    const id = setInterval(() => {
      if (active.current !== null) window.dispatchEvent(new CustomEvent("catchami:joystick", { detail: vec.current }));
    }, 100);
    return () => clearInterval(id);
  }, []);
  const update = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const R = r.width / 2;
    let x = e.clientX - (r.left + R), y = e.clientY - (r.top + R);
    const d = Math.hypot(x, y), max = R - 20;
    if (d > max) { x = (x / d) * max; y = (y / d) * max; }
    setKnob({ x, y });
    vec.current = { dx: x / max, dy: y / max };
    window.dispatchEvent(new CustomEvent("catchami:joystick", { detail: vec.current }));
  };
  const end = () => {
    active.current = null;
    setKnob({ x: 0, y: 0 });
    vec.current = { dx: 0, dy: 0 };
    window.dispatchEvent(new CustomEvent("catchami:joystick", { detail: { dx: 0, dy: 0 } }));
  };
  return (
    <div className="joystick" ref={ref}
      onPointerDown={(e) => { active.current = e.pointerId; (e.target as HTMLElement).setPointerCapture(e.pointerId); update(e); }}
      onPointerMove={(e) => { if (active.current === e.pointerId) update(e); }}
      onPointerUp={end} onPointerCancel={end} aria-label="Move">
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

  const catchBtn = (
    <button className="btn catch-btn" onClick={() => store.set({ screen: "catch" })} aria-label="Catch an animal" title="Catch a real animal">
      <svg viewBox="0 0 48 48"><circle cx="24" cy="25" r="17" fill="#ffd166" stroke="#2b1d3a" strokeWidth="3.5" /><path d="M7 25h34" stroke="#2b1d3a" strokeWidth="3.5" /><circle cx="24" cy="25" r="5.5" fill="#fff6e5" stroke="#2b1d3a" strokeWidth="3.5" /><path d="M24 8c4-5 9-5 12-2-3 4-8 4-12 2Z" fill="#6cc04a" stroke="#2b1d3a" strokeWidth="2.5" /></svg>
    </button>
  );
  if (!p) return <><div className="actions">{catchBtn}</div>{!own.length && <FirstPetGuide />}</>;

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
  return <div className="actions">{btns.slice(0, 3)}{catchBtn}</div>;
}

/** Shown until the player owns a pet: movement and play need one. */
function FirstPetGuide() {
  const wallet = useStore((s) => s.wallet);
  const network = useStore((s) => s.network);
  const [busy, setBusy] = useState(false);
  const hasTokens = wallet ? BigInt(wallet.available) >= ECONOMY.catch.tiers.basic.cost : false;
  const getTokens = async () => {
    setBusy(true);
    try { await api("/api/dev/faucet", {}); await refreshWallet(); toast("good", "Added 20M test units (no real value)"); }
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
  const item = (id: typeof screen, label: string, icon: Parameters<typeof Icon>[0]["name"]) => (
    <button className={`navbtn ${screen === id ? "on" : ""}`} onClick={() => store.set({ screen: id, petScreen: null, sheet: null })}><Icon name={icon} />{label}</button>
  );
  return (
    <nav className="bottomnav">
      <div className="panel bar-inner">
        {item("world", "World", "map")}
        {item("pets", "Pets", "paw")}
        {item("market", "Market", "shop")}
        {item("ranks", "Ranks", "trophy")}
        {item("wallet", "Wallet", "wallet")}
      </div>
    </nav>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return <div className="toasts">{toasts.map((t) => <div key={t.id} className={`toast panel ${t.kind}`}>{t.text}</div>)}</div>;
}
