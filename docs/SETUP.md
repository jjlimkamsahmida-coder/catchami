# Catchami setup guide

Each step is tagged:
**[auto]** Claude/CI can do it · **[you]** needs your decision, login, funds, identity verification or an external approval.
Never paste a seed phrase or private key into chat, an issue or the repo. Keys live in your wallet, your OS keychain (near-cli) or your host's secret manager.

---

## 1. Local development  [auto]

Requirements: Node ≥ 22.18, pnpm 10, Docker (contracts only).

```bash
pnpm install
pnpm models                 # downloads the COCO-SSD model (~18 MB) into apps/server/models
pnpm dev:server             # http://localhost:8797 — dev network, embedded Postgres in ./data
pnpm dev:web                # http://localhost:5173 — proxies /api, /ws, /media, /models
```

* The dev network credits HQ with 40T **test units** (marked `dev-genesis:unbacked`) and lets each account take 20M test units per day from the in-game Wallet. They have no value and never touch a chain.
* The admin token prints on server start; open `http://localhost:5173/admin`.
* Phone testing: the camera needs https. Use a tunnel with TLS (e.g. `cloudflared tunnel --url http://localhost:5173`) and set `ALLOWED_ORIGINS` to that origin.
* No camera (desktop)? Catch through the real API with a photo:
  `node apps/server/scripts/dev-catch.ts <token-from-localStorage> photo.jpg basic`

Tests:

```bash
pnpm test                   # shared rules, ledger, detector, end-to-end server
pnpm typecheck
pnpm sim                    # economy simulation → docs/ECONOMY_SIMULATION.md + docs/simulation/index.html
docker build -t catchami-contracts -f contracts/Dockerfile.build contracts
docker run --rm -v "$PWD/contracts:/work" -w /work catchami-contracts cargo test
```

## 2. NEAR testnet

> **Done (2026-11-14).** Everything below is deployed: see [TESTNET.md](TESTNET.md) for the live addresses, what is real vs simulated, and the server variables. The steps are kept for redeploys.

### 2.1 Accounts  [you]

Install near-cli-rs (`npm i -g near-cli-rs` or the installer from near/near-cli-rs). Commands below follow its syntax; run `near --help` if a flag has changed.

```bash
near account create-account sponsor-by-faucet-service catchami-dev.testnet autogenerate-new-keypair save-to-keychain network-config testnet create
```

Create these sub-accounts (each `fund-myself … sign-as catchami-dev.testnet`):

| Account | Role | Notes |
|---|---|---|
| `token.catchami-dev.testnet` | $CATCHAMI contract | ~5 NEAR for storage |
| `game.catchami-dev.testnet` | game contract (NFTs + vault) | ~10 NEAR; pays NFT storage on mint |
| `hq.catchami-dev.testnet` | receives the 40% HQ allocation, deposits it into the vault | |
| `market.catchami-dev.testnet` | receives the 55% market allocation | mainnet: a multisig |
| `team.catchami-dev.testnet` | receives the 5% team allocation | mainnet: a vesting/lockup contract, not a plain account |
| `operator.catchami-dev.testnet` | game server signer (mints, settlement) | key goes to the server's secret store only |
| owner | multisig/DAO that can pause/rotate operator | testnet: a separate account is fine |

```bash
near account create-account fund-myself token.catchami-dev.testnet '5 NEAR' autogenerate-new-keypair save-to-keychain sign-as catchami-dev.testnet network-config testnet sign-with-keychain send
```

### 2.2 Build contracts  [auto]

Use reproducible builds for anything you deploy:

```bash
docker run --rm -v "$PWD/contracts:/work" -w /work/token catchami-contracts cargo near build reproducible-wasm
docker run --rm -v "$PWD/contracts:/work" -w /work/game  catchami-contracts cargo near build reproducible-wasm
```

(`contracts/res/*.wasm` from a plain `cargo build` is only for size checks; it wasn't post-processed by cargo-near.)

### 2.3 Deploy the token  [you approve parameters, then auto]

Parameters are **immutable** after `new`: allocation accounts and metadata.

```bash
near contract deploy token.catchami-dev.testnet use-file contracts/token/target/near/catchami_token.wasm \
  with-init-call new json-args '{"hq_allocation":"hq.catchami-dev.testnet","market_allocation":"market.catchami-dev.testnet","team_allocation":"team.catchami-dev.testnet","icon":null}' \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send
```

Verify: `ft_total_supply` = 100000000000000000000000000000000, `ft_metadata.symbol` = CATCHAMI, and the three balances are 40/55/5%.

### 2.4 Deploy the game contract  [you approve the HQ hard cap]

`hq_daily_hard_cap` is permanent; the owner can only lower the working cap. Suggested: 0.05% of 40T = 20,000,000,000 tokens = `20000000000000000000000000000`.

```bash
near contract deploy game.catchami-dev.testnet use-file contracts/game/target/near/catchami_game.wasm \
  with-init-call new json-args '{"owner":"<owner>","operator":"operator.catchami-dev.testnet","token":"token.catchami-dev.testnet","team_account":"team.catchami-dev.testnet","hq_daily_hard_cap":"20000000000000000000000000000"}' \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send
```

### 2.5 Storage registration  [auto]

The game contract and every withdrawing player must be registered on the token:

```bash
near contract call-function as-transaction token.catchami-dev.testnet storage_deposit json-args '{"account_id":"game.catchami-dev.testnet"}' prepaid-gas '30 Tgas' attached-deposit '0.0125 NEAR' sign-as catchami-dev.testnet network-config testnet sign-with-keychain send
```

### 2.6 Fund HQ inside the vault  [you]

```bash
near contract call-function as-transaction token.catchami-dev.testnet ft_transfer_call json-args '{"receiver_id":"game.catchami-dev.testnet","amount":"40000000000000000000000000000000","msg":"\"deposit_hq\""}' prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' sign-as hq.catchami-dev.testnet network-config testnet sign-with-keychain send
```

### 2.7 Point the server at testnet  [auto, after the signer exists]

```
CATCHAMI_NETWORK=testnet
NEAR_RPC_URL=https://rpc.testnet.near.org
NEAR_TOKEN_CONTRACT=token.catchami-dev.testnet
NEAR_GAME_CONTRACT=game.catchami-dev.testnet
NEAR_OPERATOR_ACCOUNT=operator.catchami-dev.testnet
NEAR_OPERATOR_KEY_FILE=/run/secrets/operator.json
```

Outstanding before this works end to end: the operator signer, the deposit indexer and the settlement producer (STATUS → Next steps).

### 2.8 Liquidity  [you]

The 55% market allocation doesn't create a market by itself. Decide the venue (a NEAR DEX), the pair (NEAR or USDC), how much of the pair asset **you** contribute, and the opening price. Nothing is transferred or listed without your explicit approval of the exact amounts.

## 3. Infrastructure  [you choose providers, auto configures]

| Need | Requirement | Notes |
|---|---|---|
| App hosting | Long-lived Node process with WebSockets, TLS | Any VM/container host. One process per world instance once sharding lands |
| Database | PostgreSQL 15+, point-in-time recovery | Set `DATABASE_URL`. Migrations run on boot |
| Redis | Not needed yet | Needed with sharding (presence, routing) |
| Object storage + CDN | Stickers (`/media/stickers`) | Today written to `MEDIA_DIR` on local disk; an S3/R2 adapter is not built yet |
| Domain + DNS | `app.` for the game, `api.` optional | Set `ALLOWED_ORIGINS` |
| Secrets | `SESSION_SECRET` (≥32 chars), `ADMIN_TOKEN`, operator key | Host secret manager; never in git |
| Monitoring | Error tracking, uptime, log search, alerts on `[reconcile] ALERT` | |
| Backups | Daily Postgres snapshots + PITR; restore drill before launch | |

Build and run:

```bash
pnpm --filter @catchami/web build      # the server serves apps/web/dist if present
NODE_ENV=production CATCHAMI_NETWORK=testnet SESSION_SECRET=… DATABASE_URL=… node apps/server/src/index.ts
```

## 4. Payments and on-ramps  [you]

Nothing is integrated or approved. To get a card/bank top-up:

1. Shortlist on-ramp providers that support NEAR and NEP-141 tokens in your launch regions. Confirm current coverage with each provider; don't rely on marketing pages.
2. Ask each in writing: (a) can they deliver $CATCHAMI, or only NEAR/USDC (then the app swaps)? (b) will they serve a game with **paid randomized NFTs**, **transferable prizes**, and (if ever enabled) **real-money PvP**? (c) which countries? (d) KYC flow and who holds the customer relationship? (e) fees and settlement.
3. Most providers require a token listing or liquidity depth before supporting a new token. That depends on §2.8.
4. Record each provider's approval in writing before enabling them in the UI.

Until then, deposits are only possible by sending $CATCHAMI to the game contract.

## 5. Rollout

| Phase | What | Gate |
|---|---|---|
| Local | Everything on test units | Tests + simulation green |
| Testnet | Real contracts, test tokens, invited testers | Signer + indexer built; deposit → play → withdraw verified |
| Mainnet staging | Mainnet contracts, internal accounts, tiny HQ cap | Audits done (B4), owner multisig live |
| Limited production | Allowlisted users, low deposit caps, real-money features only where approved | Legal (B5), payments (B7), monitoring + on-call |
| Public launch | Open signups by region | Load test passed, sharding live, incident runbook rehearsed |
