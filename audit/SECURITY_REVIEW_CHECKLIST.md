# Independent security review checklist

Status: **NOT COMPLETED**. Checking an item requires reviewer evidence; this freeze does not acknowledge completion.

- [ ] Confirm scope and frozen Git tag/commit/tree.
- [ ] Reproduce solc 0.8.28 bytecode from package-lock and compiler configuration.
- [ ] Review EIP-1167 runtime, fixed implementation targets, initialization lock and atomicity.
- [ ] Review storage layout and delegatecall assumptions for both clone types.
- [ ] Prove collateral, order escrow, fee and bond liabilities remain isolated and solvent.
- [ ] Review every external call, callback order and reentrancy boundary.
- [ ] Review full/partial fills, cancellation, expiry, order replay and secondary sales.
- [ ] Review fee exactness at all cent ticks and maximum order sizes.
- [ ] Review YES/NO/INVALID payout conservation and repeated redemption/resolution.
- [ ] Review EVENT state boundaries, evidence, bond branches and Resolver Safe authorization.
- [ ] Review WETH/USDG orientation, tick rounding, decimals, observation interval and manipulation economics.
- [ ] Review metadata commitments, bounded strings and source/evidence availability risks.
- [ ] Review all constructor validation and predicted-address deployment dependencies.
- [ ] Review canonical mainnet token, pool, Safe and treasury configuration.
- [ ] Review nonstandard/issuer-controlled USDG behavior assumptions.
- [ ] Review operational monitoring, disclosure and incident-response plan.
- [ ] Record every finding in `FINDINGS_TEMPLATE.md` or equivalent tracker.
- [ ] Confirm fixes, regression tests and a new freeze/hash if production source changes.
- [ ] Issue an independent report tied to the exact Git commit and source hash.

`SECURITY_REVIEW_ACK` remains unset until this checklist and the independent report are complete.
