# Security model

## Authority boundaries

| Actor | Allowed | Not allowed |
| --- | --- | --- |
| Creator | Pay the listing fee, define immutable terms, trade, claim its 0.6% fee | Edit/delete terms, resolve, withdraw backing, claim protocol fees |
| Trader | Place, match and cancel orders; sell YES or NO; redeem after resolution | Mint without matched collateral, double fill/redeem, move another user's shares |
| Treasury | Receive listing fees and the 0.4% matched-trade fee | Mutate or resolve markets, claim creator fees, access collateral or orders |
| Resolver Safe | Call `resolve(YES/NO/INVALID)` once after `resolvesAt` | Resolve early, edit terms, move tokens or shares, access vault/book/fee accounting |

## Accounting isolation

Each complete matched pair creates equal YES and NO shares and transfers exactly 1 USDG per pair into that market's dedicated `CollateralVault`. Buyer fees never enter that vault. `OrderBook` holds only unmatched buyer escrow and escrowed seller shares. `FeeVault` holds creator-fee liabilities and forwards protocol fees to treasury. Neither the factory, creator, treasury, nor resolver has a collateral-withdrawal path.

For YES and NO, each winning share pays exactly 1,000,000 USDG base units and the losing side pays zero. INVALID pays 500,000 base units to each side. The sum for a complete pair is always 1,000,000 base units.

## Immutable configuration

Factory immutables are canonical USDG, treasury, Resolver Safe, the locked EventMarket implementation, FeeVault, and OrderBook. Implementation immutables bind USDG, the shared OrderBook, and the Resolver Safe. Each clone stores creator, close/resolution timestamps, bounded metadata, deterministic metadata commitment, positions, state, volume, and collateral-vault address during one atomic initialization.

The state path is:

```text
OPEN -> CLOSED -> RESOLVED_YES | RESOLVED_NO | RESOLVED_INVALID
```

Time changes OPEN to CLOSED for reads. Only the Resolver Safe can make the single resolved transition, and only at or after `resolvesAt`.

## External risks

The contracts cannot make a real-world source truthful. A compromised Resolver Safe threshold can select an incorrect outcome, and an unavailable Safe can strand resolution. USDG issuer controls, Robinhood Chain availability, RPC failures, frontend compromise, ambiguous rules, and jurisdictional restrictions remain external risks. Safe signers should use independent custody, source precedence, conflict recusal, public reasoning, and an incident process.

Reviewers should prioritize collateral conservation, INVALID exactness, partial fills/cancellation, both secondary-sale sides, token callbacks, exact timestamp boundaries, resolver authorization, metadata commitments, factory/deployer address prediction, and deployment recovery.
