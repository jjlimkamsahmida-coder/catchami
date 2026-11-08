/**
 * Animal body cutout with DeepLab v3 (PASCAL VOC classes) on the tfjs wasm
 * backend, and the Catchami sticker treatment: soft-edged cutout, thick white
 * die-cut outline, thin ink edge and a drop shadow, on a transparent PNG.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";
import type { Species } from "@catchami/shared";
import type { Rgba } from "./image.ts";

/** PASCAL VOC class ids used by DeepLab. */
export const VOC: Record<Species, number> = { cat: 8, dog: 12 };

export interface Segmenter { segment(img: Rgba, cls: number): Promise<Uint8Array> }

export async function loadSegmenter(modelDir: string): Promise<Segmenter> {
  const tf = await import("@tensorflow/tfjs");
  await tf.ready(); // backend already configured by the detector
  const dir = join(modelDir, "deeplab_pascal");
  const json = JSON.parse(await readFile(join(dir, "model.json"), "utf8"));
  const bufs = await Promise.all(json.weightsManifest.flatMap((g: { paths: string[] }) => g.paths).map((p: string) => readFile(join(dir, p))));
  const weights = Buffer.concat(bufs);
  const model = await tf.loadGraphModel({
    load: async () => ({
      modelTopology: json.modelTopology,
      weightSpecs: json.weightsManifest.flatMap((g: { weights: unknown[] }) => g.weights),
      weightData: weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength),
    }),
  } as never);
  return {
    async segment(img, cls) {
      const scale = Math.min(1, 513 / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
      const rgb = new Uint8Array(img.width * img.height * 3);
      for (let i = 0, j = 0; i < img.data.length; i += 4, j += 3) { rgb[j] = img.data[i]!; rgb[j + 1] = img.data[i + 1]!; rgb[j + 2] = img.data[i + 2]!; }
      const out = tf.tidy(() => {
        const t = tf.tensor3d(rgb, [img.height, img.width, 3], "int32");
        const r = tf.image.resizeBilinear(t, [h, w]).round().clipByValue(0, 255).cast("int32").expandDims(0);
        return model.execute({ ImageTensor: r }, "SemanticPredictions") as import("@tensorflow/tfjs").Tensor;
      });
      const pred = (await out.data()) as Int32Array;
      out.dispose();
      const [, ph, pw] = out.shape.length === 3 ? out.shape : [1, out.shape[0]!, out.shape[1]!];
      // Upscale (nearest) to the original resolution.
      const mask = new Uint8Array(img.width * img.height);
      for (let y = 0; y < img.height; y++) {
        const sy = Math.min(ph! - 1, Math.floor((y / img.height) * ph!));
        for (let x = 0; x < img.width; x++) {
          const sx = Math.min(pw! - 1, Math.floor((x / img.width) * pw!));
          mask[y * img.width + x] = pred[sy * pw! + sx] === cls ? 1 : 0;
        }
      }
      return mask;
    },
  };
}

/** Keep the connected component(s) overlapping the detector box; returns null if nothing usable. */
export function cleanMask(mask: Uint8Array, w: number, h: number, bbox: [number, number, number, number]): Uint8Array | null {
  const label = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [], overlap: number[] = [];
  const [bx, by, bw, bh] = bbox;
  const inBox = (x: number, y: number) => x >= bx && x < bx + bw && y >= by && y < by + bh;
  const stack: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || label[i] !== -1) continue;
    const id = sizes.length;
    sizes.push(0); overlap.push(0);
    stack.push(i); label[i] = id;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w, y = (p - x) / w;
      sizes[id]!++;
      if (inBox(x, y)) overlap[id]!++;
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (q < 0 || q >= mask.length || label[q] !== -1 || !mask[q]) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === w - 1)) continue;
        label[q] = id; stack.push(q);
      }
    }
  }
  const best = Math.max(0, ...overlap);
  if (!best) return null;
  const keep = new Set(overlap.map((o, i) => (o >= best * 0.25 && sizes[i]! > 200 ? i : -1)).filter((i) => i >= 0));
  const kept = new Uint8Array(w * h);
  for (let i = 0; i < kept.length; i++) if (keep.has(label[i]!)) kept[i] = 1;
  // Erode 1px to drop background fringe at the silhouette edge.
  const out = new Uint8Array(w * h);
  let n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (kept[i] && kept[i - 1] && kept[i + 1] && kept[i - w] && kept[i + w]) { out[i] = 1; n++; }
  }
  // Too small relative to the animal's box: segmentation failed.
  if (n < bw * bh * 0.12) return null;
  return out;
}

/** Two-pass chamfer distance (in pixels) to the nearest "on" pixel. */
function distanceTo(on: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9, d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = on[i] ? 0 : INF;
  const a = 1, b = Math.SQRT2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    let v = d[i]!;
    if (x > 0) v = Math.min(v, d[i - 1]! + a);
    if (y > 0) { v = Math.min(v, d[i - w]! + a); if (x > 0) v = Math.min(v, d[i - w - 1]! + b); if (x < w - 1) v = Math.min(v, d[i - w + 1]! + b); }
    d[i] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    let v = d[i]!;
    if (x < w - 1) v = Math.min(v, d[i + 1]! + a);
    if (y < h - 1) { v = Math.min(v, d[i + w]! + a); if (x < w - 1) v = Math.min(v, d[i + w + 1]! + b); if (x > 0) v = Math.min(v, d[i + w - 1]! + b); }
    d[i] = v;
  }
  return d;
}

/**
 * Render the cutout sticker. Output: transparent PNG, longest side `size`,
 * animal fitted inside a white outline of `outline` px plus a 3 px ink edge.
 */
export function renderCutout(img: Rgba, mask: Uint8Array, size = 384, outline = 12): Buffer {
  let x0 = img.width, y0 = img.height, x1 = 0, y1 = 0;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (mask[y * img.width + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const ink = 3, shadow = 6, pad = outline + ink + shadow + 4;
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const s = (size - pad * 2) / Math.max(cw, ch);
  const W = Math.round(cw * s) + pad * 2, H = Math.round(ch * s) + pad * 2;
  // Resample mask (supersampled 3x3 for a soft edge) and colour into the output frame.
  const alpha = new Float32Array(W * H);
  const col = new Float32Array(W * H * 3);
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    let a = 0, r = 0, g = 0, bl = 0, n = 0;
    for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
      const px = x0 + (X - pad + (sx + 0.5) / 3) / s, py = y0 + (Y - pad + (sy + 0.5) / 3) / s;
      const ix = Math.floor(px), iy = Math.floor(py);
      if (ix < 0 || iy < 0 || ix >= img.width || iy >= img.height) continue;
      const k = iy * img.width + ix;
      if (mask[k]) { a++; r += img.data[k * 4]!; g += img.data[k * 4 + 1]!; bl += img.data[k * 4 + 2]!; n++; }
    }
    const i = Y * W + X;
    alpha[i] = a / 9;
    if (n) { col[i * 3] = r / n; col[i * 3 + 1] = g / n; col[i * 3 + 2] = bl / n; }
  }
  // Smooth the silhouette a little so the outline reads as a clean die-cut.
  const solid = new Uint8Array(W * H);
  for (let i = 0; i < solid.length; i++) solid[i] = alpha[i]! >= 0.5 ? 1 : 0;
  const dist = distanceTo(solid, W, H);
  const png = new PNG({ width: W, height: H });
  const ramp = (v: number) => Math.max(0, Math.min(1, v));
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    const i = Y * W + X;
    const d = dist[i]!;
    const ds = dist[Math.max(0, Y - shadow) * W + X]!; // shadow sits below
    let r = 0, g = 0, b = 0, a = 0;
    const sh = ramp(outline + ink + 1 - ds) * 0.28;
    if (sh > 0) { r = 43; g = 29; b = 58; a = sh; }
    const inkA = ramp(outline + ink + 0.5 - d);
    if (inkA > 0) { r = 43 * inkA + r * (1 - inkA); g = 29 * inkA + g * (1 - inkA); b = 58 * inkA + b * (1 - inkA); a = inkA + a * (1 - inkA); }
    const whiteA = ramp(outline + 0.5 - d);
    if (whiteA > 0) { r = 255 * whiteA + r * (1 - whiteA); g = 255 * whiteA + g * (1 - whiteA); b = 252 * whiteA + b * (1 - whiteA); a = whiteA + a * (1 - whiteA); }
    const pa = alpha[i]!;
    if (pa > 0) {
      // Slight "printed sticker" grade.
      let pr = col[i * 3]!, pg = col[i * 3 + 1]!, pb = col[i * 3 + 2]!;
      const l = 0.3 * pr + 0.59 * pg + 0.11 * pb;
      pr = l + (pr - l) * 1.15; pg = l + (pg - l) * 1.15; pb = l + (pb - l) * 1.15;
      r = pr * pa + r * (1 - pa); g = pg * pa + g * (1 - pa); b = pb * pa + b * (1 - pa); a = Math.max(a, pa);
    }
    const k = i * 4;
    png.data[k] = Math.max(0, Math.min(255, r)); png.data[k + 1] = Math.max(0, Math.min(255, g)); png.data[k + 2] = Math.max(0, Math.min(255, b)); png.data[k + 3] = Math.round(a * 255);
  }
  return PNG.sync.write(png);
}
