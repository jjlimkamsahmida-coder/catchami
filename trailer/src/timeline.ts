/**
 * The trailer's edit decision list. All times in seconds.
 * Footage times ("from") refer to the recordings in public/footage (real gameplay, live testnet site).
 */
export const FPS = 30;
export const TOTAL = 112;

/** Scene boundaries (the soundtrack in tools/music.mjs uses the same marks). */
export const S = { hookEnd: 7.5, s3: 14, s4: 25.5, s5: 36.5, s6: 47.5, soak: 56.6, s7: 58.5, s8: 69.5, s9: 82, s10: 97.5, s11: 103.8, logo: 109.3, end: 112 };

export type Frame = "full" | "phone" | "card";
export interface Shot {
  at: number; dur: number; src: string; from: number;
  /** playback rate (time-lapse > 1) */
  rate?: number;
  /** how the footage is framed */
  frame?: Frame;
  /** slow push-in: zoom from -> to, focus point in 0..1 */
  zoom?: [number, number]; focus?: [number, number];
  /** transition into this shot */
  tr?: "cut" | "bubble" | "star" | "swoosh" | "flash";
  /** phone-frame backdrop */
  bg?: string;
  /** label chip (top-left) */
  chip?: string;
}

export const SHOTS: Shot[] = [
  // 1 · Hook — the real catch of Pudding (the cat in the user's photo), on the phone camera.
  { at: 0.0, dur: 2.0, src: "catch", from: 21.4, frame: "phone", zoom: [1.0, 1.06], tr: "cut" },
  { at: 2.0, dur: 1.6, src: "catch", from: 26.0, frame: "phone", zoom: [1.04, 1.1], tr: "cut" },
  { at: 3.6, dur: 1.4, src: "catch", from: 33.6, frame: "phone", zoom: [1.0, 1.08], tr: "cut" },
  { at: 5.0, dur: 2.5, src: "catch", from: 38.6, frame: "phone", zoom: [1.0, 1.7], focus: [0.5, 0.74], tr: "flash" },

  // 2 · Welcome to Catchami — world reveal.
  { at: 7.5, dur: 2.2, src: "merchant", from: 6.0, zoom: [1.12, 1.0], tr: "star" },
  { at: 9.7, dur: 2.2, src: "mine", from: 0.0, zoom: [1.0, 1.08], tr: "cut" },
  { at: 11.9, dur: 2.1, src: "chop", from: 0.0, zoom: [1.06, 1.0], tr: "cut" },

  // 3 · Catch real animals — the full flow on the phone.
  { at: 14.0, dur: 2.4, src: "catch", from: 18.0, frame: "phone", tr: "bubble", bg: "village" },
  { at: 16.4, dur: 2.6, src: "catch", from: 24.3, frame: "phone", bg: "village" },
  { at: 19.0, dur: 2.6, src: "catch", from: 31.8, frame: "phone", bg: "village" },
  { at: 21.6, dur: 3.9, src: "catch", from: 37.6, frame: "phone", zoom: [1.0, 1.5], focus: [0.5, 0.74], bg: "village" },

  // 4 · Work, gather, earn — minigame montage, then needs.
  { at: 25.5, dur: 2.0, src: "herbs", from: 0.0, zoom: [1.0, 1.06], tr: "swoosh" },
  { at: 27.5, dur: 2.0, src: "chop", from: 4.0, zoom: [1.25, 1.3], focus: [0.5, 0.42] },
  { at: 29.5, dur: 2.0, src: "mine", from: 2.3, zoom: [1.25, 1.3], focus: [0.5, 0.42] },
  { at: 31.5, dur: 2.0, src: "herbs", from: 2.0, zoom: [1.25, 1.3], focus: [0.5, 0.42] },
  { at: 33.5, dur: 3.0, src: "chop", from: 19.6, zoom: [1.6, 1.75], focus: [0.07, 0.07] },

  // 5 · Demand & merchants — a real sale to Timber Tom.
  { at: 36.5, dur: 2.8, src: "merchant", from: 6.0, zoom: [1.0, 1.05], tr: "star" },
  { at: 39.3, dur: 2.2, src: "merchant", from: 13.0, zoom: [1.3, 1.45], focus: [0.62, 0.55] },
  { at: 41.5, dur: 3.0, src: "merchant", from: 59.6, zoom: [1.5, 1.6], focus: [0.62, 0.55] },
  { at: 44.5, dur: 3.0, src: "merchant", from: 62.6, zoom: [1.3, 1.4], focus: [0.5, 0.25] },

  // 6 · Bubble Roulette — real match vs Sid's Mochi.
  { at: 47.5, dur: 2.6, src: "battle4", from: 2.4, zoom: [1.0, 1.06], tr: "bubble" },
  { at: 50.1, dur: 2.6, src: "battle4", from: 3.4, zoom: [1.15, 1.25], focus: [0.5, 0.2] },
  { at: 52.7, dur: 2.2, src: "battle4", from: 13.6, zoom: [1.05, 1.15] },
  { at: 54.9, dur: 1.7, src: "battle4", from: 15.4, zoom: [1.2, 1.35], focus: [0.18, 0.45] },
  { at: 56.6, dur: 1.9, src: "battle4", from: 16.6, zoom: [1.0, 1.08], tr: "flash" },

  // 7 · Spend, recover, craft, trade.
  { at: 58.5, dur: 2.6, src: "heal", from: 10.2, zoom: [1.4, 1.5], focus: [0.58, 0.72], tr: "swoosh" },
  { at: 61.1, dur: 1.9, src: "IMG:craft-before", from: 0, zoom: [1.6, 1.75], focus: [0.5, 0.62] },
  { at: 63.0, dur: 1.3, src: "history", from: 2.8, zoom: [1.9, 2.0], focus: [0.5, 0.36] },
  { at: 64.3, dur: 2.4, src: "equip", from: 1.0, zoom: [1.6, 1.7], focus: [0.5, 0.15] },
  { at: 66.7, dur: 2.8, src: "market", from: 43.5, zoom: [1.15, 1.22], focus: [0.5, 0.2] },

  // 8 · Autopilot — strategy panel, then the hands-off time-lapse.
  { at: 69.5, dur: 4.0, src: "IMG:autopilot-panel", from: 0, zoom: [1.55, 1.8], focus: [0.5, 0.5], tr: "star" },
  { at: 73.5, dur: 8.5, src: "autopilot", from: 28.5, rate: 12, zoom: [1.0, 1.05], chip: "AUTOPILOT · 12× SPEED" },

  // 9 · Living economy — HQ treasury + piggy-bank cash flow, with the flow overlay.
  { at: 82.0, dur: 6.0, src: "IMG:vault-lore", from: 0, zoom: [1.9, 2.05], focus: [0.5, 0.82], tr: "swoosh" },
  { at: 88.0, dur: 4.5, src: "history", from: 2.8, zoom: [1.5, 1.6], focus: [0.5, 0.42] },
  { at: 92.5, dur: 5.0, src: "vault", from: 6.0, zoom: [1.55, 1.6], focus: [0.5, 0.45] },

  // 10 · Technical reveal — NFT card, mint tx, settle batch (NEAR testnet).
  { at: 97.5, dur: 2.0, src: "IMG:nft-card", from: 0, zoom: [1.7, 1.85], focus: [0.5, 0.56], tr: "flash" },
  { at: 99.5, dur: 2.1, src: "IMG:tx-mint", from: 0, zoom: [1.35, 1.5], focus: [0.4, 0.62] },
  { at: 101.6, dur: 2.2, src: "IMG:tx-settle", from: 0, zoom: [1.4, 1.55], focus: [0.38, 0.3] },

  // 11 · Finale montage, then logo.
  { at: 103.8, dur: 1.0, src: "catch", from: 33.8, frame: "phone", tr: "flash", bg: "village" },
  { at: 104.8, dur: 0.9, src: "chop", from: 4.4, zoom: [1.25, 1.3], focus: [0.5, 0.42] },
  { at: 105.7, dur: 0.9, src: "merchant", from: 62.8, zoom: [1.3, 1.4], focus: [0.5, 0.25] },
  { at: 106.6, dur: 0.9, src: "battle4", from: 16.7 },
  { at: 107.5, dur: 1.8, src: "autopilot", from: 40, rate: 12, zoom: [1.05, 1.1] },
];

/** Narration: id -> start time. Durations come from src/vo.json. */
export const VO: Record<string, number> = {
  s1a: 0.6, s1b: 4.4,
  s2: 8.6,
  s3a: 14.4, s3b: 22.3,
  s4a: 25.8, s4b: 28.0, s4c: 31.8,
  s5a: 36.8, s5b: 39.3, s5c: 43.3,
  s6a: 47.8, s6b: 49.9, s6c: 53.0,
  s7a: 58.7, s7b: 60.7, s7c: 65.9,
  s8a: 69.8, s8b: 71.8, s8c: 74.4,
  s9a: 82.3, s9b: 85.3, s9c: 93.1,
  s10: 97.8,
  s11a: 109.4,
};

/** Feature labels (big, branded), shown sparingly. */
export const LABELS: Array<{ at: number; dur: number; text: string; sub?: string; pos?: "top" | "center"; color?: string }> = [
  { at: 19.2, dur: 2.2, text: "REAL ANIMAL → NFT", pos: "top", color: "sky" },
  { at: 22.4, dur: 3.0, text: "ITS OWN WALLET", pos: "top", color: "sun" },
  { at: 28.0, dur: 2.6, text: "WORK & EARN", pos: "top", color: "leaf" },
  { at: 39.4, dur: 2.6, text: "DYNAMIC DEMAND", pos: "top", color: "coral" },
  { at: 43.4, dur: 3.0, text: "REAL MERCHANT BUDGETS", pos: "top", color: "sun" },
  { at: 47.8, dur: 2.0, text: "BUBBLE ROULETTE", pos: "top", color: "sky" },
  { at: 61.3, dur: 2.8, text: "CRAFT & TRADE", pos: "top", color: "plum" },
  { at: 73.8, dur: 3.2, text: "AUTONOMOUS PETS", pos: "top", color: "leaf" },
  { at: 82.4, dur: 2.8, text: "A LIVING ECONOMY", pos: "top", color: "sun" },
];

/** Caption chunks per narration line (split for readability). */
export const CAPTION_SPLIT: Record<string, string[]> = {
  s3a: ["It starts in the real world.", "Find an animal, throw your CamiCube,", "and turn a successful catch into a playable NFT."],
  s4c: ["But every action costs energy.", "And every pet gets hungry."],
  s6c: ["Win resources and coins…", "or end up completely soaked!"],
  s7b: ["Buy food. Recover with medicine.", "Craft equipment. Trade what you create."],
  s8c: ["Set its strategy, and it will gather, find merchants,", "trade, rest, and look after itself —", "even when you're not controlling it."],
  s9b: ["HQ collects what players spend,", "funds the travelling merchants,", "and adjusts their budgets as the treasury and market change."],
  s9c: ["Every coin has a source.", "Every expense has a destination."],
  s10: ["Real NFTs. A token balance inside every pet.", "Gameplay, settled on NEAR."],
};

/** Sound effects: [time, name, volume]. */
export const SFX: Array<[number, string, number]> = [
  [0.15, "sparkle", 0.5], [2.0, "throw", 0.9], [2.55, "catch", 0.7], [3.6, "shake", 0.7], [4.3, "shake", 0.6], [5.0, "reveal", 0.8], [6.15, "coin", 1.0], [6.45, "coins", 0.6],
  [7.5, "swoosh", 0.6], [9.7, "pop", 0.5], [11.9, "pop", 0.5],
  [14.0, "bubblepop", 0.7], [16.5, "throw", 0.8], [17.1, "catch", 0.6], [19.2, "stamp", 0.6], [19.3, "shake", 0.6], [21.6, "reveal", 0.8], [22.5, "coins", 0.8], [22.4, "stamp", 0.5],
  [25.5, "swoosh", 0.6], [27.6, "chop", 1.0], [28.4, "perfect", 0.7], [29.6, "clink", 1.0], [30.4, "perfect", 0.7], [31.6, "pluck", 1.0], [32.5, "perfect", 0.7], [33.6, "spend", 0.6],
  [36.5, "whoosh", 0.6], [39.4, "stamp", 0.5], [41.7, "click", 0.6], [42.3, "spend", 0.7], [44.6, "cash", 0.9], [44.9, "coins", 0.7], [43.4, "stamp", 0.5],
  [47.5, "bubblepop", 0.9], [48.0, "spin", 0.6], [50.4, "puff", 0.9], [50.9, "boing", 0.6], [52.8, "spin", 0.6], [53.5, "bubblepop", 0.7], [55.0, "spin", 0.5], [56.6, "bigsplash", 1.0], [57.4, "win", 0.5],
  [58.5, "swoosh", 0.6], [59.2, "spend", 0.7], [61.4, "craft", 0.9], [64.5, "click", 0.6], [64.8, "sparkle", 0.6], [66.8, "pop", 0.5], [61.3, "stamp", 0.5],
  [69.5, "whoosh", 0.6], [70.4, "click", 0.5], [71.4, "click", 0.5], [72.4, "click", 0.5], [73.4, "autopilot", 0.9], [73.8, "stamp", 0.5],
  [82.0, "swoosh", 0.6], [82.4, "stamp", 0.5], [86.0, "coins", 0.4], [89.0, "spend", 0.4], [92.6, "click", 0.5], [94.6, "coin", 0.6],
  [97.5, "reveal", 0.6], [99.5, "click", 0.5], [101.6, "click", 0.5], [102.6, "coin", 0.5],
  [103.8, "throw", 0.6], [104.8, "chop", 0.8], [105.7, "cash", 0.6], [106.6, "bigsplash", 0.7], [107.5, "autopilot", 0.5], [109.3, "fanfare", 0.6],
];
