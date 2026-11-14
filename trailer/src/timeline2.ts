/**
 * Trailer v2 — one pet (Noodle) through the whole economy. All footage: real 60 fps captures from catchami.fun (NEAR testnet).
 * Numbers in callouts come from the recording logs in footage2/*.log.json.
 */
export const FPS = 60;
export const TOTAL = 108;

export type Shot = { at: number; dur: number; src: string; from: number; rate?: number; zoom?: [number, number]; focus?: [number, number]; scene?: string; chip?: string };

export const SHOTS: Shot[] = [
  // 1 · Welcome — world under the logo
  { at: 0.0, dur: 4.6, src: "v2_walk", from: 3.0, zoom: [1.12, 1.02] },
  // 2 · The catch (tablet, full cat)
  { at: 4.6, dur: 2.6, src: "catch2", from: 0.3 },
  { at: 7.2, dur: 2.2, src: "catch2", from: 4.0 },
  { at: 9.4, dur: 1.8, src: "catch2", from: 11.6 },
  { at: 11.2, dur: 1.0, src: "catch2", from: 15.6 },
  // 3 · Floating NFT card
  { at: 12.2, dur: 5.6, src: "SCENE:card", from: 0 },
  // 4 · Earn: fishing
  { at: 17.8, dur: 2.4, src: "v2_walk", from: 9.0, zoom: [1.0, 1.04] },
  { at: 20.2, dur: 5.6, src: "v2_fish", from: 9.0, rate: 3.2, zoom: [1.18, 1.25], focus: [0.5, 0.42], chip: "3× SPEED" },
  // 5 · Sell to Finn
  { at: 25.8, dur: 2.2, src: "v2_sell", from: 5.6, zoom: [1.0, 1.05] },
  { at: 28.0, dur: 3.7, src: "v2_sell", from: 12.0, zoom: [1.25, 1.32], focus: [0.5, 0.62] },
  // 6 · Hungry → meal
  { at: 31.7, dur: 5.2, src: "v2_meal", from: 0.6, zoom: [1.25, 1.32], focus: [0.5, 0.7] },
  // 7 · Demand
  { at: 36.9, dur: 5.6, src: "v2_tom", from: 7.5, zoom: [1.18, 1.25], focus: [0.5, 0.55] },
  // 8 · HQ
  { at: 42.5, dur: 3.6, src: "v2_hqreturn", from: 3.0, zoom: [1.05, 1.1], focus: [0.5, 0.3] },
  { at: 46.1, dur: 4.4, src: "IMG:v2-hq-lore", from: 0, zoom: [1.25, 1.32], focus: [0.62, 0.97] },
  // 9 · Economy loop (full-screen)
  { at: 50.5, dur: 8.3, src: "SCENE:loop", from: 0 },
  // 10 · Montage
  { at: 58.8, dur: 2.2, src: "v2_battle", from: 3.5 },
  { at: 61.0, dur: 2.0, src: "v2_battle", from: 13.0, zoom: [1.05, 1.12] },
  { at: 63.0, dur: 1.4, src: "v2_heal", from: 1.0, zoom: [1.3, 1.36], focus: [0.5, 0.82] },
  { at: 64.4, dur: 1.8, src: "v2_craft", from: 0.8, zoom: [1.25, 1.3], focus: [0.5, 0.6] },
  { at: 66.2, dur: 1.4, src: "v2_equip", from: 1.2, zoom: [1.5, 1.6], focus: [0.5, 0.25] },
  // 11 · Autopilot
  { at: 67.6, dur: 4.2, src: "v2_apset", from: 0.5, zoom: [1.45, 1.55], focus: [0.5, 0.45] },
  { at: 71.8, dur: 4.8, src: "v2_auto", from: 2.0, rate: 16, zoom: [1.0, 1.04] },
  { at: 76.6, dur: 4.0, src: "v2_auto", from: 122.0, rate: 2.2, zoom: [1.05, 1.12], focus: [0.6, 0.45] },
  { at: 80.6, dur: 3.4, src: "v2_auto", from: 131.0, rate: 10, zoom: [1.0, 1.04] },
  // 12 · Proof
  { at: 84.0, dur: 3.0, src: "IMG:v2-history", from: 0, zoom: [1.4, 1.5], focus: [0.5, 0.55] },
  { at: 87.0, dur: 6.8, src: "SCENE:proof", from: 0 },
  // 13 · Ending montage + logo
  { at: 93.8, dur: 1.4, src: "catch2", from: 11.8 },
  { at: 95.2, dur: 1.3, src: "v2_fish", from: 9.6, zoom: [1.18, 1.22], focus: [0.5, 0.42] },
  { at: 96.5, dur: 1.3, src: "v2_sell", from: 14.4, zoom: [1.25, 1.3], focus: [0.5, 0.62] },
  { at: 97.8, dur: 1.3, src: "v2_battle", from: 14.0 },
  { at: 99.1, dur: 1.9, src: "v2_auto", from: 125.0, rate: 4 },
  { at: 101.0, dur: 9.0, src: "SCENE:end", from: 0 },
];

/** Narration start times (ids from tools/narration.json; durations in src/vo.json). */
export const VO: Record<string, number> = {
  a1: 0.5, a2: 4.7, a3: 7.3, a4: 12.6,
  b1: 18.0, b2: 20.6, b3: 26.0, b4: 31.3, b5: 34.5, b6: 37.2,
  c1: 42.8, c2: 45.0, c3: 51.0,
  d1: 59.0,
  e1: 67.8, e2: 72.6,
  f1: 85.2,
  g1: 103.5,
};

export const CAPTION_SPLIT: Record<string, string[]> = {
  a4: ["and it becomes a playable NFT pet,", "with its very own coin wallet."],
  b3: ["Then it sells them to a travelling merchant,", "who pays from its own budget."],
  b4: ["But working makes it hungry.", "So it needs food."],
  b5: ["Every meal costs coins,", "and uses fish from HQ's kitchen."],
  b6: ["And food changes market demand.", "The more fish gets eaten, the more merchants pay for it."],
  c2: ["HQ collects what pets spend,", "and sets each day's merchant budget", "from its reserves and recent revenue."],
  c3: ["Pets sell to merchants. Merchants deliver to HQ.", "Pets spend back into HQ. And HQ funds the next round."],
  d1: ["Your pet can do even more.", "Splash rivals in Bubble Roulette, heal up, craft gear, and trade."],
  e1: ["And here's the best part.", "Your pet doesn't need you to control every move."],
  e2: ["Choose a strategy, and it can work, trade, rest,", "and manage its own little life."],
  f1: ["Every pet is a real NFT.", "Its coins live in its own vault balance,", "and gameplay is settled on NEAR in batches."],
  g1: ["Catchami.", "Catch a pet. Give it a life."],
};

/** Live-data callouts drawn beside the footage: [at, dur, kind, props]. Values from recording logs. */
export type Callout = { at: number; dur: number; anim?: [number, number]; side?: "left" | "right"; rows: Array<{ icon: string; label: string; from?: number; to?: number; text?: string; good?: boolean }> ; title?: string };
export const CALLOUTS: Callout[] = [
  { at: 20.6, dur: 5.0, anim: [0, 4.9], title: "Noodle", rows: [
    { icon: "icon-fish.png", label: "Bag", from: 10, to: 90, text: "fish" },
    { icon: "⚡", label: "Energy", from: 860, to: 608 },
    { icon: "🍖", label: "Hunger", from: 287, to: 408 } ] },
  { at: 28.3, dur: 3.7, anim: [2.7, 3.1], title: "Finn pays from his purse", rows: [
    { icon: "ui-coin.png", label: "Noodle's wallet", from: 400000, to: 406048, good: true },
    { icon: "💰", label: "Finn's purse", from: 2000000, to: 1993952 } ] },
  { at: 32.0, dur: 4.8, anim: [2.6, 3.0], title: "Buy meal · 7K", rows: [
    { icon: "ui-coin.png", label: "Noodle's wallet", from: 406048, to: 399048 },
    { icon: "🍖", label: "Hunger", from: 419, to: 69, good: true },
    { icon: "icon-fish.png", label: "HQ kitchen fish", from: 327, to: 317 } ] },
];

export const LABELS: Array<{ at: number; dur: number; text: string; color: string }> = [
  { at: 17.9, dur: 2.2, text: "WORK & EARN", color: "leaf" },
  { at: 37.2, dur: 2.6, text: "LIVE MARKET DEMAND", color: "coral" },
  { at: 58.9, dur: 2.0, text: "BUBBLE ROULETTE", color: "sky" },
  { at: 67.8, dur: 2.6, text: "AUTOPILOT", color: "leaf" },
];

/** Sound effects: [time, name, volume]. */
export const SFX: Array<[number, string, number]> = [
  [0.3, "sparkle", 0.5], [4.6, "swoosh", 0.5], [5.4, "throw", 0.9], [6.0, "catch", 0.6], [7.4, "shake", 0.6], [8.3, "shake", 0.6], [9.4, "reveal", 0.8], [11.2, "pop", 0.6],
  [12.3, "whoosh", 0.7], [13.4, "sparkle", 0.6], [14.0, "stamp", 0.5], [14.4, "stamp", 0.5], [14.8, "stamp", 0.5], [15.4, "coins", 0.8],
  [17.8, "swoosh", 0.5], [21.2, "splash", 0.9], [21.9, "perfect", 0.6], [23.6, "splash", 0.9], [24.3, "perfect", 0.6],
  [25.8, "pop", 0.5], [30.7, "click", 0.6], [31.0, "cash", 0.9], [31.3, "coins", 0.7],
  [33.4, "click", 0.6], [33.8, "spend", 0.8], [34.4, "pop", 0.5],
  [37.0, "whoosh", 0.5], [42.5, "swoosh", 0.5], [46.1, "pop", 0.5],
  [50.5, "whoosh", 0.6], [51.1, "pop", 0.6], [52.7, "coin", 0.7], [54.3, "pop", 0.6], [55.9, "spend", 0.6], [57.5, "coins", 0.6],
  [58.8, "bubblepop", 0.9], [59.6, "spin", 0.6], [61.3, "bigsplash", 1.0], [62.0, "win", 0.6], [63.2, "spend", 0.6], [64.6, "craft", 0.8], [66.4, "sparkle", 0.6],
  [67.6, "whoosh", 0.5], [68.6, "click", 0.5], [69.6, "click", 0.5], [70.8, "click", 0.5], [71.6, "autopilot", 0.9], [77.4, "pop", 0.6], [79.6, "cash", 0.8],
  [84.0, "swoosh", 0.5], [87.0, "reveal", 0.6], [88.4, "stamp", 0.5], [90.6, "stamp", 0.5],
  [93.8, "throw", 0.6], [95.2, "splash", 0.7], [96.5, "cash", 0.6], [97.8, "bigsplash", 0.7], [99.1, "autopilot", 0.5], [101.0, "fanfare", 0.6],
];

/** Autopilot activity feed (real log of the recording; t = recording seconds). */
export const AUTO_ROWS = [
  { t: 0.5, icon: "🎣", text: "Gathering fish", balance: 399048 },
  { t: 60, icon: "🎣", text: "Bag: 150 fish", balance: 399048 },
  { t: 123, icon: "🎒", text: "Bag is full — 269 fish", balance: 399048 },
  { t: 124, icon: "🚶", text: "Heading to Timber Tom to sell", balance: 399048 },
  { t: 130, icon: "🪙", text: "Sold 269 fish · +15.2K", balance: 414219 },
  { t: 131, icon: "😴", text: "Napping to recover energy", balance: 414219 },
];
