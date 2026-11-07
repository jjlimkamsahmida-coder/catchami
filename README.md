# Catchami

**Catch the Real. Play the World.** A mobile-first 2D multiplayer game on NEAR. Find real cats and dogs with your phone camera; each catch becomes an animated sticker pet with its own $CATCHAMI balance that gathers, trades with travelling merchants, eats, heals, crafts gear and scuffles in a shared world — on autopilot when you're away.

> Status: **development build — not production-ready.** The full game loop runs locally on a dev network with test units. Contracts are written and tested but not deployed or audited. Real-money features are off. See [docs/STATUS.md](docs/STATUS.md).

## Quick start

```bash
pnpm install
pnpm models        # COCO-SSD model for animal verification
pnpm dev:server    # :8787
pnpm dev:web       # :5173 — open on desktop, or on a phone through an https tunnel
```

## What's here

| | |
|---|---|
| `packages/shared` | Game and economy rules shared by client, server and simulation (`ECONOMY` config lives in `src/config.ts`) |
| `apps/server` | Authoritative world, double-entry ledger, capture verification, marketplace, admin, economy simulation |
| `apps/web` | React HUD + Phaser world, camera capture, collection, market, ranks, wallet, fairness, `/admin` |
| `contracts/token` | $CATCHAMI NEP-141 — fixed 100T supply, 40/55/5 allocation, no mint |
| `contracts/game` | Animal/equipment NFTs, vault with per-pet balances, settlement, withdrawals, marketplace |

## Docs

* [Architecture](docs/ARCHITECTURE.md) — authority, money flow, treasury, fairness, chain integration
* [Status & blockers](docs/STATUS.md) — what works, what doesn't, what needs your decision
* [Setup guide](docs/SETUP.md) — local, NEAR testnet, infrastructure, payments, rollout
* [Economy simulation](docs/ECONOMY_SIMULATION.md) — 100/1k/10k animals; dashboard at `docs/simulation/index.html`
* [Art replacement](ASSETS.md)

## Commands

```bash
pnpm test          # 30 TS tests (rules, ledger, detector, end-to-end server)
pnpm typecheck
pnpm sim           # regenerate the economy report
# contracts (Docker)
docker run --rm -v "$PWD/contracts:/work" -w /work rust:1 cargo test
```
