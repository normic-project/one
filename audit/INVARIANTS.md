# Invariants

- OrderBook USDG equals unmatched buyer principal plus refundable fee reserves.
- FeeVault USDG equals total creator-fee liability.
- Each unresolved market has equal YES/NO total shares and locked collateral equal to one USDG per complete pair.
- YES, NO, and INVALID remaining liabilities exactly match remaining locked collateral after each redemption.
- Secondary sales never change collateral.
- Creator, treasury, resolver, and factory have no collateral-withdrawal path.
- Resolution and redemption cannot be replayed.

The deterministic randomized accounting test checks these stores after every operation.
