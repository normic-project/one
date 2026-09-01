# Fund flows

Matched primary principal moves from the shared OrderBook into the relevant market's isolated CollateralVault. Secondary-sale principal moves from buyer to seller and does not change backing. Buyer fees are collected separately: 0.4% goes to treasury and 0.6% remains claimable by the creator in FeeVault.

Listing fees move directly from creator to treasury. EventMarket clones and the factory retain no user USDG. Redemption is the only path out of a CollateralVault and can be invoked only by its market.
