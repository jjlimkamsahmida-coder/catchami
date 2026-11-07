/**
 * DEVELOPMENT ART — original, procedurally drawn placeholders.
 *
 * Every texture key below can be replaced by final artwork without code
 * changes: drop a PNG in apps/web/public/assets/ and list it in
 * public/assets/manifest.json as { "key": "file.png" }. Any key present in
 * the manifest is loaded instead of being drawn here. See ASSETS.md.
 */
import { Rng, T, type Resource } from "@catchami/shared";

export const INK = "#2b1d3a";
export const PALETTE = {
  water: "#4aa9e0", deep: "#3a8fcf", shallow: "#7fd5e6", foam: "#eafcff",
  sand: "#f4d99b", sandEdge: "#dcb56d",
  grass: "#86cf5e", grassDark: "#6bb94b", grassLight: "#a6e173",
  meadow: "#a9dc6c", forest: "#5ea84d", forestDark: "#4b9440",
  path: "#ecd295", pathEdge: "#cfa868",
  highland: "#cdb894", rock: "#8e7d92", rockDark: "#665770", rockLight: "#b3a3b5",
  plaza: "#f1dfba", plazaEdge: "#d4b886", bridge: "#c08752", bridgeDark: "#8c5a33",
};

export const RESOURCE_COLOR: Record<Resource, string> = { fish: "#4aa9e0", herbs: "#9b6bd6", wood: "#c08752", minerals: "#47c9c1" };

type Ctx = CanvasRenderingContext2D;

function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return [c, c.getContext("2d")!];
}

const circle = (g: Ctx, x: number, y: number, r: number, fill: string) => { g.fillStyle = fill; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
const ellipse = (g: Ctx, x: number, y: number, rx: number, ry: number, fill: string) => { g.fillStyle = fill; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); };

/** Paints the whole map once into a canvas: organic blob coastlines with ink outlines. */
export function paintMap(w: number, h: number, tiles: Uint8Array, size: number): HTMLCanvasElement {
  const [c, g] = canvas(w * size, h * size);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? T.grass : tiles[y * w + x]!);
  const isWater = (t: number) => t === T.water || t === T.shallow;
  const rng = Rng.fromString("map-paint");
  const cx = (x: number) => x * size + size / 2;
  const each = (pred: (t: number, x: number, y: number) => boolean, fn: (x: number, y: number) => void) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (pred(at(x, y), x, y)) fn(x, y);
  };
  const edge = (x: number, y: number, pred: (t: number) => boolean) =>
    [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dy]) => !pred(at(x + dx!, y + dy!)));

  // Water base with depth.
  g.fillStyle = PALETTE.water; g.fillRect(0, 0, c.width, c.height);
  each((t) => t === T.water, (x, y) => { if (!edge(x, y, (t) => t === T.water)) circle(g, cx(x), cx(y), size * 0.8, PALETTE.deep); });
  each((t) => t === T.shallow, (x, y) => circle(g, cx(x), cx(y), size * 0.75, PALETTE.shallow));

  // Land: ink outline, sand rim, then grass interior.
  const land = (t: number) => !isWater(t);
  each(land, (x, y) => { if (edge(x, y, land)) circle(g, cx(x), cx(y) + 3, size * 0.78, INK); else g.fillRect(0, 0, 0, 0); });
  each(land, (x, y) => { g.fillStyle = PALETTE.sandEdge; if (edge(x, y, land)) circle(g, cx(x), cx(y) + 1, size * 0.72, PALETTE.sandEdge); else { g.fillRect(x * size - 1, y * size - 1, size + 2, size + 2); } });
  each(land, (x, y) => { if (edge(x, y, land)) circle(g, cx(x), cx(y) - 1, size * 0.66, PALETTE.sand); else { g.fillStyle = PALETTE.sand; g.fillRect(x * size - 1, y * size - 1, size + 2, size + 2); } });
  const grassy = (t: number) => land(t) && t !== T.sand;
  each(grassy, (x, y) => {
    if (edge(x, y, grassy)) circle(g, cx(x), cx(y) - 1, size * 0.62, PALETTE.grass);
    else { g.fillStyle = PALETTE.grass; g.fillRect(x * size - 1, y * size - 1, size + 2, size + 2); }
  });

  // Regions.
  const region = (t0: number, color: string, r = 0.62) => each((t) => t === t0, (x, y) => {
    if (edge(x, y, (t) => t === t0)) circle(g, cx(x), cx(y), size * r, color);
    else { g.fillStyle = color; g.fillRect(x * size - 1, y * size - 1, size + 2, size + 2); }
  });
  region(T.meadow, PALETTE.meadow, 0.7);
  region(T.forest, PALETTE.forest, 0.72);
  // Mountains: rock cliffs with lit tops, highland plateau.
  each((t) => t === T.rock || t === T.highland, (x, y) => circle(g, cx(x), cx(y) + 4, size * 0.74, INK));
  region(T.rock, PALETTE.rockDark, 0.72);
  each((t) => t === T.rock, (x, y) => circle(g, cx(x), cx(y) - 5, size * 0.6, PALETTE.rock));
  each((t) => t === T.rock, (x, y) => { if (rng.float() < 0.5) circle(g, cx(x) - 4, cx(y) - 9, size * 0.22, PALETTE.rockLight); });
  region(T.highland, PALETTE.highland, 0.7);

  // Paths & plaza with soft outlines.
  const pathy = (t: number) => t === T.path || t === T.plaza;
  each(pathy, (x, y) => circle(g, cx(x), cx(y), size * 0.62, PALETTE.pathEdge));
  each((t) => t === T.path, (x, y) => circle(g, cx(x), cx(y), size * 0.52, PALETTE.path));
  each((t) => t === T.plaza, (x, y) => { g.fillStyle = PALETTE.plaza; g.fillRect(x * size - 2, y * size - 2, size + 4, size + 4); });
  each((t) => t === T.plaza, (x, y) => { if ((x + y) % 2 === 0) { g.fillStyle = "rgba(212,184,134,0.35)"; g.fillRect(x * size + 3, y * size + 3, size - 6, size - 6); } });

  // Bridges.
  each((t) => t === T.bridge, (x, y) => {
    const horiz = isWater(at(x, y - 1)) || isWater(at(x, y + 1)) ? at(x - 1, y) === T.bridge || at(x + 1, y) === T.bridge : false;
    g.fillStyle = INK; g.fillRect(x * size - 1, y * size + 1, size + 2, size + 2);
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? PALETTE.bridge : "#cf9762";
      if (horiz) g.fillRect(x * size + i * 8, y * size, 7, size); else g.fillRect(x * size, y * size + i * 8, size, 7);
    }
    g.fillStyle = PALETTE.bridgeDark;
    if (horiz) { g.fillRect(x * size, y * size, size, 3); g.fillRect(x * size, y * size + size - 3, size, 3); }
    else { g.fillRect(x * size, y * size, 3, size); g.fillRect(x * size + size - 3, y * size, 3, size); }
  });

  // Details: grass tufts, pebbles, flowers, shore foam.
  g.lineCap = "round";
  each((t) => t === T.grass || t === T.meadow || t === T.forest, (x, y) => {
    const t = at(x, y);
    for (let i = 0; i < 2; i++) {
      if (rng.float() > 0.55) continue;
      const px = x * size + 4 + rng.float() * (size - 8), py = y * size + 6 + rng.float() * (size - 10);
      g.strokeStyle = t === T.forest ? PALETTE.forestDark : PALETTE.grassDark; g.lineWidth = 2;
      g.beginPath(); g.moveTo(px - 3, py); g.lineTo(px - 1, py - 5); g.moveTo(px + 1, py); g.lineTo(px + 3, py - 6); g.stroke();
    }
    if (t === T.meadow && rng.float() < 0.35) {
      const px = x * size + 6 + rng.float() * (size - 12), py = y * size + 6 + rng.float() * (size - 12);
      const col = ["#ff8fab", "#ffd166", "#ffffff", "#c49bff"][rng.int(4)]!;
      for (let k = 0; k < 4; k++) circle(g, px + Math.cos(k * 1.57) * 2.5, py + Math.sin(k * 1.57) * 2.5, 2.2, col);
      circle(g, px, py, 1.6, "#f4a259");
    }
  });
  each((t) => t === T.path || t === T.highland || t === T.sand, (x, y) => {
    if (rng.float() < 0.3) ellipse(g, x * size + 6 + rng.float() * 20, y * size + 6 + rng.float() * 20, 2.5, 1.8, "rgba(120,90,60,0.35)");
  });
  each((t) => t === T.shallow, (x, y) => {
    if (edge(x, y, isWater)) { g.strokeStyle = "rgba(255,255,255,0.55)"; g.lineWidth = 2; g.beginPath(); g.arc(cx(x), cx(y), size * 0.45, rng.float() * 6, rng.float() * 6 + 1.2); g.stroke(); }
  });
  return c;
}

/** A gentle water sparkle sprite for animated overlays. */
export function sparkle(): HTMLCanvasElement {
  const [c, g] = canvas(18, 8);
  g.strokeStyle = "rgba(255,255,255,0.9)"; g.lineWidth = 2; g.lineCap = "round";
  g.beginPath(); g.moveTo(2, 5); g.quadraticCurveTo(6, 1, 9, 5); g.quadraticCurveTo(12, 8, 16, 4); g.stroke();
  return c;
}

export function shadow(): HTMLCanvasElement {
  const [c, g] = canvas(48, 16);
  ellipse(g, 24, 8, 22, 7, "rgba(43,29,58,0.28)");
  return c;
}

export function tree(kind: "tree" | "pine"): HTMLCanvasElement {
  const [c, g] = canvas(72, 92);
  ellipse(g, 36, 84, 24, 7, "rgba(43,29,58,0.25)");
  g.fillStyle = INK; g.fillRect(29, 52, 14, 32);
  g.fillStyle = "#9a6a42"; g.fillRect(32, 52, 8, 30);
  if (kind === "tree") {
    for (const [x, y, r] of [[22, 44, 18], [50, 44, 18], [36, 28, 22], [36, 50, 18]] as const) circle(g, x, y, r + 3, INK);
    for (const [x, y, r] of [[22, 44, 18], [50, 44, 18], [36, 28, 22], [36, 50, 18]] as const) circle(g, x, y, r, "#58a948");
    for (const [x, y, r] of [[18, 38, 9], [44, 20, 10], [50, 40, 7]] as const) circle(g, x, y, r, "#78c75c");
    circle(g, 28, 46, 3, "#ff6f61"); circle(g, 48, 32, 3, "#ff6f61");
  } else {
    for (let i = 0; i < 3; i++) {
      const y = 18 + i * 16, hw = 16 + i * 6;
      g.fillStyle = INK; g.beginPath(); g.moveTo(36, y - 18); g.lineTo(36 + hw + 3, y + 14); g.lineTo(36 - hw - 3, y + 14); g.closePath(); g.fill();
      g.fillStyle = i % 2 ? "#3f8f4a" : "#4aa255"; g.beginPath(); g.moveTo(36, y - 14); g.lineTo(36 + hw, y + 11); g.lineTo(36 - hw, y + 11); g.closePath(); g.fill();
    }
  }
  return c;
}

export function bush(): HTMLCanvasElement {
  const [c, g] = canvas(44, 34);
  ellipse(g, 22, 29, 18, 5, "rgba(43,29,58,0.25)");
  for (const [x, y, r] of [[14, 18, 11], [30, 18, 11], [22, 12, 11]] as const) circle(g, x, y, r + 2.5, INK);
  for (const [x, y, r] of [[14, 18, 11], [30, 18, 11], [22, 12, 11]] as const) circle(g, x, y, r, "#6cbf52");
  circle(g, 18, 9, 4, "#8fd86e");
  return c;
}

export function boulder(): HTMLCanvasElement {
  const [c, g] = canvas(46, 38);
  ellipse(g, 23, 33, 19, 5, "rgba(43,29,58,0.25)");
  ellipse(g, 23, 20, 20, 15, INK);
  ellipse(g, 23, 19, 17, 12.5, "#a597a8");
  ellipse(g, 17, 14, 7, 4, "#c8bccb");
  return c;
}

export function resourceNode(r: Resource, depleted: boolean): HTMLCanvasElement {
  const [c, g] = canvas(56, 60);
  ellipse(g, 28, 52, 20, 6, "rgba(43,29,58,0.25)");
  const dim = (col: string) => (depleted ? "#b9b2bd" : col);
  if (r === "fish") {
    // Fishing spot: wooden post, bobber, ripples.
    g.strokeStyle = depleted ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.85)"; g.lineWidth = 2.5;
    for (const rr of [10, 17]) { g.beginPath(); g.ellipse(34, 44, rr, rr * 0.45, 0, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = INK; g.fillRect(13, 14, 10, 36); g.fillStyle = "#b07a4a"; g.fillRect(15, 16, 6, 32);
    g.strokeStyle = INK; g.lineWidth = 1.5; g.beginPath(); g.moveTo(18, 16); g.quadraticCurveTo(30, 18, 34, 40); g.stroke();
    circle(g, 34, 42, 6, INK); circle(g, 34, 42, 4.5, dim("#ff5d5d")); g.fillStyle = "#fff"; g.fillRect(30, 41, 8, 2);
    if (!depleted) { g.fillStyle = INK; g.beginPath(); g.moveTo(42, 30); g.lineTo(50, 24); g.lineTo(50, 36); g.fill(); ellipse(g, 40, 30, 7, 4.5, INK); ellipse(g, 40, 30, 5.5, 3, "#7fc4ef"); }
  } else if (r === "herbs") {
    for (const [x, y] of [[18, 34], [38, 34], [28, 26]] as const) circle(g, x, y, 13, INK);
    for (const [x, y] of [[18, 34], [38, 34], [28, 26]] as const) circle(g, x, y, 11, dim("#5fb34c"));
    for (const [x, y] of [[16, 26], [30, 18], [40, 28], [24, 36], [36, 38]] as const) { circle(g, x, y, 4.5, INK); circle(g, x, y, 3.2, dim("#b07cf0")); }
  } else if (r === "wood") {
    // Log pile.
    for (const [x, y] of [[16, 42], [30, 42], [44, 42], [23, 30], [37, 30], [30, 18]] as const) {
      circle(g, x, y, 8.5, INK); circle(g, x, y, 7, dim("#c88a55")); circle(g, x, y, 3.5, dim("#e7b98a"));
    }
  } else {
    ellipse(g, 28, 44, 22, 10, INK); ellipse(g, 28, 42, 19, 8, dim("#a597a8"));
    const crystal = (x: number, h: number, col: string) => {
      g.fillStyle = INK; g.beginPath(); g.moveTo(x, 42 - h - 3); g.lineTo(x + 9, 42 - h + 8); g.lineTo(x + 7, 44); g.lineTo(x - 7, 44); g.lineTo(x - 9, 42 - h + 8); g.closePath(); g.fill();
      g.fillStyle = dim(col); g.beginPath(); g.moveTo(x, 42 - h); g.lineTo(x + 6, 42 - h + 8); g.lineTo(x + 5, 42); g.lineTo(x - 5, 42); g.lineTo(x - 6, 42 - h + 8); g.closePath(); g.fill();
      g.fillStyle = "rgba(255,255,255,0.6)"; g.fillRect(x - 2, 42 - h + 4, 2, h - 8);
    };
    crystal(18, 18, "#58d8cf"); crystal(36, 22, "#ff8fc8"); crystal(27, 30, "#7ce8e0");
  }
  return c;
}

export function hqBuilding(): HTMLCanvasElement {
  const [c, g] = canvas(176, 150);
  ellipse(g, 88, 140, 76, 10, "rgba(43,29,58,0.25)");
  // Walls.
  g.fillStyle = INK; g.fillRect(22, 64, 132, 76);
  g.fillStyle = "#fff1d6"; g.fillRect(26, 66, 124, 70);
  g.fillStyle = "#f2dcb2"; for (let y = 76; y < 136; y += 12) g.fillRect(26, y, 124, 2);
  // Roof.
  g.fillStyle = INK; g.beginPath(); g.moveTo(8, 72); g.lineTo(88, 10); g.lineTo(168, 72); g.closePath(); g.fill();
  g.fillStyle = "#ff7a59"; g.beginPath(); g.moveTo(16, 68); g.lineTo(88, 16); g.lineTo(160, 68); g.closePath(); g.fill();
  g.fillStyle = "#ff9b7d"; for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(30 + i * 26, 64); g.lineTo(88, 22 + i * 2); g.lineTo(36 + i * 26, 64); g.fill(); }
  // Chimney + door + windows.
  g.fillStyle = INK; g.fillRect(122, 18, 18, 30); g.fillStyle = "#c98b5c"; g.fillRect(125, 21, 12, 26);
  g.fillStyle = INK; g.fillRect(74, 96, 28, 44); g.fillStyle = "#b46f3c"; g.fillRect(77, 99, 22, 41); circle(g, 94, 120, 2, "#ffd166");
  for (const x of [38, 116]) { g.fillStyle = INK; g.fillRect(x, 86, 24, 22); g.fillStyle = "#9ee3ff"; g.fillRect(x + 3, 89, 18, 16); g.fillStyle = INK; g.fillRect(x + 11, 89, 2, 16); }
  // Sign.
  g.fillStyle = INK; g.fillRect(62, 48, 52, 22); g.fillStyle = "#ffd166"; g.fillRect(65, 51, 46, 16);
  g.fillStyle = INK; g.font = "bold 13px Fredoka, sans-serif"; g.textAlign = "center"; g.fillText("HQ", 88, 64);
  return c;
}

/** Placeholder animal sticker (until the real capture sticker loads). */
export function placeholderAnimal(species: "cat" | "dog", hue: number, pattern: number): HTMLCanvasElement {
  const [c, g] = canvas(72, 72);
  const body = `hsl(${hue}, 55%, 66%)`, dark = `hsl(${hue}, 45%, 45%)`, light = `hsl(${hue}, 70%, 84%)`;
  const shape = (pad: number, col: string) => {
    g.fillStyle = col;
    ellipse(g, 36, 46, 20 + pad, 16 + pad, col); // body
    circle(g, 36, 28, 17 + pad, col); // head
    if (species === "cat") {
      g.beginPath(); g.moveTo(22 - pad, 20); g.lineTo(24, 4 - pad); g.lineTo(33, 14); g.fill();
      g.beginPath(); g.moveTo(50 + pad, 20); g.lineTo(48, 4 - pad); g.lineTo(39, 14); g.fill();
      ellipse(g, 57, 46, 6 + pad, 12 + pad, col);
    } else {
      ellipse(g, 20, 28, 7 + pad, 12 + pad, col); ellipse(g, 52, 28, 7 + pad, 12 + pad, col);
    }
  };
  shape(6, "#ffffff"); // die-cut sticker border
  shape(2.5, INK);
  shape(0, body);
  if (species === "cat") { circle(g, 24, 13, 3, light); circle(g, 48, 13, 3, light); }
  else { ellipse(g, 20, 30, 5, 10, dark); ellipse(g, 52, 30, 5, 10, dark); }
  if (pattern % 3 === 1) { circle(g, 30, 44, 6, dark); circle(g, 44, 50, 5, dark); }
  if (pattern % 3 === 2) { ellipse(g, 36, 36, 9, 6, light); }
  ellipse(g, 36, 49, 10, 8, light);
  circle(g, 29, 27, 3.2, INK); circle(g, 43, 27, 3.2, INK);
  circle(g, 30, 26, 1.1, "#fff"); circle(g, 44, 26, 1.1, "#fff");
  ellipse(g, 36, 33, 3, 2, INK);
  circle(g, 24, 33, 2.6, "rgba(255,120,140,0.6)"); circle(g, 48, 33, 2.6, "rgba(255,120,140,0.6)");
  return c;
}

export function merchant(hue: number): HTMLCanvasElement {
  const [c, g] = canvas(64, 70);
  const col = `hsl(${hue}, 60%, 62%)`, dark = `hsl(${hue}, 50%, 40%)`;
  ellipse(g, 32, 64, 22, 6, "rgba(43,29,58,0.28)");
  // Backpack crate.
  g.fillStyle = INK; g.fillRect(36, 22, 24, 30); g.fillStyle = "#c98b5c"; g.fillRect(39, 25, 18, 24); g.fillStyle = "#a96f43"; g.fillRect(39, 35, 18, 3);
  // Body.
  ellipse(g, 28, 46, 17, 17, INK); ellipse(g, 28, 46, 14.5, 14.5, col);
  circle(g, 28, 26, 13, INK); circle(g, 28, 26, 10.5, "#ffd9b3");
  circle(g, 24, 26, 1.8, INK); circle(g, 32, 26, 1.8, INK);
  g.strokeStyle = INK; g.lineWidth = 1.5; g.beginPath(); g.arc(28, 29, 3, 0.2, Math.PI - 0.2); g.stroke();
  // Hat.
  ellipse(g, 28, 17, 18, 5, INK); ellipse(g, 28, 16, 15.5, 3.5, dark);
  g.fillStyle = INK; g.fillRect(17, 2, 22, 15); g.fillStyle = dark; g.fillRect(19, 4, 18, 12); g.fillStyle = "#ffd166"; g.fillRect(19, 12, 18, 3);
  // Coin pouch.
  circle(g, 16, 50, 6, INK); circle(g, 16, 50, 4.5, "#ffd166");
  return c;
}

export function resourceIcon(r: Resource, size = 28): HTMLCanvasElement {
  const [c, g] = canvas(size, size);
  const s = size / 28;
  g.scale(s, s);
  if (r === "fish") { ellipse(g, 13, 14, 10, 6.5, INK); g.beginPath(); g.moveTo(20, 14); g.lineTo(27, 7); g.lineTo(27, 21); g.fillStyle = INK; g.fill(); ellipse(g, 13, 14, 8, 4.8, "#7fc4ef"); g.beginPath(); g.moveTo(21, 14); g.lineTo(25.5, 10); g.lineTo(25.5, 18); g.fillStyle = "#7fc4ef"; g.fill(); circle(g, 8, 13, 1.4, INK); }
  if (r === "herbs") { circle(g, 14, 15, 10, INK); circle(g, 14, 15, 8, "#5fb34c"); for (const [x, y] of [[10, 11], [17, 10], [15, 17]] as const) { circle(g, x, y, 3.3, INK); circle(g, x, y, 2.3, "#b07cf0"); } }
  if (r === "wood") { g.save(); g.translate(14, 14); g.rotate(-0.5); g.fillStyle = INK; g.fillRect(-12, -6, 24, 12); g.fillStyle = "#c88a55"; g.fillRect(-10, -4, 20, 8); g.restore(); circle(g, 22, 9, 5, INK); circle(g, 22, 9, 3.5, "#e7b98a"); }
  if (r === "minerals") { g.fillStyle = INK; g.beginPath(); g.moveTo(14, 2); g.lineTo(24, 11); g.lineTo(14, 26); g.lineTo(4, 11); g.closePath(); g.fill(); g.fillStyle = "#58d8cf"; g.beginPath(); g.moveTo(14, 5); g.lineTo(21, 11); g.lineTo(14, 22); g.lineTo(7, 11); g.closePath(); g.fill(); g.fillStyle = "rgba(255,255,255,0.7)"; g.fillRect(11, 8, 2, 8); }
  return c;
}

export function capsule(): HTMLCanvasElement {
  // The Catchami capture charm: a soft glowing seed-pod with a leaf ribbon.
  const [c, g] = canvas(80, 80);
  const grd = g.createRadialGradient(40, 40, 8, 40, 40, 38);
  grd.addColorStop(0, "rgba(255,240,170,0.9)"); grd.addColorStop(1, "rgba(255,240,170,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 80, 80);
  ellipse(g, 40, 42, 22, 25, INK);
  ellipse(g, 40, 42, 19, 22, "#ffd166");
  ellipse(g, 40, 50, 19, 12, "#ffb84d");
  ellipse(g, 33, 33, 6, 8, "rgba(255,255,255,0.7)");
  g.fillStyle = INK; g.beginPath(); g.moveTo(40, 20); g.quadraticCurveTo(54, 6, 62, 14); g.quadraticCurveTo(52, 24, 40, 22); g.fill();
  g.fillStyle = "#6cc04a"; g.beginPath(); g.moveTo(41, 20); g.quadraticCurveTo(53, 9, 59, 14); g.quadraticCurveTo(51, 21, 41, 21); g.fill();
  circle(g, 40, 44, 6, INK); circle(g, 40, 44, 4, "#fff6e5");
  return c;
}
