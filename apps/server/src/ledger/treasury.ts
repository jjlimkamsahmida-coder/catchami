/**
 * HQ treasury: daily budgets, merchant grants and reward pools. All grants are
 * real ledger transfers out of the HQ account, capped by the day's allowance
 * (CHECK constraints in treasury_days) and by the reserve floor.
 */
import {
  dailyBudget, ECONOMY, HQ_ALLOCATION, merchantTripBudget, RESOURCES, splitBps, type Resource,
} from "@catchami/shared";
import type { Db, Tx } from "../db/index.ts";
import { env } from "../env.ts";
import { acct, balanceOf, ensureSystemAccounts, post, transfer } from "./ledger.ts";

export const dayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

export interface TreasuryDay {
  day: string;
  hqAvailableStart: bigint;
  merchantAllowance: bigint;
  merchantGranted: bigint;
  rewardPool: bigint;
  rewardPaid: bigint;
  factorBps: number;
}

export async function treasuryDay(tx: Tx, now = Date.now()): Promise<TreasuryDay> {
  const day = dayKey(now);
  let r = await tx.query<Record<string, string>>(`SELECT day::text, hq_available_start::text, merchant_allowance::text, merchant_granted::text, reward_pool::text, reward_paid::text, factor_bps FROM treasury_days WHERE day = $1`, [day]);
  if (!r.rows.length) {
    const hq = await balanceOf(tx, acct.hq);
    const b = dailyBudget(hq.available);
    await tx.query(
      `INSERT INTO treasury_days (day, hq_available_start, merchant_allowance, reward_pool, factor_bps) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (day) DO NOTHING`,
      [day, hq.available.toString(), b.merchants.toString(), b.rewards.toString(), b.factorBps],
    );
    r = await tx.query(`SELECT day::text, hq_available_start::text, merchant_allowance::text, merchant_granted::text, reward_pool::text, reward_paid::text, factor_bps FROM treasury_days WHERE day = $1`, [day]);
  }
  const x = r.rows[0]!;
  return {
    day: x.day!,
    hqAvailableStart: BigInt(x.hq_available_start!),
    merchantAllowance: BigInt(x.merchant_allowance!),
    merchantGranted: BigInt(x.merchant_granted!),
    rewardPool: BigInt(x.reward_pool!),
    rewardPaid: BigInt(x.reward_paid!),
    factorBps: Number(x.factor_bps),
  };
}

/** Top up a merchant for its next trip. Returns false if the merchant must sit out. */
export async function grantMerchant(db: Db, merchantId: string, tripNo: number, now = Date.now()): Promise<{ available: boolean; grant: bigint; cash: bigint }> {
  return db.tx(async (tx) => {
    const d = await treasuryDay(tx, now);
    const hq = await balanceOf(tx, acct.hq);
    const m = await balanceOf(tx, acct.merchant(merchantId));
    const { grant, available } = merchantTripBudget({
      merchantAllowanceRemaining: d.merchantAllowance - d.merchantGranted,
      hqAvailable: hq.available,
      merchantsSharing: ECONOMY.merchants.count,
      merchantCash: m.balance,
    });
    if (!available) return { available, grant: 0n, cash: m.balance };
    if (grant > 0n) {
      const res = await post(tx, {
        idem: `merchant-grant:${merchantId}:${d.day}:${tripNo}`,
        kind: "merchant_grant",
        postings: transfer(acct.hq, acct.merchant(merchantId), grant),
        meta: { merchantId, day: d.day, tripNo },
      });
      if (!res.duplicate) await tx.query(`UPDATE treasury_days SET merchant_granted = merchant_granted + $1::numeric WHERE day = $2`, [grant.toString(), d.day]);
    }
    return { available, grant, cash: m.balance + grant };
  });
}

/** One-time dev genesis: the 40T HQ allocation as TEST units, clearly marked unbacked. */
export async function ensureGenesis(db: Db) {
  await db.tx(async (tx) => {
    await ensureSystemAccounts(tx);
    for (const r of RESOURCES) await tx.query(`INSERT INTO hq_inventory (resource, qty) VALUES ($1, 0) ON CONFLICT DO NOTHING`, [r]);
    if (env.isDev) {
      await post(tx, {
        idem: "genesis:dev:hq",
        kind: "genesis_dev",
        postings: transfer(acct.chain, acct.hq, HQ_ALLOCATION),
        meta: { note: "DEV NETWORK test units. Not onchain. Not real tokens." },
        settlementRef: "dev-genesis:unbacked",
      });
    }
    // testnet/mainnet: HQ is funded only by indexed vault deposits (see chain/indexer.ts).
  });
}

/** Fee split helper used by food, medicine, crafting and marketplace. */
export function feePostings(payer: string, amount: bigint, split: { hq: number; team: number }) {
  const s = splitBps(amount, split, "hq");
  return [
    { account: payer, amount: -amount },
    { account: acct.hq, amount: s.hq },
    { account: acct.team, amount: s.team },
  ];
}

export async function hqStock(tx: Tx): Promise<Record<Resource, number>> {
  const r = await tx.query<{ resource: Resource; qty: string }>(`SELECT resource, qty::text FROM hq_inventory`);
  const out = { fish: 0, herbs: 0, wood: 0, minerals: 0 };
  for (const x of r.rows) out[x.resource] = Number(x.qty);
  return out;
}

/** Atomically consume HQ stock; false if not enough real stock. */
export async function consumeHqStock(tx: Tx, resource: Resource, qty: number, ref: string): Promise<boolean> {
  const r = await tx.query(`UPDATE hq_inventory SET qty = qty - $1 WHERE resource = $2 AND qty >= $1 RETURNING qty`, [qty, resource]);
  if (!r.rows.length) return false;
  await tx.query(`INSERT INTO resource_events (kind, resource, qty, ref) VALUES ('consume', $1, $2, $3)`, [resource, qty, ref]);
  return true;
}
