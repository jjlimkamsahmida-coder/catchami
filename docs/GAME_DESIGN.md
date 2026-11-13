# Catchami — Game & Economy Design

> Config version `2026-11-13.1`. Every number in this document comes from
> `packages/shared/src/config.ts` (the single source of truth) or the code that
> uses it. Change a number there, bump `ECONOMY.version`, re-run `pnpm sim`.

Contents

1. [The game in one page](#1-the-game-in-one-page)
2. [The core loop](#2-the-core-loop)
3. [Onboarding & the tutorial](#3-onboarding--the-tutorial)
4. [The world](#4-the-world)
5. [Pets](#5-pets)
6. [Catching](#6-catching)
7. [Pet needs: energy, hunger, HP](#7-pet-needs-energy-hunger-hp)
8. [Gathering](#8-gathering)
9. [Merchants & prices](#9-merchants--prices)
10. [Demand (supply & consumption)](#10-demand-supply--consumption)
11. [Food, medicine & imported goods](#11-food-medicine--imported-goods)
12. [Crafting & gear](#12-crafting--gear)
13. [Battles: Bubble Roulette](#13-battles-bubble-roulette)
14. [Marketplace](#14-marketplace)
15. [Autopilot](#15-autopilot)
16. [Money: supply, accounts & the ledger](#16-money-supply-accounts--the-ledger)
17. [HQ treasury & the daily budget](#17-hq-treasury--the-daily-budget)
18. [Every coin flow (faucets & sinks)](#18-every-coin-flow-faucets--sinks)
19. [Who earns what](#19-who-earns-what)
20. [Worked examples](#20-worked-examples)
21. [Simulation results](#21-simulation-results)
22. [Fairness & anti-abuse](#22-fairness--anti-abuse)
23. [What is real today vs. simulated](#23-what-is-real-today-vs-simulated)
24. [Risks & open decisions](#24-risks--open-decisions)
25. [Tuning knobs (quick reference)](#25-tuning-knobs-quick-reference)

---

## 1. The game in one page

Catchami is a mobile-first, multiplayer 2D pet game. You **catch real cats and
dogs with your phone camera**; each catch becomes a unique pet (an NFT on NEAR
once contracts are live) with its own stats, sticker art and **its own coin
balance (piggy bank)**. Pets live in a shared world where they **gather
resources, sell them to travelling merchants, buy food, craft gear, battle other
players' pets in Bubble Roulette, and can be sold on the marketplace** — piggy
bank included.

Design pillars

- **Real-world catching** — the only way to get a new pet is a live photo of a real animal.
- **A closed, honest economy** — the total supply is fixed (100T $CATCHAMI). Nothing is printed. Every coin a player earns was paid by HQ, which is funded only by what players spend.
- **Your pet is a little business** — it earns (gathering), spends (food, medicine, gear) and can win or lose (battles). Good play and good strategy show up in its balance.
- **Self-balancing** — prices follow demand, HQ's spending follows revenue, and merchants physically limit how much can be bought.
- **Fair and checkable** — every random roll (catch, rarity, battle, gear) uses a commit-reveal seed anyone can verify afterwards.

$CATCHAMI is called "coins" in the game. Amounts below are whole coins
(`1M` = 1,000,000). Reference rate used for intuition: the starter pouch sells
**10M coins for 1 NEAR**.

---

## 2. The core loop

```
          ┌──────────── buy coins (starter pouch) ────────────┐
          ▼                                                    │
   CATCH a real cat/dog ──► pet gets 40% of the cube as its piggy bank
          │
          ▼
   GATHER (minigame or autopilot) ──► bag fills ──► SELL to a merchant (coins from HQ)
          │                                              │
          ▼                                              ▼
   costs energy + hunger                     merchant delivers goods to HQ stock
          │                                              │
          ▼                                              ▼
   BUY MEALS / MEDICINE (coins → HQ 90% / team 10%) ◄── kitchen cooks from that stock
          │
          ├──► CRAFT gear (wood + stone + fee)      → better stats, tradable
          ├──► BUBBLE ROULETTE vs other players     → winner takes a share of the loser's coins & bag
          └──► MARKETPLACE: sell / buy pets & gear  → 5% fee (2.5% HQ, 2.5% creator)
```

The loop is closed: coins go **HQ → merchants → pets → shops/fees → HQ**. HQ's
daily spending is tied to how much players spent, so the faucet follows the
sinks.

---

## 3. Onboarding & the tutorial

Stages: `intro → wallet → catch → name → world → tutorial → done`.

1. **Intro** — title screen, "How to play", "How coins work".
2. **Wallet** — sign in with NEAR (testnet today) or as a guest, then pick a starter pouch.
3. **Catch** — your first catch always succeeds (rarity is still a fair roll). On a PC the game shows a QR code that opens the camera on your phone.
4. **Name** your pet.
5. **Tutorial in the Keeper's Glade** — ten short tutorials ("Tutorial 1…10"), each in its own walled-off arena or screen, with a pointing hand and a glowing highlight on every button to tap:

| Tutorial | Where | Goal |
|---|---|---|
| 1 First Steps | Empty meadow with a flag and a glowing ground ring | Walk to the flag (joystick on phones, arrow keys / WASD on PC) |
| 2 Gathering | One spot each of wood, herbs, stone, fish | Gather all four. Then an info popup explains bags and selling |
| 3 Trading | Merchant Mari's stall | Open shop → **Sell everything** |
| 4 Hungry! | New scene: the pet arrives with an **empty food bar** (highlighted) | Walk to **Chef Coco** → Open shop → **Buy meal** |
| 5 Ouch! | New scene: the pet arrives at **0 HP** (heart bar highlighted; it can still walk slowly) | Walk to **Nurse Nana** → Open shop → **Buy medicine** |
| 6 Crafting | New scene: the workshop. Smith Sora hands you the wood and stone for Trail Boots | Walk to Smith Sora → Open shop → **Craft from bag**; then learn that gear goes to the Profile's Gear tab |
| 7 Battles | Coach Kiki, a practice partner | Walk up to her and tap **⚔️ Battle**, read How to Play, then win a practice match (no HP or loot at stake). The hand points at both splash buttons |
| 8 Marketplace | Bottom menu appears | Tap **Market** in the bottom menu, look around, come back |
| 9 Profile | Pet Profile page | Tap **Profile** → learn the Bag (bag space bar at the bottom) → open **Autopilot** (on by default, explained) → open **Piggy bank** (explained) |
| 10 Graduation | Portal | Step into the portal to Paw Village |

Tutorial rules: other Keepers' pets aren't shown in the Glade; the profile badge and wallet are locked until the tutorial ends; leaving the tutorial restores full HP, food and energy. Tutorial spots hold only 10 units and refill 15 s after
emptying (the bag can never fill up and block you). Meals in the Glade don't
need HQ fish stock.

---

## 4. The world

One shared map (232 × 60 tiles, 32 px tiles).

| Area | Battles? | What's there |
|---|---|---|
| **Paw Village** | No (safe zone) | HQ Castle (merchants restock here), West/East gates, warp rings |
| **Whispering Forest** | Yes | 11 wood, 9 herb, 8 fish spots (fish next to water), Moonlit Lake, Paw Ruins |
| **Mining Valley** | Yes | 15 stone spots, Old Mine, Forge |
| **Keeper's Glade** | No | Tutorial arenas (4 spots, Merchant Mari, Coach Kiki, market stall, portal) |

Resource spots hold 100,000–500,000 units each (fixed per spot) and regrow
10 units per regrow period (fish 70 s, herbs 80 s, wood 60 s, stone 110 s). In
practice spots never run dry; **the real limits are bag space, energy and
merchant carts.**

---

## 5. Pets

### Base stats by species

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

- **Bag size** = carry × 10 → cat **560**, dog **660** weight.
- **Species gathering affinity** (faster gathering): cats fish +8%, herbs +3%; dogs wood +6%, stone +5%.
- **Natural variation:** each stat ±4%, rolled at catch.
- **Rarity bonus:** extra stat budget of common 0 / uncommon +1% / rare +2% / epic +3% / legendary +4% / mythic +5%, spread across stats. On purpose this is smaller than natural variation: rarity is mostly collectible value.
- **Traits:** each pet rolls 2 hidden traits:

| Trait | Effect |
|---|---|
| Swimmer / Forager / Lumberjack / Digger | +6% gather speed on fish / herbs / wood / stone |
| Sturdy | +3% defense, −1.5% speed |
| Scrappy | +3% attack, −1.5% defense |
| Packrat | +5% carry, −1% speed |
| Zoomies | +4% speed, −2% max energy |
| Lucky Whiskers | +5% luck (bigger Bubble Roulette spoils) |
| Tireless | +4% max energy, −1% attack |
| Chonk | +4% max HP, −2% speed |
| Nimble | +2% speed, −1% defense, +1% luck |

### Rarity odds after a successful catch (DEMO odds, make rarer before launch)

| Cube | Common | Uncommon | Rare | Epic | Legendary | Mythic |
|---|---:|---:|---:|---:|---:|---:|
| Basic | 30% | 25% | 20% | 12% | 8% | 5% |
| Enhanced | 20% | 22% | 22% | 16% | 12% | 8% |
| Premium | 10% | 15% | 25% | 20% | 18% | 12% |

---

## 6. Catching

1. Point the phone camera at a real cat or dog. The client sends a **live burst of 2–3 frames**.
2. Server-side checks (nothing is charged if any fail):
   - an animal detector (score ≥ 0.6)
   - liveness: the frames must differ slightly, so a static photo of a photo fails
   - a duplicate check: perceptual hash within Hamming distance 6 of an earlier catch
3. The valid capture is held for **10 minutes** while you choose a cube:

| Cube | Cost | Catch chance | Cost per pet on average* |
|---|---:|---:|---:|
| Basic | 1M | 60% | ≈ 1.27M |
| Enhanced | 3M | 80% | ≈ 2.55M |
| Premium | 8M | 100% | 4.8M |

\* What actually leaves your hands, counting failed throws and the 40% that stays in the pet.

**Where the cube's coins go**

| Outcome | Pet's piggy bank | HQ | Team (creator) |
|---|---:|---:|---:|
| Success | **40%** | **50%** | **10%** |
| Failed (real animal wriggled away) | — | 100% | — |
| Not an animal, a duplicate, or expired | nothing charged | | |

Limits: your first catch is guaranteed. 30 catches per player per day (90
capture checks).

**Starter pouches** (one per account; simulated purchases on testnet):

| Pouch | Coins | Price | Coins per NEAR |
|---|---:|---:|---:|
| Sprout Pouch | 10M | 1 NEAR | 10M |
| Bloom Bag | 25M | 2 NEAR | 12.5M |
| Grove Chest | 60M | 4 NEAR | 15M |

---

## 7. Pet needs: energy, hunger, HP

| Rule | Value |
|---|---|
| Energy | 0–1,000. Below **40** a pet is too tired to gather |
| Walking | 1 energy per second |
| Resting | Energy refills by itself at +0.6 per second (about 28 min from empty to full) whenever the pet isn't gathering, walking or battling, and hunger is below 700. There is no nap button |
| Hunger | 0 = full, 1,000 = starving. Rises from full to starving in **5 hours**, plus gathering hunger (§8) |
| Starving (hunger 1,000) | −0.6 energy per second. At 0 energy the pet goes **inactive** until it is fed |
| HP | Max about 1,000. Only Bubble Roulette lowers it |
| 0 HP | The pet can still **walk (slowly), sell and buy medicine**, but **can't gather or battle** until healed. Medicine works straight away, no cooldown |

Upkeep: an idle pet needs about **14 meals a day (≈ 96K)** to stay fed. A
working pet needs more because gathering adds hunger. This upkeep is the
game's biggest coin sink and why every pet has to work.

---

## 8. Gathering

Every successful hit gives **10 units** (autopilot, or a "good" minigame tap).
A **perfect** tap gives **20**. A miss gives 0. Each minigame attempt costs 3
energy whatever the result, and every unit gathered costs that resource's energy
and hunger:

| Resource | Base price per unit | Weight | Energy per unit | Hunger per unit | Value per bag slot | Seconds per hit (gather 100) | Minigame |
|---|---:|---:|---:|---:|---:|---:|---|
| Herbs | 50 | 1 | 1.5 | 0.75 | 50 | 4.2 | Pull (release at the right tension) |
| Fish | 100 | 2 | 3 | 1.5 | 50 | 5.0 | Fishing (stop the fish in the zone) |
| Wood | 150 | 3 | 4.5 | 2.25 | 50 | 5.5 | Chop (hit the marker in the zone) |
| Stone | 200 | 4 | 6 | 3 | 50 | 7.0 | Mine (stop the spinning marker in the zone) |

Design intent: **every resource is worth the same per bag slot and costs the
same per bag slot**, so there's no single best grind. What you gather depends on
demand (§10), which merchant is nearby (§9), your pet's species and traits, and
what you want to craft.

- **A full bag** is worth about 28K (cat) or 33K (dog) at normal demand (halved in config 2026-11-14 to make earning harder). Filling it costs about 840 / 990 energy and 420 / 495 hunger.
- **A meal** (+220 energy) pays for about 147 weight of gathering ≈ 7.3K of goods, about break-even on 7K. Buying meals is a way to go faster, not a money printer. Resting is free but slow.
- **The minigame is skill:** perfect taps double the yield per attempt.
- **Server rules:** the server grades every tap, caps the yield by spot stock and bag space, and rejects replays and impossibly fast taps.

---

## 9. Merchants & prices

Four travelling merchants carry **real coins from HQ** and walk fixed routes
(52 px/s, 18 s set-up at each stop, 25 s rest at HQ):

| Merchant | Pays more for | Pays less for | Route |
|---|---|---|---|
| Finn the Fishmonger | Fish +12% | Wood −6% | HQ → West Gate → Forest Trail → Moonlit Lake → Forest → back |
| Sage Marigold | Herbs +12% | Stone −6% | HQ → West Gate → Forest → Paw Ruins → back |
| Timber Tom | Wood +12% | Fish −6% | HQ → West Gate → Moonlit Lake → Paw Ruins → Forest → back |
| Rocky Ruby | Stone +12% | Herbs −6% | HQ → East Gate → Valley Pass → Mining Valley → Old Mine → Forge → back |
| Merchant Mari | — | — | Tutorial stall in the Glade (does not travel) |

- **Price paid** = base price × demand index (60%–175%) × merchant taste × treasury factor (100% unless HQ is near its floor, §17).
- **Cart:** each merchant carries up to **4,000 weight**. A full cart sends them home to unload at HQ, where the goods become **real HQ stock**.
- **Purse:** each trip is funded with **0.2M–2M** from the day's budget. A merchant low on coins (below 8% of the minimum purse) heads home.
- **Selling** sells what's worth most per weight first, limited by cart space and the merchant's purse.

---

## 10. Demand (supply & consumption)

Yes, demand works the way you'd expect from real usage:

| Resource | Consumed by (raises its price) | Supplied by (lowers its price) |
|---|---|---|
| Fish | Meals (10 fish each, including imported meals) | Players selling fish |
| Herbs | Medicine (20 herbs per dose) | Players selling herbs |
| Wood | Crafting | Players selling wood |
| Stone | Crafting | Players selling stone |

How the index is calculated:

```
target  = (consumed rate + 4) / (supplied rate + 4)      (the +4 stops a few events swinging it)
rates   = exponentially smoothed, 3-hour half-life
index   = moves toward target by at most 2.5% per recompute (every 60 s)
range   = 60% … 175%   ·  "low" below 90%, "high" above 115%
```

So more players eating means fish pays more, which pulls players to fishing,
which restocks the kitchen. Everyone dumping wood makes wood cheaper, which
pushes players to something else. Demand from tutorial meals in the Glade
doesn't count.

---

## 11. Food, medicine & imported goods

| Item | Price | Effect | Uses from HQ stock | If HQ is out of stock |
|---|---:|---|---|---|
| Meal | **7K** | −350 hunger, +220 energy | 10 fish | **Imported meal 14K** (2×) |
| Medicine | **35K** | Heals 40% of max HP; brings a 0-HP pet back to work | 20 herbs | **Imported 70K** (2×) |

- Coins split **90% HQ / 10% team**.
- **Meals are the only food;** pets cannot eat fish from their own bag.
- **Imported goods:** a pet can never get stuck because the kitchen is empty. The double price is a penalty that also tells players fish (or herbs) are in demand.
- **In the tutorial Glade,** meals don't use stock.

---

## 12. Crafting & gear

Each pet has 2 gear slots. **Gear is crafted at a merchant** (Open shop → 🛠️ Craft gear; the server checks the pet is standing at an open merchant). The Profile's Gear tab only equips and unequips. Crafting uses wood and stone from the pet's bag
first; missing materials can be bought from HQ's real stock at **125% of the
current merchant price**. The coin fee splits 90% HQ / 10% team.

| Gear | Fee | Wood | Stone | Bonus |
|---|---:|---:|---:|---|
| Trail Boots | 40K | 60 | 20 | +6% speed |
| Picker Gloves | 40K | 40 | 30 | +5% gather |
| Bark Armor | 70K | 80 | 60 | +7% defense |
| Heavy Stone Armor | 90K | 40 | 120 | +11% defense, −6% speed |
| Forager's Tool | 50K | 70 | 40 | +3% gather, +4% carry |
| Pebble Sling | 70K | 50 | 80 | +7% attack |

- Gear rolls a rarity (common 70%, uncommon 20%, rare 8%, epic 1.7%, legendary 0.25%, mythic 0.05%). The multiplier ranges from ×1.00 for common to ×1.25 for mythic.
- Total gear bonus is capped at **+12%**.
- Gear is tradable on the marketplace. Equipped gear goes with a pet when the pet is sold.
- Crafting is the **only** thing that uses up wood and stone, so it drives their demand.

---

## 13. Battles: Bubble Roulette

The one battle game. Live, turn-based PvP between online players. For the demo,
**demo rivals** (pets of simulated Keepers, e.g. "Sid's Mochi") roam the Forest and
Mining Valley: 5 in the Forest, 4 in the Valley. They walk up to your pet when it's idle out in the wild and **start a Bubble Roulette battle right away** (battles are forced: there is no accept/decline, for real players too). The same pet is challenged at most once every 45 s. Demo rivals only put **bags** at stake (they carry a small bag of their own); coins never move in demo matches. Coach Kiki in the tutorial is practice only. A ⚔️ **Battle** button appears whenever another Keeper's pet or a rival is within range.

### Rules

- **How to play** is shown at the start of every match (and from the "?" button); the first turn gets 10 s extra.
- **The launcher** holds **6 bubbles, 3 of them loaded**, in a hidden order from the fair seed.
- **On your turn** (15 s), splash yourself or splash your opponent.
  - A loaded bubble soaks the target for **50 battle HP**, so two soaks end a full-HP pet.
  - Splash **yourself** and it's empty: **you get another turn**.
  - The launcher does **not** reload after a hit. It only reloads when no loaded bubbles are left.
- **Battle HP** is your pet's real HP shown as 0–100. The match ends when one pet reaches 0.
- **Missed turns:** a missed turn passes. Two missed turns in a row forfeit, and leaving counts as a loss.

### Who can battle

- Both pets are in the Forest or Mining Valley (never in Paw Village or the Glade).
- Each has at least **120 energy**, hunger below **900**, at least **20 battle HP**, is not listed for sale, and is **not gathering** (accepting a challenge stops gathering).
- The challenged owner accepts within 25 s. "Avoid battles" in autopilot auto-declines.
- Cooldowns: **90 s** per pet, **30 min** before the same two pets meet again.

### What a match costs

| Who | Cost |
|---|---|
| Both pets | **80 energy + 60 hunger** when the match starts |
| Both pets | HP lost to splashes (it never heals during a match) |
| Loser | Ends at **0 HP**: can't gather or battle until it buys **35K medicine** (it can still walk and trade) |

### Spoils (what the winner takes)

```
share = 10% × (2 × luck_winner / (luck_winner + luck_loser)) × random(0.5 … 1.5)
        clamped to 2% … 15%
coins taken = share × (loser's coins − 50K protected purse)
fee         = 10% of coins taken → HQ 90% / team 10%
winner gets = coins taken − fee
resources   = share × each resource in the loser's bag (limited by the winner's free bag space)
```

- Equal luck gives a 5%–15% share, averaging 10%.
- Luck matters a little: a cat (luck 108) against a dog (96) averages 10.6% when the cat wins and 9.4% when the dog wins. Lucky Whiskers adds 5% luck.
- The first **50K** of every pet's balance is always safe, so losing never leaves a pet unable to buy food.
- Settlement is one atomic database transaction. It's recorded with the seed, every turn and the spoils, and it's verifiable afterwards.

Because both sides pay energy, hunger and HP, and every transfer pays a fee,
**battles are a net coin sink**. Over many matches the average player loses a
little. Winning more often than average is the reward.

---

## 14. Marketplace

- List a pet or a piece of gear at any price. **A pet's piggy bank and equipped gear go with it.**
- Buyers confirm the pet's current balance. If it changed since they looked, the sale is refused.
- **Fee: 5% of the price** → **2.5% HQ, 2.5% creator royalty (team)**. The seller receives 95%.
- While a pet is listed, coins can't be withdrawn from it and it can't battle.

---

## 15. Autopilot

Every pet can run on its own while you're away:

| Setting | Options |
|---|---|
| Work | low / balanced / high |
| Resource | a specific one, or "follow demand" |
| Sell | immediately / when full / best price / nearest merchant / hold |
| Battles | Accept challenges / Avoid battles (autopilot never starts a battle) |

Autopilot is **always on** (there's no off switch): whenever you're offline or not steering, the pet gathers, sells, walks to merchants for meals and medicine. Steering pauses it; it resumes when you stop. Merchants stand still while a player has their shop open.
| Eat when hunger is above | 600 by default |
| Nap when energy is below | 150 by default |
| Buy medicine automatically | yes / no |

Autopilot buys meals (imported if needed) when hunger is high and it can
afford them, naps when tired, gathers and sells. A pet with no coins and no food
goes inactive until its owner adds coins.

---

## 16. Money: supply, accounts & the ledger

| Allocation | Amount | Purpose |
|---|---:|---|
| HQ treasury | **40T** | Pays merchants. Funded back by player spending |
| Market | **55T** | Coins sold to players (pouches, later an exchange / liquidity) |
| Team | **5T** | Creator / team allocation |
| **Total, fixed forever** | **100T** | No minting after launch |

Every coin movement is a **double-entry journal** (sums to zero, idempotent,
records the config version). Accounts:

| Account | Holds |
|---|---|
| `user:<id>` | The player's wallet |
| `pet:<id>` | Each pet's piggy bank |
| `merchant:<id>` | Each merchant's purse |
| `hq` | HQ treasury |
| `team` | Creator revenue |
| `chain` | The external counterpart (on-chain vault / simulated purchases) |

Moving coins:

- **Wallet → pet:** "Add to pet".
- **Pet → wallet:** "Withdraw to wallet" (blocked while the pet is listed).
- **Wallet → NEAR:** on-chain withdrawal. Exists in code, **switched off** until the contracts are deployed.

---

## 17. HQ treasury & the daily budget

HQ is the only payer of merchants. Each UTC day it sets a **merchant budget**:

```
spendable = HQ available − reserve floor (5% of 40T = 2T)

Daily budget = min( 0.01% × spendable + 60% × 7-day average daily revenue ,
                    0.03% × spendable )
```

- **Revenue** counts only coins players actually spent: HQ's share of catches (including failed catches), meals, medicine, crafting, marketplace fees and battle fees. Merchant grants, deposits and gifts don't count, so it can't be gamed for profit.
- **Today** (38T spendable): base **3.8B/day**, cap **11.4B/day**.
- **With no revenue,** HQ halves in about **19 years**.
- **HQ grows** whenever daily revenue is above about 0.025% of spendable (≈ 9.5B/day today).
- **Below 6T** (3× the floor), merchant prices taper linearly down to 0 at the floor, and the budget can never take HQ below the floor.
- **Physical limit:** merchants can only carry about 0.8M of goods per trip. In the simulation the budget only starts to bind at around **18,000 active pets**. Below that, cart space and player effort set the faucet.

---

## 18. Every coin flow (faucets & sinks)

**Faucets** (coins entering players' hands)

| Source | From | Notes |
|---|---|---|
| Starter pouch / buying coins | Market allocation | Real money in (NEAR) on mainnet |
| Selling resources to merchants | HQ (via merchant purses) | The only game faucet, capped by the daily budget and carts |

**Sinks** (coins leaving players' hands)

| Sink | HQ | Team | Notes |
|---|---:|---:|---|
| Successful catch (the 60% not kept by the pet) | 50% of cost | 10% of cost | |
| Failed catch | 100% | — | |
| Meals 7K (imported 14K) | 90% | 10% | Main recurring sink |
| Medicine 35K (imported 70K) | 90% | 10% | |
| Crafting fee + bought materials | 90% | 10% | |
| Marketplace sale | 2.5% of price | 2.5% of price | The other 95% goes to the seller |
| Bubble Roulette fee | 9% of coins taken | 1% of coins taken | The rest moves loser → winner |

**Player ↔ player transfers** (no coins created): Bubble Roulette spoils,
marketplace sales, pet balance travelling with a sold pet.

Removed by design: daily login rewards (a pure faucet that rewarded showing up,
not playing), eating fish from your own bag (free energy), wild NPC battles.

---

## 19. Who earns what

### Players

- **By working:** in the simulation, a typical working pet earns **about 200K a day** from sales. After food it nets about **30K a day**, so a pet that starts with a 0.4M purse grows to about **1.1–1.5M after a month**. Active play earns more (perfect taps, good merchant timing, following demand).
- **By battling:** winning above average moves coins from weaker or unluckier players, minus the fee.
- **By trading:** catching rare pets, levelling a pet's balance, crafting rare gear and selling them on the marketplace.
- **Payback:** a basic pet costs about 1.27M on average and pays for itself in about **6 weeks** of typical autopilot play. Faster with active play.
- **Real money:** only once on-chain withdrawals and a market exist. Every NEAR a player cashes out comes from another player buying coins. Earning is possible, never guaranteed.

### The creator (team account)

| Source | Share |
|---|---|
| Successful catches | 10% of the cube price (100K per basic catch) |
| Meals, medicine, crafting | 10% of everything spent |
| Bubble Roulette | 1% of coins taken |
| Marketplace | **2.5% royalty** on every pet and gear sale |
| Team allocation | 5T coins |
| Pouch sales (mainnet) | The NEAR paid for coins from the market allocation |

Example: one fed pet sends about **16K a day** to the team from meals alone.

---

## 20. Worked examples

**A cat's full bag of herbs**

- 560 herbs × 50 = **28K** at normal demand.
- At Sage Marigold (+12%) with high herb demand (130%): about **81.5K**.
- Cost to gather: 840 energy (≈ 4 meals = 48K, or about 23 min of napping, free) and 420 hunger (≈ 1.2 meals).

**A day of idle upkeep**

- Hunger 4,800 → about 14 meals = **≈ 96K** (imported: about 192K).

**A Bubble Roulette loss**

- The loser holds 1M, so 950K is at stake. The share rolls 10%, so **95K is taken**.
- Fee 9.5K (HQ 8.55K, team 0.95K). The winner receives **85.5K**.
- The loser also loses 10% of each resource in its bag and drops to 0 HP, so it pays **35K for medicine** before it can gather again.
- Both pets paid 80 energy and 60 hunger.

**Selling a pet**

- Listed at 5M, so the fee is 250K (125K HQ, 125K creator) and the seller gets **4.75M**.
- The buyer also gets the pet's piggy bank and its gear.

---

## 21. Simulation results

> Latest run (config 2026-11-14.1, halved resource prices, 7K meals): typical working pet earns ≈ 105K/day (was ≈ 210K), 87–98% of pets stay active in 250-pet worlds, median pet balance after 30 days ≈ 0.5–1.0M from a 0.4M start; a basic pet pays back in roughly 3 months. Full tables in docs/ECONOMY_SIMULATION.md. The table below is the earlier run.

`pnpm sim` runs an agent-based 30-day model on the live config, with an exact
ledger and daily invariant checks. Full tables: `docs/ECONOMY_SIMULATION.md`.

| Scenario (day 29) | Pets | Active | Median pet balance | Median daily income | Merchant spend / budget |
|---|---:|---:|---:|---:|---:|
| 100 pets, one world | 220 | 100% | 2.11M | 216K | 48.8M / 3.79B |
| 1,000 pets, **one crowded world** | 2,028 | **30%** | 8.5K | 124K | 80.6M / 3.8B |
| 1,000 pets, 250 per world | 2,071 | 99.9% | 1.55M | 218K | 460M / 3.8B |
| 10,000 pets, 250 per world | 17,940 | 97.7% | 1.32M | 210K | **3.76B / 3.8B** |
| 10,000 pets, falling price + fewer signups | 11,185 | 96.8% | 1.07M | 195K | 2.25B / 3.8B |

Invariants across all scenarios had **0 violations**: the ledger sums to zero,
no account goes negative, claims never exceed supply, merchant spend never
exceeds the allowance, and HQ never dips below its floor.

Takeaways

- **Keep worlds around 250 pets** (or add merchants as a world grows). Four merchants can't serve 2,000 pets in one world.
- The daily budget formula starts to limit payouts at around 18,000 pets, which is the intended safety valve.
- 5-hour hunger keeps upkeep at about 40–50% of a working pet's income. At 45-minute hunger almost every pet went broke; at 3 hours about half did.

---

## 22. Fairness & anti-abuse

- **Commit-reveal randomness.** Each hour the server publishes SHA-256(seed) first. Every catch, rarity, gear, battle chamber and spoils roll is `HMAC(seed, label)`. The seed is revealed when the hour ends so anyone can recompute results. The client never supplies randomness.
- **Server-authoritative play:** movement, gathering timing, minigame grading, battle turns and settlement all happen on the server. Replays and impossible timings are rejected.
- **Catch protections:** live-burst liveness check, duplicate perceptual hash, 10-minute capture window, nothing charged for invalid captures, 30 catches a day.
- **Battle protections:**
  - same-owner battles are blocked
  - cooldowns apply
  - the 50K purse is protected
  - listed pets can't battle
  - pets stay locked until the spoils are settled
- **Marketplace:** stale-balance check, no double sale, withdrawals locked while listed.
- **Operations switches:** catches, trades and battles can each be paused.

---

## 23. What is real today vs. simulated

| Piece | Status |
|---|---|
| Game world, pets, gathering, merchants, shops, crafting, Bubble Roulette, marketplace | Real, server-authoritative |
| Coin ledger (all balances and transfers) | Real double-entry ledger in the game database |
| $CATCHAMI token, pet/gear NFTs, vault contracts | **Not deployed yet.** Mint and transfer jobs queue as "awaiting chain" |
| Starter pouches | **Simulated** on testnet: no NEAR is charged, test coins are credited |
| HQ 40T | Test units on the dev network (genesis), unbacked |
| On-chain withdrawals | Code exists, switched off until contracts go live |
| NEAR | Used for sign-in (testnet) |

---

## 24. Risks & open decisions

1. **Bubble Roulette with real coins.** It is mostly chance and the loser loses coins. Once coins are worth real money, many places treat that as gambling. Keep it to test coins or get legal advice before mainnet.
2. **Multi-account abuse on testnet.** Free testnet accounts mean free pouches and guaranteed catches. For mainnet:
   - starter coins can be spent but not withdrawn
   - pets from a guaranteed catch can't be traded for 7 days
   - a new pet's balance can't be withdrawn for 7 days
   - never promise that testnet progress carries over
3. **Pouch pricing once coins trade on a market.** Fixed prices invite arbitrage. Sell bundles (cube + meals) priced in NEAR or USD, or price coins from a 24-hour average with a capped bonus.
4. **Rarity odds are demo odds** (5% mythic on a basic cube). Make them rarer before launch.
5. **World size.** Shard at about 250 pets per world or scale merchants with population.
6. **More sinks people want** (future): cosmetics, bag and home upgrades (wood and stone), pet training, seasonal events, an optional paid pass. Optionally burn part of fees.

---

## 25. Tuning knobs (quick reference)

All in `packages/shared/src/config.ts` → `ECONOMY`:

| Knob | Key | Now | Raising it… |
|---|---|---|---|
| Cube prices / odds | `catch.tiers` | 1M/60%, 3M/80%, 8M/100% | slows pet growth, more HQ revenue |
| Catch split | `catch.successSplit` | pet 40 / HQ 50 / team 10 | pet share up = cheaper catches, fewer sinks |
| Resource prices | `resources.*.basePrice` | 100 / 200 / 300 / 400 | more income per bag |
| Gathering cost | `resources.*.energy` / `.hunger` | 1.5w / 0.75w | more food needed per bag |
| Units per hit | `gather.unitsPerHit` | 10 | faster bag filling |
| Hunger speed | `stats.hungerPerSec` | full→starving 5 h | higher upkeep (biggest sink) |
| Meal / medicine | `food`, `medicine` | 7K / 35K | stronger sink |
| Import premium | `*.importMultBps` | 2× | harsher stockouts |
| Demand range | `demand.minIndexBps` / `maxIndexBps` | 60%–175% | bigger price swings |
| Merchant cart / purse | `merchants.inventoryCapacity`, `tripMin/MaxBudget` | 4,000 / 0.2M–2M | more throughput per world |
| Daily budget | `hq.budgetReserveBps`, `budgetRevenueShareBps`, `budgetCapReserveBps` | 0.01% / 60% / 0.03% | bigger faucet |
| Battle share | `battle.stake.*` | 10% base, 2–15%, 50K safe, 10% fee | more coins move per match |
| Battle costs | `battle.matchEnergy` / `matchHunger` | 80 / 60 | fewer, more meaningful battles |
| Marketplace fee | `marketplace.feeBps` / `feeSplit` | 5% (HQ 50 / team 50) | more creator royalty, less trading |
