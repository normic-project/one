# Deployment specification

This specification describes the current simplified architecture. The prior pre-audit freeze is superseded and no new audit freeze is created by this change.

Target: Robinhood Chain mainnet, chain ID 4663. Canonical USDG is `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` with six decimals.

## Ordered transactions and constructors

1. `EventMarket(usdg, predictedOrderBook, resolverSafe)` locks the implementation against initialization.
2. `MarketFactory(usdg, treasury, resolverSafe, eventImplementation)` creates FeeVault and then OrderBook, validates the implementation binding, and fixes all global configuration.

Factory-created addresses depend on its constructor nonce sequence. Any deployer nonce or chain-head change requires rerunning validation and simulation.

## Required technical checks before broadcast

- Verify chain ID 4663, archive RPC, current nonce and balance, canonical USDG, treasury behavior, and Resolver Safe code/configuration.
- Recompute source, release, and bytecode hashes from the final candidate.
- Review constructor calldata hashes and predicted addresses against a new dry-run.
- Require 30% above the refreshed execution estimate plus any separately determined L1 data fee.
- Load the encrypted keystore only for the explicit `--broadcast` process. Never put a private key in `.env` or CLI arguments.
- Record every receipt and stop after any failure. Two successful deployment transactions are expected.
- Verify deployed source, constructor arguments, immutable getters, runtime code, FeeVault, and OrderBook before setting frontend production addresses.
