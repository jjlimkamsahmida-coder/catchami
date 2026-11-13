/**
 * Player-facing financial services: wallet, pet funding/withdrawal, daily
 * rewards, crafting, equipment, marketplace, leaderboards, admin overview and
 * reconciliation. Every money movement goes through the ledger in one DB tx.
 */
import {
  ECONOMY, EQUIPMENT, EQUIPMENT_KINDS, RARITIES, Rng, RESOURCES, splitBps, toWire, tokens, inventoryWeight,
  type EquipmentKind, type Rarity, type Resource,
} from "@catchami/shared";
import type { Db } from "./db/index.ts";
import { env, chainConfigured } from "./env.ts";
import { newId } from "./auth.ts";
import { currentEpoch } from "./fairness.ts";
import { acct, balanceOf, LedgerError, placeHold, post, transfer, trialBalance } from "./ledger/ledger.ts";
import { consumeHqStock, dayKey, feePostings, hqStock, treasuryDay } from "./ledger/treasury.ts";
import { GameError, type Game } from "./world/game.ts";
import type { PetRt } from "./world/types.ts";

export class ServiceError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.code = code; this.status = status; }
}

const insufficient = (e: unknown, msg: string) => {
  if (e instanceof LedgerError && e.code === "insufficient_funds") throw new ServiceError("insufficient_funds", msg);
  throw e;
};

function ownedPet(game: Game, userId: string, petId: string): PetRt {
  const p = game.pets.get(petId);
  if (!p || p.ownerId !== userId) throw new ServiceError("not_owner", "That isn't your pet", 403);
  return p;
}

// ---------------------------------------------------------------- wallet --

export async function wallet(db: Db, userId: string) {
  const b = await db.tx((tx) => balanceOf(tx, acct.user(userId)));
  const hist = await db.query<{ id: string; kind: string; amount: string; created_at: string; meta: Record<string, unknown> }>(
    `SELECT j.id::text, j.kind, p.amount::text, j.created_at::text, j.meta FROM postings p JOIN journal j ON j.id = p.journal_id
     WHERE p.account_id = $1 ORDER BY p.id DESC LIMIT 30`, [acct.user(userId)],
  );
  return { balance: toWire(b.balance), held: toWire(b.held), available: toWire(b.available), history: hist.rows, network: env.network, chainConfigured: chainConfigured() };
}

/** DEV NETWORK ONLY: test units with no value, so the full loop can be exercised before contracts are deployed. */
export async function devFaucet(db: Db, userId: string) {
  if (!env.isDev) throw new ServiceError("not_dev", "The test faucet only exists on the dev network", 404);
  const day = dayKey();
  const amount = tokens(20_000_000);
  const r = await db.tx((tx) => post(tx, {
    idem: `faucet:${userId}:${day}`, kind: "dev_faucet", postings: transfer(acct.chain, acct.user(userId), amount),
    meta: { note: "DEV NETWORK test units — no value, not onchain" }, settlementRef: "dev-faucet:unbacked",
  }));
  if (r.duplicate) throw new ServiceError("already_claimed", "You already took today's test units");
  return { amount: toWire(amount) };
}

export async function fundPet(db: Db, game: Game, userId: string, petId: string, amount: bigint, rid: string) {
  if (amount <= 0n) throw new ServiceError("amount", "Amount must be positive");
  const p = ownedPet(game, userId, petId);
  try {
    await db.tx((tx) => post(tx, { idem: `fund:${userId}:${rid}`, kind: "pet_fund", postings: transfer(acct.user(userId), acct.pet(petId), amount), meta: { petId } }));
  } catch (e) { insufficient(e, "Not enough tokens in your wallet"); }
  await game.refreshBalance(p);
  return { ok: true };
}

/** Move settled, unheld pet funds back to the owner's wallet. Blocked while listed for sale. */
/** A pet's piggy-bank ledger: every coin in or out, newest first (owner only). */
export async function petHistory(db: Db, game: Game, userId: string, petId: string) {
  ownedPet(game, userId, petId);
  const r = await db.query<{ id: string; kind: string; amount: string; created_at: string; meta: Record<string, unknown> }>(
    `SELECT j.id::text, j.kind, p.amount::text, j.created_at::text, j.meta FROM postings p JOIN journal j ON j.id = p.journal_id
     WHERE p.account_id = $1 ORDER BY p.id DESC LIMIT 100`, [acct.pet(petId)],
  );
  return { items: r.rows };
}

export async function withdrawFromPet(db: Db, game: Game, userId: string, petId: string, amount: bigint, rid: string) {
  if (game.flags.pauseWithdrawals) throw new ServiceError("paused", "Withdrawals are paused by operations", 503);
  if (amount <= 0n) throw new ServiceError("amount", "Amount must be positive");
  const p = ownedPet(game, userId, petId);
  if (p.listed) throw new ServiceError("listed", "Cancel the marketplace listing before withdrawing — buyers rely on the shown balance");
  await game.withPet(p, async () => {
    try {
      await db.tx(async (tx) => {
        const listed = await tx.query(`SELECT 1 FROM listings WHERE pet_id = $1 AND status = 'open' FOR UPDATE`, [petId]);
        if (listed.rows.length) throw new ServiceError("listed", "Pet is listed for sale");
        await post(tx, { idem: `pet-withdraw:${userId}:${rid}`, kind: "pet_withdraw", postings: transfer(acct.pet(petId), acct.user(userId), amount), meta: { petId } });
      });
    } catch (e) { insufficient(e, "That's more than the pet's available balance"); }
  });
  await game.refreshBalance(p);
  return { ok: true };
}

/** Wallet -> onchain withdrawal: funds are held immediately, settled by the chain worker. */
export async function requestChainWithdrawal(db: Db, game: Game, userId: string, amount: bigint, rid: string) {
  if (game.flags.pauseWithdrawals) throw new ServiceError("paused", "Withdrawals are paused by operations", 503);
  const u = await db.query<{ near_account: string | null }>(`SELECT near_account FROM users WHERE id = $1`, [userId]);
  if (!u.rows[0]?.near_account) throw new ServiceError("no_near_account", "Link a NEAR account before withdrawing");
  if (env.isDev || !chainConfigured()) throw new ServiceError("chain_not_configured", "Onchain withdrawals are not available on this network yet");
  const holdId = `wd:${userId}:${rid}`;
  try {
    await db.tx(async (tx) => {
      await placeHold(tx, { id: holdId, account: acct.user(userId), amount, reason: "withdrawal" });
      await tx.query(`INSERT INTO outbox (idem, kind, payload) VALUES ($1,'withdraw',$2) ON CONFLICT DO NOTHING`, [holdId, JSON.stringify({ holdId, userId, to: u.rows[0]!.near_account, amount: amount.toString() })]);
    });
  } catch (e) { insufficient(e, "Not enough available balance"); }
  return { holdId };
}

// -------------------------------------------------------------- crafting --

const EQUIP_RARITY_PPM: Record<Rarity, number> = { common: 700_000, uncommon: 200_000, rare: 80_000, epic: 17_000, legendary: 2_500, mythic: 500 };

export function craftQuote(game: Game, kind: EquipmentKind) {
  const def = EQUIPMENT[kind];
  // HQ sells stocked materials at 125% of the current merchant buy price.
  const unit = (r: Resource) => (game.priceFor(game.merchants[0]!, r) * 12_500n) / 10_000n;
  return { kind, label: def.label, fee: toWire(def.fee), wood: def.wood, minerals: def.minerals, bonusBps: def.bonusBps, hqUnitPrice: { wood: toWire(unit("wood")), minerals: toWire(unit("minerals")) }, hqStock: { wood: game.hqStockCache.wood, minerals: game.hqStockCache.minerals } };
}

export async function craft(db: Db, game: Game, userId: string, petId: string, kind: EquipmentKind, buyMissing: boolean, rid: string) {
  if (!EQUIPMENT_KINDS.includes(kind)) throw new ServiceError("kind", "Unknown equipment");
  if (game.flags.pauseTrades) throw new ServiceError("paused", "Crafting is paused by operations", 503);
  const p = ownedPet(game, userId, petId);
  // Gear is crafted at a merchant's workbench: the pet must be standing at an open merchant.
  const atMerchant = game.merchants.some((m) => m.state !== "at_hq" && m.state !== "unavailable" && Math.hypot(m.x - p.s.x, m.y - p.s.y) <= ECONOMY.merchants.interactRangePx);
  if (!atMerchant) throw new ServiceError("no_merchant", "Gear is crafted at a merchant — walk up to one and open their shop");
  const def = EQUIPMENT[kind];
  const q = craftQuote(game, kind);
  return game.withPet(p, async () => {
    const needWood = Math.max(0, def.wood - p.s.inventory.wood);
    const needMin = Math.max(0, def.minerals - p.s.inventory.minerals);
    if ((needWood || needMin) && !buyMissing) throw new ServiceError("materials", `Needs ${needWood} more wood and ${needMin} more minerals`);
    const materialCost = BigInt(needWood) * BigInt(q.hqUnitPrice.wood) + BigInt(needMin) * BigInt(q.hqUnitPrice.minerals);
    const useWood = def.wood - needWood, useMin = def.minerals - needMin;
    const epoch = await currentEpoch(db);
    const id = newId("eq");
    const rarity = new Rng(epoch.seed, `equip:${id}`).weightedPpm(EQUIP_RARITY_PPM);
    const next = { ...p.s, inventory: { ...p.s.inventory, wood: p.s.inventory.wood - useWood, minerals: p.s.inventory.minerals - useMin } };
    try {
      await db.tx(async (tx) => {
        if (needWood && !(await consumeHqStock(tx, "wood", needWood, `craft:${id}`))) throw new ServiceError("hq_stock", "HQ doesn't have enough real wood stock");
        if (needMin && !(await consumeHqStock(tx, "minerals", needMin, `craft:${id}`))) throw new ServiceError("hq_stock", "HQ doesn't have enough real mineral stock");
        if (useWood) await tx.query(`INSERT INTO resource_events (kind, resource, qty, ref) VALUES ('consume','wood',$1,$2)`, [useWood, `craft:${id}`]);
        if (useMin) await tx.query(`INSERT INTO resource_events (kind, resource, qty, ref) VALUES ('consume','minerals',$1,$2)`, [useMin, `craft:${id}`]);
        await post(tx, { idem: `craft:${userId}:${rid}`, kind: "craft", postings: feePostings(acct.pet(petId), def.fee + materialCost, ECONOMY.equipment.craftSplit), meta: { petId, kind, rarity, equipmentId: id, materialCost: materialCost.toString(), epoch: epoch.id } });
        await tx.query(`INSERT INTO equipment (id, owner_id, kind, rarity, mint_status) VALUES ($1,$2,$3,$4,$5)`, [id, userId, kind, rarity, chainConfigured() ? "pending" : "awaiting_chain"]);
        await tx.query(`INSERT INTO outbox (idem, kind, payload, status) VALUES ($1,'mint_equipment',$2,$3)`, [`mint:${id}`, JSON.stringify({ id, owner: userId, kind, rarity }), chainConfigured() ? "pending" : "awaiting_chain"]);
        await tx.query(`UPDATE pets SET state = $2, updated_at = now() WHERE id = $1`, [petId, JSON.stringify(next)]);
      });
    } catch (e) { insufficient(e, `${p.name} can't afford the crafting fee`); }
    p.s.inventory = next.inventory;
    game.pendingConsume.wood += def.wood;
    game.pendingConsume.minerals += def.minerals;
    p.balance -= def.fee + materialCost;
    p.metaDirty = true;
    await game.refreshTreasury();
    return { id, kind, rarity, fee: toWire(def.fee + materialCost) };
  });
}

export async function listEquipment(db: Db, userId: string) {
  const r = await db.query(`SELECT id, kind, rarity, pet_id, equipped, mint_status, nft_token_id FROM equipment WHERE owner_id = $1 ORDER BY created_at DESC`, [userId]);
  return r.rows;
}

export async function equip(db: Db, game: Game, userId: string, equipmentId: string, petId: string | null) {
  const e = await db.query<{ owner_id: string; pet_id: string | null }>(`SELECT owner_id, pet_id FROM equipment WHERE id = $1`, [equipmentId]);
  if (!e.rows[0] || e.rows[0].owner_id !== userId) throw new ServiceError("not_owner", "Not your equipment", 403);
  const listed = await db.query(`SELECT 1 FROM listings WHERE equipment_id = $1 AND status = 'open'`, [equipmentId]);
  if (listed.rows.length) throw new ServiceError("listed", "Cancel the listing first");
  const prev = e.rows[0].pet_id;
  if (petId) {
    const p = ownedPet(game, userId, petId);
    if (p.busy) throw new ServiceError("busy", `${p.name} is busy`);
    const n = await db.query<{ n: string }>(`SELECT COUNT(*)::text n FROM equipment WHERE pet_id = $1 AND equipped AND id <> $2`, [petId, equipmentId]);
    if (Number(n.rows[0]!.n) >= ECONOMY.equipment.slots) throw new ServiceError("slots", `${p.name} already uses both equipment slots`);
    await db.query(`UPDATE equipment SET pet_id = $2, equipped = true WHERE id = $1`, [equipmentId, petId]);
  } else {
    await db.query(`UPDATE equipment SET pet_id = NULL, equipped = false WHERE id = $1`, [equipmentId]);
  }
  for (const id of new Set([prev, petId].filter(Boolean) as string[])) await game.reloadPet(id);
  return { ok: true };
}

// ----------------------------------------------------------- marketplace --

export async function marketListings(db: Db, filters: { species?: string; rarity?: string; kind?: string }) {
  const r = await db.query<Record<string, unknown>>(
    `SELECT l.id, l.price::text, l.created_at::text, u.display_name AS seller, l.seller_id,
            p.id AS pet_id, p.name, p.species, p.rarity AS pet_rarity, p.sticker, p.genome->'look' AS look, p.genome->'stats' AS stats, p.genome->'traits' AS traits, a.balance::text AS pet_balance,
            e.id AS equipment_id, e.kind, e.rarity AS eq_rarity
     FROM listings l JOIN users u ON u.id = l.seller_id
     LEFT JOIN pets p ON p.id = l.pet_id LEFT JOIN accounts a ON a.id = 'pet:' || p.id
     LEFT JOIN equipment e ON e.id = l.equipment_id
     WHERE l.status = 'open'
       AND ($1::text IS NULL OR p.species = $1)
       AND ($2::text IS NULL OR p.rarity = $2 OR e.rarity = $2)
       AND ($3::text IS NULL OR ($3 = 'animal' AND l.pet_id IS NOT NULL) OR ($3 = 'equipment' AND l.equipment_id IS NOT NULL))
     ORDER BY l.created_at DESC LIMIT 100`,
    [filters.species ?? null, filters.rarity ?? null, filters.kind ?? null],
  );
  return r.rows;
}

export async function createListing(db: Db, game: Game, userId: string, asset: { petId?: string; equipmentId?: string }, price: bigint) {
  if (game.flags.pauseTrades) throw new ServiceError("paused", "Marketplace is paused by operations", 503);
  if (price <= 0n) throw new ServiceError("price", "Price must be positive");
  const id = newId("ls");
  if (asset.petId) {
    const p = ownedPet(game, userId, asset.petId);
    if (p.busy) throw new ServiceError("busy", `${p.name} is busy`);
  } else if (asset.equipmentId) {
    const e = await db.query<{ owner_id: string; equipped: boolean }>(`SELECT owner_id, equipped FROM equipment WHERE id = $1`, [asset.equipmentId]);
    if (!e.rows[0] || e.rows[0].owner_id !== userId) throw new ServiceError("not_owner", "Not your equipment", 403);
    if (e.rows[0].equipped) throw new ServiceError("equipped", "Unequip it first");
  } else throw new ServiceError("asset", "Nothing to list");
  try {
    await db.query(`INSERT INTO listings (id, seller_id, pet_id, equipment_id, price) VALUES ($1,$2,$3,$4,$5)`, [id, userId, asset.petId ?? null, asset.equipmentId ?? null, price.toString()]);
  } catch (e) {
    if (/listings_open/.test(String(e))) throw new ServiceError("already_listed", "Already listed");
    throw e;
  }
  if (asset.petId) await game.reloadPet(asset.petId);
  return { id };
}

export async function cancelListing(db: Db, game: Game, userId: string, listingId: string) {
  const r = await db.query<{ pet_id: string | null }>(`UPDATE listings SET status = 'cancelled', closed_at = now() WHERE id = $1 AND seller_id = $2 AND status = 'open' RETURNING pet_id`, [listingId, userId]);
  if (!r.rows.length) throw new ServiceError("not_found", "No open listing");
  if (r.rows[0]!.pet_id) await game.reloadPet(r.rows[0]!.pet_id);
  return { ok: true };
}

/**
 * Atomic purchase: price moves buyer -> seller minus the 2% fee (90% HQ / 10%
 * team), ownership moves, listing closes — all or nothing. `expectedPetBalance`
 * protects the buyer from a stale balance: if the attached balance dropped
 * below what they saw, the purchase is refused.
 */
export async function buyListing(db: Db, game: Game, buyerId: string, listingId: string, expectedPetBalance: bigint | null) {
  if (game.flags.pauseTrades) throw new ServiceError("paused", "Marketplace is paused by operations", 503);
  const pre = await db.query<{ pet_id: string | null }>(`SELECT pet_id FROM listings WHERE id = $1`, [listingId]);
  const pet = pre.rows[0]?.pet_id ? game.pets.get(pre.rows[0].pet_id) : null;
  const run = async () => {
    try {
      await db.tx(async (tx) => {
        const l = await tx.query<{ seller_id: string; pet_id: string | null; equipment_id: string | null; price: string; status: string }>(
          `SELECT seller_id, pet_id, equipment_id, price::text, status FROM listings WHERE id = $1 FOR UPDATE`, [listingId],
        );
        const row = l.rows[0];
        if (!row || row.status !== "open") throw new ServiceError("gone", "This listing is no longer available");
        if (row.seller_id === buyerId) throw new ServiceError("own", "That's your own listing");
        const price = BigInt(row.price);
        if (row.pet_id && expectedPetBalance !== null) {
          const b = await balanceOf(tx, acct.pet(row.pet_id));
          if (b.balance < expectedPetBalance) throw new ServiceError("stale_balance", "The pet's attached balance changed since you looked. Refresh and review.");
        }
        const fee = (price * BigInt(ECONOMY.marketplace.feeBps)) / 10_000n;
        const fs = splitBps(fee, ECONOMY.marketplace.feeSplit, "hq");
        await post(tx, {
          idem: `sale-nft:${listingId}`, kind: "nft_sale",
          postings: [
            { account: acct.user(buyerId), amount: -price },
            { account: acct.user(row.seller_id), amount: price - fee },
            { account: acct.hq, amount: fs.hq },
            { account: acct.team, amount: fs.team },
          ],
          meta: { listingId, petId: row.pet_id, equipmentId: row.equipment_id, price: row.price },
        });
        if (row.pet_id) {
          await tx.query(`UPDATE pets SET owner_id = $2 WHERE id = $1`, [row.pet_id, buyerId]);
          await tx.query(`UPDATE accounts SET user_id = $2 WHERE id = $1`, [acct.pet(row.pet_id), buyerId]);
          await tx.query(`UPDATE equipment SET owner_id = $2 WHERE pet_id = $1`, [row.pet_id, buyerId]); // equipped gear goes with the pet
        } else {
          await tx.query(`UPDATE equipment SET owner_id = $2 WHERE id = $1`, [row.equipment_id, buyerId]);
        }
        await tx.query(`UPDATE listings SET status = 'sold', buyer_id = $2, closed_at = now() WHERE id = $1`, [listingId, buyerId]);
        await tx.query(`INSERT INTO outbox (idem, kind, payload, status) VALUES ($1,'nft_transfer',$2,$3)`, [`xfer:${listingId}`, JSON.stringify({ listingId, petId: row.pet_id, equipmentId: row.equipment_id, to: buyerId }), chainConfigured() ? "pending" : "awaiting_chain"]);
      });
    } catch (e) { insufficient(e, "Not enough tokens in your wallet"); }
  };
  // Lock the pet so no gameplay spend happens mid-sale.
  if (pet) await game.withPet(pet, run); else await run();
  if (pre.rows[0]?.pet_id) await game.reloadPet(pre.rows[0].pet_id);
  return { ok: true };
}

// ---------------------------------------------------------- leaderboards --

export async function leaderboards(db: Db, game: Game) {
  const richest = await db.query(`SELECT p.id, p.name, p.species, p.rarity, p.sticker, u.display_name AS owner, a.balance::text AS value FROM pets p JOIN users u ON u.id = p.owner_id JOIN accounts a ON a.id = 'pet:' || p.id ORDER BY a.balance DESC LIMIT 10`);
  const pets = [...game.pets.values()];
  const top = (f: (p: PetRt) => number) => pets.filter((p) => f(p) > 0).sort((a, b) => f(b) - f(a)).slice(0, 10).map((p) => ({ id: p.id, name: p.name, species: p.species, rarity: p.rarity, sticker: p.sticker, owner: p.ownerName, value: f(p) }));
  const earnings = await db.query(
    `SELECT p.id, p.name, p.species, p.rarity, p.sticker, u.display_name AS owner, SUM(CASE WHEN j.kind IN ('sale','reward') THEN po.amount WHEN j.kind IN ('food','medicine','craft') THEN po.amount ELSE 0 END)::text AS value
     FROM postings po JOIN journal j ON j.id = po.journal_id JOIN pets p ON 'pet:' || p.id = po.account_id JOIN users u ON u.id = p.owner_id
     GROUP BY p.id, p.name, p.species, p.rarity, p.sticker, u.display_name HAVING COUNT(*) > 0 ORDER BY SUM(CASE WHEN j.kind IN ('sale','reward','food','medicine','craft') THEN po.amount ELSE 0 END) DESC LIMIT 10`,
  );
  return {
    richest: richest.rows,
    gatherers: top((p) => p.s.gatheredTotal),
    wins: top((p) => p.s.wins),
    losses: top((p) => p.s.losses),
    stolen: top((p) => p.s.stolenTotal),
    earnings: earnings.rows,
  };
}

// ------------------------------------------------------- admin / recon --

export async function reconcile(db: Db) {
  const tb = await db.tx((tx) => trialBalance(tx));
  const issues: string[] = [];
  if (tb.sumOfBalances !== 0n) issues.push(`ledger does not sum to zero (${tb.sumOfBalances})`);
  if (tb.postingsImbalance !== 0n) issues.push("postings imbalance");
  if (tb.journalsUnbalanced) issues.push(`${tb.journalsUnbalanced} unbalanced journals`);
  if (tb.negativeNonExternal) issues.push(`${tb.negativeNonExternal} accounts below zero`);
  if (tb.derivedMismatch) issues.push(`${tb.derivedMismatch} cached balances disagree with postings/holds`);
  if (tb.chainLiability > tokens(ECONOMY.allocation.hqWhole + ECONOMY.allocation.marketWhole + ECONOMY.allocation.teamWhole)) issues.push("ledger claims exceed total supply");
  const days = await db.query(`SELECT day::text FROM treasury_days WHERE merchant_granted > merchant_allowance OR reward_paid > reward_pool`);
  if (days.rows.length) issues.push("treasury day over budget");
  let onchain: { status: string; vaultBalance?: string } = { status: env.isDev ? "dev_network_unbacked" : "chain_not_configured" };
  if (chainConfigured()) {
    try {
      const { ftBalanceOf } = await import("./chain/near.ts");
      const vault = await ftBalanceOf(env.near.tokenContract!, env.near.gameContract!);
      onchain = { status: vault === tb.chainLiability ? "matched" : "MISMATCH", vaultBalance: vault.toString() };
      if (vault < tb.chainLiability) issues.push(`vault holds ${vault} but ledger claims ${tb.chainLiability}`);
    } catch (e) { onchain = { status: `rpc_error: ${(e as Error).message}` }; }
  }
  return { ok: issues.length === 0, issues, trial: Object.fromEntries(Object.entries(tb).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v])), onchain, at: new Date().toISOString() };
}

export async function adminOverview(db: Db, game: Game) {
  const accounts = await db.query<{ id: string; balance: string; held: string }>(`SELECT id, balance::text, held::text FROM accounts WHERE kind IN ('hq','team','merchant','external') ORDER BY id`);
  const obligations = await db.query<{ kind: string; total: string }>(`SELECT kind, COALESCE(SUM(balance),0)::text total FROM accounts WHERE kind IN ('user','pet') GROUP BY kind`);
  const day = await db.tx((tx) => treasuryDay(tx));
  const outbox = await db.query(`SELECT kind, status, COUNT(*)::int n FROM outbox GROUP BY kind, status ORDER BY kind`);
  const catches = await db.query(`SELECT status, COUNT(*)::int n FROM catch_attempts WHERE created_at > now() - interval '1 day' GROUP BY status`);
  const suspicious = await db.query(`SELECT id, user_id, reject_reason, created_at::text FROM catch_attempts WHERE reject_reason IN ('static_frames','duplicate','inconsistent_frames') ORDER BY created_at DESC LIMIT 25`);
  const trades = await db.query(`SELECT id, price::text, pet_id, equipment_id, seller_id, buyer_id, closed_at::text FROM listings WHERE status = 'sold' ORDER BY closed_at DESC LIMIT 20`);
  const stock = await db.tx((tx) => hqStock(tx));
  const log = await db.query(`SELECT actor, action, detail, at::text FROM admin_log ORDER BY id DESC LIMIT 20`);
  return {
    network: env.network,
    economyVersion: ECONOMY.version,
    accounts: accounts.rows,
    obligations: obligations.rows,
    treasuryDay: Object.fromEntries(Object.entries(day).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v])),
    merchants: game.merchants.map((m) => ({ id: m.id, name: m.name, state: m.state, cash: m.cash.toString(), inventory: m.inventory, weight: inventoryWeight(m.inventory), tripNo: m.tripNo })),
    demand: game.demand,
    hqStock: stock,
    flags: game.flags,
    outbox: outbox.rows,
    catches: catches.rows,
    suspicious: suspicious.rows,
    trades: trades.rows,
    pets: { total: game.pets.size, active: [...game.pets.values()].filter((p) => p.s.status === "active").length },
    adminLog: log.rows,
    resources: RESOURCES,
    rarities: RARITIES,
  };
}

export { GameError };
