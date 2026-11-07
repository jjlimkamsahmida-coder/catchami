/**
 * Session tokens: HMAC-SHA256 signed, expiring. Accounts start as device
 * accounts (no password, no PII). Linking a NEAR account (NEP-413 signed
 * message) or an embedded-wallet social login is required before any real
 * deposit or withdrawal — see docs/STATUS.md.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env.ts";
import type { Db } from "./db/index.ts";
import { acct, ensureAccount } from "./ledger/ledger.ts";

const TTL_MS = 30 * 24 * 3600 * 1000;

function sign(payload: string): string {
  return createHmac("sha256", env.sessionSecret).update(payload).digest("base64url");
}

export function issueToken(userId: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ u: userId, e: now + TTL_MS })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string | undefined | null, now = Date.now()): string | null {
  if (!token || typeof token !== "string") return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expect = Buffer.from(sign(payload));
  const got = Buffer.from(sig);
  if (expect.length !== got.length || !timingSafeEqual(expect, got)) return null;
  try {
    const { u, e } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { u: string; e: number };
    if (typeof u !== "string" || typeof e !== "number" || e < now) return null;
    return u;
  } catch {
    return null;
  }
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}

const ADJ = ["Sunny", "Mossy", "Pebble", "Breezy", "Clover", "Misty", "Maple", "Rusty", "Velvet", "Puddle"];
const NOUN = ["Fox", "Wren", "Otter", "Finch", "Badger", "Heron", "Vole", "Robin", "Newt", "Hare"];

export async function createGuest(db: Db): Promise<{ userId: string; displayName: string; token: string }> {
  const userId = newId("u");
  const n = randomBytes(3);
  const displayName = `${ADJ[n[0]! % ADJ.length]}${NOUN[n[1]! % NOUN.length]}${(n[2]! % 90) + 10}`;
  await db.tx(async (tx) => {
    await tx.query(`INSERT INTO users (id, display_name) VALUES ($1,$2)`, [userId, displayName]);
    await ensureAccount(tx, acct.user(userId), "user", { userId });
  });
  return { userId, displayName, token: issueToken(userId) };
}

export async function getUser(db: Db, id: string) {
  const r = await db.query<{ id: string; display_name: string; near_account: string | null; disabled: boolean }>(
    `SELECT id, display_name, near_account, disabled FROM users WHERE id = $1`, [id],
  );
  return r.rows[0] ?? null;
}
