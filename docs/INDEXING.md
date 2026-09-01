# Read-only indexing

A production indexer may improve search, categories, portfolio cost basis, order history, creator dashboards, and unresolved-market queues. It must remain read-only and may never sign transactions, choose outcomes, custody funds, or become a settlement dependency.

Index `MarketCreated`, `MetadataCommitted`, `OrderPlaced`, `OrderCancelled`, `OrdersMatched`, `FeesAccrued`, `FeesClaimed`, `Resolved`, and `Redeemed`. Store market address, creator, metadata commitment, timestamps, rules/sources, state, final outcome, volume, orders, trades, positions, fees, and redemptions.

Clients must confirm live contract state before transactions. Missing index data must be shown as unavailable rather than estimated as authoritative protocol state.
