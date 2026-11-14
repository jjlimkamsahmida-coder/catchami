import React from "react";
import { AbsoluteFill, Audio, Img, interpolate, OffthreadVideo, Easing, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { CAPTION_SPLIT, FPS, LABELS, S, SFX, SHOTS, VO, type Shot } from "./timeline";
import vo from "./vo.json";

// Brand tokens from apps/web/src/styles.css
export const C = { ink: "#2b1d3a", inkSoft: "#5a4a6b", paper: "#fff6e5", paper2: "#fbe9c8", leaf: "#6cc04a", leafDark: "#4c9a33", sun: "#ffd166", sunDark: "#e8a93b", coral: "#ff7a59", coralDark: "#d9563a", sky: "#5ab8ff", plum: "#8a5cf6", mythic: "#f0569c" };
const fontCss = `
@font-face { font-family: Fredoka; font-weight: 500; src: url(${staticFile("fonts/fredoka-latin-500-normal.woff2")}) format("woff2"); }
@font-face { font-family: Fredoka; font-weight: 600; src: url(${staticFile("fonts/fredoka-latin-600-normal.woff2")}) format("woff2"); }
@font-face { font-family: Fredoka; font-weight: 700; src: url(${staticFile("fonts/fredoka-latin-700-normal.woff2")}) format("woff2"); }`;
const f = (s: number) => Math.round(s * FPS);
const ease = Easing.bezier(0.33, 0, 0.2, 1);

// ------------------------------------------------------------------ shots
function ShotView({ s }: { s: Shot }) {
  const frame = useCurrentFrame();
  const t = frame / FPS, p = Math.min(1, t / s.dur);
  const [z0, z1] = s.zoom ?? [1, 1];
  const z = z0 + (z1 - z0) * ease(p);
  const [fx, fy] = s.focus ?? [0.5, 0.5];
  const media = s.src.startsWith("IMG:")
    ? <Img src={staticFile(`img/${s.src.slice(4)}.png`)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    : <OffthreadVideo src={staticFile(`footage/${s.src}.mp4`)} trimBefore={f(s.from)} playbackRate={s.rate ?? 1} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />;
  const inner = <div style={{ width: "100%", height: "100%", transform: `scale(${z})`, transformOrigin: `${fx * 100}% ${fy * 100}%` }}>{media}</div>;
  if (s.frame === "phone") {
    const enter = s.tr && s.tr !== "cut" ? spring({ frame, fps: FPS, config: { damping: 14, mass: 0.7 } }) : 1;
    return (
      <AbsoluteFill style={{ background: C.sky }}>
        <Img src={staticFile(`img/${s.bg ?? "village"}.png`)} style={{ position: "absolute", inset: -40, width: "calc(100% + 80px)", height: "calc(100% + 80px)", objectFit: "cover", filter: "blur(14px) saturate(1.15) brightness(0.92)", transform: `scale(${1.05 + 0.04 * p})` }} />
        <Sparkles />
        <div style={{ position: "absolute", left: "50%", top: "50%", width: 470, height: 1017, transform: `translate(-50%,-50%) scale(${0.85 + 0.15 * enter}) rotate(${(1 - enter) * -4}deg)`, borderRadius: 56, border: `10px solid ${C.ink}`, overflow: "hidden", boxShadow: `0 14px 0 ${C.ink}, 0 30px 60px rgba(43,29,58,.35)`, background: "#000" }}>
          {inner}
        </div>
      </AbsoluteFill>
    );
  }
  return <AbsoluteFill style={{ background: C.ink, overflow: "hidden" }}>{inner}</AbsoluteFill>;
}

function Sparkles() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      {Array.from({ length: 14 }, (_, i) => {
        const x = (i * 137) % 1920, y = (i * 263 + frame * (1 + (i % 3))) % 1080, s = 10 + (i % 4) * 6, o = 0.35 + 0.35 * Math.sin(frame / 9 + i);
        return <div key={i} style={{ position: "absolute", left: x, top: 1080 - y, width: s, height: s, borderRadius: "50%", background: "rgba(255,255,255,.75)", opacity: o, border: "2px solid rgba(255,255,255,.9)" }} />;
      })}
    </AbsoluteFill>
  );
}

// ------------------------------------------------------------------ transitions
function Transition({ kind }: { kind: NonNullable<Shot["tr"]> }) {
  const frame = useCurrentFrame();
  if (kind === "cut") return null;
  const d = 12, p = Math.min(1, frame / d);
  if (kind === "flash") return <AbsoluteFill style={{ background: "#fff", opacity: interpolate(frame, [0, 1, 5], [0.85, 0.6, 0], { extrapolateRight: "clamp" }) }} />;
  if (kind === "bubble") {
    const r = interpolate(p, [0, 1], [0, 1500], { easing: ease });
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div style={{ position: "absolute", inset: 0, background: C.sky, clipPath: `circle(${Math.max(0, 1500 - r)}px at 50% 50%)`, opacity: p < 1 ? 1 : 0 }} />
        {Array.from({ length: 9 }, (_, i) => {
          const a = (i / 9) * Math.PI * 2, dist = 120 + p * 700;
          return <Img key={i} src={staticFile("img/br-bubble.png")} style={{ position: "absolute", left: 960 + Math.cos(a) * dist - 50, top: 540 + Math.sin(a) * dist - 50, width: 100 + (i % 3) * 30, opacity: 1 - p }} />;
        })}
      </AbsoluteFill>
    );
  }
  if (kind === "star") {
    const s = interpolate(frame, [0, d], [3.2, 0], { easing: ease, extrapolateRight: "clamp" });
    return (
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
        <svg width={1920 * 1.6} height={1920 * 1.6} viewBox="-1 -1 2 2" style={{ transform: `scale(${s}) rotate(${frame * 6}deg)` }}>
          <path d="M0,-1 L0.22,-0.3 L0.95,-0.31 L0.36,0.12 L0.59,0.81 L0,0.38 L-0.59,0.81 L-0.36,0.12 L-0.95,-0.31 L-0.22,-0.3 Z" fill={C.sun} stroke={C.ink} strokeWidth="0.03" />
        </svg>
      </AbsoluteFill>
    );
  }
  // swoosh: diagonal coral band sweeping across
  const x = interpolate(frame, [0, d], [-2400, 2400], { easing: ease, extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: -400, left: x, width: 1300, height: 1900, background: C.coral, borderLeft: `14px solid ${C.ink}`, borderRight: `14px solid ${C.ink}`, transform: "rotate(18deg)" }} />
      <Img src={staticFile("img/cube-fly.png")} style={{ position: "absolute", top: 420, left: x + 520, width: 260, transform: `rotate(${frame * 12}deg)` }} />
    </AbsoluteFill>
  );
}

// ------------------------------------------------------------------ text
const outline = (w: number, c = C.ink) => ({ WebkitTextStroke: `${w}px ${c}`, paintOrder: "stroke fill" as const });

function Caption({ text }: { text: string }) {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 4], [0, 1], { extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 64, display: "flex", justifyContent: "center", opacity: o, transform: `translateY(${(1 - o) * 10}px)` }}>
      <div style={{ maxWidth: 1500, textAlign: "center", fontFamily: "Fredoka", fontWeight: 600, fontSize: 54, lineHeight: 1.15, color: "#fff", ...outline(11), textShadow: "0 5px 0 rgba(43,29,58,.55)", letterSpacing: 0.3 }}>{text}</div>
    </div>
  );
}

function Label({ text, color, pos }: { text: string; color: keyof typeof C | string; pos?: string }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const sIn = spring({ frame, fps: FPS, config: { damping: 11, mass: 0.6 } });
  const out = interpolate(frame, [durationInFrames - 6, durationInFrames], [1, 0], { extrapolateLeft: "clamp" });
  const bg = (C as Record<string, string>)[color] ?? color;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: pos === "center" ? 420 : 70, display: "flex", justifyContent: "center", opacity: out }}>
      <div style={{ transform: `scale(${sIn * out}) rotate(${(1 - sIn) * -8 - 2}deg)`, background: bg, border: `7px solid ${C.ink}`, borderRadius: 26, boxShadow: `0 10px 0 ${C.ink}`, padding: "10px 38px 14px", fontFamily: "Fredoka", fontWeight: 700, fontSize: 78, color: "#fff", ...outline(9), letterSpacing: 2 }}>{text}</div>
    </div>
  );
}

function Chip({ text }: { text: string }) {
  return <div style={{ position: "absolute", left: 40, top: 40, background: C.ink, color: C.sun, fontFamily: "Fredoka", fontWeight: 700, fontSize: 30, padding: "8px 18px", borderRadius: 999, border: `4px solid ${C.sun}` }}>⏩ {text}</div>;
}

function TestnetTag() {
  return <div style={{ position: "absolute", right: 40, top: 40, background: "rgba(43,29,58,.88)", color: "#fff", fontFamily: "Fredoka", fontWeight: 600, fontSize: 26, padding: "8px 16px", borderRadius: 14, border: `3px solid ${C.leaf}` }}>NEAR testnet · real transactions</div>;
}

// ------------------------------------------------------------------ title cards
function Title() {
  const frame = useCurrentFrame();
  const sLogo = spring({ frame, fps: FPS, config: { damping: 9, mass: 0.8 } });
  const sSub = spring({ frame: frame - 14, fps: FPS, config: { damping: 12 } });
  const { durationInFrames } = useVideoConfig();
  const out = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], { extrapolateLeft: "clamp" });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: out }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 50% 45%, rgba(255,246,229,.55), rgba(43,29,58,.15) 70%)" }} />
      <Img src={staticFile("img/logo.png")} style={{ width: 980, transform: `scale(${sLogo}) rotate(${(1 - sLogo) * -10}deg)`, filter: "drop-shadow(0 14px 0 rgba(43,29,58,.6))" }} />
      <div style={{ marginTop: -10, transform: `scale(${Math.max(0, sSub)})`, background: C.sun, border: `7px solid ${C.ink}`, borderRadius: 999, boxShadow: `0 9px 0 ${C.ink}`, padding: "8px 40px 12px", fontFamily: "Fredoka", fontWeight: 700, fontSize: 58, color: C.ink, letterSpacing: 4 }}>A LIVING ANIMAL ECONOMY</div>
    </AbsoluteFill>
  );
}

function FlowOverlay() {
  const frame = useCurrentFrame();
  const steps = [["🧾", "PLAYER SPENDING", C.coral], ["🏰", "HQ TREASURY", C.plum], ["🧺", "MERCHANT BUDGETS", C.sun], ["🐾", "PETS EARN", C.leaf], ["🍖", "PETS SPEND", C.sky]] as const;
  const { durationInFrames } = useVideoConfig();
  const out = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], { extrapolateLeft: "clamp" });
  const cx = 1400, cy = 520, r = 270;
  return (
    <AbsoluteFill style={{ opacity: out }}>
      <div style={{ position: "absolute", left: cx - r - 150, top: cy - r - 120, width: 2 * r + 300, height: 2 * r + 240, borderRadius: 60, background: "rgba(255,246,229,.94)", border: `7px solid ${C.ink}`, boxShadow: `0 12px 0 ${C.ink}` }} />
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        <circle cx={cx} cy={cy} r={r * 0.82} fill="none" stroke={C.ink} strokeWidth={6} strokeDasharray="18 16" strokeDashoffset={-frame * 3} opacity={0.5} />
      </svg>
      {steps.map(([ico, text, col], i) => {
        const a = -Math.PI / 2 + (i / steps.length) * Math.PI * 2, x = cx + Math.cos(a) * r * 0.82, y = cy + Math.sin(a) * r * 0.82;
        const s = spring({ frame: frame - i * 9, fps: FPS, config: { damping: 12 } });
        const lit = Math.floor(frame / 14) % steps.length === i;
        return (
          <div key={text} style={{ position: "absolute", left: x, top: y, transform: `translate(-50%,-50%) scale(${s * (lit ? 1.1 : 1)})`, background: col, border: `6px solid ${C.ink}`, borderRadius: 22, boxShadow: `0 7px 0 ${C.ink}`, padding: "8px 18px 10px", fontFamily: "Fredoka", fontWeight: 700, fontSize: 30, color: "#fff", ...outline(6), whiteSpace: "nowrap", textAlign: "center" }}>
            <div style={{ fontSize: 44, WebkitTextStroke: 0 }}>{ico}</div>{text}
          </div>
        );
      })}
      <div style={{ position: "absolute", left: cx, top: cy, transform: "translate(-50%,-50%)", fontFamily: "Fredoka", fontWeight: 700, fontSize: 30, color: C.ink, textAlign: "center", lineHeight: 1.1 }}>
        <Img src={staticFile("img/token.webp")} style={{ width: 120, transform: `rotateY(${frame * 6}deg)` }} /><br />fixed 100T<br />supply
      </div>
    </AbsoluteFill>
  );
}

function LedgerOverlay() {
  const frame = useCurrentFrame();
  const s = spring({ frame, fps: FPS, config: { damping: 13 } });
  const rows = [["🐾", "Pet NFT", "own token balance in the game vault"], ["📒", "Every action", "instant double-entry ledger"], ["⛓️", "Net result", "settled on NEAR in batches"]];
  return (
    <div style={{ position: "absolute", left: 60, bottom: 190, transform: `translateX(${(1 - s) * -700}px)`, background: "rgba(255,246,229,.96)", border: `6px solid ${C.ink}`, borderRadius: 28, boxShadow: `0 9px 0 ${C.ink}`, padding: "18px 26px", fontFamily: "Fredoka", color: C.ink, width: 980 }}>
      {rows.map(([i, a, b], k) => {
        const o = interpolate(frame, [k * 10, k * 10 + 8], [0, 1], { extrapolateRight: "clamp", extrapolateLeft: "clamp" });
        return <div key={a} style={{ display: "flex", gap: 16, alignItems: "center", fontSize: 32, padding: "6px 0", opacity: o }}><span style={{ fontSize: 40 }}>{i}</span><b style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{a}</b><span style={{ fontWeight: 500, color: C.inkSoft }}>· {b}</span></div>;
      })}
    </div>
  );
}

function Ending() {
  const frame = useCurrentFrame();
  const sLogo = spring({ frame, fps: FPS, config: { damping: 8, mass: 0.9 } });
  const cubeY = interpolate(spring({ frame: frame - 10, fps: FPS, config: { damping: 7, mass: 0.6 } }), [0, 1], [-700, 0]);
  const sTag = spring({ frame: frame - 26, fps: FPS, config: { damping: 12 } });
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 42%, ${C.paper} 0%, ${C.sun} 55%, ${C.sunDark} 100%)`, alignItems: "center", justifyContent: "center" }}>
      <AbsoluteFill style={{ opacity: 0.5 }}>
        {Array.from({ length: 16 }, (_, i) => <div key={i} style={{ position: "absolute", left: "50%", top: "42%", width: 3000, height: 90, background: i % 2 ? "rgba(255,255,255,.35)" : "transparent", transformOrigin: "0 50%", transform: `rotate(${i * 22.5 + frame * 0.6}deg)` }} />)}
      </AbsoluteFill>
      <div style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: 10, marginTop: -60 }}>
        <Img src={staticFile("img/logo.png")} style={{ width: 1040, transform: `scale(${sLogo})`, filter: "drop-shadow(0 16px 0 rgba(43,29,58,.55))" }} />
        <Img src={staticFile("img/cube-excited.png")} style={{ position: "absolute", right: -150, bottom: 10, width: 230, transform: `translateY(${cubeY}px) rotate(${interpolate(cubeY, [-700, 0], [-40, 8])}deg)` }} />
      </div>
      <div style={{ marginTop: 10, transform: `scale(${Math.max(0, sTag)})`, background: C.coral, border: `8px solid ${C.ink}`, borderRadius: 999, boxShadow: `0 10px 0 ${C.ink}`, padding: "10px 48px 14px", fontFamily: "Fredoka", fontWeight: 700, fontSize: 66, color: "#fff", ...outline(9), letterSpacing: 2 }}>CATCH A PET. GIVE IT A LIFE.</div>
    </AbsoluteFill>
  );
}

// ------------------------------------------------------------------ main
export const Trailer: React.FC = () => {
  const v = vo as Record<string, { text: string; seconds: number }>;
  // Caption chunks spread over each line's duration, proportional to text length.
  const caps: Array<{ at: number; dur: number; text: string }> = [];
  for (const [id, at] of Object.entries(VO)) {
    const line = v[id]; if (!line) continue;
    const parts = CAPTION_SPLIT[id] ?? [line.text];
    const total = parts.reduce((s, p) => s + p.length, 0);
    let t = at;
    parts.forEach((p, i) => { const d = (line.seconds * p.length) / total; caps.push({ at: t, dur: i === parts.length - 1 ? d + 0.25 : d, text: p }); t += d; });
  }
  return (
    <AbsoluteFill style={{ background: C.ink }}>
      <style>{fontCss}</style>

      {SHOTS.map((s, i) => (
        <Sequence key={i} from={f(s.at)} durationInFrames={f(s.dur) + 1} layout="none">
          <AbsoluteFill><ShotView s={s} />{s.chip && <Chip text={s.chip} />}</AbsoluteFill>
        </Sequence>
      ))}
      {SHOTS.filter((s) => s.tr && s.tr !== "cut").map((s, i) => (
        <Sequence key={`tr${i}`} from={f(s.at)} durationInFrames={14} layout="none"><Transition kind={s.tr!} /></Sequence>
      ))}

      <Sequence from={f(S.hookEnd + 0.2)} durationInFrames={f(4.6)} layout="none"><Title /></Sequence>
      <Sequence from={f(85.0)} durationInFrames={f(12.3)} layout="none"><FlowOverlay /></Sequence>
      <Sequence from={f(S.s10 + 0.2)} durationInFrames={f(6.0)} layout="none"><LedgerOverlay /></Sequence>
      <Sequence from={f(S.s10)} durationInFrames={f(S.s11 - S.s10)} layout="none"><TestnetTag /></Sequence>
      <Sequence from={f(S.logo)} durationInFrames={f(S.end - S.logo)} layout="none"><Ending /></Sequence>

      {LABELS.map((l, i) => (
        <Sequence key={`l${i}`} from={f(l.at)} durationInFrames={f(l.dur)} layout="none"><Label text={l.text} color={l.color ?? "sun"} pos={l.pos} /></Sequence>
      ))}
      {caps.map((c, i) => (
        <Sequence key={`c${i}`} from={f(c.at)} durationInFrames={Math.max(1, f(c.dur))} layout="none"><Caption text={c.text} /></Sequence>
      ))}

      {/* Audio: music (ducked under narration), narration, sfx */}
      <Audio src={staticFile("audio/music.wav")} volume={(fr) => {
        const t = fr / FPS;
        const talking = Object.entries(VO).some(([id, at]) => v[id] && t >= at - 0.15 && t <= at + v[id].seconds + 0.1);
        return talking ? 0.32 : 0.62;
      }} />
      {Object.entries(VO).map(([id, at]) => v[id] && (
        <Sequence key={`v${id}`} from={f(at)} layout="none"><Audio src={staticFile(`vo/${id}.wav`)} volume={1.0} /></Sequence>
      ))}
      {SFX.map(([at, name, vol], i) => (
        <Sequence key={`s${i}`} from={f(at)} layout="none"><Audio src={staticFile(`sfx/${name}.wav`)} volume={vol * 0.55} /></Sequence>
      ))}
    </AbsoluteFill>
  );
};
