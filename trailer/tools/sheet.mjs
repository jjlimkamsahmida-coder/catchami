// Contact sheet: node tools/sheet.mjs <framesDir> <out.png> [count=12] [cols=4]
import { readdirSync } from "node:fs";
import * as fs from "node:fs";
import { join } from "node:path";
const sharp = (await import("../../node_modules/.pnpm/sharp@0.34.4/node_modules/sharp/lib/index.js")).default;
const [dir, out, count = "12", cols = "4", t0 = "0", t1 = "1e9"] = process.argv.slice(2);
const files = readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort();
// Real time of each frame from the recorder's concat list.
const times = {};
try {
  const lines = fs.readFileSync(join(dir, "list.txt"), "utf8").split(/\r?\n/);
  let t = 0, cur = null;
  for (const ln of lines) { const m = /file '(.*)'/.exec(ln); if (m) { cur = m[1].split("/").pop(); times[cur] ??= t; } const d = /duration ([0-9.]+)/.exec(ln); if (d) t += +d[1]; }
} catch {}

const pool = files.filter((f) => times[f] === undefined || (times[f] >= +t0 && times[f] <= +t1));
const n = Math.min(+count, pool.length), C = +cols, R = Math.ceil(n / C);
const meta = await sharp(join(dir, pool[0])).metadata();
const W = 480, H = Math.round((meta.height / meta.width) * W);
const comps = [];
for (let i = 0; i < n; i++) {
  const f = pool[Math.floor((i * (pool.length - 1)) / Math.max(1, n - 1))];
  const buf = await sharp(join(dir, f)).resize(W, H).jpeg({ quality: 70 }).toBuffer();
  comps.push({ input: buf, left: (i % C) * W, top: Math.floor(i / C) * (H + 18) + 18 });
  const label = Buffer.from(`<svg width="${W}" height="18"><rect width="100%" height="100%" fill="#2b1d3a"/><text x="6" y="13" font-size="12" fill="#fff" font-family="Arial">${f}  t=${times[f] !== undefined ? times[f].toFixed(2) + "s" : "?"}</text></svg>`);
  comps.push({ input: label, left: (i % C) * W, top: Math.floor(i / C) * (H + 18) });
}
await sharp({ create: { width: C * W, height: R * (H + 18), channels: 3, background: "#ffffff" } }).composite(comps).png().toFile(out);
console.log(out, files.length, "frames");
