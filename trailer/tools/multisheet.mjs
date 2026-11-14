// One image: a row of timestamped thumbnails per clip. node tools/multisheet.mjs out.png cols clip[:t0-t1] ...
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const sharp = (await import("../../node_modules/.pnpm/sharp@0.34.4/node_modules/sharp/lib/index.js")).default;
const [out, cols, ...specs] = process.argv.slice(2);
const C = +cols, TW = 320, rows = [];
for (const spec of specs) {
  const [name, range] = spec.split(":"); const [a, b] = (range ?? "0-1e9").split("-").map(Number);
  const dir = join("frames", name), files = readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort();
  const times = {}; let t = 0, cur;
  for (const ln of readFileSync(join(dir, "list.txt"), "utf8").split(/\r?\n/)) { const m = /file '(.*)'/.exec(ln); if (m) { cur = m[1].split("/").pop(); times[cur] ??= t; } const d = /duration ([0-9.]+)/.exec(ln); if (d) t += +d[1]; }
  const pool = files.filter((f) => times[f] >= a && times[f] <= b);
  rows.push({ name, pick: Array.from({ length: C }, (_, i) => pool[Math.floor((i * (pool.length - 1)) / Math.max(1, C - 1))]), times, dir });
}
const comps = []; let y = 0;
for (const r of rows) {
  const meta = await sharp(join(r.dir, r.pick[0])).metadata(); const TH = Math.round(meta.height / meta.width * TW);
  for (let i = 0; i < C; i++) {
    const f = r.pick[i]; comps.push({ input: await sharp(join(r.dir, f)).resize(TW, TH).jpeg({ quality: 65 }).toBuffer(), left: i * TW, top: y + 16 });
    comps.push({ input: Buffer.from(`<svg width="${TW}" height="16"><rect width="100%" height="100%" fill="#2b1d3a"/><text x="4" y="12" font-size="11" fill="#fff" font-family="Arial">${r.name} t=${r.times[f].toFixed(1)}</text></svg>`), left: i * TW, top: y });
  }
  y += TH + 16;
}
await sharp({ create: { width: C * TW, height: y, channels: 3, background: "#fff" } }).composite(comps).png().toFile(out);
console.log(out);
