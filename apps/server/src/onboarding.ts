/**
 * New-player journey support:
 *  - onboarding progress (server-side, so phone and laptop agree)
 *  - one-time starter grant (test units on dev/testnet; never on mainnet)
 *  - phone handoff codes (laptop shows a QR, the phone signs into the same account)
 *  - NEAR account linking with a NEP-413 signed message
 *  - naming a pet
 */
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { networkInterfaces } from "node:os";
import { ECONOMY, tokens, toWire } from "@catchami/shared";
import type { Db } from "./db/index.ts";
import { env } from "./env.ts";
import { createGuest, issueToken } from "./auth.ts";
import { acct, post, transfer } from "./ledger/ledger.ts";
import { ServiceError } from "./services.ts";
import type { Game } from "./world/game.ts";

export const ONBOARDING_STAGES = ["intro", "wallet", "catch", "name", "world", "tutorial", "done"] as const;
export type OnboardingStage = (typeof ONBOARDING_STAGES)[number];
export interface Onboarding { stage: OnboardingStage; tutorial?: number; updatedAt?: number }

export async function getOnboarding(db: Db, userId: string): Promise<Onboarding> {
  const r = await db.query<{ onboarding: Onboarding | null }>(`SELECT onboarding FROM users WHERE id = $1`, [userId]);
  const o = r.rows[0]?.onboarding;
  if (o && ONBOARDING_STAGES.includes(o.stage)) return o;
  // Players from before the guided journey: if they already have a pet, they're past it.
  const pets = await db.query<{ n: string }>(`SELECT COUNT(*)::text n FROM pets WHERE owner_id = $1`, [userId]);
  return { stage: Number(pets.rows[0]!.n) > 0 ? "done" : "intro" };
}

export async function setOnboarding(db: Db, userId: string, stage: unknown, tutorial: unknown): Promise<Onboarding> {
  if (!ONBOARDING_STAGES.includes(stage as OnboardingStage)) throw new ServiceError("stage", "Unknown onboarding stage");
  const next: Onboarding = { stage: stage as OnboardingStage, updatedAt: Date.now() };
  if (typeof tutorial === "number" && Number.isInteger(tutorial) && tutorial >= 0 && tutorial < 50) next.tutorial = tutorial;
  await db.query(`UPDATE users SET onboarding = $2 WHERE id = $1`, [userId, JSON.stringify(next)]);
  return next;
}

/** One starter grant per account. Test units only: no value, not onchain. */
/**
 * The first-time "buy $CATCHAMI" step. On test networks it's a simulated purchase:
 * the chosen pack is credited as test units (no payment is taken). One per account.
 */
export async function starterGrant(db: Db, userId: string, packId?: unknown) {
  if (env.network === "mainnet") throw new ServiceError("not_available", "Starter packs are simulated on test networks only", 404);
  const pack = ECONOMY.catch.starterPacks.find((p) => p.id === packId) ?? ECONOMY.catch.starterPacks[0]!;
  const amount = tokens(pack.whole);
  const r = await db.tx((tx) => post(tx, {
    idem: `starter:${userId}`, kind: "starter_purchase", postings: transfer(acct.chain, acct.user(userId), amount),
    meta: { pack: pack.id, priceNear: pack.near, note: `${env.network.toUpperCase()} simulated purchase — test units, not onchain` }, settlementRef: "starter:simulated",
  }));
  return { amount: toWire(amount), pack: pack.id, already: r.duplicate };
}

// ------------------------------------------------------------ phone handoff
const handoffs = new Map<string, { userId: string; exp: number }>();
const HANDOFF_MS = 10 * 60_000;

export function createHandoff(userId: string) {
  const now = Date.now();
  for (const [k, v] of handoffs) if (v.exp < now) handoffs.delete(k);
  const code = randomBytes(18).toString("base64url");
  handoffs.set(code, { userId, exp: now + HANDOFF_MS });
  return { code, expiresAt: now + HANDOFF_MS, lan: lanAddresses() };
}

/** Single use: the code is a short-lived key to the account. */
export function redeemHandoff(code: unknown) {
  const h = typeof code === "string" ? handoffs.get(code) : undefined;
  if (!h || h.exp < Date.now()) throw new ServiceError("handoff", "This QR code has expired. Make a new one on your computer.", 401);
  handoffs.delete(code as string);
  return { token: issueToken(h.userId), userId: h.userId };
}

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) for (const a of list ?? []) {
    if (a.family === "IPv4" && !a.internal && !a.address.startsWith("169.254.")) out.push(a.address);
  }
  // Typical home/office ranges first.
  return out.sort((a, b) => Number(!a.startsWith("192.168.")) - Number(!b.startsWith("192.168.")));
}

// ------------------------------------------------------------ NEAR linking (NEP-413)
const challenges = new Map<string, { userId: string | null; exp: number }>();
export const LINK_MESSAGE = "Link this NEAR account to Catchami";
export const LINK_RECIPIENT = "catchami.game";

export function linkChallenge(userId: string | null) {
  const nonce = randomBytes(32);
  const key = nonce.toString("base64");
  challenges.set(key, { userId, exp: Date.now() + 10 * 60_000 });
  return { message: LINK_MESSAGE, recipient: LINK_RECIPIENT, nonce: key, network: env.network === "mainnet" ? "mainnet" : "testnet" };
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(s: string): Buffer {
  let n = 0n;
  for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error("bad base58"); n = n * 58n + BigInt(i); }
  const bytes: number[] = [];
  while (n > 0n) { bytes.unshift(Number(n & 255n)); n >>= 8n; }
  for (const c of s) { if (c !== "1") break; bytes.unshift(0); }
  return Buffer.from(bytes);
}

function borshString(s: string) { const b = Buffer.from(s, "utf8"); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return Buffer.concat([l, b]); }

/** sha256(borsh(tag=2^31+413) ++ borsh({ message, nonce[32], recipient, callbackUrl? })) — the NEP-413 digest. */
export function nep413Digest(message: string, nonce: Buffer, recipient: string, callbackUrl?: string | null) {
  const tag = Buffer.alloc(4); tag.writeUInt32LE(2 ** 31 + 413);
  const cb = callbackUrl ? Buffer.concat([Buffer.from([1]), borshString(callbackUrl)]) : Buffer.from([0]);
  return createHash("sha256").update(Buffer.concat([tag, borshString(message), nonce, borshString(recipient), cb])).digest();
}

const ACCOUNT_RE = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/** Verify a NEP-413 signature for a challenge issued to `userId` (null = signing in). Returns the account id. */
async function verifyNear(userId: string | null, body: Record<string, unknown>): Promise<string> {
  const { accountId, publicKey, signature, nonce, callbackUrl } = body as Record<string, string | undefined>;
  if (!accountId || !ACCOUNT_RE.test(accountId)) throw new ServiceError("account", "That isn't a NEAR account id");
  if (env.network !== "mainnet" && !accountId.endsWith(".testnet") && !/^[0-9a-f]{64}$/.test(accountId)) throw new ServiceError("network", "Connect a NEAR testnet account (name.testnet)");
  const ch = nonce ? challenges.get(nonce) : undefined;
  if (!ch || ch.userId !== userId || ch.exp < Date.now()) throw new ServiceError("challenge", "Sign-in request expired — connect again", 401);
  if (!publicKey?.startsWith("ed25519:") || !signature) throw new ServiceError("signature", "The wallet didn't return a signature");
  const raw = base58(publicKey.slice(8));
  if (raw.length !== 32) throw new ServiceError("signature", "Unsupported key type");
  const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") }, format: "jwk" });
  const sig = Buffer.from(signature, "base64");
  const okWith = (cb?: string | null) => verify(null, nep413Digest(LINK_MESSAGE, Buffer.from(nonce!, "base64"), LINK_RECIPIENT, cb), key, sig);
  if (!okWith(callbackUrl ?? null) && !okWith(null)) throw new ServiceError("signature", "Signature check failed", 401);
  // The key must be a full-access key of that account, checked against the chain.
  const rpc = env.near.rpcUrl ?? (env.network === "mainnet" ? "https://free.rpc.fastnear.com" : "https://test.rpc.fastnear.com");
  const r = await fetch(rpc, {
    method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ jsonrpc: "2.0", id: "catchami", method: "query", params: { request_type: "view_access_key", finality: "final", account_id: accountId, public_key: publicKey } }),
  }).then((x) => x.json() as Promise<{ result?: { permission: unknown }; error?: unknown }>).catch(() => null);
  if (!r) throw new ServiceError("rpc", "Couldn't reach the NEAR network — try again", 503);
  if (r.result?.permission !== "FullAccess") throw new ServiceError("key", "That key doesn't belong to this account", 401);
  challenges.delete(nonce!);
  return accountId;
}

export async function linkNear(db: Db, userId: string, body: Record<string, unknown>) {
  const accountId = await verifyNear(userId, body);
  try {
    await db.query(`UPDATE users SET near_account = $2 WHERE id = $1`, [userId, accountId]);
  } catch {
    throw new ServiceError("taken", "This NEAR account is already linked to another Catchami player");
  }
  return { accountId };
}

/** Sign in with a NEAR wallet: the linked player, or a new player linked to it. */
export async function signInNear(db: Db, body: Record<string, unknown>) {
  const accountId = await verifyNear(null, body);
  const r = await db.query<{ id: string; display_name: string }>(`SELECT id, display_name FROM users WHERE near_account = $1`, [accountId]);
  if (r.rows[0]) return { token: issueToken(r.rows[0].id), userId: r.rows[0].id, displayName: r.rows[0].display_name, accountId, created: false };
  const g = await createGuest(db);
  await db.query(`UPDATE users SET near_account = $2 WHERE id = $1`, [g.userId, accountId]);
  return { ...g, accountId, created: true };
}

// ------------------------------------------------------------ naming
export async function renamePet(db: Db, game: Game, userId: string, petId: string, name: unknown) {
  const n = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  if (!/^[\p{L}\p{N} '’-]{1,16}$/u.test(n)) throw new ServiceError("name", "Names are 1–16 letters, numbers or spaces");
  const r = await db.query(`UPDATE pets SET name = $3 WHERE id = $1 AND owner_id = $2 RETURNING id`, [petId, userId, n]);
  if (!r.rows.length) throw new ServiceError("not_found", "That pet isn't yours", 404);
  const p = game.pets.get(petId);
  if (p) { p.name = n; p.metaDirty = true; }
  return { name: n };
}
