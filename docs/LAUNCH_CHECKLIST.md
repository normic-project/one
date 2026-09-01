# Manual mainnet launch checklist

No box is completed merely because an environment value is present. `SECURITY_REVIEW_ACK` and `LEGAL_REVIEW_ACK` may be set only after the corresponding independent work is complete.

## Independent review

- [ ] Independent audit of the exact source/compiler/lockfile hash, production bytecode, constructor plan, trading engine, both locked implementations, EIP-1167 clone initialization, vaults, fees, bonds, state machines, access control, TWAP math, and deployment recovery.
- [ ] Remediate findings and obtain auditor confirmation for the final hash; do not reuse an acknowledgement after any material code change.
- [ ] Economic review of one-hour pool manipulation, pool liquidity changes, optimistic monitoring, 25 USDG bonds, exact-price liquidity, spam cost, and stranded-market risks.
- [ ] Qualified legal review for the intended jurisdictions, users, assets, political/sports/company/event content, licensing, consumer protection, sanctions, age, tax, privacy, marketing, and moderation controls.
- [ ] Written launch decision, scope, exclusions, terms, risk disclosures, privacy policy, security contact, incident response, and coordinated disclosure process.

## Resolver operations

- [ ] Deploy and independently verify a production Safe or equivalent at `RESOLVER_MULTISIG_ADDRESS`; recommended threshold is 3-of-5 with independently controlled signers.
- [ ] Confirm the resolver is distinct from creator, treasury, deployer, tokens, pool, vaults, book, and fee vault; verify its code exists at the pinned block used for the final simulation.
- [ ] Approve a documented adjudication policy covering immutable rules, source precedence, evidence preservation, conflicts, recusal, signer availability, INVALID criteria, public reasoning, and emergency key rotation at the Safe layer.
- [ ] Deploy redundant proposal watchers that alert and can fund a 25 USDG dispute before every 24-hour deadline. Test Safe transaction construction and signer response without calling production markets.

## Infrastructure and custody

- [ ] Two people verify treasury and deployer addresses. Treasury must accept the exact 0.0006 ETH call and USDG transfers; USDG issuer restrictions must not block it.
- [ ] Production `RH_RPC_URL` provides chain 4663, fresh heads, archive state, ten-block log queries, and the pinned fork. Add independent RPC/sequencer monitoring and a failover plan.
- [ ] Review canonical USDG/WETH code and issuer policies; canonical V3 factory/pool/token order/fee/liquidity/unlocked state/observation cardinality; one-hour history and manipulation cost.
- [ ] Store deployer keystore outside the repository in approved custody. Do not provide it during preflight and never expose a key/password/RPC token through Vite, logs, chat, source control, or command history.
- [ ] Fund the deployer only after the final gas quote, with at least the reported 30% headroom. Verify its pending nonce and that predicted implementation, resolver, and factory addresses have not changed.

## Exact release verification

- [ ] Run `npm ci --ignore-scripts` from the reviewed lockfile and review the production dependency audit.
- [ ] Run lint, compilation/build, every contract/accounting/security test, all desktop/mobile browser tests, local simulation, live validation, and pinned fork simulation.
- [ ] Review AUTO, EVENT-undisputed, EVENT-disputed, EVENT-INVALID, secondary-sale, fee, bond, collateral, and redemption results in `reports/mainnet-simulation.json`.
- [ ] Configure `RESOLVER_MULTISIG_ADDRESS`, then run `npm run deploy` without `--broadcast`. Review `reports/mainnet-validation.json` and `reports/deployment-plan.json` including every immutable, predicted address, nonce, bytecode hash, constructor-data hash, gas item, current balance, and unsupported L1 data-fee field.
- [ ] Confirm no secret appears in `dist/`, reports, git changes, browser source maps, CI artifacts, terminal logs, or frontend environment variables.
- [ ] Confirm `SECURITY_REVIEW_ACK=independently-audited` and `LEGAL_REVIEW_ACK=approved-for-target-jurisdictions` accurately describe completed reviews. Never set either to pass the gate early.

## Broadcast and activation

- [ ] Only an authorized operator runs `npm run deploy -- --broadcast`; inspect partial deployment manifests before any retry because four transactions are not atomic.
- [ ] Verify confirmations, deployed runtime bytecode, source, constructors, immutables, locked implementation bindings, 45-byte clone runtime, order book, fee vault, listing fee, fee split, and Safe address on Blockscout.
- [ ] Run post-deployment read-only smoke checks before creating a real market. Do not use user deposits as a test.
- [ ] Set `VITE_FACTORY_ADDRESS` and `VITE_DEPLOYMENT_BLOCK`, rebuild the exact frontend, and deploy with HTTPS, strict CSP, frame protection, `nosniff`, controlled RPC origin, safe external-link rendering, and jurisdiction/moderation controls approved by counsel.
- [ ] Monitor collateral liabilities, order escrow, fee liability, bond escrow, Safe proposals, event dispute deadlines, pending automatic resolution, Uniswap liquidity/observations, USDG restrictions, treasury transfers, RPC health, source availability, and frontend/indexer completeness.

Default repository state is intentionally blocked: no transaction has been broadcast, the deployer is unfunded, and the independent review acknowledgements are unset.
