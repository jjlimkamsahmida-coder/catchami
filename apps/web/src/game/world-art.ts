/**
 * World art for the four areas — original procedural illustration in the
 * Catchami style (ink outlines, warm cel shading, 3/4 top-down). The map is
 * painted in chunks so huge areas stay cheap on phones. Any prop key can be
 * replaced by final artwork through public/assets/manifest.json ("prop-<kind>").
 */
import { PROP_SIZE, T, type Prop, type PropKind, type WorldDef } from "@catchami/shared";

export const INK = "#2b1d3a";
const TS = 32;

type Ctx = CanvasRenderingContext2D;
const cnv = (w: number, h: number): [HTMLCanvasElement, Ctx] => { const c = document.createElement("canvas"); c.width = w; c.height = h; return [c, c.getContext("2d")!]; };
const circle = (g: Ctx, x: number, y: number, r: number, f: string) => { g.fillStyle = f; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
const ell = (g: Ctx, x: number, y: number, rx: number, ry: number, f: string) => { g.fillStyle = f; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); };
const rect = (g: Ctx, x: number, y: number, w: number, h: number, f: string) => { g.fillStyle = f; g.fillRect(x, y, w, h); };
const poly = (g: Ctx, pts: number[][], f: string) => { g.fillStyle = f; g.beginPath(); g.moveTo(pts[0]![0]!, pts[0]![1]!); for (const p of pts.slice(1)) g.lineTo(p[0]!, p[1]!); g.closePath(); g.fill(); };
/** Shape drawn twice: ink outline then fill. */
const inked = (g: Ctx, draw: (pad: number, fill: string) => void, fill: string, pad = 3) => { draw(pad, INK); draw(0, fill); };
const hash = (x: number, y: number, k = 0) => { let h = (x * 374761393 + y * 668265263 + k * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; h ^= h >>> 16; return ((h >>> 0) % 100000) / 100000; };

// Area palettes: [base, dark, light, alt] for walkable ground.
const PAL = {
  village: { grass: "#89cf5d", dark: "#6bb846", light: "#ade277", alt: "#9fd86a" },
  glade: { grass: "#8fd96a", dark: "#71c652", light: "#b6ec8c", alt: "#a5e27c" },
  forest: { grass: "#58b673", dark: "#3f9a5c", light: "#7ccd8c", alt: "#6cc27c" },
  mines: { grass: "#dcbd8b", dark: "#c29d69", light: "#ead3a6", alt: "#e3c697" },
};
const AREA_KEYS = ["village", "forest", "mines", "glade"] as const;
const WATER = "#4cb3e6", DEEP = "#3a96d6", SHALLOW = "#82d8ea", SAND = "#f2d89a", SAND_DK = "#d7b26a";
const EARTH = "#b07a4c", EARTH_DK = "#875735", ROCK = "#9d8ca2", ROCK_DK = "#6e5c78", ROCK_LT = "#c2b4c6";
const PATH = "#e8cb8e", PATH_DK = "#c9a467", COBBLE = "#ddd2bf", COBBLE_DK = "#bfb19a";

/** Paint tiles [x0,x0+cw)×[y0,y0+ch) into a canvas, including flat decals (flowers, crops, rails, docks). */
export type GroundTex = Partial<Record<"grass" | "forest" | "dirt" | "cobble", HTMLImageElement>>;

export function paintChunk(world: WorldDef, x0: number, y0: number, cw: number, ch: number, decals: Prop[], tex: GroundTex = {}): HTMLCanvasElement {
  const [c, g] = cnv(cw * TS, ch * TS);
  g.translate(-x0 * TS, -y0 * TS);
  // Seamless generated ground textures, anchored to world space so chunks line up.
  const pattern = (img?: HTMLImageElement) => {
    if (!img) return null;
    const pt = g.createPattern(img, "repeat");
    pt?.setTransform(new DOMMatrix().scale(0.5));
    return pt;
  };
  const pats = { grass: pattern(tex.grass), forest: pattern(tex.forest), dirt: pattern(tex.dirt), cobble: pattern(tex.cobble) };
  const groundFill = (x: number, y: number): string | CanvasPattern => {
    const a = AREA_KEYS[area[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))]!]!;
    const pt = a === "forest" ? pats.forest : a === "mines" ? pats.dirt : pats.grass;
    return pt ?? PAL[a].grass;
  };
  const { w, h, tiles, area } = world;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? T.rock : tiles[y * w + x]!);
  const pal = (x: number, y: number) => PAL[AREA_KEYS[area[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))]!]!];
  const isWater = (t: number) => t === T.water || t === T.shallow;
  const M = 3;
  const each = (pred: (t: number, x: number, y: number) => boolean, fn: (x: number, y: number) => void) => {
    for (let y = y0 - M; y < y0 + ch + M; y++) for (let x = x0 - M; x < x0 + cw + M; x++) if (pred(at(x, y), x, y)) fn(x, y);
  };
  const cx = (t: number) => t * TS + TS / 2;
  const edge = (x: number, y: number, pred: (t: number) => boolean) => [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dy]) => !pred(at(x + dx!, y + dy!)));
  const fillOrBlob = (x: number, y: number, pred: (t: number) => boolean, r: number, col: string | CanvasPattern, oy = 0) => {
    g.fillStyle = col;
    if (edge(x, y, pred)) { g.beginPath(); g.arc(cx(x), cx(y) + oy, TS * r, 0, Math.PI * 2); g.fill(); }
    else g.fillRect(x * TS - 1, y * TS - 1 + oy, TS + 2, TS + 2);
  };
  const textured = !!(pats.grass || pats.forest);

  // Water.
  rect(g, (x0 - M) * TS, (y0 - M) * TS, (cw + 2 * M) * TS, (ch + 2 * M) * TS, WATER);
  each((t) => t === T.water, (x, y) => { if (!edge(x, y, (t) => t === T.water)) circle(g, cx(x), cx(y), TS * 0.8, DEEP); });
  each((t) => t === T.shallow, (x, y) => circle(g, cx(x), cx(y), TS * 0.72, SHALLOW));

  // Land with an earth bank facing the viewer (offset down), ink line, then sand/grass.
  const land = (t: number) => !isWater(t);
  each(land, (x, y) => { if (edge(x, y, land)) { circle(g, cx(x), cx(y) + 12, TS * 0.74, INK); circle(g, cx(x), cx(y) + 9, TS * 0.68, EARTH_DK); circle(g, cx(x), cx(y) + 5, TS * 0.68, EARTH); } });
  each(land, (x, y) => fillOrBlob(x, y, land, 0.74, INK, 1));
  each(land, (x, y) => fillOrBlob(x, y, land, 0.68, SAND_DK, -1));
  each(land, (x, y) => fillOrBlob(x, y, land, 0.64, SAND, -2));
  const grassy = (t: number) => land(t) && t !== T.sand;
  each(grassy, (x, y) => fillOrBlob(x, y, grassy, 0.6, groundFill(x, y), -2));
  // Lighter meadow patches.
  if (textured) {
    // One path, one fill: overlapping tiles must not stack a translucent tint.
    g.beginPath();
    each((t) => t === T.meadow, (x, y) => {
      if (edge(x, y, (t) => t === T.meadow)) { g.moveTo(cx(x) + TS * 0.7, cx(y)); g.arc(cx(x), cx(y), TS * 0.7, 0, Math.PI * 2); }
      else g.rect(x * TS - 1, y * TS - 1, TS + 2, TS + 2);
    });
    g.fillStyle = "rgba(214,255,150,0.16)";
    g.fill("nonzero");
  } else each((t) => t === T.meadow, (x, y) => fillOrBlob(x, y, (t) => t === T.meadow, 0.7, pal(x, y).alt));
  // Mining ground & cliffs.
  each((t) => t === T.highland, (x, y) => fillOrBlob(x, y, (t) => t === T.highland || t === T.rock, 0.66, pats.dirt ?? pal(x, y).grass));
  // Cliffs: a flat stone top with a darker front face where the cliff drops, crisp ink edges.
  const isRock = (t: number) => t === T.rock;
  each(isRock, (x, y) => {
    const X = x * TS, Y = y * TS;
    rect(g, X - 1, Y - 1, TS + 2, TS + 2, ROCK);
    // Soft top highlight and tidy brick-like seams.
    rect(g, X, Y + 2, TS, 5, ROCK_LT);
    g.fillStyle = "rgba(43,29,58,0.12)";
    if ((x + y) % 2 === 0) g.fillRect(X + 15, Y + 9, 2, 12); else g.fillRect(X + 4, Y + 16, 2, 10);
  });
  each(isRock, (x, y) => {
    const X = x * TS, Y = y * TS;
    g.fillStyle = INK;
    if (!isRock(at(x, y - 1))) g.fillRect(X - 1, Y - 2, TS + 2, 3);
    if (!isRock(at(x - 1, y))) g.fillRect(X - 2, Y - 1, 3, TS + 2);
    if (!isRock(at(x + 1, y))) g.fillRect(X + TS - 1, Y - 1, 3, TS + 2);
    if (!isRock(at(x, y + 1))) {
      // Front face of the cliff.
      rect(g, X - 1, Y + TS - 12, TS + 2, 12, ROCK_DK);
      rect(g, X - 1, Y + TS - 13, TS + 2, 2, INK);
      rect(g, X - 1, Y + TS - 1, TS + 2, 3, INK);
      g.fillStyle = "rgba(255,255,255,0.18)";
      g.fillRect(X + 6 + hash(x, y, 3) * 14, Y + TS - 9, 5, 2);
    }
  });
  // Grass blades, stones, pebbles.
  g.lineCap = "round";
  if (!textured) each((t) => t === T.grass || t === T.meadow || t === T.forest, (x, y) => {
    const p = pal(x, y);
    for (let k = 0; k < 3; k++) {
      if (hash(x, y, 10 + k) > 0.5) continue;
      const px = x * TS + 4 + hash(x, y, 20 + k) * 24, py = y * TS + 8 + hash(x, y, 30 + k) * 20;
      g.strokeStyle = p.dark; g.lineWidth = 2;
      g.beginPath(); g.moveTo(px - 3, py); g.lineTo(px - 1, py - 6); g.moveTo(px + 1, py); g.lineTo(px + 3, py - 7); g.stroke();
    }
    if (hash(x, y, 40) < 0.12) { g.strokeStyle = p.light; g.lineWidth = 2; g.beginPath(); g.moveTo(x * TS + 10, y * TS + 20); g.lineTo(x * TS + 12, y * TS + 13); g.stroke(); }
  });
  if (!pats.dirt) each((t) => t === T.highland, (x, y) => {
    const p = pal(x, y);
    if (hash(x, y, 50) < 0.4) ell(g, x * TS + 6 + hash(x, y, 51) * 20, y * TS + 6 + hash(x, y, 52) * 20, 3.5, 2.4, p.dark);
    if (hash(x, y, 53) < 0.25) ell(g, x * TS + 6 + hash(x, y, 54) * 20, y * TS + 6 + hash(x, y, 55) * 20, 2.5, 1.6, p.light);
  });

  // Farm rows.
  each((t) => t === T.farm, (x, y) => {
    rect(g, x * TS - 1, y * TS - 1, TS + 2, TS + 2, "#a8743f");
    rect(g, x * TS - 1, y * TS + 4, TS + 2, 6, "#8f5f31");
    rect(g, x * TS - 1, y * TS + 20, TS + 2, 6, "#8f5f31");
  });
  // Paths and cobblestone.
  const pathy = (t: number) => t === T.path || t === T.bridge;
  each((t) => t === T.path, (x, y) => circle(g, cx(x), cx(y) + 1, TS * 0.66, PATH_DK));
  each((t) => t === T.path, (x, y) => circle(g, cx(x), cx(y), TS * 0.58, PATH));
  each((t) => t === T.path, (x, y) => { if (hash(x, y, 60) < 0.35) ell(g, x * TS + 8 + hash(x, y, 61) * 16, y * TS + 8 + hash(x, y, 62) * 16, 3, 2, PATH_DK); });
  each((t) => t === T.plaza, (x, y) => fillOrBlob(x, y, (t) => t === T.plaza, 0.7, COBBLE_DK, 1));
  if (pats.cobble) each((t) => t === T.plaza, (x, y) => fillOrBlob(x, y, (t) => t === T.plaza, 0.64, pats.cobble!));
  else each((t) => t === T.plaza, (x, y) => {
    fillOrBlob(x, y, (t) => t === T.plaza, 0.64, COBBLE);
    // Stones: offset rows like real cobble.
    for (let r = 0; r < 2; r++) for (let k = 0; k < 2; k++) {
      const ox = x * TS + k * 16 + (r % 2 ? 8 : 0) - 4, oy = y * TS + r * 16 + 2;
      g.fillStyle = hash(x * 3 + k, y * 3 + r, 70) < 0.5 ? "#e8dfcf" : "#d3c6ae";
      g.beginPath(); g.roundRect(ox + 1.5, oy + 1.5, 13, 12, 4); g.fill();
    }
  });
  // Bridges & docks (planks).
  each((t) => t === T.bridge, (x, y) => {
    const horiz = isWater(at(x, y - 1)) || isWater(at(x, y + 1)) ? pathy(at(x - 1, y)) || pathy(at(x + 1, y)) : false;
    rect(g, x * TS - 1, y * TS + 2, TS + 2, TS + 2, INK);
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? "#c08752" : "#d29a63";
      if (horiz) g.fillRect(x * TS + i * 8, y * TS, 7, TS); else g.fillRect(x * TS, y * TS + i * 8, TS, 7);
    }
    g.fillStyle = "#8c5a33";
    if (horiz) { g.fillRect(x * TS, y * TS, TS, 3); g.fillRect(x * TS, y * TS + TS - 3, TS, 3); }
    else { g.fillRect(x * TS, y * TS, 3, TS); g.fillRect(x * TS + TS - 3, y * TS, 3, TS); }
  });
  // Shore foam.
  each((t) => t === T.shallow, (x, y) => {
    if (edge(x, y, isWater) && hash(x, y, 80) < 0.6) { g.strokeStyle = "rgba(255,255,255,0.6)"; g.lineWidth = 2; g.beginPath(); g.arc(cx(x), cx(y), TS * 0.4, hash(x, y, 81) * 6, hash(x, y, 81) * 6 + 1.3); g.stroke(); }
  });

  // Decals.
  for (const d of decals) {
    if (d.tx < x0 - 2 || d.ty < y0 - 2 || d.tx > x0 + cw + 2 || d.ty > y0 + ch + 2) continue;
    const px = d.tx * TS, py = d.ty * TS;
    if (d.kind === "flower" || d.kind === "purpleflower") {
      const cols = d.kind === "flower" ? ["#ff8fab", "#ffd166", "#ffffff", "#ff9e5e"] : ["#b58cff", "#9b6bf0", "#d2b6ff", "#c48bff"];
      for (let k = 0; k < (d.kind === "purpleflower" ? 3 : 1); k++) {
        const fx = px + 8 + hash(d.tx, d.ty, 90 + k) * 16, fy = py + 8 + hash(d.tx, d.ty, 95 + k) * 16;
        g.strokeStyle = "#3f8f4a"; g.lineWidth = 2; g.beginPath(); g.moveTo(fx, fy + 3); g.lineTo(fx, fy + 9); g.stroke();
        const col = cols[(d.v + k) % cols.length]!;
        for (let p = 0; p < 5; p++) circle(g, fx + Math.cos(p * 1.256) * 3, fy + Math.sin(p * 1.256) * 3, 2.4, col);
        circle(g, fx, fy, 1.8, "#ffcf4d");
      }
    } else if (d.kind === "crop") {
      for (let k = 0; k < 3; k++) {
        const sx = px + 5 + k * 10, sy = py + 12;
        const col = ["#5cbf4a", "#78cc4e", "#4fae45", "#8fd35f"][d.v]!;
        ell(g, sx - 2, sy, 3, 6, col); ell(g, sx + 2, sy, 3, 6, col);
        if (d.v === 3) circle(g, sx, sy + 5, 3, "#ff9a3c");
      }
    } else if (d.kind === "rail") {
      rect(g, px - 1, py + 8, TS + 2, 3, "#6d5a74"); rect(g, px - 1, py + 21, TS + 2, 3, "#6d5a74");
      for (let k = 0; k < 3; k++) rect(g, px + k * 11 + 2, py + 5, 5, 22, "#8a5a36");
      rect(g, px - 1, py + 9, TS + 2, 1.5, "#cfc3d3"); rect(g, px - 1, py + 22, TS + 2, 1.5, "#cfc3d3");
    } else if (d.kind === "mushroom") {
      ell(g, px + 16, py + 22, 6, 3, "rgba(43,29,58,0.25)");
      rect(g, px + 13, py + 14, 6, 9, "#fff1d6");
      ell(g, px + 16, py + 14, 9, 6, INK); ell(g, px + 16, py + 13, 7.5, 4.8, "#ff5d5d");
      circle(g, px + 13, py + 12, 1.5, "#fff"); circle(g, px + 19, py + 13, 1.2, "#fff");
    }
  }
  return c;
}

export const DECAL_KINDS = new Set<PropKind>(["flower", "purpleflower", "crop", "rail", "mushroom", "dock"]);

/** Sprite for a prop; anchored bottom-centre on its footprint. */
export function drawProp(kind: PropKind, v: number): HTMLCanvasElement {
  const s = PROP_SIZE[kind];
  const fw = s.w * TS;
  switch (kind) {
    case "tree": return tree(v);
    case "pine": return pine(v);
    case "bush": return bush(v);
    case "boulder": return boulder();
    case "stone": return mossStone();
    case "hay": return hay();
    case "fence_h": return fence(true);
    case "fence_v": return fence(false);
    case "farmhouse": return farmhouse(fw);
    case "windmill": return windmillBase(fw);
    case "stall": return stall(fw, v);
    case "castle": return castle(fw);
    case "fountain": return fountain(fw);
    case "lamp": return lamp();
    case "house": return house(fw, v);
    case "banner": return banner();
    case "well": return well(fw);
    case "mine": return mine(fw);
    case "cart": return cart();
    case "crystal": return crystal(v, false);
    case "glowcrystal": return crystal(v, true);
    case "smithy": return smithy(fw);
    case "crate": return crate();
    case "deadtree": return deadtree();
    case "portal": return portal(fw);
    case "barricade": return barricade(fw);
    case "signpost": return signpost();
    default: { const [c] = cnv(2, 2); return c; }
  }
}

function shadow(g: Ctx, x: number, y: number, rx: number, ry = rx * 0.3) { ell(g, x, y, rx, ry, "rgba(43,29,58,0.24)"); }

function tree(v: number): HTMLCanvasElement {
  const [c, g] = cnv(80, 104);
  shadow(g, 40, 96, 26, 8);
  rect(g, 32, 60, 16, 36, INK); rect(g, 35, 60, 10, 34, "#9a6a42"); rect(g, 35, 60, 4, 34, "#b07e52");
  const greens = [["#58a948", "#78c75c", "#9be07a"], ["#4f9f4f", "#6fbf62", "#94d985"], ["#62b347", "#86cf5e", "#a8e47c"], ["#4aa66b", "#6cc387", "#93dba3"]][v % 4]!;
  const blobs = [[22, 50, 19], [58, 50, 19], [40, 30, 24], [40, 56, 20], [28, 34, 14], [54, 36, 14]] as const;
  for (const [x, y, r] of blobs) circle(g, x, y, r + 3, INK);
  for (const [x, y, r] of blobs) circle(g, x, y, r, greens[0]!);
  for (const [x, y, r] of [[24, 44, 12], [46, 24, 14], [56, 44, 10], [36, 50, 10]] as const) circle(g, x, y - 2, r, greens[1]!);
  for (const [x, y, r] of [[20, 38, 5], [42, 16, 6], [56, 38, 4]] as const) circle(g, x, y, r, greens[2]!);
  if (v === 2) for (const [x, y] of [[28, 50], [50, 32], [44, 58]] as const) { circle(g, x, y, 4, INK); circle(g, x, y, 3, "#ff6f61"); }
  return c;
}

function pine(v: number): HTMLCanvasElement {
  const [c, g] = cnv(64, 100);
  shadow(g, 32, 93, 20, 6);
  rect(g, 27, 74, 10, 20, INK); rect(g, 29, 74, 6, 18, "#8f5f3a");
  const cols = [["#3f8f4a", "#4fa457"], ["#357f52", "#459966"], ["#3e8a43", "#55a85a"], ["#2f7a58", "#3f936e"]][v % 4]!;
  for (let i = 0; i < 4; i++) {
    const y = 10 + i * 17, hw = 12 + i * 6;
    poly(g, [[32, y - 14], [32 + hw + 4, y + 18], [32 - hw - 4, y + 18]], INK);
    poly(g, [[32, y - 10], [32 + hw, y + 15], [32 - hw, y + 15]], cols[i % 2]!);
    poly(g, [[32, y - 10], [32 - hw * 0.4, y + 15], [32 - hw, y + 15]], "rgba(255,255,255,0.12)");
  }
  return c;
}

function bush(v: number): HTMLCanvasElement {
  const [c, g] = cnv(46, 36);
  shadow(g, 23, 31, 18, 5);
  const blobs = [[14, 20, 11], [32, 20, 11], [23, 13, 11]] as const;
  for (const [x, y, r] of blobs) circle(g, x, y, r + 2.5, INK);
  for (const [x, y, r] of blobs) circle(g, x, y, r, v % 2 ? "#5fb34c" : "#6cbf52");
  circle(g, 18, 10, 4, "#94dc72");
  if (v === 3) for (const [x, y] of [[14, 20], [30, 15]] as const) circle(g, x, y, 2.5, "#ff8fab");
  return c;
}

function boulder(): HTMLCanvasElement {
  const [c, g] = cnv(48, 40);
  shadow(g, 24, 35, 19, 5);
  ell(g, 24, 21, 21, 16, INK); ell(g, 24, 20, 18, 13.5, "#a99bad"); ell(g, 24, 24, 17, 8, "#8f8195"); ell(g, 18, 14, 7, 4, "#cfc3d3");
  return c;
}

function mossStone(): HTMLCanvasElement {
  const [c, g] = cnv(44, 40);
  shadow(g, 22, 35, 17, 5);
  ell(g, 22, 22, 18, 15, INK); ell(g, 22, 21, 15.5, 12.5, "#9aa3a0"); ell(g, 22, 13, 14, 6, "#6cc27c"); ell(g, 16, 12, 5, 2.5, "#9be0a3");
  return c;
}

function hay(): HTMLCanvasElement {
  const [c, g] = cnv(40, 36);
  shadow(g, 20, 31, 16, 5);
  g.fillStyle = INK; g.beginPath(); g.roundRect(4, 6, 32, 26, 8); g.fill();
  g.fillStyle = "#f2c95a"; g.beginPath(); g.roundRect(6, 8, 28, 22, 6); g.fill();
  g.strokeStyle = "#d9a83a"; g.lineWidth = 1.5; for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(9 + i * 5, 10); g.lineTo(9 + i * 5, 28); g.stroke(); }
  rect(g, 6, 15, 28, 3, "#b5652d");
  return c;
}

function fence(h: boolean): HTMLCanvasElement {
  const [c, g] = cnv(34, 40);
  if (h) {
    rect(g, 0, 14, 34, 8, INK); rect(g, 0, 16, 34, 4, "#c99159");
    rect(g, 0, 26, 34, 7, INK); rect(g, 0, 27, 34, 4, "#b07e4c");
    rect(g, 12, 8, 10, 30, INK); rect(g, 14, 10, 6, 26, "#d9a36a");
  } else {
    rect(g, 12, 0, 10, 40, INK); rect(g, 14, 2, 6, 36, "#c99159");
    rect(g, 10, 14, 14, 8, INK); rect(g, 12, 16, 10, 4, "#d9a36a");
  }
  return c;
}

function roof(g: Ctx, x: number, y: number, w: number, h: number, col: string, colLt: string) {
  poly(g, [[x - 8, y + h], [x + 12, y - 4], [x + w - 12, y - 4], [x + w + 8, y + h]], INK);
  poly(g, [[x - 3, y + h - 3], [x + 15, y], [x + w - 15, y], [x + w + 3, y + h - 3]], col);
  g.strokeStyle = colLt; g.lineWidth = 3;
  for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(x + 6, y + (h * i) / 4); g.lineTo(x + w - 6, y + (h * i) / 4); g.stroke(); }
}

function pawSign(g: Ctx, x: number, y: number, r: number, bg: string, fg: string) {
  circle(g, x, y, r + 3, INK); circle(g, x, y, r, bg);
  ell(g, x, y + r * 0.2, r * 0.42, r * 0.34, fg);
  for (const [dx, dy] of [[-0.45, -0.25], [-0.16, -0.48], [0.16, -0.48], [0.45, -0.25]]) circle(g, x + dx! * r, y + dy! * r, r * 0.15, fg);
}

function windowPane(g: Ctx, x: number, y: number, w: number, h: number) {
  rect(g, x - 2, y - 2, w + 4, h + 4, INK); rect(g, x, y, w, h, "#9ee3ff"); rect(g, x, y, w, h / 3, "#c8f1ff");
  rect(g, x + w / 2 - 1, y, 2, h, INK); rect(g, x, y + h / 2 - 1, w, 2, INK);
}

function farmhouse(fw: number): HTMLCanvasElement {
  const W = fw + 30, H = 190;
  const [c, g] = cnv(W, H);
  const x = 15;
  shadow(g, W / 2, H - 8, fw / 2 + 10, 12);
  rect(g, x + 6, 80, fw - 12, H - 92, INK); rect(g, x + 9, 82, fw - 18, H - 96, "#fff1d6");
  for (let yy = 92; yy < H - 14; yy += 14) rect(g, x + 9, yy, fw - 18, 2, "#f0dbb4");
  for (const xx of [x + 9, x + fw - 17, x + fw / 2 - 4]) rect(g, xx, 82, 8, H - 96, "#b98455");
  roof(g, x, 28, fw, 58, "#f07a4a", "#ff9b6f");
  rect(g, x + fw - 46, 8, 18, 34, INK); rect(g, x + fw - 43, 11, 12, 30, "#c98b5c");
  pawSign(g, x + fw / 2, 64, 15, "#ffd166", "#b5652d");
  rect(g, x + fw / 2 - 16, H - 60, 32, 48, INK); rect(g, x + fw / 2 - 13, H - 57, 26, 45, "#b46f3c"); circle(g, x + fw / 2 + 7, H - 34, 2.2, "#ffd166");
  windowPane(g, x + 24, H - 70, 26, 22); windowPane(g, x + fw - 50, H - 70, 26, 22);
  // Awning over the door.
  for (let i = 0; i < 4; i++) { rect(g, x + fw / 2 - 30 + i * 15, H - 72, 15, 10, INK); rect(g, x + fw / 2 - 29 + i * 15, H - 71, 13, 8, i % 2 ? "#ffffff" : "#ff6f61"); }
  return c;
}

function windmillBase(fw: number): HTMLCanvasElement {
  const W = fw + 20, H = 170;
  const [c, g] = cnv(W, H);
  const cxm = W / 2;
  shadow(g, cxm, H - 8, fw / 2, 10);
  poly(g, [[cxm - 30, H - 10], [cxm - 20, 50], [cxm + 20, 50], [cxm + 30, H - 10]], INK);
  poly(g, [[cxm - 26, H - 12], [cxm - 17, 53], [cxm + 17, 53], [cxm + 26, H - 12]], "#e9d8bd");
  for (let yy = 62; yy < H - 12; yy += 12) rect(g, cxm - 24, yy, 48, 2, "#d3bf9c");
  poly(g, [[cxm - 30, 56], [cxm, 22], [cxm + 30, 56]], INK); poly(g, [[cxm - 25, 53], [cxm, 27], [cxm + 25, 53]], "#a86a3e");
  rect(g, cxm - 9, H - 40, 18, 28, INK); rect(g, cxm - 6, H - 37, 12, 25, "#8a5a36");
  circle(g, cxm, 50, 7, INK); circle(g, cxm, 50, 4.5, "#6d5a74");
  return c;
}

/** Windmill blades, drawn separately so they can spin. */
export function windmillBlades(): HTMLCanvasElement {
  const [c, g] = cnv(150, 150);
  g.translate(75, 75);
  for (let i = 0; i < 4; i++) {
    g.save(); g.rotate((i * Math.PI) / 2);
    rect(g, -4, -70, 8, 64, INK); rect(g, -2, -68, 4, 60, "#8a5a36");
    rect(g, 3, -68, 18, 50, INK); rect(g, 5, -66, 14, 46, "#fff6e5");
    for (let k = 0; k < 4; k++) rect(g, 5, -62 + k * 12, 14, 2, "#d3bf9c");
    g.restore();
  }
  circle(g, 0, 0, 8, INK); circle(g, 0, 0, 5, "#c98b5c");
  return c;
}

function stall(fw: number, v: number): HTMLCanvasElement {
  const W = fw + 16, H = 84;
  const [c, g] = cnv(W, H);
  const x = 8;
  shadow(g, W / 2, H - 6, fw / 2 + 4, 6);
  rect(g, x + 2, 30, 6, H - 36, INK); rect(g, x + fw - 8, 30, 6, H - 36, INK);
  rect(g, x, H - 34, fw, 26, INK); rect(g, x + 3, H - 32, fw - 6, 22, "#c99159"); rect(g, x + 3, H - 32, fw - 6, 5, "#e0b07a");
  const goods = [["#ff6f61", "#ffd166", "#7ccd5a"], ["#9b6bd6", "#5fb34c", "#ff9a3c"], ["#4cb3e6", "#ffd166", "#ff8fab"], ["#c88a55", "#47c9c1", "#ffd166"]][v % 4]!;
  for (let i = 0; i < 6; i++) { circle(g, x + 9 + i * ((fw - 18) / 5), H - 36, 5.5, INK); circle(g, x + 9 + i * ((fw - 18) / 5), H - 36, 4, goods[i % 3]!); }
  const stripe = [["#ff6f61", "#fff6e5"], ["#4c8fe6", "#ffd166"], ["#5fb34c", "#fff6e5"], ["#f07a4a", "#fff6e5"]][v % 4]!;
  poly(g, [[x - 6, 34], [x + 2, 8], [x + fw - 2, 8], [x + fw + 6, 34]], INK);
  const n = 6, sw = (fw + 8) / n;
  for (let i = 0; i < n; i++) {
    poly(g, [[x - 4 + i * sw, 31], [x + 4 + i * sw * ((fw - 8) / (fw + 8)), 11], [x + 4 + (i + 1) * sw * ((fw - 8) / (fw + 8)), 11], [x - 4 + (i + 1) * sw, 31]], stripe[i % 2]!);
  }
  for (let i = 0; i < n; i++) { g.fillStyle = INK; g.beginPath(); g.arc(x - 4 + (i + 0.5) * sw, 32, sw / 2, 0, Math.PI); g.fill(); g.fillStyle = stripe[i % 2]!; g.beginPath(); g.arc(x - 4 + (i + 0.5) * sw, 31, sw / 2 - 2, 0, Math.PI); g.fill(); }
  return c;
}

function tower(g: Ctx, x: number, top: number, bottom: number, w: number) {
  rect(g, x - 3, top, w + 6, bottom - top, INK); rect(g, x, top + 2, w, bottom - top - 4, "#cbc3cf");
  for (let yy = top + 12; yy < bottom - 4; yy += 14) for (let k = 0; k < Math.floor(w / 16); k++) rect(g, x + ((yy / 14) % 2 ? 8 : 0) + k * 16, yy, 14, 2, "#b0a6b5");
  rect(g, x, top + 2, 6, bottom - top - 4, "#dcd6df");
  poly(g, [[x - 10, top + 6], [x + w / 2, top - w * 1.1], [x + w + 10, top + 6]], INK);
  poly(g, [[x - 5, top + 3], [x + w / 2, top - w * 1.1 + 6], [x + w + 5, top + 3]], "#4c7fd9");
  poly(g, [[x - 5, top + 3], [x + w / 2, top - w * 1.1 + 6], [x + w * 0.3, top + 3]], "#6c9cf0");
  windowPane(g, x + w / 2 - 6, top + 22, 12, 16);
}

function castle(fw: number): HTMLCanvasElement {
  const W = fw + 40, H = 330;
  const [c, g] = cnv(W, H);
  const x = 20, base = H - 10;
  shadow(g, W / 2, base, fw / 2 + 10, 14);
  // Curtain wall.
  rect(g, x + 20, base - 120, fw - 40, 120, INK); rect(g, x + 23, base - 117, fw - 46, 114, "#d6cfd9");
  for (let yy = base - 104; yy < base - 4; yy += 16) for (let k = 0; k < 20; k++) rect(g, x + 26 + k * 18 + ((yy / 16) % 2 ? 9 : 0), yy, 16, 2, "#bdb3c1");
  for (let k = 0; k < 13; k++) { rect(g, x + 22 + k * ((fw - 44) / 12) - 7, base - 134, 14, 16, INK); rect(g, x + 22 + k * ((fw - 44) / 12) - 5, base - 132, 10, 13, "#d6cfd9"); }
  // Keep.
  const kx = x + fw / 2 - 70;
  rect(g, kx - 3, base - 210, 146, 210, INK); rect(g, kx, base - 207, 140, 204, "#e2dce5");
  roof(g, kx - 6, base - 262, 152, 56, "#3f6fcc", "#5b8ae6");
  // Big door + steps.
  g.fillStyle = INK; g.beginPath(); g.moveTo(kx + 42, base - 6); g.lineTo(kx + 42, base - 70); g.arc(kx + 70, base - 70, 28, Math.PI, 0); g.lineTo(kx + 98, base - 6); g.closePath(); g.fill();
  g.fillStyle = "#8a5a36"; g.beginPath(); g.moveTo(kx + 46, base - 6); g.lineTo(kx + 46, base - 70); g.arc(kx + 70, base - 70, 24, Math.PI, 0); g.lineTo(kx + 94, base - 6); g.closePath(); g.fill();
  rect(g, kx + 69, base - 92, 2, 86, "#6b4127");
  windowPane(g, kx + 18, base - 170, 22, 30); windowPane(g, kx + 100, base - 170, 22, 30);
  // Paw banner on the keep.
  rect(g, kx + 50, base - 200, 40, 70, INK); rect(g, kx + 53, base - 197, 34, 60, "#3f6fcc");
  poly(g, [[kx + 53, base - 137], [kx + 70, base - 124], [kx + 87, base - 137]], "#3f6fcc");
  pawSign(g, kx + 70, base - 168, 11, "#ffd166", "#3f6fcc");
  // Towers.
  tower(g, x, base - 190, base, 54);
  tower(g, x + fw - 54, base - 190, base, 54);
  tower(g, kx - 40, base - 240, base - 110, 40);
  tower(g, kx + 140, base - 240, base - 110, 40);
  return c;
}

function fountain(fw: number): HTMLCanvasElement {
  const W = fw + 16, H = 120;
  const [c, g] = cnv(W, H);
  const cxf = W / 2;
  shadow(g, cxf, H - 10, fw / 2, 12);
  ell(g, cxf, H - 34, fw / 2 + 4, 26, INK); ell(g, cxf, H - 36, fw / 2, 22, "#cbc3cf"); ell(g, cxf, H - 40, fw / 2 - 8, 15, "#5ec2ef"); ell(g, cxf - 10, H - 44, 14, 5, "#a9e7fb");
  rect(g, cxf - 9, H - 84, 18, 46, INK); rect(g, cxf - 6, H - 82, 12, 44, "#e2dce5");
  ell(g, cxf, H - 84, 22, 9, INK); ell(g, cxf, H - 85, 19, 7, "#5ec2ef");
  g.strokeStyle = "#bdeeff"; g.lineWidth = 4; g.lineCap = "round";
  for (const dx of [-1, 1]) { g.beginPath(); g.moveTo(cxf, H - 100); g.quadraticCurveTo(cxf + dx * 26, H - 118, cxf + dx * 34, H - 56); g.stroke(); }
  g.beginPath(); g.moveTo(cxf, H - 86); g.lineTo(cxf, H - 112); g.stroke();
  return c;
}

function lamp(): HTMLCanvasElement {
  const [c, g] = cnv(34, 96);
  shadow(g, 17, 90, 10, 4);
  rect(g, 13, 30, 8, 60, INK); rect(g, 15, 32, 4, 56, "#4a5370");
  rect(g, 8, 84, 18, 8, INK);
  const glow = g.createRadialGradient(17, 22, 2, 17, 22, 17); glow.addColorStop(0, "rgba(255,226,140,0.8)"); glow.addColorStop(1, "rgba(255,226,140,0)");
  g.fillStyle = glow; g.fillRect(0, 4, 34, 36);
  rect(g, 7, 12, 20, 22, INK); rect(g, 10, 15, 14, 16, "#ffe28c"); poly(g, [[5, 14], [17, 3], [29, 14]], INK);
  return c;
}

function house(fw: number, v: number): HTMLCanvasElement {
  const W = fw + 24, H = 150;
  const [c, g] = cnv(W, H);
  const x = 12;
  const roofs = [["#3f6fcc", "#5b8ae6"], ["#f07a4a", "#ff9b6f"], ["#5fa84a", "#7cc760"], ["#9b6bd6", "#b58cf0"]][v % 4]!;
  shadow(g, W / 2, H - 8, fw / 2 + 6, 10);
  rect(g, x + 6, 64, fw - 12, H - 74, INK); rect(g, x + 9, 66, fw - 18, H - 78, v % 2 ? "#f6e3c1" : "#efe6f2");
  roof(g, x, 22, fw, 46, roofs[0]!, roofs[1]!);
  rect(g, x + fw / 2 - 12, H - 50, 24, 40, INK); rect(g, x + fw / 2 - 9, H - 47, 18, 37, "#9c6236");
  windowPane(g, x + 18, H - 58, 18, 16); windowPane(g, x + fw - 36, H - 58, 18, 16);
  rect(g, x + 14, H - 38, 26, 8, INK); for (let i = 0; i < 4; i++) circle(g, x + 18 + i * 6, H - 38, 3.5, ["#ff8fab", "#ffd166", "#ff6f61", "#ffffff"][i]!);
  return c;
}

function banner(): HTMLCanvasElement {
  const [c, g] = cnv(40, 110);
  shadow(g, 20, 104, 10, 4);
  rect(g, 17, 10, 6, 96, INK); rect(g, 18.5, 12, 3, 92, "#8a5a36"); circle(g, 20, 9, 5, "#ffd166");
  rect(g, 21, 18, 18, 46, INK); rect(g, 23, 20, 14, 40, "#e2554b");
  poly(g, [[23, 60], [30, 70], [37, 60]], "#e2554b");
  pawSign(g, 30, 36, 6, "#ffd166", "#e2554b");
  return c;
}

function well(fw: number): HTMLCanvasElement {
  const W = fw + 12, H = 100;
  const [c, g] = cnv(W, H);
  const cxw = W / 2;
  shadow(g, cxw, H - 8, fw / 2, 8);
  ell(g, cxw, H - 28, fw / 2 - 2, 16, INK); ell(g, cxw, H - 30, fw / 2 - 5, 13, "#bdb3c1"); ell(g, cxw, H - 32, fw / 2 - 12, 8, "#2f6f9f");
  rect(g, cxw - fw / 2 + 6, 22, 6, H - 50, INK); rect(g, cxw + fw / 2 - 12, 22, 6, H - 50, INK);
  poly(g, [[cxw - fw / 2, 28], [cxw, 6], [cxw + fw / 2, 28]], INK); poly(g, [[cxw - fw / 2 + 5, 26], [cxw, 10], [cxw + fw / 2 - 5, 26]], "#a86a3e");
  return c;
}

function mine(fw: number): HTMLCanvasElement {
  const W = fw + 30, H = 150;
  const [c, g] = cnv(W, H);
  const x = 15, base = H - 6;
  // Rock mound.
  ell(g, W / 2, base - 40, fw / 2 + 14, 52, INK); ell(g, W / 2, base - 44, fw / 2 + 10, 48, ROCK); ell(g, W / 2 - 20, base - 70, 26, 12, ROCK_LT);
  // Tunnel.
  g.fillStyle = INK; g.beginPath(); g.moveTo(x + 22, base); g.lineTo(x + 22, base - 60); g.quadraticCurveTo(W / 2, base - 100, x + fw - 22, base - 60); g.lineTo(x + fw - 22, base); g.closePath(); g.fill();
  g.fillStyle = "#1a1124"; g.beginPath(); g.moveTo(x + 30, base); g.lineTo(x + 30, base - 58); g.quadraticCurveTo(W / 2, base - 90, x + fw - 30, base - 58); g.lineTo(x + fw - 30, base); g.closePath(); g.fill();
  // Timber frame.
  rect(g, x + 14, base - 78, 14, 78, INK); rect(g, x + 17, base - 76, 8, 76, "#a86a3e");
  rect(g, x + fw - 28, base - 78, 14, 78, INK); rect(g, x + fw - 25, base - 76, 8, 76, "#a86a3e");
  rect(g, x + 6, base - 92, fw - 12, 18, INK); rect(g, x + 9, base - 89, fw - 18, 12, "#c08752");
  // Lantern + sign.
  circle(g, x + 32, base - 66, 6, INK); circle(g, x + 32, base - 66, 4, "#ffd166");
  return c;
}

function cart(): HTMLCanvasElement {
  const [c, g] = cnv(52, 48);
  shadow(g, 26, 43, 20, 5);
  poly(g, [[4, 14], [48, 14], [42, 38], [10, 38]], INK); poly(g, [[8, 17], [44, 17], [39, 35], [13, 35]], "#7d6a86");
  rect(g, 8, 20, 36, 3, "#9d8ca2");
  for (const [x, col] of [[16, "#58d8cf"], [26, "#9b6bf0"], [36, "#58d8cf"]] as const) { poly(g, [[x - 6, 16], [x, 4], [x + 6, 16]], INK); poly(g, [[x - 4, 15], [x, 7], [x + 4, 15]], col); }
  for (const x of [14, 38]) { circle(g, x, 40, 6, INK); circle(g, x, 40, 3.5, "#4a5370"); }
  return c;
}

function crystal(v: number, glow: boolean): HTMLCanvasElement {
  const [c, g] = cnv(48, 60);
  const cols = glow ? [["#c48bff", "#e6cfff"], ["#a66bf2", "#d9c2ff"]] : [["#58c6f0", "#bdeeff"], ["#9b6bf0", "#d9c2ff"], ["#4fd1c5", "#c6fbf4"], ["#7aa7ff", "#d1e1ff"]];
  const [col, lt] = cols[v % cols.length]! as [string, string];
  if (glow) { const gr = g.createRadialGradient(24, 34, 3, 24, 34, 26); gr.addColorStop(0, "rgba(196,139,255,0.6)"); gr.addColorStop(1, "rgba(196,139,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, 48, 60); }
  shadow(g, 24, 54, 16, 5);
  const shard = (x: number, h: number, wd: number, tilt: number) => {
    poly(g, [[x + tilt, 52 - h - 3], [x + wd + 3, 52 - h + 8], [x + wd, 54], [x - wd, 54], [x - wd - 3, 52 - h + 8]], INK);
    poly(g, [[x + tilt, 52 - h], [x + wd, 52 - h + 8], [x + wd - 1, 52], [x - wd + 1, 52], [x - wd, 52 - h + 8]], col);
    poly(g, [[x + tilt, 52 - h], [x - wd, 52 - h + 8], [x - wd + 1, 52], [x - 1, 52]], lt);
  };
  shard(14, 22, 6, -2); shard(34, 26, 6, 2); shard(24, 38, 8, 0);
  return c;
}

function smithy(fw: number): HTMLCanvasElement {
  const W = fw + 24, H = 150;
  const [c, g] = cnv(W, H);
  const x = 12;
  shadow(g, W / 2, H - 8, fw / 2 + 6, 10);
  rect(g, x + 6, 62, fw - 12, H - 72, INK); rect(g, x + 9, 64, fw - 18, H - 76, "#c49a72");
  for (let yy = 74; yy < H - 12; yy += 12) rect(g, x + 9, yy, fw - 18, 2, "#a97f58");
  roof(g, x, 20, fw, 46, "#3f6fcc", "#5b8ae6");
  // Pickaxe sign.
  rect(g, x + fw / 2 - 24, 32, 48, 34, INK); rect(g, x + fw / 2 - 21, 35, 42, 28, "#c08752");
  g.save(); g.translate(x + fw / 2, 49); g.rotate(-0.6); rect(g, -2, -12, 4, 26, INK); g.restore();
  g.strokeStyle = INK; g.lineWidth = 4; g.beginPath(); g.arc(x + fw / 2, 56, 14, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
  rect(g, x + fw / 2 - 14, H - 50, 28, 40, INK); rect(g, x + fw / 2 - 11, H - 47, 22, 37, "#5a3a24");
  // Anvil & glow.
  rect(g, x + fw - 34, H - 30, 24, 8, INK); rect(g, x + fw - 30, H - 22, 16, 12, INK);
  const gr = g.createRadialGradient(x + 26, H - 30, 2, x + 26, H - 30, 18); gr.addColorStop(0, "rgba(255,140,60,0.9)"); gr.addColorStop(1, "rgba(255,140,60,0)");
  g.fillStyle = gr; g.fillRect(x + 6, H - 50, 40, 40);
  return c;
}

/** Closed road: striped wooden barrier with a "coming soon" plank. */
function barricade(fw: number): HTMLCanvasElement {
  const W = fw + 8, [c, g] = cnv(W, 70);
  shadow(g, W / 2, 64, W / 2 - 6, 6);
  for (const x of [10, W - 18]) { rect(g, x - 2, 22, 12, 44, INK); rect(g, x, 24, 8, 40, "#9a6a42"); }
  for (const y of [26, 44]) {
    rect(g, 2, y - 2, W - 4, 16, INK);
    for (let x = 4, k = 0; x < W - 4; x += 16, k++) rect(g, x, y, Math.min(16, W - 4 - x), 12, k % 2 ? "#fff6e5" : "#ff7a59");
  }
  rect(g, W / 2 - 34, 2, 68, 20, INK); rect(g, W / 2 - 32, 4, 64, 16, "#ffd166");
  g.fillStyle = INK; g.font = "700 12px Fredoka, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("SOON", W / 2, 12.5);
  return c;
}

function signpost(): HTMLCanvasElement {
  const [c, g] = cnv(48, 72);
  shadow(g, 24, 66, 12, 4);
  rect(g, 20, 20, 9, 48, INK); rect(g, 22, 22, 5, 44, "#9a6a42");
  poly(g, [[4, 10], [38, 10], [46, 18], [38, 26], [4, 26]], INK); poly(g, [[6, 12], [37, 12], [43, 18], [37, 24], [6, 24]], "#e3b97c");
  poly(g, [[44, 30], [10, 30], [2, 38], [10, 46], [44, 46]], INK); poly(g, [[42, 32], [11, 32], [5, 38], [11, 44], [42, 44]], "#d9a36a");
  return c;
}

function crate(): HTMLCanvasElement {
  const [c, g] = cnv(40, 42);
  shadow(g, 20, 37, 16, 5);
  rect(g, 4, 6, 32, 30, INK); rect(g, 7, 9, 26, 24, "#c99159");
  g.strokeStyle = "#9a6a42"; g.lineWidth = 3; g.beginPath(); g.moveTo(7, 9); g.lineTo(33, 33); g.moveTo(33, 9); g.lineTo(7, 33); g.stroke();
  return c;
}

function deadtree(): HTMLCanvasElement {
  const [c, g] = cnv(56, 80);
  shadow(g, 28, 74, 14, 4);
  g.strokeStyle = INK; g.lineWidth = 9; g.lineCap = "round";
  const br = () => { g.beginPath(); g.moveTo(28, 74); g.lineTo(28, 30); g.moveTo(28, 46); g.lineTo(12, 26); g.moveTo(28, 38); g.lineTo(44, 18); g.moveTo(28, 30); g.lineTo(24, 10); g.stroke(); };
  br(); g.strokeStyle = "#8a6a55"; g.lineWidth = 5; br();
  return c;
}

function portal(fw: number): HTMLCanvasElement {
  const W = fw + 20, H = 140;
  const [c, g] = cnv(W, H);
  const cxp = W / 2, base = H - 8;
  shadow(g, cxp, base, fw / 2 + 4, 9);
  const gr = g.createRadialGradient(cxp, base - 48, 4, cxp, base - 48, 44); gr.addColorStop(0, "rgba(120,240,255,0.9)"); gr.addColorStop(1, "rgba(120,240,255,0)");
  g.fillStyle = gr; g.fillRect(cxp - 44, base - 96, 88, 90);
  // Stone arch.
  g.fillStyle = INK; g.beginPath(); g.moveTo(cxp - 44, base); g.lineTo(cxp - 44, base - 64); g.arc(cxp, base - 64, 44, Math.PI, 0); g.lineTo(cxp + 44, base); g.lineTo(cxp + 26, base); g.lineTo(cxp + 26, base - 64); g.arc(cxp, base - 64, 26, 0, Math.PI, true); g.lineTo(cxp - 26, base); g.closePath(); g.fill();
  g.fillStyle = "#9aa3a0"; g.beginPath(); g.moveTo(cxp - 40, base - 3); g.lineTo(cxp - 40, base - 64); g.arc(cxp, base - 64, 40, Math.PI, 0); g.lineTo(cxp + 40, base - 3); g.lineTo(cxp + 29, base - 3); g.lineTo(cxp + 29, base - 64); g.arc(cxp, base - 64, 29, 0, Math.PI, true); g.lineTo(cxp - 29, base - 3); g.closePath(); g.fill();
  ell(g, cxp - 30, base - 90, 12, 5, "#6cc27c"); ell(g, cxp + 24, base - 98, 10, 4, "#6cc27c");
  // Glowing paw in the opening.
  g.fillStyle = "rgba(160,250,255,0.55)"; g.beginPath(); g.moveTo(cxp - 26, base - 3); g.lineTo(cxp - 26, base - 64); g.arc(cxp, base - 64, 26, Math.PI, 0); g.lineTo(cxp + 26, base - 3); g.closePath(); g.fill();
  ell(g, cxp, base - 34, 9, 7, "#e8fdff");
  for (const [dx, dy] of [[-10, -46], [-4, -52], [4, -52], [10, -46]]) circle(g, cxp + dx!, base + dy!, 3.2, "#e8fdff");
  return c;
}

/** Low-res colour map for the minimap and the full map screen (1 px per tile). */
export function miniMap(world: WorldDef): HTMLCanvasElement {
  const [c, g] = cnv(world.w, world.h);
  const img = g.createImageData(world.w, world.h);
  const hex = (s: string) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  for (let i = 0; i < world.tiles.length; i++) {
    const t = world.tiles[i]!, a = AREA_KEYS[world.area[i]!]!;
    const col = t === T.water ? DEEP : t === T.shallow ? SHALLOW : t === T.rock ? ROCK_DK : t === T.sand ? SAND : t === T.path || t === T.bridge ? PATH : t === T.plaza ? COBBLE : t === T.farm ? "#a8743f" : t === T.meadow ? PAL[a].alt : PAL[a].grass;
    const [r, gg, b] = hex(col);
    img.data[i * 4] = r!; img.data[i * 4 + 1] = gg!; img.data[i * 4 + 2] = b!; img.data[i * 4 + 3] = world.blocked[i] && t !== T.water && t !== T.rock ? 235 : 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

export { inked };
