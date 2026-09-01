# Future audit scope

No new audit or freeze was performed for this architecture change.

A future review should cover `EventMarket`, `PredictionMarket`, `MarketFactory`, `OrderBook`, `FeeVault`, `CollateralVault`, `TradeMath`, the EIP-1167 integration, deployment/validation scripts, canonical USDG assumptions, and Resolver Safe configuration.

Priority properties are collateral conservation, escrow and fee accounting, initialization immutability, partial fills/cancellation, secondary sales, resolution timing/access, all outcomes, replay prevention, reentrancy, constructor ordering, and deterministic address prediction.
