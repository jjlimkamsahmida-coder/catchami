/**
 * Scene components for the revised trailer: floating NFT card reveal, the full-screen
 * economy loop (PET → MERCHANT → HQ → PET), and the autopilot activity panel.
 * All numbers shown are passed in from real recordings (see timeline.ts).
 */
import React from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, Easing } from "remotion";

export const C = { ink: "#2b1d3a", inkSoft: "#5a4a6b", paper: "#fff6e5", paper2: "#fbe9c8", leaf: "#6cc04a", sun: "#ffd166", sunDark: "#e8a93b", coral: "#ff7a59", sky: "#5ab8ff", plum: "#8a5cf6", mythic: "#f0569c" };
const FPS = 30;
const ease = Easing.bezier(0.33, 0, 0.2, 1);
const stroke = (w: number) => ({ WebkitTextStroke: `${w}px ${C.ink}`, paintOrder: "stroke fill" as const });
const fmtK = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K` : `${Math.round(n)}`);

export const fontCss = `
@font-face { font-family: Fredoka; font-weight: 500; src: url(${staticFile("fonts/fredoka-latin-500-normal.woff2")}) format("woff2"); }
@font-face { font-family: Fredoka; font-weight: 600; src: url(${staticFile("fonts/fredoka-latin-600-normal.woff2")}) format("woff2"); }
@font-face { font-family: Fredoka; font-weight: 700; src: url(${staticFile("fonts/fredoka-latin-700-normal.woff2")}) format("woff2"); }`;
export function Backdrop({ tint = C.sky }: { tint?: string }) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 40%, ${C.paper} 0%, ${tint} 140%)` }}>
      <style>{fontCss}</style>
      <AbsoluteFill style={{ opacity: 0.35 }}>
        {Array.from({ length: 12 }, (_, i) => <div key={i} style={{ position: "absolute", left: "50%", top: "45%", width: 3000, height: 80, background: i % 2 ? "rgba(255,255,255,.55)" : "transparent", transformOrigin: "0 50%", transform: `rotate(${i * 30 + frame * 0.25}deg)` }} />)}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

// ------------------------------------------------------------------ NFT card reveal
/** The real card image flies out of the phone and grows; the wallet row gets a glowing highlight and a count-up. */
export function CardReveal({ card, cardW, cardH, walletBox, wallet, rarity, sticker, startAt = 0 }: {
  card: string; cardW: number; cardH: number; walletBox: [number, number, number, number]; wallet: number; rarity: string; sticker?: string; startAt?: number;
}) {
  const frame = useCurrentFrame() - startAt * FPS;
  const fly = interpolate(frame, [0, 22], [0, 1], { easing: ease, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const settle = spring({ frame: frame - 18, fps: FPS, config: { damping: 12, mass: 0.7 } });
  const H = 860, W = (cardW / cardH) * H;
  const x = interpolate(fly, [0, 1], [960 - W * 0.28, 760 - W / 2]), y = interpolate(fly, [0, 1], [560, 540 - H / 2]);
  const s = interpolate(fly, [0, 1], [0.42, 1]) * (0.96 + 0.04 * settle);
  const glow = interpolate(frame, [36, 46], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const count = interpolate(frame, [40, 66], [0, wallet], { easing: ease, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const [wx, wy, ww, wh] = walletBox; const k = H / cardH;
  const steps = [["REAL ANIMAL", C.sky], ["NFT", C.plum], ["ITS OWN WALLET", C.sun]] as const;
  return (
    <AbsoluteFill>
      <Backdrop tint={C.sun} />
      <div style={{ position: "absolute", left: x, top: y, width: W, height: H, transform: `scale(${s}) rotate(${(1 - fly) * -10 + Math.sin(frame / 20) * 1.2}deg)`, transformOrigin: "50% 50%" }}>
        <div style={{ position: "absolute", inset: -18, borderRadius: 40, background: `conic-gradient(from ${frame * 4}deg, ${C.mythic}, ${C.sun}, ${C.sky}, ${C.plum}, ${C.mythic})`, filter: "blur(18px)", opacity: 0.85 * fly }} />
        <Img src={staticFile(`img/${card}`)} style={{ position: "absolute", inset: 0, width: W, height: H, borderRadius: 26, boxShadow: `0 18px 0 rgba(43,29,58,.5)` }} />
        <div style={{ position: "absolute", left: wx * k - 10, top: wy * k - 10, width: ww * k + 20, height: wh * k + 20, borderRadius: 18, border: `7px solid ${C.sun}`, boxShadow: `0 0 ${30 * glow}px ${C.sun}, inset 0 0 ${18 * glow}px rgba(255,209,102,.7)`, opacity: glow }} />
      </div>
      {/* Wallet bubble */}
      <div style={{ position: "absolute", left: 1170, top: 560, opacity: glow, transform: `translateY(${(1 - glow) * 30}px) scale(${0.9 + 0.1 * glow})` }}>
        <div style={{ background: "#fff", border: `7px solid ${C.ink}`, borderRadius: 32, boxShadow: `0 10px 0 ${C.ink}`, padding: "20px 34px", display: "flex", alignItems: "center", gap: 20 }}>
          <Img src={staticFile("img/token.webp")} style={{ width: 110, transform: `rotateY(${frame * 5}deg)` }} />
          <div style={{ fontFamily: "Fredoka", color: C.ink }}>
            <div style={{ fontSize: 30, fontWeight: 600, color: C.inkSoft }}>{rarity} pet's wallet</div>
            <div style={{ fontSize: 86, fontWeight: 700, lineHeight: 1 }}>{fmtK(count)}<span style={{ fontSize: 34, marginLeft: 10 }}>$CATCHAMI</span></div>
          </div>
        </div>
      </div>
      {/* REAL ANIMAL → NFT → ITS OWN WALLET */}
      <div style={{ position: "absolute", left: 1150, top: 200, display: "flex", flexDirection: "column", gap: 14 }}>
        {steps.map(([t, col], i) => {
          const sp = spring({ frame: frame - 8 - i * 12, fps: FPS, config: { damping: 12 } });
          return (
            <div key={t} style={{ display: "flex", alignItems: "center", gap: 16, transform: `scale(${Math.max(0, sp)})`, transformOrigin: "left center" }}>
              {i > 0 && <span style={{ fontFamily: "Fredoka", fontWeight: 700, fontSize: 50, color: C.ink }}>→</span>}
              <span style={{ background: col, border: `6px solid ${C.ink}`, borderRadius: 18, boxShadow: `0 7px 0 ${C.ink}`, padding: "4px 22px 8px", fontFamily: "Fredoka", fontWeight: 700, fontSize: 52, color: "#fff", ...stroke(7) }}>{t}</span>
            </div>
          );
        })}
      </div>
      {sticker && null}
    </AbsoluteFill>
  );
}

// ------------------------------------------------------------------ economy loop
type Step = { from: "pet" | "merchant" | "hq"; to: "pet" | "merchant" | "hq"; icon: string; label: string; amount?: string; color: string };
export const LOOP_STEPS: Step[] = [
  { from: "pet", to: "merchant", icon: "icon-fish.png", label: "Pet sells fish", color: C.sky },
  { from: "merchant", to: "pet", icon: "ui-coin.png", label: "Merchant pays coins", color: C.sun },
  { from: "merchant", to: "hq", icon: "icon-fish.png", label: "Merchant delivers to HQ", color: C.leaf },
  { from: "pet", to: "hq", icon: "ui-coin.png", label: "Pet spends → HQ revenue", color: C.coral },
  { from: "hq", to: "merchant", icon: "ui-coin.png", label: "HQ funds the next budget", color: C.plum },
];

export function EconomyLoop({ petSticker, perStep = 1.5, amounts = {} as Record<number, string> }: { petSticker: string; perStep?: number; amounts?: Record<number, string> }) {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const pos = { pet: [400, 640], merchant: [960, 330], hq: [1520, 640] } as const;
  const node = (key: keyof typeof pos, img: string, title: string, col: string, w: number) => {
    const [x, y] = pos[key];
    const sp = spring({ frame: frame - ({ pet: 0, merchant: 6, hq: 12 })[key], fps: FPS, config: { damping: 11 } });
    const active = LOOP_STEPS.some((s, i) => t >= 0.6 + i * perStep && t < 0.6 + (i + 1) * perStep && (s.from === key || s.to === key));
    return (
      <div key={key} style={{ position: "absolute", left: x, top: y, transform: `translate(-50%,-50%) scale(${sp * (active ? 1.06 : 1)})`, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ width: 300, height: 300, borderRadius: "50%", background: "#fff", border: `9px solid ${C.ink}`, boxShadow: `0 12px 0 ${C.ink}${active ? `, 0 0 40px ${col}` : ""}`, display: "grid", placeItems: "center", overflow: "hidden" }}>
          <Img src={staticFile(`img/${img}`)} style={{ width: w, maxHeight: 250, objectFit: "contain" }} />
        </div>
        <div style={{ marginTop: -26, background: col, border: `7px solid ${C.ink}`, borderRadius: 20, boxShadow: `0 8px 0 ${C.ink}`, padding: "4px 30px 8px", fontFamily: "Fredoka", fontWeight: 700, fontSize: 58, color: "#fff", ...stroke(8) }}>{title}</div>
      </div>
    );
  };
  // current transfer
  const i = Math.floor((t - 0.6) / perStep), local = ((t - 0.6) % perStep) / perStep;
  const step = i >= 0 && i < LOOP_STEPS.length ? LOOP_STEPS[i] : null;
  const travel = step ? ease(Math.min(1, local / 0.65)) : 0;
  const [ax, ay] = step ? pos[step.from] : [0, 0], [bx, by] = step ? pos[step.to] : [0, 0];
  const cx = (ax + bx) / 2, cy = Math.min(ay, by) - 120;
  const px = (1 - travel) ** 2 * ax + 2 * (1 - travel) * travel * cx + travel ** 2 * bx;
  const py = (1 - travel) ** 2 * ay + 2 * (1 - travel) * travel * cy + travel ** 2 * by;
  return (
    <AbsoluteFill>
      <Backdrop tint={C.leaf} />
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        {[["pet", "merchant"], ["merchant", "hq"], ["hq", "pet"]].map(([a, b]) => {
          const [x1, y1] = pos[a as keyof typeof pos], [x2, y2] = pos[b as keyof typeof pos];
          return <line key={a + b} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.ink} strokeWidth={8} strokeDasharray="22 18" strokeDashoffset={-frame * 2} opacity={0.35} />;
        })}
      </svg>
      {node("pet", petSticker, "PET", C.mythic, 230)}
      {node("merchant", "merchant-finn.png", "MERCHANT", C.sun, 200)}
      {node("hq", "prop-castle.png", "HQ", C.plum, 280)}
      {step && (
        <>
          <div style={{ position: "absolute", left: px, top: py, transform: `translate(-50%,-50%) scale(${1 + 0.25 * Math.sin(travel * Math.PI)})`, opacity: local < 0.92 ? 1 : 0 }}>
            <Img src={staticFile(`img/${step.icon}`)} style={{ width: 120, filter: "drop-shadow(0 6px 0 rgba(43,29,58,.5))" }} />
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 150, display: "flex", justifyContent: "center" }}>
            <div key={i} style={{ background: step.color, border: `8px solid ${C.ink}`, borderRadius: 26, boxShadow: `0 10px 0 ${C.ink}`, padding: "8px 40px 12px", fontFamily: "Fredoka", fontWeight: 700, fontSize: 66, color: "#fff", ...stroke(9), transform: `scale(${spring({ frame: frame - Math.round((0.6 + i * perStep) * FPS), fps: FPS, config: { damping: 12 } })})` }}>
              {step.label}{amounts[i] ? <span style={{ marginLeft: 18 }}>{amounts[i]}</span> : null}
            </div>
          </div>
        </>
      )}
    </AbsoluteFill>
  );
}

// ------------------------------------------------------------------ autopilot activity panel
export type ActivityRow = { t: number; text: string; balance?: number; icon?: string };
/** A real activity log (recorded alongside the time-lapse) shown as a feed. `speed` maps trailer seconds to recording seconds. */
export function ActivityPanel({ rows, speed, offset }: { rows: ActivityRow[]; speed: number; offset: number }) {
  const frame = useCurrentFrame();
  const rt = offset + (frame / FPS) * speed;
  const shown = rows.filter((r) => r.t <= rt).slice(-5);
  const last = [...rows].reverse().find((r) => r.t <= rt && r.balance !== undefined);
  return (
    <div style={{ position: "absolute", right: 40, top: 150, width: 560, background: "rgba(255,246,229,.97)", border: `7px solid ${C.ink}`, borderRadius: 30, boxShadow: `0 10px 0 ${C.ink}`, padding: "18px 22px", fontFamily: "Fredoka", color: C.ink }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 34, fontWeight: 700 }}>🤖 Autopilot</span>
        {last?.balance !== undefined && <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 32, fontWeight: 700 }}><Img src={staticFile("img/ui-coin.png")} style={{ width: 38 }} />{fmtK(last.balance)}</span>}
      </div>
      {shown.map((r, i) => {
        const age = rt - r.t, o = interpolate(age, [0, 0.4 * speed], [0, 1], { extrapolateRight: "clamp" });
        return <div key={r.t + r.text} style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 30, fontWeight: 600, padding: "6px 0", borderTop: i ? `2px dashed rgba(43,29,58,.15)` : "none", opacity: o * (i === shown.length - 1 ? 1 : 0.7) }}><span style={{ fontSize: 34 }}>{r.icon ?? "•"}</span>{r.text}</div>;
      })}
    </div>
  );
}
