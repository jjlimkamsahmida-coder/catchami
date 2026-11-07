/** Pure-JS image utilities: JPEG decode, perceptual hash, sticker rendering. */
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

export interface Rgba { data: Uint8Array; width: number; height: number }

export const MAX_UPLOAD_BYTES = 1_500_000;
export const MAX_DIM = 1600;

export function decodeJpeg(buf: Buffer): Rgba {
  if (buf.length > MAX_UPLOAD_BYTES) throw new Error("image too large");
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error("not a JPEG");
  const img = jpeg.decode(buf, { useTArray: true, maxResolutionInMP: 3, maxMemoryUsageInMB: 64, formatAsRGBA: true });
  if (img.width > MAX_DIM || img.height > MAX_DIM || img.width < 160 || img.height < 160) throw new Error("unsupported image size");
  return { data: img.data, width: img.width, height: img.height };
}

/** Box-sampled grayscale at w x h. */
function grayResize(img: Rgba, x0: number, y0: number, cw: number, ch: number, w: number, h: number): Float64Array {
  const out = new Float64Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const sx0 = Math.floor(x0 + (i * cw) / w), sx1 = Math.max(sx0 + 1, Math.floor(x0 + ((i + 1) * cw) / w));
    const sy0 = Math.floor(y0 + (j * ch) / h), sy1 = Math.max(sy0 + 1, Math.floor(y0 + ((j + 1) * ch) / h));
    let s = 0, n = 0;
    for (let y = sy0; y < sy1; y += 2) for (let x = sx0; x < sx1; x += 2) {
      const k = (Math.min(img.height - 1, y) * img.width + Math.min(img.width - 1, x)) * 4;
      s += 0.299 * img.data[k]! + 0.587 * img.data[k + 1]! + 0.114 * img.data[k + 2]!;
      n++;
    }
    out[j * w + i] = s / Math.max(1, n);
  }
  return out;
}

/** 64-bit difference hash (hex) of a region. Robust to resizing and recompression. */
export function dHash(img: Rgba, box?: [number, number, number, number]): string {
  const [x, y, w, h] = box ?? [0, 0, img.width, img.height];
  const g = grayResize(img, x, y, w, h, 9, 8);
  let bits = 0n;
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) bits = (bits << 1n) | (g[j * 9 + i]! > g[j * 9 + i + 1]! ? 1n : 0n);
  return bits.toString(16).padStart(16, "0");
}

export function hamming(a: string, b: string): number {
  let x = BigInt("0x" + a) ^ BigInt("0x" + b), n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

/** Mean absolute pixel difference between two frames (0..255), downsampled. */
export function frameDifference(a: Rgba, b: Rgba): number {
  const ga = grayResize(a, 0, 0, a.width, a.height, 32, 32);
  const gb = grayResize(b, 0, 0, b.width, b.height, 32, 32);
  let s = 0;
  for (let i = 0; i < ga.length; i++) s += Math.abs(ga[i]! - gb[i]!);
  return s / ga.length;
}

/**
 * Catchami sticker treatment: crop around the detected animal, fit into a
 * 256px canvas, cut a soft rounded "blob" mask, add a thick white die-cut
 * border and a drop shadow. Only this crop is kept — the full camera frame
 * (which may contain people or a home interior) is discarded.
 */
export function renderSticker(img: Rgba, bbox: [number, number, number, number], size = 256): Buffer {
  const [bx, by, bw, bh] = bbox;
  const pad = 0.1;
  // Square crop around the animal, kept inside the frame (no smeared edges).
  const side = Math.min(Math.max(bw, bh) * (1 + pad * 2), img.width, img.height);
  const cx = bx + bw / 2, cy = by + bh / 2;
  const sx = Math.max(0, Math.min(img.width - side, cx - side / 2));
  const sy = Math.max(0, Math.min(img.height - side, cy - side / 2));
  const png = new PNG({ width: size, height: size });
  const border = 10, shadow = 6;
  const inner = size / 2 - border - shadow - 2;
  // Superellipse distance (n=4) gives a friendly rounded-square silhouette.
  const dist = (x: number, y: number) => {
    const nx = (x - size / 2) / inner, ny = (y - (size / 2 - 2)) / inner;
    return Math.pow(Math.pow(Math.abs(nx), 4) + Math.pow(Math.abs(ny), 4), 1 / 4);
  };
  const borderD = 1 + border / inner;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const k = (y * size + x) * 4;
    const d = dist(x, y);
    const ds = dist(x, y - shadow);
    let r = 0, g = 0, b = 0, a = 0;
    if (ds < borderD + 0.02) { // shadow
      const t = Math.max(0, Math.min(1, (borderD + 0.02 - ds) / 0.04));
      r = 40; g = 30; b = 60; a = 70 * t;
    }
    if (d < borderD) { // white die-cut border
      const t = Math.max(0, Math.min(1, (borderD - d) * inner));
      r = 255 * t + r * (1 - t); g = 255 * t + g * (1 - t); b = 252 * t + b * (1 - t); a = 255 * t + a * (1 - t);
    }
    if (d < 1) { // photo
      const px = sx + ((x - (size / 2 - inner)) / (2 * inner)) * side;
      const py = sy + ((y - (size / 2 - 2 - inner)) / (2 * inner)) * side;
      const ix = Math.max(0, Math.min(img.width - 1, Math.round(px)));
      const iy = Math.max(0, Math.min(img.height - 1, Math.round(py)));
      const s = (iy * img.width + ix) * 4;
      // Light "sticker print" grade: lift saturation and contrast a touch.
      let pr = img.data[s]!, pg = img.data[s + 1]!, pb = img.data[s + 2]!;
      const l = 0.3 * pr + 0.59 * pg + 0.11 * pb;
      pr = l + (pr - l) * 1.18; pg = l + (pg - l) * 1.18; pb = l + (pb - l) * 1.18;
      pr = (pr - 128) * 1.06 + 132; pg = (pg - 128) * 1.06 + 132; pb = (pb - 128) * 1.06 + 132;
      const t = Math.max(0, Math.min(1, (1 - d) * inner));
      r = pr * t + r * (1 - t); g = pg * t + g * (1 - t); b = pb * t + b * (1 - t); a = 255;
    }
    png.data[k] = Math.max(0, Math.min(255, r));
    png.data[k + 1] = Math.max(0, Math.min(255, g));
    png.data[k + 2] = Math.max(0, Math.min(255, b));
    png.data[k + 3] = Math.max(0, Math.min(255, a));
  }
  return PNG.sync.write(png);
}
