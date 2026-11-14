# Catchami trailer

Remotion project for the ~112 s hackathon trailer. All gameplay is real footage recorded from the live testnet site.

| Part | Where |
|---|---|
| Edit (shot list, narration timing, labels, sound cues) | `src/timeline.ts` |
| Composition (framing, transitions, captions, titles, overlays, mix) | `src/Trailer.tsx` |
| Narration script + generator (Kokoro TTS `af_heart`, Apache-2.0) | `tools/narration.json`, `tools/narrate.mjs` |
| Original music (synthesized, timed to the scenes) | `tools/music.mjs` → `public/audio/music.wav` |
| Sound effects (same recipes as the game's `sfx.ts`) | `tools/sfx.mjs` → `public/sfx/` |
| Recording rig (headless Chrome + virtual camera + CDP screencast) | `tools/browser.mjs`, `tools/director.mjs`, `tools/lib.mjs` |

Rebuild:

```
npm install
node tools/narrate.mjs && node tools/music.mjs && node tools/sfx.mjs
npx remotion studio src/index.ts        # preview / edit
npm run render                          # -> out/catchami-trailer.mp4
```

Footage (`public/footage/*.mp4`, ~1 GB) is not in git; it stays in this folder on the machine that recorded it.
