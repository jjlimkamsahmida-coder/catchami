/**
 * Little "juice" effects that fly icons across the screen: coins into / out of
 * the pet's piggy bank, energy bolts from the pet badge to the gather button.
 * Pure DOM + Web Animations, so they work over the game canvas and any page.
 */

export type Pt = { x: number; y: number };

/** Centre of the first matching element on screen, or null. */
export function centerOf(sel: string): Pt | null {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export const screenCenter = (): Pt => ({ x: window.innerWidth / 2, y: window.innerHeight * 0.45 });

/** Fly `count` copies of an icon from one point to another along a little arc. */
export function flyIcons(opts: { from: Pt; to: Pt; html: string; count?: number; cls?: string; spread?: number }) {
  const { from, to, html, count = 6, cls = "", spread = 26 } = opts;
  for (let i = 0; i < count; i++) {
    const el = document.createElement("div");
    el.className = `fly-icon ${cls}`;
    el.innerHTML = html;
    document.body.appendChild(el);
    const jx = (Math.random() - 0.5) * spread, jy = (Math.random() - 0.5) * spread;
    const midX = (from.x + to.x) / 2 + (Math.random() - 0.5) * 60, midY = Math.min(from.y, to.y) - 60 - Math.random() * 40;
    const a = el.animate(
      [
        { transform: `translate(${from.x + jx}px, ${from.y + jy}px) scale(0.4)`, opacity: 0 },
        { transform: `translate(${from.x + jx}px, ${from.y + jy}px) scale(1.15)`, opacity: 1, offset: 0.15 },
        { transform: `translate(${midX}px, ${midY}px) scale(1)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${to.x}px, ${to.y}px) scale(0.6)`, opacity: 0.9 },
      ],
      { duration: 750 + i * 25, delay: i * 70, easing: "cubic-bezier(.45,.05,.55,.95)", fill: "both" },
    );
    a.onfinish = () => el.remove();
    a.oncancel = () => el.remove();
  }
}

/** A floating "+12K" / "−45 ⚡" label that drifts up and fades. */
export function floatLabel(at: Pt, text: string, cls = "") {
  const el = document.createElement("div");
  el.className = `fly-label ${cls}`;
  el.textContent = text;
  document.body.appendChild(el);
  const a = el.animate(
    [
      { transform: `translate(${at.x}px, ${at.y}px) translate(-50%, -50%) scale(0.6)`, opacity: 0 },
      { transform: `translate(${at.x}px, ${at.y - 14}px) translate(-50%, -50%) scale(1.15)`, opacity: 1, offset: 0.2 },
      { transform: `translate(${at.x}px, ${at.y - 46}px) translate(-50%, -50%) scale(1)`, opacity: 0 },
    ],
    { duration: 1300, easing: "ease-out", fill: "both" },
  );
  a.onfinish = () => el.remove();
}
