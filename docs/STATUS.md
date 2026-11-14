# Status

Last updated: 2026-11-15. Catchami runs publicly at **[catchami.fun](https://catchami.fun/)** on **NEAR testnet**. Testnet tokens have no monetary value. This page lists what's live, what's simulated, and what's needed before mainnet.

## Verification

| Check | Result |
|---|---|
| Automated tests | **49 passing** (`pnpm test`): shared rules, ledger, minigames, end-to-end server |
| Economy simulation | 5 scenarios, 30 days each, **0 invariant violations** (`pnpm sim`, [ECONOMY_SIMULATION.md](ECONOMY_SIMULATION.md)) |
| On-chain | Token and game contracts deployed; mint, settlement, withdrawal and swap transactions verified ([ONCHAIN_VERIFICATION.md](ONCHAIN_VERIFICATION.md)) |
| Reconciliation | The ledger's chain liability matches the vault's on-chain $CATCHAMI balance |
| Contract unit tests | Written (token 3, game 16); they don't build on the current Windows toolchain, so the contracts were also verified with live testnet calls |

## Live on testnet

| Area | Status |
|---|---|
| Real-animal catching with server-side verification, fair rolls, sticker art | ✅ Live |
| Pet NFTs (NEP-171), minted on every catch | ✅ Live |
| Per-pet vault balances, batched settlement every ~30 s, "Sync now" | ✅ Live |
| World: gathering minigames, merchants, demand, meals, medicine, crafting, marketplace, Bubble Roulette, autopilot, 10-step tutorial | ✅ Live |
| Coin purchases: real delivery from the market allocation | ✅ Live (payment step simulated) |
| Player-signed withdrawals from a pet to a NEAR wallet | ✅ Live |
| $CATCHAMI → USDC swap on Ref Finance pool #2969 | ✅ Live (test USDC) |
| Guest sign-in; NEAR wallets (Meteor, Intear, HERE, Sender) | ✅ Live |
| Continue with Google | ✅ Live as a simulated one-tap sign-in on catchami.fun |
| NEAR Auth (Google, email, passkey with a real NEAR account) | ✅ Implemented; works on origins NEAR has approved (`http://localhost:3000` on the shared testnet client). Awaiting approval for catchami.fun |

## Simulated on testnet

| Item | Mainnet requirement |
|---|---|
| Card payments | A licensed card on-ramp |
| Pay with any crypto (NEAR Intents) | NEAR Intents on mainnet (it has no testnet deployment) |
| Cash out to a bank | A licensed off-ramp provider |

## Before mainnet

| Item | Why |
|---|---|
| Independent audit of both contracts and the settlement design | Contracts are marked DRAFT and unaudited |
| Reproducible contract builds (`cargo near build reproducible-wasm`) | Testnet builds were plain `cargo build` |
| Owner as a multisig or DAO; operator key in a key-management service; team allocation in a vesting contract | Key safety |
| Legal review per jurisdiction: paid random catches, transferable items, player-vs-player stakes, custody | Battles between players currently move test coins; real-value stakes need sign-off, and the config's `realTokenPvp` switch isn't yet enforced in settlement |
| NEAR Auth client approved for the public domain | Google, email and passkey with real NEAR accounts on catchami.fun |
| Liquidity plan (pool, pair, initial contribution) | The 55% market allocation doesn't create liquidity by itself |
| Tighten the demo rarity odds | Current odds are generous for the demo |
| World sharding (~250 pets per world) | Simulation shows a single crowded world loses most pets to inactivity |
| Detect NFT transfers outside the game; on-chain listing for wallet-held pets | Ownership changes outside the game aren't tracked yet |
| Load testing and mobile device QA | The simulation covers the economy, not server load |
