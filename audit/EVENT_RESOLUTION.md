# EVENT resolution

An EVENT market stores bounded question, outcome labels, category, rules, sources and metadata URI in clone storage and commits deterministic hashes during atomic initialization. Close and resolution timestamps are fixed before trading.

At or after `resolvesAt`, any address can propose YES, NO or INVALID with nonempty evidence of at most 512 bytes and an exact 25 USDG bond. Only one proposal is accepted. The proposal opens a 24-hour dispute window.

Before the deadline, a different address can dispute once by selecting a different non-NONE outcome, supplying bounded evidence and depositing another 25 USDG. At and after the deadline, disputes reject. If no dispute exists after the deadline, anyone may finalize the proposal and the proposer receives its bond back.

A disputed market can be adjudicated only by the immutable Resolver Safe. It may choose YES, NO or INVALID. If the final outcome matches the proposal, the proposer receives both bonds. If it matches the alternative, the disputer receives both. If it matches neither, each receives one bond. Liability is zeroed before transfers and resolution cannot execute twice.

Optimistic resolution requires independent monitoring. An incorrect proposal becomes final if nobody disputes in time. Ambiguous questions, unavailable sources, evidence quality, watcher liveness, bond adequacy and Safe conflicts remain operational/economic risks. The Safe can choose an incorrect disputed result or become unavailable, but it cannot directly withdraw collateral, order escrow or creator fees.
