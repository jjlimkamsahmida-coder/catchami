/**
 * Demand indexes and treasury budget rules. Pure functions so the server, the
 * economy simulation and the tests all use the exact same logic.
 */
import { ECONOMY, RESOURCES, type Resource } from "./config.ts";
import { bps, minBig, tokens } from "./money.ts";

// ---------------------------------------------------------------- demand ---

/** Smoothed rate tracker: units per hour, exponentially decayed. */
export interface RateState {
  consumed: number; // EMA units/hour of real consumption events (meals, medicine, crafting)
  supplied: number; // EMA units/hour of real merchant purchases
  indexBps: number; // published, capped, step-limited index
  updatedAt: number; // ms
}

export type DemandState = Record<Resource, RateState>;

export function initialDemand(now: number): DemandState {
  return Object.fromEntries(
    RESOURCES.map((r) => [r, { consumed: 0, supplied: 0, indexBps: 10_000, updatedAt: now }]),
  ) as unknown as DemandState;
}

/**
 * Decay both EMAs to `now`, add the new event counts, and step the published
 * index toward the target ratio (consumed+k)/(supplied+k), capped to
 * [minIndexBps, maxIndexBps] and at most maxStepBps per recompute.
 */
export function updateDemand(
  prev: RateState,
  now: number,
  addConsumed: number,
  addSupplied: number,
): RateState {
  const cfg = ECONOMY.demand;
  const dtH = Math.max(0, (now - prev.updatedAt) / 3_600_000);
  const decay = Math.pow(0.5, (dtH * 3600) / cfg.halfLifeSec);
  // Convert events into an hourly rate contribution: an event "counts" for one half-life window.
  const windowH = cfg.halfLifeSec / 3600;
  const consumed = prev.consumed * decay + addConsumed / windowH;
  const supplied = prev.supplied * decay + addSupplied / windowH;
  const k = 4; // pseudo-count damping so a handful of events can't swing price
  const target = Math.round(((consumed + k) / (supplied + k)) * 10_000);
  const clampedTarget = Math.max(cfg.minIndexBps, Math.min(cfg.maxIndexBps, target));
  const step = Math.max(-cfg.maxStepBps, Math.min(cfg.maxStepBps, clampedTarget - prev.indexBps));
  return { consumed, supplied, indexBps: prev.indexBps + step, updatedAt: now };
}

export type DemandLevel = "low" | "medium" | "high";
export function demandLevel(indexBps: number): DemandLevel {
  if (indexBps < ECONOMY.demand.lowBelowBps) return "low";
  if (indexBps > ECONOMY.demand.highAboveBps) return "high";
  return "medium";
}

/** Merchant buying price per unit = base x demand index x treasury factor. */
export function merchantPrice(r: Resource, indexBps: number, treasuryFactorBps: number): bigint {
  const base = ECONOMY.resources[r].basePrice;
  return (base * BigInt(indexBps) * BigInt(treasuryFactorBps)) / 100_000_000n;
}

// -------------------------------------------------------------- treasury ---

export const HQ_ALLOCATION = tokens(ECONOMY.allocation.hqWhole);
export const HQ_RESERVE_FLOOR = bps(HQ_ALLOCATION, ECONOMY.hq.reserveFloorBps);

/**
 * Treasury health factor in bps (0..10000). 100% while HQ available funds are
 * at least taperStartMultiple x floor; linear down to 0 at the floor.
 */
export function treasuryFactorBps(hqAvailable: bigint): number {
  const floor = HQ_RESERVE_FLOOR;
  if (hqAvailable <= floor) return 0;
  const full = floor * BigInt(ECONOMY.hq.taperStartMultiple);
  if (hqAvailable >= full) return 10_000;
  return Number(((hqAvailable - floor) * 10_000n) / (full - floor));
}

export interface DailyBudget {
  total: bigint;
  merchants: bigint;
  factorBps: number;
  spendable: bigint;
  avgRevenue: bigint;
}

/** Journal kinds that count as HQ revenue: coins players spent on the game (never grants, deposits or gifts). */
export const REVENUE_KINDS = ["catch_success", "catch_failed", "food", "medicine", "craft", "nft_sale", "battle_win"] as const;

/**
 * The day's merchant budget:
 *   min(0.01% × spendable + 60% × 7-day average daily revenue, 0.03% × spendable)
 * where spendable = HQ available − reserve floor. With no revenue HQ halves in
 * ~19 years; HQ grows whenever revenue is above 0.025% of spendable per day.
 */
export function dailyBudget(hqAvailableAtDayStart: bigint, avgDailyRevenue = 0n): DailyBudget {
  const h = ECONOMY.hq;
  const factorBps = treasuryFactorBps(hqAvailableAtDayStart);
  const spendable = hqAvailableAtDayStart > HQ_RESERVE_FLOOR ? hqAvailableAtDayStart - HQ_RESERVE_FLOOR : 0n;
  const avgRevenue = avgDailyRevenue > 0n ? avgDailyRevenue : 0n;
  const total = minBig(bps(spendable, h.budgetReserveBps) + bps(avgRevenue, h.budgetRevenueShareBps), bps(spendable, h.budgetCapReserveBps));
  return { total, merchants: total, factorBps, spendable, avgRevenue };
}

/**
 * Next merchant trip budget. Returns 0n (merchant unavailable) if the minimum
 * cannot be covered by the remaining merchant allowance AND HQ funds above
 * the reserve floor.
 */
export function merchantTripBudget(opts: {
  merchantAllowanceRemaining: bigint;
  hqAvailable: bigint;
  merchantsSharing: number;
  merchantCash: bigint;
}): { grant: bigint; available: boolean } {
  const { tripMinBudget, tripMaxBudget } = ECONOMY.merchants;
  const aboveFloor = opts.hqAvailable > HQ_RESERVE_FLOOR ? opts.hqAvailable - HQ_RESERVE_FLOOR : 0n;
  const share = opts.merchantAllowanceRemaining / BigInt(Math.max(1, opts.merchantsSharing));
  const target = minBig(tripMaxBudget, share);
  const topUp = target > opts.merchantCash ? target - opts.merchantCash : 0n;
  const grant = minBig(topUp, opts.merchantAllowanceRemaining, aboveFloor);
  if (opts.merchantCash + grant < tripMinBudget) return { grant: 0n, available: false };
  return { grant, available: true };
}

/** Shop price for a meal / medicine dose: local (uses real HQ stock) or imported at a premium when HQ is out. */
export function shopPrice(item: "food" | "medicine", hqStock: number): { price: bigint; imported: boolean } {
  const cfg = item === "food" ? ECONOMY.food : ECONOMY.medicine;
  const need = item === "food" ? ECONOMY.food.fishPerMeal : ECONOMY.medicine.herbsPerDose;
  if (hqStock >= need) return { price: cfg.price, imported: false };
  return { price: (cfg.price * BigInt(cfg.importMultBps)) / 10_000n, imported: true };
}
