// Trailer sound effects, rendered offline with the same tone/noise recipes the game uses
// (apps/web/src/ui/sfx.ts), plus a few extras. Output: public/sfx/*.wav (48 kHz mono).
import { writeFileSync, mkdirSync } from "node:fs";
const SR = 48000;
let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function mk(len) { return new Float32Array(Math.ceil(SR * len)); }
function osc(type, ph) {
  const p = ph / (2 * Math.PI) % 1;
  if (type === "sine") return Math.sin(ph);
  if (type === "square") return p < 0.5 ? 0.7 : -0.7;
  if (type === "triangle") return 4 * Math.abs(p - 0.5) - 1;
  return 2 * p - 1;
}
// tone(): oscillator with exponential pitch slide and exponential gain decay, like the game.
function tone(buf, at, freq, dur, type = "sine", vol = 0.12, slideTo) {
  let ph = 0; const i0 = Math.round(at * SR), n = Math.round(dur * SR);
  for (let i = 0; i < n && i0 + i < buf.length; i++) {
    const t = i / n, f = slideTo ? freq * Math.pow(slideTo / freq, t) : freq;
    ph += 2 * Math.PI * f / SR;
    buf[i0 + i] += osc(type, ph) * vol * Math.pow(0.0001 / vol, t) * Math.min(1, i / 48);
  }
}
// noise(): decaying white noise through a one-pole high-pass.
function noise(buf, at, dur, vol = 0.1, hp = 800) {
  const i0 = Math.round(at * SR), n = Math.round(dur * SR), a = Math.exp(-2 * Math.PI * hp / SR);
  let y = 0, px = 0;
  for (let i = 0; i < n && i0 + i < buf.length; i++) { const x = (rnd() * 2 - 1) * (1 - i / n); y = a * (y + x - px); px = x; buf[i0 + i] += y * vol; }
}
function save(name, buf, gain = 2.2) {
  let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v));
  const g = Math.min(gain, 0.89 / Math.max(peak, 1e-6));
  const b = Buffer.alloc(44 + buf.length * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + buf.length * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(buf.length * 2, 40);
  buf.forEach((v, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * g)) * 32767), 44 + i * 2));
  writeFileSync(`public/sfx/${name}.wav`, b);
}
mkdirSync("public/sfx", { recursive: true });

const R = {
  // From the game:
  chop: (b) => { noise(b, 0, 0.08, 0.18, 400); tone(b, 0, 160, 0.12, "triangle", 0.12, 90); },
  clink: (b) => { tone(b, 0, 1320, 0.18, "square", 0.05, 1100); tone(b, 0, 1980, 0.12, "sine", 0.05); },
  splash: (b) => { noise(b, 0, 0.25, 0.14, 1500); tone(b, 0, 520, 0.2, "sine", 0.06, 220); },
  pluck: (b) => { tone(b, 0, 300, 0.08, "triangle", 0.12, 620); noise(b, 0, 0.05, 0.06, 2500); },
  perfect: (b) => { tone(b, 0, 880, 0.09, "sine", 0.08); tone(b, 0.08, 1320, 0.14, "sine", 0.08); },
  pop: (b) => tone(b, 0, 900, 0.06, "sine", 0.1, 400),
  puff: (b) => noise(b, 0, 0.18, 0.06, 3000),
  whirr: (b) => tone(b, 0, 260, 0.35, "triangle", 0.05, 520),
  win: (b) => [523, 659, 784, 1046].forEach((f, i) => tone(b, i * 0.09, f, 0.16, "triangle", 0.08)),
  tick: (b) => tone(b, 0, 1500, 0.03, "square", 0.025),
  whoosh: (b) => { noise(b, 0, 0.3, 0.08, 1800); tone(b, 0, 400, 0.3, "sine", 0.04, 900); },
  click: (b) => { tone(b, 0, 1600, 0.05, "square", 0.09); tone(b, 0.06, 2200, 0.08, "square", 0.07); },
  fanfare: (b) => [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => tone(b, [0, 0.11, 0.22, 0.33, 0.48, 0.56, 0.66][i], f, i === 6 ? 0.45 : 0.14, "triangle", 0.09)),
  sparkle: (b) => [1320, 1760, 2093].forEach((f, i) => tone(b, i * 0.07, f, 0.12, "sine", 0.05)),
  shake: (b) => { for (let i = 0; i < 4; i++) { tone(b, i * 0.095, 220 + rnd() * 60, 0.06, "square", 0.075, 120); noise(b, i * 0.095, 0.05, 0.08, 1200); } },
  // Extras for the trailer:
  coin: (b) => { tone(b, 0, 1568, 0.22, "sine", 0.1); tone(b, 0.0, 2350, 0.18, "sine", 0.05); tone(b, 0.07, 2093, 0.3, "sine", 0.09); tone(b, 0.07, 3136, 0.2, "sine", 0.04); },
  coins: (b) => { for (let i = 0; i < 9; i++) { const f = 1500 + rnd() * 900; tone(b, i * 0.055, f, 0.15, "sine", 0.07); tone(b, i * 0.055, f * 1.5, 0.1, "sine", 0.03); } },
  spend: (b) => { [1046, 880, 698].forEach((f, i) => tone(b, i * 0.07, f, 0.14, "triangle", 0.07)); noise(b, 0, 0.06, 0.05, 3000); },
  throw: (b) => { noise(b, 0, 0.35, 0.12, 1200); tone(b, 0, 300, 0.35, "sine", 0.06, 1200); },
  catch: (b) => { tone(b, 0, 600, 0.08, "sine", 0.12, 1200); tone(b, 0.07, 1200, 0.25, "triangle", 0.08, 1800); noise(b, 0.05, 0.12, 0.06, 4000); [1568, 2093, 2637].forEach((f, i) => tone(b, 0.18 + i * 0.06, f, 0.25, "sine", 0.06)); },
  reveal: (b) => { for (let i = 0; i < 12; i++) tone(b, i * 0.035, 900 + i * 140, 0.3, "sine", 0.035); [523, 659, 784, 1046].forEach((f) => tone(b, 0.42, f, 0.9, "triangle", 0.05)); },
  bubblepop: (b) => { tone(b, 0, 400, 0.05, "sine", 0.14, 1400); noise(b, 0.02, 0.08, 0.08, 3500); },
  bigsplash: (b) => { noise(b, 0, 0.6, 0.22, 900); noise(b, 0.05, 0.4, 0.12, 3000); tone(b, 0, 380, 0.5, "sine", 0.1, 120); for (let i = 0; i < 6; i++) tone(b, 0.15 + i * 0.07, 900 + rnd() * 1200, 0.06, "sine", 0.05, 1800); },
  spin: (b) => { for (let i = 0; i < 10; i++) tone(b, i * 0.045, 900 - i * 30, 0.03, "square", 0.04); },
  cash: (b) => { tone(b, 0, 2093, 0.08, "square", 0.05); tone(b, 0.08, 2637, 0.4, "sine", 0.09); for (let i = 0; i < 6; i++) tone(b, 0.12 + i * 0.05, 1500 + rnd() * 900, 0.12, "sine", 0.05); },
  craft: (b) => { tone(b, 0, 220, 0.12, "square", 0.07, 160); noise(b, 0, 0.06, 0.1, 2000); tone(b, 0.18, 220, 0.12, "square", 0.07, 160); noise(b, 0.18, 0.06, 0.1, 2000); [1046, 1318, 1568, 2093].forEach((f, i) => tone(b, 0.38 + i * 0.06, f, 0.3, "sine", 0.06)); },
  autopilot: (b) => { tone(b, 0, 660, 0.12, "sine", 0.08); tone(b, 0.12, 990, 0.12, "sine", 0.08); tone(b, 0.24, 1320, 0.3, "sine", 0.07); tone(b, 0, 330, 0.5, "triangle", 0.04, 660); },
  swoosh: (b) => { noise(b, 0, 0.4, 0.1, 600); tone(b, 0, 200, 0.4, "sine", 0.05, 700); },
  boing: (b) => tone(b, 0, 180, 0.35, "sine", 0.12, 520),
  stamp: (b) => { tone(b, 0, 120, 0.18, "sine", 0.18, 60); noise(b, 0, 0.08, 0.12, 600); },
};
const LEN = { fanfare: 1.2, reveal: 1.4, bigsplash: 0.9, autopilot: 0.7, craft: 0.8, cash: 0.6, coins: 0.7, catch: 0.6, win: 0.6, shake: 0.5, spin: 0.6 };
for (const [name, fn] of Object.entries(R)) { const b = mk(LEN[name] ?? 0.5); fn(b); save(name, b); }
console.log(Object.keys(R).length, "sfx written");
