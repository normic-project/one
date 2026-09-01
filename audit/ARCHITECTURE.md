# Current architecture

The global deployment uses two ordered transactions: locked `EventMarket` implementation, then `MarketFactory`. The factory constructor creates `FeeVault` and `OrderBook` and validates the implementation's immutable USDG, OrderBook, and Resolver Safe bindings.

Every market is a standard 45-byte EIP-1167 clone initialized atomically with immutable metadata commitments and a new isolated `CollateralVault`. There is no upgrade authority, implementation setter, automatic market, oracle, or bond subsystem.
