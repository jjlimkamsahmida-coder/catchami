/**
 * Gathering minigames: a small panel that opens beside the pet, with the world
 * still visible. One tap (or one hold for herbs). The client only reports the
 * tap/hold time — the server grades it against its own copy of the round.
 */
import { useEffect, useRef, useState } from "react";
import { chopMarker, fishX, mineAngle, MINIGAMES, pullLoose, type ChopRound, type FishRound, type MineRound, type MinigameRound, type PullRound } from "@catchami/shared";
import { store, useStore } from "../net/store.ts";
import { send } from "../net/api.ts";
import { genUrl } from "../game/assets.ts";
import { sfx } from "./sfx.ts";

declare global { interface Window { __petAnchor?: { x: number; y: number } } }

const TITLE = { chop: "Chop!", mine: "Strike!", fish: "Hook it!", pull: "Pull!" } as const;
const HINT = { chop: "Tap when the marker is in the gold zone", mine: "Tap when the pick reaches the glowing spot", fish: "Tap when the fish reaches the bait", pull: "Hold the herb · let go when it glows" } as const;

export function MinigameLayer() {
  const mg = useStore((s) => s.minigame);
  const result = useStore((s) => s.mgResult);
  const controlled = useStore((s) => s.controlled);
  const fallback = () => ({ x: window.innerWidth / 2, y: window.innerHeight * 0.62 });
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => window.__petAnchor ?? fallback());
  // Follow the pet on screen.
  useEffect(() => {
    let raf = 0;
    const loop = () => { const a = window.__petAnchor ?? fallback(); if (a) setPos((p) => (p && Math.abs(p.x - a.x) < 1 && Math.abs(p.y - a.y) < 1 ? p : { ...a })); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const showResult = result && performance.now() - result.at < 1200;
  if (!pos || (!mg && !showResult) || (mg && mg.round.petId !== controlled)) return showResult && pos ? <ResultPop pos={pos} r={result!} /> : null;
  const W = 260;
  const left = Math.max(8, Math.min(window.innerWidth - W - 8, pos.x - W / 2));
  const top = Math.max(70, pos.y - 230);
  return (
    <>
      {mg && <Panel key={mg.round.id} round={mg.round} receivedAt={mg.receivedAt} style={{ left, top, width: W }} />}
      {showResult && <ResultPop pos={pos} r={result!} />}
    </>
  );
}

function ResultPop({ pos, r }: { pos: { x: number; y: number }; r: NonNullable<ReturnType<typeof store.get>["mgResult"]> }) {
  const label = r.grade === "perfect" ? "Perfect!" : r.grade === "good" ? "Good" : r.resource === "fish" ? "It got away" : r.detail === "too early" ? "Too early" : r.detail === "too late" ? "Slipped!" : "Miss";
  return (
    <div key={r.roundId} className={`mg-pop ${r.grade}`} style={{ left: pos.x, top: pos.y - 90 }}>
      <b>{label}</b>
      {r.gained > 0 && <span><img src={genUrl(`icon-${r.resource}`)} alt="" />+{r.gained}</span>}
      {r.note && <small>{r.note}</small>}
    </div>
  );
}

function Panel({ round, receivedAt, style }: { round: MinigameRound; receivedAt: number; style: React.CSSProperties }) {
  const kind = round.params.kind;
  const [now, setNow] = useState(() => performance.now());
  const sent = useRef(false);
  const holdStart = useRef<number | null>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => { setNow(performance.now()); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const elapsed = now - receivedAt;
  const left = Math.max(0, MINIGAMES.timeoutMs - elapsed);

  const submit = (ms: number) => {
    if (sent.current) return;
    sent.current = true;
    send({ t: "mg_input", roundId: round.id, ms: Math.round(ms) });
    ({ chop: sfx.chop, mine: sfx.clink, fish: sfx.splash, pull: sfx.pluck })[kind]();
  };
  // Keyboard: Space/Enter taps (and holds for herbs).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.key !== "Enter") return;
      e.preventDefault();
      if (kind === "pull") { if (holdStart.current === null) holdStart.current = performance.now(); }
      else submit(performance.now() - receivedAt);
    };
    const up = (e: KeyboardEvent) => {
      if (kind !== "pull" || (e.code !== "Space" && e.key !== "Enter") || holdStart.current === null) return;
      submit(performance.now() - holdStart.current); holdStart.current = null;
    };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  });

  const tapHandlers = kind === "pull"
    ? {
        onPointerDown: (e: React.PointerEvent) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); holdStart.current = performance.now(); },
        onPointerUp: () => { if (holdStart.current !== null) { submit(performance.now() - holdStart.current); holdStart.current = null; } },
        onPointerCancel: () => { holdStart.current = null; },
      }
    : { onPointerDown: () => submit(performance.now() - receivedAt) };

  return (
    <div className={`mg-panel ${sent.current ? "sent" : ""}`} style={style}>
      <div className="mg-head">
        <b>{TITLE[kind]}</b>
        <span className="mg-timer"><i style={{ width: `${(left / MINIGAMES.timeoutMs) * 100}%` }} /></span>
        <button className="mg-x" onClick={() => { send({ t: "mg_stop", petId: round.petId }); store.set({ minigame: null }); }} aria-label="Stop gathering">×</button>
      </div>
      <div className="mg-stage" {...tapHandlers}>
        {kind === "chop" && <ChopBar p={round.params as ChopRound} ms={elapsed} />}
        {kind === "mine" && <MineRing p={round.params as MineRound} ms={elapsed} />}
        {kind === "fish" && <FishLane p={round.params as FishRound} ms={elapsed} />}
        {kind === "pull" && <HerbPull p={round.params as PullRound} holdMs={holdStart.current === null ? 0 : now - holdStart.current} />}
      </div>
      <div className="mg-hint">{HINT[kind]}</div>
    </div>
  );
}

function ChopBar({ p, ms }: { p: ChopRound; ms: number }) {
  const x = chopMarker(p, ms);
  return (
    <div className="chop">
      <div className="chop-bar">
        <span className="z good" style={{ left: `${(p.center - MINIGAMES.chop.good) * 100}%`, width: `${MINIGAMES.chop.good * 200}%` }} />
        <span className="z perfect" style={{ left: `${(p.center - MINIGAMES.chop.perfect) * 100}%`, width: `${MINIGAMES.chop.perfect * 200}%` }} />
        <span className="marker" style={{ left: `${x * 100}%` }}><img src={genUrl("icon-wood")} alt="" /></span>
      </div>
    </div>
  );
}

function MineRing({ p, ms }: { p: MineRound; ms: number }) {
  const a = mineAngle(p, ms);
  const R = 46, C = 60;
  const pt = (deg: number, r = R) => [C + r * Math.sin((deg * Math.PI) / 180), C - r * Math.cos((deg * Math.PI) / 180)] as const;
  const arc = (from: number, to: number) => { const [x1, y1] = pt(from), [x2, y2] = pt(to); return `M ${x1} ${y1} A ${R} ${R} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`; };
  const [mx, my] = pt(a, R);
  return (
    <svg className="mine" viewBox="0 0 120 120" width={120} height={120}>
      <circle cx={C} cy={C} r={R} fill="none" stroke="#e9dccb" strokeWidth={12} />
      <path d={arc(p.zoneDeg - MINIGAMES.mine.goodDeg, p.zoneDeg + MINIGAMES.mine.goodDeg)} stroke="#ffd166" strokeWidth={12} fill="none" strokeLinecap="round" />
      <path d={arc(p.zoneDeg - MINIGAMES.mine.perfectDeg, p.zoneDeg + MINIGAMES.mine.perfectDeg)} stroke="#47c9c1" strokeWidth={12} fill="none" strokeLinecap="round" />
      <circle cx={C} cy={C} r={R} fill="none" stroke="#2b1d3a" strokeWidth={2.5} />
      <image href={genUrl("node-minerals")} x={C - 24} y={C - 22} width={48} height={44} />
      <circle cx={mx} cy={my} r={9} fill="#fff6e5" stroke="#2b1d3a" strokeWidth={3} />
    </svg>
  );
}

function FishLane({ p, ms }: { p: FishRound; ms: number }) {
  const x = fishX(p, ms);
  const dir = Math.sign(fishX(p, ms + 30) - x) || 1;
  return (
    <div className="fishlane">
      <span className="z good" style={{ width: `${MINIGAMES.fish.good * 100}%` }} />
      <span className="z perfect" style={{ width: `${MINIGAMES.fish.perfect * 100}%` }} />
      <span className="bait" />
      <img className="fish" src={genUrl("icon-fish")} alt="" style={{ left: `${50 + x * 46}%`, transform: `translate(-50%, -50%) scaleX(${dir > 0 ? -1 : 1})` }} />
      <span className="ripple" style={{ left: `${50 + x * 46}%` }} />
    </div>
  );
}

function HerbPull({ p, holdMs }: { p: PullRound; holdMs: number }) {
  const l = pullLoose(p, holdMs);
  const [pl, ph] = MINIGAMES.pull.perfect;
  const ready = l >= pl && l <= ph;
  const late = l > MINIGAMES.pull.good[1];
  return (
    <div className={`herb ${ready ? "ready" : ""} ${late ? "late" : ""}`}>
      <div className="soil"><span className="crack" style={{ opacity: Math.min(1, l) }} /></div>
      <img className="plant" src={genUrl("icon-herbs")} alt="" draggable={false}
        style={{ transform: `translateX(-50%) translateY(${-Math.min(1.1, l) * 16}px) scaleY(${1 + Math.min(1.2, l) * 0.35}) rotate(${holdMs ? Math.sin(holdMs / 60) * 4 : 0}deg)` }} />
      <span className="cue">{holdMs === 0 ? "hold" : ready ? "now!" : late ? "slipping…" : "…"}</span>
    </div>
  );
}
