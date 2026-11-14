/**
 * The chain worker keeps the offchain ledger and the onchain vault in step.
 *
 *  - Mints:       every caught pet (and crafted gear) becomes a NEP-171 NFT,
 *                 sent to the owner's wallet, or held in custody by the
 *                 operator for guests until they link a wallet.
 *  - Custody:     when a guest links a wallet, custody NFTs are transferred to it.
 *  - Deposits:    vault deposits (purchases, HQ funding, player top-ups) are
 *                 indexed into the ledger as `chain -> account` entries.
 *  - Withdrawals: onchain withdrawal requests put a hold on the ledger account;
 *                 the next batch acknowledges them; execution is posted as
 *                 `account -> chain`.
 *  - Settlement:  every gameplay journal entry since the last batch is netted
 *                 per vault bucket (pets, users, HQ, merchants, team) and
 *                 submitted as one balanced `settle` batch.
 *
 * Journal entries that touch the `chain` account are already onchain (they
 * come from indexed deposits/withdrawals), so they are never re-settled.
 */
import { createHash } from "node:crypto";
import type { Db, Tx } from "../db/index.ts";
import { env } from "../env.ts";
import { acct, captureHold, LedgerError, placeHold, post, releaseHold, transfer } from "../ledger/ledger.ts";
import type { Game } from "../world/game.ts";
import { call, canSell, canSign, market, NEAR, ONE_YOCTO, operator, view } from "./signer.ts";

export type Bucket = "Hq" | "Team" | "Merchants" | { User: string } | { Pet: string };
export const petToken = (petId: string) => `a-${petId}`;
export const gearToken = (id: string) => `e-${id}`;
const custody = () => env.near.operatorAccount!;

/** A stable vault bucket for a player without a wallet (never a real account; it can't withdraw). */
export function guestBucket(userId: string) {
  return `g${createHash("sha256").update(userId).digest("hex").slice(0, 24)}.${env.near.gameContract}`;
}

async function kvGet<T>(tx: Tx, k: string, d: T): Promise<T> {
  const r = await tx.query<{ v: T }>(`SELECT v FROM kv WHERE k = $1`, [k]);
  return r.rows[0] ? r.rows[0].v : d;
}
async function kvSet(tx: Tx, k: string, v: unknown) {
  await tx.query(`INSERT INTO kv (k, v) VALUES ($1, $2) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`, [k, JSON.stringify(v)]);
}

/** The vault bucket a player's wallet balance lives in (fixed on first use; moved once they link a wallet). */
export async function userBucket(tx: Tx, userId: string): Promise<string> {
  const r = await tx.query<{ near_account: string | null; chain_bucket: string | null }>(`SELECT near_account, chain_bucket FROM users WHERE id = $1`, [userId]);
  const u = r.rows[0];
  if (!u) throw new Error(`no user ${userId}`);
  if (u.chain_bucket) return u.chain_bucket;
  const b = u.near_account ?? guestBucket(userId);
  await tx.query(`UPDATE users SET chain_bucket = $2 WHERE id = $1`, [userId, b]);
  return b;
}

const short = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 240);
const bucketKey = (b: Bucket) => (typeof b === "string" ? b : "User" in b ? `u:${b.User}` : `p:${b.Pet}`);

export interface ChainStatus {
  enabled: boolean;
  canSell: boolean;
  lastBatch: { id: number; txHash: string | null; at: number; deltas: number } | null;
  lastError: string | null;
  unsettledJournals: number;
  pendingMints: number;
}

export class ChainWorker {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private lastSettle = 0;
  private forceSettle = false;
  private nextBatch: number | null = null;
  private backoff = new Map<string, number>();
  status: ChainStatus = { enabled: false, canSell: false, lastBatch: null, lastError: null, unsettledJournals: 0, pendingMints: 0 };

  private db: Db;
  private game: Game;
  constructor(db: Db, game: Game) { this.db = db; this.game = game; }

  get enabled() { return env.network !== "dev" && canSign(); }

  start() {
    this.status.enabled = this.enabled;
    this.status.canSell = canSell();
    if (!this.enabled) { console.log(`[chain] off (network=${env.network}, signer=${canSign()})`); return; }
    console.log(`[chain] on: game=${env.near.gameContract} token=${env.near.tokenContract} operator=${env.near.operatorAccount} market=${env.near.marketAccount ?? "-"}`);
    void this.db.query<{ id: string; tx_hash: string | null; created_at: string; deltas: unknown[] }>(`SELECT id::text, tx_hash, created_at::text, deltas FROM chain_batches ORDER BY id DESC LIMIT 1`).then((r) => {
      const b = r.rows[0];
      if (b && !this.status.lastBatch) this.status.lastBatch = { id: Number(b.id), txHash: b.tx_hash, at: new Date(b.created_at.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00")).getTime(), deltas: Array.isArray(b.deltas) ? b.deltas.length : 0 };
    }).catch(() => {});
    this.timer = setInterval(() => void this.tick(), 8_000);
    this.timer.unref();
    void this.tick();
  }
  stop() { if (this.timer) clearInterval(this.timer); }

  /** One pass; concurrent callers share the running pass. */
  tick(): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      const step = async (name: string, fn: () => Promise<void>) => {
        try { await fn(); } catch (e) { this.status.lastError = `${name}: ${short(e)}`; console.error(`[chain] ${name}:`, short(e)); }
      };
      await step("deposits", () => this.indexDeposits());
      await step("withdrawals", () => this.indexWithdrawals());
      await step("mint", () => this.mintPending());
      await step("custody", () => this.moveCustody());
      const due = this.forceSettle || Date.now() - this.lastSettle > 30_000;
      if (due) await step("settle", () => this.settle());
    })().finally(() => { this.running = null; });
    return this.running;
  }

  /** "Sync now": settle everything up to this moment and wait for it. */
  async syncNow() {
    if (!this.enabled) throw new Error("The chain isn't connected on this server");
    await this.running?.catch(() => {});
    this.forceSettle = true;
    await this.tick();
    return this.status.lastBatch;
  }

  private ready(key: string) { return (this.backoff.get(key) ?? 0) <= Date.now(); }
  private fails = new Map<string, number>();
  private fail(key: string, e: unknown) {
    const n = Math.min(6, this.fails.get(key) ?? 0);
    this.fails.set(key, n + 1);
    this.backoff.set(key, Date.now() + 15_000 * 2 ** n);
    this.status.lastError = `${key}: ${short(e)}`;
    console.error(`[chain] ${key}:`, short(e));
  }

  // ------------------------------------------------------------- mints --

  private async mintPending() {
    const pets = await this.db.query<{ id: string; name: string; species: string; rarity: string; sticker: string | null; near_account: string | null }>(
      `SELECT p.id, p.name, p.species, p.rarity, p.sticker, u.near_account FROM pets p JOIN users u ON u.id = p.owner_id
       WHERE p.mint_status <> 'minted' ORDER BY p.created_at LIMIT 4`,
    );
    const gear = await this.db.query<{ id: string; kind: string; rarity: string; near_account: string | null }>(
      `SELECT e.id, e.kind, e.rarity, u.near_account FROM equipment e JOIN users u ON u.id = e.owner_id
       WHERE e.mint_status <> 'minted' ORDER BY e.created_at LIMIT 2`,
    );
    this.status.pendingMints = pets.rows.length + gear.rows.length;
    const op = operator()!;
    for (const p of pets.rows) {
      const key = `mint:${p.id}`;
      if (!this.ready(key)) continue;
      const tokenId = petToken(p.id);
      const owner = p.near_account ?? custody();
      try {
        const existing = await view<{ owner_id: string } | null>(env.near.gameContract!, "nft_token", { token_id: tokenId });
        let txHash: string | null = null, nftOwner = owner;
        if (existing) nftOwner = existing.owner_id;
        else {
          const media = p.sticker ? (p.sticker.startsWith("http") ? p.sticker : `${env.publicUrl}${p.sticker}`) : null;
          const r = await call(op, env.near.gameContract!, "mint", {
            token_id: tokenId, owner_id: owner,
            metadata: {
              title: p.name,
              description: `A ${p.rarity} ${p.species} caught in Catchami. Its piggy bank holds $CATCHAMI in the Catchami vault.`,
              media, issued_at: String(Date.now()), copies: 1,
              extra: JSON.stringify({ game: "catchami", petId: p.id, species: p.species, rarity: p.rarity }),
            },
          }, { gasTgas: 60, depositYocto: NEAR(0.02) });
          txHash = r.txHash;
        }
        await this.db.query(`UPDATE pets SET mint_status = 'minted', nft_token_id = $2, nft_owner = $3, mint_tx = COALESCE($4, mint_tx), updated_at = now() WHERE id = $1`, [p.id, tokenId, nftOwner, txHash]);
        await this.db.query(`UPDATE outbox SET status = 'done', tx_hash = $2, updated_at = now() WHERE idem = $1`, [`mint:${p.id}`, txHash]);
        await this.game.reloadPet(p.id);
        console.log(`[chain] minted ${tokenId} -> ${nftOwner} ${txHash ?? "(already onchain)"}`);
      } catch (e) { this.fail(key, e); }
    }
    for (const g of gear.rows) {
      const key = `mint:${g.id}`;
      if (!this.ready(key)) continue;
      const tokenId = gearToken(g.id);
      const owner = g.near_account ?? custody();
      try {
        const existing = await view<{ owner_id: string } | null>(env.near.gameContract!, "nft_token", { token_id: tokenId });
        let txHash: string | null = null;
        if (!existing) {
          txHash = (await call(op, env.near.gameContract!, "mint", {
            token_id: tokenId, owner_id: owner,
            metadata: { title: `${g.rarity} ${g.kind.replace(/_/g, " ")}`, description: "Catchami pet gear.", copies: 1, extra: JSON.stringify({ game: "catchami", gear: g.kind, rarity: g.rarity }) },
          }, { gasTgas: 60, depositYocto: NEAR(0.02) })).txHash;
        }
        await this.db.query(`UPDATE equipment SET mint_status = 'minted', nft_token_id = $2, nft_owner = $3 WHERE id = $1`, [g.id, tokenId, existing?.owner_id ?? owner]);
        await this.db.query(`UPDATE outbox SET status = 'done', tx_hash = $2, updated_at = now() WHERE idem = $1`, [`mint:${g.id}`, txHash]);
      } catch (e) { this.fail(key, e); }
    }
  }

  /** Custody NFTs follow their owner's wallet once one is linked (and after in-game sales to wallet players). */
  private async moveCustody() {
    const rows = await this.db.query<{ id: string; nft_token_id: string; near_account: string }>(
      `SELECT p.id, p.nft_token_id, u.near_account FROM pets p JOIN users u ON u.id = p.owner_id
       WHERE p.mint_status = 'minted' AND p.nft_owner = $1 AND u.near_account IS NOT NULL LIMIT 4`, [custody()],
    );
    for (const r of rows.rows) {
      const key = `xfer:${r.id}`;
      if (!this.ready(key)) continue;
      try {
        const t = await call(operator()!, env.near.gameContract!, "nft_transfer", { receiver_id: r.near_account, token_id: r.nft_token_id, memo: "Catchami: to your wallet" }, { gasTgas: 50, depositYocto: ONE_YOCTO });
        await this.db.query(`UPDATE pets SET nft_owner = $2 WHERE id = $1`, [r.id, r.near_account]);
        await this.game.reloadPet(r.id);
        console.log(`[chain] custody ${r.nft_token_id} -> ${r.near_account} ${t.txHash}`);
      } catch (e) { this.fail(key, e); }
    }
    // Make sure linked wallets can receive $CATCHAMI (withdrawals) and USDC (swaps).
    const accts = await this.db.query<{ near_account: string }>(`SELECT near_account FROM users WHERE near_account IS NOT NULL AND near_account NOT IN (SELECT substr(k, 11) FROM kv WHERE k LIKE 'chain:reg:%') LIMIT 3`);
    for (const a of accts.rows) {
      const key = `reg:${a.near_account}`;
      if (!this.ready(key)) continue;
      try {
        for (const token of [env.near.tokenContract!, env.near.usdcToken]) {
          const has = await view<unknown>(token, "storage_balance_of", { account_id: a.near_account }).catch(() => null);
          if (!has) await call(operator()!, token, "storage_deposit", { account_id: a.near_account, registration_only: true }, { gasTgas: 30, depositYocto: 1_250_000_000_000_000_000_000n });
        }
        await this.db.tx((tx) => kvSet(tx, `chain:reg:${a.near_account}`, { at: Date.now() }));
      } catch (e) { this.fail(key, e); }
    }
  }

  // ---------------------------------------------------------- deposits --

  async indexDeposits() {
    const from = await this.db.tx((tx) => kvGet<number>(tx, "chain:dep_seq", 0));
    const list = await view<Array<{ seq: number; sender: string; amount: string; target: { user?: string | null; pet?: string | null; hq?: boolean | null } }>>(
      env.near.gameContract!, "deposits_since", { from_seq: from, limit: 50 },
    );
    for (const d of list) {
      await this.db.tx(async (tx) => {
        let account: string | null = null;
        if (d.target.hq) account = acct.hq;
        else if (d.target.pet) {
          const id = d.target.pet.startsWith("a-") ? d.target.pet.slice(2) : null;
          const r = id ? await tx.query(`SELECT 1 FROM accounts WHERE id = $1`, [acct.pet(id)]) : { rows: [] };
          if (r.rows.length) account = acct.pet(id!);
        } else if (d.target.user) {
          const r = await tx.query<{ id: string }>(`SELECT id FROM users WHERE chain_bucket = $1 OR near_account = $1 ORDER BY (chain_bucket = $1) DESC LIMIT 1`, [d.target.user]);
          if (r.rows[0]) account = acct.user(r.rows[0].id);
        }
        if (account) {
          await post(tx, {
            idem: `dep:${d.seq}`, kind: "deposit", postings: transfer(acct.chain, account, BigInt(d.amount)),
            meta: { seq: d.seq, sender: d.sender, target: d.target }, settlementRef: `deposit:${d.seq}`,
          });
        } else {
          const un = await kvGet<unknown[]>(tx, "chain:unmatched_deposits", []);
          await kvSet(tx, "chain:unmatched_deposits", [...un.slice(-49), d]);
          console.warn(`[chain] deposit ${d.seq} has no matching player (${JSON.stringify(d.target)})`);
        }
        await kvSet(tx, "chain:dep_seq", d.seq + 1);
      });
      if (d.target.pet?.startsWith("a-")) { const p = this.game.pets.get(d.target.pet.slice(2)); if (p) await this.game.refreshBalance(p); }
    }
  }

  // ------------------------------------------------------- withdrawals --

  private async ledgerAccountFor(tx: Tx, source: unknown): Promise<string | null> {
    const s = source as { Pet?: string; User?: string };
    if (s.Pet?.startsWith("a-")) return acct.pet(s.Pet.slice(2));
    if (s.User) {
      const r = await tx.query<{ id: string }>(`SELECT id FROM users WHERE chain_bucket = $1 OR near_account = $1 LIMIT 1`, [s.User]);
      return r.rows[0] ? acct.user(r.rows[0].id) : null;
    }
    return null;
  }

  private async indexWithdrawals() {
    type W = { id: string; account: string; source: unknown; amount: string; acked: boolean; status: "Pending" | "Executing" | "Executed" | "Cancelled" };
    const from = await this.db.tx((tx) => kvGet<number>(tx, "chain:wd_id", 0));
    const fresh = await view<W[]>(env.near.gameContract!, "withdrawals_since", { from_id: from, limit: 50 });
    const open = await this.db.query<{ id: string }>(`SELECT id::text FROM chain_withdrawals WHERE status IN ('Pending','Executing') AND id < $1 ORDER BY id LIMIT 20`, [from]);
    const again: W[] = [];
    for (const o of open.rows) { const w = await view<W[]>(env.near.gameContract!, "withdrawals_since", { from_id: Number(o.id), limit: 1 }); if (w[0]) again.push(w[0]); }
    for (const w of [...fresh, ...again]) {
      const id = Number(w.id);
      await this.db.tx(async (tx) => {
        const la = await this.ledgerAccountFor(tx, w.source);
        await tx.query(
          `INSERT INTO chain_withdrawals (id, account, source, ledger_account, amount, status, acked) VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, acked = chain_withdrawals.acked OR EXCLUDED.acked, amount = EXCLUDED.amount, updated_at = now()`,
          [id, w.account, JSON.stringify(w.source), la, w.amount, w.status, w.acked],
        );
        const row = (await tx.query<{ hold_id: string | null; note: string | null }>(`SELECT hold_id, note FROM chain_withdrawals WHERE id = $1`, [id])).rows[0]!;
        if (!la) { await tx.query(`UPDATE chain_withdrawals SET note = 'unmatched' WHERE id = $1`, [id]); return; }
        const holdId = `cw:${id}`;
        if (w.status === "Pending" && !row.hold_id) {
          try {
            await placeHold(tx, { id: holdId, account: la, amount: BigInt(w.amount), reason: "chain_withdrawal", ref: String(id) });
            await tx.query(`UPDATE chain_withdrawals SET hold_id = $2, note = NULL WHERE id = $1`, [id, holdId]);
            this.forceSettle = true; // acknowledge it in the next batch
          } catch (e) {
            if (e instanceof LedgerError) await tx.query(`UPDATE chain_withdrawals SET note = 'waiting_for_sync' WHERE id = $1`, [id]);
            else throw e;
          }
        } else if ((w.status === "Executed" || w.status === "Executing") && row.note !== "posted") {
          if (w.status === "Executing") return; // callback still in flight
          const entry = { idem: `cwx:${id}`, kind: "withdrawal", postings: transfer(la, acct.chain, BigInt(w.amount)), meta: { withdrawal: id, to: w.account }, settlementRef: `withdrawal:${id}` };
          if (row.hold_id) await captureHold(tx, row.hold_id, entry); else await post(tx, entry);
          await tx.query(`UPDATE chain_withdrawals SET note = 'posted' WHERE id = $1`, [id]);
        } else if (w.status === "Cancelled" && row.hold_id && row.note !== "released") {
          await releaseHold(tx, row.hold_id);
          await tx.query(`UPDATE chain_withdrawals SET note = 'released' WHERE id = $1`, [id]);
        }
        if (id >= from) await kvSet(tx, "chain:wd_id", Math.max(id + 1, await kvGet<number>(tx, "chain:wd_id", 0)));
      });
      const s = w.source as { Pet?: string };
      if (s.Pet?.startsWith("a-")) { const p = this.game.pets.get(s.Pet.slice(2)); if (p) await this.game.refreshBalance(p); }
    }
  }

  // -------------------------------------------------------- settlement --

  async settle() {
    this.lastSettle = Date.now();
    this.forceSettle = false;
    // Entries that touch `chain` are mirrors of onchain events: never settle them again.
    await this.db.query(`UPDATE journal SET settled_batch = -1 WHERE settled_batch IS NULL AND EXISTS (SELECT 1 FROM postings p WHERE p.journal_id = journal.id AND p.account_id = $1)`, [acct.chain]);
    const mx = await this.db.query<{ m: string | null; n: string }>(`SELECT MAX(id)::text m, COUNT(*)::text n FROM journal WHERE settled_batch IS NULL AND status = 'final'`);
    const maxId = mx.rows[0]?.m ? BigInt(mx.rows[0].m) : null;
    this.status.unsettledJournals = Number(mx.rows[0]?.n ?? 0);
    const acks = (await this.db.query<{ id: string }>(`SELECT id::text FROM chain_withdrawals WHERE status = 'Pending' AND hold_id IS NOT NULL AND NOT acked ORDER BY id LIMIT 50`)).rows.map((r) => r.id);
    if (maxId === null && !acks.length) return;

    // Players who linked a wallet after playing as a guest: move their guest bucket to the wallet.
    const movers = (await this.db.query<{ id: string; near_account: string; chain_bucket: string }>(
      `SELECT id, near_account, chain_bucket FROM users WHERE near_account IS NOT NULL AND chain_bucket IS NOT NULL AND chain_bucket <> near_account LIMIT 10`,
    )).rows;
    const mapUser = new Map<string, string>();
    const sums = new Map<string, { bucket: Bucket; amount: bigint }>();
    const add = (b: Bucket, amt: bigint) => { const k = bucketKey(b); const cur = sums.get(k); if (cur) cur.amount += amt; else sums.set(k, { bucket: b, amount: amt }); };
    for (const m of movers) {
      mapUser.set(m.id, m.near_account);
      const bal = await view<{ balance: string }>(env.near.gameContract!, "balance_of", { bucket: { User: m.chain_bucket } });
      const b = BigInt(bal.balance);
      if (b > 0n) { add({ User: m.chain_bucket }, -b); add({ User: m.near_account }, b); }
    }

    let ids: string[] = [];
    if (maxId !== null) {
      const rows = await this.db.query<{ account_id: string; s: string; kind: string; user_id: string | null; pet_id: string | null }>(
        `SELECT p.account_id, SUM(p.amount)::text s, a.kind, a.user_id, a.pet_id FROM postings p
         JOIN journal j ON j.id = p.journal_id JOIN accounts a ON a.id = p.account_id
         WHERE j.settled_batch IS NULL AND j.status = 'final' AND j.id <= $1
         GROUP BY p.account_id, a.kind, a.user_id, a.pet_id HAVING SUM(p.amount) <> 0`, [maxId.toString()],
      );
      for (const r of rows.rows) {
        const amt = BigInt(r.s);
        let b: Bucket;
        if (r.account_id === acct.hq) b = "Hq";
        else if (r.account_id === acct.team) b = "Team";
        else if (r.account_id.startsWith("merchant:")) b = "Merchants";
        else if (r.account_id.startsWith("pet:")) b = { Pet: petToken(r.account_id.slice(4)) };
        else if (r.account_id.startsWith("user:")) {
          const uid = r.account_id.slice(5);
          b = { User: mapUser.get(uid) ?? (await this.db.tx((tx) => userBucket(tx, uid))) };
        } else throw new Error(`no vault bucket for ledger account ${r.account_id}`);
        add(b, amt);
      }
      ids = (await this.db.query<{ id: string }>(`SELECT id::text FROM journal WHERE settled_batch IS NULL AND status = 'final' AND id <= $1 ORDER BY id`, [maxId.toString()])).rows.map((r) => r.id);
    }
    const deltas = [...sums.values()].filter((d) => d.amount !== 0n);
    const total = deltas.reduce((s, d) => s + d.amount, 0n);
    if (total !== 0n) throw new Error(`batch does not balance (${total})`);

    if (!deltas.length && !acks.length && !movers.length) {
      // Everything netted out: nothing to send.
      if (maxId !== null) await this.db.query(`UPDATE journal SET settled_batch = -2 WHERE settled_batch IS NULL AND status = 'final' AND id <= $1`, [maxId.toString()]);
      return;
    }

    if (this.nextBatch === null) this.nextBatch = Number((await view<Record<string, string>>(env.near.gameContract!, "config", {})).next_batch);
    const batchId = this.nextBatch;
    const journalHash = createHash("sha256").update(ids.join(",")).digest("hex");
    const wire = deltas.map((d) => ({ bucket: d.bucket, amount: d.amount.toString() }));
    let txHash: string;
    try {
      txHash = (await call(operator()!, env.near.gameContract!, "settle", { batch_id: String(batchId), deltas: wire, journal_hash: journalHash, ack_withdrawals: acks }, { gasTgas: 300 })).txHash;
    } catch (e) {
      this.nextBatch = null; // re-read on the next try (gap/replay protection lives onchain)
      throw e;
    }
    this.nextBatch = batchId + 1;
    if (maxId !== null) await this.db.query(`UPDATE journal SET settled_batch = $2 WHERE settled_batch IS NULL AND status = 'final' AND id <= $1`, [maxId.toString(), batchId]);
    await this.db.query(`INSERT INTO chain_batches (id, tx_hash, deltas, journal_hash, max_journal) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`, [batchId, txHash, JSON.stringify(wire), journalHash, (maxId ?? 0n).toString()]);
    if (acks.length) await this.db.query(`UPDATE chain_withdrawals SET acked = true WHERE id = ANY($1::bigint[])`, [acks]);
    for (const m of movers) await this.db.query(`UPDATE users SET chain_bucket = near_account WHERE id = $1`, [m.id]);
    this.status.lastBatch = { id: batchId, txHash, at: Date.now(), deltas: wire.length };
    this.status.lastError = null;
    this.status.unsettledJournals = 0;
    console.log(`[chain] settled batch ${batchId}: ${wire.length} deltas, ${ids.length} entries, ${acks.length} acks ${txHash}`);
  }

  // ------------------------------------------------------------- sales --

  /**
   * Deliver $CATCHAMI bought by a player from the 55% market allocation:
   * a real `ft_transfer_call` into the vault, credited to the player's bucket.
   * (Testnet: the card / Intents payment in front of this is simulated.)
   */
  async deliver(userId: string, amount: bigint, memo: string): Promise<{ txHash: string }> {
    const m = market();
    if (!m || !env.near.marketAccount) throw new Error("The market account isn't connected on this server");
    const bucket = await this.db.tx((tx) => userBucket(tx, userId));
    const r = await call(m, env.near.tokenContract!, "ft_transfer_call", {
      receiver_id: env.near.gameContract, amount: amount.toString(), memo, msg: JSON.stringify({ deposit_for: { account_id: bucket } }),
    }, { gasTgas: 100, depositYocto: ONE_YOCTO });
    await this.indexDeposits();
    return { txHash: r.txHash };
  }
}

/** Explorer link helpers. */
export const txUrl = (h: string | null | undefined) => (h ? `${env.near.explorer}/txns/${h}` : null);
export const nftUrl = (tokenId: string) => `${env.near.explorer}/nft-token/${env.near.gameContract}/${encodeURIComponent(tokenId)}`;
export const accountUrl = (a: string) => `${env.near.explorer}/address/${a}`;

let current: ChainWorker | null = null;
export const setChainWorker = (w: ChainWorker) => { current = w; };
export const getChainWorker = () => current;

/** What the player's Coin Vault shows about the chain side of their account. */
export async function chainMe(db: Db, game: Game, userId: string) {
  const w = getChainWorker();
  const u = (await db.query<{ near_account: string | null; chain_bucket: string | null }>(`SELECT near_account, chain_bucket FROM users WHERE id = $1`, [userId])).rows[0];
  const pets = (await db.query<{ id: string; name: string; nft_token_id: string | null; nft_owner: string | null; mint_status: string; mint_tx: string | null }>(
    `SELECT id, name, nft_token_id, nft_owner, mint_status, mint_tx FROM pets WHERE owner_id = $1 ORDER BY created_at`, [userId],
  )).rows;
  const enabled = Boolean(w?.enabled);
  const onchainPet = async (tokenId: string | null) => {
    if (!enabled || !tokenId) return null;
    try { return (await view<{ balance: string; reserved: string; available: string }>(env.near.gameContract!, "balance_of", { bucket: { Pet: tokenId } })); } catch { return null; }
  };
  const bucket = u?.chain_bucket ?? u?.near_account ?? null;
  let userOnchain: { balance: string; available: string } | null = null;
  if (enabled && bucket) { try { userOnchain = await view(env.near.gameContract!, "balance_of", { bucket: { User: bucket } }); } catch { userOnchain = null; } }
  let walletTokens: string | null = null;
  if (enabled && u?.near_account) { try { walletTokens = await view<string>(env.near.tokenContract!, "ft_balance_of", { account_id: u.near_account }); } catch { walletTokens = null; } }
  let walletUsdc: string | null = null;
  if (enabled && u?.near_account) { try { walletUsdc = await view<string>(env.near.usdcToken, "ft_balance_of", { account_id: u.near_account }); } catch { walletUsdc = null; } }
  const withdrawals = (await db.query<{ id: string; source: unknown; amount: string; status: string; acked: boolean; note: string | null; created_at: string }>(
    `SELECT id::text, source, amount::text, status, acked, note, created_at::text FROM chain_withdrawals WHERE account = $1 ORDER BY id DESC LIMIT 20`, [u?.near_account ?? "-"],
  )).rows;
  return {
    enabled, network: env.network, nearAccount: u?.near_account ?? null, bucket,
    contracts: { game: env.near.gameContract, token: env.near.tokenContract, usdc: env.near.usdcToken, ref: env.near.refContract, pool: env.near.refPoolId, explorer: env.near.explorer },
    custody: env.near.operatorAccount,
    userOnchain, walletTokens, walletUsdc,
    pets: await Promise.all(pets.map(async (p) => ({
      id: p.id, name: p.name, tokenId: p.nft_token_id, owner: p.nft_owner, custody: p.nft_owner === env.near.operatorAccount, minted: p.mint_status === "minted",
      mintTx: txUrl(p.mint_tx), nftUrl: p.nft_token_id ? nftUrl(p.nft_token_id) : null, onchain: await onchainPet(p.nft_token_id),
      offchain: (() => { const rt = game.pets.get(p.id); return rt ? rt.balance.toString() : null; })(),
    }))),
    withdrawals,
    status: w?.status ?? null,
  };
}
