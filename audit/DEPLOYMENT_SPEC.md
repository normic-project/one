# Deployment specification

Target: Robinhood Chain mainnet, chain ID 4663. Deployment must use `scripts/deploy.cjs --broadcast` only after independent security and legal reviews, funding, keystore preparation and operator approval. This freeze performed no broadcast and accessed no keystore.

## Canonical configuration

| Value | Frozen configuration |
| --- | --- |
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, 6 decimals |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`, 18 decimals |
| WETH/USDG pool | `0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca` |
| Treasury | `0xDC2089B6fFF960007814F6e0D6D67E105a64624B` |
| Resolver Safe | `0x3203441F25934CA12E8b8Adf2be8F8e0AE389112` |
| Deployer public address | `0x4977DE14a88D3420FEfB19f454C0Be428176b559` |
| TWAP window | 3,600 seconds |
| Event proposal bond | 25,000,000 USDG base units |
| Event dispute period | 86,400 seconds |

## Ordered transactions and constructors

1. `UniswapTwapResolver(weth, usdg, pool, 3600)`.
2. `AutoMarket(usdg, predictedOrderBook, deployedResolver)`; constructor locks implementation initialization.
3. `EventMarket(usdg, predictedOrderBook, resolverSafe, 25000000, 86400)`; constructor locks implementation initialization.
4. `MarketFactory(usdg, treasury, resolver, resolverSafe, 25000000, 86400, autoImplementation, eventImplementation)`. Its constructor creates FeeVault and then OrderBook and validates every implementation binding.

Predicted addresses assume the configured deployer’s current nonce remains unchanged. Factory-created addresses depend on the factory constructor nonce sequence. Any nonce or chain-head change requires rerunning validation and simulation; operators must never bypass a mismatch.

## Required checks before broadcast

- Verify chain ID 4663, archive RPC, current nonce/balance, canonical code hashes/interfaces, pool orientation/fee/history and Safe threshold/owners/modules/guard.
- Recompute frozen source, release and bytecode hashes from the tagged commit.
- Review exact constructor calldata hashes and predicted addresses against a new dry-run.
- Require 30% above the refreshed execution estimate plus any separately determined L1 data fee.
- Require real independent `SECURITY_REVIEW_ACK` and legal `LEGAL_REVIEW_ACK`; neither is set in this freeze.
- Load the encrypted keystore only for the final approved broadcast process. Never put a private key in `.env` or CLI arguments.
- Record every receipt and stop after any failure. Four successful deployment transactions are expected; no market creation is part of initial deployment.
- Verify deployed source, constructor arguments, immutable getters, runtime code and internal FeeVault/OrderBook addresses before setting frontend production addresses.

Latest read-only deployment estimate: 10,281,450 gas. This is evidence, not a durable gas-price quote.
