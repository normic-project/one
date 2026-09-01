# Test manifest

Tests cover arbitrary creation, bounded immutable metadata, clone initialization, listing fees, exact fee splits, primary matching, partial fills, cancellation, secondary YES/NO sales, randomized solvency, creator claims, close boundaries, resolver-only one-time resolution, YES/NO/INVALID payouts, double redemption, access isolation, and callback reentrancy.

Browser tests cover market discovery, immutable terms, trading and cancellation, secondary sales, portfolio redemption, resolution states, event-only creation, ambiguity warnings, and wrong-network blocking on desktop and mobile.

The pinned Robinhood mainnet fork uses canonical USDG and the configured treasury, deployer, and Resolver Safe. It completes YES, NO, and INVALID lifecycles without changing public-chain state.
