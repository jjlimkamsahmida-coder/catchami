/**
 * Double-entry ledger. Every movement of tokens is a journal entry whose
 * postings sum to zero. Entries are idempotent (unique `idem` key), immutable,
 * and applied under row locks. Balance and hold invariants are enforced by
 * CHECK constraints in the database, so a bug here cannot produce a negative
 * available balance — the transaction fails instead.
 */
import { ECONOMY } from "@catchami/shared";
import type { Tx } from "../db/index.ts";

export interface Posting { account: string; amount: bigint }

export class LedgerError extends Error {
  code: "insufficient_funds" | "unbalanced" | "unknown_account" | "hold_state" | "invalid";
  constructor(code: "insufficient_funds" | "unbalanced" | "unknown_account" | "hold_state" | "invalid", message: string) {
    super(message);
    this.code = code;
  }
}

export const acct = {
  hq: "hq",
  team: "team",
  /** External counterpart for tokens held by the onchain vault. Goes negative by design. */
  chain: "chain",
  user: (id: string) => `user:${id}`,
  pet: (id: string) => `pet:${id}`,
  merchant: (id: string) => `merchant:${id}`,
};

export async function ensureAccount(
  tx: Tx,
  id: string,
  kind: string,
  opts: { userId?: string; petId?: string; allowNegative?: boolean } = {},
): Promise<void> {
  await tx.query(
    `INSERT INTO accounts (id, kind, user_id, pet_id, allow_negative) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
    [id, kind, opts.userId ?? null, opts.petId ?? null, opts.allowNegative ?? false],
  );
}

export async function ensureSystemAccounts(tx: Tx) {
  await ensureAccount(tx, acct.hq, "hq");
  await ensureAccount(tx, acct.team, "team");
  await ensureAccount(tx, acct.chain, "external", { allowNegative: true });
}

function isConstraintViolation(e: unknown): boolean {
  const m = String((e as Error)?.message ?? e);
  return /available_nonneg|held_nonneg|violates check constraint/i.test(m);
}

export interface PostResult { journalId: string; duplicate: boolean }

/**
 * Post a balanced journal entry. If `idem` was already used the call is a
 * no-op and returns duplicate=true (safe retries). Must run inside a tx.
 */
export async function post(
  tx: Tx,
  entry: { idem: string; kind: string; postings: Posting[]; meta?: Record<string, unknown>; settlementRef?: string; status?: "final" | "pending" },
): Promise<PostResult> {
  const postings = entry.postings.filter((p) => p.amount !== 0n);
  if (postings.length < 2 && postings.length !== 0) throw new LedgerError("unbalanced", "need at least two postings");
  const sum = postings.reduce((s, p) => s + p.amount, 0n);
  if (sum !== 0n) throw new LedgerError("unbalanced", `postings sum to ${sum}`);

  const ins = await tx.query<{ id: string }>(
    `INSERT INTO journal (idem, kind, status, config_version, meta, settlement_ref) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (idem) DO NOTHING RETURNING id`,
    [entry.idem, entry.kind, entry.status ?? "final", ECONOMY.version, JSON.stringify(entry.meta ?? {}, bigintJson), entry.settlementRef ?? null],
  );
  if (!ins.rows.length) {
    const ex = await tx.query<{ id: string }>(`SELECT id FROM journal WHERE idem = $1`, [entry.idem]);
    return { journalId: String(ex.rows[0]!.id), duplicate: true };
  }
  const journalId = String(ins.rows[0]!.id);
  if (!postings.length) return { journalId, duplicate: false };

  // Lock in a stable order to avoid deadlocks under real Postgres concurrency.
  const ids = [...new Set(postings.map((p) => p.account))].sort();
  const locked = await tx.query<{ id: string }>(`SELECT id FROM accounts WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`, [ids]);
  if (locked.rows.length !== ids.length) {
    const have = new Set(locked.rows.map((r) => r.id));
    throw new LedgerError("unknown_account", `unknown account(s): ${ids.filter((i) => !have.has(i)).join(",")}`);
  }
  try {
    for (const p of postings) {
      await tx.query(`INSERT INTO postings (journal_id, account_id, amount) VALUES ($1,$2,$3)`, [journalId, p.account, p.amount.toString()]);
      await tx.query(`UPDATE accounts SET balance = balance + $1::numeric WHERE id = $2`, [p.amount.toString(), p.account]);
    }
  } catch (e) {
    if (isConstraintViolation(e)) throw new LedgerError("insufficient_funds", "insufficient available funds");
    throw e;
  }
  return { journalId, duplicate: false };
}

/** Simple transfer helper. */
export function transfer(from: string, to: string, amount: bigint): Posting[] {
  if (amount < 0n) throw new LedgerError("invalid", "negative transfer");
  return [{ account: from, amount: -amount }, { account: to, amount }];
}

export async function balanceOf(tx: Tx, id: string): Promise<{ balance: bigint; held: bigint; available: bigint }> {
  const r = await tx.query<{ balance: string; held: string }>(`SELECT balance::text, held::text FROM accounts WHERE id = $1`, [id]);
  if (!r.rows.length) return { balance: 0n, held: 0n, available: 0n };
  const balance = BigInt(r.rows[0]!.balance), held = BigInt(r.rows[0]!.held);
  return { balance, held, available: balance - held };
}

/** Reserve funds (e.g. withdrawal in flight, PvP escrow). */
export async function placeHold(tx: Tx, h: { id: string; account: string; amount: bigint; reason: string; ref?: string }): Promise<boolean> {
  if (h.amount <= 0n) throw new LedgerError("invalid", "hold must be positive");
  const ins = await tx.query(`INSERT INTO holds (id, account_id, amount, reason, ref) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING RETURNING id`, [
    h.id, h.account, h.amount.toString(), h.reason, h.ref ?? null,
  ]);
  if (!ins.rows.length) return false; // idempotent
  try {
    await tx.query(`UPDATE accounts SET held = held + $1::numeric WHERE id = $2`, [h.amount.toString(), h.account]);
  } catch (e) {
    if (isConstraintViolation(e)) throw new LedgerError("insufficient_funds", "insufficient available funds for hold");
    throw e;
  }
  return true;
}

/** Release (cancel) an active hold. */
export async function releaseHold(tx: Tx, id: string): Promise<void> {
  const r = await tx.query<{ account_id: string; amount: string; status: string }>(`SELECT account_id, amount::text, status FROM holds WHERE id = $1 FOR UPDATE`, [id]);
  const h = r.rows[0];
  if (!h) throw new LedgerError("hold_state", "no such hold");
  if (h.status !== "active") return;
  await tx.query(`UPDATE holds SET status = 'released', updated_at = now() WHERE id = $1`, [id]);
  await tx.query(`UPDATE accounts SET held = held - $1::numeric WHERE id = $2`, [h.amount, h.account_id]);
}

/** Capture an active hold: release it and post the given entry atomically. */
export async function captureHold(tx: Tx, id: string, entry: Parameters<typeof post>[1]): Promise<PostResult> {
  const r = await tx.query<{ account_id: string; amount: string; status: string }>(`SELECT account_id, amount::text, status FROM holds WHERE id = $1 FOR UPDATE`, [id]);
  const h = r.rows[0];
  if (!h || h.status !== "active") throw new LedgerError("hold_state", `hold ${id} not active`);
  await tx.query(`UPDATE holds SET status = 'captured', updated_at = now() WHERE id = $1`, [id]);
  await tx.query(`UPDATE accounts SET held = held - $1::numeric WHERE id = $2`, [h.amount, h.account_id]);
  return post(tx, entry);
}

export interface TrialBalance {
  sumOfBalances: bigint;
  chainLiability: bigint; // tokens the ledger says the vault holds
  postingsImbalance: bigint;
  journalsUnbalanced: number;
  negativeNonExternal: number;
  derivedMismatch: number;
}

/** Internal consistency checks; run continuously by the reconciler. */
export async function trialBalance(tx: Tx): Promise<TrialBalance> {
  const s = await tx.query<{ s: string | null }>(`SELECT COALESCE(SUM(balance),0)::text AS s FROM accounts`);
  const c = await tx.query<{ b: string | null }>(`SELECT COALESCE(SUM(balance),0)::text AS b FROM accounts WHERE kind = 'external'`);
  const p = await tx.query<{ s: string | null }>(`SELECT COALESCE(SUM(amount),0)::text AS s FROM postings`);
  const u = await tx.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM (SELECT journal_id FROM postings GROUP BY journal_id HAVING SUM(amount) <> 0) x`);
  const n = await tx.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM accounts WHERE NOT allow_negative AND balance - held < 0`);
  const h = await tx.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM accounts a LEFT JOIN (SELECT account_id, SUM(amount) s FROM holds WHERE status='active' GROUP BY account_id) x ON x.account_id = a.id
     WHERE a.held <> COALESCE(x.s, 0)`,
  );
  const r2 = await tx.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM accounts a LEFT JOIN (SELECT account_id, SUM(amount) s FROM postings GROUP BY account_id) x ON x.account_id = a.id
     WHERE a.balance <> COALESCE(x.s, 0)`,
  );
  return {
    sumOfBalances: BigInt(s.rows[0]!.s ?? "0"),
    chainLiability: -BigInt(c.rows[0]!.b ?? "0"),
    postingsImbalance: BigInt(p.rows[0]!.s ?? "0"),
    journalsUnbalanced: Number(u.rows[0]!.n),
    negativeNonExternal: Number(n.rows[0]!.n),
    derivedMismatch: Number(h.rows[0]!.n) + Number(r2.rows[0]!.n),
  };
}

export function bigintJson(_k: string, v: unknown) {
  return typeof v === "bigint" ? v.toString() : v;
}
