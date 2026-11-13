/**
 * Deterministic autopilot. Runs for every pet whose owner enabled "auto",
 * online or offline. It only uses information the pet could legitimately
 * know (its own state, public merchant positions/preferences, global demand)
 * and only spends through the same authorized game actions a player uses.
 */
import { carryCapacity, ECONOMY, inventoryWeight, RESOURCE_LABEL, RESOURCES, tileCenter, toTile, type Resource } from "@catchami/shared";
import type { Game } from "./game.ts";
import type { MerchantRt, PetRt } from "./types.ts";

const challengeMemo = new WeakMap<PetRt, Map<string, number>>();

export function decide(g: Game, p: PetRt, now: number, urgentOnly = false) {
  const s = p.s, st = s.strategy;
  const fail = (e: Error) => { p.activity = e.message; };
  const avail = p.balance - p.held;

  if (s.status === "knocked_out") {
    if (st.buyMedicine && s.koUntil && now >= s.koUntil) {
      if (avail >= ECONOMY.medicine.price && g.hqStockCache.herbs >= ECONOMY.medicine.herbsPerDose) void g.buy(p, "medicine", `ai:${p.id}:${now}`).catch(fail);
      else p.activity = avail < ECONOMY.medicine.price ? "Needs tokens for medicine" : "Waiting for HQ herb stock";
    } else p.activity = "Recovering from a knockout";
    return;
  }

  // Hunger first.
  const canBuyFood = avail >= ECONOMY.food.price && g.hqStockCache.fish >= ECONOMY.food.fishPerMeal;
  if (s.hunger >= st.eatAtHunger || s.status === "inactive") {
    if (canBuyFood && s.hunger >= 50) { void g.buy(p, "food", `ai:${p.id}:${now}`).catch(fail); return; }
    if (s.inventory.fish > 0 && (s.hunger >= 850 || !canBuyFood || s.status === "inactive")) { try { g.eatOwn(p); } catch (e) { fail(e as Error); } return; }
    if (s.status === "inactive") { p.activity = "Inactive: no money or food — deposit tokens to recover"; return; }
  }
  if (st.buyMedicine && s.hp < p.stats.maxHp * 0.3 && avail >= ECONOMY.medicine.price && g.hqStockCache.herbs >= ECONOMY.medicine.herbsPerDose) {
    void g.buy(p, "medicine", `ai:${p.id}:${now}`).catch(fail);
    return;
  }
  if (urgentOnly) return;

  // Rest when tired.
  if (s.energy < ECONOMY.stats.exhaustedEnergy || (s.energy < st.restBelowEnergy && s.hunger < ECONOMY.stats.restMaxHunger)) {
    p.task = { kind: "rest" };
    p.activity = "Napping to recover energy";
    return;
  }
  if (st.work === "low" && s.energy < p.stats.maxEnergy * 0.5 && s.hunger < ECONOMY.stats.restMaxHunger) {
    p.task = { kind: "rest" };
    p.activity = "Taking it easy";
    return;
  }

  // Battles (only aggressive/balanced initiate).
  if ((st.battle === "aggressive" || st.battle === "balanced") && !g.flags.pauseBattles && !g.canBattle(p, now)) {
    const hpOk = s.hp * 10_000 >= p.stats.maxHp * Math.max(st.minHpBps, st.battle === "balanced" ? 7_000 : 0);
    if (hpOk) {
      const memo = challengeMemo.get(p) ?? new Map<string, number>();
      challengeMemo.set(p, memo);
      for (const t of g.pets.values()) {
        if (t === p || t.ownerId === p.ownerId || t.busy) continue;
        if (Math.hypot(t.s.x - s.x, t.s.y - s.y) > ECONOMY.battle.challengeRangePx) continue;
        if ((memo.get(t.id) ?? 0) > now) continue;
        if (st.battle === "balanced" && inventoryWeight(t.s.inventory) < 80) continue;
        memo.set(t.id, now + 5 * 60_000);
        void g.battle(p, t, "auto").catch(fail);
        return;
      }
    }
  }

  // Selling.
  const sellable = { ...s.inventory };
  for (const r of st.hold) sellable[r] = 0;
  sellable.fish = Math.max(0, sellable.fish - st.foodReserve);
  const sellW = inventoryWeight(sellable);
  const carryW = inventoryWeight(s.inventory);
  const minUnitW = Math.min(...RESOURCES.map((r) => ECONOMY.resources[r].weight));
  const cap = carryCapacity(p.stats);
  const full = carryW + 40 > cap || carryW >= cap * 0.85;
  const risky = carryW * 10_000 >= cap * st.maxCarryRiskBps;
  const wantSell = sellW >= minUnitW && (st.sell === "immediate" ? sellW >= 6 : full || risky);
  if (wantSell && !g.flags.pauseTrades) {
    const m = chooseMerchant(g, p, sellable, st.sell === "best_price");
    if (m) {
      p.task = { kind: "sell", merchantId: m.id };
      g.pathTo(p, toTile(m.x), toTile(m.y));
      p.activity = `Heading to ${m.name} to sell`;
      return;
    }
    if (full) { p.activity = "Bag full — waiting for a merchant"; goNear(g, p, "hq"); return; }
  }

  // Gathering.
  const resource = pickResource(g, st.resource);
  const free = carryCapacity(p.stats) - carryW;
  if (free < ECONOMY.resources[resource].weight) { p.activity = "Bag full"; return; }
  const nodes = [...g.nodes.values()].filter((n) => n.resource === resource && n.remaining > 0)
    .map((n) => ({ n, d: Math.hypot(tileCenter(n.tx) - s.x, tileCenter(n.ty) - s.y) }))
    .sort((a, b) => a.d - b.d);
  const choice = nodes[Math.min(nodes.length - 1, Math.floor(Math.random() * Math.min(3, nodes.length)))];
  if (!choice) { p.activity = `No ${resource} left nearby — waiting for regrowth`; return; }
  p.task = { kind: "gather", nodeId: choice.n.id, endsAt: null, repeat: true };
  p.activity = `Going to gather ${RESOURCE_LABEL[resource].toLowerCase()}`;
  if (st.work === "low") p.nextThink = now + 6_000;
}

function pickResource(g: Game, pref: Resource | "demand"): Resource {
  if (pref !== "demand") return pref;
  let best: Resource = "fish", bv = -1n;
  for (const r of RESOURCES) {
    // Expected value per weight at current demand.
    const v = (ECONOMY.resources[r].basePrice * BigInt(g.demand[r].indexBps)) / BigInt(ECONOMY.resources[r].weight);
    if (v > bv) { bv = v; best = r; }
  }
  return best;
}

function chooseMerchant(g: Game, p: PetRt, sellable: Record<Resource, number>, bestPrice: boolean): MerchantRt | null {
  let best: MerchantRt | null = null, bs = -Infinity;
  for (const m of g.merchants) {
    if (m.state !== "travelling" && m.state !== "returning") continue;
    const d = Math.hypot(m.x - p.s.x, m.y - p.s.y);
    let score = -d;
    if (bestPrice) {
      const pref = RESOURCES.reduce((sum, r) => sum + sellable[r] * (10_000 + (m.prefs[r] ?? 0)), 0);
      score = pref / (d + 400);
    }
    if (score > bs) { bs = score; best = m; }
  }
  return best;
}

function goNear(g: Game, p: PetRt, poiId: string) {
  const poi = g.world.pois.find((q) => q.id === poiId);
  if (poi && Math.hypot(tileCenter(poi.tx) - p.s.x, tileCenter(poi.ty) - p.s.y) > 96) g.pathTo(p, poi.tx, poi.ty);
}
