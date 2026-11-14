import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, extname } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import {
  CATCH_TIERS, dailyBudget, ECONOMY, EQUIPMENT, EQUIPMENT_KINDS, HQ_RESERVE_FLOOR, parseTokens, toWire,
  type ClientMsg, type EquipmentKind, type ServerMsg, type CatchTier,
} from "@catchami/shared";
import type { Db } from "./db/index.ts";
import { env } from "./env.ts";
import { createGuest, getUser, verifyToken } from "./auth.ts";
import { publicEpochs } from "./fairness.ts";
import { acct, balanceOf } from "./ledger/ledger.ts";
import { avgDailyRevenue, treasuryDay } from "./ledger/treasury.ts";
import { CaptureError, quotes, resolveAttempt, validateCapture } from "./capture/capture.ts";
import type { Detector } from "./capture/detector.ts";
import { GameError, type Game, type GameClient } from "./world/game.ts";
import * as svc from "./services.ts";
import * as onb from "./onboarding.ts";
import * as pay from "./payments.ts";
import * as nearAuth from "./chain/nearauth.ts";
import { chainMe, getChainWorker } from "./chain/worker.ts";

type Handler = (ctx: Ctx) => Promise<unknown>;
interface Ctx { req: IncomingMessage; body: Record<string, unknown>; params: Record<string, string>; query: URLSearchParams; userId: string | null }

class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}

// Token-bucket rate limiting per key.
const buckets = new Map<string, { t: number; tokens: number }>();
function allow(key: string, ratePerSec: number, burst: number): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { t: now, tokens: burst };
  b.tokens = Math.min(burst, b.tokens + ((now - b.t) / 1000) * ratePerSec);
  b.t = now;
  if (b.tokens < 1) { buckets.set(key, b); return false; }
  b.tokens -= 1;
  buckets.set(key, b);
  return true;
}
setInterval(() => { const cut = Date.now() - 600_000; for (const [k, v] of buckets) if (v.t < cut) buckets.delete(k); }, 60_000).unref();

const ip = (req: IncomingMessage) => (env.isDev ? req.socket.remoteAddress : (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.socket.remoteAddress) ?? "?";
const amountOf = (v: unknown, field = "amount") => {
  if (typeof v !== "string") throw new HttpError(400, "amount", `${field} must be a decimal string of whole tokens`);
  try { return parseTokens(v); } catch { throw new HttpError(400, "amount", `invalid ${field}`); }
};
const rid = (v: unknown) => {
  if (typeof v !== "string" || !/^[A-Za-z0-9_-]{6,64}$/.test(v)) throw new HttpError(400, "rid", "request id (rid) required for idempotency");
  return v;
};

export function startHttp(db: Db, game: Game, detector: () => Detector | null, staticDir: string | null) {
  const routes: Array<{ method: string; re: RegExp; keys: string[]; auth: boolean; admin?: boolean; h: Handler }> = [];
  const route = (method: string, path: string, h: Handler, opts: { auth?: boolean; admin?: boolean } = {}) => {
    const keys: string[] = [];
    const re = new RegExp("^" + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "$");
    routes.push({ method, re, keys, auth: opts.auth ?? false, admin: opts.admin, h });
  };
  const uid = (c: Ctx) => c.userId!;

  route("GET", "/api/health", async () => ({ ok: true, network: env.network, detector: Boolean(detector()?.ready), pets: game.pets.size }));
  route("POST", "/api/auth/guest", async (c) => {
    if (!allow(`guest:${ip(c.req)}`, 1 / 60, 5)) throw new HttpError(429, "rate_limited", "Too many new accounts from this network");
    return createGuest(db);
  });
  // Google sign-in on sites NEAR Auth hasn't approved yet: SIMULATED on test networks (no Google OAuth).
  // It creates a game account whose pet NFTs are held in custody until a wallet is linked.
  route("POST", "/api/auth/google-demo", async (c) => {
    if (!allow(`guest:${ip(c.req)}`, 1 / 60, 5)) throw new HttpError(429, "rate_limited", "Too many new accounts from this network");
    if (env.network === "mainnet") throw new HttpError(404, "not_available", "Google sign-in isn't configured");
    const g = await createGuest(db);
    await db.query(`INSERT INTO kv (k, v) VALUES ($1, $2) ON CONFLICT (k) DO NOTHING`, [`auth:google_demo:${g.userId}`, JSON.stringify({ at: Date.now(), simulated: true })]);
    return { ...g, provider: "google_demo" };
  });
  // NEAR Auth: Google / Apple / email / passkey logins that control a real NEAR account (MPC-held key).
  route("POST", "/api/auth/near-auth", async (c) => {
    if (!allow(`nearauth:${ip(c.req)}`, 1 / 10, 10)) throw new HttpError(429, "rate_limited", "Too many tries");
    return nearAuth.signInNearAuth(db, c.body);
  });
  route("POST", "/api/near-auth/link", async (c) => nearAuth.linkNearAuth(db, uid(c), c.body), { auth: true });
  route("POST", "/api/near-auth/sign", async (c) => {
    if (!allow(`nasign:${uid(c)}`, 1 / 6, 6)) throw new HttpError(429, "rate_limited", "One approval at a time");
    return nearAuth.relaySign(db, uid(c), c.body);
  }, { auth: true });
  route("GET", "/api/me", async (c) => {
    const u = await getUser(db, uid(c));
    if (!u) throw new HttpError(401, "auth", "Unknown account");
    return { user: { id: u.id, displayName: u.display_name, nearAccount: u.near_account }, wallet: await svc.wallet(db, u.id), onboarding: await onb.getOnboarding(db, u.id) };
  }, { auth: true });
  // New-player journey.
  route("POST", "/api/onboarding", async (c) => onb.setOnboarding(db, uid(c), c.body.stage, c.body.tutorial), { auth: true });
  route("POST", "/api/onboarding/starter", async (c) => onb.starterGrant(db, uid(c), c.body.pack), { auth: true });
  route("POST", "/api/handoff", async (c) => onb.createHandoff(uid(c)), { auth: true });
  route("POST", "/api/handoff/redeem", async (c) => {
    if (!allow(`handoff:${ip(c.req)}`, 1 / 10, 10)) throw new HttpError(429, "rate_limited", "Too many tries");
    return onb.redeemHandoff(c.body.code);
  });
  route("POST", "/api/near/challenge", async (c) => onb.linkChallenge(c.userId));
  route("POST", "/api/near/link", async (c) => onb.linkNear(db, uid(c), c.body), { auth: true });
  route("POST", "/api/auth/near", async (c) => {
    if (!allow(`nearauth:${ip(c.req)}`, 1 / 10, 10)) throw new HttpError(429, "rate_limited", "Too many tries");
    return onb.signInNear(db, c.body);
  });
  route("POST", "/api/pets/:id/name", async (c) => onb.renamePet(db, game, uid(c), c.params.id!, c.body.name), { auth: true });
  // Chain: status, the player's onchain view, "Sync now".
  route("GET", "/api/chain", async () => ({ ...(await pay.market()), status: getChainWorker()?.status ?? null }));
  route("GET", "/api/chain/me", async (c) => chainMe(db, game, uid(c)), { auth: true });
  route("POST", "/api/chain/sync", async (c) => {
    if (!allow(`sync:${uid(c)}`, 1 / 15, 3)) throw new HttpError(429, "rate_limited", "Syncing — give it a few seconds");
    const w = getChainWorker();
    if (!w?.enabled) throw new HttpError(503, "chain_off", "The chain isn't connected on this server");
    const batch = await w.syncNow();
    return { batch, status: w.status };
  }, { auth: true });
  // Buying $CATCHAMI (simulated payment, real delivery) and the sell quote for in-wallet swaps.
  route("GET", "/api/pay/assets", async () => ({ assets: (await pay.intentsAssets()).slice(0, 80) }));
  route("POST", "/api/pay/quote", async (c) => pay.quote(c.body));
  route("POST", "/api/pay/buy", async (c) => {
    if (!allow(`buy:${uid(c)}`, 1 / 10, 3)) throw new HttpError(429, "rate_limited", "One purchase at a time");
    return pay.buy(db, uid(c), c.body);
  }, { auth: true });
  route("GET", "/api/pay/history", async (c) => pay.purchaseHistory(db, uid(c)), { auth: true });
  route("GET", "/api/swap/quote", async (c) => pay.sellQuote(c.query.get("amount")));
  route("POST", "/api/dev/faucet", async (c) => svc.devFaucet(db, uid(c)), { auth: true });

  // Economy transparency (public).
  route("GET", "/api/economy", async () => {
    const day = await db.tx((tx) => treasuryDay(tx));
    const revenue = await db.tx((tx) => avgDailyRevenue(tx));
    const hq = await db.tx((tx) => balanceOf(tx, acct.hq));
    const team = await db.tx((tx) => balanceOf(tx, acct.team));
    return {
      version: ECONOMY.version, network: env.network,
      hq: { balance: toWire(hq.balance), reserveFloor: toWire(HQ_RESERVE_FLOOR), nextDailyBudget: toWire(dailyBudget(hq.available, revenue).total), avgDailyRevenue: toWire(revenue) },
      team: { revenueBalance: toWire(team.balance) },
      today: { merchantAllowance: toWire(day.merchantAllowance), merchantGranted: toWire(day.merchantGranted), factorBps: day.factorBps },
      ticker: game.ticker(),
      catch: quotes(),
      fees: { food: toWire(ECONOMY.food.price), medicine: toWire(ECONOMY.medicine.price), marketplaceBps: ECONOMY.marketplace.feeBps },
      realTokenPvp: { enabled: ECONOMY.battle.realTokenPvp.enabled && env.realPvpApproved },
    };
  });
  route("GET", "/api/fairness", async () => ({ epochs: await publicEpochs(db) }));
  route("GET", "/api/battles/:id", async (c) => {
    const r = await db.query(`SELECT id, a_pet, b_pet, winner, epoch_id, label, inputs, result, stolen, mode, created_at::text FROM battles WHERE id = $1`, [c.params.id]);
    if (!r.rows[0]) throw new HttpError(404, "not_found", "No such battle");
    return r.rows[0];
  });

  // Catching.
  route("GET", "/api/catch/quotes", async () => ({ quotes: quotes() }));
  route("POST", "/api/catch/validate", async (c) => {
    if (!allow(`validate:${uid(c)}`, 1 / 10, 6)) throw new HttpError(429, "rate_limited", "Slow down — one capture check every few seconds");
    const frames = c.body.frames;
    if (!Array.isArray(frames) || frames.some((f) => typeof f !== "string")) throw new HttpError(400, "frames", "frames must be base64 JPEG strings");
    return validateCapture(db, detector(), uid(c), (frames as string[]).map((f) => Buffer.from(f, "base64")), game);
  }, { auth: true });
  route("POST", "/api/catch/attempt", async (c) => {
    const tier = c.body.tier as CatchTier;
    if (!CATCH_TIERS.includes(tier)) throw new HttpError(400, "tier", "bad tier");
    return resolveAttempt(db, game, uid(c), String(c.body.attemptId ?? ""), tier, String(c.body.clientNonce ?? ""));
  }, { auth: true });

  route("GET", "/api/catch/attempt/:id", async (c) => {
    const r = await db.query(`SELECT id, status, species, tier, cost::text, client_nonce, epoch_id, success, rarity, draws, pet_id, reject_reason FROM catch_attempts WHERE id = $1 AND user_id = $2`, [c.params.id, uid(c)]);
    if (!r.rows[0]) throw new HttpError(404, "not_found", "Unknown capture");
    return r.rows[0];
  }, { auth: true });

  // Pets.
  route("POST", "/api/pets/:id/fund", async (c) => svc.fundPet(db, game, uid(c), c.params.id!, amountOf(c.body.amount), rid(c.body.rid)), { auth: true });
  route("GET", "/api/pets/:id/history", async (c) => svc.petHistory(db, game, uid(c), c.params.id!), { auth: true });
  route("POST", "/api/pets/:id/withdraw", async (c) => svc.withdrawFromPet(db, game, uid(c), c.params.id!, amountOf(c.body.amount), rid(c.body.rid)), { auth: true });
  route("POST", "/api/pets/:id/craft", async (c) => svc.craft(db, game, uid(c), c.params.id!, c.body.kind as EquipmentKind, Boolean(c.body.buyMissing), rid(c.body.rid)), { auth: true });
  route("GET", "/api/craft", async () => ({ recipes: EQUIPMENT_KINDS.map((k) => svc.craftQuote(game, k)) }));
  route("GET", "/api/pets/:id/history", async (c) => {
    const p = game.pets.get(c.params.id!);
    if (!p || p.ownerId !== uid(c)) throw new HttpError(403, "not_owner", "Not your pet");
    const r = await db.query(`SELECT j.kind, p.amount::text, j.created_at::text, j.meta FROM postings p JOIN journal j ON j.id = p.journal_id WHERE p.account_id = $1 ORDER BY p.id DESC LIMIT 40`, [acct.pet(p.id)]);
    return { history: r.rows };
  }, { auth: true });
  route("POST", "/api/wallet/withdraw", async (c) => svc.requestChainWithdrawal(db, game, uid(c), amountOf(c.body.amount), rid(c.body.rid)), { auth: true });

  // Equipment.
  route("GET", "/api/equipment", async (c) => ({ items: await svc.listEquipment(db, uid(c)), recipes: EQUIPMENT }), { auth: true });
  route("POST", "/api/equipment/:id/equip", async (c) => svc.equip(db, game, uid(c), c.params.id!, typeof c.body.petId === "string" ? c.body.petId : null), { auth: true });

  // Marketplace.
  route("GET", "/api/market", async (c) => ({ listings: await svc.marketListings(db, { species: c.query.get("species") ?? undefined, rarity: c.query.get("rarity") ?? undefined, kind: c.query.get("kind") ?? undefined }) }));
  route("POST", "/api/market/list", async (c) => svc.createListing(db, game, uid(c), { petId: c.body.petId as string | undefined, equipmentId: c.body.equipmentId as string | undefined }, amountOf(c.body.price, "price")), { auth: true });
  route("POST", "/api/market/:id/cancel", async (c) => svc.cancelListing(db, game, uid(c), c.params.id!), { auth: true });
  route("POST", "/api/market/:id/buy", async (c) => svc.buyListing(db, game, uid(c), c.params.id!, typeof c.body.expectedPetBalance === "string" ? BigInt(c.body.expectedPetBalance) : null), { auth: true });

  route("GET", "/api/leaderboards", async () => svc.leaderboards(db, game));

  // Admin (token-protected; every write is logged).
  route("GET", "/api/admin/overview", async () => svc.adminOverview(db, game), { admin: true });
  route("GET", "/api/admin/reconcile", async () => svc.reconcile(db), { admin: true });
  route("POST", "/api/admin/flags", async (c) => {
    const f = c.body as Record<string, unknown>;
    const allowed = ["pauseCatches", "pauseTrades", "pauseBattles", "pauseWithdrawals"] as const;
    const patch = Object.fromEntries(allowed.filter((k) => typeof f[k] === "boolean").map((k) => [k, f[k]]));
    await game.setFlags(patch, "admin");
    return { flags: game.flags };
  }, { admin: true });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    try {
      setSecurityHeaders(res);
      if (req.method === "OPTIONS") return cors(req, res, 204);
      if (url.pathname.startsWith("/media/")) return serveFile(res, env.mediaDir, url.pathname.slice(7), "public, max-age=86400");
      if (url.pathname.startsWith("/models/")) return serveFile(res, env.modelDir, url.pathname.slice(8), "public, max-age=604800");
      const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
      if (!r) {
        if (staticDir && req.method === "GET" && !url.pathname.startsWith("/api/")) return serveSpa(res, staticDir, url.pathname);
        throw new HttpError(404, "not_found", "No such route");
      }
      if (!allow(`ip:${ip(req)}`, 20, 60)) throw new HttpError(429, "rate_limited", "Too many requests");
      const m = url.pathname.match(r.re)!;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)]));
      const auth = req.headers.authorization?.replace(/^Bearer /, "");
      const userId = verifyToken(auth);
      if (r.auth && !userId) throw new HttpError(401, "auth", "Sign in first");
      if (r.admin) {
        const t = req.headers["x-admin-token"];
        if (!env.adminToken || t !== env.adminToken) throw new HttpError(401, "admin", "Admin token required");
      }
      const body = req.method === "POST" ? await readJson(req, url.pathname === "/api/catch/validate" ? 6_000_000 : 64_000) : {};
      const out = await r.h({ req, body, params, query: url.searchParams, userId });
      cors(req, res, 200);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    } catch (e) {
      const known = e instanceof HttpError || e instanceof CaptureError || e instanceof svc.ServiceError || e instanceof GameError;
      const status = e instanceof HttpError ? e.status : e instanceof CaptureError || e instanceof svc.ServiceError ? e.status : e instanceof GameError ? 400 : 500;
      if (!known) console.error(req.method, url.pathname, e);
      cors(req, res, status);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: known ? (e as { code: string }).code : "internal", message: known ? (e as Error).message : "Something went wrong on our side. Nothing was charged twice — try again." }));
    }
  });

  // WebSocket gameplay channel.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://x");
    const origin = req.headers.origin;
    if (url.pathname !== "/ws" || (origin && !env.allowedOrigins.includes(origin) && !env.isDev)) { socket.destroy(); return; }
    const userId = verifyToken(url.searchParams.get("token"));
    if (!userId) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => void onSocket(ws, userId));
  });

  async function onSocket(ws: WebSocket, userId: string) {
    const u = await getUser(db, userId);
    if (!u || u.disabled) { ws.close(4001, "unknown account"); return; }
    const client: GameClient = {
      userId, displayName: u.display_name, controlled: null, lastMeta: 0,
      send: (msg: ServerMsg) => { if (ws.readyState === ws.OPEN && ws.bufferedAmount < 2_000_000) ws.send(JSON.stringify(msg)); },
    };
    game.join(client);
    client.send({ t: "toast", kind: "info", text: env.isDev ? "Dev network: balances are test units with no value." : `Network: ${env.network}` });
    let alive = true;
    const hb = setInterval(() => { if (!alive) ws.terminate(); alive = false; ws.ping(); }, 20_000);
    ws.on("pong", () => { alive = true; });
    ws.on("message", async (raw) => {
      if (!allow(`ws:${userId}`, 30, 60)) return;
      let msg: ClientMsg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      try { await game.handle(client, msg); } catch (e) {
        const known = e instanceof GameError || e instanceof svc.ServiceError;
        if (!known) console.error("ws handle", msg.t, e);
        client.send({ t: "error", code: known ? (e as GameError).code : "internal", message: known ? (e as Error).message : "Action failed", rid: (msg as { rid?: string }).rid });
      }
    });
    ws.on("close", () => { clearInterval(hb); game.leave(client); });
  }

  server.listen(env.port, () => console.log(`catchami server on :${env.port} (${env.network})`));
  return server;
}

function setSecurityHeaders(res: ServerResponse) {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-frame-options", "DENY");
}

function cors(req: IncomingMessage, res: ServerResponse, status: number) {
  const origin = req.headers.origin;
  if (origin && env.allowedOrigins.includes(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "origin");
    res.setHeader("access-control-allow-headers", "authorization, content-type, x-admin-token");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  }
  res.statusCode = status;
  if (status === 204) res.end();
}

async function readJson(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > limit) throw new HttpError(413, "too_large", "Request too large");
    chunks.push(c as Buffer);
  }
  if (!n) return {};
  try { const v = JSON.parse(Buffer.concat(chunks).toString()); return v && typeof v === "object" ? v : {}; } catch { throw new HttpError(400, "json", "Invalid JSON"); }
}

const MIME: Record<string, string> = { ".png": "image/png", ".json": "application/json", ".bin": "application/octet-stream", ".js": "text/javascript", ".css": "text/css", ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".wasm": "application/wasm", ".webp": "image/webp", ".ico": "image/x-icon" };

async function serveFile(res: ServerResponse, root: string, rel: string, cache: string) {
  const clean = normalize(decodeURIComponent(rel)).replace(/^([/\\])+/, "");
  if (clean.includes("..") || /^pending[/\\]/.test(clean)) { res.statusCode = 404; return res.end(); }
  const path = join(root, clean);
  try {
    const s = await stat(path);
    if (!s.isFile()) throw new Error();
    res.setHeader("content-type", MIME[extname(path)] ?? "application/octet-stream");
    res.setHeader("cache-control", cache);
    res.end(await readFile(path));
  } catch { res.statusCode = 404; res.end(); }
}

async function serveSpa(res: ServerResponse, dir: string, path: string) {
  const file = path === "/" ? "index.html" : path.slice(1);
  try { await stat(join(dir, normalize(file))); return serveFile(res, dir, file, file.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache"); } catch { return serveFile(res, dir, "index.html", "no-cache"); }
}
