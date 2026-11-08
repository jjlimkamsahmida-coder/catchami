# Catchami — my todo

## Decisions & approvals
- [ ] Choose the owner model for the contracts (multisig or DAO) and who signs
- [ ] Approve token settings (permanent after deploy): HQ / market / team allocation accounts, name, symbol, icon
- [ ] Approve the HQ daily hard cap for the game contract (suggested 20B tokens/day = 0.05% of 40T)
- [ ] Decide the team vesting schedule and pick an audited lockup/vesting contract
- [ ] Decide the liquidity plan: DEX, pair (NEAR or USDC), my contribution, opening price
- [ ] Review the economy numbers in `packages/shared/src/config.ts` (catch prices, food/medicine, resource prices) and re-run `pnpm sim`

## NEAR accounts (testnet first)
- [ ] Install near-cli-rs
- [ ] Create `catchami-dev.testnet` and fund it
- [ ] Create sub-accounts: token, game, hq, market, team, operator, owner (see docs/SETUP.md §2.1)
- [ ] Keep the operator key in a secret manager only (never in the repo or chat)
- [ ] Later: repeat on mainnet with real funding

## Legal & compliance
- [ ] Get legal review for each launch country: paid random catches, transferable NFTs/prizes, daily rewards, custody
- [ ] Get legal review for the balance-growth loop (pets earn from HQ): investment/gambling classification
- [ ] Get written sign-off before real-token PvP is ever turned on (`REAL_PVP_APPROVED`)
- [ ] Terms of service, privacy policy (camera photos, retention), age rules

## Security
- [ ] Commission independent audits of `contracts/token` and `contracts/game`
- [ ] Commission a review of the ledger + settlement design
- [ ] Penetration test before public launch

## Providers & accounts
- [ ] Pick a social-login / embedded-wallet provider (non-custodial)
- [ ] Contact on-ramp providers: $CATCHAMI support, paid random NFTs allowed?, countries, KYC, fees — get answers in writing
- [ ] Hosting with WebSockets + TLS
- [ ] Managed PostgreSQL with backups / point-in-time recovery
- [ ] Object storage + CDN for sticker images
- [ ] Domain + DNS
- [ ] Monitoring / error tracking / alerts

## Art & sound
- [ ] Final art for map, props, HQ, resource spots, merchants, icons (keys listed in ASSETS.md)
- [ ] Capture charm design and catch animations
- [ ] Sound effects and music

## Testing
- [ ] Play on my phone over Wi-Fi: https://192.168.0.167:5173 (allow Node through Windows Firewall if asked)
- [ ] Optional: install `C:\Users\HP\AppData\Local\mkcert\rootCA.pem` on the phone to remove the certificate warning
- [ ] Try real catches with real cats/dogs and report anything odd
- [ ] Invite a few testers for multiplayer

## Development still to build (ask Claude)
- [ ] Operator signer + settlement batches + deposit/withdrawal indexer
- [ ] World sharding (~250 pets per world)
- [ ] NEAR wallet login
- [ ] Sticker storage on S3/R2
- [ ] Load testing and mobile device QA
- [ ] Testnet deployment end to end (deposit → play → withdraw)

## My own items
- [ ] 
