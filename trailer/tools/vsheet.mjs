// Timestamped sheet straight from an MP4: node tools/vsheet.mjs out.png cols clip:t0-t1:n ...
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
const sharp = (await import("../../node_modules/.pnpm/sharp@0.34.4/node_modules/sharp/lib/index.js")).default;
const [out, cols, ...specs] = process.argv.slice(2);
const C = +cols, TW = 384, TH = 216, tmp = "frames/vs"; rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
const comps = []; let row = 0;
for (const spec of specs) {
  const [name, range] = spec.split(":"); const [a, b] = range.split("-").map(Number);
  for (let i = 0; i < C; i++) {
    const t = a + ((b - a) * i) / (C - 1), f = `${tmp}/${name}_${i}.png`;
    execFileSync("npx", ["remotion", "ffmpeg", "-loglevel", "error", "-y", "-ss", String(t), "-i", `public/f2/${name}.mp4`, "-frames:v", "1", "-vf", `scale=${TW}:${TH}`, f], { shell: true });
    comps.push({ input: f, left: i * TW, top: row * (TH + 16) + 16 });
    comps.push({ input: Buffer.from(`<svg width="${TW}" height="16"><rect width="100%" height="100%" fill="#2b1d3a"/><text x="4" y="12" font-size="11" fill="#fff" font-family="Arial">${name} ${t.toFixed(1)}s</text></svg>`), left: i * TW, top: row * (TH + 16) });
  }
  row++;
}
await sharp({ create: { width: C * TW, height: row * (TH + 16), channels: 3, background: "#000" } }).composite(comps).png().toFile(out);
console.log(out);
