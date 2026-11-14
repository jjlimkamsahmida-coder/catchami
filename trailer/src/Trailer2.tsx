import React from "react";
import { AbsoluteFill, Audio, Img, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { AUTO_ROWS, CALLOUTS, CAPTION_SPLIT, FPS, LABELS, SFX, SHOTS, TOTAL, VO, type Callout, type Shot } from "./timeline2";
import { ActivityPanel, Backdrop, C, CardReveal, EconomyLoop, fontCss } from "./Scenes";
import vo from "./vo.json";

const f = (s: number) => Math.round(s * FPS);
const ease = Easing.bezier(0.33, 0, 0.2, 1);
const stroke = (w: number) => ({ WebkitTextStroke: `${w}px ${C.ink}`, paintOrder: "stroke fill" as const });
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

function Footage({ s }: { s: Shot }) {
  const frame = useCurrentFrame();
  const p = Math.min(1, frame / FPS / s.dur);
  const [z0, z1] = s.zoom ?? [1, 1], z = z0 + (z1 - z0) * ease(p);
  const [fx, fy] = s.focus ?? [0.5, 0.5];
  const media = s.src.startsWith("IMG:")
    ? <Img src={staticFile(`img/${s.src.slice(4)}.png`)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    : <OffthreadVideo src={staticFile(`f2/${s.src}.mp4`)} trimBefore={Math.round(s.from * 60)} playbackRate={s.rate ?? 1} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />;
  // the tablet catch is 4:3 — show it whole, centred on a soft blurred copy
  if (s.src === "catch2") {
    return (
      <AbsoluteFill style={{ background: C.ink }}>
        <div style={{ position: "absolute", inset: -60, filter: "blur(30px) brightness(.55)" }}>{media}</div>
        <div style={{ position: "absolute", left: 240, top: 0, width: 1440, height: 1080, borderLeft: `8px solid ${C.ink}`, borderRight: `8px solid ${C.ink}`, overflow: "hidden" }}>{media}</div>
      </AbsoluteFill>
    );
  }
  return <AbsoluteFill style={{ overflow: "hidden", background: C.ink }}><div style={{ width: "100%", height: "100%", transform: `scale(${z})`, transformOrigin: `${fx * 100}% ${fy * 100}%` }}>{media}</div>{s.chip && <div style={{ position: "absolute", right: 40, bottom: 170, background: C.ink, color: C.sun, fontFamily: "Fredoka", fontWeight: 700, fontSize: 30, padding: "6px 16px", borderRadius: 999, border: `4px solid ${C.sun}` }}>⏩ {s.chip}</div>}</AbsoluteFill>;
}

function Fade({ children }: { children: React.ReactNode }) {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{ opacity: interpolate(frame, [0, 5], [0, 1], { extrapolateRight: "clamp" }) }}>{children}</AbsoluteFill>;
}

function CalloutCard({ c }: { c: Callout }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const sIn = spring({ frame, fps: FPS, config: { damping: 13 } });
  const out = interpolate(frame, [durationInFrames - 6, durationInFrames], [1, 0], { extrapolateLeft: "clamp" });
  const [a0, a1] = c.anim ?? [0.3, c.dur - 0.5];
  const p = interpolate(frame, [a0 * FPS, a1 * FPS], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  return (
    <div style={{ position: "absolute", left: c.side === "right" ? undefined : 50, right: c.side === "right" ? 50 : undefined, top: 140, width: 560, opacity: out, transform: `translateX(${(1 - sIn) * -420}px)`, background: "rgba(255,246,229,.97)", border: `7px solid ${C.ink}`, borderRadius: 30, boxShadow: `0 10px 0 ${C.ink}`, padding: "16px 24px", fontFamily: "Fredoka", color: C.ink }}>
      {c.title && <div style={{ fontSize: 36, fontWeight: 700, marginBottom: 6 }}>{c.title}</div>}
      {c.rows.map((r) => {
        const v = r.from !== undefined && r.to !== undefined ? r.from + (r.to - r.from) * p : null;
        const up = r.to !== undefined && r.from !== undefined && r.to > r.from;
        const col = r.good ?? up ? "#3fae5a" : "#e2554b";
        return (
          <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 14, padding: "7px 0", borderTop: "2px dashed rgba(43,29,58,.14)" }}>
            {r.icon.endsWith(".png") ? <Img src={staticFile(`img/${r.icon}`)} style={{ width: 44 }} /> : <span style={{ fontSize: 38, width: 44, textAlign: "center" }}>{r.icon}</span>}
            <span style={{ fontSize: 30, fontWeight: 600, flex: 1 }}>{r.label}</span>
            <span style={{ fontSize: 40, fontWeight: 700, color: p > 0.02 ? col : C.ink }}>{v !== null ? fmt(v) : ""}{r.text ? ` ${r.text}` : ""}</span>
          </div>
        );
      })}
    </div>
  );
}

function Caption({ text }: { text: string }) {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 4], [0, 1], { extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 56, display: "flex", justifyContent: "center", opacity: o }}>
      <div style={{ maxWidth: 1560, textAlign: "center", fontFamily: "Fredoka", fontWeight: 600, fontSize: 54, lineHeight: 1.15, color: "#fff", ...stroke(11), textShadow: "0 5px 0 rgba(43,29,58,.55)" }}>{text}</div>
    </div>
  );
}

function Label({ text, color }: { text: string; color: string }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const sIn = spring({ frame, fps: FPS, config: { damping: 11, mass: 0.6 } });
  const out = interpolate(frame, [durationInFrames - 6, durationInFrames], [1, 0], { extrapolateLeft: "clamp" });
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 60, display: "flex", justifyContent: "center", opacity: out }}>
      <div style={{ transform: `scale(${sIn * out}) rotate(-2deg)`, background: (C as Record<string, string>)[color], border: `7px solid ${C.ink}`, borderRadius: 26, boxShadow: `0 10px 0 ${C.ink}`, padding: "8px 38px 12px", fontFamily: "Fredoka", fontWeight: 700, fontSize: 74, color: "#fff", ...stroke(9), letterSpacing: 2 }}>{text}</div>
    </div>
  );
}

function Title() {
  const frame = useCurrentFrame();
  const s1 = spring({ frame, fps: FPS, config: { damping: 9, mass: 0.8 } }), s2 = spring({ frame: frame - 12, fps: FPS, config: { damping: 12 } });
  const { durationInFrames } = useVideoConfig();
  const out = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], { extrapolateLeft: "clamp" });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: out }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 50% 45%, rgba(255,246,229,.5), rgba(43,29,58,.25) 75%)" }} />
      <Img src={staticFile("img/logo.png")} style={{ width: 1000, transform: `scale(${s1}) rotate(${(1 - s1) * -10}deg)`, filter: "drop-shadow(0 14px 0 rgba(43,29,58,.6))" }} />
      <div style={{ marginTop: -6, transform: `scale(${Math.max(0, s2)})`, background: C.sun, border: `7px solid ${C.ink}`, borderRadius: 999, boxShadow: `0 9px 0 ${C.ink}`, padding: "8px 40px 12px", fontFamily: "Fredoka", fontWeight: 700, fontSize: 58, color: C.ink, letterSpacing: 4 }}>A LIVING ANIMAL ECONOMY</div>
    </AbsoluteFill>
  );
}

function Demand() {
  // Real demand indices before/after (from /api/economy around the recordings) + Tom's live fish price.
  const frame = useCurrentFrame();
  const sIn = spring({ frame, fps: FPS, config: { damping: 13 } });
  const rows = [["icon-fish.png", "Fish", "eaten in meals"], ["icon-herbs.png", "Herbs", "used for medicine"], ["icon-wood.png", "Wood", "used for crafting"], ["icon-minerals.png", "Stone", "used for crafting"]];
  return (
    <div style={{ position: "absolute", right: 50, top: 150, width: 600, transform: `translateX(${(1 - sIn) * 520}px)`, background: "rgba(255,246,229,.97)", border: `7px solid ${C.ink}`, borderRadius: 30, boxShadow: `0 10px 0 ${C.ink}`, padding: "16px 24px", fontFamily: "Fredoka", color: C.ink }}>
      <div style={{ fontSize: 34, fontWeight: 700, marginBottom: 4 }}>What drives demand</div>
      {rows.map(([ic, name, why], i) => (
        <div key={name} style={{ display: "flex", alignItems: "center", gap: 14, padding: "8px 0", borderTop: "2px dashed rgba(43,29,58,.14)", opacity: interpolate(frame, [6 + i * 6, 12 + i * 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
          <Img src={staticFile(`img/${ic}`)} style={{ width: 46 }} /><b style={{ fontSize: 32, width: 110 }}>{name}</b><span style={{ fontSize: 28, fontWeight: 500, color: C.inkSoft }}>{why}</span>
        </div>
      ))}
      <div style={{ marginTop: 10, fontSize: 28, fontWeight: 600, background: "#fff", border: `4px solid ${C.ink}`, borderRadius: 16, padding: "8px 14px" }}>More use → higher demand → merchants pay more. Each merchant has a limited purse and cart.</div>
    </div>
  );
}

function HQBadge() {
  const frame = useCurrentFrame();
  const sIn = spring({ frame, fps: FPS, config: { damping: 13 } });
  const items = [["🏰", "HQ treasury", "39.9T"], ["📈", "Avg. revenue / day", "366K"], ["🧺", "Today's merchant budget", "3.8B"], ["🛟", "Protected reserve", "2T"]];
  return (
    <div style={{ position: "absolute", left: 30, top: 150, width: 520, transform: `translateX(${(1 - sIn) * -560}px)`, background: "rgba(255,246,229,.97)", border: `7px solid ${C.ink}`, borderRadius: 30, boxShadow: `0 10px 0 ${C.ink}`, padding: "16px 24px", fontFamily: "Fredoka", color: C.ink }}>
      <div style={{ fontSize: 34, fontWeight: 700, marginBottom: 4 }}>HQ sets the budget</div>
      {items.map(([i, a, b], k) => (
        <div key={a} style={{ display: "flex", alignItems: "center", gap: 14, padding: "8px 0", borderTop: "2px dashed rgba(43,29,58,.14)", opacity: interpolate(frame, [6 + k * 7, 12 + k * 7], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
          <span style={{ fontSize: 38 }}>{i}</span><span style={{ fontSize: 30, fontWeight: 600, flex: 1 }}>{a}</span><b style={{ fontSize: 40 }}>{b}</b>
        </div>
      ))}
    </div>
  );
}

function Proof() {
  const frame = useCurrentFrame();
  const half = 3.4 * FPS;
  const which = frame < half ? 0 : 1, lf = which ? frame - half : frame;
  const s = spring({ frame: lf, fps: FPS, config: { damping: 13 } });
  const img = which ? "v2-settle-crop.png" : "v2-mint-crop.png";
  const title = which ? "SETTLE BATCH #43" : "NFT MINT";
  const sub = which ? "Merchants −15,171.6 → Noodle's vault +15,171.6" : "Noodle · token a-pet_WG8tnXnT29bJ";
  const w = which ? 1000 : 1560;
  return (
    <AbsoluteFill>
      <Backdrop tint={C.plum} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 70, display: "flex", flexDirection: "column", alignItems: "center", transform: `scale(${0.92 + 0.08 * s})`, opacity: s }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 14 }}>
          <span style={{ background: C.plum, border: `6px solid ${C.ink}`, borderRadius: 16, padding: "2px 20px 8px", fontFamily: "Fredoka", fontWeight: 700, fontSize: 52, color: "#fff", ...stroke(7) }}>{title}</span>
          <span style={{ fontFamily: "Fredoka", fontWeight: 600, fontSize: 36, color: C.ink, background: "rgba(255,255,255,.85)", padding: "4px 14px", borderRadius: 12 }}>{sub}</span>
        </div>
        <div style={{ width: w, border: `8px solid ${C.ink}`, borderRadius: 26, overflow: "hidden", boxShadow: `0 12px 0 ${C.ink}`, background: "#fff" }}><Img src={staticFile(`img/${img}`)} style={{ width: "100%", display: "block" }} /></div>
      </div>
      <div style={{ position: "absolute", right: 40, top: 22, background: "rgba(43,29,58,.9)", color: "#fff", fontFamily: "Fredoka", fontWeight: 600, fontSize: 26, padding: "6px 16px", borderRadius: 12, border: `3px solid ${C.leaf}` }}>NEAR testnet · game.catchami-dev.testnet</div>
    </AbsoluteFill>
  );
}

function Ending() {
  const frame = useCurrentFrame();
  const sLogo = spring({ frame: frame - 6, fps: FPS, config: { damping: 8, mass: 0.9 } });
  const cubeY = interpolate(spring({ frame: frame - 16, fps: FPS, config: { damping: 7, mass: 0.6 } }), [0, 1], [-700, 0]);
  const sTag = spring({ frame: frame - 32, fps: FPS, config: { damping: 12 } });
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 42%, ${C.paper} 0%, ${C.sun} 55%, ${C.sunDark} 100%)`, alignItems: "center", justifyContent: "center" }}>
      <style>{fontCss}</style>
      <AbsoluteFill style={{ opacity: 0.5 }}>{Array.from({ length: 16 }, (_, i) => <div key={i} style={{ position: "absolute", left: "50%", top: "42%", width: 3000, height: 90, background: i % 2 ? "rgba(255,255,255,.35)" : "transparent", transformOrigin: "0 50%", transform: `rotate(${i * 22.5 + frame * 0.6}deg)` }} />)}</AbsoluteFill>
      <div style={{ position: "relative", marginTop: -60 }}>
        <Img src={staticFile("img/logo.png")} style={{ width: 1040, transform: `scale(${Math.max(0, sLogo)})`, filter: "drop-shadow(0 16px 0 rgba(43,29,58,.55))" }} />
        <Img src={staticFile("img/cube-excited.png")} style={{ position: "absolute", right: -150, bottom: 10, width: 230, transform: `translateY(${cubeY}px) rotate(${interpolate(cubeY, [-700, 0], [-40, 8])}deg)` }} />
      </div>
      <div style={{ marginTop: 10, transform: `scale(${Math.max(0, sTag)})`, background: C.coral, border: `8px solid ${C.ink}`, borderRadius: 999, boxShadow: `0 10px 0 ${C.ink}`, padding: "10px 48px 14px", fontFamily: "Fredoka", fontWeight: 700, fontSize: 66, color: "#fff", ...stroke(9), letterSpacing: 2 }}>CATCH A PET. GIVE IT A LIFE.</div>
    </AbsoluteFill>
  );
}

const scenes: Record<string, () => React.ReactElement> = {
  card: () => <CardReveal card="noodle-card.png" cardW={572} cardH={806} walletBox={[36, 694, 500, 52]} wallet={400000} rarity="Mythic" />,
  loop: () => <EconomyLoop petSticker="noodle-sticker.png" perStep={1.55} amounts={{ 1: "+6,048", 3: "7,000" }} />,
  proof: () => <Proof />,
  end: () => <Ending />,
};

export const Trailer2: React.FC = () => {
  const v = vo as Record<string, { text: string; seconds: number }>;
  const caps: Array<{ at: number; dur: number; text: string }> = [];
  for (const [id, at] of Object.entries(VO)) {
    const line = v[id]; if (!line) continue;
    const parts = CAPTION_SPLIT[id] ?? [line.text];
    const total = parts.reduce((s, p) => s + p.length, 0); let t = at;
    parts.forEach((p, i) => { const d = (line.seconds * p.length) / total; caps.push({ at: t, dur: i === parts.length - 1 ? d + 0.3 : d, text: p }); t += d; });
  }
  caps.sort((a, b) => a.at - b.at);
  for (let i = 0; i < caps.length - 1; i++) caps[i]!.dur = Math.min(caps[i]!.dur, caps[i + 1]!.at - caps[i]!.at - 0.02);
  return (
    <AbsoluteFill style={{ background: C.ink }}>
      <style>{fontCss}</style>
      {SHOTS.map((s, i) => (
        <Sequence key={i} from={f(s.at)} durationInFrames={f(s.dur) + 1} layout="none">
          {i > 0 && s.src.startsWith("SCENE:") ? <Fade>{scenes[s.src.slice(6)]!()}</Fade> : s.src.startsWith("SCENE:") ? scenes[s.src.slice(6)]!() : <Footage s={s} />}
        </Sequence>
      ))}
      <Sequence from={f(0.4)} durationInFrames={f(4.1)} layout="none"><Title /></Sequence>
      {CALLOUTS.map((c, i) => <Sequence key={`co${i}`} from={f(c.at)} durationInFrames={f(c.dur)} layout="none"><CalloutCard c={c} /></Sequence>)}
      <Sequence from={f(37.2)} durationInFrames={f(5.1)} layout="none"><Demand /></Sequence>
      <Sequence from={f(46.3)} durationInFrames={f(4.1)} layout="none"><HQBadge /></Sequence>
      <Sequence from={f(71.8)} durationInFrames={f(12.2)} layout="none">
        <ActivityPanel rows={AUTO_ROWS} speed={1} offset={0} map={[[0, 2, 16], [4.8, 122, 2.2], [8.8, 131, 10]]} />
      </Sequence>
      {LABELS.map((l, i) => <Sequence key={`l${i}`} from={f(l.at)} durationInFrames={f(l.dur)} layout="none"><Label text={l.text} color={l.color} /></Sequence>)}
      {caps.map((c, i) => <Sequence key={`c${i}`} from={f(c.at)} durationInFrames={Math.max(1, f(c.dur))} layout="none"><Caption text={c.text} /></Sequence>)}

      <Audio src={staticFile("audio/music2.wav")} volume={(fr) => { const t = fr / FPS; const talking = Object.entries(VO).some(([id, at]) => v[id] && t >= at - 0.15 && t <= at + v[id].seconds + 0.1); const fade = Math.min(1, Math.max(0, (TOTAL - t) / 1.2)); return (talking ? 0.3 : 0.6) * fade; }} />
      {Object.entries(VO).map(([id, at]) => v[id] && <Sequence key={`v${id}`} from={f(at)} layout="none"><Audio src={staticFile(`vo/${id}.wav`)} /></Sequence>)}
      {SFX.map(([at, name, vol], i) => <Sequence key={`s${i}`} from={f(at)} layout="none"><Audio src={staticFile(`sfx/${name}.wav`)} volume={vol * 0.55} /></Sequence>)}
    </AbsoluteFill>
  );
};
export const TOTAL2 = TOTAL;
