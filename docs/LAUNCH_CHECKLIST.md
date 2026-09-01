# Manual mainnet launch checklist

## Review and operations

- [ ] Review the exact source/compiler/lockfile hash, production bytecode, constructor plan, EIP-1167 initialization, vaults, fees, order matching, resolution access, and deployment recovery.
- [ ] Review exact-price liquidity, spam cost, ambiguous-question, resolver-unavailability, USDG issuer, and stranded-market risks.
- [ ] Publish terms, risk disclosures, privacy policy, security contact, incident response, and coordinated disclosure process.
- [ ] Confirm `RESOLVER_MULTISIG_ADDRESS` is the intended module-free, unguarded 3-of-5 Safe with independently controlled signers.
- [ ] Approve a resolution policy covering immutable rules, source precedence, evidence preservation, conflicts, recusal, signer availability, INVALID criteria, and public reasoning.

## Infrastructure and custody

- [ ] Two people verify treasury, deployer, and Resolver Safe addresses. Treasury must accept the exact 0.0006 ETH call and USDG transfers.
- [ ] Production `RH_RPC_URL` provides chain 4663, fresh heads, archive state, ten-block log queries, and the pinned fork.
- [ ] Review canonical USDG code, metadata, supply, issuer policies, and transfer behavior.
- [ ] Store the encrypted deployer keystore outside the repository. Never expose a key, password, or RPC token through Vite, logs, chat, source control, or command history.
- [ ] Fund the deployer only after the final gas quote, with at least the reported 30% headroom plus any separately determined L1 data fee.

## Exact release verification

- [ ] Run `npm ci --ignore-scripts` from the reviewed lockfile and review the production dependency audit.
- [ ] Run lint, compilation/build, all contract/accounting/security tests, all desktop/mobile browser tests, local simulation, live validation, and pinned fork simulation.
- [ ] Review YES, NO, INVALID, secondary-sale, fee, collateral, cancellation, and redemption results in `reports/mainnet-simulation.json`.
- [ ] Run `npm run deploy` without `--broadcast`; review validation and deployment-plan reports, immutables, predicted addresses, nonce, bytecode/calldata hashes, gas, and balance.
- [ ] Confirm no secret appears in build output, reports, git changes, browser source maps, CI artifacts, terminal logs, or frontend variables.

## Broadcast and activation

- [ ] Only an authorized operator runs `npm run deploy -- --broadcast`; inspect the partial manifest before retrying because the two transactions are not atomic.
- [ ] Verify confirmations, runtime bytecode, source, constructors, immutables, 45-byte clone runtime, OrderBook, FeeVault, listing fee, fee split, and Safe address on Blockscout.
- [ ] Run post-deployment read-only smoke checks before creating a real market or accepting deposits.
- [ ] Set the public factory address and deployment block, rebuild the exact frontend, and deploy it with appropriate web security controls.
- [ ] Monitor collateral, order escrow, fee liability, unresolved markets, Safe operation, USDG restrictions, treasury transfers, RPC health, and source availability.

Default repository state is read-only: no transaction has been broadcast and the deployer is unfunded.
