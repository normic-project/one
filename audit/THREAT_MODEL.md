# Threat model

| Threat | Contract mitigation | Residual risk |
| --- | --- | --- |
| Collateral theft | Per-market vault; only market can release through redemption | Token/chain defects |
| Resolver compromise | Authority limited to one post-time outcome | Incorrect outcome selection |
| Resolver outage | No alternate privileged role | Market may remain unresolved |
| Order replay/overfill | Stored remaining amounts, expiry, cancellation and compatibility checks | Public ordering/MEV |
| Callback reentrancy | Reentrancy guards and checks/effects/interactions | Nonstandard token behavior |
| Ambiguous sources | Immutable bounded rules and source commitments | Bad terms cannot be repaired |
| USDG controls | Exact-transfer checks and canonical validation | Issuer restrictions may block transfers |
