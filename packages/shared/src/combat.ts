/**
 * Deterministic battle engine. Same inputs + seed => same result, so every
 * battle can be re-verified from the audit log after the epoch seed reveal.
 */
import { ECONOMY, RESOURCES, type Resource, type Stats } from "./config.ts";
import { Rng } from "./rng.ts";

export interface Combatant {
  id: string;
  stats: Stats; // effective stats (base + equipment)
  hp: number;
  energy: number;
}

export interface Exchange {
  attacker: 0 | 1;
  hit: boolean;
  crit: boolean;
  damage: number;
  hpAfter: [number, number];
}

export interface BattleResult {
  exchanges: Exchange[];
  /** 0 or 1 = index of winner; null = draw. */
  winner: 0 | 1 | null;
  hp: [number, number];
  energy: [number, number];
  knockedOut: [boolean, boolean];
}

function fatigueBps(energy: number, maxEnergy: number): number {
  const share = energy / Math.max(1, maxEnergy);
  if (share < 0.1) return 7_000;
  if (share < 0.3) return 8_500;
  return 10_000;
}

export function simulateBattle(a: Combatant, b: Combatant, seedHex: string, label: string): BattleResult {
  const rng = new Rng(seedHex, `battle:${label}`);
  const c = [a, b] as const;
  const hp: [number, number] = [a.hp, b.hp];
  const en: [number, number] = [a.energy, b.energy];
  const ex: Exchange[] = [];
  const cost = ECONOMY.stats.battleEnergyPerExchange;

  for (let i = 0; i < ECONOMY.battle.maxExchanges && hp[0] > 0 && hp[1] > 0; i++) {
    // Initiative: speed + luck, randomized each exchange.
    const ia = c[0].stats.speed + c[0].stats.luck / 2 + rng.int(60);
    const ib = c[1].stats.speed + c[1].stats.luck / 2 + rng.int(60);
    const order: Array<0 | 1> = ia >= ib ? [0, 1] : [1, 0];
    for (const att of order) {
      const def = (1 - att) as 0 | 1;
      if (hp[0] <= 0 || hp[1] <= 0) break;
      const A = c[att].stats;
      const D = c[def].stats;
      // Hit chance 78% +/- luck difference, clamped 55..95%.
      const hitPpm = Math.max(550_000, Math.min(950_000, 780_000 + (A.luck - D.luck) * 4_000));
      const hit = rng.chancePpm(hitPpm);
      let damage = 0;
      let crit = false;
      if (hit) {
        const roll = rng.range(8_000, 12_000); // 80%..120%
        crit = rng.chancePpm(60_000 + Math.max(0, A.luck - 100) * 2_000);
        const raw = (A.attack * roll) / 10_000;
        const mitigated = (raw * 100) / (100 + D.defense);
        damage = Math.max(1, Math.floor(mitigated * 1.2 * (fatigueBps(en[att], A.maxEnergy) / 10_000) * (crit ? 1.5 : 1)));
        hp[def] = Math.max(0, hp[def] - damage);
      }
      en[att] = Math.max(0, en[att] - cost);
      ex.push({ attacker: att, hit, crit, damage, hpAfter: [hp[0], hp[1]] });
    }
  }

  let winner: 0 | 1 | null = null;
  if (hp[0] <= 0 && hp[1] > 0) winner = 1;
  else if (hp[1] <= 0 && hp[0] > 0) winner = 0;
  else {
    // Judges' decision on remaining HP share; exact tie => draw.
    const s0 = hp[0] * c[1].stats.maxHp;
    const s1 = hp[1] * c[0].stats.maxHp;
    winner = s0 === s1 ? null : s0 > s1 ? 0 : 1;
  }
  return { exchanges: ex, winner, hp, energy: en, knockedOut: [hp[0] <= 0, hp[1] <= 0] };
}

export type Inventory = Record<Resource, number>;
export const emptyInventory = (): Inventory => ({ fish: 0, herbs: 0, wood: 0, minerals: 0 });

/** How much weight a pet's bag holds (base carry stat × carryScale). */
export function carryCapacity(stats: { carry: number }): number {
  return stats.carry * ECONOMY.stats.carryScale;
}

/** Fixed stock of a resource spot, 100k–500k, deterministic from its id. */
export function nodeStock(id: string): number {
  if (id.startsWith("glade-")) return 10; // tutorial spots: one good hit collects it all
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  const { nodeStockMin: lo, nodeStockMax: hi } = ECONOMY.gather;
  return lo + Math.round((((h >>> 0) % 10_000) / 10_000) * (hi - lo) / 1000) * 1000;
}

export function inventoryWeight(inv: Inventory): number {
  return RESOURCES.reduce((s, r) => s + inv[r] * ECONOMY.resources[r].weight, 0);
}

/**
 * Theft after a decisive battle: up to theftMaxBps of each eligible carried
 * resource, limited by the winner's free carrying capacity. Protected
 * inventory is never passed in here.
 */
export function computeTheft(loserCarried: Inventory, winnerCarried: Inventory, winnerCapacity: number, shareBps: number = ECONOMY.battle.theftMaxBps): Inventory {
  const take = emptyInventory();
  let free = winnerCapacity - inventoryWeight(winnerCarried);
  for (const r of RESOURCES) {
    const max = Math.floor((loserCarried[r] * shareBps) / 10_000);
    const w = ECONOMY.resources[r].weight;
    const n = Math.max(0, Math.min(max, Math.floor(free / w)));
    take[r] = n;
    free -= n * w;
  }
  return take;
}

/**
 * Bubble Roulette spoils share (bps) from both pets' luck and a fair roll u in [0, 1].
 * Equal luck: 5%–15% (average 10%). Luckier winners take more, luckier losers lose less.
 */
export function battleTakeBps(luckWinner: number, luckLoser: number, u: number): number {
  const s = ECONOMY.battle.stake;
  const edge = (2 * luckWinner) / Math.max(1, luckWinner + luckLoser);
  const raw = s.baseShareBps * edge * (0.5 + Math.max(0, Math.min(1, u)));
  return Math.round(Math.max(s.minShareBps, Math.min(s.maxShareBps, raw)));
}
