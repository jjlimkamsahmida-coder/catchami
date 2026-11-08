/**
 * Capture flow:
 *  1. validate(): server-side detection on uploaded frames, liveness and
 *     duplicate checks. Invalid => rejected, nothing is charged, ever.
 *  2. attempt(): player picks a tier after seeing exact costs and odds.
 *     Fair roll (commit-reveal epoch). Success => 80/18/2 split and a new
 *     pet; failure => 100% to HQ. One atomic DB transaction either way.
 * Infrastructure errors never resolve an attempt; it stays 'valid' to retry.
 */
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  CATCH_TIERS, ECONOMY, generateGenome, rollCatch, splitBps, toWire,
  type CatchQuote, type CatchTier, type Species,
} from "@catchami/shared";
import type { Db } from "../db/index.ts";
import { env, chainConfigured } from "../env.ts";
import { newId } from "../auth.ts";
import { currentEpoch } from "../fairness.ts";
import { acct, ensureAccount, LedgerError, post } from "../ledger/ledger.ts";
import { freshPetState } from "../world/types.ts";
import type { Game } from "../world/game.ts";
import type { Detector } from "./detector.ts";
import { decodeJpeg, dHash, frameDifference, hamming, renderSticker } from "./image.ts";

export class CaptureError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.code = code; this.status = status; }
}

const VALID_FOR_MS = 10 * 60_000;

export function quotes(): CatchQuote[] {
  return CATCH_TIERS.map((tier) => {
    const t = ECONOMY.catch.tiers[tier];
    const s = splitBps(t.cost, ECONOMY.catch.successSplit, "hq");
    return {
      tier, cost: toWire(t.cost), successPpm: t.successPpm, rarityPpm: ECONOMY.catch.rarityPpm[tier],
      split: { pet: toWire(s.pet), hq: toWire(s.hq), team: toWire(s.team) }, failedToHq: toWire(t.cost),
    };
  });
}

export async function validateCapture(db: Db, detector: Detector | null, userId: string, frames: Buffer[], game: Game) {
  if (game.flags.pauseCatches) throw new CaptureError("paused", "Catching is paused by operations", 503);
  if (!detector?.ready) throw new CaptureError("detector_unavailable", "Animal check is temporarily unavailable — nothing was charged. Try again shortly.", 503);
  const today = await db.query<{ n: string }>(`SELECT COUNT(*)::text n FROM catch_attempts WHERE user_id = $1 AND created_at > now() - interval '1 day'`, [userId]);
  if (Number(today.rows[0]!.n) >= ECONOMY.catch.maxCapturesPerUserPerDay * 3) throw new CaptureError("rate_limited", "Too many capture checks today. Try again tomorrow.", 429);

  const id = newId("ca");
  const reject = async (reason: string, message: string, extra: Record<string, unknown> = {}) => {
    await db.query(`INSERT INTO catch_attempts (id, user_id, status, reject_reason, detection) VALUES ($1,$2,'rejected',$3,$4)`, [id, userId, reason, JSON.stringify(extra)]);
    return { ok: false as const, attemptId: id, reason, message };
  };

  if (frames.length < 2 || frames.length > 3) throw new CaptureError("frames", "Send 2–3 frames from the live camera");
  let imgs;
  try { imgs = frames.map((f) => decodeJpeg(f)); } catch (e) { throw new CaptureError("bad_image", (e as Error).message); }

  // Liveness heuristic: a live camera burst differs slightly frame to frame; a
  // re-uploaded still is identical. This is NOT proof of physical presence.
  const diffs = imgs.slice(1).map((im) => frameDifference(imgs[0]!, im));
  if (diffs.every((d) => d < 0.15)) return reject("static_frames", "That looks like a still image. Point your camera at a real animal.", { diffs });
  if (diffs.some((d) => d > 40)) return reject("inconsistent_frames", "The frames don't match — hold the camera steady on the animal.", { diffs });

  const results = [];
  for (const im of imgs) results.push(await detector.detect(im.data, im.width, im.height));
  const hits = results.filter((r) => r.best && r.best.score >= ECONOMY.catch.minDetectionScore);
  if (hits.length < 2) {
    const seen = results.flatMap((r) => r.all.filter((a) => a.score > 0.5).map((a) => a.cls));
    return reject("no_animal", seen.length ? `No supported animal found (saw: ${[...new Set(seen)].join(", ")}). Cats and dogs are supported right now.` : "No supported animal found. Get closer, with good light.", { results });
  }
  const species = hits[0]!.best!.species;
  if (hits.some((h) => h.best!.species !== species)) return reject("ambiguous", "Couldn't tell which animal this is. Try again with just one animal in view.", { results });
  const bestIdx = results.findIndex((r) => r === hits.sort((a, b) => b.best!.score - a.best!.score)[0]);
  const frame = imgs[bestIdx]!;
  const det = results[bestIdx]!.best!;
  const hash = dHash(frame, det.bbox.map(Math.round) as [number, number, number, number]);

  const recent = await db.query<{ image_hash: string }>(`SELECT image_hash FROM catch_attempts WHERE image_hash IS NOT NULL AND status <> 'rejected' AND created_at > now() - interval '30 days'`);
  if (recent.rows.some((r) => hamming(r.image_hash, hash) <= ECONOMY.catch.duplicateHammingThreshold)) {
    return reject("duplicate", "This exact photo was already used for a capture.", { hash });
  }

  // Keep only the animal crop as a sticker, temporarily, until the attempt resolves.
  // Body cutout (DeepLab) with white die-cut outline; rounded photo sticker if segmentation fails.
  const cut = detector.cutout ? await detector.cutout(frame, species, det.bbox).catch(() => null) : null;
  const sticker = cut ?? renderSticker(frame, det.bbox);
  await mkdir(join(env.mediaDir, "pending"), { recursive: true });
  await writeFile(join(env.mediaDir, "pending", `${id}.png`), sticker);
  await db.query(
    `INSERT INTO catch_attempts (id, user_id, status, species, detection, image_hash) VALUES ($1,$2,'valid',$3,$4,$5)`,
    [id, userId, species, JSON.stringify({ cutout: !!cut, score: det.score, bbox: det.bbox, people: Math.max(...results.map((r) => r.people)), diffs }), hash],
  );
  return { ok: true as const, attemptId: id, species, score: det.score, sticker: `data:image/png;base64,${sticker.toString("base64")}`, expiresAt: Date.now() + VALID_FOR_MS, quotes: quotes() };
}

export async function resolveAttempt(db: Db, game: Game, userId: string, attemptId: string, tier: CatchTier, clientNonce: string) {
  if (game.flags.pauseCatches) throw new CaptureError("paused", "Catching is paused by operations", 503);
  if (!CATCH_TIERS.includes(tier)) throw new CaptureError("tier", "Unknown tier");
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(clientNonce)) throw new CaptureError("nonce", "Bad client nonce");
  const now = Date.now();
  const epoch = await currentEpoch(db, now);
  const cost = ECONOMY.catch.tiers[tier].cost;

  const result = await db.tx(async (tx) => {
    const a = await tx.query<{ status: string; species: Species; created_at: string }>(
      `SELECT status, species, created_at::text FROM catch_attempts WHERE id = $1 AND user_id = $2 FOR UPDATE`, [attemptId, userId],
    );
    const row = a.rows[0];
    if (!row) throw new CaptureError("not_found", "Unknown capture", 404);
    if (row.status !== "valid") throw new CaptureError("resolved", "This capture was already resolved");
    if (now - new Date(row.created_at).getTime() > VALID_FOR_MS) {
      await tx.query(`UPDATE catch_attempts SET status = 'expired', resolved_at = now() WHERE id = $1`, [attemptId]);
      throw new CaptureError("expired", "The animal wandered off (capture expired). Nothing was charged.");
    }
    const label = `${attemptId}:${clientNonce}`;
    const roll = rollCatch(epoch.seed, label, tier);
    let petId: string | null = null;
    try {
      if (roll.success) {
        petId = newId("pet");
        const split = splitBps(cost, ECONOMY.catch.successSplit, "hq");
        await ensureAccount(tx, acct.pet(petId), "pet", { petId, userId });
        const genome = generateGenome(epoch.seed, label, row.species, roll.rarity!);
        const hq = game.hq();
        const state = freshPetState(hq.x + (Math.random() - 0.5) * 60, hq.y + 20 + Math.random() * 30, genome.stats);
        await tx.query(
          `INSERT INTO pets (id, owner_id, species, rarity, name, genome, sticker, mint_status, catch_attempt_id, state) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [petId, userId, genome.species, genome.rarity, genome.name, JSON.stringify(genome), `/media/stickers/${petId}.png`, chainConfigured() ? "pending" : "awaiting_chain", attemptId, JSON.stringify(state)],
        );
        await post(tx, {
          idem: `catch:${attemptId}`, kind: "catch_success",
          postings: [
            { account: acct.user(userId), amount: -cost },
            { account: acct.pet(petId), amount: split.pet },
            { account: acct.hq, amount: split.hq },
            { account: acct.team, amount: split.team },
          ],
          meta: { attemptId, tier, petId, epoch: epoch.id, label },
        });
        await tx.query(`INSERT INTO outbox (idem, kind, payload, status) VALUES ($1,'mint_animal',$2,$3)`, [
          `mint:${petId}`, JSON.stringify({ petId, owner: userId, species: genome.species, rarity: genome.rarity }), chainConfigured() ? "pending" : "awaiting_chain",
        ]);
      } else {
        await post(tx, { idem: `catch:${attemptId}`, kind: "catch_failed", postings: [{ account: acct.user(userId), amount: -cost }, { account: acct.hq, amount: cost }], meta: { attemptId, tier, epoch: epoch.id, label } });
      }
    } catch (e) {
      if (e instanceof LedgerError && e.code === "insufficient_funds") throw new CaptureError("insufficient_funds", "Not enough tokens in your wallet for this tier. Nothing was charged.");
      throw e;
    }
    await tx.query(
      `UPDATE catch_attempts SET status = $2, tier = $3, cost = $4, client_nonce = $5, epoch_id = $6, success = $7, rarity = $8, draws = $9, pet_id = $10, resolved_at = now() WHERE id = $1`,
      [attemptId, roll.success ? "caught" : "failed", tier, cost.toString(), clientNonce, epoch.id, roll.success, roll.rarity, JSON.stringify(roll), petId],
    );
    return { roll, petId, epoch: epoch.id, commitment: epoch.commitment };
  });

  const pending = join(env.mediaDir, "pending", `${attemptId}.png`);
  if (result.petId) {
    await mkdir(join(env.mediaDir, "stickers"), { recursive: true });
    await writeFile(join(env.mediaDir, "stickers", `${result.petId}.png`), await readFile(pending).catch(() => Buffer.alloc(0)));
    await game.reloadPet(result.petId);
  }
  await rm(pending, { force: true });
  return {
    success: result.roll.success,
    rarity: result.roll.rarity,
    petId: result.petId,
    cost: toWire(cost),
    fairness: { epoch: result.epoch, commitment: result.commitment, label: `${attemptId}:${clientNonce}`, successDraw: result.roll.successDraw, rarityDraw: result.roll.rarityDraw },
  };
}

/** Drop pending crops older than the validity window (privacy retention). */
export async function sweepPendingCaptures(db: Db) {
  const r = await db.query<{ id: string }>(`UPDATE catch_attempts SET status = 'expired', resolved_at = now() WHERE status = 'valid' AND created_at < now() - interval '15 minutes' RETURNING id`);
  for (const { id } of r.rows) await rm(join(env.mediaDir, "pending", `${id}.png`), { force: true });
}

