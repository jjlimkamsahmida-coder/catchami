/**
 * DEV TOOL: shrink generated sprites in public/assets/gen to ~2x their
 * on-screen size and re-encode as palette PNGs (keeps alpha). Safe to re-run:
 * it never enlarges an image.
 *   node apps/web/scripts/optimize-art.ts
 */
import sharp from "sharp";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROP_ART, NODE_WIDTH, MERCHANT_HEIGHT } from "../src/game/assets.ts";

const dir = join(import.meta.dirname, "..", "public", "assets", "gen");
const propWidth = new Map<string, number>();
for (const a of Object.values(PROP_ART)) for (const k of a!.keys) propWidth.set(k, a!.width);

let before = 0, after = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith(".png"))) {
  const key = f.replace(/\.png$/, "");
  const path = join(dir, f);
  const src = readFileSync(path);
  before += src.length;
  const meta = await sharp(src).metadata();
  let resize: { width?: number; height?: number } = {};
  if (propWidth.has(key)) resize = { width: propWidth.get(key)! * 2 };
  else if (key.startsWith("node-")) resize = { width: NODE_WIDTH * 2 };
  else if (key.startsWith("merchant-")) resize = { height: MERCHANT_HEIGHT * 2 };
  else if (key.startsWith("cube-")) resize = { width: 300 };
  else if (key.startsWith("icon-") || key.startsWith("ui-")) resize = { width: 128 };
  else if (key.startsWith("tex-")) resize = {};
  const tooBig = (resize.width && meta.width! > resize.width) || (resize.height && meta.height! > resize.height);
  let img = sharp(src);
  if (tooBig) img = img.resize({ ...resize, kernel: "lanczos3" });
  const out = key.startsWith("tex-") ? await img.png({ compressionLevel: 9 }).toBuffer() : await img.png({ palette: true, quality: 92, effort: 10, compressionLevel: 9 }).toBuffer();
  if (out.length < src.length) writeFileSync(path, out);
  after += Math.min(out.length, src.length);
}
console.log(`gen art: ${(before / 1e6).toFixed(1)} MB -> ${(after / 1e6).toFixed(1)} MB`);
