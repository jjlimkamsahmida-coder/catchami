/**
 * Dev smoke test for the capture pipeline against a running server:
 * guest account -> test units -> validate (2 frames from a photo) -> attempt.
 * Usage: node apps/server/scripts/catch-smoke.ts [image.jpg] [tier]
 */
import { readFileSync, writeFileSync } from "node:fs";
import jpeg from "jpeg-js";

const base = process.env.CATCHAMI_URL ?? "http://localhost:8797";
const file = process.argv[2] ?? new URL("../test/fixtures/cat.jpg", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const tier = process.argv[3] ?? "basic";

async function call(path: string, body?: unknown, token?: string): Promise<any> {
  const r = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path} ${r.status} ${JSON.stringify(j)}`);
  return j;
}

const raw = jpeg.decode(readFileSync(file), { useTArray: true });
// Random crop + mirror so repeated runs aren't rejected as duplicate photos.
const cx = Math.floor(Math.random() * raw.width * 0.08), cy = Math.floor(Math.random() * raw.height * 0.08);
const W = raw.width - cx - Math.floor(Math.random() * raw.width * 0.08), H = raw.height - cy;
const mirror = Math.random() < 0.5;
const frame = (k: number) => {
  const d = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = mirror ? cx + W - 1 - x : cx + x, si = ((cy + y) * raw.width + sx) * 4, di = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) d[di + c] = Math.min(255, Math.round(raw.data[si + c]! * k));
    d[di + 3] = 255;
  }
  return jpeg.encode({ data: d, width: W, height: H }, 88).data.toString("base64");
};

const g = await call("/api/auth/guest", {});
console.log("guest", g.userId);
writeFileSync("data/smoke-token.txt", g.token);
await call("/api/dev/faucet", {}, g.token).then((r) => console.log("faucet", r)).catch((e) => console.log("faucet:", e.message));
const t0 = Date.now();
const v = await call("/api/catch/validate", { frames: [frame(1), frame(1.06)] }, g.token);
console.log("validate", Date.now() - t0, "ms", { ok: v.ok, species: v.species, score: v.score, bbox: v.bbox, message: v.message, reason: v.reason });
if (v.sticker) writeFileSync("data/smoke-sticker.png", Buffer.from(v.sticker.split(",")[1], "base64"));
if (v.ok) {
  const a = await call("/api/catch/attempt", { attemptId: v.attemptId, tier, clientNonce: "smoke" + Date.now() }, g.token);
  console.log("attempt", { success: a.success, rarity: a.rarity, petId: a.petId });
}
