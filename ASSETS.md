# Art, animation and sound

## Generated art (current)

The game art comes from the owner's ChatGPT (Pro) image generation, following the owner's reference concept images:

| Sheet (raw, in `apps/web/art-src/raw/`, not shipped) | Sliced into |
|---|---|
| `camicube-sheet.png` | `cube-happy/excited/fly/open/wobble/dizzy` — the capture cube |
| `logo.png` | `logo.png` (title screen) |
| `meadow-sheet.png`, `town-sheet.png`, `mines-sheet.png`, `forest-sheet.png` | `prop-*` world props (farmhouse, windmill, castle, fountain, mine, portal, trees…) |
| `nodes-sheet.png` | `node-<resource>` and `node-<resource>-empty` |
| `merchants-sheet.png` | `merchant-finn/marigold/tom/ruby` |
| `icons-sheet.png` | `icon-<resource>`, `ui-backpack/map/heart/coin/pin/trophy` |
| `tex-*.png` | seamless ground textures (grass, forest floor, valley dirt, cobblestone) |
| `title-bg.png` | `title-bg.webp` |

Pipeline: `scripts/slice-sheet.ts` cuts a sheet into sprites by transparency (keys out a white background if needed), `scripts/optimize-art.ts` shrinks them to ~2× on-screen size as palette PNGs (17.8 MB → 2.1 MB). Sprite keys and on-screen sizes live in `apps/web/src/game/assets.ts`; anything missing falls back to the procedural art below. Ground terrain shapes (coastlines, earth banks, cliffs, paths) are still painted in code (`world-art.ts`) and filled with the generated textures.

Licensing note: check OpenAI's current terms for commercial use of generated images before launch, and keep the raw sheets as provenance.

## Procedural fallback

The original code-drawn placeholders (`apps/web/src/game/art.ts`, `world-art.ts`) remain as fallbacks, consistent in style (ink outlines, sticker borders, warm palette).

## Replacing a texture

1. Put the PNG in `apps/web/public/assets/`.
2. Add it to `apps/web/public/assets/manifest.json`:

```json
{ "tree": "tree.png", "hq": "hq-building.png", "map": "world-map.png" }
```

Any key in the manifest is loaded instead of being drawn.

| Key | What | Placeholder size (px) | Anchor |
|---|---|---|---|
| `map` | Whole painted world, 80×56 tiles at 32 px | 2560×1792 | top-left |
| `tree`, `pine`, `bush`, `boulder` | Props | 72×92, 72×92, 44×34, 46×38 | bottom-centre |
| `hq` | HQ building | 176×150 | bottom-centre |
| `node-fish`, `node-herbs`, `node-wood`, `node-minerals` (+ `-empty`) | Resource spots (full / regrowing) | 56×60 | bottom-centre |
| `icon-fish`, `icon-herbs`, `icon-wood`, `icon-minerals` | Resource icons | 28×28 | centre |
| `merchant-{hue}` | Merchant (hues 200, 120, 30, 330) | 64×70 | bottom-centre |
| `shadow`, `sparkle` | Ground shadow, water glint | 48×16, 18×8 | centre |

Animals use the **real capture sticker** from `/media/stickers/{petId}.png`. The procedural cat/dog (`pa:{species}:{hue}:{pattern}`) only shows while a sticker loads, or for pets created without a photo.

## Animation

Pets use reusable transform animation (no per-pet sprite sheets): idle breathe, walk hop + tilt, gather dip, trade bounce, attack lunge, hurt shake + tint, knockout tip-over, eat chomp, sleep lean (`GameScene.animate`). To swap in skeletal or layered animation later, keep the state names (`PetAnim` in `packages/shared/src/protocol.ts`).

## Sound

There is no audio yet. Suggested hooks: catch throw/wobble/success/fail, gather tick, sale coins, meal, battle hit/crit/miss, knockout, UI tap.

## Reference games

Patch Quest (world density, scale, game feel) and CatchCat (real-animal capture) informed the direction. No assets, layouts or capture presentation were copied: the capture object is an original glowing seed-pod charm, and the world, palette and UI are original.
