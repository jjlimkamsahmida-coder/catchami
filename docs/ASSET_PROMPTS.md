# Catchami — art still needed (ChatGPT prompts)

Everything below already has a working placeholder in the game, so nothing is
blocked. When you generate these, drop the PNGs into `apps/web/art-src/raw/`
(any file names) and tell me which is which — I'll slice, optimise and wire
them in with the existing pipeline (`apps/web/scripts/slice-sheet.ts`,
`optimize-art.ts`).

## House style (paste this before every prompt)

> Cozy chibi 2D game art for a mobile pet game called Catchami. Thick dark-plum
> outlines (#2b1d3a), warm cel shading with one soft highlight, rounded chunky
> shapes, bright friendly palette (leaf green #6cc04a, sun yellow #ffd166, coral
> #ff7a59, sky #5ab8ff, cream #fff6e5). 3/4 top-down view for world objects,
> front view for characters. Clean edges, no text, no watermark, **transparent
> background**, each item centred with generous padding. Original design — not
> based on any existing game or franchise.

---

## 1. The Keeper (story guide) — highest priority

Shown in the intro, the join screen, naming, the world intro and the in-game
tutorial. Today it's a hooded silhouette drawn in code.

**Prompt A — main pose (save as `keeper.png`)**
> A mysterious but kind wandering guide called "the Keeper": small chibi figure
> in a deep purple hooded cloak with star-shaped clasps, face mostly hidden in
> the hood's shadow with two glowing warm-yellow eyes and a gentle smile, a
> satchel of tiny cubes on the hip, holding up a glowing teal-and-coral cube
> (the CamiCube) in both hands. Full body, front view, standing, 1024×1024,
> transparent background.

**Prompt B — sprite sheet of 4 poses in one image (2×2 grid, equal cells)**
> The same Keeper character in four poses on one 2×2 sheet with equal square
> cells and lots of spacing: (1) idle holding the glowing cube, (2) tossing the
> cube upward with one hand, (3) waving hello, (4) pointing to the side with a
> wink. Same proportions, colours and outline in every cell. Transparent
> background.

## 2. Bubble Roulette (PvP) — yes, this needs art

Today the launcher, foam and arena are drawn in SVG/CSS. The match works; these
make it feel like a real mini-game.

**Prompt C — bubble launcher (sheet, 3 frames in a row)**
> A cute brass-and-teal soap-bubble cannon on a little wooden stand with a
> rotating six-slot drum (like a revolver chamber, each slot a round bubble
> socket). Three frames on one sheet, equal cells: (1) idle, (2) drum mid-spin
> with motion lines, (3) firing a big shiny soap bubble with sparkles.
> Transparent background.

**Prompt D — splash & foam effects (sheet, 6 cells, 3×2)**
> Game VFX sprite sheet, 3×2 equal cells: (1) a single shiny soap bubble, (2) a
> bubble popping into a star burst, (3) a big foam splash covering a pet
> silhouette area, (4) small foam puff, (5) "dodge" whoosh swirl, (6) a pile of
> soft foam suds. Bright cyan/white/pink, thick plum outline. Transparent
> background.

**Prompt E — arena background (two images)**
> A cozy bathhouse-themed duel arena seen from the front: wooden deck floor,
> rubber ducks, soap bottles, bunting flags, two small podiums left and right
> for the pets, warm lantern light, empty middle. Make one image 1920×1080
> (landscape) and one 1080×1920 (portrait). No characters, no text.

**Prompt F — UI bits (sheet, 3×2)**
> Game UI sprite sheet, 3×2 equal cells: (1) a "VICTORY" ribbon banner shape
> with no text, (2) a "DEFEAT" droopy ribbon with no text, (3) an empty
> rounded HP bar frame shaped like a bubble wand, (4) a loaded chamber icon
> (filled bubble), (5) an empty chamber icon (hollow ring), (6) a turn timer
> clock made of bubbles. Transparent background.

## 3. World — village gates & signs

**Prompt G — gates and signs (sheet, 3×2)**
> 3/4 top-down game props, 3×2 equal cells: (1) a wooden forest gate archway
> wrapped in vines and leaves, (2) a stone mine-pass archway with a lantern and
> pickaxe sign, (3) a striped red/cream road barricade with a blank yellow
> plank on top (road closed), (4) a wooden signpost with two blank arrow
> boards, (5) a village notice board with blank paper pinned, (6) a small
> wooden well. Transparent background.

## 4. Nice-to-have

**Prompt H — phone hand-off illustration (`handoff.png`)**
> A cheerful phone with a camera on the back scanning a QR code on a laptop
> screen, with a small CamiCube hopping between them and sparkle arrows.
> Square, transparent background.

**Prompt I — starter gift (`gift.png`)**
> An open gift box overflowing with golden paw-print coins and one glowing
> CamiCube on top, confetti. Square, transparent background.

**Prompt J — area title cards (3 images, 1600×600)**
> Wide illustrated banner for "Paw Village" (cosy cobblestone plaza with a
> small castle), "Whispering Forest" (glowing mushrooms, tall pines, a moonlit
> lake), "Mining Valley" (sandy cliffs, mine cart rails, crystals). No text.

---

# Making the animal check & sticker cutout more accurate

What runs today (free, on our own server):

| Step | Model | Weak spots |
|---|---|---|
| Live yellow box in the camera | COCO-SSD lite (in the browser) | Preview only — never decides anything |
| "Is it a real cat/dog?" | COCO-SSD on the server, majority of a 3-frame burst | Can be fooled by a cat on a TV/phone screen, a poster or a plush toy |
| Sticker cutout | DeepLab v3 (PASCAL), now run on a crop around the animal with smooth upscaling | Fluffy edges and unusual poses can lose fur or keep a little background |

**1. Turn on the OpenAI vision check (recommended, already built in).**
Copy `.env.example` to `.env` in the repo root and set:

```
OPENAI_API_KEY=sk-...your key...
OPENAI_VISION_MODEL=gpt-4.1-mini
```

Restart the server. Each capture then sends one downscaled frame to the model,
which must confirm *real, live, in front of the camera* and *cat or dog*; it
rejects screens, photos, toys and drawings, and returns a tight body box that
makes the cutout cleaner. The on-server detector still runs first, and if
OpenAI is unreachable the capture falls back to it (and says so in the log).
Cost is one small image request per throw with a mini model — check current
OpenAI pricing; nothing is charged to the player for a rejected photo.
Privacy: only that one frame leaves the server; it isn't stored by Catchami.

**2. Better cutouts (pick one, I can wire it in).**
OpenAI's image models redraw the picture rather than cut it out, so they're
not right for faithful stickers. Proper options:
- **BiRefNet** (MIT licence) running on our server — free per catch, best
  edges, but adds a ~100–200 MB model and a few seconds per catch on CPU.
- A hosted background-removal API (e.g. remove.bg or a Replicate model) —
  simplest and very accurate, paid per image, sends the crop to that service.

**3. More species.** COCO also knows horse, sheep, cow, bird, bear… and the
vision model can name anything. Say which animals you want and I'll add them
(the sticker cutout also needs a matching class or option 2 above).
