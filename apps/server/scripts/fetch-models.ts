/**
 * Downloads the official TensorFlow.js COCO-SSD (SSDLite MobileNetV2) model
 * into apps/server/models so both the server (verification) and the web
 * client (live preview) load it from our own origin — no third-party CDN at
 * runtime. Run: pnpm models
 */
import { mkdir, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";

const BASE = "https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/";
const dir = join(import.meta.dirname, "..", "models", "ssdlite_mobilenet_v2");

async function get(name: string) {
  const path = join(dir, name);
  try { if ((await stat(path)).size > 0) return console.log("have", name); } catch {}
  const r = await fetch(BASE + name);
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  await writeFile(path, Buffer.from(await r.arrayBuffer()));
  console.log("fetched", name);
}

await mkdir(dir, { recursive: true });
await get("model.json");
const manifest = (await import(join(dir, "model.json").replace(/\\/g, "/").replace(/^([A-Za-z]:)/, "file:///$1"), { with: { type: "json" } })).default as { weightsManifest: Array<{ paths: string[] }> };
for (const p of manifest.weightsManifest.flatMap((w) => w.paths)) await get(p);
console.log("model ready in", dir);
