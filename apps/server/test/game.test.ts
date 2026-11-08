import { describe, expect, it, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import jpeg from "jpeg-js";
import { ECONOMY, generateGenome, randomSeedHex, tileCenter, tokens, standSpot, splitBps } from "@catchami/shared";
import { openDb, type Db } from "../src/db/index.ts";
import { ensureGenesis } from "../src/ledger/treasury.ts";
import { acct, balanceOf, ensureAccount, post } from "../src/ledger/ledger.ts";
import { createGuest, newId } from "../src/auth.ts";
import { Game } from "../src/world/game.ts";
import { freshPetState } from "../src/world/types.ts";
import { loadDetector } from "../src/capture/detector.ts";
import { resolveAttempt, validateCapture } from "../src/capture/capture.ts";
import * as svc from "../src/services.ts";

let db: Db, game: Game;
let t = Date.UTC(2026, 10, 7, 12, 0, 0);
const advance = (ms: number) => { const end = t + ms; while (t < end) { t += 100; game.step(); } };

async function spawnPet(userId: string, species: "cat" | "dog", tileX: number, tileY: number) {
  const petId = newId("pet");
  const g = generateGenome(randomSeedHex(), petId, species, "common");
  const cost = ECONOMY.catch.tiers.basic.cost;
  const split = splitBps(cost, ECONOMY.catch.successSplit, "hq");
  await db.tx(async (tx) => {
    await ensureAccount(tx, acct.pet(petId), "pet", { petId, userId });
    await tx.query(`INSERT INTO pets (id, owner_id, species, rarity, name, genome, state) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [petId, userId, species, "common", g.name, JSON.stringify(g), JSON.stringify(freshPetState(tileCenter(tileX), tileCenter(tileY), g.stats))]);
    await post(tx, { idem: `test-catch:${petId}`, kind: "catch_success", postings: [{ account: acct.user(userId), amount: -cost }, { account: acct.pet(petId), amount: split.pet }, { account: acct.hq, amount: split.hq }, { account: acct.team, amount: split.team }] });
  });
  const p = (await game.reloadPet(petId))!;
  p.s.strategy.auto = false;
  return p;
}

let u1: { userId: string }, u2: { userId: string };

beforeAll(async () => {
  db = await openDb();
  await ensureGenesis(db);
  game = new Game(db);
  game.now = () => t;
  await game.load();
  u1 = await createGuest(db);
  u2 = await createGuest(db);
  await svc.devFaucet(db, u1.userId);
  await svc.devFaucet(db, u2.userId);
}, 60_000);

describe("capture flow (real detector, real ledger)", () => {
  const modelDir = join(import.meta.dirname, "..", "models");
  it.skipIf(!existsSync(join(modelDir, "ssdlite_mobilenet_v2", "group1-shard5of5")))("validates a live burst, charges only valid attempts, splits exactly", async () => {
    const det = await loadDetector(modelDir);
    const raw = await readFile(join(import.meta.dirname, "fixtures", "cat.jpg"));
    const img = jpeg.decode(raw, { useTArray: true, formatAsRGBA: true });
    // Simulate a second live frame: slight brightness shift + re-encode.
    const d2 = Buffer.from(img.data);
    for (let i = 0; i < d2.length; i += 4) { d2[i] = Math.min(255, d2[i]! + 6); d2[i + 1] = Math.min(255, d2[i + 1]! + 4); }
    const f2 = Buffer.from(jpeg.encode({ data: d2, width: img.width, height: img.height }, 85).data);

    const before = await db.tx((tx) => balanceOf(tx, acct.user(u1.userId)));
    // A still image (identical frames) is rejected and costs nothing.
    const still = await validateCapture(db, det, u1.userId, [raw, raw], game);
    expect(still.ok).toBe(false);
    const v = await validateCapture(db, det, u1.userId, [raw, f2], game);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.species).toBe("cat");
    expect((await db.tx((tx) => balanceOf(tx, acct.user(u1.userId)))).balance).toBe(before.balance);
    // Reusing the same photo is a duplicate.
    const dup = await validateCapture(db, det, u2.userId, [raw, f2], game);
    expect(dup.ok).toBe(false);

    const hqBefore = (await db.tx((tx) => balanceOf(tx, acct.hq))).balance;
    const teamBefore = (await db.tx((tx) => balanceOf(tx, acct.team))).balance;
    const res = await resolveAttempt(db, game, u1.userId, v.attemptId, "enhanced", "nonce_abcdefgh");
    const cost = ECONOMY.catch.tiers.enhanced.cost;
    const after = await db.tx((tx) => balanceOf(tx, acct.user(u1.userId)));
    expect(after.balance).toBe(before.balance - cost);
    const hqAfter = (await db.tx((tx) => balanceOf(tx, acct.hq))).balance;
    const teamAfter = (await db.tx((tx) => balanceOf(tx, acct.team))).balance;
    if (res.success) {
      expect(hqAfter - hqBefore).toBe((cost * 1800n) / 10000n);
      expect(teamAfter - teamBefore).toBe((cost * 200n) / 10000n);
      expect((await db.tx((tx) => balanceOf(tx, acct.pet(res.petId!)))).balance).toBe((cost * 8000n) / 10000n);
      expect(game.pets.get(res.petId!)?.species).toBe("cat");
    } else {
      expect(hqAfter - hqBefore).toBe(cost);
      expect(teamAfter).toBe(teamBefore);
    }
    // Cannot resolve twice.
    await expect(resolveAttempt(db, game, u1.userId, v.attemptId, "basic", "nonce_abcdefgh")).rejects.toMatchObject({ code: "resolved" });
  }, 120_000);
});

describe("gameplay economy loop", () => {
  it("gather -> sell to merchant -> deliver to HQ -> buy food -> battle -> marketplace", async () => {
    const fishNode = game.world.nodes.find((n) => n.resource === "fish")!;
    const spot = standSpot(game.world, fishNode.tx, fishNode.ty, fishNode.tx, fishNode.ty + 1)!;
    const p1 = await spawnPet(u1.userId, "cat", spot[0], spot[1]);
    const p2 = await spawnPet(u2.userId, "dog", spot[0], spot[1]);

    // Gather (server-authoritative timing).
    const c1 = { userId: u1.userId, displayName: "a", controlled: p1.id, lastMeta: 0, send: () => {} };
    await game.handle(c1, { t: "gather", petId: p1.id, nodeId: fishNode.id });
    advance(30_000);
    expect(p1.s.inventory.fish).toBeGreaterThanOrEqual(3);
    const caught = p1.s.inventory.fish;

    // Merchant gets a real HQ grant, then buys from the pet.
    const m = game.merchants.find((x) => x.id === "finn")!;
    const hqBefore = (await db.tx((tx) => balanceOf(tx, acct.hq))).balance;
    m.state = "at_hq";
    await game.merchantAtHq(m, t);
    expect(m.state).toBe("travelling");
    expect(m.cash).toBe(ECONOMY.merchants.tripMaxBudget);
    expect((await db.tx((tx) => balanceOf(tx, acct.merchant(m.id)))).balance).toBe(m.cash);
    expect((await db.tx((tx) => balanceOf(tx, acct.hq))).balance).toBeLessThan(hqBefore);
    m.path = []; m.x = p1.s.x + 20; m.y = p1.s.y; m.waitUntil = t + 600_000;
    const balBefore = p1.balance;
    const sale = await game.sell(p1, m.id, { fish: caught });
    expect(sale.sold.fish).toBe(caught);
    expect(p1.s.inventory.fish).toBe(0);
    expect((await db.tx((tx) => balanceOf(tx, acct.pet(p1.id)))).balance).toBe(balBefore + sale.total);
    expect((await db.tx((tx) => balanceOf(tx, acct.merchant(m.id)))).balance).toBe(ECONOMY.merchants.tripMaxBudget - sale.total);

    // Food is impossible until fish physically reaches HQ.
    p2.s.hunger = 700;
    await expect(game.buy(p2, "food")).rejects.toMatchObject({ code: "sold_out" });
    m.state = "at_hq";
    await game.merchantAtHq(m, t);
    expect(game.hqStockCache.fish).toBe(caught);
    p2.s.hunger = 700;
    const teamBefore = (await db.tx((tx) => balanceOf(tx, acct.team))).balance;
    await game.buy(p2, "food", "r1");
    expect(p2.s.hunger).toBe(700 - ECONOMY.food.hungerRestore);
    expect((await db.tx((tx) => balanceOf(tx, acct.team))).balance - teamBefore).toBe(ECONOMY.food.price / 10n);
    expect(game.hqStockCache.fish).toBe(caught - 1);

    // Battles need consent from the defender's strategy.
    p1.s.inventory.wood = 10;
    p2.s.x = p1.s.x + 30; p2.s.y = p1.s.y;
    await expect(game.battle(p2, p1, "manual")).rejects.toMatchObject({ code: "declined" });
    p1.s.strategy.battle = "balanced";
    p2.s.energy = 1000; p1.s.energy = 1000;
    const ev = await game.battle(p2, p1, "manual");
    expect(p1.s.hp).toBeLessThan(p1.stats.maxHp);
    if (ev.winner === p2.id) expect(ev.stolen.wood).toBeLessThanOrEqual(1);
    await expect(game.battle(p2, p1, "manual")).rejects.toMatchObject({ code: "not_eligible" }); // cooldown
    const row = await db.query(`SELECT mode FROM battles WHERE id = $1`, [ev.id]);
    expect(row.rows[0]).toMatchObject({ mode: "nonredeemable" });

    // Marketplace: atomic sale with stale-balance protection.
    const price = tokens(500_000);
    const { id: listingId } = await svc.createListing(db, game, u1.userId, { petId: p1.id }, price);
    await expect(svc.withdrawFromPet(db, game, u1.userId, p1.id, tokens(1), "wd123456")).rejects.toMatchObject({ code: "listed" });
    const petBal = (await db.tx((tx) => balanceOf(tx, acct.pet(p1.id)))).balance;
    await expect(svc.buyListing(db, game, u2.userId, listingId, petBal + 1n)).rejects.toMatchObject({ code: "stale_balance" });
    const sellerBefore = (await db.tx((tx) => balanceOf(tx, acct.user(u1.userId)))).balance;
    await svc.buyListing(db, game, u2.userId, listingId, petBal);
    expect(game.pets.get(p1.id)!.ownerId).toBe(u2.userId);
    expect((await db.tx((tx) => balanceOf(tx, acct.pet(p1.id)))).balance).toBe(petBal); // balance travels with the NFT
    expect((await db.tx((tx) => balanceOf(tx, acct.user(u1.userId)))).balance - sellerBefore).toBe(price - (price * 200n) / 10000n);
    await expect(svc.buyListing(db, game, u2.userId, listingId, null)).rejects.toMatchObject({ code: "gone" }); // no double-sale

    const rec = await svc.reconcile(db);
    expect(rec.issues).toEqual([]);
    expect(rec.ok).toBe(true);
  }, 60_000);

  it("autopilot pets work, sell and stay solvent without a human", async () => {
    const p = await spawnPet(u1.userId, "dog", game.world.hq.tx, game.world.hq.ty + 2);
    p.s.strategy = { ...p.s.strategy, auto: true, resource: "wood", sell: "nearest" };
    for (const m of game.merchants) { m.state = "at_hq"; m.waitUntil = 0; }
    advance(6 * 60_000);
    await new Promise((r) => setTimeout(r, 300));
    advance(4 * 60_000);
    await new Promise((r) => setTimeout(r, 300));
    expect(p.s.gatheredTotal).toBeGreaterThan(5);
    const rec = await svc.reconcile(db);
    expect(rec.ok).toBe(true);
  }, 60_000);
});
