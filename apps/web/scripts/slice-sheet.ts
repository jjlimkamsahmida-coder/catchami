/**
 * DEV TOOL: slice a generated sprite sheet into individual transparent PNGs.
 * Sprites are found as alpha-connected regions (nearby pieces such as motion
 * trails are merged), ordered row by row, and saved with the given names.
 * If the sheet has no transparency, the background colour from the corners
 * is keyed out first.
 *
 *   node apps/web/scripts/slice-sheet.ts <sheet.png> <name1,name2,...> [mergePx] [outDir]
 *   node apps/web/scripts/slice-sheet.ts <sheet.png> --preview      (lists boxes only)
 */
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const [file, namesArg = "--preview", mergeArg = "14", outArg] = process.argv.slice(2);
if (!file) { console.error("usage: slice-sheet.ts <sheet> <names|--preview> [mergePx] [outDir]"); process.exit(1); }
const out = outArg ?? join(import.meta.dirname, "..", "public", "assets", "gen");
mkdirSync(out, { recursive: true });

const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const px = new Uint8Array(data);

// Key out an opaque background (sampled from the four corners) if needed.
let transparent = 0;
for (let i = 3; i < px.length; i += 16) if (px[i]! < 16) transparent++;
if (transparent < (W * H) / 64) {
  const corners = [[2, 2], [W - 3, 2], [2, H - 3], [W - 3, H - 3]].map(([x, y]) => { const k = (y! * W + x!) * 4; return [px[k]!, px[k + 1]!, px[k + 2]!]; });
  const bg = corners[0]!;
  const near = (k: number, tol: number) => Math.abs(px[k]! - bg[0]!) + Math.abs(px[k + 1]! - bg[1]!) + Math.abs(px[k + 2]! - bg[2]!) < tol;
  // Flood fill from the border so interior pixels of the same colour survive.
  const seen = new Uint8Array(W * H);
  const st: number[] = [];
  for (let x = 0; x < W; x++) st.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) st.push(y * W, y * W + W - 1);
  while (st.length) {
    const p = st.pop()!;
    if (seen[p]) continue;
    seen[p] = 1;
    if (!near(p * 4, 60)) continue;
    px[p * 4 + 3] = 0;
    const x = p % W;
    if (x > 0) st.push(p - 1);
    if (x < W - 1) st.push(p + 1);
    if (p >= W) st.push(p - W);
    if (p < W * (H - 1)) st.push(p + W);
  }
  console.log("keyed out background", bg);
}

// Occupancy at 1/4 resolution, dilated to merge nearby pieces.
const S = 4, gw = Math.ceil(W / S), gh = Math.ceil(H / S);
const occ = new Uint8Array(gw * gh);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (px[(y * W + x) * 4 + 3]! > 40) occ[Math.floor(y / S) * gw + Math.floor(x / S)] = 1;
const r = Math.max(1, Math.round(Number(mergeArg) / S));
const dil = new Uint8Array(gw * gh);
for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
  if (!occ[y * gw + x]) continue;
  for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) { const xx = x + i, yy = y + j; if (xx >= 0 && yy >= 0 && xx < gw && yy < gh) dil[yy * gw + xx] = 1; }
}
const lab = new Int32Array(gw * gh).fill(-1);
const boxes: Array<{ x0: number; y0: number; x1: number; y1: number; n: number }> = [];
for (let i = 0; i < dil.length; i++) {
  if (!dil[i] || lab[i]! >= 0) continue;
  const b = { x0: 1e9, y0: 1e9, x1: -1, y1: -1, n: 0 };
  const st = [i]; lab[i] = boxes.length;
  while (st.length) {
    const p = st.pop()!;
    const x = p % gw, y = (p - x) / gw;
    if (occ[p]) { b.n++; b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y); }
    for (const q of [p - 1, p + 1, p - gw, p + gw]) {
      if (q < 0 || q >= dil.length || !dil[q] || lab[q]! >= 0) continue;
      if ((q === p - 1 && x === 0) || (q === p + 1 && x === gw - 1)) continue;
      lab[q] = boxes.length; st.push(q);
    }
  }
  boxes.push(b);
}
const big = boxes.filter((b) => b.n > 60);
// Row-major order: group by vertical centre.
big.sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
const rows: (typeof big)[] = [];
for (const b of big) {
  const row = rows.find((rw) => Math.abs((rw[0]!.y0 + rw[0]!.y1) / 2 - (b.y0 + b.y1) / 2) < (b.y1 - b.y0) * 0.5);
  if (row) row.push(b); else rows.push([b]);
}
const ordered = rows.flatMap((rw) => rw.sort((a, b) => a.x0 - b.x0));
console.log(`${W}x${H}, ${ordered.length} sprites:`);
ordered.forEach((b, i) => console.log(`  #${i} x=${b.x0 * S} y=${b.y0 * S} w=${(b.x1 - b.x0 + 1) * S} h=${(b.y1 - b.y0 + 1) * S}`));
if (namesArg === "--preview") process.exit(0);

const names = namesArg.split(",");
const full = await sharp(Buffer.from(px), { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
for (const [i, b] of ordered.entries()) {
  const name = names[i];
  if (!name || name === "_") continue;
  const pad = 6;
  const left = Math.max(0, b.x0 * S - pad), top = Math.max(0, b.y0 * S - pad);
  const width = Math.min(W - left, (b.x1 - b.x0 + 1) * S + pad * 2), height = Math.min(H - top, (b.y1 - b.y0 + 1) * S + pad * 2);
  const crop = await sharp(full).extract({ left, top, width, height }).png().toBuffer();
  await sharp(crop).trim({ threshold: 1 }).png({ compressionLevel: 9 }).toFile(join(out, `${name}.png`));
  console.log("saved", name);
}
