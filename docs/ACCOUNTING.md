# Accounting

USDG uses six decimals. One share is an integer claim unit.

For a primary matched pair of `q` shares at YES price `p` cents, YES principal is `q × p × 10,000`, NO principal is `q × (100-p) × 10,000`, and total collateral is exactly `q × 1,000,000` base units. Buyers additionally pay exactly 1% of their principal. `FeeVault` sends 0.4% to treasury and records 0.6% for the market creator.

Unmatched principal and its fee reserve stay in `OrderBook` and are fully refundable. Secondary sales move existing shares and buyer USDG without changing locked collateral. Creator claims and protocol fees cannot touch collateral.

For YES or NO, winning shares redeem 1,000,000 base units and losing shares redeem zero. For INVALID, every YES and NO share redeems 500,000 base units. One complete pair therefore always has a maximum aggregate claim of exactly 1 USDG.

The enforced stores are: one shared order escrow, one shared creator-fee liability vault, and one isolated collateral vault per market. Market clones hold no USDG during normal operation.
