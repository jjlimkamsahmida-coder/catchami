/**
 * Server-side animal verification with TensorFlow.js COCO-SSD (SSDLite
 * MobileNetV2) on the WASM backend — no native binaries, no paid API.
 * The browser runs the same model for the live preview, but only the
 * server's result decides whether an attempt is valid.
 */
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { SPECIES, type Species } from "@catchami/shared";
import { existsSync } from "node:fs";
import type { Rgba } from "./image.ts";
import { cleanMask, loadSegmenter, renderCutout, VOC, type Segmenter } from "./segment.ts";

export interface Detection { species: Species; score: number; bbox: [number, number, number, number] }
export interface Detector {
  ready: boolean;
  /** Body cutout sticker (transparent PNG) or null when segmentation fails. */
  cutout?(img: Rgba, species: Species, bbox: [number, number, number, number]): Promise<Buffer | null>;
  detect(rgba: Uint8Array, w: number, h: number): Promise<{ best: Detection | null; people: number; all: Array<{ cls: string; score: number }> }> }

type CocoModel = { detect(img: unknown, maxBoxes?: number, minScore?: number): Promise<Array<{ class: string; score: number; bbox: [number, number, number, number] }>> };

export async function loadDetector(modelDir: string): Promise<Detector> {
  const tf = await import("@tensorflow/tfjs");
  const wasm = await import("@tensorflow/tfjs-backend-wasm");
  const require = createRequire(import.meta.url);
  const wasmDir = dirname(require.resolve("@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm"));
  wasm.setWasmPaths(wasmDir.replace(/\\/g, "/") + "/");
  await tf.setBackend("wasm").catch(async () => { await tf.setBackend("cpu"); });
  await tf.ready();
  const coco = await import("@tensorflow-models/coco-ssd");
  const dir = join(modelDir, "ssdlite_mobilenet_v2");
  const json = JSON.parse(await readFile(join(dir, "model.json"), "utf8"));
  const handler = {
    load: async () => {
      const specs = json.weightsManifest.flatMap((g: { weights: unknown[] }) => g.weights);
      const bufs = await Promise.all(json.weightsManifest.flatMap((g: { paths: string[] }) => g.paths).map((p: string) => readFile(join(dir, p))));
      const total = Buffer.concat(bufs);
      return {
        modelTopology: json.modelTopology, format: json.format, generatedBy: json.generatedBy, convertedBy: json.convertedBy,
        weightSpecs: specs, weightData: total.buffer.slice(total.byteOffset, total.byteOffset + total.byteLength),
        signature: json.signature, userDefinedMetadata: json.userDefinedMetadata,
      };
    },
  };
  const model = (await coco.load({ base: "lite_mobilenet_v2", modelUrl: handler as unknown as string })) as unknown as CocoModel;
  let seg: Segmenter | null = null;
  if (existsSync(join(modelDir, "deeplab_pascal", "model.json"))) seg = await loadSegmenter(modelDir).catch((e) => { console.error("segmenter failed to load:", e); return null; });
  return {
    ready: true,
    async cutout(img, species, bbox) {
      if (!seg) return null;
      const raw = await seg.segment(img, VOC[species]);
      const m = cleanMask(raw, img.width, img.height, bbox.map(Math.round) as [number, number, number, number]);
      return m ? renderCutout(img, m) : null;
    },
    async detect(rgba, w, h) {
      const rgb = new Uint8Array(w * h * 3);
      for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) { rgb[j] = rgba[i]!; rgb[j + 1] = rgba[i + 1]!; rgb[j + 2] = rgba[i + 2]!; }
      const img = tf.tensor3d(rgb, [h, w, 3], "int32");
      try {
        const preds = await model.detect(img, 10, 0.3);
        const all = preds.map((p) => ({ cls: p.class, score: p.score }));
        const people = preds.filter((p) => p.class === "person" && p.score > 0.5).length;
        const animals = preds.filter((p) => (SPECIES as readonly string[]).includes(p.class)).sort((a, b) => b.score - a.score);
        const a = animals[0];
        return { best: a ? { species: a.class as Species, score: a.score, bbox: a.bbox } : null, people, all };
      } finally {
        img.dispose();
      }
    },
  };
}
