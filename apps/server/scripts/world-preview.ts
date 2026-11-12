/** Dev tool: render the generated world to data/world-preview.png and print sanity stats. */
import { writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { AREAS, findPath, generateWorld, T } from "@catchami/shared";

const w = generateWorld();
const S = 4;
const png = new PNG({ width: w.w * S, height: w.h * S });
const COL: Record<number, [number, number, number]> = {
  [T.grass]: [137, 207, 93], [T.meadow]: [173, 226, 119], [T.forest]: [70, 160, 95], [T.path]: [232, 203, 142], [T.sand]: [242, 216, 154],
  [T.shallow]: [130, 216, 234], [T.water]: [76, 179, 230], [T.rock]: [110, 92, 120], [T.highland]: [220, 189, 139], [T.bridge]: [176, 122, 76],
  [T.plaza]: [221, 210, 191], [T.farm]: [150, 110, 70],
};
const put = (x: number, y: number, c: [number, number, number]) => {
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const k = ((y * S + j) * png.width + x * S + i) * 4; png.data[k] = c[0]; png.data[k + 1] = c[1]; png.data[k + 2] = c[2]; png.data[k + 3] = 255; }
};
for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) {
  const i = y * w.w + x;
  put(x, y, w.blocked[i] && w.tiles[i] !== T.rock && w.tiles[i] !== T.water ? [40, 90, 50] : COL[w.tiles[i]!]!);
}
const NODE: Record<string, [number, number, number]> = { wood: [140, 80, 30], fish: [20, 60, 220], herbs: [200, 60, 200], minerals: [255, 255, 255] };
for (const n of w.nodes) put(n.tx, n.ty, NODE[n.resource]!);
for (const p of w.props) if (p.kind === "barricade" || p.kind === "signpost") for (let i = 0; i < (p.kind === "barricade" ? 4 : 1); i++) put(p.tx + i, p.ty, [230, 40, 40]);
for (const p of w.pois) put(p.tx, p.ty, [255, 220, 0]);
writeFileSync("data/world-preview.png", PNG.sync.write(png));

const hq = w.pois[0]!;
const counts: Record<string, Record<string, number>> = {};
for (const n of w.nodes) { const a = AREAS[w.area[n.ty * w.w + n.tx]!]!.id; (counts[a] ??= {})[n.resource] = ((counts[a] ??= {})[n.resource] ?? 0) + 1; }
console.log("size", w.w, w.h, "nodes", counts);
for (const p of w.pois) console.log(p.id.padEnd(14), findPath(w, hq.tx, hq.ty, p.tx, p.ty, 300000) ? "reachable" : "UNREACHABLE");
