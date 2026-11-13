/**
 * Stage-by-stage tutorial in the Keeper's Glade, like a real game's training
 * mode. Six stages — First Steps, Gathering, Trading, Danger!, Marketplace,
 * Graduation — each opens with a big "STAGE N" card, moves the pet to that
 * stage's spot in the glade, and ends with a "Stage Clear!" card.
 * Objectives tick themselves off; "Skip tutorial" sends the pet straight to
 * the village.
 */
import { useEffect, useRef, useState } from "react";
import { AREA_BOUNDS, ECONOMY, inventoryWeight, RESOURCES, type Resource } from "@catchami/shared";
import { controlledPet, entities, store, useStore } from "../net/store.ts";
import { send, setOnboarding } from "../net/api.ts";
import { fmt, ResIcon } from "./common.tsx";
import { type KeeperPose } from "./Journey.tsx";
import { sfx } from "./sfx.ts";
import { TutorialHand } from "./TutorialHand.tsx";

const TILE = 32;
type Target = { x: number; y: number; label: string } | null;
type Goal = "flag" | "gather4" | "sell" | "meal" | "fight" | "market" | "portal";
interface Step {
  title: string;
  text: (pet: string) => string;
  pose: KeeperPose;
  goal?: Goal;
  goalText?: string;
  target?: () => Target;
  extra?: (pet: string) => React.ReactNode;
}
interface Stage { name: string; icon: string; learn: string[]; steps: Step[] }

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
const inGlade = (p: { x: number } | null) => !!p && p.x / TILE >= AREA_BOUNDS.glade[0];
let gatheredKinds = new Set<Resource>();
const nearestNode = (): Target => {
  const p = petPos();
  const s = store.get();
  if (!p) return null;
  let best: Target = null, bd = Infinity;
  for (const n of s.nodesDef) {
    if (!n.id.startsWith("glade") || gatheredKinds.has(n.resource)) continue;
    if ((s.nodes[n.id] ?? 1) <= 0) continue;
    const x = n.tx * TILE + 16, y = n.ty * TILE + 16, d = (x - p.x) ** 2 + (y - p.y) ** 2;
    if (d < bd) { bd = d; best = { x, y, label: "Glowing spot" }; }
  }
  return best;
};
const trainingBandit = (): Target => {
  const b = store.get().bandits.find((x) => x[0] === "bandit-practice");
  return b ? { x: b[1], y: b[2], label: "Coach Kiki" } : null;
};

const STAGES: Stage[] = [
  {
    name: "First Steps", icon: "👣", learn: ["Moving around"],
    steps: [
      { title: "Welcome to my glade!", pose: "wave", text: (n) => `This is the Keeper's Glade — a safe place to practise with ${n}. Let's start with a little walk: use the joystick (or tap the ground) to reach the flag!`, goal: "flag", goalText: "Walk to the flag", target: () => poi("glade_goal") },
    ],
  },
  {
    name: "Gathering", icon: "🪵", learn: ["Gathering resources", "Energy & hunger"],
    steps: [
      { title: "Gather resources", pose: "point", text: () => "There are four kinds of resources here: wood, herbs, minerals and fish. Tap a spot and your pet walks over to gather it. Time the minigame well — a perfect hit gives double loot!", goal: "gather4", goalText: "Collect all 4 resources", target: nearestNode },
      {
        title: "Energy & hunger", pose: "idle", text: (n) => `Hard work tires ${n} out and makes them hungry. Keep an eye on the bars on your pet badge (top left):`,
        extra: () => (
          <div className="tut-bars">
            <span><i className="hp" />HP — health</span><span><i className="en" />Energy — gathering uses it</span><span><i className="fd" />Food — eat before it empties</span>
          </div>
        ),
      },
    ],
  },
  {
    name: "Trading", icon: "🪙", learn: ["Selling to merchants", "Buying food"],
    steps: [
      { title: "Sell to a merchant", pose: "point", text: () => "Merchants buy what you gather. Meet Merchant Mari! Walk over to her, tap “Open shop”, then sell your haul for coins.", goal: "sell", goalText: "Sell your resources to Mari", target: () => poi("glade_stall") },
      { title: "Time for a snack", pose: "wave", text: (n) => `Merchants sell food too! Open Mari's shop again and buy a meal — it fills ${n} up and restores energy. Meals cost ${fmt(ECONOMY.food.price)}.`, goal: "meal", goalText: "Buy a meal from Mari", target: () => poi("glade_stall") },
    ],
  },
  {
    name: "Battles", icon: "⚔️", learn: ["Battling other Keepers", "Battle minigame"],
    steps: [
      {
        title: "Battle time!", pose: "point", text: (n) => `Out in the wild, other Keepers' pets can challenge you to a battle — the winner takes the loser's bag! Coach Kiki is here to practise with. When she challenges you, tap ATTACK while the marker is in the red zone. Show her what ${n} can do!`,
        goal: "fight", goalText: "Win the practice battle", target: trainingBandit,
        extra: () => <div className="tut-bandit"><b>⚔️ PvP battle</b></div>,
      },
    ],
  },
  {
    name: "Marketplace", icon: "🛒", learn: ["Buying & selling pets"],
    steps: [
      {
        title: "The marketplace", pose: "idle", text: () => "Want a rarer friend? Other Keepers sell their pets in the Marketplace — and you can sell yours too. Walk up to the market stall to take a peek, then come back!", goal: "market", goalText: "Visit the market stall", target: () => poi("glade_market"),
        extra: () => <button className="btn sky sm" onClick={() => { marketOpened = true; store.set({ screen: "market", sheet: null }); }}>🛒 Open the marketplace</button>,
      },
    ],
  },
  {
    name: "Graduation", icon: "🎓", learn: ["Heading out into the world"],
    steps: [
      { title: "You're ready, Keeper!", pose: "wave", text: (n) => `That's everything! Step through the portal to Paw Village — ${n}'s new home. Bring more sparks to light up the world!`, goal: "portal", goalText: "Walk into the portal", target: () => poi("glade_exit") },
    ],
  },
];
const STEPS = STAGES.flatMap((st, si) => st.steps.map((s, k) => ({ ...s, stage: si, k, first: k === 0, last: k === st.steps.length - 1 })));

// Survives the coach unmounting while the marketplace page is open.
let marketOpened = false;
let marketAutoOpened = false; // the stall opens the market once per visit
let phaseMem: { step: number; phase: "intro" | "play" | "clear" } | null = null;
let enteredOnce = false;

export function TutorialCoach() {
  const onboarding = useStore((s) => s.onboarding);
  const own = useStore((s) => s.own);
  const controlled = useStore((s) => s.controlled);
  const fight = useStore((s) => s.banditFight);
  const step = onboarding?.stage === "tutorial" ? Math.min(STEPS.length - 1, onboarding.tutorial ?? 0) : -1;
  const cur = step >= 0 ? STEPS[step]! : null;
  const [phase, setPhaseRaw] = useState<"intro" | "play" | "clear">(() =>
    phaseMem && phaseMem.step === step ? phaseMem.phase : cur?.first ? "intro" : "play");
  const setPhase = (p: "intro" | "play" | "clear") => { phaseMem = { step, phase: p }; setPhaseRaw(p); };
  const [met, setMet] = useState(false);
  const [got, setGot] = useState<Resource[]>([]);
  const [min, setMin] = useState(false);
  const base = useRef<{ x: number; y: number; carried: number; hunger: number; byRes: Record<Resource, number> } | null>(null);
  const readyAt = useRef(0);
  const stepStart = useRef(Date.now());
  const arrow = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  // Keep the joystick and action buttons just above the docked chat, whatever its height.
  useEffect(() => {
    const el = card.current, root = document.documentElement;
    if (!el) { root.style.removeProperty("--tut-h"); return; }
    const ro = new ResizeObserver(() => root.style.setProperty("--tut-h", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => { ro.disconnect(); root.style.removeProperty("--tut-h"); };
  });
  const pet = own.find((p) => p.id === controlled);
  const name = pet?.name ?? "your pet";

  const finish = () => {
    if (pet) send({ t: "tutorial", petId: pet.id, action: "exit" });
    phaseMem = null; enteredOnce = false; marketOpened = false;
    void setOnboarding("done");
  };
  const goTo = (to: number) => {
    setMet(false); setMin(false); base.current = null; stepStart.current = Date.now(); setGot([]); gatheredKinds = new Set(); marketAutoOpened = false;
    if (to >= STEPS.length) return finish();
    const next = STEPS[to]!;
    const p = next.first ? "intro" : "play";
    phaseMem = { step: to, phase: p }; setPhaseRaw(p);
    void setOnboarding("tutorial", to);
  };
  const complete = () => {
    if (!cur) return;
    if (cur.last) { setPhase("clear"); sfx.fanfare(); }
    else goTo(step + 1);
  };
  const startStage = () => {
    if (!cur) return;
    if (pet) send({ t: "tutorial", petId: pet.id, action: "stage", stage: cur.stage + 1 });
    store.set({ minigame: null, mgSession: null, sheet: null }); // leave the last stage behind
    base.current = null; readyAt.current = Date.now() + 900; stepStart.current = Date.now();
    setPhase("play"); sfx.whoosh();
  };

  // Onboarding can arrive after mount: show the right card for the step.
  useEffect(() => {
    if (!cur || phaseMem?.step === step) return;
    phaseMem = { step, phase: cur.first ? "intro" : "play" }; setPhaseRaw(phaseMem.phase);
  }, [step]);

  // Make sure the pet is in the glade (first load or after a reload mid-stage).
  useEffect(() => {
    if (step < 0 || !pet || enteredOnce) return;
    const t = setTimeout(() => {
      enteredOnce = true;
      if (!inGlade(petPos()) && cur) { send({ t: "tutorial", petId: pet.id, action: "stage", stage: cur.stage + 1 }); readyAt.current = Date.now() + 900; base.current = null; }
    }, 600);
    return () => clearTimeout(t);
  }, [step, pet?.id]);

  // Coming back from the marketplace completes stage 5.
  useEffect(() => {
    if (cur?.goal === "market" && phase === "play" && marketOpened && !met) {
      marketOpened = false; setMet(true); sfx.perfect(); setTimeout(complete, 900);
    }
  }, [step, phase]);

  // Winning the practice fight.
  useEffect(() => {
    if (!fight || cur?.goal !== "fight" || phase !== "play" || met) return;
    if (fight.at < stepStart.current) return;
    if (fight.won) { setMet(true); setTimeout(complete, 3000); } // let the battle popup play out
  }, [fight?.at]);

  // Objectives + arrow.
  useEffect(() => {
    if (!cur || phase !== "play") return;
    const done = () => { if (!met) { setMet(true); sfx.perfect(); setTimeout(complete, 1100); } };

    const check = setInterval(() => {
      if (Date.now() < readyAt.current) return; // wait for the stage teleport to land
      const p = petPos(), me = controlledPet(store.get());
      if (!p || !me) return;
      base.current ??= { x: p.x, y: p.y, carried: inventoryWeight(me.carried), hunger: me.hunger, byRes: { ...me.carried } };
      const b = base.current;
      if (cur.goal === "flag") { const g = poi("glade_goal"); if (g && Math.hypot(p.x - g.x, p.y - g.y) < TILE * 1.6) done(); }
      if (cur.goal === "gather4") {
        const have = RESOURCES.filter((r) => me.carried[r] > b.byRes[r]);
        if (have.length !== gatheredKinds.size) { gatheredKinds = new Set(have); setGot(have); if (have.length < 4) sfx.pop(); }
        if (have.length >= 4) done();
      }
      if (cur.goal === "market" && !marketOpened && !marketAutoOpened) {
        const m = poi("glade_market");
        if (m && Math.hypot(p.x - m.x, p.y - m.y) < TILE * 2) { marketOpened = true; marketAutoOpened = true; store.set({ screen: "market", sheet: null }); }
      }
      if (cur.goal === "sell") { const w = inventoryWeight(me.carried); if (b.carried > 0 && w === 0) done(); if (w > b.carried) b.carried = w; }
      if (cur.goal === "meal" && (me.hunger < b.hunger - 50 || b.hunger < 60)) done(); // already full: nothing to buy
      if (cur.goal === "portal") { const ex = poi("glade_exit"); if (ex && Math.hypot(p.x - ex.x, p.y - ex.y) < TILE * 2) done(); }
    }, 400);
    let raf = 0;
    const tick = () => {
      const p = petPos();
      const t = cur.target?.();
      const el = arrow.current, a = window.__petAnchor;
      if (el) {
        if (t && p && a && Math.hypot(t.x - p.x, t.y - p.y) > TILE * 2.2) {
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
    return () => { clearInterval(check); cancelAnimationFrame(raf); };
  }, [step, met, phase]);

  if (!cur) return null;
  const hand = <TutorialHand key="hand" goal={phase === "play" ? cur.goal : undefined} active={phase !== "play" || !met} />;
  const stage = STAGES[cur.stage]!;
  const n = cur.stage + 1, total = STAGES.length;
  const lastStage = n === total;

  if (phase === "intro") return (<>{hand}
    <div key="stage-intro" className="stage-card-wrap">
      <div className="stage-card panel">
        <div className="stage-pips">{STAGES.map((_, i) => <i key={i} className={i < cur.stage ? "done" : i === cur.stage ? "now" : ""} />)}</div>
        <span className="stage-kicker">Stage {n} of {total}</span>
        <div className="stage-icon">{stage.icon}</div>
        <h2 className="stage-name">{stage.name}</h2>
        <div className="stage-learn">
          <small>You'll learn</small>
          {stage.learn.map((l) => <span key={l}>✦ {l}</span>)}
        </div>
        <button className="btn leaf stage-go" onClick={startStage}>Let's go!</button>
        <button className="link-btn" onClick={finish}>Skip tutorial</button>
      </div>
    </div>
  </>);

  if (phase === "clear") return (<>{hand}
    <div key="stage-clear" className="stage-card-wrap clear">
      <div className="confetti-burst" style={{ left: "50%", top: "38%" }}>{Array.from({ length: 30 }, (_, k) => <i key={k} style={{ "--a": `${k * 12}deg`, "--d": `${110 + (k % 5) * 36}px`, "--c": ["#ff7a59", "#ffd166", "#6cc04a", "#5ab8ff", "#a66bf2", "#f0569c"][k % 6], animationDelay: `${(k % 4) * 40}ms` } as React.CSSProperties} />)}</div>
      <div className="stage-card panel">
        <div className="stage-stars">{[0, 1, 2].map((i) => <span key={i} style={{ animationDelay: `${150 + i * 180}ms` }}>★</span>)}</div>
        <h2 className="stage-clear-title">{lastStage ? "Tutorial Complete!" : "Stage Clear!"}</h2>
        <span className="stage-kicker">Stage {n} · {stage.name}</span>
        <p className="stage-clear-msg">{lastStage ? `${name} is ready for the big wide world!` : `Nice work! Next up: ${STAGES[n]!.icon} ${STAGES[n]!.name}`}</p>
        <button className="btn sun stage-go" onClick={() => goTo(step + 1)}>{lastStage ? "Enter Paw Village" : "Next stage ›"}</button>
      </div>
    </div>
  </>);

  if (!cur.goal) return (<>{hand}
    <div key="stage-info" className="stage-card-wrap">
      <div className="stage-card panel tut-info">
        <span className="stage-kicker">Stage {n} · {stage.name}</span>
        <h2 className="tut-info-title">{cur.title}</h2>
        <p className="tut-info-text">{cur.text(name)}</p>
        {cur.extra?.(name)}
        <button className="btn leaf stage-go" onClick={complete}>Got it!</button>
      </div>
    </div>
  </>);

  return (
    <>
      {hand}
      <div key="arrow" ref={arrow} className="tut-arrow" style={{ display: "none" }}><span>➜</span><small /></div>
      <div key="card" ref={card} className={`tut-card sticky panel ${min ? "min" : ""}`}>
        <button className="tut-min" onClick={() => setMin((v) => !v)} aria-label={min ? "Expand" : "Minimise"}>{min ? "▴" : "▾"}</button>
        <div className="tut-body">
          <span className="tut-step">Stage {n} · {stage.name}{stage.steps.length > 1 ? ` · ${cur.k + 1}/${stage.steps.length}` : ""}</span>
          <b>{cur.title}</b>
          {!min && <p>{cur.text(name)}</p>}
          {!min && cur.extra?.(name)}
          {cur.goal === "gather4" && (
            <div className="tut-res4">{RESOURCES.map((r) => <span key={r} className={got.includes(r) ? "on" : ""}><ResIcon r={r} size={26} />{got.includes(r) && <i>✓</i>}</span>)}</div>
          )}
          {cur.goalText && <span className={`tut-goal2 ${met ? "met" : ""}`}>{met ? "✓ Nice one!" : `🎯 ${cur.goalText}${cur.goal === "gather4" ? ` (${got.length}/4)` : ""}`}</span>}
          {!min && (
            <div className="row tut-actions">
              {cur.goal ? <span /> : <button className="btn leaf sm" onClick={complete}>Got it!</button>}
              <button className="link-btn" onClick={finish}>Skip tutorial</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
