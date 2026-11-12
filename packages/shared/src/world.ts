/**
 * The Catchami world: three areas joined by narrow gates.
 *  - Paw Village (centre): the safe starting town with HQ. No battles, nothing
 *    to gather. Four roads leave the plaza: west to the forest and east to the
 *    mines are open; north and south are barricaded for future areas.
 *  - Whispering Forest (west): wood, fish and herbs. Battles allowed.
 *  - Mining Valley (east): minerals (stone). Battles allowed.
 * Generated on the server from a fixed seed and sent to clients as a tile
 * grid, so collision and rendering always agree. Props are deterministic.
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
  { id: "village", name: "Paw Village", battles: false },
  { id: "forest", name: "Whispering Forest", battles: true },
  { id: "mines", name: "Mining Valley", battles: true },
] as const;
export type AreaId = (typeof AREAS)[number]["id"];

export interface ResourceNodeDef { id: string; resource: Resource; tx: number; ty: number }
export interface Poi { id: string; label: string; tx: number; ty: number }

export type PropKind =
  | "tree" | "pine" | "bush" | "boulder" | "flower" | "purpleflower" | "mushroom" | "crop" | "hay"
  | "farmhouse" | "windmill" | "stall" | "fence_h" | "fence_v" | "dock"
  | "castle" | "fountain" | "lamp" | "house" | "banner" | "well"
  | "mine" | "cart" | "rail" | "crystal" | "smithy" | "crate" | "deadtree"
  | "portal" | "stone" | "glowcrystal" | "barrel" | "wagon" | "barricade" | "signpost"
  | "forestgate" | "minegate" | "noticeboard";

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
  barricade: { w: 4, h: 1, solid: true }, signpost: { w: 1, h: 1, solid: true },
  // Gate arches straddle the road, so they never block it.
  forestgate: { w: 3, h: 1, solid: false }, minegate: { w: 3, h: 1, solid: false }, noticeboard: { w: 2, h: 1, solid: true },
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

/** Column ranges of the three areas: forest | village | mines. */
export const FOREST_W = 72;
export const VILLAGE_W = 48;
export const MINES_W = 72;
export const WORLD_W = FOREST_W + VILLAGE_W + MINES_W;
export const WORLD_H = 60;
export const VILLAGE_X0 = FOREST_W;
export const MINES_X0 = FOREST_W + VILLAGE_W;
/** Row of the east/west gate roads. */
export const GATE_Y = 29;
export const WORLD_SEED = "catchami-world-v3";

/** Tile bounds [x0, y0, x1, y1) of each area, for cameras and minimaps. */
export const AREA_BOUNDS: Record<AreaId, [number, number, number, number]> = {
  forest: [0, 0, FOREST_W, WORLD_H],
  village: [VILLAGE_X0, 0, MINES_X0, WORLD_H],
  mines: [MINES_X0, 0, WORLD_W, WORLD_H],
};

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
  const A = { village: 0, forest: 1, mines: 2 } as const;
  const areaOfX = (x: number) => (x < VILLAGE_X0 ? A.forest : x < MINES_X0 ? A.village : A.mines);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) area[idx(x, y)] = areaOfX(x);
  const areaAt = (x: number, y: number) => area[idx(Math.max(0, Math.min(w - 1, x)), Math.max(0, Math.min(h - 1, y)))]!;

  // Base terrain per area.
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = areaAt(x, y);
    const n = n2(x, y) * 0.6 + n3(x, y) * 0.4;
    let t: Tile = T.grass;
    if (a === A.village) t = n > 0.66 ? T.meadow : T.grass;
    else if (a === A.forest) t = n > 0.64 ? T.meadow : T.forest;
    else t = n > 0.78 && n1(x, y) > 0.55 ? T.rock : T.highland;
    set(x, y, t);
  }
  // Outer rim and the cliff walls between areas (gates are carved by the roads).
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const rim = x < 2 || y < 2 || x >= w - 2 || y >= h - 2;
    const wob = Math.round((n1(x, y) - 0.5) * 2);
    const wall = Math.abs(x - VILLAGE_X0 - wob) <= 1 || Math.abs(x - MINES_X0 - wob) <= 1;
    if (rim || wall) set(x, y, T.rock);
  }

  // Water: a forest lake fed by a stream, a small pond, and the village pond.
  const blob = (cx: number, cy: number, rx: number, ry: number, sandy = true) => {
    for (let y = cy - ry - 3; y <= cy + ry + 3; y++) for (let x = cx - rx - 3; x <= cx + rx + 3; x++) {
      if (!inb(x, y) || get(x, y) === T.rock) continue;
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      const d = dx * dx + dy * dy + (n3(x, y) - 0.5) * 0.3;
      if (d < 0.6) set(x, y, T.water);
      else if (d < 0.85) set(x, y, T.shallow);
      else if (sandy && d < 1.1 && get(x, y) !== T.water && get(x, y) !== T.shallow) set(x, y, T.sand);
    }
  };
  blob(22, 42, 10, 7);
  for (let y = 2; y < 36; y++) { const sx = 24 + Math.round((n1(30, y) - 0.5) * 8); set(sx, y, T.water); set(sx + 1, y, T.shallow); set(sx - 1, y, T.shallow); }
  blob(52, 10, 5, 3);
  blob(96, 47, 4, 2, false);

  // Village plaza (cobblestone); HQ castle on its north side.
  const hq = { tx: 96, ty: 20 };
  const PX0 = 84, PX1 = 108, PY0 = 18, PY1 = 40;
  for (let y = PY0; y <= PY1; y++) for (let x = PX0; x <= PX1; x++) {
    const corner = (x - PX0 < 2 || PX1 - x < 2) && (y - PY0 < 2 || PY1 - y < 2);
    if (!corner) set(x, y, T.plaza);
  }

  // Roads (L-shaped; crossings become bridges, cliffs become gate passes).
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
  // Village: the four roads.
  carve(PX0, GATE_Y, VILLAGE_X0 - 6, GATE_Y); // west gate -> forest
  carve(PX1, GATE_Y, MINES_X0 + 6, GATE_Y); // east gate -> mines
  carve(104, PY0, 104, 3); // north road (closed)
  carve(96, PY1, 96, h - 3); // south road (closed)
  // Forest trails.
  carve(VILLAGE_X0 - 6, GATE_Y, 40, GATE_Y);
  carve(40, GATE_Y, 40, 14);
  carve(40, 14, 12, 14); // ruins
  carve(40, GATE_Y, 40, 50);
  carve(40, 46, 33, 46); // lake shore
  carve(40, 14, 48, 14, 1);
  // Mining Valley roads.
  carve(MINES_X0 + 6, GATE_Y, 142, GATE_Y);
  carve(142, GATE_Y, 142, 14);
  carve(142, 14, 152, 14); // old mine
  carve(142, GATE_Y, 172, GATE_Y);
  carve(172, GATE_Y, 172, 45); // forge
  carve(172, 45, 184, 45, 1);

  // ------------------------------------------------------------ props
  const props: Prop[] = [];
  const occupied = new Uint8Array(w * h);
  const isGround = (t: number) => t === T.grass || t === T.meadow || t === T.forest || t === T.highland || t === T.sand;
  const canPlace = (kind: PropKind, x: number, y: number) => {
    const sz = PROP_SIZE[kind];
    for (let j = 0; j < sz.h; j++) for (let i = 0; i < sz.w; i++) {
      const xx = x + i, yy = y + j;
      if (!inb(xx, yy) || !isGround(get(xx, yy)) || occupied[idx(xx, yy)]) return false;
    }
    return true;
  };
  const place = (kind: PropKind, x: number, y: number, force = false) => {
    if (!force && !canPlace(kind, x, y)) return false;
    const sz = PROP_SIZE[kind];
    for (let j = 0; j < sz.h; j++) for (let i = 0; i < sz.w; i++) if (inb(x + i, y + j)) occupied[idx(x + i, y + j)] = 1;
    props.push({ kind, tx: x, ty: y, v: rng.int(4) });
    return true;
  };
  const nearPath = (x: number, y: number, r: number) => {
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) { const t = get(x + i, y + j); if (t === T.path || t === T.bridge || t === T.plaza) return true; }
    return false;
  };

  // Village landmarks.
  place("castle", hq.tx - 5, PY0 - 3, true);
  for (let y = PY0 - 3; y < PY0 + 2; y++) for (let x = hq.tx - 5; x <= hq.tx + 5; x++) if (get(x, y) !== T.plaza) set(x, y, T.plaza);
  place("fountain", hq.tx - 1, 28, true);
  for (const [x, y] of [[87, 22], [105, 22], [87, 37], [105, 37], [91, 33], [101, 33]] as const) place("lamp", x, y, true);
  for (const [x, y] of [[88, 35], [102, 35], [88, 25]] as const) place("stall", x, y, true);
  place("banner", hq.tx - 7, PY0 + 1, true);
  place("banner", hq.tx + 7, PY0 + 1, true);
  for (const [x, y] of [[76, 8], [110, 7], [76, 44], [111, 43], [77, 18], [112, 18]] as const) place("house", x, y);
  place("well", 80, 36);
  for (const [x, y] of [[90, 26], [101, 26]] as const) place("wagon", x, y, true);
  for (const [x, y] of [[81, 33], [82, 33], [110, 35]] as const) place("barrel", x, y);
  // Closed roads: barricades with signposts.
  place("barricade", 103, 6, true); place("signpost", 101, 7, true);
  place("barricade", 95, 53, true); place("signpost", 99, 52, true);
  // Gate signposts.
  place("signpost", VILLAGE_X0 + 4, GATE_Y - 1, true);
  place("signpost", MINES_X0 - 5, GATE_Y - 1, true);

  // Forest landmarks.
  place("portal", 10, 10, true);
  for (const [x, y] of [[8, 13], [14, 9], [9, 8], [15, 12]] as const) place("glowcrystal", x, y);
  for (let x = 30; x <= 33; x++) if (get(x, 46) === T.bridge) props.push({ kind: "dock", tx: x, ty: 46, v: 0 });
  for (const [x, y] of [[44, 27], [45, 32]] as const) place("crate", x, y);

  // Mining Valley landmarks.
  place("mine", 150, 10, true);
  for (let x = MINES_X0 + 6; x <= w - 6; x++) if (get(x, 24) !== T.rock && get(x, 24) !== T.path) props.push({ kind: "rail", tx: x, ty: 24, v: 0 });
  place("cart", 132, 24, true); place("cart", 160, 24, true);
  place("smithy", 170, 47);
  for (const [x, y] of [[176, 44], [177, 44], [146, 12], [149, 16]] as const) place("crate", x, y);
  for (const [x, y] of [[168, 44], [175, 49]] as const) place("barrel", x, y);

  // Scatter.
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    const t = get(x, y), a = areaAt(x, y), r = rng.float();
    if (occupied[idx(x, y)] || nearPath(x, y, 0)) continue;
    if (a === A.forest) {
      if (t === T.forest && r < 0.22 && !nearPath(x, y, 1)) place(r < 0.09 ? "pine" : "tree", x, y);
      else if (t === T.meadow && r < 0.18) props.push({ kind: "purpleflower", tx: x, ty: y, v: rng.int(4) });
      else if (r > 0.985) place("mushroom", x, y);
      else if (r > 0.975 && t === T.forest) place("stone", x, y);
    } else if (a === A.village) {
      const inPlaza = x >= PX0 - 1 && x <= PX1 + 1 && y >= PY0 - 4 && y <= PY1 + 1;
      if (inPlaza) continue;
      if (t === T.grass && r < 0.06 && !nearPath(x, y, 1)) place(r < 0.02 ? "pine" : "tree", x, y);
      else if (t === T.grass && r < 0.08) place("bush", x, y);
      else if ((t === T.grass || t === T.meadow) && r > 0.9) props.push({ kind: "flower", tx: x, ty: y, v: rng.int(4) });
    } else {
      if (t === T.highland && r < 0.022) place("boulder", x, y);
      else if (t === T.highland && r < 0.032) place("crystal", x, y);
      else if (t === T.highland && r < 0.037) place("deadtree", x, y);
      else if (t === T.highland && r < 0.044 && !nearPath(x, y, 1)) place("pine", x, y);
    }
  }

  // Gate arches where the roads pass through the cliff walls, and the plaza notice board.
  props.push({ kind: "forestgate", tx: VILLAGE_X0 - 1, ty: GATE_Y + 1, v: 0 });
  props.push({ kind: "minegate", tx: MINES_X0 - 1, ty: GATE_Y + 1, v: 0 });
  props.push({ kind: "noticeboard", tx: 104, ty: 31, v: 0 });

  // ------------------------------------------------------------ blocked (before nodes, for the reachability check)
  const blocked = new Uint8Array(w * h);
  for (let i = 0; i < tiles.length; i++) blocked[i] = BLOCKED.has(tiles[i]!) ? 1 : 0;
  for (const p of props) {
    const sz = PROP_SIZE[p.kind];
    if (!sz.solid) continue;
    for (let j = 0; j < sz.h; j++) for (let i = 0; i < sz.w; i++) if (inb(p.tx + i, p.ty + j)) blocked[idx(p.tx + i, p.ty + j)] = 1;
  }
  // Everything a pet can reach from HQ.
  const reach = new Uint8Array(w * h);
  {
    const start = idx(hq.tx, PY0 + 4);
    const q = [start];
    reach[start] = 1;
    while (q.length) {
      const c = q.pop()!;
      const x = c % w, y = (c - x) / w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (!inb(nx, ny)) continue;
        const k = idx(nx, ny);
        if (!reach[k] && !blocked[k]) { reach[k] = 1; q.push(k); }
      }
    }
  }

  // ------------------------------------------------------------ nodes (the village has none)
  const nodes: ResourceNodeDef[] = [];
  const nextToWater = (x: number, y: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([i, j]) => { const t = get(x + i!, y + j!); return t === T.shallow || t === T.water; });
  const addNodes = (resource: Resource, count: number, inArea: number, ok: (x: number, y: number, t: number) => boolean) => {
    let tries = 0, made = 0;
    const base = nodes.filter((n) => n.resource === resource).length;
    while (made < count && tries++ < 40000) {
      const x = rng.range(3, w - 4), y = rng.range(3, h - 4);
      if (areaAt(x, y) !== inArea || occupied[idx(x, y)] || blocked[idx(x, y)] || nearPath(x, y, 0)) continue;
      if (!ok(x, y, get(x, y))) continue;
      if (nodes.some((n) => Math.abs(n.tx - x) + Math.abs(n.ty - y) < 5)) continue;
      // Needs a reachable standing spot beside it.
      if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([i, j]) => reach[idx(x + i!, y + j!)])) continue;
      nodes.push({ id: `${resource}-${base + made + 1}`, resource, tx: x, ty: y });
      occupied[idx(x, y)] = 1;
      made++;
    }
  };
  const ground = (t: number) => t === T.grass || t === T.sand || t === T.meadow || t === T.forest;
  addNodes("wood", 11, A.forest, (_x, _y, t) => t === T.forest);
  addNodes("herbs", 9, A.forest, (_x, _y, t) => t === T.meadow || t === T.forest);
  addNodes("fish", 8, A.forest, (x, y, t) => ground(t) && nextToWater(x, y));
  addNodes("minerals", 15, A.mines, (_x, _y, t) => t === T.highland);
  for (const n of nodes) blocked[idx(n.tx, n.ty)] = 1;

  const pois: Poi[] = [
    { id: "hq", label: "HQ Castle", tx: hq.tx, ty: PY0 + 4 },
    { id: "village_west", label: "West Gate", tx: VILLAGE_X0 + 6, ty: GATE_Y },
    { id: "village_east", label: "East Gate", tx: MINES_X0 - 6, ty: GATE_Y },
    { id: "village_north", label: "North Road · closed", tx: 104, ty: 9 },
    { id: "village_south", label: "South Road · closed", tx: 96, ty: 50 },
    { id: "forest_gate", label: "Forest Trail", tx: VILLAGE_X0 - 6, ty: GATE_Y },
    { id: "forest", label: "Whispering Forest", tx: 40, ty: GATE_Y },
    { id: "lake", label: "Moonlit Lake", tx: 34, ty: 46 },
    { id: "ruins", label: "Paw Ruins", tx: 14, ty: 14 },
    { id: "mines_gate", label: "Valley Pass", tx: MINES_X0 + 6, ty: GATE_Y },
    { id: "mines", label: "Mining Valley", tx: 142, ty: GATE_Y },
    { id: "mine", label: "Old Mine", tx: 152, ty: 14 },
    { id: "smithy", label: "Forge", tx: 172, ty: 44 },
  ];
  return { w, h, tiles, area, nodes, pois, hq, props, blocked };
}

/** Whether battles are allowed at a pixel position (the village is a safe zone). */
export function battlesAllowed(world: WorldDef, px: number, py: number): boolean {
  return areaAt(world, px, py).battles;
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
