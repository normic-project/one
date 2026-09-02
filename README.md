# One Shot

One Shot is a fully collateralized, permissionless YES/NO event-market protocol for Robinhood Chain mainnet (chain ID 4663). Anyone can create an arbitrary objectively resolvable question. Traders take YES or NO positions with real USDG through exact-price matched orders.

The production contracts are deployed on Robinhood Chain mainnet from block 51943083. The repository pins the live factory, implementation, order book, fee vault, USDG, treasury, and Resolver Safe addresses.

## Core architecture

The global deployment contains one locked `EventMarket` implementation, `MarketFactory`, `OrderBook`, and `FeeVault`. Each created market is one 45-byte EIP-1167 clone and one isolated `CollateralVault`. There is no upgradeability, implementation setter, protocol liquidity, creator liquidity, oracle, automatic market, or proposal/dispute bond system.

`MarketFactory` accepts exactly 0.0006 ETH per market and forwards it to the immutable treasury. It creates general event-market clones from one immutable implementation. Each creator commits a question, exact YES and NO meanings, category, close time, resolution time, rules, primary source, optional secondary source, and optional metadata URI. These terms and their hashes cannot be edited.

`OrderBook` supports partial fills, cancellation, complementary YES/NO matching, and secondary sales of either side. A matched YES/NO pair locks exactly 1 USDG in that market's isolated vault. Buyer fees remain separate: 0.4% of matched principal goes to treasury and 0.6% accrues to the market creator. Unmatched buyer principal and unearned fees remain refundable.

After the immutable resolution timestamp, only the immutable `RESOLVER_MULTISIG_ADDRESS` can select YES, NO, or INVALID. It can act once. It cannot edit terms, change fees or times, withdraw collateral, claim fees, transfer shares, or modify orders. YES or NO winners redeem 1 USDG per winning share. INVALID pays 0.5 USDG to every YES and every NO share, so a complete pair always redeems exactly 1 USDG.

## Run and verify

Use Node.js 22 or 24 and npm:

```sh
npm ci --ignore-scripts
npm run lint
npm run build
npm test
npm run test:ui
npm run simulate
npm run simulate:fork
npm run audit:production
```

The fork simulation uses the configured private `RH_RPC_URL` and canonical Robinhood mainnet USDG. It impersonates the configured deployer and Resolver Safe only inside Hardhat's local fork and never signs or broadcasts a mainnet transaction.

## Deployment

Copy `.env.example` to `.env`. Production preflight requires:

- `RH_RPC_URL`
- `TREASURY_ADDRESS`
- `DEPLOYER_ADDRESS`
- deployed `RESOLVER_MULTISIG_ADDRESS`
- canonical `USDG_ADDRESS`

`npm run deploy` performs the complete read-only preflight, live validation, fork lifecycle, constructor generation, bytecode hashing, address prediction, and current gas calculation. Without `--broadcast`, it returns before reading any signing credential and never sends a transaction.

Broadcast additionally requires `DEPLOYER_KEYSTORE`, `DEPLOYER_KEYSTORE_PASSWORD`, sufficient ETH with 30% execution-gas headroom, a stable nonce, and the explicit command:

```sh
npm run deploy -- --broadcast
```

There is no testnet, skip-checks, force, or private-key argument. Do not put secrets in `VITE_*` variables.

Mobile wallet connections use WalletConnect v2. Create a browser-client project in the Reown dashboard, restrict its origin allowlist to the deployed One Shot domains, and set its public identifier as `VITE_WALLETCONNECT_PROJECT_ID` in the frontend deployment environment. This identifier is intentionally browser-visible; deployer keys, managed RPC credentials, and server credentials must never be placed in it or any other `VITE_*` value.

## Production data layer

Supabase stores a replayable, read-only index of canonical contract events. The schema and reorg-safe derived-state procedures live in `supabase/migrations`. A Supabase Edge Function reads Robinhood Chain in bounded batches, starts at block 51943083, waits 32 confirmations, and is scheduled every minute with `pg_cron` and `pg_net`. Run it locally with `npm run indexer:once`, `npm run indexer:backfill`, or `npm run indexer:reindex` using server-only credentials.

Vercel functions under `api/` expose paginated market, trade, price, order, search, and wallet endpoints. Indexed history comes from Postgres. Financially relevant current state, including collateral, executable order amounts, wallet shares, outcomes, and creator claims, is refreshed from the canonical live contracts by the server. The browser never receives the managed RPC, service-role key, deployer keystore, or signing credentials.

## Risks

Users depend on immutable market terms, the cited sources, the Resolver Safe, Robinhood Chain, canonical USDG, and the frontend/RPC path they use. Resolver compromise can select an incorrect outcome but cannot directly seize collateral. Resolver unavailability can strand an unresolved market. USDG issuer controls or chain disruption can block transfers or redemption despite correct protocol accounting.

See [ACCOUNTING.md](docs/ACCOUNTING.md), [SECURITY.md](docs/SECURITY.md), and [LAUNCH_CHECKLIST.md](docs/LAUNCH_CHECKLIST.md).
