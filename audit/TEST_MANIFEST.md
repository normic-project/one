# Test manifest

## Frozen results

| Suite | Expected/validated result | Coverage |
| --- | --- | --- |
| `npm test` | 40/40 PASS | Contract behavior, accounting, configuration, access and reentrancy |
| `npm run test:ui` | 16/16 PASS | Browser behavior and critical user flows |
| `npm run lint` | PASS | ESLint and Solhint |
| `npm run build` | PASS | clean Solidity compile, ABI export, TypeScript and Vite production build |
| `npm run audit:production` | PASS | production dependency advisory scan |
| `npm run simulate:fork` | PASS | pinned Robinhood mainnet fork and four complete lifecycles |
| `npm run deploy` without `--broadcast` | PASS | validation, suites, fork simulation and exact deployment dry-run |

## Contract coverage map

- Clone lock, exact EIP-1167 runtime target, atomic initialization and double-init rejection: `test/contracts.js` first test.
- Listing fee, dependency validation and creation reentrancy: factory tests plus `test/reentrancy.js`.
- Metadata commitments/bounds/no mutation: metadata tests.
- Primary collateral and exact 0.4%/0.6% split: mint/fee tests.
- Cancellation, partial fill, expired/replayed/double fill and secondary YES/NO sales: order tests.
- Creator claim and fee isolation: fee claim and randomized invariant tests.
- Proposal/dispute/finalize/adjudicate, evidence bounds and all bond branches: EVENT tests.
- YES/NO/INVALID redemption, conservation and double redemption: redemption tests.
- Resolver authorization and absence of privileged collateral/rule controls: access tests.
- Pool binding, timestamp-anchored TWAP, delayed resolution, threshold directions and missing observations: resolver tests.
- Transfer-tax rejection and callback resistance: token/reentrancy tests.
- 160-operation store solvency plus every cent tick and fill partition: `test/accounting.js`.

## Mainnet-fork evidence

The pinned fork uses chain ID 4663 with canonical USDG, WETH and approved WETH/USDG pool. It deploys the exact candidate with configured treasury and Resolver Safe, impersonates an existing USDG holder for read-only fork testing, verifies clone/vault bindings and completes AUTO, EVENT undisputed, EVENT disputed and EVENT INVALID lifecycles. No public-chain state is changed.

## Reproducibility

`npm run audit:verify` cleans and recompiles, regenerates bytecode records to a temporary directory, compares all frozen creation/runtime SHA-256 hashes, runs secret scan, contract tests, browser tests, lint, production build and production dependency audit, and verifies the tagged Git identity when the tag exists.
