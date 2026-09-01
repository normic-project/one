# Threat model

| Threat | Impact | Mitigation | Residual risk |
| --- | --- | --- | --- |
| Malicious creator | Deceptive or ambiguous terms; wash activity | Bounded immutable metadata, commitments, no creator resolution/control, public warnings | Semantics cannot be proven objective onchain |
| Malicious trader | Attempts theft, invalid sizes, replay or insolvency | Exact escrow, registered-market gates, balance checks, checked arithmetic, invariant tests | MEV, spam and multi-address wash trading remain possible |
| Malicious matcher | Selective ordering or hostile fill attempts | Permissionless deterministic checks; maker price/side/market/deadline fixed | Match ordering and front-running can affect execution priority |
| Malicious proposer | Proposes false EVENT result | Exact bond, public evidence, full dispute window | Wrong result finalizes if no watcher disputes |
| Malicious disputer | Griefs settlement or supplies false alternative | Equal bond, one dispute, distinct party/outcome | Can force Safe work and delay finality for bond cost |
| Compromised Resolver Safe | Chooses wrong disputed outcome or withholds action | Authority limited to disputed EVENT outcome; no asset sweep or AUTO role | Disputed markets can be wrongly resolved or stranded |
| Compromised treasury | Loses fees or rejects listing ETH | No access to collateral/escrow/bonds/configuration | Rejecting ETH blocks new market creation; received fees are externally custodial |
| Compromised deployer | Changes transaction sequence or arguments before launch | Constructor validation, predicted-address checks, manifest and dry-run review | Before deployment, compromise can deploy a different candidate; after deployment no privilege remains |
| Clone initialization attack | Attacker becomes creator or chooses terms | Factory initializes immediately in the same transaction; guard set before body | Correctness depends on fixed factory flow and EVM transaction atomicity |
| Implementation substitution | Existing/future clones execute hostile code | Implementation addresses are factory immutables and clone runtime constants; no setter/admin | A defect in the originally frozen implementation affects every clone of that type |
| Storage collision | Delegate code corrupts clone state | No proxy bookkeeping slots; one compiled layout per implementation; regression tests | Future source changes must never be assumed layout-compatible; architecture has no upgrade path |
| Reentrancy | Duplicate fill, refund, fee claim, bond settlement or creation | ReentrancyGuard, effects before interactions, SafeERC20, callback regression tests | Malicious/nonstandard tokens remain an integration risk and are rejected where balances differ |
| Order replay | Reuse of filled/cancelled order | Monotonic IDs, filled/cancelled state, remainder checks | Same economic intent can be recreated as a new signed transaction by its owner |
| Double fill | Escrow deficit or duplicate shares | Fill bounded by remainder; state updated before transfers/calls | No known residual under assumed EVM/token behavior |
| Partial-fill accounting | Rounding extraction or orphaned reserve | Whole shares, cent prices and principal multiples of 10,000 make fees exact; exhaustive tests | Maximum-size arithmetic and future token changes require continued review |
| Rounding | Fee or payout imbalance | Six-decimal constants, integer cents, exact 0.4%/0.6% arithmetic, 0.5 INVALID constant | UI conversions can display rounded values incorrectly |
| USDG decimals/behavior | Mispricing, blocked transfers or insolvency perception | Factory requires 6 decimals; exact incoming-balance checks reject transfer tax | Issuer pause, blacklist, confiscation or incompatible upgrade can strand funds |
| TWAP manipulation | Incorrect AUTO result | Fixed 3,600-second historical arithmetic-mean tick; no spot fallback | Thin liquidity may make full-window manipulation economical |
| MEV/front-running | Reordered fills, proposal/dispute race, creation visibility | User-set order deadlines/limits; onchain deterministic state; dispute accepted only before deadline | Public mempool ordering cannot be eliminated |
| Timestamp boundaries | Unexpected close/dispute eligibility | Explicit `<`, `<=`, `>=` checks and boundary tests | Block producers have limited timestamp discretion |
| Dispute griefing | Delayed finality and Safe workload | 25 USDG bond, one alternative dispute | Static bond may become too cheap or too expensive over time and is immutable |
| Ambiguous questions | Subjective or contested EVENT settlement | Full bounded rules/sources, immutable hashes, frontend warnings | Safe judgment and legal/social disagreement remain |
| Metadata replacement | Users trade against changed terms | Onchain storage and deterministic combined commitment; no mutation/deletion functions | Offchain source content at a URL can change or disappear |
| RPC failure | Missing markets/orders or unsafe UI assumptions | Read-only fork validation, fail-closed client scanning, direct state confirmation | Provider outages and incomplete history can impair UX/monitoring |
| Frontend/indexer compromise | Misleading display or malicious transaction construction | Contracts remain authoritative; wallet shows transaction target/data; immutable metadata available | Users can still approve a malicious transaction from a compromised interface |
| Factory/shared OrderBook defect | Multi-market impact | Minimal immutable surface, market registry, full accounting/reentrancy tests | Shared components deliberately create a global failure domain |
| CollateralVault defect | Loss/lock of one market’s backing | Minimal vault, immutable market controller, per-market isolation | A shared source defect can repeat across vault instances |

This document identifies controls and residual risks; it does not claim any threat is impossible.
