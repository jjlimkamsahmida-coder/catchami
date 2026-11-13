/**
 * Catchami background music — an original, soft, bouncy loop synthesised
 * with WebAudio (no audio files). Cosy major-key tune over a I–vi–IV–V
 * progression: triangle lead, warm sine bass, gentle offbeat plucks and a
 * whisper of shaker. Starts after the first user gesture (browser rule) and
 * remembers mute in localStorage.
 */
const KEY = "catchami.music";
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let timer: number | null = null;
let nextTime = 0;
let step = 0;
let enabled = (() => { try { return localStorage.getItem(KEY) !== "off"; } catch { return true; } })();
const listeners = new Set<(on: boolean) => void>();

const BPM = 104;
const EIGHTH = 60 / BPM / 2;
const VOLUME = 0.075;
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

// Chords per bar (C, Am, F, G) and their bass roots.
const CHORDS = [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]];
const ROOTS = [48, 45, 41, 43];
// Melody: 8 eighth-notes per bar; 0 = rest. Two phrases (A, B) → 8-bar loop played A A B A.
const A = [
  [72, 0, 76, 79, 76, 0, 74, 72],
  [69, 0, 72, 76, 74, 72, 69, 0],
  [69, 72, 74, 0, 72, 69, 65, 0],
  [67, 0, 71, 74, 72, 0, 71, 0],
];
const A2 = [
  [72, 0, 76, 79, 81, 0, 79, 76],
  [77, 0, 76, 74, 72, 0, 69, 0],
  [69, 72, 74, 77, 76, 74, 72, 0],
  [71, 74, 72, 71, 72, 0, 0, 0],
];
const B = [
  [79, 0, 76, 0, 74, 76, 72, 0],
  [76, 0, 72, 0, 69, 72, 74, 0],
  [77, 76, 74, 72, 74, 0, 69, 0],
  [71, 72, 74, 0, 67, 0, 0, 0],
];
const SONG = [...A, ...A2, ...B, ...A2]; // 16 bars

function voice(freq: number, t: number, dur: number, type: OscillatorType, vol: number, attack = 0.01) {
  const o = ctx!.createOscillator(), g = ctx!.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master!);
  o.start(t); o.stop(t + dur + 0.05);
  return o;
}

function shaker(t: number, vol: number) {
  const len = Math.floor(ctx!.sampleRate * 0.05);
  const b = ctx!.createBuffer(1, len, ctx!.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = ctx!.createBufferSource(), f = ctx!.createBiquadFilter(), g = ctx!.createGain();
  s.buffer = b; f.type = "highpass"; f.frequency.value = 6000; g.gain.value = vol;
  s.connect(f).connect(g).connect(master!); s.start(t);
}

function schedule() {
  while (nextTime < ctx!.currentTime + 0.25) {
    const bar = Math.floor(step / 8) % SONG.length, beat = step % 8, t = nextTime;
    const chord = CHORDS[bar % 4]!, root = ROOTS[bar % 4]!;
    // Lead (with a tiny vibrato for warmth).
    const note = SONG[bar]![beat]!;
    if (note) {
      const held = SONG[bar]![beat + 1] === 0 ? 2 : 1;
      const o = voice(midi(note), t, EIGHTH * held * 0.95, "triangle", 0.5, 0.012);
      const lfo = ctx!.createOscillator(), lg = ctx!.createGain();
      lfo.frequency.value = 5.5; lg.gain.value = 3;
      lfo.connect(lg).connect(o.frequency); lfo.start(t); lfo.stop(t + EIGHTH * held);
    }
    // Bass on beats 1 and 3, root then fifth.
    if (beat === 0) voice(midi(root), t, EIGHTH * 3.6, "sine", 0.55, 0.02);
    if (beat === 4) voice(midi(root + 7), t, EIGHTH * 3.6, "sine", 0.45, 0.02);
    // Soft offbeat plucks (the bouncy bit).
    if (beat % 2 === 1) for (const n of chord) voice(midi(n + 12), t, EIGHTH * 0.6, "square", 0.045, 0.005);
    // Whisper shaker.
    shaker(t, beat % 2 ? 0.05 : 0.025);
    nextTime += EIGHTH;
    step++;
  }
}

function start() {
  if (!enabled || timer !== null) return;
  try {
    ctx ??= new AudioContext();
    if (!master) {
      master = ctx.createGain(); master.gain.value = 0;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3200;
      master.connect(lp).connect(ctx.destination);
    }
    void ctx.resume();
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(VOLUME, ctx.currentTime, 0.8); // gentle fade-in
    nextTime = ctx.currentTime + 0.1;
    timer = window.setInterval(schedule, 60);
  } catch { /* no audio available */ }
}

function stop() {
  if (timer !== null) { clearInterval(timer); timer = null; }
  if (ctx && master) master.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
}

export const music = {
  get on() { return enabled; },
  /** Call once at app start: music begins on the first tap/click/key. */
  arm() {
    const go = () => { start(); window.removeEventListener("pointerdown", go); window.removeEventListener("keydown", go); };
    window.addEventListener("pointerdown", go);
    window.addEventListener("keydown", go);
    // Pause when the tab is hidden, resume when it comes back.
    document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); else if (enabled && ctx) start(); });
  },
  toggle() {
    enabled = !enabled;
    try { localStorage.setItem(KEY, enabled ? "on" : "off"); } catch { /* ignore */ }
    if (enabled) start(); else stop();
    listeners.forEach((f) => f(enabled));
    return enabled;
  },
  subscribe(f: (on: boolean) => void) { listeners.add(f); return () => { listeners.delete(f); }; },
};
