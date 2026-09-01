# Accounting specification

USDG amounts use six decimals, shares are whole integers, and limit prices are integer cents from 1 through 99. Maximum order quantity is `1e12` shares.

For filled quantity `q` and price `p`:

```text
principal   = q * p * 10,000
protocolFee = principal * 4 / 1,000
creatorFee  = principal * 6 / 1,000
totalFee    = principal / 100
buyerDebit  = principal + totalFee
```

Every result is exact because principal is a multiple of 10,000. Fill splitting cannot create rounding gain. A matched YES buy at `p` and NO buy at `100-p` contributes `q * 1,000,000` to collateral. Their combined 1% fee is additional money.

## Isolated stores

| Store | Liability | Authorized decrease |
| --- | --- | --- |
| `OrderBook` USDG | Unfilled buy principal plus unearned fee reserves | Cancellation refund or matched fill settlement |
| Per-market `CollateralVault` | Outstanding redemption backing | That market redeeming and burning shares |
| `FeeVault` USDG | Sum of unclaimed 0.6% creator fees | Corresponding creator claim |
| `EventMarket` USDG | `bondEscrowed` proposal/dispute bonds | One finalization/adjudication settlement |
| Treasury | No protocol liability | Treasury custody policy outside protocol |

Listing fees are ETH transferred directly to treasury and never enter these USDG stores. Protocol fees transfer directly from the book on a fill. Accidental donations are surplus and never counted as liability or made withdrawable by an administrator.

## Transaction effects

| Operation | Order escrow | Collateral | Fee liability | Bond escrow | Shares |
| --- | --- | --- | --- | --- | --- |
| Place buy | Add principal + 1% reserve | — | — | — | — |
| Place sell | — | — | — | — | Move owner to book escrow |
| Cancel buy | Refund remaining principal + reserve | — | — | — | — |
| Cancel sell | — | — | — | — | Return remaining escrow |
| Match opposite buys | Remove buyer escrows | Add 1 USDG per pair | Add 0.6%; send 0.4% | — | Mint equal YES and NO |
| Match buy/sell | Remove buyer escrow; pay seller principal | No change | Add 0.6%; send 0.4% | — | Move seller escrow to buyer |
| Creator claim | — | No change | Reduce then pay exact claim | — | — |
| Event proposal | — | No change | No change | Add one bond | — |
| Event dispute | — | No change | No change | Add one bond | — |
| Bond settlement | — | No change | No change | Set zero then pay exact allocation | — |
| YES/NO redemption | — | Reduce 1 USDG per winning share | No change | No change | Burn winner; loser burns for zero |
| INVALID redemption | — | Reduce 0.5 USDG per YES or NO share | No change | No change | Burn redeemed side |

An undisputed proposer receives its one bond back. If a disputed final outcome equals the proposal, the proposer receives two bonds; if it equals the alternative, the disputer receives two; if it equals neither, each receives one. Treasury never receives bonds.

## Invariants

At every completed transaction boundary, assuming USDG itself has not paused, confiscated, rebased, blacklisted, upgraded incompatibly, or charged a transfer fee:

1. `USDG.balanceOf(orderBook) >= orderBook.escrowedUSDG`.
2. `orderBook.escrowedUSDG` equals the sum of every open buy remainder times its price plus exact 1% reserve.
3. `USDG.balanceOf(feeVault) >= feeVault.totalClaimable`, which equals the sum of creator claims.
4. For each market, `USDG.balanceOf(collateralVault) >= collateralVault.locked`.
5. Before resolution, `totalYES == totalNO == locked / 1e6`.
6. After YES, `locked == outstandingYES * 1e6`; after NO, `locked == outstandingNO * 1e6`.
7. After INVALID, `locked == (outstandingYES + outstandingNO) * 500,000`.
8. User share balances plus book-escrowed shares equal total outstanding for each side.
9. Book-held shares equal unfilled sell-order remainders for that market and side.
10. Every vault decrease follows the same transaction's share burn and exact payout calculation.
11. `USDG.balanceOf(eventMarket) >= bondEscrowed`; after resolution both equal zero absent a donation.
12. Creator claims, protocol/listing fees, and bond settlement never change `collateralVault.locked`.

Unit tests use equality because they introduce no donations. Randomized invariant tests interleave 160 placements, fills, partial fills, resales, cancellations, claims, resolution, and redemption while checking all stores. Exhaustive price tests cover all 1–99 cent ticks. Event tests cover all bond allocation branches and YES, NO, and INVALID conservation. Fork lifecycles repeat the checks with canonical mainnet USDG.
