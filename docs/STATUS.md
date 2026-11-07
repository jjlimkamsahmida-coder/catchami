# Catchami — status, blockers and launch gates

Last updated: 2026-11-07. **Catchami is not production-ready.** It runs end to end on a local dev network with test units. Real money needs the contract deployment, an operator signer, independent audits, legal review and payment-provider approval listed below.

Legend: **Done** = implemented and tested · **Partial** = works with stated gaps · **Not started** · **Blocked (you)** = needs your decision, account, funds or approval.

## Verification

| Check | Result |
|---|---|
| Shared rules (`packages/shared`) | 18 tests: exact splits, supply, commit-reveal, disclosed catch odds (statistical), rarity cap, equipment cap, battle fairness (Common beats Mythic >30%), treasury taper, demand caps, map reachability |
| Ledger | 6 tests incl. idempotency, DB-enforced overdraft protection, holds, 25 concurrent spends against 10 tokens |
| Detection | Real cat/dog photos detected server-side; blank image rejected; perceptual hash catches re-encoded duplicates |
| End-to-end server | Live-burst capture with exact 80/18/2 split, still-image and duplicate rejection, gather → merchant sale → HQ delivery → food (sold out until real fish arrives) → consent-gated battle → atomic marketplace sale with stale-balance refusal → clean reconciliation; autopilot works unattended |
| Contracts | 18 Rust unit tests (token 3, game 15): fixed supply, deposits, balanced/sequenced settlement, team untouchable, pet allowance, HQ hard cap, escape-hatch withdrawal, racing-spend grace, atomic sale + refunds, old owner can't withdraw after sale |
| Economy simulation | 100 / 1,000 / 10,000 animals, 30 days, 5 scenarios: **0 invariant violations** (`docs/ECONOMY_SIMULATION.md`, dashboard `docs/simulation/index.html`) |
| Browser | Verified in the in-app browser at phone size: onboarding, world, real-photo stickers walking, HUD, strategy editor. Camera capture can't be exercised in that browser — use a phone over https, or `apps/server/scripts/dev-catch.ts` |

## Requirements by milestone

### 1 — Foundation
| Item | Status |
|---|---|
| Monorepo, TypeScript, shared rules | Done |
| Authentication | Partial — device accounts with HMAC session tokens. **Missing:** NEAR wallet login (NEP-413) and social login via an embedded-wallet provider (Blocked (you): provider choice + account) |
| Database | Done — PostgreSQL schema + migrations; embedded PGlite for dev/tests; `DATABASE_URL` for real Postgres |
| Game canvas, movement, multiplayer sync | Done — server-authoritative 10 Hz, interpolation, interest management, joystick, tap-to-move, WASD |
| Replaceable asset pipeline | Done — `public/assets/manifest.json` overrides any procedural texture (ASSETS.md) |

### 2 — Financial core
| Item | Status |
|---|---|
| $CATCHAMI NEP-141 (fixed 100T, 40/55/5 at init) | Done (contract + tests). Not deployed. Not audited |
| NFT contract (animals + equipment) | Done (in `catchami-game`). Not deployed. Not audited |
| Treasury + pet balances | Done offchain; contract vault done |
| Deposits | Partial — contract records deposits; **server indexer worker not built** |
| Withdrawals | Partial — contract flow done; server holds + outbox done; **operator signer + settlement producer not built** |
| Automated reconciliation | Done for ledger internals; onchain comparison wired, activates when contracts are configured |
| Team allocation vesting contract | Not started — use an audited lockup (e.g. NEAR's lockup/vesting contracts) rather than custom code |

### 3 — Catching
| Item | Status |
|---|---|
| Live camera + on-device preview | Done (needs https on phones) |
| Server-side verification, liveness heuristic, duplicates, rate limits | Done. Limit: the liveness heuristic doesn't prove physical presence (a video of a cat would pass) |
| Throw mechanic (drag/flick, miss = free retry) | Done |
| Payment allocation, fair rarity, genome | Done |
| NFT minting | Partial — queued in the outbox (`awaiting_chain`); executed once the operator signer exists |
| Sticker treatment | Done (crop + die-cut border + grade). Background segmentation not done |
| Species | Cats and dogs. Birds etc. are detectable by COCO but disabled until accuracy is reviewed |

### 4 — Gameplay economy
| Item | Status |
|---|---|
| Four resources, finite nodes, regrowth, weights | Done |
| Hunger, energy, HP, KO (3 h cooldown + medicine), bankruptcy/inactivity | Done |
| Food & medicine only from real HQ stock | Done |
| Travelling merchants, HQ-funded budgets, delivery, unavailability | Done |
| Dynamic demand from real events + HUD widget | Done |
| Merchant info hidden until in range | Done |

### 5 — Battles and strategies
| Item | Status |
|---|---|
| Combat engine, persistent HP, theft ≤15%, cooldowns, repeat-opponent limit, consent | Done (non-redeemable) |
| Automated strategies (all spec options) incl. offline | Done |
| Real-token PvP | **Disabled by design.** Ledger supports holds; contract escrow + wager settlement not built. Requires legal sign-off (env `REAL_PVP_APPROVED`) — Blocked (you) |

### 6 — Crafting and trading
| Item | Status |
|---|---|
| Equipment crafting from real wood/minerals (+ buying HQ stock) | Done |
| Equipment bonuses with cap + trade-offs, 2 slots | Done |
| Marketplace (list, cancel, buy, fees, stale-balance guard, no double sale) | Done offchain + in contract. Onchain sync (outbox `nft_transfer`) pending signer |
| Collection, leaderboards from recorded data | Done |

### 7 — Production readiness
| Item | Status |
|---|---|
| Economy simulation + dashboard | Done |
| Admin portal (treasury, budgets, merchants, outbox, suspicious captures, trades, pause switches, log) | Done (token auth; needs SSO + roles for production) |
| Security tests | Partial — financial invariants and contract access tests done; no penetration test, no fuzzing, no external audit |
| Payments / on-ramp | Not started — Blocked (you) |
| Performance testing | Not started (simulation covers economy, not server load) |
| World sharding | Not started — **required before ~300 concurrent pets** (see Economy findings) |
| Deployment | Not started — Blocked (you): hosting, domain, NEAR accounts |

## Economy findings (from the simulation)

1. **Invariants held everywhere.** No overdraft, no budget overrun, HQ never below its floor, claims never above supply.
2. **One world doesn't scale.** At 1,000 animals on one map, node regrowth limits median income to ~50K/day, below food costs (~108K/day for 9 meals). 41% of pets become inactive by day 29 and fish stocks out. Sharded at 250 pets per world, income stays ~200K/day with 0% inactivity. → Implement world instances before launch.
3. **HQ outflow is small.** Merchants spend 2–3.6B/day at 10k pets against a 17B allowance; HQ falls about 0.1–0.3% over 30 days. Pet balances grow about 110K/day each at today's prices.
4. **That growth is a legal question, not just a balance one.** A loop where deposits plus play reliably grow balances paid from a treasury may be treated as an investment product or gambling in some jurisdictions. Get counsel before launch. Lowering resource prices or raising food/medicine costs reduces net growth; re-run `pnpm sim` after any change.
5. Battles taper off because HP only recovers through medicine. That's intended, but watch herb demand.

## Blockers that need you

| # | Decision / action | Why |
|---|---|---|
| B1 | Create NEAR accounts (testnet first) and fund them | Deploy token + game contracts; operator account |
| B2 | Approve token deployment parameters: allocation accounts (HQ, market, team-vesting), metadata/icon, HQ daily hard cap | Immutable after init |
| B3 | Choose the owner model (multisig/DAO) | The owner can pause and rotate the operator |
| B4 | Commission independent audits of both contracts and the ledger/settlement design | Required before any real funds |
| B5 | Legal review per launch jurisdiction: paid random catches, transferable prizes, daily rewards, real-money PvP, custody | Real-money features stay off until approved |
| B6 | Pick an embedded-wallet / social-login provider | Non-custodial "familiar login"; guests can't withdraw today |
| B7 | Contact on-ramp providers about $CATCHAMI support and your activity type | No provider is integrated or approved |
| B8 | Liquidity plan: DEX, pair (NEAR/USDC), initial contribution, price | 55% market allocation does not create liquidity by itself |
| B9 | Hosting, domain, Postgres, object storage, monitoring accounts | Deployment |
| B10 | Final art, animation and sound | Placeholders are original procedural art, clearly replaceable |

## Next engineering steps (in order)

1. Operator signer service (separate process, key from the secret store) + settlement batch producer from the journal + deposit/withdrawal indexer.
2. World sharding (instance router; per-instance nodes and merchants; global treasury).
3. NEAR wallet login (NEP-413) and account linking; embedded wallet once B6 is decided.
4. Testnet deployment with cargo-near reproducible builds; end-to-end deposit → play → withdraw on testnet.
5. Load test (k6/Artillery against the WebSocket), Phaser bundle trimming, mobile device QA (iOS Safari, Android Chrome).
6. Admin SSO + roles, alerting (reconciliation failures, outbox stuck, treasury floor), backups.
7. Real-token PvP escrow (contract + ledger holds) — build only after B5 says it's permissible somewhere.
8. Optional RHEA yield: design only; keep disabled until the core economy is stable and reviewed.
