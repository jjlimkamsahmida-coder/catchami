import { describe, expect, it } from "vitest";
import {
  ECONOMY, TOTAL_SUPPLY, tokens, splitBps, parseTokens, toDecimalString, formatTokens,
  Rng, commitmentOf, verifyCommitment, randomSeedHex, rollCatch, generateGenome, effectiveStats,
  simulateBattle, computeTheft, emptyInventory, dailyBudget, HQ_ALLOCATION, HQ_RESERVE_FLOOR,
  treasuryFactorBps, merchantTripBudget, updateDemand, initialDemand, merchantPrice,
  generateWorld, findPath, walkable, CATCH_TIERS, STAT_KEYS, type Rarity,
} from "../src/index.ts";

describe("money", () => {
  it("supply and allocations are exact", () => {
    const a = ECONOMY.allocation;
    expect(tokens(a.hqWhole + a.marketWhole + a.teamWhole)).toBe(TOTAL_SUPPLY);
    expect(TOTAL_SUPPLY < 2n ** 128n).toBe(true); // fits u128 onchain
  });
  it("catch split matches the spec example and never loses dust", () => {
    const s = splitBps(tokens(1_000_000), ECONOMY.catch.successSplit, "hq");
    expect(s).toEqual({ pet: tokens(800_000), hq: tokens(180_000), team: tokens(20_000) });
    for (const amt of [1n, 7n, 999_999n, 10n ** 30n + 3n]) {
      const p = splitBps(amt, ECONOMY.catch.successSplit, "hq");
      expect(p.pet + p.hq + p.team).toBe(amt);
    }
  });
  it("parses and formats", () => {
    expect(parseTokens("1.5")).toBe(tokens(1) + 5n * 10n ** 17n);
    expect(toDecimalString(parseTokens("1234.000001"))).toBe("1234.000001");
    expect(formatTokens(tokens(1_250_000))).toBe("1.25M");
    expect(formatTokens(tokens(40_000_000_000_000))).toBe("40T");
    expect(formatTokens(tokens(12_000))).toBe("12K");
  });
});

describe("fair randomness", () => {
  it("commit-reveal verifies and is deterministic", () => {
    const seed = randomSeedHex();
    expect(verifyCommitment(seed, commitmentOf(seed))).toBe(true);
    expect(verifyCommitment(randomSeedHex(), commitmentOf(seed))).toBe(false);
    const a = new Rng(seed, "x"), b = new Rng(seed, "x");
    for (let i = 0; i < 50; i++) expect(a.int(1000)).toBe(b.int(1000));
  });
  it("rarity tables sum to exactly 1e6", () => {
    for (const t of CATCH_TIERS) expect(Object.values(ECONOMY.catch.rarityPpm[t]).reduce((s, v) => s + v, 0)).toBe(1_000_000);
  });
  it("catch success rate matches disclosed probability (statistical)", () => {
    const seed = randomSeedHex();
    for (const tier of CATCH_TIERS) {
      let ok = 0; const N = 20_000;
      for (let i = 0; i < N; i++) if (rollCatch(seed, `t${i}`, tier).success) ok++;
      const p = ECONOMY.catch.tiers[tier].successPpm / 1e6;
      const sd = Math.sqrt((p * (1 - p)) / N);
      expect(Math.abs(ok / N - p)).toBeLessThanOrEqual(5 * sd);
    }
  });
  it("premium never guarantees mythic", () => {
    // Demo odds make rare pets common, but no tier ever guarantees Mythic.
    expect(ECONOMY.catch.rarityPpm.premium.mythic).toBeLessThan(1_000_000 / 4);
  });
});

describe("pets", () => {
  it("rarity bonus is an aggregate budget, not per-stat", () => {
    const seed = randomSeedHex();
    const avg = (r: Rarity) => {
      let tot = 0; const N = 400;
      for (let i = 0; i < N; i++) {
        const g = generateGenome(seed, `${r}${i}`, "cat", r);
        tot += STAT_KEYS.reduce((s, k) => s + g.stats[k] / (g.stats[k] > 500 ? 10 : 1), 0);
      }
      return tot / N;
    };
    const c = avg("common"), m = avg("mythic");
    expect(m / c).toBeGreaterThan(1.0);
    expect(m / c).toBeLessThan(1.02);
  });
  it("equipment bonus is capped and trade-offs apply", () => {
    const g = generateGenome(randomSeedHex(), "e", "dog", "common");
    const eff = effectiveStats(g.stats, [{ kind: "weapon", rarity: "mythic" }, { kind: "armor", rarity: "mythic" }]);
    expect(eff.attack / g.stats.attack).toBeLessThan(1.1);
    const heavy = effectiveStats(g.stats, [{ kind: "heavy_armor", rarity: "common" }]);
    expect(heavy.speed).toBeLessThan(g.stats.speed);
  });
});

describe("battles", () => {
  it("a common has a genuine chance against a mythic", () => {
    const seed = randomSeedHex();
    let commonWins = 0; const N = 1500;
    for (let i = 0; i < N; i++) {
      const c = generateGenome(seed, `c${i}`, "cat", "common");
      const m = generateGenome(seed, `m${i}`, "dog", "mythic");
      const r = simulateBattle(
        { id: "c", stats: c.stats, hp: c.stats.maxHp, energy: c.stats.maxEnergy },
        { id: "m", stats: m.stats, hp: m.stats.maxHp, energy: m.stats.maxEnergy },
        seed, `b${i}`,
      );
      if (r.winner === 0) commonWins++;
    }
    expect(commonWins / N).toBeGreaterThan(0.3);
  });
  it("HP persists and never goes negative", () => {
    const seed = randomSeedHex();
    const g = generateGenome(seed, "a", "cat", "rare");
    const r = simulateBattle({ id: "a", stats: g.stats, hp: 40, energy: 500 }, { id: "b", stats: g.stats, hp: 1000, energy: 1000 }, seed, "z");
    expect(r.hp[0]).toBeGreaterThanOrEqual(0);
    expect(r.hp[0]).toBeLessThanOrEqual(40);
  });
  it("a fresh pet is not one-shot in a single battle", () => {
    const seed = randomSeedHex();
    let kos = 0;
    for (let i = 0; i < 500; i++) {
      const a = generateGenome(seed, `a${i}`, "cat", "common"), b = generateGenome(seed, `b${i}`, "dog", "common");
      const r = simulateBattle({ id: "a", stats: a.stats, hp: a.stats.maxHp, energy: 1000 }, { id: "b", stats: b.stats, hp: b.stats.maxHp, energy: 1000 }, seed, `${i}`);
      if (r.knockedOut[0] || r.knockedOut[1]) kos++;
    }
    expect(kos / 500).toBeLessThan(0.05);
  });
  it("theft is limited to 15% and to free capacity", () => {
    const loser = { fish: 20, herbs: 10, wood: 0, minerals: 7 };
    expect(computeTheft(loser, emptyInventory(), 1000)).toEqual({ fish: 3, herbs: 1, wood: 0, minerals: 1 });
    const t2 = computeTheft(loser, emptyInventory(), 3);
    expect(t2.fish * 2 + t2.herbs + t2.minerals * 4).toBeLessThanOrEqual(3);
  });
});

describe("treasury", () => {
  it("daily budget is 0.05% of available, 85/15", () => {
    const b = dailyBudget(HQ_ALLOCATION);
    expect(b.total).toBe(HQ_ALLOCATION / 2000n);
    expect(b.merchants + b.rewards).toBe(b.total);
    expect(b.merchants).toBe((b.total * 8500n) / 10000n);
  });
  it("tapers to zero at the reserve floor and never dips below it", () => {
    expect(treasuryFactorBps(HQ_RESERVE_FLOOR)).toBe(0);
    expect(dailyBudget(HQ_RESERVE_FLOOR).total).toBe(0n);
    expect(dailyBudget(HQ_RESERVE_FLOOR + tokens(1000)).total).toBeLessThanOrEqual(tokens(1000));
  });
  it("merchant sits out rather than receiving nonexistent money", () => {
    const r = merchantTripBudget({ merchantAllowanceRemaining: tokens(10), hqAvailable: HQ_ALLOCATION, merchantsSharing: 4, merchantCash: 0n });
    expect(r).toEqual({ grant: 0n, available: false });
    const ok = merchantTripBudget({ merchantAllowanceRemaining: tokens(17_000_000_000), hqAvailable: HQ_ALLOCATION, merchantsSharing: 4, merchantCash: 0n });
    expect(ok).toEqual({ grant: ECONOMY.merchants.tripMaxBudget, available: true });
  });
});

describe("demand", () => {
  it("consumption raises the index, supply lowers it, step-limited and capped", () => {
    let s = initialDemand(0).fish;
    for (let i = 1; i <= 200; i++) s = updateDemand(s, i * 60_000, 50, 0);
    expect(s.indexBps).toBe(ECONOMY.demand.maxIndexBps);
    let d = initialDemand(0).fish;
    const one = updateDemand(d, 60_000, 100_000, 0);
    expect(one.indexBps - d.indexBps).toBeLessThanOrEqual(ECONOMY.demand.maxStepBps);
    for (let i = 1; i <= 200; i++) d = updateDemand(d, i * 60_000, 0, 50);
    expect(d.indexBps).toBe(ECONOMY.demand.minIndexBps);
    expect(merchantPrice("fish", 10_000, 10_000)).toBe(ECONOMY.resources.fish.basePrice);
    expect(merchantPrice("fish", 10_000, 5_000)).toBe(ECONOMY.resources.fish.basePrice / 2n);
  });
});

describe("world", () => {
  it("is deterministic, and every node and POI is reachable from HQ", () => {
    const w = generateWorld();
    const w2 = generateWorld();
    expect(Buffer.from(w.tiles).equals(Buffer.from(w2.tiles))).toBe(true);
    const counts = { fish: 0, herbs: 0, wood: 0, minerals: 0 };
    for (const n of w.nodes) counts[n.resource]++;
    for (const v of Object.values(counts)) expect(v).toBeGreaterThanOrEqual(6);
    const hx = w.pois[0]!.tx, hy = w.pois[0]!.ty;
    expect(walkable(w, hx, hy)).toBe(true);
    for (const n of w.nodes.filter((q) => !q.id.startsWith("glade"))) {
      const spots = [[0, 1], [1, 0], [-1, 0], [0, -1]].map(([dx, dy]) => [n.tx + dx!, n.ty + dy!] as const).filter(([x, y]) => walkable(w, x, y));
      expect(spots.length, n.id).toBeGreaterThan(0);
      expect(spots.some(([x, y]) => findPath(w, hx, hy, x, y, 200000) !== null), `node ${n.id} reachable`).toBe(true);
    }
    for (const p of w.pois.filter((q) => !q.id.startsWith("glade"))) expect(findPath(w, hx, hy, p.tx, p.ty, 200000), p.id).not.toBeNull();
  });
});
