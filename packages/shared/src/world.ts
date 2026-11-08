/**
 * The Catchami world: four large connected areas — Cozy Meadow, Fantasy Town,
 * Enchanted Forest and Mining Valley — each 72x56 tiles. Generated on the
 * server from a fixed seed and sent to clients as a tile grid, so collision
 * and rendering always agree. Props are deterministic from the same seed.
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
  highland: 8, // walkable mining ground
  bridge: 9,
  plaza: 10, // cobblestone
  farm: 11, // tilled crop rows (walkable)
} as const;
export type Tile = (typeof T)[keyof typeof T];

const BLOCKED = new Set<number>([T.water, T.rock]);

export const AREAS = [
  { id: "meadow", name: "Cozy Meadow" },
  { id: "town", name: "Fantasy Town" },
  { id: "forest", name: "Enchanted Forest" },
  { id: "mines", name: "Mining Valley" },
] as const;
export type AreaId = (typeof AREAS)[number]["id"];

export interface ResourceNodeDef { id: string; resource: Resource; tx: number; ty: number }
export interface Poi { id: string; label: string; tx: number; ty: number }

export type PropKind =
  | "tree" | "pine" | "bush" | "boulder" | "flower" | "purpleflower" | "mushroom" | "crop" | "hay"
  | "farmhouse" | "windmill" | "stall" | "fence_h" | "fence_v" | "dock"
  | "castle" | "fountain" | "lamp" | "house" | "banner" | "well"
  | "mine" | "cart" | "rail" | "crystal" | "smithy" | "crate" | "deadtree"
  | "portal" | "stone" | "glowcrystal" | "barrel" | "wagon";

/** Footprint in tiles (top-left at tx,ty). `solid` props block movement. */
export const PROP_SIZE: Record<PropKind, { w: number; h: number; solid: boolean }> = {
  tree: { w: 1, h: 1, solid: true }, pine: { w: 1, h: 1, solid: true }, bush: { w: 1, h: 1, solid: true },
  boulder: { w: 1, h: 1, solid: true }, flower: { w: 1, h: 1, solid: false }, purpleflower: { w: 1, h: 1, solid: false },
  mushroom: { w: 1, h: 1, solid: false }, crop: { w: 1, h: 1, solid: false }, hay: { w: 1, h: 1, solid: true },
  farmhouse: { w: 5, h: 3, solid: true }, windmill: { w: 3, h: 3, solid: true }, stall: { w: 2, h: 1, solid: true },
  fence_h: { w: 1, h: 1, solid: true }, fence_v: { w: 1, h: 1, solid: true }, dock: { w: 1, h: 1, solid: false },
  castle: { w: 11, h: 5, solid: true }, fountain: { w: 3, h: 3, solid: true }, lamp: { w: 1, h: 1, solid: true },
  house: { w: 4, h: 3, solid: true }, banner: { w: 1, h: 1, solid: true }, well: { w: 2, h: 2, solid: true },
  mine: { w: 4, h: 3, solid: true }, cart: { w: 1, h: 1, solid: true }, rail: { w: 1, h: 1, solid: false },
  crystal: { w: 1, h: 1, solid: true }, smithy: { w: 4, h: 3, solid: true }, crate: { w: 1, h: 1, solid: true },
  deadtree: { w: 1, h: 1, solid: true }, portal: { w: 3, h: 2, solid: true }, stone: { w: 1, h: 1, solid: true },
  glowcrystal: { w: 1, h: 1, solid: true }, barrel: { w: 1, h: 1, solid: true }, wagon: { w: 2, h: 1, solid: true },
};

export interface Prop { kind: PropKind; tx: number; ty: number; v: number }

export interface WorldDef {
  w: number;
  h: number;
  tiles: Uint8Array;
  /** Area index (into AREAS) per tile. */
  area: Uint8Array;
  nodes: ResourceNodeDef[];
  pois: Poi[];
  hq: { tx: number; ty: number };
  props: Prop[];
  blocked: Uint8Array;
}

export const AREA_W = 72;
export const AREA_H = 56;
export const WORLD_W = AREA_W * 2;
export const WORLD_H = AREA_H * 2;
export const WORLD_SEED = "catchami-world-v2";

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
    const at = (i: number, j: number) => g[Math.max(0, Math.min(gh - 1, j)) * gw + Math.max(0, Math.min(gw - 1, i))]!;
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
    return a + (b - a) * ty;
  };
}

export function generateWorld(seed = WORLD_SEED): WorldDef {
  const w = WORLD_W, h = WORLD_H;
  const rng = Rng.fromString(seed);
  const n1 = valueNoise(rng, w, h, 9);
  const n2 = valueNoise(rng, w, h, 4);
  const n3 = valueNoise(rng, w, h, 2);
  const tiles = new Uint8Array(w * h);
  const area = new Uint8Array(w * h);
  const idx = (x: number, y: number) => y * w + x;
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const set = (x: number, y: number, t: Tile) => { if (inb(x, y)) tiles[idx(x, y)] = t; };
  const get = (x: number, y: number) => (inb(x, y) ? tiles[idx(x, y)]! : T.rock);
  const A = { meadow: 0, town: 1, forest: 2, mines: 3 } as const;

  // Wavy area borders.
  const riverX = (y: number) => AREA_W + Math.round((n1(4, y) - 0.5) * 6);
  const splitY = (x: number) => AREA_H + Math.round((n1(x, 4) - 0.5) * 5);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const east = x >= riverX(y), south = y >= splitY(x);
    area[idx(x, y)] = east ? (south ? A.mines : A.town) : south ? A.forest : A.meadow;
  }
  const areaAt = (x: number, y: number) => area[idx(Math.max(0, Math.min(w - 1, x)), Math.max(0, Math.min(h - 1, y)))]!;

  // Base terrain per area.
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = areaAt(x, y);
    const n = n2(x, y) * 0.6 + n3(x, y) * 0.4;
    let t: Tile = T.grass;
    if (a === A.meadow) t = n > 0.62 ? T.meadow : T.grass;
    else if (a === A.town) t = n > 0.7 ? T.meadow : T.grass;
    else if (a === A.forest) t = n > 0.66 ? T.meadow : T.forest;
    else t = n > 0.74 && n1(x, y) > 0.5 ? T.rock : T.highland;
    set(x, y, t);
  }

  // Mining Valley rim: cliffs around the valley (gaps carved later by paths).
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (areaAt(x, y) !== A.mines) continue;
    const edge = [[2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dy]) => areaAt(x + dx!, y + dy!) !== A.mines);
    if (edge || x >= w - 2 || y >= h - 2) set(x, y, T.rock);
  }
  // Northern cliff above Fantasy Town (waterfall backdrop).
  for (let x = AREA_W + 8; x < w; x++) for (let y = 0; y < 3 + Math.round(n2(x, 1) * 2); y++) set(x, y, T.rock);

  // Great river along the west/east divide, with sand banks.
  for (let y = 0; y < h; y++) {
    const rx = riverX(y);
    for (let k = -1; k <= 1; k++) set(rx + k, y, T.water);
    for (const k of [-2, 2]) if (get(rx + k, y) !== T.water) set(rx + k, y, T.shallow);
  }
  // Meadow lake and forest pond.
  const blob = (cx: number, cy: number, rx: number, ry: number, sandy = true) => {
    for (let y = cy - ry - 3; y <= cy + ry + 3; y++) for (let x = cx - rx - 3; x <= cx + rx + 3; x++) {
      if (!inb(x, y)) continue;
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      const d = dx * dx + dy * dy + (n3(x, y) - 0.5) * 0.3;
      if (d < 0.6) set(x, y, T.water);
      else if (d < 0.85) set(x, y, T.shallow);
      else if (sandy && d < 1.1 && get(x, y) !== T.water && get(x, y) !== T.shallow) set(x, y, T.sand);
    }
  };
  blob(22, 33, 11, 8);
  blob(44, 88, 7, 5);
  blob(108, 48, 4, 2, false); // town moat pond south of the plaza

  // Fantasy Town plaza (cobblestone) — HQ castle sits on its north side.
  const hq = { tx: 108, ty: 25 };
  const PX0 = 94, PX1 = 122, PY0 = 16, PY1 = 38;
  for (let y = PY0; y <= PY1; y++) for (let x = PX0; x <= PX1; x++) {
    const corner = (x - PX0 < 2 || PX1 - x < 2) && (y - PY0 < 2 || PY1 - y < 2);
    if (!corner) set(x, y, T.plaza);
  }

  // Meadow farm fields.
  for (let y = 9; y <= 17; y++) for (let x = 40; x <= 55; x++) set(x, y, T.farm);

  // Paths (L-shaped; crossings become bridges).
  const carve = (x0: number, y0: number, x1: number, y1: number, wide = 2) => {
    const put = (x: number, y: number) => {
      const t = get(x, y);
      if (t === T.water || t === T.shallow) set(x, y, T.bridge);
      else if (t !== T.plaza && t !== T.bridge && t !== T.farm) set(x, y, T.path);
    };
    let x = x0, y = y0;
    while (x !== x1) { for (let k = 0; k < wide; k++) put(x, y + k); x += Math.sign(x1 - x); }
    while (y !== y1) { for (let k = 0; k < wide; k++) put(x + k, y); y += Math.sign(y1 - y); }
    put(x, y);
  };
  // Town ↔ Meadow (bridge over the river), Meadow network.
  carve(PX0, 27, 40, 27);
  carve(40, 27, 40, 19);
  carve(40, 27, 33, 27); // towards the lake dock
  carve(40, 22, 12, 22);
  carve(12, 22, 12, 12); // windmill
  carve(36, 19, 36, 12); // farmhouse
  // Meadow ↔ Forest (two gaps through the tree line).
  carve(20, 27, 20, 68);
  carve(56, 22, 56, 80);
  // Forest network.
  carve(20, 68, 56, 68);
  carve(30, 68, 30, 98);
  carve(30, 98, 14, 98); // ruin portal
  carve(56, 80, 52, 80);
  // Forest ↔ Mines (second river bridge) and the valley floor.
  carve(56, 80, 96, 80);
  carve(96, 80, 96, 70);
  carve(96, 70, 124, 70);
  carve(110, 70, 110, 98);
  carve(110, 98, 128, 98);
  // Town ↔ Mines (pass through the cliffs).
  carve(108, PY1, 108, 70);
  // Town streets.
  carve(PX1, 27, 136, 27);
  carve(108, 10, 108, PY0);

  // ------------------------------------------------------------ props
  const props: Prop[] = [];
  const occupied = new Uint8Array(w * h);
  const isGround = (t: number) => t === T.grass || t === T.meadow || t === T.forest || t === T.highland || t === T.sand;
  const canPlace = (kind: PropKind, x: number, y: number, ground: (t: number) => boolean = isGround, margin = 0) => {
    const s = PROP_SIZE[kind];
    for (let j = -margin; j < s.h + margin; j++) for (let i = -margin; i < s.w + margin; i++) {
      const xx = x + i, yy = y + j;
      if (!inb(xx, yy)) return false;
      if (j >= 0 && j < s.h && i >= 0 && i < s.w) { if (!ground(get(xx, yy)) || occupied[idx(xx, yy)]) return false; }
      else if (s.solid && (get(xx, yy) === T.path || get(xx, yy) === T.bridge) && margin > 0) continue;
    }
    return true;
  };
  const place = (kind: PropKind, x: number, y: number, force = false) => {
    if (!force && !canPlace(kind, x, y)) return false;
    const s = PROP_SIZE[kind];
    for (let j = 0; j < s.h; j++) for (let i = 0; i < s.w; i++) if (inb(x + i, y + j)) occupied[idx(x + i, y + j)] = 1;
    props.push({ kind, tx: x, ty: y, v: rng.int(4) });
    return true;
  };
  const nearPath = (x: number, y: number, r: number) => {
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) { const t = get(x + i, y + j); if (t === T.path || t === T.bridge || t === T.plaza) return true; }
    return false;
  };

  // Landmarks.
  place("castle", hq.tx - 5, PY0 - 3, true);
  for (let y = PY0 - 3; y < PY0 + 2; y++) for (let x = hq.tx - 5; x <= hq.tx + 5; x++) if (get(x, y) !== T.plaza) set(x, y, T.plaza);
  place("fountain", hq.tx - 1, 28, true);
  for (const [x, y] of [[98, 20], [118, 20], [98, 35], [118, 35], [103, 31], [113, 31]] as const) place("lamp", x, y, true);
  for (const [x, y] of [[100, 30], [115, 30], [101, 24]] as const) place("stall", x, y, true);
  place("banner", hq.tx - 7, 20, true);
  place("banner", hq.tx + 7, 20, true);
  for (const [x, y] of [[124, 18], [126, 31], [86, 12], [130, 40]] as const) if (canPlace("house", x, y)) place("house", x, y);
  place("well", 88, 33);
  place("farmhouse", 31, 13);
  place("windmill", 8, 13);
  place("stall", 32, 18); place("stall", 25, 18);
  for (let x = 40; x <= 55; x++) for (let y = 9; y <= 17; y++) if ((y - 9) % 2 === 0 && x % 1 === 0) props.push({ kind: "crop", tx: x, ty: y, v: (x * 7 + y) % 4 });
  for (let x = 39; x <= 56; x++) { place("fence_h", x, 8, true); if (x !== 40 && x !== 41) place("fence_h", x, 18, true); }
  for (let y = 9; y <= 17; y++) { place("fence_v", 39, y, true); place("fence_v", 56, y, true); }
  for (let x = 30; x <= 33; x++) if (get(x, 30) === T.water || get(x, 30) === T.shallow) { set(x, 30, T.bridge); props.push({ kind: "dock", tx: x, ty: 30, v: 0 }); }
  place("hay", 45, 20); place("hay", 47, 21);
  for (const [x, y] of [[29, 15], [30, 16], [57, 20]] as const) place("barrel", x, y);
  for (const [x, y] of [[96, 25], [118, 25]] as const) place("wagon", x, y, true);
  for (const [x, y] of [[114, 92], [115, 93]] as const) place("barrel", x, y);
  place("portal", 12, 94, true);
  place("mine", 112, 63, true);
  for (let x = 96; x <= 124; x += 1) if (get(x, 72) !== T.rock) props.push({ kind: "rail", tx: x, ty: 72, v: 0 });
  place("cart", 102, 72, true); place("cart", 118, 72, true);
  place("smithy", 116, 90);
  for (const [x, y] of [[121, 93], [122, 93], [114, 66], [117, 66]] as const) place("crate", x, y);

  // Scatter.
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const t = get(x, y), a = areaAt(x, y), r = rng.float();
    if (occupied[idx(x, y)] || nearPath(x, y, 0)) continue;
    if (a === A.forest) {
      if (t === T.forest && r < 0.2 && !nearPath(x, y, 1)) place(r < 0.08 ? "pine" : "tree", x, y);
      else if (t === T.meadow && r < 0.18) props.push({ kind: "purpleflower", tx: x, ty: y, v: rng.int(4) });
      else if (r > 0.985) place("mushroom", x, y);
      else if (r > 0.975 && t === T.forest) place("stone", x, y);
    } else if (a === A.meadow) {
      if (t === T.grass && r < 0.035 && !nearPath(x, y, 1)) place("tree", x, y);
      else if (t === T.grass && r < 0.05) place("bush", x, y);
      else if ((t === T.meadow || t === T.grass) && r > 0.93) props.push({ kind: "flower", tx: x, ty: y, v: rng.int(4) });
      else if (r > 0.992 && t === T.grass) place("boulder", x, y);
    } else if (a === A.town) {
      if (t === T.grass && r < 0.05 && !nearPath(x, y, 1)) place(r < 0.015 ? "pine" : "tree", x, y);
      else if (t === T.grass && r < 0.065) place("bush", x, y);
      else if (r > 0.95 && (t === T.grass || t === T.meadow)) props.push({ kind: "flower", tx: x, ty: y, v: rng.int(4) });
    } else {
      if (t === T.highland && r < 0.025) place("boulder", x, y);
      else if (t === T.highland && r < 0.035) place("crystal", x, y);
      else if (t === T.highland && r < 0.04) place("deadtree", x, y);
      else if (t === T.highland && r < 0.047 && !nearPath(x, y, 1)) place("pine", x, y);
    }
  }
  // Dense tree line between Meadow and Forest (path gaps stay open).
  for (let x = 1; x < riverX(AREA_H) - 2; x++) for (let k = -1; k <= 1; k++) {
    const y = splitY(x) + k;
    if (!nearPath(x, y, 0)) place(rng.int(2) ? "pine" : "tree", x, y);
  }
  // Glowing crystals around the ruin portal.
  for (const [x, y] of [[10, 93], [16, 95], [11, 97], [17, 92]] as const) place("glowcrystal", x, y);

  // ------------------------------------------------------------ nodes
  const nodes: ResourceNodeDef[] = [];
  const nextToWater = (x: number, y: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([i, j]) => { const t = get(x + i!, y + j!); return t === T.shallow || t === T.water; });
  const addNodes = (resource: Resource, count: number, inArea: number, ok: (x: number, y: number, t: number) => boolean) => {
    let tries = 0, made = 0;
    const base = nodes.filter((n) => n.resource === resource).length;
    while (made < count && tries++ < 20000) {
      const x = rng.range(2, w - 3), y = rng.range(2, h - 3);
      if (areaAt(x, y) !== inArea || occupied[idx(x, y)] || nearPath(x, y, 0)) continue;
      if (!ok(x, y, get(x, y))) continue;
      if (nodes.some((n) => Math.abs(n.tx - x) + Math.abs(n.ty - y) < 6)) continue;
      // Needs a free standing spot beside it.
      if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([i, j]) => !BLOCKED.has(get(x + i!, y + j!)) && !occupied[idx(x + i!, y + j!)])) continue;
      nodes.push({ id: `${resource}-${base + made + 1}`, resource, tx: x, ty: y });
      occupied[idx(x, y)] = 1;
      made++;
    }
  };
  const ground = (t: number) => t === T.grass || t === T.sand || t === T.meadow || t === T.forest;
  addNodes("fish", 7, A.meadow, (x, y, t) => ground(t) && nextToWater(x, y));
  addNodes("herbs", 6, A.meadow, (_x, _y, t) => t === T.meadow || t === T.grass);
  addNodes("wood", 3, A.meadow, (_x, _y, t) => t === T.grass);
  addNodes("herbs", 2, A.town, (_x, _y, t) => t === T.meadow || t === T.grass);
  addNodes("fish", 2, A.town, (x, y, t) => ground(t) && nextToWater(x, y));
  addNodes("wood", 8, A.forest, (_x, _y, t) => t === T.forest);
  addNodes("herbs", 6, A.forest, (_x, _y, t) => t === T.meadow || t === T.forest);
  addNodes("fish", 4, A.forest, (x, y, t) => ground(t) && nextToWater(x, y));
  addNodes("minerals", 12, A.mines, (_x, _y, t) => t === T.highland);
  addNodes("wood", 2, A.mines, (_x, _y, t) => t === T.highland);

  // ------------------------------------------------------------ blocked
  const blocked = new Uint8Array(w * h);
  for (let i = 0; i < tiles.length; i++) blocked[i] = BLOCKED.has(tiles[i]!) ? 1 : 0;
  for (const p of props) {
    const s = PROP_SIZE[p.kind];
    if (!s.solid) continue;
    for (let j = 0; j < s.h; j++) for (let i = 0; i < s.w; i++) if (inb(p.tx + i, p.ty + j)) blocked[idx(p.tx + i, p.ty + j)] = 1;
  }
  for (const n of nodes) blocked[idx(n.tx, n.ty)] = 1;

  const pois: Poi[] = [
    { id: "hq", label: "HQ Castle", tx: hq.tx, ty: PY0 + 4 },
    { id: "town_west", label: "West Bridge", tx: PX0 - 2, ty: 27 },
    { id: "town_south", label: "South Gate", tx: 108, ty: 44 },
    { id: "meadow", label: "Cozy Meadow", tx: 40, ty: 23 },
    { id: "lake", label: "Meadow Lake", tx: 34, ty: 27 },
    { id: "farm", label: "Sunny Farm", tx: 37, ty: 19 },
    { id: "windmill", label: "Old Windmill", tx: 13, ty: 22 },
    { id: "forest_gate", label: "Forest Trail", tx: 20, ty: 62 },
    { id: "forest", label: "Enchanted Forest", tx: 30, ty: 75 },
    { id: "pond", label: "Moonlit Pond", tx: 31, ty: 86 },
    { id: "ruins", label: "Paw Ruins", tx: 18, ty: 98 },
    { id: "forest_east", label: "Mossy Bridge", tx: 60, ty: 80 },
    { id: "mines", label: "Mining Valley", tx: 108, ty: 74 },
    { id: "mine", label: "Old Mine", tx: 113, ty: 70 },
    { id: "smithy", label: "Forge", tx: 118, ty: 98 },
    { id: "valley_west", label: "Valley Rails", tx: 97, ty: 76 },
  ];
  return { w, h, tiles, area, nodes, pois, hq, props, blocked };
}

export function areaAt(world: WorldDef, px: number, py: number): (typeof AREAS)[number] {
  const tx = Math.max(0, Math.min(world.w - 1, Math.floor(px / TILE)));
  const ty = Math.max(0, Math.min(world.h - 1, Math.floor(py / TILE)));
  return AREAS[world.area[ty * world.w + tx]!]!;
}

export function walkable(world: WorldDef, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) return false;
  return world.blocked[ty * world.w + tx] === 0;
}

export const TILE = ECONOMY.world.tileSize;
export const tileCenter = (t: number) => t * TILE + TILE / 2;
export const toTile = (px: number) => Math.floor(px / TILE);

/** 8-directional A* without corner cutting. Returns tile path excluding start. */
export function findPath(world: WorldDef, sx: number, sy: number, gx: number, gy: number, maxNodes = 40000): Array<[number, number]> | null {
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
