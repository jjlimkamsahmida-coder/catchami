# Catchami on NEAR testnet

Live since 2026-11-14. Everything below runs on testnet. Testnet tokens have no monetary value.

## Deployed

| What | Account | Notes |
|---|---|---|
| $CATCHAMI token (NEP-141) | `token.catchami-dev.testnet` | 100,000,000,000,000 fixed supply, 18 decimals, coin logo on-chain |
| Allocation: HQ 40% | `hq.catchami-dev.testnet` → vault | All 40T deposited into the game vault as the HQ bucket |
| Allocation: market 55% | `market.catchami-dev.testnet` | Sells $CATCHAMI to players and seeded the DEX pool |
| Allocation: team 5% | `team.catchami-dev.testnet` | |
| Game contract: pet NFTs (NEP-171) and vault | `game.catchami-dev.testnet` | HQ hard cap 20B/day (permanent); default allowances 1B/day per pet/user |
| Owner (pause, rotate operator) | `catchami-dev.testnet` | |
| Operator (game server signer) | `operator.catchami-dev.testnet` | Mints, settles, moves custody NFTs |
| DEX pool $CATCHAMI/USDC | Ref Finance `ref-finance-101.testnet` pool **#2969** | Seeded with 300B CATCHAMI + 100,000 test USDC (≈3M CATCHAMI per $1) |
| Test USDC | `usdc.fakes.testnet` | |

Explorer: https://testnet.nearblocks.io/address/game.catchami-dev.testnet

Keys live in `~/.near-credentials/testnet/` on the machine that created them. They are never in the repo.

## Real vs simulated

| Feature | Status |
|---|---|
| Token supply and 40/55/5 allocation | **Real** |
| Pet NFT minted on every catch: to the player's wallet, or held in custody for guest and Google players | **Real** |
| Custody NFTs move to the player's wallet when they link one | **Real** |
| Each pet's piggy bank is a vault bucket that belongs to the NFT's owner | **Real** |
| Gameplay earning and spending synced in batches (`settle`, every ~30s or "Sync now") | **Real** |
| Withdraw pet coins to your wallet (request → game acknowledges → claim) | **Real**, signed by the player's wallet |
| Buying $CATCHAMI: tokens delivered from the market allocation into the vault | **Real** delivery |
| Card payment in front of it | **Simulated**: no card is collected |
| Pay with any asset via NEAR Intents | **Simulated**: Intents is mainnet-only. Asset list and USD prices are live from the 1Click API |
| Sell $CATCHAMI for USDC | **Real** swap on the Ref testnet pool, signed by the player's wallet |
| Cash out USDC to a bank (off-ramp) | **Simulated** |
| Google sign-in | **Simulated**: no Google OAuth client. It creates a game account whose NFTs are held in custody |
| NEAR wallet sign-in (Meteor, Intear, HERE, Sender) | **Real** (MyNearWallet was removed because it is sunset) |
| Solana / EVM wallets | Coming soon |

Known limits:
- Pets whose NFT is in a player's own wallet can't be listed on the in-game market, because moving them needs the owner's signature. They trade from the wallet instead.
- Transferring an NFT outside the game isn't picked up by the server yet.

## How the money stays in step

- The server keeps a double-entry ledger. Every entry that doesn't touch the `chain` account is netted per vault bucket and sent as one balanced `settle` batch, sequence-numbered on-chain.
- Vault deposits and executed withdrawals are indexed *into* the ledger as `chain ↔ account` entries, so they are never settled twice.
- `GET /api/admin/reconcile` compares `ft_balance_of(game)` with the ledger's chain liability. It should say `matched`.

## Run the server against testnet

Put this in `.env` locally (git-ignored), or in Railway → Variables:

```
CATCHAMI_NETWORK=testnet
NEAR_TOKEN_CONTRACT=token.catchami-dev.testnet
NEAR_GAME_CONTRACT=game.catchami-dev.testnet
NEAR_OPERATOR_ACCOUNT=operator.catchami-dev.testnet
NEAR_OPERATOR_KEY=ed25519:…        # or NEAR_OPERATOR_KEY_FILE=/path/operator.json
NEAR_MARKET_ACCOUNT=market.catchami-dev.testnet
NEAR_MARKET_KEY=ed25519:…          # or NEAR_MARKET_KEY_FILE=…
NEAR_REF_POOL_ID=2969
PUBLIC_URL=https://catchami-production.up.railway.app
```

Each network keeps its own local database (`DATA_DIR/pg` for dev, `DATA_DIR/pg-testnet` for testnet), so dev test units never mix with testnet tokens.

## Rebuilding the contracts on Windows

`cargo near` isn't installed here, and Docker wasn't running, so the wasm was built with stable Rust targeting MVP wasm:

```
cd contracts
RUSTFLAGS="-C target-cpu=mvp -C link-arg=-s" CARGO_TARGET_DIR=target/mvp cargo build --release --target wasm32-unknown-unknown
```

These builds aren't reproducible. Use `cargo near build reproducible-wasm` (Docker) before any mainnet deploy.
