# Roles and privileges

| Actor | Granted capabilities | Capabilities not granted |
| --- | --- | --- |
| Any address | Create markets, place/match/cancel orders, resolve eligible AUTO markets, propose/dispute EVENT outcomes, finalize undisputed outcomes, redeem | Upgrade contracts, replace implementations, move another account’s assets, sweep protocol balances |
| Market creator | Define bounded immutable terms at initialization; receive/claim 0.6% creator fees | Edit/delete terms, decide outcomes, access collateral or bonds, change fees |
| Treasury | Receive 0.0006 ETH listing fees and 0.4% trading fees | Change configuration, resolve markets, claim creator fees, access escrow/vaults/bonds |
| Resolver Safe | Adjudicate YES, NO or INVALID only after a valid EVENT dispute | Resolve AUTO or undisputed EVENT markets, change terms, transfer protocol assets |
| Deployer | Submit the four initial deployment transactions | No post-deployment owner/admin role exists; compromise after deployment cannot reconfigure contracts |
| Factory | Register its own clones and call their initializer atomically | Cannot replace implementation immutables or mutate an initialized clone |
| OrderBook | Mint matched pairs, escrow/release shares, record trades | Cannot resolve markets or release collateral directly |
| Market clone | Create/control its CollateralVault and release redemption payout | Cannot access another market’s vault |
| Frontend/indexer | Present derived data and build user transactions | Cannot alter onchain state without a user-signed transaction |

There is no owner, proxy admin, beacon, pauser, upgrader, rescue role, fee setter, oracle setter, implementation setter or arbitrary-call authority. Resolver Safe and treasury are intentionally distinct addresses. Security and legal acknowledgements remain unset.
