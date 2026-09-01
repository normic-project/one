# Architecture

## Global deployment

The deployment sends four ordered creation transactions: `UniswapTwapResolver`, locked `AutoMarket`, locked `EventMarket`, then `MarketFactory`. The first three constructors are bound to addresses predicted from the deployer nonce. `MarketFactory` creates one `FeeVault` and one `OrderBook` in its constructor and rejects any mismatch between its configured dependencies and the two implementation immutables.

The resulting six global addresses are the resolver, two implementations, factory, fee vault and order book. There is no owner, administrator, proxy admin, beacon, pause authority, implementation setter, upgrade method or arbitrary external-call surface.

## Market deployment

`MarketFactory.createAutoMarket` or `createEventMarket` deploys a standard EIP-1167 clone with OpenZeppelin Contracts 5.4.0. The 45-byte clone runtime is:

`0x363d3d373d3d3d363d73<20-byte-implementation>5af43d82803e903d91602b57fd5bf3`

The implementation address is part of runtime code rather than a mutable storage slot. Immediately after `CREATE`, in the same transaction, the factory calls the type-specific initializer. Initialization creates one `CollateralVault` from the clone context and records creator, times, metadata and resolution terms. Any initializer failure reverts clone creation and the listing-fee transfer.

## Clone safety properties

- Implementation constructors set the private initializer guard, permanently preventing direct implementation initialization.
- Clone storage begins blank; the first initializer sets the guard before continuing.
- The factory initializes in the creation transaction, so no third party can front-run initialization.
- A second initializer call reverts.
- Factory implementation references are Solidity immutables and have no setter.
- Existing clone runtime fixes its implementation independently of the factory.
- Each clone owns isolated market storage. Delegatecall accesses the clone’s state, never another clone’s state.
- Each clone creates and is the immutable controller of a separate CollateralVault.
- The implementations contain no `selfdestruct`, upgrade or arbitrary delegate target.

Evidence is in `test/contracts.js` under “locks implementations and initializes each fixed-implementation clone exactly once” and in `audit/artifacts/index.json`.

## Shared and isolated state

`OrderBook` centralizes order IDs, USDG/share escrow and matching across registered markets, but every order records its market and all market calls are registry-gated. `FeeVault` centralizes creator-fee liabilities keyed by market. Collateral never enters either shared liability ledger: matched-pair principal moves into the relevant market’s isolated vault. Event bonds remain in the relevant EventMarket clone and are accounted by `bondEscrowed`.

The main shared failure domains are OrderBook and FeeVault. Market resolution and backing remain per-market. A defect in a fixed implementation can affect all clones of that type, as the previous identical full-copy bytecode would have; immutability prevents a compromised actor from replacing it.

## Compiler architecture

Solidity is pinned to solc-js `0.8.28+commit.7893614a`. All sources use optimizer 200 and Paris EVM. `MarketFactory.sol` alone uses viaIR; all other direct artifacts use the standard pipeline. Internal libraries are inlined; no external library address is linked.
