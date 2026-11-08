/**
 * DEV TOOL: exercise the real capture endpoints from a desktop without a
 * camera. It sends a photo plus a slightly perturbed second frame (as a live
 * camera burst would) through the same server-side detection, liveness,
 * duplicate checks and paid roll that the phone uses.
 *
 *   node apps/server/scripts/dev-catch.ts <session-token> <photo.jpg> [tier] [api]
 */
import { readFile } from "node:fs/promises";
import jpeg from "jpeg-js";

const [token, file, tier = "basic", base = "http://127.0.0.1:8797"] = process.argv.slice(2);
if (!token || !file) { console.error("usage: dev-catch.ts <token> <photo.jpg> [basic|enhanced|premium] [api]"); process.exit(1); }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = async (path: string, body?: unknown): Promise<any> => {
  const r = await fetch(base + path, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = (await r.json()) as { message?: string };
  if (!r.ok) throw new Error(`${path}: ${j.message ?? r.status}`);
  return j;
};

const raw = await readFile(file);
const img = jpeg.decode(raw, { useTArray: true, formatAsRGBA: true });
const d2 = Buffer.from(img.data);
const shift = 3 + Math.floor(Math.random() * 6);
for (let i = 0; i < d2.length; i += 4) { d2[i] = Math.min(255, d2[i]! + shift); d2[i + 2] = Math.max(0, d2[i + 2]! - 2); }
const f2 = Buffer.from(jpeg.encode({ data: d2, width: img.width, height: img.height }, 88).data);

await call("/api/dev/faucet", {}).then(() => console.log("faucet: +20M test units")).catch((e) => console.log("faucet:", e.message));
const v = await call("/api/catch/validate", { frames: [raw.toString("base64"), f2.toString("base64")] });
console.log("validate:", v.ok ? `valid ${v.species} (score ${v.score.toFixed(2)})` : `rejected — ${v.message}`);
if (!v.ok) process.exit(0);
const nonce = Math.random().toString(36).slice(2, 14) + "dev";
const r = await call("/api/catch/attempt", { attemptId: v.attemptId, tier, clientNonce: nonce });
console.log("attempt:", r.success ? `CAUGHT ${r.rarity} → pet ${r.petId}` : "escaped (cost went to HQ)", "| fairness:", JSON.stringify(r.fairness));
