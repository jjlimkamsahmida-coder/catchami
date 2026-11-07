import { describe, expect, it, beforeAll } from "vitest";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadDetector, type Detector } from "../src/capture/detector.ts";
import { decodeJpeg, dHash, hamming, renderSticker, frameDifference } from "../src/capture/image.ts";
import jpeg from "jpeg-js";

const modelDir = join(import.meta.dirname, "..", "models");
const fx = (n: string) => join(import.meta.dirname, "fixtures", n);
const haveModel = existsSync(join(modelDir, "ssdlite_mobilenet_v2", "group1-shard5of5"));

describe.skipIf(!haveModel)("server-side animal detection (COCO-SSD, wasm)", () => {
  let det: Detector;
  beforeAll(async () => { det = await loadDetector(modelDir); }, 120_000);

  it("detects a cat and a dog, and renders stickers", async () => {
    for (const [f, species] of [["cat.jpg", "cat"], ["dog.jpg", "dog"]] as const) {
      const img = decodeJpeg(await readFile(fx(f)));
      const r = await det.detect(img.data, img.width, img.height);
      expect(r.best?.species, f).toBe(species);
      expect(r.best!.score).toBeGreaterThan(0.6);
      const png = renderSticker(img, r.best!.bbox);
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      await mkdir(join(import.meta.dirname, "..", "..", "..", "data", "test-out"), { recursive: true });
      await writeFile(join(import.meta.dirname, "..", "..", "..", "data", "test-out", `${species}-sticker.png`), png);
    }
  }, 120_000);

  it("rejects an image with no animal", async () => {
    const w = 320, h = 240, data = new Uint8Array(w * h * 4);
    for (let i = 0; i < data.length; i += 4) { data[i] = (i / 4) % w; data[i + 1] = 120; data[i + 2] = 200; data[i + 3] = 255; }
    const r = await det.detect(data, w, h);
    expect(r.best).toBeNull();
  }, 60_000);
});

describe("perceptual hashing", () => {
  it("re-encoded copies of the same photo collide; different animals don't", async () => {
    const cat = decodeJpeg(await readFile(fx("cat.jpg")));
    const dog = decodeJpeg(await readFile(fx("dog.jpg")));
    const recompressed = decodeJpeg(Buffer.from(jpeg.encode({ data: Buffer.from(cat.data), width: cat.width, height: cat.height }, 40).data));
    expect(hamming(dHash(cat), dHash(recompressed))).toBeLessThanOrEqual(4);
    expect(hamming(dHash(cat), dHash(dog))).toBeGreaterThan(10);
    expect(frameDifference(cat, recompressed)).toBeLessThan(3);
    expect(frameDifference(cat, dog)).toBeGreaterThan(10);
  });
});
