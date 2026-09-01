# Fund flows

USDG has six decimals. Shares are whole units. Prices are integer cents from 1 through 99.

## Listing

The creator sends exactly 0.0006 ETH to MarketFactory. The factory forwards the entire amount to the immutable treasury after clone initialization and registration. Failure to transfer reverts the whole creation transaction.

## Primary trading

A buy order escrows `principal + 1% fee reserve` in OrderBook. For `q` shares at price `p` cents, `principal = q * p * 10,000` USDG base units. Protocol fee is exactly `principal * 4 / 1000`; creator fee is exactly `principal * 6 / 1000`.

Opposite YES and NO buys whose prices sum to 100 cents fund exactly `q * 1,000,000` into that market’s CollateralVault. The 0.4% portion goes to treasury and 0.6% becomes a creator liability in FeeVault. Fees never enter collateral.

## Cancellation and secondary trading

Cancelling an unfilled buy returns remaining principal and its unearned fee reserve. Cancelling a sell returns escrowed shares. A secondary match pays principal to the seller, routes the same 0.4%/0.6% fees, and transfers already-backed shares; CollateralVault does not move.

## Event bonds

Proposal transfers 25 USDG to the EventMarket clone and increments isolated `bondEscrowed`. A valid alternative dispute transfers another 25 USDG. Undisputed finalization returns one bond to the proposer. After adjudication, both bonds go to the party whose stated outcome wins; if the Safe chooses the third outcome, each party receives its own bond. Bond liability is zeroed before outgoing transfers.

## Redemption

For YES or NO resolution, each winning share pays 1 USDG and each losing share pays zero. INVALID pays 0.5 USDG per YES share and 0.5 USDG per NO share. Shares and totals are reduced before the vault releases payment. Each vault accepts releases only from its immutable market clone.

## Liability separation

| Store | Liability | Authorized decrease |
| --- | --- | --- |
| OrderBook | Open buy principal/fees and escrowed sell shares | Fill settlement or cancellation |
| FeeVault | Sum of creator fee claims | Corresponding creator claim |
| CollateralVault | Outstanding redemption backing for one market | That market burns shares and releases payout |
| EventMarket | Proposal/dispute bonds in `bondEscrowed` | One finalization/adjudication settlement |
| Treasury | No protocol liability | External treasury policy |

Exact incoming-balance checks reject fee-on-transfer behavior. Donations are surplus and are not made withdrawable through an administrative sweep.
