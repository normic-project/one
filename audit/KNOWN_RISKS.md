# Known risks and limitations

1. **No independent security review yet.** The package is prepared for review. Tests, lint and simulations are not an audit or formal verification.
2. **No legal approval yet.** Permissionless prediction markets can trigger licensing, gambling, derivatives, election, sanctions, consumer-protection, tax and territorial restrictions. Contracts implement no KYC, age gate or geofence.
3. **Immutable defects cannot be patched.** There is no pause, rescue or upgrade authority. A discovered issue requires interfaces to stop creating/using affected markets and a separately reviewed replacement for future activity.
4. **Shared implementation and OrderBook risk.** Fixed implementations serve every clone of a type, and one OrderBook serves all markets. A logic defect can affect multiple markets even though each clone’s state and collateral vault are isolated.
5. **USDG issuer risk.** Pause, blacklist, confiscation, transfer-policy changes, upgrade or loss of the six-decimal assumption can block escrow, cancellation, bond settlement, fee claims or redemption.
6. **TWAP economics.** A one-hour TWAP is not manipulation-proof. Security depends on WETH/USDG liquidity and observation history. Missing observations strand AUTO resolution because there is no fallback.
7. **Optimistic monitoring.** An incorrect EVENT proposal finalizes if undisputed for 24 hours. Watchers require reliable indexing and 25 USDG per dispute.
8. **Resolver Safe risk.** A compromised threshold can choose any disputed outcome; unavailable signers can strand disputed markets. Safe signer policy, custody and conflicts are outside contract enforcement.
9. **Ambiguous content.** Arbitrary questions can be deceptive, illegal or subjective. Bounds and commitments preserve text but do not make it objective.
10. **URL/evidence availability.** Onchain hashes prove the submitted text, not that linked content remains available or safe.
11. **MEV and liquidity.** Exact-price matching can be sparse. Transaction ordering affects fills. Multi-address self-trading cannot be reliably prevented.
12. **Four-step deployment.** Initial creation is non-atomic. Nonce drift invalidates predicted dependencies. The deployment script validates each receipt and writes a partial manifest, but operators must stop on any mismatch.
13. **No L1 data-fee quote.** The standard RPC supplied execution gas but not an additional L1 data component. Funding estimates must retain headroom and be refreshed at launch.
14. **Frontend/indexer trust.** A compromised UI can misrepresent state or propose hostile transactions. Users must confirm contract addresses and wallet calldata.
