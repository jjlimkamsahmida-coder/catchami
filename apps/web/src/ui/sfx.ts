/**
 * Tiny synthesized sound effects (placeholder audio — replace with final SFX
 * files later). WebAudio only starts after the first user gesture.
 */
let ctx: AudioContext | null = null;
let muted = (() => { try { return localStorage.getItem("catchami.muted") === "1"; } catch { return false; } })();

function ac(): AudioContext | null {
  if (muted) return null;
  try { ctx ??= new AudioContext(); if (ctx.state === "suspended") void ctx.resume(); return ctx; } catch { return null; }
}

function tone(freq: number, dur: number, type: OscillatorType = "sine", vol = 0.12, slideTo?: number) {
  const a = ac(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, a.currentTime);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, a.currentTime + dur);
  g.gain.setValueAtTime(vol, a.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + dur);
}

function noise(dur: number, vol = 0.1, hp = 800) {
  const a = ac(); if (!a) return;
  const b = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  s.buffer = b; f.type = "highpass"; f.frequency.value = hp; g.gain.value = vol;
  s.connect(f).connect(g).connect(a.destination); s.start();
}

export const sfx = {
  chop: () => { noise(0.08, 0.18, 400); tone(160, 0.12, "triangle", 0.12, 90); },
  clink: () => { tone(1320, 0.18, "square", 0.05, 1100); tone(1980, 0.12, "sine", 0.05); },
  splash: () => { noise(0.25, 0.14, 1500); tone(520, 0.2, "sine", 0.06, 220); },
  pluck: () => { tone(300, 0.08, "triangle", 0.12, 620); noise(0.05, 0.06, 2500); },
  perfect: () => { tone(880, 0.09, "sine", 0.08); setTimeout(() => tone(1320, 0.14, "sine", 0.08), 80); },
  miss: () => tone(220, 0.18, "triangle", 0.07, 150),
  pop: () => { tone(900, 0.06, "sine", 0.1, 400); },
  puff: () => noise(0.18, 0.06, 3000),
  whirr: () => tone(260, 0.35, "triangle", 0.05, 520),
  win: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.16, "triangle", 0.08), i * 90)),
  tick: () => tone(1500, 0.03, "square", 0.025),
  whoosh: () => { noise(0.3, 0.08, 1800); tone(400, 0.3, "sine", 0.04, 900); },
  bad: () => { tone(330, 0.14, "triangle", 0.08, 220); setTimeout(() => tone(220, 0.2, "triangle", 0.08, 160), 110); },
  type: () => tone(700 + Math.random() * 300, 0.025, "square", 0.018),
  /** Cube rattle; level 0..2 gets louder and busier. */
  shake: (level = 0) => { for (let i = 0; i < 3 + level; i++) setTimeout(() => { tone(180 + level * 40 + Math.random() * 60, 0.06, "square", 0.05 + level * 0.025, 120); noise(0.05, 0.05 + level * 0.03, 1200); }, i * (110 - level * 15)); },
  click: () => { tone(1600, 0.05, "square", 0.09); setTimeout(() => tone(2200, 0.08, "square", 0.07), 60); },
  fanfare: () => [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => setTimeout(() => tone(f, i === 6 ? 0.45 : 0.14, "triangle", 0.09), [0, 110, 220, 330, 480, 560, 660][i])),
  escape: () => { noise(0.35, 0.12, 900); tone(520, 0.22, "triangle", 0.08, 260); setTimeout(() => tone(330, 0.3, "triangle", 0.07, 180), 220); },
  sparkle: () => [1320, 1760, 2093].forEach((f, i) => setTimeout(() => tone(f, 0.12, "sine", 0.05), i * 70)),
  get muted() { return muted; },
  toggle() { muted = !muted; try { localStorage.setItem("catchami.muted", muted ? "1" : "0"); } catch {} return muted; },
};
