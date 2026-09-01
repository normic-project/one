# Independent security review checklist

Status: **NOT COMPLETED**.

- [ ] Confirm the final scope, commit, contract hash, release hash, compiler, and dependency lock.
- [ ] Reproduce Solidity 0.8.28 bytecode and review EIP-1167 initialization and fixed implementation binding.
- [ ] Prove collateral, order escrow, and fee liabilities remain isolated and solvent.
- [ ] Review every external call, callback order, and reentrancy boundary.
- [ ] Review full/partial fills, cancellation, expiry, replay prevention, and secondary YES/NO sales.
- [ ] Review fee exactness at all cent ticks and maximum order sizes.
- [ ] Review YES/NO/INVALID payout conservation and repeated redemption/resolution.
- [ ] Review resolver-only access, exact timestamp boundaries, Safe assumptions, and unavailability risk.
- [ ] Review bounded metadata and deterministic immutable commitments.
- [ ] Review canonical USDG, factory/deployer prediction, constructor validation, and deployment recovery.
- [ ] Confirm fixes and repeat validation if production source changes.
