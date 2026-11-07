# Catchami architecture

```
 phone / desktop browser                       game server (Node 22+, TypeScript)                 NEAR
┌──────────────────────────┐   WebSocket    ┌──────────────────────────────────────┐   RPC   ┌──────────────────────────┐
│ React HUD + Phaser world │◀──intents─────▶│ authoritative world sim (10 Hz)       │────────▶│ catchami-token (NEP-141) │
│ camera + COCO-SSD preview│   REST/JSON    │ ledger (double-entry, Postgres)       │         │ catchami-game            │
│ never trusted            │───────────────▶│ capture verification (COCO-SSD, wasm) │◀────────│  NFTs + vault + market    │
└──────────────────────────┘                │ fair rolls (commit-reveal epochs)     │ deposits└──────────────────────────┘
                                            │ outbox → operator signer (separate)   │
                                            └──────────────────────────────────────┘
```

## Repository

| Path | What |
|---|---|
| `packages/shared` | Rules shared by server, client and simulation: `ECONOMY` config (versioned), exact bigint money, fair RNG, catch/rarity/genome, battle engine, demand + treasury math, world generator + A*, wire protocol. |
| `apps/server` | Authoritative server: HTTP API, WebSocket gameplay, world simulation and autopilot, ledger, treasury, capture pipeline, marketplace, admin, reconciliation, economy simulation (`src/sim`). |
| `apps/web` | Mobile-first client: Vite + React HUD, Phaser 3 world, capture screen, collection, market, ranks, wallet, fairness verifier, `/admin`. |
| `contracts/token` | `$CATCHAMI` NEP-141, fixed 100T supply minted once at init to HQ/market/team allocation accounts. No mint function. |
| `contracts/game` | Animal + equipment NFTs (NEP-171), vault with per-pet balances, settlement batches, withdrawals with escape hatch, atomic marketplace. |
| `docs/` | This file, STATUS (requirements + blockers), SETUP (deployment guide), economy simulation report + dashboard. |

## Authority and trust

* **The browser is never trusted.** It sends intents (`move`, `goto`, `gather`, `sell`, `buy`, `challenge`, `strategy`). Positions, gather timing, node depletion, merchant cash, prices, battles and theft are computed on the server.
* **Every financial effect is one DB transaction**: ledger entry + game state (inventory, merchant cart, HQ stock) commit together, then the in-memory world updates. A pet is locked (`busy`) while its transaction is in flight, so it can't be robbed, sell twice or spend twice.
* **Database-enforced money rules.** `accounts.balance - held >= 0` is a `CHECK` constraint; journals are idempotent (`UNIQUE(idem)`), immutable, and each sums to zero. Treasury days have `CHECK (merchant_granted <= merchant_allowance)` and `CHECK (reward_paid <= reward_pool)`. HQ stock has `CHECK (qty >= 0)`. A bug can make a transaction fail; it cannot overdraw.
* **Holds** reserve funds for in-flight obligations (withdrawals, future PvP escrow). Held funds can't be spent or withdrawn twice.
* **Reconciliation** runs every 5 minutes (and on demand in `/admin`): ledger sums to zero, cached balances equal postings, holds match, no account below zero, claims ≤ total supply, budgets within caps, and — once contracts are configured — the ledger's vault liability equals `ft_balance_of(game contract)`.

## Money flow

| Event | Ledger postings |
|---|---|
| Deposit (indexed from `deposits_since`) | chain → user / pet / hq |
| Successful catch | user −cost; pet +80%, HQ +18%, team +2% |
| Valid catch, failed roll | user −cost; HQ +100% |
| Invalid detection, missed throw, expiry, server error | nothing |
| Merchant trip | HQ → merchant:{id} (capped by daily allowance and reserve floor) |
| Sale to merchant | merchant:{id} → pet (from the merchant's real cash) |
| Food / medicine / crafting | pet −price; HQ 90%, team 10% (only if HQ has the real fish/herbs/materials) |
| Daily reward | HQ → pet (capped by the day's funded pool) |
| Marketplace sale | buyer −price; seller +98%; HQ 1.8%, team 0.2%; pet ownership (and its balance) moves |
| Withdrawal | hold on user → captured when the onchain transfer settles |

`chain` is the external counterpart account: `-balance(chain)` is what the ledger says the vault holds.

## Treasury rules (`ECONOMY.hq`)

* Daily budget = 0.05% of available HQ funds at day start, 85% merchants / 15% rewards.
* Taper: 100% while HQ ≥ 3× the reserve floor, linear to 0 at the floor (5% of 40T = 2T). Budgets never dip below the floor.
* Merchant top-ups come out of that allowance. If a merchant can't reach its minimum trip budget it sits out (`unavailable`) — no money is invented.

## Demand and prices

Consumption events (meals, medicine, crafting, eating own fish) and supply events (merchant purchases) feed exponentially smoothed rates (3 h half-life). The published index steps at most 2.5% per minute toward `(consumed+4)/(supplied+4)`, clamped to 60–175%. Merchant price = base × index × treasury factor × merchant preference.

## Fair randomness

Hourly epochs. The server stores a random seed and publishes `sha256(seed)` when the epoch starts; it reveals the seed after the hour (`GET /api/fairness`). Every roll is `HMAC-SHA256(seed, label)` with labels like `catch:{attemptId}:{clientNonce}`, `battle:{id}`, `equip:{id}`, `reward:{pet}:{day}`. The Fairness screen recomputes catches in the browser.

## Capture pipeline

1. Client: live camera, on-device COCO-SSD preview (reticle only).
2. Server `POST /api/catch/validate` with 2–3 burst frames: JPEG decode (pure JS), liveness heuristic (frames must differ slightly but match), server-side COCO-SSD (SSDLite MobileNetV2, wasm backend) on every frame, same species in ≥2 frames, score ≥ 0.6, perceptual-hash duplicate check (30 days, Hamming ≤ 6), rate limits. Only the animal crop is kept (rendered as a sticker); full frames are discarded. Pending crops are deleted after 15 minutes.
3. `POST /api/catch/attempt` with tier + client nonce: one transaction charges, splits, creates the pet + its account, and queues the NFT mint in the outbox.

## Chain integration (contracts/game)

* **Deposits**: `ft_transfer_call(game, amount, msg)` with `"deposit_user"`, `{"deposit_pet":{"token_id":…}}` or `"deposit_hq"`. The contract records each deposit with a sequence number; the server indexes `deposits_since(seq)`.
* **Settlement**: the operator submits `settle(batch_id, deltas[], journal_hash, ack_withdrawals[])`. Deltas must sum to zero, batch ids are sequential (no replay), the team bucket can't be debited, HQ debits are capped per day by a hard limit fixed at init, and each pet/user can only be debited up to the daily allowance its owner signed with `set_pet_allowance` / `set_spend_allowance`.
* **Withdrawals**: `request_withdrawal(source, amount)` reserves funds. Executable after the operator acks it, or automatically after the delay (default 24 h, owner may set 1–72 h). Pausing never blocks withdrawals. Spends that raced a brand-new request (≤10 min) may shrink it; older requests are untouchable.
* **Marketplace**: `list` / `cancel_listing`; buyers pay with `ft_transfer_call(… {"buy":{"token_id":…,"expected_pet_balance":…}})`. Ownership, balance rights, seller proceeds and the 2% fee (90/10) settle in one synchronous call; any mismatch refunds the full amount.
* **Owner** (multisig/DAO) can rotate the operator, pause, lower the HQ cap and set the delay — never move balances.

Not yet built: the operator signer service, the deposit indexer worker, and settlement batch production from the journal (see STATUS).

## Scaling

The simulation shows one compact world saturates around 300 pets (resource nodes regrow at a fixed rate). Production needs world **instances** (shards) of ~250 pets, each with its own nodes and merchants, all sharing one ledger and one global treasury budget. The `Game` class is already self-contained per world; shard routing is outstanding. Redis is not used yet: a single process holds world state; shards would be separate processes behind a router.
