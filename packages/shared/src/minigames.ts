/**
 * Gathering minigames and Bubble Roulette — pure, shared rules.
 *
 * The server creates a round (all randomness comes from the fair epoch RNG),
 * sends its parameters, and the client animates the SAME motion functions
 * below. The client only reports when the player tapped / how long they held;
 * the server recomputes the grade from its own copy of the round, so the
 * browser can never submit a reward, a grade, or a chamber outcome.
 */
import type { Resource } from "./config.ts";
import { Rng } from "./rng.ts";

export type MinigameKind = "chop" | "mine" | "fish" | "pull";
export type Grade = "perfect" | "good" | "miss";

export const MINIGAME_FOR: Record<Resource, MinigameKind> = { wood: "chop", minerals: "mine", fish: "fish", herbs: "pull" };

/** All tunables live here (versioned with ECONOMY via review). */
export const MINIGAMES = {
  /** Units awarded per grade, before node supply / carry capacity caps. */
  yield: { perfect: 20, good: 10, miss: 0 } as Record<Grade, number>,
  /** Energy spent per attempt, whatever the result. */
  energyPerAttempt: 3,
  /** A round must be answered within this many ms of being sent. */
  timeoutMs: 6_000,
  /** Taps faster than this after the round appeared are physically implausible. */
  minReactionMs: 180,
  /** Network/clock slack allowed between the client-reported time and server elapsed time. */
  slackMs: 400,
  chop: { periodMs: [1_150, 1_550], perfect: 0.06, good: 0.17 },
  mine: { degPerSec: [230, 330], perfectDeg: 14, goodDeg: 38 },
  fish: { perfect: 0.07, good: 0.18 },
  pull: { looseMs: [850, 1_350], perfect: [0.88, 1.06], good: [0.7, 1.22] },
} as const;

export interface ChopRound { kind: "chop"; periodMs: number; phase: number; center: number }
export interface MineRound { kind: "mine"; degPerSec: number; startDeg: number; zoneDeg: number }
export interface FishRound { kind: "fish"; a1: number; w1: number; p1: number; a2: number; w2: number; p2: number }
export interface PullRound { kind: "pull"; looseMs: number }
export type RoundParams = ChopRound | MineRound | FishRound | PullRound;

export interface MinigameRound {
  id: string;
  petId: string;
  nodeId: string;
  resource: Resource;
  params: RoundParams;
  expiresInMs: number;
}

const lerp = (r: Rng, [lo, hi]: readonly [number, number]) => lo + (hi - lo) * (r.int(10_001) / 10_000);

export function makeRound(seedHex: string, label: string, resource: Resource): RoundParams {
  const r = new Rng(seedHex, `minigame:${label}`);
  switch (MINIGAME_FOR[resource]) {
    case "chop": return { kind: "chop", periodMs: lerp(r, MINIGAMES.chop.periodMs), phase: r.int(1000) / 1000, center: 0.25 + r.int(501) / 1000 };
    case "mine": return { kind: "mine", degPerSec: lerp(r, MINIGAMES.mine.degPerSec), startDeg: r.int(360), zoneDeg: 60 + r.int(240) };
    case "fish": return { kind: "fish", a1: 0.62 + r.int(201) / 1000, w1: 2.1 + r.int(900) / 1000, p1: r.int(6283) / 1000, a2: 0.12 + r.int(101) / 1000, w2: 5.2 + r.int(1200) / 1000, p2: r.int(6283) / 1000 };
    case "pull": return { kind: "pull", looseMs: lerp(r, MINIGAMES.pull.looseMs) };
  }
}

/** Woodcutting marker position 0..1 (ping-pong). */
export function chopMarker(p: ChopRound, ms: number): number {
  const t = (ms / p.periodMs + p.phase) % 1;
  return t < 0.5 ? t * 2 : 2 - t * 2;
}
/** Mining marker angle in degrees. */
export function mineAngle(p: MineRound, ms: number): number {
  return (p.startDeg + (p.degPerSec * ms) / 1000) % 360;
}
/** Fish horizontal position -1..1 relative to the bait (0 = on the bait). */
export function fishX(p: FishRound, ms: number): number {
  const s = ms / 1000;
  return Math.max(-1, Math.min(1, p.a1 * Math.sin(p.w1 * s + p.p1) + p.a2 * Math.sin(p.w2 * s + p.p2)));
}
/** Herb root looseness for a given hold time (1.0 = the ideal release moment). */
export function pullLoose(p: PullRound, holdMs: number): number {
  return holdMs / p.looseMs;
}

const angDist = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** Server-side grading. `ms` = tap time since the round appeared (or hold duration for "pull"). */
export function gradeRound(p: RoundParams, ms: number): { grade: Grade; detail: string } {
  switch (p.kind) {
    case "chop": {
      const d = Math.abs(chopMarker(p, ms) - p.center);
      return { grade: d <= MINIGAMES.chop.perfect ? "perfect" : d <= MINIGAMES.chop.good ? "good" : "miss", detail: d.toFixed(3) };
    }
    case "mine": {
      const d = angDist(mineAngle(p, ms), p.zoneDeg);
      return { grade: d <= MINIGAMES.mine.perfectDeg ? "perfect" : d <= MINIGAMES.mine.goodDeg ? "good" : "miss", detail: d.toFixed(1) };
    }
    case "fish": {
      const d = Math.abs(fishX(p, ms));
      return { grade: d <= MINIGAMES.fish.perfect ? "perfect" : d <= MINIGAMES.fish.good ? "good" : "miss", detail: d.toFixed(3) };
    }
    case "pull": {
      const l = pullLoose(p, ms);
      const [pl, ph] = MINIGAMES.pull.perfect, [gl, gh] = MINIGAMES.pull.good;
      const grade: Grade = l >= pl && l <= ph ? "perfect" : l >= gl && l <= gh ? "good" : "miss";
      return { grade, detail: l < gl ? "too early" : l > gh ? "too late" : l.toFixed(2) };
    }
  }
}

// ------------------------------------------------------------- Bubble Roulette

export const BUBBLE = {
  slots: 6,
  loaded: 3,
  /** Battle HP is the pet's HP as a 0–100 score; a splash costs this much (two hits end a full-HP pet). */
  splashHp: 50,
  /** Extra time on the very first turn so players can read the how-to-play card. */
  firstTurnGraceMs: 10_000,
  /** Minimum battle HP to enter a match. */
  minHp: 20,
  turnMs: 15_000,
  /** Consecutive missed turns before forfeiting (published policy). */
  maxMissedTurns: 2,
  inviteMs: 25_000,
  /** Grace after a disconnect before the absent player's turns start timing out normally. */
  reconnectGraceMs: 20_000,
} as const;

/** A fresh shuffled chamber, e.g. [false,true,false,false,true,false]. Deterministic per match/chamber. */
export function makeChamber(seedHex: string, matchId: string, chamberNo: number): boolean[] {
  const r = new Rng(seedHex, `bubble:${matchId}:${chamberNo}`);
  const slots = Array.from({ length: BUBBLE.slots }, (_, i) => i < BUBBLE.loaded);
  for (let i = slots.length - 1; i > 0; i--) { const j = r.int(i + 1); [slots[i], slots[j]] = [slots[j]!, slots[i]!]; }
  return slots;
}

export const toBattleHp = (hp: number, maxHp: number) => Math.max(0, Math.min(100, Math.ceil((hp / Math.max(1, maxHp)) * 100)));
export const fromBattleHp = (battleHp: number, maxHp: number) => Math.round((Math.max(0, battleHp) / 100) * maxHp);
