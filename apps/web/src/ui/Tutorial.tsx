/**
 * First-time in-game tutorial. The Keeper walks the player through moving,
 * leaving the village, what resources look like, gathering (with the
 * minigame), merchants and battles. Steps with an objective advance by
 * themselves; an arrow next to the pet points to where to go.
 */
import { useEffect, useRef, useState } from "react";
import { AREA_BOUNDS } from "@catchami/shared";
import { store, useStore, entities } from "../net/store.ts";
import { setOnboarding } from "../net/api.ts";
import { genUrl } from "../game/assets.ts";
import { Keeper } from "./Journey.tsx";
import { sfx } from "./sfx.ts";

const TILE = 32;
type Target = { x: number; y: number; label: string } | null;
interface Step {
  title: string;
  text: (pet: string) => string;
  /** Objective shown with a checkbox; the step advances when it's met. */
  goal?: string;
  target?: () => Target;
  extra?: () => React.ReactNode;
}

const poi = (id: string): Target => {
  const p = store.get().pois.find((q) => q.id === id);
  return p ? { x: p.tx * TILE + 16, y: p.ty * TILE + 16, label: p.label } : null;
};
const petPos = (): { x: number; y: number } | null => {
  const id = store.get().controlled;
  const e = id ? entities.get(id) : null;
  const s = e?.samples[e.samples.length - 1];
  return s ? { x: s[1], y: s[2] } : null;
};
const nearestNode = (): Target => {
  const p = petPos();
  const s = store.get();
  if (!p) return null;
  let best: Target = null, bd = Infinity;
  for (const n of s.nodesDef) {
    if ((s.nodes[n.id] ?? 1) <= 0) continue;
    const x = n.tx * TILE + 16, y = n.ty * TILE + 16, d = (x - p.x) ** 2 + (y - p.y) ** 2;
    if (d < bd) { bd = d; best = { x, y, label: RES_NAME[n.resource] ?? n.resource }; }
  }
  return best;
};
const RES_NAME: Record<string, string> = { wood: "Wood", fish: "Fish", herbs: "Herbs", minerals: "Stone" };

const STEPS: Step[] = [
  { title: "Welcome home!", text: (n) => `This is Paw Village, ${n}'s new home. It's a safe zone — no battles here. Try walking around!`, goal: "Move with the joystick, WASD, or tap where to walk" },
  { title: "Off to the forest", text: () => "Resources only grow outside the village. Follow the arrow through the West Gate into the Whispering Forest.", goal: "Reach the Whispering Forest", target: () => poi("forest_gate") ?? poi("village_west") },
  {
    title: "Spot the resources", text: () => "Out here, glowing spots are things your pet can gather. Here's what to look for:",
    extra: () => (
      <div className="tut-res">
        {[["node-wood", "Wood", "Forest trees"], ["node-fish", "Fish", "Lake & stream"], ["node-herbs", "Herbs", "Forest meadows"], ["node-minerals", "Stone", "Mining Valley"]].map(([k, n, w]) => (
          <div key={k}><img src={genUrl(k!)} alt="" onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} /><b>{n}</b><small>{w}</small></div>
        ))}
      </div>
    ),
  },
  { title: "Gather!", text: () => "Walk up to a spot and tap Gather. A little minigame pops up — perfect timing means double loot!", goal: "Gather a resource", target: nearestNode },
  { title: "Sell & snack", text: (n) => `Nice haul! Travelling merchants wander the roads buying resources. Tap one to sell, then buy meals to keep ${n} fed and full of energy.` },
  { title: "Battles", text: () => "In the Forest and Mining Valley, tap another player's pet to challenge it to Bubble Roulette — splash, dodge, last pet standing wins. No coins at stake." },
  { title: "You're a Keeper now!", text: (n) => `That's everything! Explore, catch more friends, and turn on autopilot in the backpack so ${n} keeps busy while you're away. Have fun!` },
];

export function TutorialCoach() {
  const onboarding = useStore((s) => s.onboarding);
  const own = useStore((s) => s.own);
  const controlled = useStore((s) => s.controlled);
  const step = onboarding?.stage === "tutorial" ? Math.min(STEPS.length - 1, onboarding.tutorial ?? 0) : -1;
  const [met, setMet] = useState(false);
  const [min, setMin] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const arrow = useRef<HTMLDivElement>(null);
  const pet = own.find((p) => p.id === controlled)?.name ?? "your pet";

  const advance = (to = step + 1) => {
    setMet(false); setMin(false); start.current = null;
    if (to >= STEPS.length) void setOnboarding("done");
    else void setOnboarding("tutorial", to);
  };

  // Objectives.
  useEffect(() => {
    if (step < 0) return;
    const done = () => { if (!met) { setMet(true); sfx.perfect(); setTimeout(() => advance(), 1100); } };
    const onGathered = () => { if (step === 3) done(); };
    window.addEventListener("catchami:gathered", onGathered);
    // Objectives on a timer (keeps working even if the tab isn't painting).
    const check = setInterval(() => {
      const p = petPos();
      if (!p) return;
      if (step === 0) {
        start.current ??= p;
        if (Math.hypot(p.x - start.current.x, p.y - start.current.y) > TILE * 3) done();
      }
      if (step === 1) {
        const [x0, , x1] = AREA_BOUNDS.village;
        const tx = p.x / TILE;
        if (tx < x0 || tx >= x1) done();
      }
    }, 400);
    let raf = 0;
    const tick = () => {
      const p = petPos();
      // Arrow beside the pet, pointing at the target.
      const t = STEPS[step]?.target?.();
      const el = arrow.current, a = window.__petAnchor;
      if (el) {
        if (t && p && a && Math.hypot(t.x - p.x, t.y - p.y) > TILE * 2.5) {
          const ang = Math.atan2(t.y - p.y, t.x - p.x);
          el.style.display = "flex";
          el.style.transform = `translate(${a.x + Math.cos(ang) * 74}px, ${a.y - 30 + Math.sin(ang) * 74}px)`;
          (el.firstChild as HTMLElement).style.transform = `rotate(${ang}rad)`;
          (el.lastChild as HTMLElement).textContent = `${t.label} · ${Math.round(Math.hypot(t.x - p.x, t.y - p.y) / TILE)}m`;
        } else el.style.display = "none";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { window.removeEventListener("catchami:gathered", onGathered); clearInterval(check); cancelAnimationFrame(raf); };
  }, [step, met]);

  if (step < 0) return null;
  const s = STEPS[step]!;
  return (
    <>
      <div ref={arrow} className="tut-arrow" style={{ display: "none" }}><span>➜</span><small /></div>
      <div className={`tut-card panel ${min ? "min" : ""}`}>
        <button className="tut-min" onClick={() => setMin((v) => !v)} aria-label={min ? "Expand" : "Minimise"}>{min ? "▴" : "▾"}</button>
        <Keeper size={58} cube={false} className="mini" pose="point" />
        <div className="tut-body">
          <span className="tut-step">Tutorial {step + 1}/{STEPS.length}</span>
          <b>{s.title}</b>
          {!min && <p>{s.text(pet)}</p>}
          {!min && s.extra?.()}
          {s.goal && <span className={`tut-goal ${met ? "met" : ""}`}><i>{met ? "✓" : ""}</i>{s.goal}</span>}
          {!min && (
            <div className="row tut-actions">
              {!s.goal && <button className="btn leaf sm" onClick={() => advance()}>{step === STEPS.length - 1 ? "Start exploring!" : "Next"}</button>}
              <button className="link-btn" onClick={() => advance(STEPS.length)}>Skip tutorial</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
