begin;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create table if not exists public.indexer_state (
  chain_id bigint primary key,
  start_block bigint not null,
  last_indexed_block bigint not null,
  last_indexed_block_hash text,
  confirmations integer not null default 32 check (confirmations between 1 and 10000),
  updated_at timestamptz not null default now()
);

create table if not exists public.chain_blocks (
  chain_id bigint not null,
  block_number bigint not null,
  block_hash text not null check (block_hash ~ '^0x[0-9a-f]{64}$'),
  block_timestamp timestamptz not null,
  primary key (chain_id, block_number)
);

create table if not exists public.markets (
  chain_id bigint not null,
  address text not null check (address ~ '^0x[0-9a-f]{40}$'),
  factory_index bigint not null,
  creator text not null check (creator ~ '^0x[0-9a-f]{40}$'),
  collateral_vault text not null check (collateral_vault ~ '^0x[0-9a-f]{40}$'),
  question text not null,
  yes_definition text not null,
  no_definition text not null,
  category text not null,
  resolution_rules text not null,
  primary_source text not null,
  secondary_source text not null default '',
  metadata_uri text not null default '',
  metadata_hash text not null check (metadata_hash ~ '^0x[0-9a-f]{64}$'),
  closes_at timestamptz not null,
  resolves_at timestamptz not null,
  outcome smallint not null default 0 check (outcome between 0 and 3),
  created_block bigint not null,
  created_block_hash text not null,
  created_tx_hash text not null,
  created_log_index integer not null,
  created_at timestamptz not null,
  resolved_block bigint,
  resolved_tx_hash text,
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (chain_id, address),
  unique (chain_id, factory_index),
  unique (chain_id, created_tx_hash, created_log_index)
);

create table if not exists public.indexed_logs (
  chain_id bigint not null,
  tx_hash text not null check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer not null,
  block_number bigint not null,
  block_hash text not null,
  block_timestamp timestamptz not null,
  contract_address text not null check (contract_address ~ '^0x[0-9a-f]{40}$'),
  event_name text not null,
  market_address text,
  payload jsonb not null default '{}'::jsonb,
  primary key (chain_id, tx_hash, log_index)
);

create table if not exists public.order_events (
  chain_id bigint not null,
  tx_hash text not null,
  log_index integer not null,
  event_type text not null check (event_type in ('placed','matched','cancelled')),
  block_number bigint not null,
  block_hash text not null,
  block_timestamp timestamptz not null,
  market_address text,
  order_id numeric(78,0),
  secondary_order_id numeric(78,0),
  wallet text,
  payload jsonb not null,
  primary key (chain_id, tx_hash, log_index)
);

create table if not exists public.orders (
  chain_id bigint not null,
  order_id numeric(78,0) not null,
  market_address text not null,
  owner text not null,
  expires_at timestamptz not null,
  price smallint not null check (price between 1 and 99),
  yes boolean not null,
  buy boolean not null,
  shares numeric(78,0) not null check (shares >= 0),
  remaining numeric(78,0) not null check (remaining >= 0),
  status text not null check (status in ('open','filled','cancelled')),
  placed_block bigint not null,
  placed_tx_hash text not null,
  placed_log_index integer not null,
  updated_block bigint not null,
  primary key (chain_id, order_id)
);

create table if not exists public.trades (
  chain_id bigint not null,
  tx_hash text not null,
  log_index integer not null,
  block_number bigint not null,
  block_hash text not null,
  block_timestamp timestamptz not null,
  market_address text not null,
  first_order_id numeric(78,0) not null,
  second_order_id numeric(78,0) not null,
  first_owner text not null,
  second_owner text not null,
  first_yes boolean not null,
  second_yes boolean not null,
  first_buy boolean not null,
  second_buy boolean not null,
  shares numeric(78,0) not null,
  yes_price smallint not null check (yes_price between 1 and 99),
  notional numeric(78,0) not null,
  mint boolean not null,
  traded_at timestamptz not null,
  primary key (chain_id, tx_hash, log_index)
);

create table if not exists public.wallet_activity (
  chain_id bigint not null,
  tx_hash text not null,
  log_index integer not null,
  wallet text not null check (wallet ~ '^0x[0-9a-f]{40}$'),
  activity_type text not null,
  block_number bigint not null,
  block_hash text not null,
  block_timestamp timestamptz not null,
  market_address text,
  order_id numeric(78,0),
  yes boolean,
  amount numeric(78,0),
  quote_amount numeric(78,0),
  payload jsonb not null default '{}'::jsonb,
  primary key (chain_id, tx_hash, log_index, wallet, activity_type)
);

create table if not exists public.position_events (
  chain_id bigint not null,
  tx_hash text not null,
  log_index integer not null,
  wallet text not null,
  market_address text not null,
  yes boolean not null,
  event_type text not null check (event_type in ('buy','sell','redeem')),
  block_number bigint not null,
  block_hash text not null,
  block_timestamp timestamptz not null,
  shares_delta numeric(78,0) not null,
  cashflow_usdg numeric(78,0) not null,
  primary key (chain_id, tx_hash, log_index, wallet, yes, event_type)
);

create table if not exists public.wallet_positions (
  chain_id bigint not null,
  wallet text not null,
  market_address text not null,
  yes boolean not null,
  indexed_shares numeric(78,0) not null,
  net_investment_usdg numeric(78,0) not null,
  last_activity_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (chain_id, wallet, market_address, yes)
);

create table if not exists public.redemptions_claims (
  chain_id bigint not null,
  tx_hash text not null,
  log_index integer not null,
  event_type text not null check (event_type in ('redemption','creator_fee_claim')),
  wallet text not null,
  market_address text,
  yes boolean,
  shares numeric(78,0),
  amount numeric(78,0) not null,
  block_number bigint not null,
  block_hash text not null,
  block_timestamp timestamptz not null,
  primary key (chain_id, tx_hash, log_index)
);

create table if not exists public.fee_events (
  chain_id bigint not null,
  tx_hash text not null,
  log_index integer not null,
  event_type text not null check (event_type in ('accrued','claimed')),
  market_address text,
  creator text not null,
  protocol_fee numeric(78,0) not null default 0,
  creator_fee numeric(78,0) not null default 0,
  claimed_amount numeric(78,0) not null default 0,
  block_number bigint not null,
  block_hash text not null,
  block_timestamp timestamptz not null,
  primary key (chain_id, tx_hash, log_index)
);

create table if not exists public.market_stats (
  chain_id bigint not null,
  market_address text not null,
  volume_usdg numeric(78,0) not null default 0,
  trade_count bigint not null default 0,
  unique_traders bigint not null default 0,
  recent_volume_usdg numeric(78,0) not null default 0,
  recent_trade_count bigint not null default 0,
  recent_unique_traders bigint not null default 0,
  last_yes_price smallint not null default 0,
  last_trade_at timestamptz,
  trending_score numeric(78,0) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (chain_id, market_address)
);

create index if not exists markets_created_at_idx on public.markets (chain_id, created_at desc);
create index if not exists markets_creator_idx on public.markets (chain_id, creator, created_at desc);
create index if not exists markets_category_idx on public.markets (chain_id, category, created_at desc);
create index if not exists markets_closes_at_idx on public.markets (chain_id, closes_at);
create index if not exists markets_outcome_idx on public.markets (chain_id, outcome, closes_at);
create index if not exists markets_search_idx on public.markets using gin
  (to_tsvector('simple', question || ' ' || category || ' ' || yes_definition || ' ' || no_definition));
create index if not exists trades_market_time_idx on public.trades (chain_id, market_address, traded_at desc);
create index if not exists trades_block_idx on public.trades (chain_id, block_number);
create index if not exists orders_market_status_idx on public.orders (chain_id, market_address, status, placed_block desc);
create index if not exists orders_owner_idx on public.orders (chain_id, owner, placed_block desc);
create index if not exists wallet_activity_wallet_idx on public.wallet_activity (chain_id, wallet, block_number desc, log_index desc);
create index if not exists position_events_block_idx on public.position_events (chain_id, block_number);
create index if not exists redemptions_wallet_idx on public.redemptions_claims (chain_id, wallet, block_number desc);
create index if not exists indexed_logs_block_idx on public.indexed_logs (chain_id, block_number);
create index if not exists market_stats_trending_idx on public.market_stats (chain_id, trending_score desc);

create or replace view public.market_overview as
select m.*,
  case when m.outcome = 1 then 'resolved_yes'
       when m.outcome = 2 then 'resolved_no'
       when m.outcome = 3 then 'resolved_invalid'
       when m.closes_at <= now() then 'closed'
       else 'open' end as status,
  coalesce(s.volume_usdg, 0) as volume_usdg,
  coalesce(s.trade_count, 0) as trade_count,
  coalesce(s.unique_traders, 0) as unique_traders,
  coalesce(s.recent_volume_usdg, 0) as recent_volume_usdg,
  coalesce(s.recent_trade_count, 0) as recent_trade_count,
  coalesce(s.recent_unique_traders, 0) as recent_unique_traders,
  coalesce(s.last_yes_price, 0) as last_yes_price,
  s.last_trade_at,
  coalesce(s.trending_score, 0) as trending_score
from public.markets m
left join public.market_stats s on s.chain_id = m.chain_id and s.market_address = m.address;

create or replace view public.market_price_history as
select chain_id, market_address, tx_hash, log_index, block_number, block_hash,
  block_timestamp, traded_at, yes_price, 100 - yes_price as no_price, shares, notional
from public.trades;

create or replace view public.wallet_position_overview as
select p.*, m.question, m.category, m.closes_at, m.resolves_at, m.outcome,
  coalesce(s.last_yes_price, 0) as last_yes_price
from public.wallet_positions p
join public.markets m on m.chain_id = p.chain_id and m.address = p.market_address
left join public.market_stats s on s.chain_id = p.chain_id and s.market_address = p.market_address;

create or replace function public.rebuild_one_shot_derived(p_chain_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare e record;
begin
  delete from orders where chain_id = p_chain_id;
  insert into orders (chain_id, order_id, market_address, owner, expires_at, price, yes, buy, shares,
    remaining, status, placed_block, placed_tx_hash, placed_log_index, updated_block)
  select chain_id, order_id, market_address, wallet,
    to_timestamp((payload->>'expiresAt')::numeric), (payload->>'price')::smallint,
    (payload->>'yes')::boolean, (payload->>'buy')::boolean, (payload->>'shares')::numeric,
    (payload->>'shares')::numeric, 'open', block_number, tx_hash, log_index, block_number
  from order_events where chain_id = p_chain_id and event_type = 'placed'
  order by block_number, log_index;

  for e in select * from order_events where chain_id = p_chain_id and event_type <> 'placed'
    order by block_number, log_index loop
    if e.event_type = 'matched' then
      update orders set remaining = greatest(0, remaining - (e.payload->>'shares')::numeric),
        status = case when greatest(0, remaining - (e.payload->>'shares')::numeric) = 0 then 'filled' else 'open' end,
        updated_block = e.block_number
      where chain_id = p_chain_id and order_id in (e.order_id, e.secondary_order_id);
    else
      update orders set remaining = 0, status = 'cancelled', updated_block = e.block_number
      where chain_id = p_chain_id and order_id = e.order_id;
    end if;
  end loop;

  delete from wallet_positions where chain_id = p_chain_id;
  insert into wallet_positions (chain_id, wallet, market_address, yes, indexed_shares,
    net_investment_usdg, last_activity_at, updated_at)
  select chain_id, wallet, market_address, yes, sum(shares_delta), sum(cashflow_usdg),
    max(block_timestamp), now()
  from position_events where chain_id = p_chain_id
  group by chain_id, wallet, market_address, yes
  having sum(shares_delta) <> 0 or sum(cashflow_usdg) <> 0;

  delete from market_stats where chain_id = p_chain_id;
  insert into market_stats (chain_id, market_address, volume_usdg, trade_count, unique_traders,
    recent_volume_usdg, recent_trade_count, recent_unique_traders, last_yes_price,
    last_trade_at, trending_score, updated_at)
  select m.chain_id, m.address,
    coalesce(t.volume, 0), coalesce(t.trade_count, 0), coalesce(t.unique_traders, 0),
    coalesce(t.recent_volume, 0), coalesce(t.recent_trade_count, 0), coalesce(t.recent_unique_traders, 0),
    coalesce(t.last_yes_price, 0), t.last_trade_at,
    coalesce(t.recent_volume, 0) + coalesce(t.recent_trade_count, 0) * 1000000 +
      coalesce(t.recent_unique_traders, 0) * 2000000,
    now()
  from markets m
  left join lateral (
    select sum(x.notional) as volume, count(*) as trade_count,
      (select count(distinct trader) from (
        select first_owner as trader from trades where chain_id = p_chain_id and market_address = m.address
        union all select second_owner from trades where chain_id = p_chain_id and market_address = m.address
      ) traders) as unique_traders,
      sum(x.notional) filter (where x.traded_at >= now() - interval '24 hours') as recent_volume,
      count(*) filter (where x.traded_at >= now() - interval '24 hours') as recent_trade_count,
      (select count(distinct trader) from (
        select first_owner as trader from trades where chain_id = p_chain_id and market_address = m.address and traded_at >= now() - interval '24 hours'
        union all select second_owner from trades where chain_id = p_chain_id and market_address = m.address and traded_at >= now() - interval '24 hours'
      ) recent_traders) as recent_unique_traders,
      (array_agg(x.yes_price order by x.block_number desc, x.log_index desc))[1] as last_yes_price,
      max(x.traded_at) as last_trade_at
    from trades x where x.chain_id = p_chain_id and x.market_address = m.address
  ) t on true
  where m.chain_id = p_chain_id;

  update markets set outcome = 0, resolved_block = null, resolved_tx_hash = null, resolved_at = null
  where chain_id = p_chain_id;
  update markets m set outcome = (l.payload->>'outcome')::smallint,
    resolved_block = l.block_number, resolved_tx_hash = l.tx_hash, resolved_at = l.block_timestamp,
    updated_at = now()
  from indexed_logs l where l.chain_id = p_chain_id and l.event_name = 'Resolved'
    and m.chain_id = l.chain_id and m.address = l.market_address;
end;
$$;

create or replace function public.rollback_one_shot_from_block(p_chain_id bigint, p_from_block bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from wallet_activity where chain_id = p_chain_id and block_number >= p_from_block;
  delete from position_events where chain_id = p_chain_id and block_number >= p_from_block;
  delete from redemptions_claims where chain_id = p_chain_id and block_number >= p_from_block;
  delete from fee_events where chain_id = p_chain_id and block_number >= p_from_block;
  delete from trades where chain_id = p_chain_id and block_number >= p_from_block;
  delete from order_events where chain_id = p_chain_id and block_number >= p_from_block;
  delete from indexed_logs where chain_id = p_chain_id and block_number >= p_from_block;
  delete from chain_blocks where chain_id = p_chain_id and block_number >= p_from_block;
  delete from markets where chain_id = p_chain_id and created_block >= p_from_block;
  update indexer_state set last_indexed_block = p_from_block - 1,
    last_indexed_block_hash = null, updated_at = now() where chain_id = p_chain_id;
  perform rebuild_one_shot_derived(p_chain_id);
end;
$$;

alter table public.indexer_state enable row level security;
alter table public.chain_blocks enable row level security;
alter table public.markets enable row level security;
alter table public.indexed_logs enable row level security;
alter table public.order_events enable row level security;
alter table public.orders enable row level security;
alter table public.trades enable row level security;
alter table public.wallet_activity enable row level security;
alter table public.position_events enable row level security;
alter table public.wallet_positions enable row level security;
alter table public.redemptions_claims enable row level security;
alter table public.fee_events enable row level security;
alter table public.market_stats enable row level security;

create policy "public read markets" on public.markets for select using (true);
create policy "public read orders" on public.orders for select using (true);
create policy "public read trades" on public.trades for select using (true);
create policy "public read wallet activity" on public.wallet_activity for select using (true);
create policy "public read positions" on public.wallet_positions for select using (true);
create policy "public read claims" on public.redemptions_claims for select using (true);
create policy "public read market stats" on public.market_stats for select using (true);

grant select on public.markets, public.orders, public.trades, public.wallet_activity,
  public.wallet_positions, public.redemptions_claims, public.market_stats,
  public.market_overview, public.market_price_history, public.wallet_position_overview
to anon, authenticated;

revoke all on public.indexer_state, public.chain_blocks, public.indexed_logs,
  public.order_events, public.position_events, public.fee_events from anon, authenticated;
revoke execute on function public.rebuild_one_shot_derived(bigint) from public, anon, authenticated;
revoke execute on function public.rollback_one_shot_from_block(bigint, bigint) from public, anon, authenticated;

insert into public.indexer_state (chain_id, start_block, last_indexed_block, confirmations)
values (4663, 51943083, 51943082, 32)
on conflict (chain_id) do nothing;

commit;
