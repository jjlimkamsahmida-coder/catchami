/**
 * DEV TOOL: cut a fixed-grid sprite sheet (cols×rows equal cells) into clean,
 * trimmed transparent PNGs. Per cell it keeps the main artwork and drops
 * slivers bleeding in from neighbouring cells and the sparse speckle left by
 * checkerboard removal.
 *
 *   node apps/web/scripts/slice-grid.ts <sheet.png> <cols> <rows> <name1,name2,...> <maxWidth> [outDir]
 *   (use a single name with 1 1 to just clean + trim one image)
 */
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const [file, colsA, rowsA, namesA, maxWA, outA] = process.argv.slice(2);
if (!file || !namesA) { console.error("usage: slice-grid.ts <sheet> <cols> <rows> <names> <maxWidth> [outDir]"); process.exit(1); }
const cols = Number(colsA), rows = Number(rowsA), maxW = Number(maxWA ?? 512);
const names = namesA.split(",");
const out = outA ?? join(import.meta.dirname, "..", "public", "assets", "gen");
mkdirSync(out, { recursive: true });

const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, cw = Math.floor(W / cols), ch = Math.floor(H / rows);

for (let r = 0, n = 0; r < rows; r++) for (let c = 0; c < cols; c++, n++) {
  const name = names[n];
  if (!name || name === "-") continue;
  const x0 = c * cw, y0 = r * ch;
  const a = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) a[y * cw + x] = data[((y0 + y) * W + x0 + x) * 4 + 3]! > 40 ? 1 : 0;
  // Connected components (8-connected) on solid pixels.
  const lab = new Int32Array(cw * ch).fill(-1);
  const comps: Array<{ n: number; x0: number; y0: number; x1: number; y1: number }> = [];
  const st: number[] = [];
  for (let i = 0; i < a.length; i++) {
    if (!a[i] || lab[i] !== -1) continue;
    const id = comps.length, cp = { n: 0, x0: cw, y0: ch, x1: 0, y1: 0 };
    comps.push(cp); lab[i] = id; st.push(i);
    while (st.length) {
      const p = st.pop()!, x = p % cw, y = (p - x) / cw;
      cp.n++; if (x < cp.x0) cp.x0 = x; if (x > cp.x1) cp.x1 = x; if (y < cp.y0) cp.y0 = y; if (y > cp.y1) cp.y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= cw || yy >= ch) continue;
        const q = yy * cw + xx;
        if (a[q] && lab[q] === -1) { lab[q] = id; st.push(q); }
      }
    }
  }
  const big = Math.max(...comps.map((k) => k.n));
  const keep = comps.map((k) => {
    const bw = k.x1 - k.x0 + 1, bh = k.y1 - k.y0 + 1, density = k.n / (bw * bh);
    const edge = k.x0 <= 2 || k.y0 <= 2 || k.x1 >= cw - 3 || k.y1 >= ch - 3;
    if (edge && (bw < 60 || bh < 60) && k.n < big * 0.2) return false; // sliver from a neighbour cell
    if (k.n >= big * 0.02) return true;
    return k.n >= 250 && density >= 0.3; // small but solid (sparkles, droplets)
  });
  let bx0 = cw, by0 = ch, bx1 = 0, by1 = 0;
  comps.forEach((k, i) => { if (keep[i]) { bx0 = Math.min(bx0, k.x0); by0 = Math.min(by0, k.y0); bx1 = Math.max(bx1, k.x1); by1 = Math.max(by1, k.y1); } });
  const pad = 6;
  bx0 = Math.max(0, bx0 - pad); by0 = Math.max(0, by0 - pad); bx1 = Math.min(cw - 1, bx1 + pad); by1 = Math.min(ch - 1, by1 + pad);
  const ow = bx1 - bx0 + 1, oh = by1 - by0 + 1;
  const buf = Buffer.alloc(ow * oh * 4);
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    const cx = bx0 + x, cy = by0 + y, si = ((y0 + cy) * W + x0 + cx) * 4, di = (y * ow + x) * 4;
    const l = lab[cy * cw + cx]!;
    // Keep pixels of kept components, plus soft anti-aliased edge pixels touching them.
    let ok = l >= 0 && keep[l];
    if (!ok && l < 0 && data[si + 3]! > 0) {
      for (let dy = -1; dy <= 1 && !ok; dy++) for (let dx = -1; dx <= 1 && !ok; dx++) {
        const xx = cx + dx, yy = cy + dy;
        if (xx >= 0 && yy >= 0 && xx < cw && yy < ch) { const q = lab[yy * cw + xx]!; if (q >= 0 && keep[q]) ok = true; }
      }
    }
    if (!ok) continue;
    buf[di] = data[si]!; buf[di + 1] = data[si + 1]!; buf[di + 2] = data[si + 2]!; buf[di + 3] = data[si + 3]!;
  }
  const dropped = keep.filter((k) => !k).length;
  await sharp(buf, { raw: { width: ow, height: oh, channels: 4 } })
    .resize({ width: Math.min(maxW, ow), withoutEnlargement: true })
    .png({ palette: true, quality: 90, effort: 9 })
    .toFile(join(out, `${name}.png`));
  console.log(`${name}.png ${ow}x${oh} -> max ${maxW}w (dropped ${dropped} stray bits)`);
}
