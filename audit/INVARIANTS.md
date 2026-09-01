# Invariants and test mapping

The following hold at completed transaction boundaries, assuming USDG does not pause, confiscate, rebase, blacklist, upgrade incompatibly or charge a transfer fee.

| Invariant | Evidence |
| --- | --- |
| `balanceOf(OrderBook) >= escrowedUSDG`; escrow equals unfilled buy principal plus reserved fees | randomized accounting test; unmatched cancellation; partial-fill tests |
| `balanceOf(FeeVault) >= totalClaimable`; claims equal per-market creator liabilities | exact fee split; creator claim; randomized accounting |
| Each vault balance and `locked` cover outstanding payout liability | fully backed mint; normal/INVALID redemption; randomized accounting |
| Before resolution, total YES equals total NO and locked collateral equals pairs times 1 USDG | primary matching and collateral tests |
| After YES/NO, liability equals outstanding winning shares times 1 USDG | YES/NO redemption test |
| After INVALID, liability equals outstanding YES plus NO shares times 0.5 USDG | INVALID conservation test |
| Book-held shares equal open sell remainders | secondary sale, partial fill and cancellation tests |
| Filled or cancelled quantities cannot be filled again | incompatible/expired/self/zero/double-fill test |
| A share cannot be redeemed twice | normal and INVALID redemption tests |
| A market cannot resolve twice or traverse an invalid state transition | AUTO and EVENT lifecycle tests |
| EventMarket balance covers `bondEscrowed`; settlement clears liability once | proposal/dispute and all three bond allocation tests |
| Fees, bonds and listing payments never reduce collateral | randomized accounting and isolated-store tests |
| Trading rejects at/after close; expired orders reject matching | OPEN/CLOSED and expired-order tests |
| Implementations cannot initialize; each clone initializes exactly once atomically | clone regression test |
| Implementation targets and all resolution dependencies remain immutable | clone regression, access-control and no-manual-oracle-surface tests |

`test/accounting.js` performs 160 deterministic randomized multi-actor operations while checking all stores. Its second test proves fee equivalence between one fill and many one-share fills at every 1–99 cent price. `test/reentrancy.js` covers malicious token and ETH-recipient callbacks. `test/contracts.js` covers the remaining unit and lifecycle properties. Mainnet-fork simulation repeats full AUTO, EVENT undisputed, EVENT disputed and EVENT INVALID lifecycles with canonical USDG, WETH and the selected pool.
