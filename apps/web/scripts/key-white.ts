/**
 * DEV TOOL: make the plain white (or near-white) background of a generated
 * image transparent. Flood-fills from the image border only, so white areas
 * enclosed by an outline (eye shines, bellies) are kept. Edge pixels get a
 * soft alpha so the outline doesn't keep a white halo.
 *   node apps/web/scripts/key-white.ts <in> <out.png> [tolerance=38]
 */
import sharp from "sharp";

const [inp, out, tolA = "38"] = process.argv.slice(2);
if (!inp || !out) { console.error("usage: key-white.ts <in> <out.png> [tolerance]"); process.exit(1); }
const tol = Number(tolA);
const { data, info } = await sharp(inp).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const px = new Uint8Array(data);
const dist = (p: number) => 765 - (px[p * 4]! + px[p * 4 + 1]! + px[p * 4 + 2]!); // 0 = pure white
const bg = new Uint8Array(W * H);
const st: number[] = [];
for (let x = 0; x < W; x++) st.push(x, (H - 1) * W + x);
for (let y = 0; y < H; y++) st.push(y * W, y * W + W - 1);
while (st.length) {
  const p = st.pop()!;
  if (bg[p] || dist(p) > tol) continue;
  bg[p] = 1;
  const x = p % W;
  if (x > 0) st.push(p - 1);
  if (x < W - 1) st.push(p + 1);
  if (p >= W) st.push(p - W);
  if (p < W * (H - 1)) st.push(p + W);
}
for (let p = 0; p < W * H; p++) {
  if (bg[p]) { px[p * 4 + 3] = 0; continue; }
  // Anti-alias: pixels touching the background fade by how white they are.
  const x = p % W;
  const near = (x > 0 && bg[p - 1]) || (x < W - 1 && bg[p + 1]) || (p >= W && bg[p - W]) || (p < W * (H - 1) && bg[p + W]);
  if (near) px[p * 4 + 3] = Math.min(255, Math.round((dist(p) / 200) * 255));
}
await sharp(px, { raw: { width: W, height: H, channels: 4 } }).png().toFile(out);
console.log(`keyed ${inp} -> ${out} (${W}x${H})`);
