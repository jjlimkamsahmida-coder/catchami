/**
 * The single compact world. Generated on the server from a fixed seed and
 * sent to clients as a tile grid, so collision and rendering always agree.
 */
import { ECONOMY, type Resource } from "./config.ts";
import { Rng } from "./rng.ts";

export const T = {
  grass: 0,
  meadow: 1,
  forest: 2,
  path: 3,
  sand: 4,
  shallow: 5,
  water: 6,
  rock: 7, // impassable cliff
  highland: 8, // walkable mountain ground
  bridge: 9,
  plaza: 10,
} as const;
export type Tile = (typeof T)[keyof typeof T];

const BLOCKED = new Set<number>([T.water, T.rock]);

export interface ResourceNodeDef {
  id: string;
  resource: Resource;
  tx: number;
  ty: number;
}

export interface Poi {
  id: string;
  label: string;
  tx: number;
  ty: number;
}

export interface WorldDef {
  w: number;
  h: number;
  tiles: Uint8Array;
  nodes: ResourceNodeDef[];
  pois: Poi[];
  hq: { tx: number; ty: number };
  /** Decorative blockers (big trees, boulders) — also impassable. */
  props: Array<{ kind: "tree" | "pine" | "boulder" | "bush" | "flower"; tx: number; ty: number }>;
  blocked: Uint8Array;
}

export const WORLD_W = 80;
export const WORLD_H = 56;
export const WORLD_SEED = "catchami-world-v1";

function valueNoise(rng: Rng, w: number, h: number, cell: number): (x: number, y: number) => number {
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const g = new Float64Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = rng.float();
  const s = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / cell, fy = y / cell;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = s(fx - x0), ty = s(fy - y0);
    const at = (i: number, j: number) => g[j * gw + i]!;
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
    return a + (b - a) * ty;
  };
}

export function generateWorld(seed = WORLD_SEED): WorldDef {
  const w = WORLD_W, h = WORLD_H;
  const rng = Rng.fromString(seed);
  const n1 = valueNoise(rng, w, h, 7);
  const n2 = valueNoise(rng, w, h, 3);
  const tiles = new Uint8Array(w * h);
  const idx = (x: number, y: number) => y * w + x;
  const set = (x: number, y: number, t: Tile) => { if (x >= 0 && y >= 0 && x < w && y < h) tiles[idx(x, y)] = t; };
  const get = (x: number, y: number) => tiles[idx(x, y)]!;

  // Base: grass with meadow patches in the south-east.
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const n = n1(x, y) * 0.7 + n2(x, y) * 0.3;
    let t: Tile = T.grass;
    if (x < 32 && y < 22 && n > 0.32) t = T.forest; // north-west forest
    if (x > 42 && y > 34 && n > 0.38) t = T.meadow; // south-east meadows
    if (x > 8 && x < 30 && y > 42 && n > 0.62) t = T.meadow; // south-west herb meadow
    set(x, y, t);
  }

  // Mountains in the north-east: cliffs around a walkable mineral highland.
  const mcx = 64, mcy = 11;
  for (let y = 0; y < 26; y++) for (let x = 46; x < w; x++) {
    const dx = (x - mcx) / 17, dy = (y - mcy) / 12;
    const d = dx * dx + dy * dy + (n2(x, y) - 0.5) * 0.35;
    if (d < 1) set(x, y, d > 0.72 ? T.rock : T.highland);
  }
  // Mountain pass (south-west gap) so the highland is reachable.
  for (let y = 15; y < 26; y++) for (let x = 54; x < 58; x++) if (get(x, y) === T.rock) set(x, y, T.highland);

  // Lake.
  const lcx = 20, lcy = 31;
  for (let y = 18; y < 46; y++) for (let x = 4; x < 38; x++) {
    const dx = (x - lcx) / 11.5, dy = (y - lcy) / 8.2;
    const d = dx * dx + dy * dy + (n2(x, y) - 0.5) * 0.25;
    if (d < 0.62) set(x, y, T.water);
    else if (d < 0.86) set(x, y, T.shallow);
    else if (d < 1.12 && get(x, y) !== T.forest) set(x, y, T.sand);
  }

  // River from the mountains down into the lake (meanders using noise).
  let rx = 46;
  for (let y = 0; y <= 27; y++) {
    rx += Math.round((n1(rx, y) - 0.5) * 2);
    rx = Math.max(34, Math.min(48, rx - (y > 14 ? 1 : 0)));
    for (let k = -1; k <= 1; k++) set(rx + k, y, T.water);
    set(rx - 2, y, get(rx - 2, y) === T.water ? T.water : T.shallow);
    set(rx + 2, y, get(rx + 2, y) === T.water ? T.water : T.shallow);
  }
  // Join the river mouth to the lake.
  for (let x = 30; x <= Math.max(rx, 31); x++) for (let k = -1; k <= 1; k++) if (get(x, 27 + k) !== T.water) set(x, 27 + k, x % 7 === 0 ? T.shallow : T.water);
  // Outflow stream south.
  let sx = 18;
  for (let y = 40; y < h; y++) {
    sx += Math.round((n2(sx, y) - 0.5) * 2);
    sx = Math.max(10, Math.min(26, sx));
    set(sx, y, T.water);
    set(sx + 1, y, T.water);
    if (get(sx - 1, y) !== T.water) set(sx - 1, y, T.shallow);
    if (get(sx + 2, y) !== T.water) set(sx + 2, y, T.shallow);
  }

  // HQ plaza in the middle-east.
  const hq = { tx: 50, ty: 31 };
  for (let y = hq.ty - 3; y <= hq.ty + 3; y++) for (let x = hq.tx - 4; x <= hq.tx + 4; x++) set(x, y, T.plaza);

  // Paths (L-shaped with bridges where they cross water).
  const carve = (x0: number, y0: number, x1: number, y1: number) => {
    const put = (x: number, y: number) => {
      const t = get(x, y);
      if (t === T.water || t === T.shallow) set(x, y, T.bridge);
      else if (t !== T.plaza && t !== T.bridge) set(x, y, T.path);
    };
    let x = x0, y = y0;
    while (x !== x1) { put(x, y); put(x, y + 1); x += Math.sign(x1 - x); }
    while (y !== y1) { put(x, y); put(x + 1, y); y += Math.sign(y1 - y); }
    put(x, y);
  };
  carve(hq.tx - 4, hq.ty, 33, hq.ty); // to lakeside
  carve(33, hq.ty, 33, 12); // up to forest (crosses the river mouth)
  carve(33, 12, 18, 12); // into the forest
  carve(hq.tx, hq.ty - 3, hq.tx, 22); // north
  carve(hq.tx, 22, 56, 22); // to the mountain pass
  carve(56, 22, 56, 14);
  carve(hq.tx, hq.ty + 3, hq.tx, 44); // south meadows
  carve(hq.tx, 44, 66, 44);
  carve(hq.tx - 4, hq.ty + 2, 22, 48); // south-west meadow (crosses stream)

  // Props, resource nodes.
  const props: WorldDef["props"] = [];
  const nodes: ResourceNodeDef[] = [];
  const occupied = new Set<number>();
  const free = (x: number, y: number) => !occupied.has(idx(x, y));
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const t = get(x, y);
    const r = rng.float();
    if (t === T.forest && r < 0.16) { props.push({ kind: r < 0.08 ? "pine" : "tree", tx: x, ty: y }); occupied.add(idx(x, y)); }
    else if (t === T.highland && r < 0.04) { props.push({ kind: "boulder", tx: x, ty: y }); occupied.add(idx(x, y)); }
    else if (t === T.grass && r < 0.025) { props.push({ kind: "bush", tx: x, ty: y }); occupied.add(idx(x, y)); }
    else if ((t === T.meadow || t === T.grass) && r > 0.93) props.push({ kind: "flower", tx: x, ty: y });
  }
  const isGround = (t: number) => t === T.grass || t === T.meadow || t === T.forest || t === T.sand || t === T.highland;
  const nearPath = (x: number, y: number, rad: number) => {
    for (let j = -rad; j <= rad; j++) for (let i = -rad; i <= rad; i++) {
      const t = get(Math.max(0, Math.min(w - 1, x + i)), Math.max(0, Math.min(h - 1, y + j)));
      if (t === T.path || t === T.plaza || t === T.bridge) return true;
    }
    return false;
  };
  const place = (resource: Resource, count: number, ok: (x: number, y: number, t: number) => boolean) => {
    let tries = 0, made = 0;
    while (made < count && tries++ < 5000) {
      const x = rng.range(2, w - 3), y = rng.range(2, h - 3);
      const t = get(x, y);
      if (!ok(x, y, t) || !free(x, y) || nearPath(x, y, 0)) continue;
      if (nodes.some((n) => Math.abs(n.tx - x) + Math.abs(n.ty - y) < 5)) continue;
      nodes.push({ id: `${resource}-${made + 1}`, resource, tx: x, ty: y });
      occupied.add(idx(x, y));
      made++;
    }
  };
  const nextToWater = (x: number, y: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([i, j]) => { const t = get(x + i!, y + j!); return t === T.shallow || t === T.water; });
  place("fish", 9, (x, y, t) => (t === T.sand || t === T.grass) && nextToWater(x, y));
  place("herbs", 9, (_x, _y, t) => t === T.meadow);
  place("wood", 9, (_x, _y, t) => t === T.forest);
  place("minerals", 8, (_x, _y, t) => t === T.highland);

  // Remove props that would block nodes or paths, then build the blocked mask.
  const blocked = new Uint8Array(w * h);
  for (let i = 0; i < tiles.length; i++) blocked[i] = BLOCKED.has(tiles[i]!) ? 1 : 0;
  for (const p of props) if (p.kind !== "flower") blocked[idx(p.tx, p.ty)] = 1;
  for (const n of nodes) blocked[idx(n.tx, n.ty)] = 1; // you gather from beside the node
  for (let y = hq.ty - 1; y <= hq.ty - 1; y++) for (let x = hq.tx - 2; x <= hq.tx + 2; x++) blocked[idx(x, y)] = 1; // HQ building footprint

  const pois: Poi[] = [
    { id: "hq", label: "HQ", tx: hq.tx, ty: hq.ty + 2 },
    { id: "lakeside", label: "Lakeside", tx: 33, ty: hq.ty + 1 },
    { id: "forest", label: "Whisperwood", tx: 20, ty: 13 },
    { id: "pass", label: "Pebble Pass", tx: 57, ty: 21 },
    { id: "highland", label: "Glimmer Peaks", tx: 57, ty: 14 },
    { id: "meadow", label: "Sunny Meadow", tx: 62, ty: 45 },
    { id: "southwest", label: "Clover Fields", tx: 23, ty: 49 },
    { id: "northgate", label: "North Path", tx: hq.tx, ty: 22 },
  ];
  return { w, h, tiles, nodes, pois, hq, props, blocked };
}

export function walkable(world: WorldDef, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) return false;
  return world.blocked[ty * world.w + tx] === 0;
}

export const TILE = ECONOMY.world.tileSize;
export const tileCenter = (t: number) => t * TILE + TILE / 2;
export const toTile = (px: number) => Math.floor(px / TILE);

/** 8-directional A* without corner cutting. Returns tile path excluding start. */
export function findPath(world: WorldDef, sx: number, sy: number, gx: number, gy: number, maxNodes = 6000): Array<[number, number]> | null {
  if (!walkable(world, gx, gy)) return null;
  const w = world.w;
  const key = (x: number, y: number) => y * w + x;
  const open = new MinHeap();
  const g = new Map<number, number>();
  const came = new Map<number, number>();
  const start = key(sx, sy), goal = key(gx, gy);
  const hfn = (x: number, y: number) => { const dx = Math.abs(x - gx), dy = Math.abs(y - gy); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
  g.set(start, 0);
  open.push(start, hfn(sx, sy));
  let expanded = 0;
  while (open.size) {
    const cur = open.pop()!;
    if (cur === goal) break;
    if (++expanded > maxNodes) return null;
    const cx = cur % w, cy = (cur - cx) / w;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (!walkable(world, nx, ny)) continue;
      if (dx && dy && (!walkable(world, cx + dx, cy) || !walkable(world, cx, cy + dy))) continue;
      const nk = key(nx, ny);
      const ng = g.get(cur)! + (dx && dy ? 1.414 : 1);
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        came.set(nk, cur);
        open.push(nk, ng + hfn(nx, ny));
      }
    }
  }
  if (!came.has(goal) && start !== goal) return null;
  const out: Array<[number, number]> = [];
  let c = goal;
  while (c !== start) { out.push([c % w, Math.floor(c / w)]); c = came.get(c)!; }
  return out.reverse();
}

/** Nearest walkable tile next to (tx,ty) — e.g. to stand beside a resource node. */
export function standSpot(world: WorldDef, tx: number, ty: number, fromX: number, fromY: number): [number, number] | null {
  let best: [number, number] | null = null, bd = Infinity;
  for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    const x = tx + dx, y = ty + dy;
    if (!walkable(world, x, y)) continue;
    const d = (x - fromX) ** 2 + (y - fromY) ** 2;
    if (d < bd) { bd = d; best = [x, y]; }
  }
  return best;
}

class MinHeap {
  private k: number[] = [];
  private p: number[] = [];
  get size() { return this.k.length; }
  push(key: number, pri: number) {
    this.k.push(key); this.p.push(pri);
    let i = this.k.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (this.p[par]! <= this.p[i]!) break;
      this.swap(i, par); i = par;
    }
  }
  pop(): number | undefined {
    if (!this.k.length) return undefined;
    const top = this.k[0];
    const lk = this.k.pop()!, lp = this.p.pop()!;
    if (this.k.length) {
      this.k[0] = lk; this.p[0] = lp;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.k.length && this.p[l]! < this.p[m]!) m = l;
        if (r < this.k.length && this.p[r]! < this.p[m]!) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.k[a], this.k[b]] = [this.k[b]!, this.k[a]!];
    [this.p[a], this.p[b]] = [this.p[b]!, this.p[a]!];
  }
}

export function encodeTiles(t: Uint8Array): string {
  let s = "";
  for (let i = 0; i < t.length; i++) s += String.fromCharCode(65 + t[i]!);
  return s;
}
export function decodeTiles(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) - 65;
  return out;
}
