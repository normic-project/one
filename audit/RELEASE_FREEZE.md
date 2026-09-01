# Pre-audit release freeze policy

This tag identifies an audit candidate, not an audited or legally approved deployment. Frozen production Solidity source must remain exactly `sha256:6e85cda2cfac7c8a5c5d9814985d567f674bba54967593b0c270c02e49e29810`.

The annotated tag `v1.0.0-preaudit` is the canonical identity. Resolve it with:

```text
git rev-parse v1.0.0-preaudit^{commit}
git rev-parse v1.0.0-preaudit^{tree}
```

The manifest uses these self-resolving references because embedding a literal commit/tree inside the commit would create an impossible self-reference. The final handoff report records the resolved values.

Any production Solidity change invalidates this freeze and requires a new source hash, bytecode package, full suite, fork simulation, commit and tag. Audit-document-only corrections require a new audit-package/release hash and a clearly documented commit; they must not be silently folded into this tag. Never force-move the annotated tag.

`npm run audit:verify` is the read-only verification entry point. It must pass from the tagged source before reviewer handoff. Generated build outputs may be deleted/recreated; frozen source, tests, configuration, audit files and lockfile may not change.

Security and legal statuses are **NOT COMPLETED**. `SECURITY_REVIEW_ACK` and `LEGAL_REVIEW_ACK` remain unset. Deployment, funding, keystore access, production frontend configuration, pushing and transaction broadcast are outside this freeze.
