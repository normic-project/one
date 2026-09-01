# Known risks

1. No independent security or legal review has been completed.
2. A compromised Resolver Safe threshold can select an incorrect YES, NO, or INVALID outcome.
3. Resolver unavailability can strand unresolved markets indefinitely.
4. Ambiguous or unavailable sources can make correct resolution difficult despite immutable terms.
5. Canonical USDG issuer controls or transfer behavior can block trading, refunds, fees, or redemption.
6. Exact-price order matching provides no guaranteed liquidity or exit.
7. Robinhood Chain, RPC, frontend, and indexing failures can impair access or visibility.
8. The two deployment transactions are not atomic; operators must inspect partial manifests before retrying.
