/**
 * Generated art (ChatGPT image generation, sliced by scripts/slice-sheet.ts)
 * in public/assets/gen/. Each world prop kind maps to one or more sprite
 * variants plus the on-screen width it is drawn at. Anything not listed falls
 * back to the procedural art in world-art.ts.
 */
import type { PropKind } from "@catchami/shared";

export const GEN = "/assets/gen/";

export const PROP_ART: Partial<Record<PropKind, { keys: string[]; width: number }>> = {
  tree: { keys: ["prop-tree-0", "prop-tree-1"], width: 96 },
  pine: { keys: ["prop-pine-0", "prop-pine-1"], width: 78 },
  bush: { keys: ["prop-bush-0", "prop-bush-1"], width: 50 },
  boulder: { keys: ["prop-boulder"], width: 52 },
  stone: { keys: ["prop-stone"], width: 50 },
  hay: { keys: ["prop-hay"], width: 42 },
  fence_h: { keys: ["prop-fence_h"], width: 38 },
  farmhouse: { keys: ["prop-farmhouse"], width: 200 },
  windmill: { keys: ["prop-windmill"], width: 150 },
  stall: { keys: ["prop-stall-0", "prop-stall-1"], width: 86 },
  castle: { keys: ["prop-castle"], width: 420 },
  fountain: { keys: ["prop-fountain"], width: 120 },
  lamp: { keys: ["prop-lamp"], width: 48 },
  house: { keys: ["prop-house-0", "prop-house-1"], width: 150 },
  banner: { keys: ["prop-banner"], width: 46 },
  well: { keys: ["prop-well"], width: 76 },
  mine: { keys: ["prop-mine"], width: 160 },
  cart: { keys: ["prop-cart"], width: 58 },
  crystal: { keys: ["prop-crystal-0", "prop-crystal-1"], width: 48 },
  glowcrystal: { keys: ["prop-glowcrystal"], width: 46 },
  smithy: { keys: ["prop-smithy"], width: 160 },
  crate: { keys: ["prop-crate", "prop-crate-1"], width: 42 },
  deadtree: { keys: ["prop-deadtree"], width: 62 },
  portal: { keys: ["prop-portal"], width: 120 },
  mushroom: { keys: ["prop-mushroom"], width: 34 },
  barrel: { keys: ["prop-barrel"], width: 36 },
  wagon: { keys: ["prop-cart-merchant"], width: 84 },
};

export const NODE_ART = ["fish", "herbs", "wood", "minerals"].flatMap((r) => [`node-${r}`, `node-${r}-empty`]);
export const NODE_WIDTH = 64;
export const MERCHANT_ART: Record<string, string> = { finn: "merchant-finn", marigold: "merchant-marigold", tom: "merchant-tom", ruby: "merchant-ruby" };
export const MERCHANT_HEIGHT = 78;
export const CUBE = { happy: "cube-happy", excited: "cube-excited", fly: "cube-fly", open: "cube-open", wobble: "cube-wobble", dizzy: "cube-dizzy" } as const;
export const TEXTURES = { grass: "tex-grass", forest: "tex-forest", dirt: "tex-dirt", cobble: "tex-cobble" } as const;

export const ALL_SPRITES = [
  ...new Set([
    ...Object.values(PROP_ART).flatMap((a) => a!.keys),
    ...NODE_ART,
    ...Object.values(MERCHANT_ART),
  ]),
];

export const genUrl = (key: string) => `${GEN}${key}.png`;

/** Load seamless ground textures (if generated) as images for chunk painting. */
export async function loadTextures(): Promise<Partial<Record<keyof typeof TEXTURES, HTMLImageElement>>> {
  const out: Partial<Record<keyof typeof TEXTURES, HTMLImageElement>> = {};
  await Promise.all(Object.entries(TEXTURES).map(([k, key]) => new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => { out[k as keyof typeof TEXTURES] = img; resolve(); };
    img.onerror = () => resolve();
    img.src = `${GEN}${key}.png`;
  })));
  return out;
}
