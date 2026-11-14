# Catchami: the complete system

> One document covering what Catchami is, how every part works, the economy, the on-chain layer, and how it's built and run.
> State as of **2026-11-15** (updated after the trailer work), economy config `2026-11-14.1`, NEAR **testnet**.
> Every game number comes from `packages/shared/src/config.ts`, the single source of truth.

## Contents

1. [What Catchami is](#1-what-catchami-is)
2. [Live status: real vs simulated](#2-live-status-real-vs-simulated)
3. [Architecture](#3-architecture)
4. [Signing in](#4-signing-in)
5. [Onboarding and the tutorial](#5-onboarding-and-the-tutorial)
6. [The world](#6-the-world)
7. [Pets](#7-pets)
8. [Catching](#8-catching)
9. [Pet needs: energy, hunger, HP](#9-pet-needs-energy-hunger-hp)
10. [Gathering](#10-gathering)
11. [Merchants, prices and demand](#11-merchants-prices-and-demand)
12. [Meals, medicine and imported goods](#12-meals-medicine-and-imported-goods)
13. [Crafting and gear](#13-crafting-and-gear)
14. [Battles: Bubble Roulette](#14-battles-bubble-roulette)
15. [Marketplace](#15-marketplace)
16. [Autopilot](#16-autopilot)
17. [The economy](#17-the-economy)
18. [The on-chain layer](#18-the-on-chain-layer)
19. [Buying, withdrawing, trading](#19-buying-withdrawing-trading)
20. [Fairness and anti-abuse](#20-fairness-and-anti-abuse)
21. [Server internals](#21-server-internals)
22. [Running and deploying](#22-running-and-deploying)
23. [The trailer project](#23-the-trailer-project)
24. [Known limits, risks, next steps](#24-known-limits-risks-next-steps)
25. [Glossary](#25-glossary)

---

## 1. What Catchami is

A mobile-first, multiplayer 2D pet game.

- You **catch real cats and dogs with your phone camera**. Each catch becomes a unique pet with its own stats and sticker art.
- **Every pet is an NFT with its own wallet** (its "piggy bank"), holding the game coin **$CATCHAMI**.
- Pets live in one shared world. They gather resources, sell them to travelling merchants, buy meals and medicine, craft gear, fight other players' pets in **Bubble Roulette**, and can be sold on the marketplace, piggy bank included.
- A pet works on its own (**autopilot**) while you're away. Everything it earns or spends goes in and out of its piggy bank.
- The owner can **withdraw $CATCHAMI from a pet to their own wallet**, then trade it for USDC like any memecoin.

Design pillars:

| Pillar | What it means |
|---|---|
| Real-world catching | The only way to get a new pet is a live photo of a real animal |
| Closed, honest economy | Fixed supply of 100T $CATCHAMI. Nothing is printed. Every coin a player earns was paid by HQ, which is funded only by what players spend |
| Your pet is a little business | It earns (gathering), spends (food, medicine, gear), and can win or lose (battles) |
| Self-balancing | Prices follow demand, HQ's spending follows revenue, merchants physically limit how much they can buy |
| Fair and checkable | Every random roll uses a commit-reveal seed anyone can verify afterwards |
| Chain-neutral feel | Players see "coins", "wallet", "NFT". NEAR runs underneath; Solana and EVM sign-in are planned |

In the game, $CATCHAMI is called "coins". Amounts are whole coins: 1K = 1,000 and 1M = 1,000,000.

---

## 2. Live status: real vs simulated

Live site: **https://catchami-production.up.railway.app** (Railway, NEAR testnet). Testnet tokens have no monetary value.

| Feature | Status |
|---|---|
| Game world, pets, gathering, merchants, shops, crafting, Bubble Roulette, marketplace, autopilot | ✅ Real, server-authoritative |
| $CATCHAMI token: 100T fixed supply, split 40% HQ / 55% market / 5% team | ✅ Real on testnet |
| Pet NFT minted on every catch | ✅ Real |
| Each pet's piggy bank held on-chain in the game vault | ✅ Real, synced in batches every ~30 s or with "⚡ Sync now" |
| Withdraw a pet's coins to your own wallet | ✅ Real, signed by the player |
| Buying $CATCHAMI: coins delivered from the market allocation | ✅ Real delivery |
| Card payment in front of a purchase | 🟡 Simulated. No card details are collected |
| Pay with any crypto (NEAR Intents) | 🟡 Simulated, because Intents only runs on mainnet. Asset list and USD prices are live |
| Sell $CATCHAMI for USDC | ✅ Real swap on Ref Finance testnet pool #2969 |
| Cash out USDC to a bank (off-ramp) | 🟡 Simulated |
| Sign-in: guest | ✅ Real |
| Sign-in: NEAR wallet (Meteor, Intear, HERE, Sender; MyNearWallet removed because it's sunset) | ✅ Real |
| Sign-in: Google / email / passkey via **NEAR Auth** | ✅ Deployed. Works from `http://localhost:3000` (the only address NEAR's shared testnet login allows); the live domain shows "waiting for NEAR to approve this website" until NEAR approves it (see §4) |
| Sign-in: Solana / EVM | ⏳ "Coming soon" buttons |
| Bubble Roulette with real-value coins on mainnet | 🔒 Switched off by design (legal review needed) |

Deployment notes (2026-11-15):
- **The Railway site is currently down.** `catchami-production.up.railway.app` returns Railway's own "Application not found" (HTTP 404). That response comes from Railway's edge, not from the game code, so the service needs checking in the Railway dashboard (removed, paused, or domain changed).
- Pushed to GitHub `main`: everything up to NEAR Auth sign-in and the first version of this doc.
- **Committed but not pushed:** the autopilot fix (§16) and the trailer project (§23).

---

## 3. Architecture

```
                         ┌──────────────────────────── Browser (phone / PC) ────────────────────────────┐
                         │  React 19 UI  +  Phaser 3.90 world  ·  wallet-selector  ·  NEAR Auth SDK      │
                         └───────────────┬───────────────────────────────┬──────────────────────────────┘
                                 HTTPS /api (REST)                 WebSocket /ws (game state 10 Hz)
                         ┌───────────────▼───────────────────────────────▼──────────────────────────────┐
                         │                    Game server  (Node 22, TypeScript)                         │
                         │  World sim · merchants · AI/autopilot · Bubble Roulette · catching (vision)   │
                         │  Double-entry LEDGER · treasury · fairness seeds · payments · NEAR Auth relay│
                         │  ChainWorker: mint · custody · deposits · withdrawals · settlement           │
                         └───────┬──────────────────────────────────────────────┬───────────────────────┘
                                 │ SQL                                          │ NEAR RPC (signed by operator/market)
                      ┌──────────▼──────────┐                ┌──────────────────▼──────────────────────────┐
                      │ PGlite (local file) │                │ NEAR testnet                                 │
                      │ or Postgres         │                │  token.catchami-dev.testnet  ($CATCHAMI)     │
                      │ one DB per network  │                │  game.catchami-dev.testnet   (NFTs + vault)  │
                      └─────────────────────┘                │  ref-finance-101.testnet pool #2969 (USDC)   │
                                                             │  fast-auth.testnet + MPC signer (NEAR Auth)  │
                                                             └──────────────────────────────────────────────┘
```

### Repository layout (pnpm workspace)

| Path | What |
|---|---|
| `apps/web` | Vite 6 + React 19 + Phaser 3.90 client. `src/game` (world scene), `src/ui` (screens), `src/net` (API, store, wallets, NEAR Auth) |
| `apps/server` | Node server. `world/` (game, merchants, AI, battles, rivals), `ledger/` (ledger, treasury), `capture/` (camera validation), `chain/` (signer, worker, NEAR Auth), `payments.ts`, `services.ts`, `http.ts`, `sim/` (economy simulator) |
| `packages/shared` | Shared rules: economy config, combat, minigames, world map, protocol types, money helpers |
| `contracts/token` | $CATCHAMI fungible token (NEP-141), Rust / near-sdk 5.30 |
| `contracts/game` | Game contract: pet and gear NFTs (NEP-171), per-pet vault, settlement, withdrawals |
| `docs/` | This file, plus GAME_DESIGN, TESTNET, SETUP, ECONOMY_SIMULATION, … |

### Key technical choices

- **Server-authoritative:** movement, gathering timing, minigame grading, battle turns and every coin movement happen on the server. The client only sends intentions.
- **Ledger first, chain second:** every action is booked instantly in a double-entry ledger, and the net result goes on-chain in batches. Gameplay stays instant, without a transaction per action.
- **One rules package:** `packages/shared` is used by the server, the client and the simulator, so numbers never drift apart.

---

## 4. Signing in

| Option | How it works | Where the pet NFTs go |
|---|---|---|
| **Play as guest** | The server creates an account; a signed session token is stored on the device. No personal data | Held by the game (custody) until you connect a NEAR account |
| **Continue with Google (NEAR Auth)** | Real Google / email / passkey login through NEAR Auth (Auth0 + NEAR's MPC signer network). No app, no seed phrase | Straight into your own NEAR account |
| **Connect a NEAR wallet** | Meteor, Intear, HERE or Sender signs a one-time message (NEP-413). No gas, never your seed phrase | Straight into your wallet |
| Solana / EVM | "Coming soon" buttons | — |

### NEAR Auth in detail

1. You tap **Continue with Google** and the NEAR Auth login opens as a pop-up (if pop-ups are blocked, it redirects and comes back).
2. The browser sends the Auth0 **ID token** to our server.
3. The server checks it: an RS256 signature against the issuer's published keys, the issuer, the audience (client ID), and expiry.
4. From your login ID the server asks NEAR's MPC contract (`v1.signer-prod.testnet`, via `fast-auth.testnet`) for your **derived public key**. Your NEAR account is the **implicit account** of that key: the hex of its 32 bytes. The same Google login always maps to the same account.
5. On testnet the operator sends a new account **0.05 NEAR** so it exists and can pay its own gas.
6. To withdraw or swap, you approve the exact transaction in the NEAR Auth pop-up. Our server relays the MPC `sign` call (paying its gas, rate-limited, your own login only). The browser then broadcasts the signed transaction from your account.

**The limit:** NEAR's shared testnet login only allows `http://localhost:3000` as a return address. The live domain needs NEAR to approve it or to issue our own client ID (apply at docs.auth.near.org/home/apply). Until then the live button says "waiting for NEAR to approve this website". To demo it on a laptop against the live testnet server:

```
pnpm --filter @catchami/web dev:nearauth:live      # serves http://localhost:3000
```

This needs `http://localhost:3000` in the live server's `ALLOWED_ORIGINS`.

### Linking later

A guest can link Google or a NEAR wallet at any time from the Coin Vault: Withdraw → Connect. When they link:
- their custody NFTs are transferred to the new account automatically
- their on-chain Coin Vault balance moves from the guest bucket to the account
- the operator registers the account on the $CATCHAMI and USDC tokens (0.00125 NEAR each), so withdrawals and swaps can be received

---

## 5. Onboarding and the tutorial

Stages: `intro → wallet → catch → name → world → tutorial → done`.

1. **Intro**: the Keeper and the CamiCube story ("How to play", "How coins work").
2. **Join**: guest, Google, or a NEAR wallet, then a **starter pouch**:

| Pouch | Coins | Shown price |
|---|---:|---:|
| Sprout Pouch | 10M | 1 NEAR |
| Bloom Bag | 25M | 2 NEAR |
| Grove Chest | 60M | 4 NEAR |

   On testnet no NEAR is charged, but the coins are **real testnet $CATCHAMI** delivered from the market allocation. One pouch per account.

3. **First catch**: always succeeds (rarity is still a fair roll). On a PC, a QR code opens the camera on your phone.
4. **Name** your pet.
5. **Tutorial** in the Keeper's Glade: ten short lessons, each in its own walled-off arena, with a pointing hand and glowing highlights.

| # | Lesson | Goal |
|---|---|---|
| 1 | First Steps | Walk to the flag (joystick on phones, arrow keys / WASD on PC) |
| 2 | Gathering | Gather wood, herbs, stone and fish (Gather button under each spot) |
| 3 | Trading | Merchant Mari → Open shop → **Sell everything** |
| 4 | Hungry! | Arrive with an empty food bar → Chef Coco → **Buy meal** |
| 5 | Ouch! | Arrive at 0 HP (you can still walk slowly) → Nurse Nana → **Buy medicine** |
| 6 | Crafting | Smith Sora gives materials → **Craft from bag** → gear goes to the Profile's Gear tab |
| 7 | Battles | Walk to Coach Kiki → **⚔️ Battle** → read How to Play → win a practice match (nothing at stake) |
| 8 | Marketplace | Bottom menu → Market |
| 9 | Profile | Bag (space bar), Autopilot (always on, explained), Piggy bank (explained) |
| 10 | Graduation | Step into the portal to Paw Village |

Rules: other players' pets are hidden in the Glade, and the profile and wallet are locked until graduation. Tutorial resource spots refill quickly. Leaving the tutorial restores full HP, food and energy.

---

## 6. The world

One shared map, 232 tiles wide (32 px tiles), with these areas:

| Area | Battles? | What's there |
|---|---|---|
| **Paw Village** | No (safe zone) | HQ Castle (merchants restock here), gates, warp rings |
| **Whispering Forest** | Yes | Wood, herb and fish spots, Moonlit Lake, Paw Ruins |
| **Mining Valley** | Yes | Stone spots, Old Mine, Forge |
| **Keeper's Glade** | No | The 9 tutorial arenas, the shop NPCs, Coach Kiki, the portal |

Resource spots hold 100,000–500,000 units each and regrow 10 units per period (fish 70 s, herbs 80 s, wood 60 s, stone 110 s). In practice the real limits are **bag space, energy and merchant carts**, not the spots.

The server ticks at 10 Hz and sends each player what's within 900 px of their pet.

---

## 7. Pets

### Base stats

| Stat | Cat | Dog |
|---|---:|---:|
| Max HP | 950 | 1,050 |
| Max energy | 1,000 | 1,000 |
| Attack | 104 | 100 |
| Defense | 94 | 104 |
| Gather speed | 100 | 100 |
| Speed | 112 | 100 |
| Luck | 108 | 96 |
| Carry | 56 | 66 |

- **Bag size** = carry × 10: cat **560**, dog **660** weight.
- **Species gathering affinity:** cats fish +8% and herbs +3%; dogs wood +6% and stone +5%.
- **Natural variation:** each stat ±4%, rolled at catch.
- **Rarity bonus:** common 0 → mythic +5% stat budget. It's deliberately smaller than natural variation, so rarity is mostly collectible value.
- **Two hidden traits** per pet: Swimmer, Forager, Lumberjack, Digger (+6% on one resource), Sturdy, Scrappy, Packrat, Zoomies, Lucky Whiskers (+5% luck), Tireless, Chonk, Nimble.

### Rarity odds (demo odds; make them rarer before launch)

| Cube | Common | Uncommon | Rare | Epic | Legendary | Mythic |
|---|---:|---:|---:|---:|---:|---:|
| Basic | 30% | 25% | 20% | 12% | 8% | 5% |
| Enhanced | 20% | 22% | 22% | 16% | 12% | 8% |
| Premium | 10% | 15% | 25% | 20% | 18% | 12% |

### Each pet is an NFT

| Field | Value |
|---|---|
| Token ID | `a-<petId>` (gear: `e-<gearId>`) on `game.catchami-dev.testnet` |
| Metadata | Title = pet name, description (rarity + species), media = sticker URL, `extra` = species, rarity, petId |
| Owner | The player's NEAR account, or the game's operator account for guests (custody) |
| Piggy bank | Vault bucket `Pet(a-<petId>)`. **Whoever owns the NFT owns its coins** |

---

## 8. Catching

1. Point the camera at a real cat or dog. The client sends a **live burst of 2–3 frames**.
2. The server checks it. **Nothing is charged** if any check fails:
   - animal detector score ≥ 0.6 (COCO-SSD + DeepLab on the server; an optional OpenAI vision check)
   - liveness: the frames must differ slightly, so a photo of a photo fails
   - not a duplicate: perceptual hash more than 6 bits from earlier catches
3. A valid capture is held for **10 minutes** while you choose a cube:

| Cube | Cost | Catch chance |
|---|---:|---:|
| Basic | 1M | 60% |
| Enhanced | 3M | 80% |
| Premium | 8M | 100% |

| Outcome | Pet's piggy bank | HQ | Team |
|---|---:|---:|---:|
| Success | **40%** | **50%** | **10%** |
| Failed (a real animal wriggled away) | — | 100% | — |
| Not an animal, a duplicate, or expired | nothing charged | | |

Limits: the first catch is guaranteed; 30 catches per player per day.

After the catch, the chain worker mints the NFT within seconds (§18).

---

## 9. Pet needs: energy, hunger, HP

| Rule | Value |
|---|---|
| Energy | 0–1,000. Below **40** the pet is too tired to gather |
| Walking | Costs 1 energy per second |
| Resting | Energy refills by itself (+0.6/s, about 28 min from empty to full) when the pet is idle and hunger is below 700. There's no nap button |
| Hunger | 0 = full, 1,000 = starving. Rises from full to starving in **5 hours**, plus gathering hunger |
| Starving | −0.6 energy per second; at 0 energy the pet goes inactive until fed |
| HP | Only Bubble Roulette lowers it |
| 0 HP | The pet can still **walk (slowly), sell and buy medicine**, but **can't gather or battle** until healed |

Upkeep: an idle pet needs about **14 meals a day (≈ 96K)**. This is the game's biggest coin sink, and it's why every pet has to work.

---

## 10. Gathering

Every successful hit gives **10 units** (autopilot, or a "good" minigame tap). A **perfect** tap gives **20**, and a miss gives 0. Each attempt costs 3 energy, and every unit costs energy and hunger:

| Resource | Base price per unit | Weight | Energy per unit | Hunger per unit | Value per bag slot | Minigame |
|---|---:|---:|---:|---:|---:|---|
| Herbs | 50 | 1 | 1.5 | 0.75 | 50 | Pull (release at the right tension) |
| Fish | 100 | 2 | 3 | 1.5 | 50 | Fishing (stop the fish in the zone) |
| Wood | 150 | 3 | 4.5 | 2.25 | 50 | Chop (hit the marker in the zone) |
| Stone | 200 | 4 | 6 | 3 | 50 | Mine (stop the spinning marker) |

- **Every resource is worth the same per bag slot** and costs the same per slot, so there's no single best grind. Choose by demand, nearby merchant, species, traits and crafting needs.
- **A full bag** is worth about 28K (cat) or 33K (dog) at normal demand.
- **A meal** (+220 energy) pays for about 7.3K of gathering, which is about break-even on its 7K price. Meals make a pet go faster; they don't print money.
- **Server rules:** the server grades every tap, caps yield by spot stock and bag space, and rejects replays and impossibly fast taps.
- On phones, a **Gather** pill under each spot shows its status ("Too tired 😴", "Bag full", "Needs medicine").

---

## 11. Merchants, prices and demand

Four travelling merchants carry **real coins from HQ** on fixed routes (52 px/s, 18 s set-up per stop, 25 s rest at HQ). They stand still while a player has their shop open.

| Merchant | Pays more for | Pays less for |
|---|---|---|
| Finn the Fishmonger | Fish +12% | Wood −6% |
| Sage Marigold | Herbs +12% | Stone −6% |
| Timber Tom | Wood +12% | Fish −6% |
| Rocky Ruby | Stone +12% | Herbs −6% |

- **Price paid** = base price × demand index (60%–175%) × merchant taste × treasury factor (100% unless HQ is near its floor).
- **Cart:** up to 4,000 weight. A full cart goes home and the goods become **real HQ stock**, which the kitchen and workshop use.
- **Purse:** each trip is funded with **0.2M–2M** from the day's budget. A merchant low on coins heads home.

### Demand

| Resource | Consumed by (raises its price) | Supplied by (lowers its price) |
|---|---|---|
| Fish | Meals (10 fish each) | Players selling fish |
| Herbs | Medicine (20 herbs per dose) | Players selling herbs |
| Wood, Stone | Crafting | Players selling them |

```
target = (consumed rate + 4) / (supplied rate + 4)     rates smoothed with a 3-hour half-life
index  moves toward target by at most 2.5% per minute, clamped to 60% … 175%
```

More players eating makes fish pay more, which pulls players to fishing, which restocks the kitchen.

---

## 12. Meals, medicine and imported goods

| Item | Price | Effect | Uses from HQ stock | If HQ is out of stock |
|---|---:|---|---|---|
| Meal | **7K** | −350 hunger, +220 energy | 10 fish | Imported meal **14K** (2×) |
| Medicine | **35K** | Heals 40% of max HP; revives a 0-HP pet | 20 herbs | Imported **70K** (2×) |

- Bought **only at merchants**. Pets can't eat fish from their own bag.
- The coins split 90% HQ / 10% team.
- Imported goods mean a pet never gets stuck; the 2× price signals demand.

---

## 13. Crafting and gear

Each pet has 2 gear slots. Gear is crafted **at a merchant** (Open shop → Gear tab). Crafting uses wood and stone from the bag first; missing materials can be bought from HQ stock at 125% of the merchant price. The fee splits 90% HQ / 10% team.

| Gear | Fee | Wood | Stone | Bonus |
|---|---:|---:|---:|---|
| Trail Boots | 40K | 60 | 20 | +6% speed |
| Picker Gloves | 40K | 40 | 30 | +5% gather |
| Bark Armor | 70K | 80 | 60 | +7% defense |
| Heavy Stone Armor | 90K | 40 | 120 | +11% defense, −6% speed |
| Forager's Tool | 50K | 70 | 40 | +3% gather, +4% carry |
| Pebble Sling | 70K | 50 | 80 | +7% attack |

- Gear rolls a rarity: common 70% … mythic 0.05%, with a multiplier from ×1.00 to ×1.25. The total gear bonus is capped at +12%.
- Gear is an NFT (`e-<id>`), tradable, and goes with the pet when it's sold.
- Crafting is the only thing that uses up wood and stone.

---

## 14. Battles: Bubble Roulette

Live, turn-based PvP. **Battles are forced:** a challenge starts the match right away, and "Give up" counts as a loss.

### Rules

- The launcher holds **6 bubbles, 3 of them loaded**, in a hidden order from the fair seed.
- **On your turn** (15 s; the first turn gets 10 s extra), splash yourself or your opponent.
  - A loaded bubble soaks the target for **50 battle HP**, so two soaks end a full-HP pet.
  - The first time in a turn you **splash yourself and it's empty**, you get **2 extra shots**.
  - The launcher only reloads when no loaded bubbles are left.
- **Battle HP** is the pet's real HP shown as 0–100. The match ends at 0.
- A missed turn passes to the opponent; two in a row forfeit.

### Who can battle

- Both pets are in the Forest or Mining Valley.
- Both have ≥ 120 energy, hunger below 900, and enough HP.
- Neither is listed for sale, gathering, or shopping/talking at a merchant.
- Different owners, both online.
- Cooldowns: 90 s per pet; 30 min before the same two pets meet again.

### Cost and spoils

| Who | Cost |
|---|---|
| Both pets | **80 energy + 60 hunger** at the start, plus HP lost to splashes |
| Loser | Ends at 0 HP and needs **35K medicine** to gather or battle again |

```
share       = 10% × (2 × luck_winner / (luck_winner + luck_loser)) × random(0.5 … 1.5), clamped 2% … 15%
coins taken = share × (loser's coins − 50K protected purse)
fee         = 10% of coins taken → HQ 90% / team 10%
winner gets = coins taken − fee
resources   = share × each resource in the loser's bag (limited by the winner's free space)
```

Because both sides pay energy, hunger and HP and every transfer pays a fee, **battles are a net coin sink**.

### Demo rivals

So the demo always has opponents, 9 simulated Keepers' pets (5 in the Forest, 4 in the Valley) walk up to idle pets and start a match. **Only bags are at stake; coins never move.** The same pet is challenged at most once every 45 s. Coach Kiki in the tutorial is practice only.

---

## 15. Marketplace

- List a pet or gear at any price. **The pet's piggy bank and equipped gear go with it.**
- Buyers confirm the pet's current balance; if it changed, the sale is refused.
- **Fee: 5%**, split 2.5% HQ / 2.5% creator royalty (team). The seller gets 95%.
- While a pet is listed, its coins can't be withdrawn and it can't battle.
- **On-chain rule:** in-game listing works for pets the game holds (custody). A pet whose NFT is already in the player's own wallet would need their signature to move, so it trades from the wallet instead.

---

## 16. Autopilot

**Always on**: there's no off switch. Whenever you aren't steering, the pet gathers, sells, rests, and walks to the nearest open merchant to buy meals and medicine. Steering pauses it for 45 seconds after your last command, then it resumes.

What it decides, in priority order (`apps/server/src/world/ai.ts`):
1. **0 HP:** walk to the nearest merchant and buy medicine (if allowed and affordable), otherwise wait.
2. **Hungry** (hunger above the eat threshold): walk to a merchant and buy a meal (imported if the kitchen is out of fish).
3. **Hurt** (HP below 30%): buy medicine.
4. **Tired:** nap until energy recovers.
5. **Otherwise:** gather the chosen resource (or whichever is in highest demand), and sell according to the selling rule.

Autopilot never starts a battle; demo rivals can still challenge an idle pet in the wild.

**Bug fixed 2026-11-15:** new pets were created with autopilot *off* (and stayed off until the owner saved a strategy), even though the game says it's always on. New pets now start with it on, and existing pets get it switched on when they load. Seen while recording the trailer: once fixed, the test pet walked to a merchant for medicine, went fishing and napped with no input.

| Setting | Options |
|---|---|
| Work | low / balanced / high |
| Resource | a specific one, or "follow demand" |
| Sell | immediately / when full / best price / nearest merchant / hold |
| Eat when hunger is above | 600 by default |
| Buy medicine automatically | yes / no |

A pet with no coins and no food goes inactive until its owner adds coins.

---

## 17. The economy

### 17.1 Supply and allocation (fixed forever)

| Allocation | Amount | Account | Purpose |
|---|---:|---|---|
| HQ treasury | **40T (40%)** | Deposited into the game vault as the HQ bucket | Pays merchants; refilled by player spending |
| Market | **55T (55%)** | `market.catchami-dev.testnet` | Sold to players (purchases) and DEX liquidity |
| Team | **5T (5%)** | `team.catchami-dev.testnet` | Creator / team |
| **Total** | **100T** | `token.catchami-dev.testnet` | 18 decimals, no minting ever |

### 17.2 The ledger

Every coin movement is a **double-entry journal entry**: postings sum to zero, the entry is idempotent (unique key), immutable, and stamped with the config version. Database CHECK constraints make a negative available balance impossible.

| Ledger account | Holds | On-chain vault bucket |
|---|---|---|
| `user:<id>` | The player's Coin Vault | `User(<NEAR account>)`, or a guest bucket `g<hash>.game.catchami-dev.testnet` |
| `pet:<id>` | Each pet's piggy bank | `Pet(a-<petId>)` |
| `merchant:<id>` | Each merchant's purse | `Merchants` (all merchants together) |
| `hq` | HQ treasury | `Hq` |
| `team` | Creator revenue | `Team` |
| `chain` | The outside world: tokens entering or leaving the vault | — (it mirrors on-chain deposits and withdrawals) |

### 17.3 Every coin flow

**Faucets** (coins entering players' hands):

| Source | From |
|---|---|
| Buying coins / starter pouch | Market allocation (real money on mainnet) |
| Selling resources to merchants | HQ, through merchant purses. **The only game faucet**, capped by the daily budget and cart space |

**Sinks** (coins leaving players' hands):

| Sink | HQ | Team |
|---|---:|---:|
| Successful catch (the 60% the pet doesn't keep) | 50% of cost | 10% of cost |
| Failed catch | 100% | — |
| Meals 7K (imported 14K) | 90% | 10% |
| Medicine 35K (imported 70K) | 90% | 10% |
| Crafting fee + bought materials | 90% | 10% |
| Marketplace sale | 2.5% of price | 2.5% of price |
| Bubble Roulette fee | 9% of coins taken | 1% of coins taken |

**Player ↔ player transfers** (no coins created): battle spoils, marketplace sales, and a pet's balance travelling with the pet.

Removed by design: daily login rewards (a faucet for showing up), eating your own fish (free energy), wild NPC battles.

### 17.4 HQ's daily merchant budget

```
spendable    = HQ available − reserve floor (5% of 40T = 2T)
daily budget = min( 0.01% × spendable + 60% × 7-day average daily revenue ,  0.03% × spendable )
```

- **Revenue** counts only coins players actually spent (HQ's share of catches, meals, medicine, crafting, marketplace and battle fees), so it can't be gamed.
- Today, with about 38T spendable: base **3.8B/day**, cap **11.4B/day**.
- With no revenue at all, HQ would halve in about 19 years.
- Below 6T, merchant prices taper linearly to zero at the floor; HQ can never go below the floor.
- **On-chain hard cap:** the game contract refuses more than **20B/day** of net HQ debits. That cap is permanent; the owner can only lower it.

### 17.5 Who earns what

- **Players:** in simulation a working pet earns about 105K/day from sales (after the earning nerf); after food it nets a little. Active play (perfect taps, good merchant timing, following demand) earns more. Battles move coins from weaker or unluckier players, minus the fee. Rare pets and gear sell on the marketplace.
- **Creator (team):** 10% of catches, meals, medicine and crafting, 1% of battle spoils, a 2.5% marketplace royalty, the 5T allocation, and (on mainnet) the money paid for coins from the market allocation.
- **Real money:** every dollar a player cashes out comes from another player buying coins or from the trading pool. Earning is possible, never guaranteed.

### 17.6 Worked examples

| Example | Numbers |
|---|---|
| Cat's full bag of herbs | 560 × 50 = **28K**; at Sage Marigold (+12%) with high demand (130%) ≈ **40.8K**. Costs 840 energy and 420 hunger |
| A day of idle upkeep | about 14 meals = **≈ 96K** |
| A battle loss | The loser holds 1M, so 950K is at stake. Share 10% → **95K taken**, fee 9.5K, the winner gets **85.5K**. The loser also loses 10% of its bag and pays **35K** for medicine |
| Selling a pet | Listed at 5M: fee 250K (125K HQ, 125K creator), the seller gets **4.75M**, the buyer also gets the piggy bank and gear |

### 17.7 Simulation

`pnpm sim` runs an agent-based 30-day model on the live config with an exact ledger and daily invariant checks (`docs/ECONOMY_SIMULATION.md`).

- 87–98% of pets stay active in worlds of 250 pets.
- The budget formula only starts to limit payouts at around 18,000 active pets: the intended safety valve.
- **0 invariant violations:** the ledger sums to zero, no account goes negative, claims never exceed supply, merchants never exceed their allowance, HQ never dips below its floor.
- Lesson: keep worlds around 250 pets, or add merchants as they grow.

---

## 18. The on-chain layer

### 18.1 Deployed contracts and accounts (NEAR testnet)

| What | Account |
|---|---|
| $CATCHAMI token (NEP-141), coin logo stored on-chain | `token.catchami-dev.testnet` |
| Game contract: NFTs (NEP-171) and vault | `game.catchami-dev.testnet` |
| Owner (can pause, rotate the operator, lower caps; can never move balances) | `catchami-dev.testnet` |
| Operator (the game server's signer) | `operator.catchami-dev.testnet` |
| HQ / market / team allocations | `hq.` / `market.` / `team.catchami-dev.testnet` |
| DEX pool $CATCHAMI/USDC, 0.3% fee | Ref Finance `ref-finance-101.testnet`, pool **#2969** |
| Test USDC | `usdc.fakes.testnet` |

Explorer: https://testnet.nearblocks.io/address/game.catchami-dev.testnet

### 18.2 The vault: every pet has a wallet

The game contract holds all in-game $CATCHAMI and keeps a balance per **bucket**: `User(account)`, `Pet(tokenId)`, `Hq`, `Team`, `Merchants`. The token contract only sees one holder, the game contract; the per-pet split lives inside it.

Invariant: **sum of all buckets (total liabilities) ≤ the game contract's $CATCHAMI balance.**

### 18.3 How gameplay reaches the chain (settlement)

```
 gameplay action ──► ledger journal (instant) ──► every ~30 s (or "Sync now")
                                                  net all unsettled journals per bucket
                                                  ──► one settle(batch_id, deltas, journal_hash, ack_withdrawals)
```

The contract enforces these rules on every batch:

| Rule | Why |
|---|---|
| The deltas must **sum to zero** | The server can never create coins |
| `batch_id` must be the next number | No replays, no gaps |
| HQ debits ≤ **20B/day** (permanent hard cap) | Limits damage if the server is compromised |
| Pet / user debits ≤ a daily allowance (owner-signed, or the default 1B/day) | Owners can cap what the game spends |
| The Team bucket can never be debited by settlement | The team's share is safe |
| A debit can't dip into funds reserved by a withdrawal request (except one less than 10 min old) | Withdrawals are protected |
| `journal_hash` = sha256 of the settled journal IDs | Each batch links to the exact ledger entries |

Journal entries that touch the `chain` account (deposits and withdrawals) are mirrors of on-chain events, so they're never settled again.

### 18.4 Minting and custody

- The chain worker scans for unminted pets and gear and calls `mint` (operator only, attaching 0.02 NEAR for storage, with the excess refunded).
- Owner = the player's NEAR account; guests' NFTs go to the operator account as custody.
- When a guest links an account, or a wallet player buys a custody pet in-game, the worker calls `nft_transfer` to their account.
- Minting is idempotent: if the token already exists, the worker just records it.

### 18.5 Deposits (coins entering the vault)

`ft_transfer_call` to the game contract with a message:

| Message | Credits |
|---|---|
| `"deposit_user"` | The sender's own User bucket |
| `{"deposit_for":{"account_id":X}}` | Someone else's User bucket (used for purchases) |
| `{"deposit_pet":{"token_id":T}}` | A pet's piggy bank |
| `"deposit_hq"` | HQ (the 40T was funded this way) |

Every deposit is recorded on-chain with a sequence number. The worker reads `deposits_since(cursor)` and books `chain → account` in the ledger.

### 18.6 Withdrawals (coins leaving the vault)

```
1. Player signs  request_withdrawal({Pet: tokenId}, amount)   → funds reserved on-chain
2. Worker sees it → puts a matching hold in the ledger → next settle acknowledges it
3. Player signs  execute_withdrawal(id)  → contract sends $CATCHAMI to the player's account
4. Worker sees "Executed" → books pet → chain in the ledger
```

- **Escape hatch:** if the server never acknowledges, the player can execute anyway after **24 hours**.
- If the pet changes hands before execution, the request is cancelled.
- In the app this is one "Withdraw" button: the player approves two wallet (or NEAR Auth) pop-ups.

### 18.7 Trust model

| The server CAN | The server CANNOT |
|---|---|
| Decide game outcomes (gathering, prices, battle results) | Create coins (batches must balance) |
| Move coins between buckets within the caps | Spend more than 20B/day from HQ, or a pet's daily allowance |
| Mint NFTs, move custody NFTs | Touch the team bucket, or NFTs in a player's wallet |
| Acknowledge withdrawals quickly | Block a withdrawal for more than 24 h |

What players trust is the game's outcomes; those random rolls are committed in advance and checkable (§20).

### 18.8 Reconciliation

`GET /api/admin/reconcile` checks:
- the ledger sums to zero, has no negative accounts, and its cached balances match postings and holds
- treasury days stayed within budget
- the vault's on-chain $CATCHAMI balance ≥ what the ledger says it holds ("matched")

It runs automatically every 5 minutes and logs an alert on any issue.

---

## 19. Buying, withdrawing, trading

### Buy $CATCHAMI (Coin Vault → 🪙 Buy)

| Step | Real or simulated |
|---|---|
| Pick an amount ($1–$500; $2,000 per player per day on testnet) | — |
| **Card** (3.5% fee shown) or **Any crypto** via NEAR Intents (100+ assets, live USD prices, ~0.1% fee) | 🟡 Payment simulated |
| Price: live quote from the Ref pool (USDC → CATCHAMI) | ✅ Real |
| Delivery: `market.catchami-dev.testnet` sends `ft_transfer_call` → vault → your Coin Vault bucket | ✅ Real transaction (with an explorer link) |

### Withdraw (Coin Vault → 📤 Withdraw, or a pet's Wallet tab)

Pick a pet and an amount, then: sync → sign the request → the game approves → sign the claim → the coins land in your NEAR account (§18.6). Guests are asked to connect Google or a NEAR wallet first.

### Trade (Coin Vault → 💱 Trade)

| Tab | What happens |
|---|---|
| **Sell for USDC** | Live quote, then your wallet signs `ft_transfer_call` to Ref with a swap action (1% max slippage) → USDC arrives in your account. ✅ Real testnet swap |
| **Cash out** | USDC → bank account. 🟡 Simulated; no bank details are collected |

### Pool

Seeded with **300B CATCHAMI + 100,000 test USDC**, about **3M CATCHAMI per $1**. On mainnet the same flow would use a real pool and real liquidity.

---

## 20. Fairness and anti-abuse

- **Commit-reveal randomness:** each hour the server publishes SHA-256(seed) first. Every catch, rarity, gear, battle chamber and spoils roll is `HMAC(seed, label)`, and the seed is revealed when the hour ends ("🎲 Fair rolls" page). The client never supplies randomness.
- **Server-authoritative play:** replays, impossible timings and out-of-range actions are rejected.
- **Catching:** live-burst liveness check, perceptual duplicate check, 10-minute window, nothing charged for invalid captures, 30 catches a day.
- **Battles:**
  - same-owner battles are blocked
  - cooldowns apply
  - the 50K purse is protected
  - listed, gathering or shopping pets can't battle
  - settlement is one atomic transaction
- **Marketplace:** stale-balance check, no double sale, withdrawals locked while listed.
- **Payments:** idempotent request IDs, per-user rate limits, daily purchase cap.
- **NEAR Auth relay:** login required, only your own login, 1 per 6 s.
- **Operations switches:** catches, trades, battles and withdrawals can each be paused. The contract owner can pause minting, settlement and the marketplace (never withdrawals).

---

## 21. Server internals

### Main loops

| Loop | Interval | Job |
|---|---|---|
| World tick | 10 Hz | Movement, gathering, needs, merchants, AI, battle clocks, state to clients |
| Demand recompute | 60 s | Demand index per resource |
| Chain worker | 8 s | Index deposits → index withdrawals → mint → custody transfers → settle (every 30 s, or on "Sync now") |
| Reconcile | 5 min | Ledger and vault checks (§18.8) |
| Capture sweep | 60 s | Expire unused captures |

### Main API

| Route | What |
|---|---|
| `POST /api/auth/guest` · `/api/auth/near` · `/api/auth/near-auth` | Sign in (guest / wallet NEP-413 / NEAR Auth ID token) |
| `POST /api/near/link` · `/api/near-auth/link` | Link a wallet / Google to the current player |
| `POST /api/near-auth/sign` | Relay a NEAR Auth MPC signature request |
| `GET /api/me` · `/api/economy` · `/api/fairness` | Account, public economy numbers, fairness seeds |
| `GET /api/catch/quotes` · `POST /api/catch/validate` · `/api/catch/attempt` · `GET /api/catch/attempt/:id` | Cube prices, camera capture check, cube throw and its result |
| `POST /api/pets/:id/fund` · `/withdraw` · `/craft` · `GET /history` | Piggy bank moves, crafting, coin history |
| `GET /api/market` · `POST /api/market/list` · `/:id/buy` · `/:id/cancel` | Marketplace |
| `GET /api/chain` · `/api/chain/me` · `POST /api/chain/sync` | Chain status, the player's on-chain view, Sync now |
| `GET /api/pay/assets` · `POST /api/pay/quote` · `/api/pay/buy` · `GET /api/pay/history` | Buying $CATCHAMI |
| `GET /api/swap/quote` | Sell quote for the in-wallet USDC swap |
| `/ws` | Real-time game protocol (moves, gather, talk, shop, battle) |

### Database (main tables)

`users` (incl. `near_account`, `chain_bucket`), `accounts`, `journal` (+ `settled_batch`), `postings`, `holds`, `pets` (+ `nft_token_id`, `nft_owner`, `mint_tx`), `equipment`, `merchants`, `hq_inventory`, `treasury_days`, `fairness_epochs`, `catch_attempts`, `battles`, `listings`, `outbox`, `chain_withdrawals`, `chain_batches`, `purchases`, `kv`.

Each network has its own local database (`DATA_DIR/pg` for dev, `DATA_DIR/pg-testnet` for testnet), so dev test units never mix with testnet tokens.

---

## 22. Running and deploying

### Local

| Command | What |
|---|---|
| `node apps/server/src/index.ts` | Game server on :8797 (network from `.env`) |
| `pnpm --filter @catchami/web dev` | Web on https://localhost:5173 (LAN HTTPS for phone cameras) |
| `pnpm --filter @catchami/web dev:nearauth` | Web on http://localhost:3000 (the NEAR Auth testnet origin) |
| `pnpm --filter @catchami/web dev:nearauth:live` | The same, but using the live testnet server |
| `pnpm test` | 49 tests (shared rules, game, minigames), all passing |
| `pnpm sim` | 30-day economy simulation |

Only **one** server may run testnet with the operator key at a time. The local `.env` is on `dev` because Railway runs testnet.

### Railway (live)

Build: `pnpm --filter @catchami/web build && pnpm models` · Start: `node apps/server/src/index.ts` · Health check: `/api/economy` · Volume at `/data`.

| Variable | Value |
|---|---|
| `CATCHAMI_NETWORK` | `testnet` |
| `DATA_DIR` / `MEDIA_DIR` | `/data` / `/data/media` |
| `SESSION_SECRET`, `ADMIN_TOKEN` | Random secrets |
| `ALLOWED_ORIGINS` | `https://catchami-production.up.railway.app` (+ `http://localhost:3000` for the NEAR Auth laptop demo) |
| `PUBLIC_URL` | `https://catchami-production.up.railway.app` (NFT media links) |
| `NEAR_TOKEN_CONTRACT` / `NEAR_GAME_CONTRACT` | `token.catchami-dev.testnet` / `game.catchami-dev.testnet` |
| `NEAR_OPERATOR_ACCOUNT` + `NEAR_OPERATOR_KEY` | Operator account + its key (secret) |
| `NEAR_MARKET_ACCOUNT` + `NEAR_MARKET_KEY` | Market account + its key (secret) |
| `NEAR_REF_POOL_ID` | `2969` |
| Optional | `NEAR_RPC_URL`, `NEAR_AUTH_CLIENT_ID` (server) / `VITE_NEAR_AUTH_CLIENT_ID`, `VITE_NEAR_AUTH_ORIGINS` (web build), `OPENAI_API_KEY` |

Keys live in `~/.near-credentials/testnet/` on the machine that created the accounts. They are never in the repo.

### Running costs on testnet

The operator pays for mints (~0.006 NEAR each), settlement gas, custody transfers, token registrations (0.00125 NEAR), NEAR Auth relays, and 0.05 NEAR for each new Google account. It started with about 8 test NEAR; top it up from a faucet account when it runs low.

### Contracts

Built with stable Rust for MVP wasm (`RUSTFLAGS="-C target-cpu=mvp"`). Use `cargo near build reproducible-wasm` (Docker) before any mainnet deploy. See `docs/TESTNET.md` and `docs/SETUP.md`.

---

## 23. The trailer project

`trailer/` is a separate Remotion project that produces the hackathon trailer (1920×1080, ~112 s, H.264 + AAC). Every gameplay shot is a real recording from the live testnet site; nothing is mocked.

| Part | How |
|---|---|
| Recording | A headless Chrome with a virtual camera (`--use-file-for-fake-video-capture`) feeding a looped, gently moving clip of a real cat photo, so the real camera-catch flow runs end to end. A "director" process drives the page over Chrome DevTools: it steers the pet through the game's own WebSocket, plays the gathering minigames by pressing Space at the right moment (the server grades every tap as normal), auto-plays Bubble Roulette turns, and records with the DevTools screencast |
| The catch | The real catch of the user's cat: **Pudding**, a mythic cat, minted as NFT `a-pet_t7AnQPecSY1S` on `game.catchami-dev.testnet` with a 400K piggy bank |
| Narration | Kokoro TTS, voice `af_heart` (Apache-2.0, OK for public promo), one file per line for precise timing (`tools/narration.json`, `tools/narrate.mjs`) |
| Music | Original, synthesized from scratch in `tools/music.mjs` (no samples or borrowed melodies), with sections timed to the scenes |
| Sound effects | `tools/sfx.mjs`, using the same tone/noise recipes as the game's `sfx.ts` |
| Edit | `src/timeline.ts` (shot list, narration timing, labels, sound cues) and `src/Trailer.tsx` (framing, transitions, captions in Fredoka, overlays, mix) |
| Proof shots | Pudding's real mint transaction and settlement batch #16 on NEAR testnet (via testnet.near.rocks), tagged "NEAR testnet · real transactions" |

Render: `npx remotion render src/index.ts Trailer out/catchami-trailer.mp4` (from `trailer/`). The ~1 GB of raw footage and the rendered MP4 stay on disk and are not in git. A second version of the trailer (60 fps capture, new story narration) is in progress in `trailer/`.

---

## 24. Known limits, risks, next steps

### Known limits today

0. **The Railway site is down** ("Application not found" from Railway). Check the service in the Railway dashboard.
1. **NEAR Auth on the live domain** needs NEAR's approval (only `http://localhost:3000` works on the shared testnet client).
2. A NEAR Auth sign-in and a NEAR Auth-signed transaction haven't been completed end to end yet. Wallet withdraw and swap were tested with a test account standing in for a player, but not yet clicked through with the Meteor pop-ups.
3. Pets whose NFT is in a player's wallet can't be listed in the in-game market.
4. If someone transfers an NFT outside the game, the server doesn't notice yet.
5. Card, Intents and bank cash-out are simulated on testnet.
6. Rarity odds are generous demo odds.
7. The contracts' unit tests don't build on this Windows Rust setup; the contracts were verified with live testnet calls instead.

### Risks before mainnet

1. **Bubble Roulette with real-value coins** is mostly chance. Get legal advice first; it's switched off for real tokens.
2. **Multi-account abuse:** free accounts plus a guaranteed first catch. Consider withdrawal locks on starter coins and new pets.
3. **Pricing once the coin trades:** price purchases from the pool (already done) and watch arbitrage.
4. **World size:** shard at about 250 pets per world, or add merchants.
5. **Custody and server keys:** move the operator key to a key-management service, the owner to a multisig, and team tokens to a vesting contract. Get the contracts audited (they are marked DRAFT).

### Next steps

1. Bring the Railway service back, push the autopilot fix, and apply for NEAR Auth approval of the live domain.
2. Click through a real wallet withdraw and swap with Meteor on testnet.
3. Detect NFT transfers made outside the game; allow on-chain listing (NFT approvals) for wallet-held pets.
4. Solana / EVM sign-in (for example through NEAR chain signatures).
5. Mainnet: real payments (card on-ramp, NEAR Intents), a real liquidity pool, an audit, reproducible builds.

---

## 25. Glossary

| Term | Meaning |
|---|---|
| **$CATCHAMI / coins** | The game's fungible token (NEP-141, 18 decimals, 100T fixed supply) |
| **Piggy bank** | A pet's own coin balance; on-chain, the vault bucket `Pet(a-<id>)` |
| **Coin Vault** | The player's wallet screen; on-chain, the bucket `User(<account>)` |
| **HQ** | The game treasury that pays merchants (40% allocation) |
| **Vault / buckets** | The game contract's per-owner balances inside its single token balance |
| **Settlement / batch** | One on-chain transaction applying the net result of recent gameplay |
| **Custody** | NFTs the operator account holds for guests until they link an account |
| **Operator** | The game server's NEAR account; mints and settles within contract limits |
| **NEAR Auth** | Google / email / passkey login controlling a NEAR account via NEAR's MPC signer network |
| **Implicit account** | A NEAR account whose name is the hex of its public key; exists once funded |
| **NEP-413** | Signed-message standard used for wallet sign-in (no gas) |
| **Ref pool #2969** | The $CATCHAMI/USDC trading pool on Ref Finance testnet |
| **Commit-reveal** | Publishing a seed's hash before use and revealing it after, so rolls can be checked |
| **Demo rivals** | Simulated Keepers' pets that battle for bags only, never coins |
