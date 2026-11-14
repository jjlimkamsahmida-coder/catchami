// Original soundtrack for the Catchami trailer, synthesized from scratch (no samples, no borrowed melodies).
// 120 BPM, C major, sections timed to the trailer's scenes. Output: public/audio/music.wav (48 kHz stereo).
import { writeFileSync, mkdirSync } from "node:fs";

const SR = 48000, BPM = 120, BEAT = 60 / BPM, LEN = 110;
const N = Math.ceil(SR * LEN);
const L = new Float32Array(N), R = new Float32Array(N);       // dry bus
const RL = new Float32Array(N), RR = new Float32Array(N);     // reverb send
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const nn = (s) => { const m = /^([A-G])(#|b)?(\d)$/.exec(s); return 12 * (+m[3] + 1) + NOTE[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0); };

function add(t, buf, gain = 1, pan = 0, verb = 0.2) {
  const i0 = Math.round(t * SR), gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4);
  for (let i = 0; i < buf.length; i++) {
    const j = i0 + i; if (j < 0 || j >= N) continue;
    const v = buf[i];
    L[j] += v * gl; R[j] += v * gr; RL[j] += v * gl * verb; RR[j] += v * gr * verb;
  }
}
const env = (i, a, d, total) => { const t = i / SR; if (t < a) return t / a; return Math.exp(-(t - a) / d) * (t < total ? 1 : Math.max(0, 1 - (t - total) / 0.05)); };

// ---------------------------------------------------------------- instruments
function marimba(f, dur = 0.6) {
  const n = Math.floor(SR * (dur + 0.4)), b = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / SR;
    b[i] = (Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.45) + 0.35 * Math.sin(2 * Math.PI * f * 3.93 * t) * Math.exp(-t / 0.08) + 0.12 * Math.sin(2 * Math.PI * f * 9.2 * t) * Math.exp(-t / 0.03)) * Math.min(1, t / 0.002); }
  return b;
}
function glock(f, dur = 1.2) {
  const n = Math.floor(SR * dur), b = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / SR;
    b[i] = (Math.sin(2 * Math.PI * f * t) + 0.45 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t / 0.25) + 0.2 * Math.sin(2 * Math.PI * f * 5.4 * t) * Math.exp(-t / 0.1)) * Math.exp(-t / 0.55) * Math.min(1, t / 0.001); }
  return b;
}
function pluck(f, dur = 0.5, bright = 0.5) { // Karplus–Strong
  const n = Math.floor(SR * (dur + 0.3)), b = new Float32Array(n), p = Math.max(2, Math.round(SR / f)), d = new Float32Array(p);
  for (let i = 0; i < p; i++) d[i] = rnd() * 2 - 1;
  let k = 0, last = 0;
  for (let i = 0; i < n; i++) { const v = d[k]; const nx = (v + d[(k + 1) % p]) * 0.5 * (0.994 - (1 - bright) * 0.01); d[k] = nx * 0.6 + last * 0.4 * bright + nx * 0.4 * (1 - bright); last = nx; b[i] = v * (i / SR < dur ? 1 : Math.max(0, 1 - (i / SR - dur) / 0.08)); k = (k + 1) % p; }
  return b;
}
function flute(f, dur) {
  const n = Math.floor(SR * (dur + 0.15)), b = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR, vib = t > 0.12 ? 1 + 0.006 * Math.sin(2 * Math.PI * 5.2 * t) : 1;
    ph += 2 * Math.PI * f * vib / SR;
    const a = Math.min(1, t / 0.04) * (t < dur ? 1 : Math.max(0, 1 - (t - dur) / 0.12));
    b[i] = a * (Math.sin(ph) + 0.18 * Math.sin(2 * ph) + 0.05 * Math.sin(3 * ph) + 0.02 * (rnd() * 2 - 1)); }
  return b;
}
function pad(freqs, dur, bright = 0.3) {
  const n = Math.floor(SR * (dur + 0.6)), b = new Float32Array(n);
  for (const f0 of freqs) for (const det of [-0.004, 0, 0.005]) {
    const f = f0 * (1 + det); let lp = 0;
    for (let i = 0; i < n; i++) { const t = i / SR; let s = 0; for (let h = 1; h <= 6; h++) s += Math.sin(2 * Math.PI * f * h * t) / h;
      lp += (s - lp) * bright; const a = Math.min(1, t / 0.35) * (t < dur ? 1 : Math.max(0, 1 - (t - dur) / 0.55)); b[i] += lp * a * 0.12; }
  }
  return b;
}
function brass(freqs, dur) {
  const n = Math.floor(SR * (dur + 0.3)), b = new Float32Array(n);
  for (const f of freqs) { let lp = 0;
    for (let i = 0; i < n; i++) { const t = i / SR; let s = 0; for (let h = 1; h <= 9; h++) s += Math.sin(2 * Math.PI * f * h * t) / h;
      const cut = 0.08 + 0.25 * Math.exp(-t / 0.25); lp += (s - lp) * cut;
      const a = Math.min(1, t / 0.05) * (t < dur ? 1 : Math.max(0, 1 - (t - dur) / 0.25)); b[i] += lp * a * 0.22; } }
  return b;
}
function kick() { const n = Math.floor(SR * 0.35), b = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR, f = 45 + 95 * Math.exp(-t / 0.04); ph += 2 * Math.PI * f / SR; b[i] = Math.sin(ph) * Math.exp(-t / 0.13) * 1.1; } return b; }
function snare(g = 1) { const n = Math.floor(SR * 0.22), b = new Float32Array(n); let hp = 0, prev = 0;
  for (let i = 0; i < n; i++) { const t = i / SR, w = rnd() * 2 - 1; hp = 0.85 * (hp + w - prev); prev = w; b[i] = g * (hp * 0.55 * Math.exp(-t / 0.06) + 0.35 * Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t / 0.05)); } return b; }
function hat(len = 0.04, g = 0.25) { const n = Math.floor(SR * len * 3), b = new Float32Array(n); let prev = 0, hp = 0;
  for (let i = 0; i < n; i++) { const t = i / SR, w = rnd() * 2 - 1; hp = 0.6 * (hp + w - prev); prev = w; b[i] = hp * g * Math.exp(-t / len); } return b; }
function wood(f = 900) { const n = Math.floor(SR * 0.12), b = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / SR; b[i] = Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.025) * 0.6; } return b; }
function timpani(f = 65) { const n = Math.floor(SR * 1.4), b = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / SR; b[i] = (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(2 * Math.PI * f * 1.5 * t)) * Math.exp(-t / 0.45) * 0.8 + (rnd() * 2 - 1) * 0.15 * Math.exp(-t / 0.03); } return b; }
function crash(len = 1.6, g = 0.35) { const n = Math.floor(SR * len), b = new Float32Array(n); let prev = 0, hp = 0;
  for (let i = 0; i < n; i++) { const t = i / SR, w = rnd() * 2 - 1; hp = 0.75 * (hp + w - prev); prev = w; b[i] = hp * g * Math.exp(-t / (len / 3)); } return b; }
function wah(f0, f1, dur) { const n = Math.floor(SR * dur), b = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR, f = f0 * Math.pow(f1 / f0, t / dur); ph += 2 * Math.PI * f / SR; b[i] = (Math.sin(ph) + 0.3 * Math.sin(2 * ph)) * Math.min(1, t / 0.02) * Math.max(0, 1 - t / dur) * 0.5; } return b; }

// ---------------------------------------------------------------- harmony & melody
const CH = { C: ["C", "E", "G"], G: ["G", "B", "D"], Am: ["A", "C", "E"], F: ["F", "A", "C"], Em: ["E", "G", "B"], Dm: ["D", "F", "A"], E: ["E", "G#", "B"] };
const chordNotes = (c, oct) => CH[c].map((n, i) => midi(nn(`${n}${oct + (i > 0 && NOTE[n[0]] < NOTE[CH[c][0][0]] ? 1 : 0)}`)));
const PROG_A = ["C", "G", "Am", "F"], PROG_B = ["F", "G", "Em", "Am"], PROG_T = ["F", "G", "C", "Am"];
// Original motif, 8th notes per bar ("-" = rest). Written for this trailer.
const MEL = {
  C: ["E5", "G5", "C6", "B5", "G5", "-", "E5", "-"],
  G: ["D5", "G5", "B5", "A5", "G5", "-", "D5", "-"],
  Am: ["C5", "E5", "A5", "G5", "E5", "-", "C5", "D5"],
  F: ["F5", "A5", "C6", "A5", "G5", "-", "-", "-"],
  Em: ["B4", "E5", "G5", "F#5", "E5", "-", "B4", "-"],
};
const MEL2 = {
  F: ["A5", "-", "C6", "-", "A5", "G5", "F5", "-"],
  G: ["G5", "-", "B5", "-", "D6", "C6", "B5", "-"],
  Em: ["E5", "G5", "B5", "G5", "E5", "-", "D5", "-"],
  Am: ["C6", "-", "B5", "A5", "E5", "-", "-", "-"],
  C: ["C6", "-", "G5", "-", "E5", "G5", "C6", "-"],
};

function bars(t0, t1, prog, fn) { // call fn(barStart, chord, barIndex) for each 2s bar (last one may be cut)
  let i = 0; for (let t = t0; t < t1 - 0.25; t += 4 * BEAT, i++) fn(t, prog[i % prog.length], i, Math.min(4 * BEAT, t1 - t));
}
function drums(t0, t1, style) {
  for (let t = t0, b = 0; t < t1 - 0.01; t += BEAT / 2, b++) {
    const beat = b / 2, onBeat = b % 2 === 0;
    if (style === "full") { if (onBeat && beat % 2 === 0) add(t, kick(), 0.55, 0, 0.05); if (onBeat && beat % 2 === 1) add(t, snare(), 0.32, 0.05, 0.2); add(t, hat(0.035), onBeat ? 0.22 : 0.15, 0.3, 0.05); }
    if (style === "light") { if (onBeat && beat % 4 === 0) add(t, kick(), 0.35, 0, 0.05); if (!onBeat) add(t, hat(0.03), 0.16, 0.35, 0.05); if (onBeat && beat % 2 === 1) add(t, wood(1300), 0.18, -0.2, 0.15); }
    if (style === "battle") { if (onBeat) add(t, wood(beat % 2 ? 700 : 950), 0.25, beat % 2 ? 0.4 : -0.4, 0.1); if (onBeat && beat % 4 === 0) add(t, kick(), 0.45, 0, 0.05); }
    if (style === "big") { if (onBeat && beat % 2 === 0) add(t, kick(), 0.6, 0, 0.05); if (onBeat && beat % 2 === 1) add(t, snare(1.1), 0.36, 0.05, 0.25); add(t, hat(0.04), onBeat ? 0.2 : 0.14, 0.3, 0.05); if (beat % 4 === 0 && onBeat) add(t, timpani(), 0.35, 0, 0.3); }
  }
}
function bass(t, chord, len, style = "bounce") {
  const r = midi(nn(`${CH[chord][0]}2`)), fifth = r * 1.5;
  const pat = style === "bounce" ? [r, 0, fifth, 0, r * 2, 0, fifth, r] : style === "walk" ? [r, fifth, r * 2, fifth] : [r, 0, 0, 0, fifth, 0, 0, 0];
  const step = (4 * BEAT) / pat.length;
  pat.forEach((f, k) => { if (f && k * step < len - 0.05) add(t + k * step, pluck(f, step * 0.9, 0.3), 0.42, -0.1, 0.05); });
}
function melody(t, notes, len, inst = "marimba", gain = 0.28, pan = 0.15, oct = 0) {
  notes.forEach((s, k) => { if (s === "-" || k * BEAT / 2 >= len - 0.05) return; const f = midi(nn(s) + 12 * oct);
    const dur = notes[k + 1] === "-" ? BEAT : BEAT / 2;
    const b = inst === "marimba" ? marimba(f, 0.5) : inst === "flute" ? flute(f, dur * 0.9) : inst === "glock" ? glock(f) : pluck(f, 0.25, 0.8);
    add(t + k * BEAT / 2, b, gain, pan, inst === "flute" ? 0.35 : 0.25); });
}

// ---------------------------------------------------------------- arrangement (times match src/timeline.ts)
const S = { hookEnd: 4.6, s3: 12.2, s4: 17.8, s5: 25.8, s6: 58.8, soak: 61.3, s7: 63.0, s8: 67.6, s9: 84.0, s10: 87.0, s11: 93.8, logo: 101.0, end: 110 };

// Hook: sparkly music-box arpeggio, then a comic stop, then a snare fill into the big reveal.
["C6", "E6", "G6", "B6", "C7", "G6", "E6", "D6", "C6", "E6", "G6", "C7"].forEach((s, k) => add(0.2 + k * 0.25, glock(midi(nn(s))), 0.16, k % 2 ? 0.4 : -0.4, 0.5));
add(0, pad(chordNotes("C", 4), 3.2, 0.12), 0.5, 0, 0.6);
add(3.2, pad(chordNotes("F", 4), 2.0, 0.12), 0.45, 0, 0.6);
add(5.25, pluck(midi(nn("G4")), 0.12, 0.9), 0.35, 0.2, 0.2); add(5.45, pluck(midi(nn("C4")), 0.25, 0.9), 0.35, -0.2, 0.2); // "plink-plonk"
for (let k = 0; k < 8; k++) add(6.9 + k * 0.075, snare(0.6 + k * 0.06), 0.25, 0, 0.15);
add(S.hookEnd, crash(2.4, 0.4), 0.9, 0, 0.4); add(S.hookEnd, kick(), 0.7, 0, 0.1); add(S.hookEnd, timpani(55), 0.5, 0, 0.3);

// Main theme (title, catching, working).
bars(S.hookEnd, S.s5, PROG_A, (t, c, i, len) => {
  add(t, pad(chordNotes(c, 4), len - 0.1, 0.25), 0.55, 0, 0.5);
  bass(t, c, len, "bounce");
  const m = (i >> 2) % 2 === 1 && i >= 4 ? MEL2[c] ?? MEL[c] : MEL[c];
  melody(t, m, len, "marimba", 0.3, 0.15);
  if (i % 8 >= 4) melody(t, m, len, "glock", 0.08, -0.3, 1);
  if (i >= 2) for (let k = 0; k < 4; k++) add(t + k * BEAT + BEAT / 2, pluck(chordNotes(c, 4)[k % 3], 0.15, 0.7), 0.1, 0.45, 0.2);
});
drums(S.hookEnd, S.s5, "full");

// Merchant groove: lighter, flute melody, offbeat chords.
bars(S.s5, S.s6, PROG_A, (t, c, i, len) => {
  add(t, pad(chordNotes(c, 4), len - 0.1, 0.18), 0.4, 0, 0.5);
  bass(t, c, len, "walk");
  melody(t, MEL[c], len, "flute", 0.2, -0.1);
  for (let k = 0; k < 4; k++) if (k * BEAT + BEAT / 2 < len) chordNotes(c, 4).forEach((f) => add(t + k * BEAT + BEAT / 2, marimba(f, 0.15), 0.08, 0.3, 0.2));
});
drums(S.s5, S.s6, "light");
add(S.s6 - 0.6, wah(900, 300, 0.6), 0.25, 0, 0.3);

// Battle: A minor, tick-tock woodblocks, staccato ostinato, rising tension, splash hit.
bars(S.s6, S.s7, ["Am", "E", "Am", "E", "Dm", "E"], (t, c, i, len) => {
  add(t, pad(chordNotes(c, 3), len - 0.1, 0.15), 0.45, 0, 0.4);
  const r = midi(nn(`${CH[c][0]}3`));
  for (let k = 0; k < 8; k++) if (k * BEAT / 2 < len) add(t + k * BEAT / 2, pluck(k % 2 ? r * 1.5 : r, 0.1, 0.9), 0.22 + i * 0.02, k % 2 ? 0.25 : -0.25, 0.15);
  if (i % 2 === 1) ["E5", "-", "D#5", "-", "E5", "-", "B4", "-"].forEach((s, k) => { if (s !== "-" && k * BEAT / 2 < len) add(t + k * BEAT / 2, flute(midi(nn(s)), 0.2), 0.14, 0.1, 0.3); });
});
drums(S.s6, S.soak - 0.05, "battle");
add(S.soak, crash(1.4, 0.45), 0.8, 0, 0.5); add(S.soak, timpani(48), 0.5, 0, 0.3); add(S.soak + 0.05, wah(700, 180, 0.9), 0.35, 0, 0.3);
drums(S.soak + 0.5, S.s7, "battle");

// Main theme returns (needs & crafting), then busy "clockwork" arps for autopilot.
bars(S.s7, S.s8, PROG_B, (t, c, i, len) => {
  add(t, pad(chordNotes(c, 4), len - 0.1, 0.25), 0.5, 0, 0.5);
  bass(t, c, len, "bounce");
  melody(t, MEL2[c] ?? MEL[c], len, "marimba", 0.28, 0.15);
});
drums(S.s7, S.s8, "full");
bars(S.s8, S.s9, PROG_A, (t, c, i, len) => {
  add(t, pad(chordNotes(c, 4), len - 0.1, 0.25), 0.5, 0, 0.5);
  bass(t, c, len, "bounce");
  const ns = chordNotes(c, 5);
  for (let k = 0; k < 16; k++) if (k * BEAT / 4 < len) add(t + k * BEAT / 4, marimba(ns[k % 3] * (k % 6 >= 3 ? 2 : 1), 0.12), 0.11, k % 2 ? 0.35 : -0.35, 0.15);
  if (i % 2 === 1) melody(t, MEL[c], len, "flute", 0.15, 0);
});
drums(S.s8, S.s9, "full");

// Economy + tech reveal: triumphant brass, timpani, augmented melody.
bars(S.s9, S.s11, PROG_T, (t, c, i, len) => {
  add(t, brass(chordNotes(c, 4), len - 0.15), 0.45, 0, 0.45);
  add(t, pad(chordNotes(c, 3), len - 0.1, 0.2), 0.4, 0, 0.5);
  bass(t, c, len, "walk");
  melody(t, MEL2[c] ?? MEL[c], len, "marimba", 0.24, 0.2);
  if (i >= 2) melody(t, MEL2[c] ?? MEL[c], len, "glock", 0.07, -0.3, 1);
});
drums(S.s9, S.s11, "big");

// Finale: one fast phrase, then the logo hit and a ringing C chord.
bars(S.s11, S.logo, ["F", "G", "C"], (t, c, i, len) => {
  add(t, brass(chordNotes(c, 4), len - 0.1), 0.45, 0, 0.45);
  bass(t, c, len, "bounce");
  melody(t, MEL[c], len, "marimba", 0.28, 0.15); melody(t, MEL[c], len, "glock", 0.09, -0.3, 1);
});
drums(S.s11, S.logo - 0.4, "big");
for (let k = 0; k < 6; k++) add(S.logo - 0.45 + k * 0.075, snare(0.7 + k * 0.08), 0.26, 0, 0.15);
add(S.logo, crash(2.6, 0.45), 1, 0, 0.5); add(S.logo, timpani(65), 0.6, 0, 0.4); add(S.logo, kick(), 0.7, 0, 0.1);
add(S.logo, brass(chordNotes("C", 4).concat([midi(nn("C5"))]), 2.0), 0.6, 0, 0.6);
["C6", "E6", "G6", "C7"].forEach((s, k) => add(S.logo + k * 0.06, glock(midi(nn(s)), 2), 0.14, k % 2 ? 0.4 : -0.4, 0.6));

// ---------------------------------------------------------------- reverb + master
function reverb(inp) {
  const out = new Float32Array(N), combs = [1557, 1617, 1491, 1422, 1277, 1356].map((d) => ({ d: Math.round(d * SR / 44100), buf: null, i: 0, fb: 0.8, lp: 0 }));
  for (const c of combs) c.buf = new Float32Array(c.d);
  for (let j = 0; j < N; j++) { let s = 0; for (const c of combs) { const y = c.buf[c.i]; c.lp = y * 0.7 + c.lp * 0.3; c.buf[c.i] = inp[j] + c.lp * c.fb; c.i = (c.i + 1) % c.d; s += y; } out[j] = s / combs.length; }
  for (const d of [Math.round(225 * SR / 44100), Math.round(556 * SR / 44100)]) { const buf = new Float32Array(d); let i = 0; for (let j = 0; j < N; j++) { const y = buf[i]; const x = out[j]; buf[i] = x + y * 0.5; out[j] = y - x * 0.5; i = (i + 1) % d; } }
  return out;
}
const vl = reverb(RL), vr = reverb(RR);
let peak = 0;
for (let j = 0; j < N; j++) { L[j] += vl[j] * 0.9; R[j] += vr[j] * 0.9; peak = Math.max(peak, Math.abs(L[j]), Math.abs(R[j])); }
const g = 0.9 / Math.max(1e-6, peak) * 1.6;
const pcm = Buffer.alloc(44 + N * 4);
pcm.write("RIFF", 0); pcm.writeUInt32LE(36 + N * 4, 4); pcm.write("WAVE", 8); pcm.write("fmt ", 12); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(2, 22);
pcm.writeUInt32LE(SR, 24); pcm.writeUInt32LE(SR * 4, 28); pcm.writeUInt16LE(4, 32); pcm.writeUInt16LE(16, 34); pcm.write("data", 36); pcm.writeUInt32LE(N * 4, 40);
for (let j = 0; j < N; j++) {
  const fade = j > N - SR * 0.5 ? (N - j) / (SR * 0.5) : 1;
  pcm.writeInt16LE(Math.round(Math.tanh(L[j] * g) * 0.95 * fade * 32767), 44 + j * 4);
  pcm.writeInt16LE(Math.round(Math.tanh(R[j] * g) * 0.95 * fade * 32767), 46 + j * 4);
}
mkdirSync("public/audio", { recursive: true });
writeFileSync(process.env.OUT ?? "public/audio/music.wav", pcm);
console.log("music.wav", LEN, "s, peak", peak.toFixed(2));
