# AUTO oracle security

`UniswapTwapResolver` accepts only the configured canonical WETH and six-decimal USDG pair from the configured pool. Its constructor verifies both token orientations, reads and fixes the pool fee, and fixes a 3,600-second TWAP window. There is no owner, setter, fallback API, spot-price path, Chainlink path or manual outcome override.

For an AUTO term, resolution uses the arithmetic-mean Uniswap V3 tick over the historical interval ending exactly at `resolvesAt`. Calling `resolve()` later does not shift that interval. Negative tick division rounds toward negative infinity as required by the Uniswap convention. The result quotes exactly 1e18 WETH into USDG base units and compares against a nonzero threshold aligned to one USDG.

Resolution fails closed when called early, when the historical range exceeds supported seconds, when pool observations are unavailable or malformed, or when the resulting quote is zero. Failure leaves the market unresolved; there is deliberately no privileged recovery path.

Security depends on Robinhood Chain finality, correct canonical token/pool configuration, Uniswap pool code and observation integrity, USDG token behavior, adequate WETH/USDG liquidity throughout the whole interval, and historical observation capacity. A one-hour TWAP raises manipulation cost compared with spot but does not prove manipulation is uneconomic. Auditors should model liquidity-dependent manipulation, tick/decimal orientation, exact timestamp boundaries, observation cardinality and delayed calls.

Operational controls should monitor pool liquidity, observation capacity, token upgrades/pauses, chain reorganizations and pending resolutions. The UI must describe the historical interval and must not imply that current spot price controls the result.
