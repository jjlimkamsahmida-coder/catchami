import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type Network = "dev" | "testnet" | "mainnet";

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`missing env ${name}`);
  return v;
}

const network = (process.env.CATCHAMI_NETWORK ?? "dev") as Network;
if (!["dev", "testnet", "mainnet"].includes(network)) throw new Error(`bad CATCHAMI_NETWORK ${network}`);

/** Dev only: keep a local secret in DATA_DIR so restarts don't sign everyone out. Never used outside dev. */
function devSecret(): string {
  const dir = resolve(process.env.DATA_DIR ?? "./data");
  const f = join(dir, ".dev-session-secret");
  if (existsSync(f)) return readFileSync(f, "utf8").trim();
  mkdirSync(dir, { recursive: true });
  const s = randomBytes(32).toString("hex");
  writeFileSync(f, s, { mode: 0o600 });
  return s;
}
const sessionSecret = process.env.SESSION_SECRET ?? (network === "dev" ? devSecret() : undefined);
if (!sessionSecret || sessionSecret.length < 32) throw new Error("SESSION_SECRET (>=32 chars) is required outside dev");

export const env = {
  network,
  port: Number(req("PORT", "8797")),
  databaseUrl: process.env.DATABASE_URL,
  dataDir: resolve(req("DATA_DIR", "./data")),
  mediaDir: resolve(req("MEDIA_DIR", "./data/media")),
  modelDir: resolve(req("MODEL_DIR", new URL("../models", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))),
  sessionSecret,
  adminToken: process.env.ADMIN_TOKEN ?? null,
  /** Public origins allowed to open WebSockets / call the API. */
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173").split(",").map((s) => s.trim()),
  near: {
    rpcUrl: process.env.NEAR_RPC_URL ?? null,
    tokenContract: process.env.NEAR_TOKEN_CONTRACT ?? null,
    gameContract: process.env.NEAR_GAME_CONTRACT ?? null,
    /** Operator signer is NEVER loaded from the repo; path to a key file managed by the secret store. */
    operatorAccount: process.env.NEAR_OPERATOR_ACCOUNT ?? null,
    operatorKeyFile: process.env.NEAR_OPERATOR_KEY_FILE ?? null,
  },
  /**
   * Legal release control for real-token PvP. Must be set explicitly AND
   * ECONOMY.battle.realTokenPvp.enabled must be true. Never on in dev.
   */
  realPvpApproved: process.env.REAL_PVP_APPROVED === "yes-legal-signoff-on-file" && network !== "dev",
  /** Dev network: tokens are test units with no value and no onchain backing. */
  isDev: network === "dev",
};

export const chainConfigured = () => Boolean(env.near.rpcUrl && env.near.gameContract && env.near.tokenContract);
