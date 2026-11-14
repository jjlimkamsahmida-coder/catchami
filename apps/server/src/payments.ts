/**
 * Buying $CATCHAMI.
 *
 *  - Price: read live from the $CATCHAMI/USDC pool on Ref Finance (real, onchain).
 *  - Delivery: real — the 55% market allocation sends $CATCHAMI into the vault,
 *    credited to the player (see ChainWorker.deliver).
 *  - Payment: SIMULATED on testnet.
 *      card    — a fake card checkout (no card details are ever collected).
 *      intents — "pay with any asset" through NEAR Intents. Intents only runs on
 *                mainnet, so the asset list and USD prices are real (1Click
 *                token list) but the deposit and swap are simulated.
 *  - Selling: $CATCHAMI -> USDC is a real swap on the Ref testnet pool, signed by
 *    the player's own wallet in the browser (quote here). Cash-out of USDC to a
 *    bank (off-ramp) is simulated.
 */
import { randomBytes } from "node:crypto";
import { tokens, toWire } from "@catchami/shared";
import type { Db } from "./db/index.ts";
import { env } from "./env.ts";
import { ServiceError } from "./services.ts";
import { canSell, view } from "./chain/signer.ts";
import { getChainWorker, txUrl } from "./chain/worker.ts";

const USDC_DEC = 10n ** 6n;
const TOKEN_DEC = 10n ** 18n;
const CARD_FEE_BPS = 350n; // shown on the simulated card checkout
const LIMITS = { minUsd: 1, maxUsd: 500, dailyUsd: 2_000 };

/** $CATCHAMI received for `usdc` (6-decimals) from the pool (at its current price, before any fee). */
export async function poolQuoteBuy(usdc: bigint): Promise<bigint> {
  if (env.near.refPoolId < 0) throw new ServiceError("no_pool", "No trading pool configured", 503);
  const out = await view<string>(env.near.refContract, "get_return", { pool_id: env.near.refPoolId, token_in: env.near.usdcToken, amount_in: usdc.toString(), token_out: env.near.tokenContract });
  return BigInt(out);
}
/** USDC (6 decimals) received for selling `amount` $CATCHAMI (18 decimals). */
export async function poolQuoteSell(amount: bigint): Promise<bigint> {
  if (env.near.refPoolId < 0) throw new ServiceError("no_pool", "No trading pool configured", 503);
  return BigInt(await view<string>(env.near.refContract, "get_return", { pool_id: env.near.refPoolId, token_in: env.near.tokenContract, amount_in: amount.toString(), token_out: env.near.usdcToken }));
}

export async function market() {
  let pool: { amounts: string[]; token_account_ids: string[]; total_fee: number } | null = null;
  try { pool = await view(env.near.refContract, "get_pool", { pool_id: env.near.refPoolId }); } catch { pool = null; }
  let perUsd: string | null = null;
  try { perUsd = toWire(await poolQuoteBuy(USDC_DEC)); } catch { perUsd = null; }
  const ci = pool ? pool.token_account_ids.indexOf(env.near.tokenContract!) : -1;
  return {
    network: env.network,
    token: env.near.tokenContract, game: env.near.gameContract, usdc: env.near.usdcToken,
    dex: { name: "Ref Finance", contract: env.near.refContract, poolId: env.near.refPoolId, feeBps: pool?.total_fee ?? null },
    reserves: pool && ci >= 0 ? { catchami: pool.amounts[ci], usdc: pool.amounts[1 - ci] } : null,
    catchamiPerUsdc: perUsd,
    canBuy: canSell() && Boolean(getChainWorker()?.enabled),
    simulated: { card: true, intents: env.network !== "mainnet", offramp: true },
    explorer: env.near.explorer,
  };
}

// ---------------------------------------------------------------- assets --

type Asset = { assetId: string; symbol: string; blockchain: string; price: number; decimals: number };
let assetCache: { at: number; list: Asset[] } | null = null;
const FALLBACK: Asset[] = [
  { assetId: "nep141:wrap.near", symbol: "NEAR", blockchain: "near", price: 3.3, decimals: 24 },
  { assetId: "usdc", symbol: "USDC", blockchain: "near", price: 1, decimals: 6 },
  { assetId: "usdt", symbol: "USDT", blockchain: "eth", price: 1, decimals: 6 },
  { assetId: "eth", symbol: "ETH", blockchain: "eth", price: 1900, decimals: 18 },
  { assetId: "btc", symbol: "BTC", blockchain: "btc", price: 90000, decimals: 8 },
  { assetId: "sol", symbol: "SOL", blockchain: "sol", price: 150, decimals: 9 },
];
const FEATURED = ["NEAR", "wNEAR", "USDC", "USDT", "ETH", "BTC", "SOL", "ZEC", "DOGE", "XRP", "SUI", "BNB", "ARB", "BLACKDRAGON"];

/** Assets NEAR Intents can take as payment, with live USD prices (1Click public token list). */
export async function intentsAssets(): Promise<Asset[]> {
  if (assetCache && Date.now() - assetCache.at < 5 * 60_000) return assetCache.list;
  try {
    const r = await fetch("https://1click.chaindefuser.com/v0/tokens", { signal: AbortSignal.timeout(8_000) });
    const all = (await r.json()) as Asset[];
    const list = all.filter((a) => a.price > 0 && !/DEPRECATED/i.test(a.symbol))
      .sort((a, b) => (FEATURED.indexOf(a.symbol) + 1 || 999) - (FEATURED.indexOf(b.symbol) + 1 || 999) || a.symbol.localeCompare(b.symbol));
    assetCache = { at: Date.now(), list };
    return list;
  } catch {
    return assetCache?.list ?? FALLBACK;
  }
}

// ----------------------------------------------------------------- quotes --

function usdOf(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < LIMITS.minUsd || n > LIMITS.maxUsd) throw new ServiceError("usd", `Pick an amount between $${LIMITS.minUsd} and $${LIMITS.maxUsd}`);
  return Math.round(n * 100) / 100;
}

export async function quote(body: Record<string, unknown>) {
  const usd = usdOf(body.usd);
  const method = body.method === "intents" ? "intents" : "card";
  const usdcIn = (BigInt(Math.round(usd * 100)) * USDC_DEC) / 100n;
  let pay: { asset: string; chain: string; amount: string; price: number } = { asset: "USD", chain: "card", amount: usd.toFixed(2), price: 1 };
  let fee = 0n;
  if (method === "card") fee = (usdcIn * CARD_FEE_BPS) / 10_000n;
  else {
    const assets = await intentsAssets();
    const a = assets.find((x) => x.assetId === body.asset) ?? assets[0]!;
    pay = { asset: a.symbol, chain: a.blockchain, amount: (usd / a.price).toPrecision(6), price: a.price };
    fee = usdcIn / 1000n; // ~0.1% Intents fee
  }
  const out = await poolQuoteBuy(usdcIn - fee);
  return { usd, method, pay, feeUsd: Number(fee) / 1e6, tokens: toWire(out), rate: toWire(await poolQuoteBuy(USDC_DEC)), simulated: method === "card" || env.network !== "mainnet" };
}

// -------------------------------------------------------------------- buy --

export async function buy(db: Db, userId: string, body: Record<string, unknown>) {
  const w = getChainWorker();
  if (!w?.enabled || !canSell()) throw new ServiceError("not_connected", "Buying $CATCHAMI isn't connected on this server yet", 503);
  const rid = typeof body.rid === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(body.rid) ? body.rid : null;
  if (!rid) throw new ServiceError("rid", "request id required");
  const q = await quote(body);
  const today = await db.query<{ s: string | null }>(`SELECT SUM((simulated->>'usd')::numeric)::text s FROM purchases WHERE user_id = $1 AND created_at > now() - interval '1 day' AND status = 'delivered'`, [userId]);
  if (Number(today.rows[0]?.s ?? 0) + q.usd > LIMITS.dailyUsd) throw new ServiceError("limit", `Daily limit is $${LIMITS.dailyUsd} on the test network`);
  const id = `buy:${userId}:${rid}`;
  const amount = BigInt(q.tokens);
  const ins = await db.query(`INSERT INTO purchases (id, user_id, method, pay_asset, pay_amount, tokens, status, simulated) VALUES ($1,$2,$3,$4,$5,$6,'paying',$7) ON CONFLICT (id) DO NOTHING RETURNING id`, [
    id, userId, q.method, q.pay.asset, q.pay.amount, amount.toString(), JSON.stringify({ usd: q.usd, feeUsd: q.feeUsd, chain: q.pay.chain, ref: `sim_${randomBytes(6).toString("hex")}` }),
  ]);
  if (!ins.rows.length) throw new ServiceError("duplicate", "That purchase was already made");
  try {
    const r = await w.deliver(userId, amount, `Catchami purchase ${q.method}`);
    await db.query(`UPDATE purchases SET status = 'delivered', tx_hash = $2 WHERE id = $1`, [id, r.txHash]);
    return { ...q, txHash: r.txHash, txUrl: txUrl(r.txHash) };
  } catch (e) {
    await db.query(`UPDATE purchases SET status = 'failed' WHERE id = $1`, [id]);
    throw new ServiceError("delivery_failed", `Couldn't deliver the coins: ${(e as Error).message}`, 502);
  }
}

/** Testnet starter pouch: a fixed pack delivered from the market allocation, once per account. */
export async function deliverStarter(db: Db, userId: string, pack: { id: string; whole: number; near: string }) {
  const w = getChainWorker();
  if (!w?.enabled || !canSell()) throw new ServiceError("not_connected", "Buying $CATCHAMI isn't connected on this server yet", 503);
  const amount = tokens(pack.whole);
  const id = `starter:${userId}`;
  const ins = await db.query(`INSERT INTO purchases (id, user_id, method, pay_asset, pay_amount, tokens, status, simulated) VALUES ($1,$2,'starter','NEAR',$3,$4,'paying',$5) ON CONFLICT (id) DO NOTHING RETURNING id`, [
    id, userId, pack.near, amount.toString(), JSON.stringify({ pack: pack.id, usd: Number(pack.near) * 3.3 }),
  ]);
  if (!ins.rows.length) return { amount: toWire(amount), pack: pack.id, already: true };
  try {
    const r = await w.deliver(userId, amount, `Catchami starter ${pack.id}`);
    await db.query(`UPDATE purchases SET status = 'delivered', tx_hash = $2 WHERE id = $1`, [id, r.txHash]);
    return { amount: toWire(amount), pack: pack.id, already: false, txHash: r.txHash, txUrl: txUrl(r.txHash) };
  } catch (e) {
    await db.query(`DELETE FROM purchases WHERE id = $1`, [id]);
    throw new ServiceError("delivery_failed", `Couldn't deliver the coins: ${(e as Error).message}`, 502);
  }
}

export async function purchaseHistory(db: Db, userId: string) {
  const r = await db.query<{ id: string; method: string; pay_asset: string; pay_amount: string; tokens: string; status: string; tx_hash: string | null; created_at: string }>(
    `SELECT id, method, pay_asset, pay_amount, tokens::text, status, tx_hash, created_at::text FROM purchases WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`, [userId],
  );
  return { items: r.rows.map((p) => ({ ...p, txUrl: txUrl(p.tx_hash) })) };
}

/** Sell quote for the in-app swap (the swap itself is signed by the player's wallet). */
export async function sellQuote(amountWhole: unknown) {
  const n = typeof amountWhole === "string" && /^\d{1,15}$/.test(amountWhole) ? BigInt(amountWhole) : null;
  if (!n || n <= 0n) throw new ServiceError("amount", "Enter a whole number of coins");
  const out = await poolQuoteSell(n * TOKEN_DEC);
  return { amount: (n * TOKEN_DEC).toString(), usdc: out.toString(), usdcDisplay: (Number(out) / 1e6).toFixed(6), minOut: ((out * 99n) / 100n).toString(), pool: env.near.refPoolId, ref: env.near.refContract, token: env.near.tokenContract, usdcToken: env.near.usdcToken };
}
