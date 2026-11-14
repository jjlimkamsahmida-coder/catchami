# Catchami — Project Summary

> **Historical snapshot (2026-11-11), kept for reference.** It predates the NEAR testnet deployment and later economy changes. For the current state see [README](../README.md), [STATUS.md](STATUS.md), [ECONOMY.md](ECONOMY.md) and [CATCHAMI_SYSTEM.md](CATCHAMI_SYSTEM.md).

**Catch the Real. Play the World.**
A mobile-first (and laptop-friendly) 2D multiplayer pet game on NEAR. Players point their camera at real cats and dogs. Each successful catch becomes a cutout sticker pet with its own `$CATCHAMI` balance. The pet lives in a shared world where it gathers, trades with travelling merchants, eats, heals, crafts gear and battles. It keeps working on autopilot while the owner is offline.

Status as of 2026-11-11: **development build, running locally on a dev network with test units.** Nothing is deployed onchain, audited, or approved for real money. Overall progress to public launch is roughly **45%**; the coding side is about **65%**.

---

## 1. Scope

### In scope (built)
- Real-animal capture with server-side verification, fair paid rolls, and body-cutout stickers
- Collector cards (rarity, attributes, traits, holographic foil)
- Four large connected world areas with generated art
- Authoritative multiplayer world: movement, gathering, hunger/energy/HP, knockouts, bankruptcy/inactivity
- Travelling NPC merchants funded by an HQ treasury with hard budgets
- Dynamic resource demand from real recorded events
- Battles (non-redeemable), resource theft, consent and cooldowns
- Deterministic autopilot strategies that run offline
- Equipment crafting from real resources; equipment bonuses with caps and trade-offs
- In-game marketplace with atomic sales and stale-balance protection
- Leaderboards, daily rewards, wallet, fairness verifier, admin portal
- Double-entry ledger with database-enforced invariants and reconciliation
- `$CATCHAMI` NEP-141 token and the game contract (NFTs + vault + settlement + marketplace), written and unit-tested
- Economy simulation at 100 / 1,000 / 10,000 animals
- Phone and laptop support, local HTTPS hosting for phone cameras

### Out of scope until approved
- Real-money PvP wagering (hard-disabled; legal gate)
- Card/bank on-ramps (need provider approval)
- Mainnet deployment and real funds (need audits, legal review, owner approval)
- RHEA yield integration (design-only, disabled)

---

## 2. Player workflow

1. **Onboard:** open the app and tap *Start playing*. This creates a device account (no email or password). The title screen shows the generated logo and landscape.
2. **First-pet guide:** until the player owns a pet, a guide offers *Get free test tokens* (dev network only) and *Catch an animal*. WASD pans the camera so the world still responds.
3. **Catch:**
   - The live camera runs an on-device COCO-SSD preview with a reticle. The CamiCube looks happy, then excited when an animal is locked on.
   - The player taps *Lock on*. Three frames go to the server, which verifies them.
   - The server re-detects the animal, checks liveness and duplicates, and cuts the body out into a sticker.
   - The player picks a tier and sees the exact cost, catch chance, rarity odds and money split.
   - Throw: drag and flick the CamiCube, or click/Space on a laptop. A miss is a free retry.
   - Sequence: the cube unfolds, the animal is pulled in, the cube wobbles three times, then the server's fair roll decides.
   - Success flips in the collector card. A failed roll shows the dizzy cube, and the cost goes to HQ.
   - Dev network only: *Use a photo instead* sends a photo through the same server checks.
4. **Play:** move with the joystick, WASD or click-to-walk. Gather at resource spots, sell to merchants (cash and stock are visible only in range), eat or buy meals, take medicine, nap, and challenge other pets.
5. **Autopilot:** configure work, resource, selling, battle and survival rules. The pet keeps playing while the owner is offline.
6. **Manage:** use the pet detail tabs (Status with card, Strategy, Wallet, Gear), fund or withdraw a pet, claim the daily reward, craft and equip gear, list or buy on the marketplace, view leaderboards and verify fairness.

---

## 3. Functionality in detail

### 3.1 Capture pipeline
| Step | Where | Rule |
|---|---|---|
| Live preview | Browser, TF.js COCO-SSD (SSDLite MobileNetV2) | Reticle only. Never trusted. |
| Validate | `POST /api/catch/validate` | 2–3 JPEG frames. Liveness heuristic: frames must differ slightly but match. Server COCO-SSD on every frame: same species in ≥2 frames, score ≥ 0.6. Perceptual-hash duplicate check over 30 days. Rate limits. |
| Cutout | Server, DeepLab v3 (PASCAL VOC) on tfjs-wasm | Animal body mask, cleaned to connected components, eroded 1px. White die-cut outline, ink edge and drop shadow. Falls back to a rounded photo sticker if segmentation fails. |
| Privacy | Server | Only the animal crop is stored. Full frames are discarded. Pending crops are deleted after 15 minutes. |
| Attempt | `POST /api/catch/attempt` | One DB transaction. Success: pet +80%, HQ +18%, team +2%, new pet, NFT mint queued. Valid but failed roll: 100% to HQ. Invalid detection, miss, expiry or server error: no charge. |

**Tiers:** Basic 1M (60% success), Enhanced 3M (80%), Premium 8M (95%). Rarity odds per tier follow the specification. Mythic is never guaranteed.

### 3.2 Fair randomness
Hourly commit-reveal epochs. The server publishes `sha256(seed)` first and reveals the seed after the hour. Every roll is `HMAC-SHA256(seed, label)`, covering catch, rarity, genome, battle, equipment rarity and daily reward. The Fairness screen recomputes catches in the browser.

### 3.3 Pets and attributes
- Stats: HP, max HP, energy, max energy, hunger, attack, defense, gathering, speed, luck, carry. No EXP or levelling.
- Rarity gives an **aggregate** bonus budget (Common 0% to Mythic 5%) spread across stats. Natural ±4% per-stat variation dominates, so a Common beats a Mythic over 30% of the time (tested).
- Two hidden traits per pet (Swimmer, Forager, Sturdy, Zoomies…). Species affinities: cats are better at fish and herbs, dogs at wood and minerals.

### 3.4 Collector card
- Original frame design, coloured by rarity, with a rays background behind the cutout sticker.
- Shows HP, ATK/DEF/SPD/LCK/GTH/CRY/EN bars, traits, species talent line, rarity gems and a serial number.
- Holographic foil and pointer tilt for Rare and above. A flip-in reveal after a catch.
- Also shown in the pet Status tab. For other players' pets the attributes are hidden.

### 3.5 World
- 144×112 tiles in four 72×56 areas:
  - **Cozy Meadow:** lake, farm fields, farmhouse, windmill, market stalls, docks.
  - **Fantasy Town:** HQ castle with a paw banner, cobblestone plaza, fountain, lamps, houses, wagons. Players spawn here.
  - **Enchanted Forest:** dense trees, moonlit pond, paw-ruin portal, glowing crystals, mushrooms.
  - **Mining Valley:** cliffs, mine entrance, rails and carts, crystals, forge.
- Connected by a great river with bridges, forest trails and a mountain pass. 52 resource nodes; every node and point of interest is reachable (tested).
- Rendering: chunk streaming (24×18 tiles per chunk), seamless generated ground textures, earth banks above water, rock cliff faces, generated prop sprites, animated windmill, water glints and lamp/portal glow.
- HUD: area banner, minimap, full map (tap anywhere to walk), backpack and map buttons, market-demand widget.

### 3.6 Needs and survival
- Hunger goes from full to starving in about 8 hours. Starving drains energy.
- Energy is spent walking, gathering and battling, and recovers with food and naps.
- When HP reaches 0 the pet is knocked out for 3 hours, and needs medicine afterwards. Paying more can't skip the cooldown.
- A pet with zero energy and maximum hunger becomes inactive. It is never burned; the owner deposits tokens to revive it.

### 3.7 Resource economy
- Fish (food), herbs (medicine), wood and minerals (crafting). Nodes have limited capacity, regrowth, gather time and weight.
- Meals need **real HQ fish stock**. Medicine needs **real HQ herb stock**. Crafting consumes real wood and minerals, from the pet's bag or HQ's delivered stock.
- Demand index: smoothed consumption vs. supply from recorded events, capped at 60–175% and step-limited to 2.5% per minute. Merchant price = base × demand × treasury factor × merchant preference.

### 3.8 Merchants and HQ treasury
- Four merchants (Finn the Fishmonger, Sage Marigold, Timber Tom, Rocky Ruby) walk routes across the areas. Each has its own cash, cart capacity and buying preferences.
- They return to HQ when full, low on cash, or at the end of the route. They deliver real stock and receive a capped top-up. If HQ can't fund the minimum, the merchant sits out; no money is invented.
- HQ daily budget: 0.05% of available HQ funds, split 85% merchants / 15% rewards. It tapers to 0 at the 5% reserve floor (2T), and budgets never go below the floor.

### 3.9 Battles
- Deterministic engine: initiative, hit chance, damage and crits over up to 8 exchanges. HP persists between battles.
- The winner may steal up to 15% of the loser's carried resources, limited by its carry capacity.
- Consent comes from the defender's strategy. Pets of the same owner can't battle each other. There are per-pet and same-opponent cooldowns.
- Battles are **non-redeemable**: no tokens are at stake. Real-token PvP is hard-disabled behind a legal flag.

### 3.10 Autopilot
- Work effort; resource (fixed or highest-demand).
- Selling: often, when full, best-paying merchant, nearest merchant, or hold selected resources.
- Battle stance: avoid, defend, balanced, aggressive. Minimum HP to fight and a theft-exposure limit.
- Survival: eat threshold, emergency fish reserve, rest threshold, auto-medicine.
- Manual control pauses autopilot for 45 seconds.

### 3.11 Crafting and equipment
- Boots, gloves, armor, heavy armor (defense up, speed down), tool and weapon. Each costs wood, minerals and a token fee (90% HQ / 10% team).
- Equipment rarity comes from a fair roll. There are 2 slots, and positive bonuses are capped at 12% in total.

### 3.12 Marketplace, rewards, leaderboards
- **Marketplace:** list, cancel and buy animals or equipment. 2% fee (90% HQ / 10% team).
  - Atomic transfer of ownership and the attached balance.
  - The buyer's expected balance protects against stale prices.
  - No double sales. Withdrawals are locked while a pet is listed.
- **Daily rewards:** paid from the funded pool only, which can never overspend. Requires activity and pet age. Zero outcomes are possible. Rarity adds at most 5%.
- **Leaderboards:** richest pets, gatherers, wins, losses, resources stolen, economy. All from recorded data.

### 3.13 Ledger and money safety
- Double-entry journal. Idempotency keys, immutable entries, postings sum to zero.
- Database `CHECK` constraints: available balance ≥ 0, holds ≥ 0, treasury days within budget, HQ stock ≥ 0.
- Holds for withdrawals and escrow. Row locks in a stable order.
- Reconciliation every 5 minutes and from admin:
  - Ledger sums to zero, and cached balances equal postings.
  - Claims stay within supply, and budgets stay within caps.
  - The vault balance matches onchain once the contracts are configured.
- Dev network: HQ is credited 40T test units, marked unbacked. The faucet gives 20M per user per day.

### 3.14 Admin portal (`/admin`)
- Shows treasury and obligations, today's budget, HQ stock, merchants, demand, the chain outbox, catches, suspicious captures, trades and the admin log.
- Logged pause switches for catches, trades, battles and withdrawals. Admins can't edit balances.

---

### 3.15 Gathering minigames
When a player sends their pet to gather, a small panel opens just above the pet; the world stays visible. Autopilot pets keep the timed gathering driven by their stats and strategy, and are never treated as if a human played.

| Resource | Minigame | Input |
|---|---|---|
| Wood | Timing bar: marker ping-pongs, gold/green zone | One tap |
| Minerals | Circular timing: marker orbits, glowing impact arc | One tap |
| Fish | Moving fish around the bait zone | One tap |
| Herbs | Pull the weed: hold, the plant stretches, release when it glows | One hold |

- **Rules** are shared code (`packages/shared/src/minigames.ts`). The server creates each round from the fair epoch RNG and the client animates the same motion functions.
- **The client only reports the tap time, or the hold duration for herbs.** The server grades it against its own copy of the round.
- **Anti-cheat:** each round is single-use and owner-only. Impossible reaction times, or times longer than the real elapsed time, are rejected.
- **Yield:** perfect 2, good 1, miss 0. It is always capped by node supply and bag capacity. Each attempt costs 3 energy. Every result is logged.
- **Feedback:** the spot shakes, chips fly, the reward floats up, and there are short synthesized sounds (placeholder audio).

### 3.16 Bubble Roulette (PvP)
A turn-based party match with an original bubble-launcher toy. HP is only the score, and the pets react playfully: splashes, puffs, harmless foam on a loss.

- **Setup:**
  - Challenge from a pet's sheet. The other owner must be online and accept within 25 s, and both pets need ≥ 20 battle HP.
  - Battle HP = current HP as 0–100.
  - The launcher holds 6 slots with 2 hidden splash bubbles, shuffled from the fair epoch RNG and recomputable after the seed reveal.
- **Turns:**
  - Alternate turns; each turn is *Splash myself* or *Splash opponent*.
  - A splash costs 20 HP and reloads a fresh chamber. An empty slot is removed.
  - Both players see slots left and splashes left; they never see the positions.
- **Server-authoritative state machine** (`apps/server/src/world/bubble.ts`): invited → active → finished / cancelled.
  - Actions carry the turn number, so out-of-turn, stale, replayed or duplicate actions are rejected.
  - Settlement happens once: HP carries back (it can only go down), knockout rules apply, wins and losses are recorded, and an audit row is written to `battles` (mode `bubble`) with the full action log.
- **Published policy:**
  - 15 s per turn. A missed turn passes; two missed turns in a row forfeit. Leaving counts as a loss.
  - Refresh or reconnect restores the match from the server.
  - A server restart voids unfinished matches (no HP change).
- **Real-token stakes stay disabled** behind the existing legal gate. The match records `mode: "nonredeemable"`. Wager escrow will reuse the ledger holds and contract settlement, not a new wallet.

## 4. Blockchain (NEAR)

### `contracts/token` — `$CATCHAMI` NEP-141
- Fixed 100T supply × 10^18, minted once at init: 40% HQ, 55% market, 5% team (intended for a vesting contract). **No mint function.**
- Force-unregistering a storage account (which burns its tokens) is disabled. 3 unit tests.

### `contracts/game` — NFTs + vault + settlement + marketplace
- **NEP-171** animal (`a-`) and equipment (`e-`) NFTs, minted by the operator.
- **Vault:** user, pet, HQ, team and merchant buckets. Deposits via `ft_transfer_call` are logged for the indexer (`deposits_since`).
- **Settlement:** operator batches must sum to zero and have sequential IDs (replay-safe). The team bucket can't be debited. HQ debits are capped by an immutable hard cap. Pet and user debits are capped by allowances the owners sign.
- **Withdrawals:** a request reserves the funds. It becomes executable after an operator acknowledgement, or after a 24-hour escape hatch. Withdrawals can't be paused. Settlement may only shrink a request less than 10 minutes old.
- **Marketplace:** an atomic sale inside `ft_transfer_call`, with stale-balance refunds and a 2% fee. A pet's balance follows the NFT.
- The owner (multisig or DAO) can only pause, rotate the operator, lower the HQ cap and set the delay.
- 15 unit tests. Wasm builds: game 406 KB, token 195 KB.

### Not yet built
The operator signer service, the settlement-batch producer, the deposit/withdrawal indexer, and testnet deployment.

---

## 5. Architecture

```
Browser (React HUD + Phaser 3)  ⇄ WebSocket intents / REST ⇄  Node server (authoritative)
   camera + COCO-SSD preview                                     world sim 10 Hz, ledger (Postgres/PGlite),
                                                                 COCO-SSD + DeepLab (tfjs-wasm), fair RNG,
                                                                 outbox → (future) operator signer → NEAR
```

| Path | Contents |
|---|---|
| `packages/shared` | `ECONOMY` config (versioned), bigint money, RNG, pets/genome, combat, demand/treasury math, world generator + A*, wire protocol |
| `apps/server` | HTTP + WebSocket, world/AI, ledger/treasury, capture (detector, segmentation, stickers), services, admin, simulation, dev scripts |
| `apps/web` | React + Phaser client, generated art in `public/assets/gen`, raw sheets in `art-src/raw`, art tooling scripts |
| `contracts/` | Rust workspace: token and game, Docker build image |
| `docs/` | Architecture, status, setup, simulation report and dashboard, this summary |

**Stack:** Node 24 (native TypeScript), pnpm workspaces, Vite 6, React 19, Phaser 3.90, PGlite / PostgreSQL, ws, TF.js 4.22, near-sdk 5.30, Rust 1.99 (Docker).

---

## 6. Art strategy
- Art generated with the owner's ChatGPT Pro account, following the owner's two reference images:
  - CamiCube (6 poses), logo and title background.
  - Area prop sheets, resource spots (full and empty), merchants, icons.
  - Seamless textures: grass, forest floor, valley dirt, cobblestone.
- `slice-sheet.ts` cuts sheets by transparency (keying out white backgrounds). `optimize-art.ts` shrinks sprites to 2× display size as palette PNGs (17.8 MB → 2.1 MB).
- Terrain shapes are still painted in code and filled with the generated textures. Procedural art remains as a fallback.
- Licensing to check before launch: OpenAI terms for commercial use of generated images.

---

## 7. Economy strategy and simulation
- Fixed supply; HQ distributes previously allocated tokens with daily caps and a reserve floor. Nothing is minted through gameplay.
- Revenue (actual, from fees):
  - Catch: 2% to the team.
  - Failed catch: 100% to HQ.
  - Food, medicine and crafting: 10% to the team.
  - Marketplace: 10% of the 2% fee to the team.
- The simulation (`pnpm sim`, report in `docs/ECONOMY_SIMULATION.md`, dashboard in `docs/simulation/index.html`) found:
  - **No invariant violations** in all 5 scenarios, up to 10,000 animals.
  - **One shared world saturates at about 300 pets.** At 1,000 pets, 41% become inactive by day 29. Splitting into worlds of about 250 keeps 100% active → world sharding is required.
  - HQ outflow is small. Pet balances grow about 110K per day at current prices. That growth is a **legal classification question** (investment or gambling) for counsel.

---

## 8. Quality and testing
| Suite | Result |
|---|---|
| Shared rules (18) | Exact splits, supply, commit-reveal, disclosed odds, rarity cap, equipment cap, battle fairness, treasury taper, demand caps, map reachability |
| Ledger (6) | Idempotency, DB overdraft protection, holds, 25 concurrent spends |
| Detection (3) | Real cat and dog detected, blank image rejected, duplicate hashing |
| End-to-end server (3) | Live-burst capture and split, still and duplicate rejection, gather → sell → deliver → food → battle → marketplace → reconcile, autopilot |
| Contracts (18) | Supply, deposits, settlement rules, allowances, caps, escape hatch, atomic sale, ownership transfer |
| Browser | Checked at phone (375×812) and laptop (1366×768) sizes: title screen, world areas, HUD, card, catch screen. Camera capture needs a real device. |

Bugs found and fixed along the way:
- Node type-stripping limits on TypeScript syntax.
- A variable-shadowing bug in a test helper.
- Loader stalls in a throttled browser.
- Stale GPU uploads when a map chunk was repainted under the same texture name.
- The WebGL renderer booting on a 0×0 canvas.
- Double WebSocket connections in React StrictMode.
- The dev session secret changing on every restart.

---

## 9. Local hosting and dev tools
- `pnpm models`, then `pnpm dev:server` (port **8797**) and `pnpm dev:web` (**https://localhost:5173**, also on the LAN at https://192.168.0.167:5173 for phones).
- Local HTTPS via a mkcert certificate in `data/certs/`.
- `apps/server/scripts/dev-catch.ts`: catch through the real API with a photo. The in-app *Use a photo instead* button does the same on the dev network.
- Laptop controls: WASD/arrows, click-to-walk, wheel or +/− to zoom, C catch, M map, B backpack, Esc close.

---

## 10. Progress

| Area | % |
|---|---|
| Game & gameplay | ~80 |
| Art & UI | ~75 |
| Offchain economy & ledger | ~85 |
| NEAR contracts | ~70 |
| NEAR bridge (signer, settlement, indexer) | ~10 |
| Login & wallets | ~20 |
| Scaling (world sharding) | ~0 |
| Security audit & legal | ~0 |
| Payments, hosting & deployment | ~5 |
| **Overall to public launch** | **~45** |

## 11. Next steps
**Engineering:**
1. NEAR bridge: operator signer, settlement producer, indexer, then testnet end to end.
2. World sharding.
3. NEP-413 wallet login, plus an embedded wallet once a provider is chosen.
4. Gathering mini-game and resource-point highlights.
5. Sticker storage on S3/R2, load testing, real-device QA, sound.

**Owner** (see `todo.md`):
- NEAR accounts and token parameters.
- Audits and legal review.
- Wallet and on-ramp providers, liquidity plan, hosting.

## 12. Key documents
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [STATUS.md](STATUS.md)
- [SETUP.md](SETUP.md)
- [ECONOMY_SIMULATION.md](ECONOMY_SIMULATION.md)
- [../ASSETS.md](../ASSETS.md)
- [../todo.md](../todo.md)
