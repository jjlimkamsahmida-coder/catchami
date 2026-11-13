/**
 * Tutorial hand: a big bouncing pointer over whatever the player should tap
 * next — the card button, Gather, Open shop, Sell everything, Buy meal, the
 * bottom-menu buttons, Bubble Roulette's two splash buttons... It looks the
 * targets up every frame, so it follows sheets and popups as they open and
 * close, and gives the target a glowing highlight.
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ECONOMY } from "@catchami/shared";
import { controlledPet, entities, store } from "../net/store.ts";
import { MERCHANT_HEIGHT } from "../game/assets.ts";

declare global { interface Window { __w2s?: (x: number, y: number) => { x: number; y: number } } }

type Pt = { x: number; y: number; el?: Element };
const TOUCH = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

/** First visible, enabled button whose text matches. */
function btn(scope: string, match: RegExp | string): Pt | null {
  for (const el of document.querySelectorAll<HTMLButtonElement>(`${scope} button`)) {
    const t = el.textContent ?? "";
    if (el.disabled || !(typeof match === "string" ? t.includes(match) : match.test(t))) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, el };
  }
  return null;
}
function elPt(sel: string): Pt | null {
  const e = document.querySelector<HTMLElement>(sel);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2, el: e } : null;
}
const petNear = (x: number, y: number, range: number) => {
  const id = store.get().controlled, s = id ? entities.get(id)?.samples.at(-1) : null;
  return !!s && Math.hypot(s[1] - x, s[2] - y) <= range;
};
const some = (...xs: Array<Pt | null>) => xs.filter((x): x is Pt => !!x);

/** Where to point for the current tutorial goal (one or more targets). */
function findTargets(goal: string | undefined): Pt[] {
  // Popups first: whatever is on top is what needs tapping.
  const card = btn(".stage-card", /Let's go|Next tutorial|Got it|Enter Paw Village/);
  if (card) return [card];
  if (document.querySelector(".br")) {
    const rules = btn(".br-rules-card", "Let's play");
    if (rules) return [rules];
    const back = btn(".br", "Back to the world");
    if (back) return [back];
    return some(btn(".br-actions", "Splash myself"), btn(".br-actions", /Splash (?!myself)/));
  }
  if (document.querySelector(".bduel")) return some(btn(".bduel", "ATTACK"));
  if (document.querySelector(".mg-overlay")) return some(btn(".mg-overlay", /Close/) ?? elPt(".mg-tap:not(:disabled)"));
  const s = store.get();
  if (goal === "market") return some(btn(".gamebar", "Market"));
  if (goal === "marketBack") return some(elPt(".gpage-back"));
  if (goal === "profile") return some(btn(".gamebar", "Profile"));
  if (goal === "autopilot") return some(btn(".gtabs", "Autopilot"));
  if (goal === "piggy") return some(btn(".gtabs", "Piggy"));
  if (s.sheet?.kind === "merchant") {
    if (goal === "sell") return some(btn(".sheet", "Sell everything"));
    if (goal === "meal") return some(btn(".sheet", "Buy meal"));
    if (goal === "medicine") return some(btn(".sheet", "Medicine"));
  }
  if (goal === "gather4") {
    const b = btn(".actions", "Gather");
    if (b) return [b];
    if (!TOUCH && window.__w2s) for (const n of s.nodesDef) {
      if (!n.id.startsWith("glade") || (s.nodes[n.id] ?? 1) <= 0) continue;
      const x = n.tx * 32 + 16, y = n.ty * 32 + 30;
      if (petNear(x, y, 120)) return [window.__w2s(x, y + 24)];
    }
  }
  if (goal === "sell" || goal === "meal" || goal === "medicine") {
    const b = btn(".actions", "Open shop");
    if (b) return [b];
    const m = s.merchants.find((q) => q.id === "keeper");
    if (!TOUCH && m && window.__w2s && petNear(m.x, m.y, ECONOMY.merchants.interactRangePx)) return [window.__w2s(m.x, m.y - MERCHANT_HEIGHT - 44)];
  }
  if (goal === "flag" && TOUCH && controlledPet(s)) return some(elPt(".joystick"));
  return [];
}

export function TutorialHand({ goal, active }: { goal: string | undefined; active: boolean }) {
  const refs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let lit: Element[] = [];
    const loop = () => {
      const ts = findTargets(goal).slice(0, 2);
      refs.forEach((ref, i) => {
        const h = ref.current, t = ts[i];
        if (!h) return;
        if (!t) { h.style.display = "none"; return; }
        // Point up from below the target; flip to point down if there's no room below.
        const below = t.y + 70 < window.innerHeight;
        h.style.display = "block";
        h.style.transform = `translate(${t.x - 22}px, ${below ? t.y + 10 : t.y - 66}px)`;
        h.dataset.dir = below ? "up" : "down";
      });
      const now = ts.map((t) => t.el).filter((e): e is Element => !!e);
      for (const e of lit) if (!now.includes(e)) e.classList.remove("tut-target");
      for (const e of now) e.classList.add("tut-target");
      lit = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); for (const e of lit) e.classList.remove("tut-target"); };
  }, [goal, active]);
  if (!active) return null;
  return createPortal(<>{refs.map((r, i) => <div key={i} ref={r} className="tut-hand" style={{ display: "none" }}><span>👆</span></div>)}</>, document.body);
}
