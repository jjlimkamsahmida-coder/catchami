import {
  ECONOMY, EQUIPMENT, PET_NAMES, SPECIES_AFFINITY, SPECIES_BASE, STAT_KEYS, TRAITS,
  type CatchTier, type EquipmentKind, type Rarity, type Resource, type Species, type StatKey, type Stats,
} from "./config.ts";
import { Rng } from "./rng.ts";

export interface CatchRoll {
  success: boolean;
  rarity: Rarity | null;
  /** Raw draws for the audit trail. */
  successDraw: number;
  rarityDraw: number | null;
}

/** Catch outcome for a validated attempt. Deterministic given seed + label. */
export function rollCatch(seedHex: string, label: string, tier: CatchTier): CatchRoll {
  const rng = new Rng(seedHex, `catch:${label}`);
  const successDraw = rng.int(1_000_000);
  const success = successDraw < ECONOMY.catch.tiers[tier].successPpm;
  if (!success) return { success, rarity: null, successDraw, rarityDraw: null };
  const rarityDraw = rng.int(1_000_000);
  const table = ECONOMY.catch.rarityPpm[tier];
  let r = rarityDraw;
  let rarity: Rarity = "common";
  for (const k of Object.keys(table) as Rarity[]) {
    r -= table[k];
    if (r < 0) { rarity = k; break; }
  }
  return { success, rarity, successDraw, rarityDraw };
}

export interface PetGenome {
  species: Species;
  rarity: Rarity;
  name: string;
  traits: string[];
  /** Permanent base stats (species x natural variation x rarity x traits). */
  stats: Stats;
  /** Visual variation for the sticker treatment. */
  look: { hue: number; outline: number; pattern: number; bounce: number };
}

function applyBps(v: number, b: number): number {
  return Math.max(1, Math.floor((v * (10_000 + b)) / 10_000));
}

/**
 * Generates the permanent genome. Rarity gets a TOTAL bonus budget
 * (e.g. Mythic 500 bps) spread across stats — never the full bonus on every
 * stat — while natural variation (+/-400 bps per stat) dominates, so a
 * Common can out-stat a Mythic.
 */
export function generateGenome(seedHex: string, label: string, species: Species, rarity: Rarity): PetGenome {
  const rng = new Rng(seedHex, `genome:${label}`);
  const base = SPECIES_BASE[species];
  const bonus: Record<StatKey, number> = Object.fromEntries(STAT_KEYS.map((k) => [k, 0])) as Record<StatKey, number>;

  const nv = ECONOMY.naturalVariationBps;
  for (const k of STAT_KEYS) bonus[k] += rng.range(-nv, nv);

  // Spread the rarity budget in 25 bps chunks over random stats.
  let budget = ECONOMY.rarityBonusBudgetBps[rarity];
  while (budget > 0) {
    const k = rng.pick(STAT_KEYS);
    const chunk = Math.min(25, budget);
    bonus[k] += chunk;
    budget -= chunk;
  }

  const t1 = rng.int(TRAITS.length);
  let t2 = rng.int(TRAITS.length - 1);
  if (t2 >= t1) t2 += 1;
  const traits = [TRAITS[t1]!.id, TRAITS[t2]!.id];
  for (const id of traits) {
    const def = TRAITS.find((t) => t.id === id)!;
    for (const [k, v] of Object.entries(def.statBps)) bonus[k as StatKey] += v;
  }

  const stats = Object.fromEntries(STAT_KEYS.map((k) => [k, applyBps(base[k], bonus[k])])) as Stats;
  return {
    species,
    rarity,
    name: rng.pick(PET_NAMES),
    traits,
    stats,
    look: { hue: rng.int(360), outline: rng.int(4), pattern: rng.int(6), bounce: rng.range(80, 120) },
  };
}

export interface EquippedItem {
  kind: EquipmentKind;
  rarity: Rarity;
}

/**
 * Effective stats = base stats + capped equipment bonus. Positive equipment
 * bonuses are summed and scaled down so their total never exceeds
 * ECONOMY.equipment.totalBonusCapBps; penalties always apply in full.
 */
export function effectiveStats(base: Stats, equipped: EquippedItem[]): Stats {
  const items = equipped.slice(0, ECONOMY.equipment.slots);
  const pos: Partial<Record<StatKey, number>> = {};
  const neg: Partial<Record<StatKey, number>> = {};
  for (const it of items) {
    const mult = ECONOMY.equipment.rarityMultiplierBps[it.rarity];
    for (const [k, v] of Object.entries(EQUIPMENT[it.kind].bonusBps) as Array<[StatKey, number]>) {
      if (v > 0) pos[k] = (pos[k] ?? 0) + Math.floor((v * mult) / 10_000);
      else neg[k] = (neg[k] ?? 0) + v;
    }
  }
  const totalPos = Object.values(pos).reduce((s, v) => s + v, 0);
  const cap = ECONOMY.equipment.totalBonusCapBps;
  const scale = totalPos > cap ? cap / totalPos : 1;
  const out = { ...base };
  for (const k of STAT_KEYS) {
    const b = Math.floor((pos[k] ?? 0) * scale) + (neg[k] ?? 0);
    if (b !== 0) out[k] = applyBps(base[k], b);
  }
  return out;
}

/** Gather-speed bonus (bps) for a resource from species + traits. */
export function affinityBps(species: Species, traits: string[], r: Resource): number {
  let b = SPECIES_AFFINITY[species][r] ?? 0;
  for (const id of traits) b += TRAITS.find((t) => t.id === id)?.affinityBps?.[r] ?? 0;
  return b;
}

export function gatherDurationMs(species: Species, traits: string[], gatherStat: number, r: Resource): number {
  const base = ECONOMY.resources[r].gatherMs;
  const speedup = (gatherStat / 100) * (1 + affinityBps(species, traits, r) / 10_000);
  return Math.round(base / speedup);
}

export const RARITY_LABEL: Record<Rarity, string> = {
  common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic", legendary: "Legendary", mythic: "Mythic",
};
