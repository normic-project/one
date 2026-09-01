# Audit scope

This package covers the immutable One Shot v1.0.0 pre-audit candidate for Robinhood Chain mainnet, chain ID 4663. The frozen production Solidity source hash is `sha256:6e85cda2cfac7c8a5c5d9814985d567f674bba54967593b0c270c02e49e29810`.

## In scope

All production Solidity is in scope:

- `contracts/MarketFactory.sol`: listing fee, registry, dependency validation, shared-component construction, EIP-1167 creation and atomic initialization.
- `contracts/AutoMarket.sol`: locked AUTO implementation and historical-TWAP resolution entry point.
- `contracts/EventMarket.sol`: proposal, dispute, adjudication, bond settlement and finalization.
- `contracts/PredictionMarket.sol`: shared market storage, metadata commitments, collateralized pair minting, share escrow/release and redemption.
- `contracts/OrderBook.sol`: buy/sell escrow, exact-price matching, partial fills, cancellations, primary minting, secondary sales and fee settlement.
- `contracts/FeeVault.sol`: creator-fee liabilities and claims; protocol-fee routing.
- `contracts/CollateralVault.sol`: isolated per-market backing custody.
- `contracts/resolution/UniswapTwapResolver.sol`: pool validation, timestamp-anchored arithmetic-mean-tick TWAP and price orientation.
- `contracts/interfaces/IResolutionModule.sol`: shared market, outcome and term types.
- `contracts/libraries/TradeMath.sol`: size/price validation and exact fee arithmetic.
- `contracts/libraries/TickMath.sol`: Uniswap tick-to-price calculation.

Critical non-Solidity inputs are also in scope: `hardhat.config.cjs`, `package.json`, `package-lock.json`, `config/mainnet.json`, `.env.example`, `scripts/deploy.cjs`, `scripts/simulate.cjs`, `scripts/run-fork-simulation.cjs`, `scripts/validate.cjs`, `scripts/audit.cjs`, `scripts/hash-release.cjs`, `scripts/generate-audit-artifacts.cjs`, `scripts/secret-scan.cjs`, `scripts/audit-verify.cjs`, and every file under `test/`.

Review must cover collateral conservation, escrow accounting, fee isolation, bond isolation, clone storage/initialization, implementation immutability, order replay/double-fill protection, secondary sales, cancellation, state boundaries, all resolution outcomes, access control, reentrancy, token assumptions, timestamp-anchored TWAP behavior, constructor/deployment ordering and deterministic address dependencies.

## External dependencies and assumptions

OpenZeppelin Contracts 5.4.0 and the imported EIP-1167 `Clones` implementation are in scope as integrated dependencies. Robinhood Chain, canonical USDG/WETH, the selected Uniswap V3 pool/factory and the Resolver Safe are external trust/dependency surfaces; their own implementations and operational controls are not authored here.

## Out of scope

The React UI, visual design, indexer availability, wallet software, RPC-provider internals, Safe signer devices/processes, USDG issuer governance, Uniswap governance, economic/liquidity guarantees, legal/regulatory approval and production operations are out of Solidity audit scope. Test mocks under `contracts/test/` are test-only. Reviewers should still report integration risks where out-of-scope systems affect contract security.
