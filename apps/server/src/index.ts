import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { env } from "./env.ts";
import { openDb } from "./db/index.ts";
import { ensureGenesis } from "./ledger/treasury.ts";
import { Game } from "./world/game.ts";
import { startHttp } from "./http.ts";
import { loadDetector, type Detector } from "./capture/detector.ts";
import { sweepPendingCaptures } from "./capture/capture.ts";
import { reconcile } from "./services.ts";

await mkdir(env.dataDir, { recursive: true });
await mkdir(env.mediaDir, { recursive: true });
if (env.isDev && !env.adminToken) {
  env.adminToken = randomBytes(12).toString("hex");
  console.log(`[dev] admin token for /admin: ${env.adminToken}`);
}

const db = await openDb({ url: env.databaseUrl, dataDir: env.databaseUrl ? undefined : join(env.dataDir, "pg") });
await ensureGenesis(db);
const game = new Game(db);
await game.load();
game.start();

let detector: Detector | null = null;
if (existsSync(join(env.modelDir, "ssdlite_mobilenet_v2", "model.json"))) {
  loadDetector(env.modelDir).then((d) => { detector = d; console.log("animal detector ready"); }).catch((e) => console.error("detector failed to load:", e));
} else {
  console.warn("animal detection model missing — run `pnpm models`. Captures will be refused (never charged) until it is present.");
}

const webDist = join(import.meta.dirname, "..", "..", "web", "dist");
const server = startHttp(db, game, () => detector, existsSync(webDist) ? webDist : null);

setInterval(() => void sweepPendingCaptures(db).catch(() => {}), 60_000).unref();
setInterval(async () => {
  const r = await reconcile(db).catch((e) => ({ ok: false, issues: [String(e)] }));
  if (!r.ok) console.error("[reconcile] ALERT", r.issues);
}, 5 * 60_000).unref();

const shutdown = async () => {
  console.log("shutting down…");
  server.close();
  await game.stop();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
