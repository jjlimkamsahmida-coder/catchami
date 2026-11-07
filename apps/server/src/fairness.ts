/**
 * Hourly commit-reveal epochs. The commitment (sha256 of the secret seed) is
 * public from the start of the hour; the seed is revealed once the hour ends.
 * Every catch, rarity, battle, equipment and reward roll records the epoch
 * and label used, so outcomes can be recomputed by anyone after the reveal.
 */
import { commitmentOf, randomSeedHex } from "@catchami/shared";
import type { Db, Tx } from "./db/index.ts";

const EPOCH_MS = 3600_000;
export const epochIdAt = (t: number) => Math.floor(t / EPOCH_MS);

export interface Epoch { id: number; seed: string; commitment: string }

const cache = new Map<number, Epoch>();

/** Current epoch, created (and committed) on first use. Seeds never leave the server before reveal. */
export async function currentEpoch(db: Db | Tx, now = Date.now()): Promise<Epoch> {
  const id = epochIdAt(now);
  const hit = cache.get(id);
  if (hit) return hit;
  const seed = randomSeedHex();
  await db.query(
    `INSERT INTO fairness_epochs (id, commitment, seed, starts_at, ends_at) VALUES ($1,$2,$3,to_timestamp($4/1000.0),to_timestamp($5/1000.0)) ON CONFLICT (id) DO NOTHING`,
    [id, commitmentOf(seed), seed, id * EPOCH_MS, (id + 1) * EPOCH_MS],
  );
  const r = await db.query<{ seed: string; commitment: string }>(`SELECT seed, commitment FROM fairness_epochs WHERE id = $1`, [id]);
  const e = { id, seed: r.rows[0]!.seed, commitment: r.rows[0]!.commitment };
  cache.set(id, e);
  for (const k of cache.keys()) if (k < id - 1) cache.delete(k);
  return e;
}

/** Public view: commitments for all epochs, seeds only for finished ones. */
export async function publicEpochs(db: Db, limit = 48, now = Date.now()) {
  const cur = epochIdAt(now);
  await db.query(`UPDATE fairness_epochs SET revealed = true WHERE id < $1 AND NOT revealed`, [cur]);
  const r = await db.query<{ id: string; commitment: string; seed: string; revealed: boolean }>(
    `SELECT id, commitment, seed, revealed FROM fairness_epochs ORDER BY id DESC LIMIT $1`, [limit],
  );
  return r.rows.map((e) => ({ id: Number(e.id), commitment: e.commitment, seed: Number(e.id) < cur ? e.seed : null }));
}
