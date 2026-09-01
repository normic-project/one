# Read model and optional indexer

The protocol does not require a backend for correctness. The factory enumerates markets; contracts expose immutable metadata, state, balances, and paginated order IDs; events provide history. The current client reads those sources directly and derives homepage categories from created markets rather than a hardcoded market list.

A production indexer can improve search, portfolio cost basis, category views, sorting, resolver queues, and alerts. It must remain read-only: it may never sign orders, propose/dispute/adjudicate, mint shares, choose outcomes, or become a settlement dependency. Clients should simulate and confirm live contract state immediately before every transaction.

Suggested core schema:

```sql
CREATE TABLE chain_cursor (
  chain_id BIGINT PRIMARY KEY,
  block_number BIGINT NOT NULL,
  block_hash TEXT NOT NULL
);

CREATE TABLE chain_events (
  chain_id BIGINT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INT NOT NULL,
  block_number BIGINT NOT NULL,
  block_hash TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  event_name TEXT NOT NULL,
  payload JSONB NOT NULL,
  PRIMARY KEY (chain_id, tx_hash, log_index)
);

CREATE TABLE markets (
  chain_id BIGINT NOT NULL,
  address TEXT NOT NULL,
  creator TEXT NOT NULL,
  market_type TEXT NOT NULL,
  category TEXT NOT NULL,
  created_block BIGINT NOT NULL,
  closes_at BIGINT NOT NULL,
  resolves_at BIGINT NOT NULL,
  metadata JSONB NOT NULL,
  metadata_hash TEXT NOT NULL,
  state TEXT NOT NULL,
  resolved_outcome TEXT NOT NULL,
  volume_usdg NUMERIC(78,0) NOT NULL DEFAULT 0,
  PRIMARY KEY (chain_id, address)
);

CREATE TABLE orders (
  chain_id BIGINT NOT NULL,
  book TEXT NOT NULL,
  order_id NUMERIC(78,0) NOT NULL,
  market TEXT NOT NULL,
  owner TEXT NOT NULL,
  outcome TEXT NOT NULL,
  side TEXT NOT NULL,
  price_cents INT NOT NULL,
  original_shares NUMERIC(78,0) NOT NULL,
  remaining_shares NUMERIC(78,0) NOT NULL,
  expires_at BIGINT NOT NULL,
  cancelled BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (chain_id, book, order_id)
);

CREATE TABLE event_resolution (
  chain_id BIGINT NOT NULL,
  market TEXT NOT NULL,
  proposer TEXT,
  proposed_outcome TEXT,
  proposal_evidence TEXT,
  proposal_evidence_hash TEXT,
  dispute_deadline BIGINT,
  disputer TEXT,
  disputed_outcome TEXT,
  dispute_evidence TEXT,
  dispute_evidence_hash TEXT,
  final_outcome TEXT,
  PRIMARY KEY (chain_id, market)
);
```

Store chain values as integers or canonical hex, never floating-point values. Preserve complete onchain strings and every metadata hash. Recompute commitments and flag any mismatch rather than accepting a frontend/indexer replacement. External source and evidence content should be fetched through an isolated, non-executing service with size/type/time limits; untrusted HTML must never be rendered directly.

Replay at least `MarketCreated`, metadata creation events, `OrderPlaced`, `OrdersMatched`, `OrderCancelled`, fee accrual/claim, `OutcomeProposed`, `OutcomeDisputed`, `DisputeAdjudicated`, `BondsSettled`, resolution, and redemption. Use transaction hash plus log index for idempotence. Keep confirmed and recent projections separate. On reorganization, find a common ancestor using stored block hashes, delete later projections, and deterministically replay.

The managed Robinhood RPC currently accepts `eth_getLogs` ranges of at most ten blocks, so direct scanning and indexer ingestion must chunk queries accordingly unless a different provider explicitly supports more. A failed or missing historical range is an incomplete projection, not an empty range.

For portfolio cost basis, add filled purchases including buyer fees to basis; a sale or redemption removes the proportional average basis. Include sale-escrowed shares in holdings and exclude unfilled buys. INVALID value is exactly 0.5 USDG per remaining share after resolution. A last trade can provide an indicative mark, but it is neither guaranteed execution nor net asset value.

Application moderation may attach visibility, jurisdiction, spam, or illegal-content labels to market addresses. Such records must be clearly application-specific and cannot overwrite immutable rules, source commitments, state, or outcome.
