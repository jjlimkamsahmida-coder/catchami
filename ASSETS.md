# Art, animation and sound

All current visuals are **original development placeholders drawn in code** (`apps/web/src/game/art.ts`). They're consistent in style (ink outlines, sticker borders, warm palette) and every one can be replaced without code changes.

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
