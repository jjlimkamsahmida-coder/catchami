/**
 * Downloads the official TensorFlow.js models into apps/server/models so the
 * server (verification + cutouts) and the web client (live preview) load them
 * from our own origin — no third-party CDN at runtime. Run: pnpm models
 *
 *  - ssdlite_mobilenet_v2: COCO-SSD object detector (finds the animal)
 *  - deeplab_pascal: DeepLab v3 semantic segmentation, PASCAL VOC classes
 *    (cuts the animal's body out for the sticker)
 */
import { mkdir, writeFile, stat, readFile } from "node:fs/promises";
import { join } from "node:path";

const MODELS: Array<{ dir: string; base: string; suffix: string }> = [
  { dir: "ssdlite_mobilenet_v2", base: "https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/", suffix: "" },
  { dir: "deeplab_pascal", base: "https://tfhub.dev/tensorflow/tfjs-model/deeplab/pascal/1/quantized/2/1/", suffix: "?tfjs-format=file" },
];

for (const m of MODELS) {
  const dir = join(import.meta.dirname, "..", "models", m.dir);
  await mkdir(dir, { recursive: true });
  const get = async (name: string) => {
    const path = join(dir, name);
    try { if ((await stat(path)).size > 0) return console.log("have", m.dir, name); } catch {}
    const r = await fetch(m.base + name + m.suffix);
    if (!r.ok) throw new Error(`${m.dir}/${name}: HTTP ${r.status}`);
    await writeFile(path, Buffer.from(await r.arrayBuffer()));
    console.log("fetched", m.dir, name);
  };
  await get("model.json");
  const manifest = JSON.parse(await readFile(join(dir, "model.json"), "utf8")) as { weightsManifest: Array<{ paths: string[] }> };
  for (const p of manifest.weightsManifest.flatMap((w) => w.paths)) await get(p);
}
console.log("models ready");
