/**
 * NEAR Auth (https://docs.auth.near.org): Google / Apple / email / passkey
 * logins that control a real NEAR account through NEAR's MPC signer network.
 *
 *  - Sign-in: verify the Auth0 ID token (RS256, issuer's published keys),
 *    then derive the player's key from the MPC contract for their login
 *    path. Their account is the implicit account of that key (hex of the
 *    32-byte ed25519 key) — the same login always gives the same account.
 *  - New accounts get a little testnet NEAR from the operator so they exist
 *    and can pay gas for their own transactions (withdraw, swap).
 *  - Relay: the MPC `sign` call must be sent by a funded account; the game
 *    server sends it for logged-in players (rate-limited, own login only).
 */
import { createPublicKey, verify as verifySig, randomBytes } from "node:crypto";
import { transactions } from "near-api-js";
import type { Db } from "../db/index.ts";
import { env } from "../env.ts";
import { createGuest, issueToken } from "../auth.ts";
import { ServiceError } from "../services.ts";
import { call, NEAR, operator, rpcProvider, view } from "./signer.ts";

const CFG = env.network === "mainnet"
  ? { domain: "login.auth.near.org", fastAuth: "fast-auth.near", mpc: "v1.signer", clientId: process.env.NEAR_AUTH_CLIENT_ID ?? "" }
  : { domain: "login.testnet.fast-auth.com", fastAuth: "fast-auth.testnet", mpc: "v1.signer-prod.testnet", clientId: process.env.NEAR_AUTH_CLIENT_ID ?? "np8paqIpMWmNbzT4xAvOOapZBjsOpptl" };
const ISSUER = `https://${CFG.domain}/`;

const b64url = (s: string) => Buffer.from(s, "base64url");
let jwks: { at: number; keys: Array<{ kid: string; kty: string; n: string; e: string }> } | null = null;
async function keyFor(kid: string) {
  if (!jwks || Date.now() - jwks.at > 3600_000 || !jwks.keys.some((k) => k.kid === kid)) {
    const r = await fetch(`${ISSUER}.well-known/jwks.json`, { signal: AbortSignal.timeout(8000) });
    jwks = { at: Date.now(), keys: ((await r.json()) as { keys: NonNullable<typeof jwks>["keys"] }).keys };
  }
  const k = jwks.keys.find((x) => x.kid === kid);
  if (!k) throw new ServiceError("auth", "Unknown sign-in key", 401);
  return createPublicKey({ key: { kty: k.kty, n: k.n, e: k.e }, format: "jwk" });
}

/** Verify an Auth0 ID token issued by NEAR Auth; returns its subject (e.g. "google-oauth2|123"). */
export async function verifyIdToken(token: unknown): Promise<{ sub: string }> {
  if (typeof token !== "string" || token.split(".").length !== 3) throw new ServiceError("auth", "Missing sign-in token", 401);
  const [h, p, s] = token.split(".") as [string, string, string];
  const header = JSON.parse(b64url(h).toString()) as { alg: string; kid: string };
  if (header.alg !== "RS256") throw new ServiceError("auth", "Unsupported sign-in token", 401);
  const ok = verifySig("RSA-SHA256", Buffer.from(`${h}.${p}`), await keyFor(header.kid), b64url(s));
  if (!ok) throw new ServiceError("auth", "Sign-in token signature is invalid", 401);
  const c = JSON.parse(b64url(p).toString()) as { iss: string; aud: string | string[]; exp: number; sub: string };
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (c.iss !== ISSUER || !aud.includes(CFG.clientId) || c.exp * 1000 < Date.now() - 60_000 || !c.sub) throw new ServiceError("auth", "Sign-in token isn't valid for Catchami", 401);
  return { sub: c.sub };
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58decode(s: string): Buffer {
  let n = 0n;
  for (const ch of s) { const i = B58.indexOf(ch); if (i < 0) throw new Error("bad base58"); n = n * 58n + BigInt(i); }
  const out: number[] = [];
  while (n > 0n) { out.unshift(Number(n & 255n)); n >>= 8n; }
  for (const ch of s) { if (ch !== "1") break; out.unshift(0); }
  return Buffer.from(out);
}

/** The NEAR account a NEAR Auth login controls. */
export async function accountForSub(sub: string): Promise<{ accountId: string; publicKey: string }> {
  const path = `jwt#https://${CFG.domain}/#${sub}`;
  const publicKey = await view<string>(CFG.mpc, "derived_public_key", { path, predecessor: CFG.fastAuth, domain_id: 1 });
  if (!publicKey.startsWith("ed25519:")) throw new Error(`unexpected derived key ${publicKey}`);
  return { accountId: b58decode(publicKey.slice(8)).toString("hex"), publicKey };
}

/** Testnet: make sure the player's account exists and can pay a few transactions' gas. */
async function fundIfNeeded(accountId: string) {
  if (env.network === "mainnet") return;
  const op = operator();
  if (!op) return;
  let balance = 0n;
  try { balance = BigInt(((await rpcProvider().query({ request_type: "view_account", finality: "final", account_id: accountId })) as unknown as { amount: string }).amount); } catch { balance = 0n; }
  if (balance >= NEAR(0.03)) return;
  await op.signAndSendTransaction({ receiverId: accountId, actions: [transactions.transfer(NEAR(0.05))], waitUntil: "EXECUTED_OPTIMISTIC" } as never);
}

async function remember(db: Db, userId: string, sub: string, accountId: string) {
  await db.query(`INSERT INTO kv (k, v) VALUES ($1, $2) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`, [`nearauth:${userId}`, JSON.stringify({ sub, accountId, at: Date.now() })]);
}

export async function signInNearAuth(db: Db, body: Record<string, unknown>) {
  const { sub } = await verifyIdToken(body.idToken);
  const { accountId, publicKey } = await accountForSub(sub);
  await fundIfNeeded(accountId).catch((e) => console.error("[near-auth] funding failed:", (e as Error).message));
  const r = await db.query<{ id: string; display_name: string }>(`SELECT id, display_name FROM users WHERE near_account = $1`, [accountId]);
  if (r.rows[0]) {
    await remember(db, r.rows[0].id, sub, accountId);
    return { token: issueToken(r.rows[0].id), userId: r.rows[0].id, displayName: r.rows[0].display_name, accountId, publicKey, created: false };
  }
  const g = await createGuest(db);
  await db.query(`UPDATE users SET near_account = $2 WHERE id = $1`, [g.userId, accountId]);
  await remember(db, g.userId, sub, accountId);
  return { ...g, accountId, publicKey, created: true };
}

export async function linkNearAuth(db: Db, userId: string, body: Record<string, unknown>) {
  const { sub } = await verifyIdToken(body.idToken);
  const { accountId, publicKey } = await accountForSub(sub);
  try { await db.query(`UPDATE users SET near_account = $2 WHERE id = $1`, [userId, accountId]); }
  catch { throw new ServiceError("taken", "This Google account already has a Catchami player — sign in with it instead"); }
  await remember(db, userId, sub, accountId);
  await fundIfNeeded(accountId).catch((e) => console.error("[near-auth] funding failed:", (e as Error).message));
  return { accountId, publicKey };
}

/** Relay a NEAR Auth `sign` request for the player's own login. Returns the MPC signature payload. */
export async function relaySign(db: Db, userId: string, body: Record<string, unknown>) {
  const { guardId, verifyPayload, signPayload } = body as { guardId?: string; verifyPayload?: string; signPayload?: number[] };
  if (guardId !== `jwt#https://${CFG.domain}/` || typeof verifyPayload !== "string" || !Array.isArray(signPayload) || signPayload.length > 4096) throw new ServiceError("bad_request", "Invalid signature request");
  // Only the player's own login may use the relay (the contract checks the token itself).
  const mine = (await db.query<{ v: { sub: string } }>(`SELECT v FROM kv WHERE k = $1`, [`nearauth:${userId}`])).rows[0]?.v;
  let sub = "";
  try { sub = (JSON.parse(b64url(verifyPayload.split(".")[1] ?? "").toString()) as { sub: string }).sub; } catch { sub = ""; }
  if (!mine || mine.sub !== sub) throw new ServiceError("forbidden", "Sign in with Google again to approve this", 403);
  const op = operator();
  if (!op) throw new ServiceError("chain_off", "Signing isn't connected on this server", 503);
  const r = await call(op, CFG.fastAuth, "sign", { guard_id: guardId, verify_payload: verifyPayload, sign_payload: signPayload, algorithm: "eddsa" }, { gasTgas: 300, depositYocto: 0n });
  if (!r.value) throw new ServiceError("sign_failed", "NEAR Auth didn't return a signature — try again", 502);
  return { payload: r.value, txHash: r.txHash, nonce: randomBytes(4).toString("hex") };
}
