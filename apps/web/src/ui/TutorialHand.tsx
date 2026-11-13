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

/** noHand: glow the element but don't point at it. */
type Pt = { x: number; y: number; el?: Element; noHand?: boolean };
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
  if (document.querySelector(".mg-overlay")) return some(btn(".mg-overlay", /Close/) ?? elPt(".mg-tap"));
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
    const m = s.merchants.find((q) => ["keeper", "chef", "nurse"].includes(q.id) && petNear(q.x, q.y, ECONOMY.merchants.interactRangePx));
    if (!TOUCH && m && window.__w2s) return [window.__w2s(m.x, m.y - MERCHANT_HEIGHT - 44)];
    // Still walking over: just glow the bar that explains why (no pointing).
    const bar = goal === "meal" ? elPt(".pc-stat.fd") : goal === "medicine" ? elPt(".pc-stat.hp") : null;
    if (bar) return [{ ...bar, noHand: true }];
  }
  if (goal === "fight") return some(btn(".actions", "Battle"));
  if (goal === "flag" && TOUCH && controlledPet(s)) return some(elPt(".joystick"));
  return [];
}

export function TutorialHand({ goal, active }: { goal: string | undefined; active: boolean }) {
  const refs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let lit: Element[] = [];
    // Each hand eases toward its target (pulsing buttons don't make it shake) and stays a
    // moment when a target blinks out between minigame rounds (no flicker).
    const st = [0, 1].map(() => ({ x: 0, y: 0, shown: false, seen: 0 }));
    const loop = () => {
      const all = findTargets(goal);
      const ts = all.filter((t) => !t.noHand).slice(0, 2);
      const now = performance.now();
      refs.forEach((ref, i) => {
        const h = ref.current, t = ts[i], s = st[i]!;
        if (!h) return;
        if (t) {
          if (!s.shown || Math.hypot(t.x - s.x, t.y - s.y) > 220) { s.x = t.x; s.y = t.y; }
          else { s.x += (t.x - s.x) * 0.25; s.y += (t.y - s.y) * 0.25; }
          s.shown = true; s.seen = now;
        } else if (s.shown && now - s.seen > 400) s.shown = false;
        if (!s.shown) { h.style.display = "none"; return; }
        // Point up from below the target; flip to point down if there's no room below.
        const below = s.y + 70 < window.innerHeight;
        h.style.display = "block";
        h.style.transform = `translate(${Math.round(s.x - 22)}px, ${Math.round(below ? s.y + 10 : s.y - 66)}px)`;
        h.dataset.dir = below ? "up" : "down";
      });
      const tsAll = all.slice(0, 3);
      const els = tsAll.map((t) => t.el).filter((e): e is Element => !!e);
      for (const e of lit) if (!els.includes(e)) e.classList.remove("tut-target");
      for (const e of els) e.classList.add("tut-target");
      lit = els;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); for (const e of lit) e.classList.remove("tut-target"); };
  }, [goal, active]);
  if (!active) return null;
  return createPortal(<>{refs.map((r, i) => <div key={i} ref={r} className="tut-hand" style={{ display: "none" }}><span>👆</span></div>)}</>, document.body);
}
