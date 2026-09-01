import { Contract, Interface, getAddress } from 'ethers';
import {
  CHAIN_ID, DEPLOYMENT_BLOCK, FACTORY, FEE_VAULT, ORDER_BOOK, TREASURY,
  FACTORY_ABI, ORDER_BOOK_ABI, FEE_VAULT_ABI, MARKET_ABI
} from './constants.mjs';

const interfaces = {
  factory: new Interface(FACTORY_ABI), book: new Interface(ORDER_BOOK_ABI),
  fees: new Interface(FEE_VAULT_ABI), market: new Interface(MARKET_ABI)
};
const eventTopics = [...new Set(Object.values(interfaces).flatMap(value => value.fragments
  .filter(fragment => fragment.type === 'event').map(fragment => value.getEvent(fragment.name).topicHash)))];

export const normalizeAddress = value => getAddress(value).toLowerCase();
const lowerHash = value => String(value).toLowerCase();
const iso = timestamp => new Date(Number(timestamp) * 1000).toISOString();
const jsonValue = value => typeof value === 'bigint' ? value.toString() : Array.isArray(value)
  ? value.map(jsonValue) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).filter(([key]) => Number.isNaN(Number(key))).map(([key,item]) => [key,jsonValue(item)]))
    : value;
const rowBase = (log, block) => ({ chain_id: CHAIN_ID, tx_hash: lowerHash(log.transactionHash),
  log_index: log.index, block_number: log.blockNumber, block_hash: lowerHash(log.blockHash),
  block_timestamp: iso(block.timestamp) });

async function retry(action, label, attempts = 5) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await action(); } catch (error) {
      last = error;
      if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw new Error(`${label}: ${last?.shortMessage || last?.message || last}`);
}

async function logsFor(provider, fromBlock, toBlock) {
  try {
    return await retry(() => provider.getLogs({ fromBlock, toBlock, topics: [eventTopics] }), `logs ${fromBlock}-${toBlock}`, 3);
  } catch (error) {
    if (fromBlock === toBlock) throw error;
    const middle = Math.floor((fromBlock + toBlock) / 2);
    return [...await logsFor(provider, fromBlock, middle), ...await logsFor(provider, middle + 1, toBlock)];
  }
}

async function blocksFor(provider, numbers) {
  const result = new Map();
  const unique = [...new Set(numbers)].sort((a,b) => a-b);
  for (let offset = 0; offset < unique.length; offset += 10) {
    const group = unique.slice(offset, offset + 10);
    const blocks = await Promise.all(group.map(number => retry(() => provider.getBlock(number), `block ${number}`)));
    blocks.forEach((block,index) => {
      if (!block) throw new Error(`Missing block ${group[index]}`);
      result.set(group[index], block);
    });
  }
  return result;
}

async function marketSnapshot(provider, address, event, block) {
  const market = new Contract(address, MARKET_ABI, provider);
  const at = { blockTag: event.log.blockNumber };
  const [metadata, creator, closesAt, resolvesAt, collateralVault, metadataHash] = await Promise.all([
    market.metadata(at), market.creator(at), market.closesAt(at), market.resolvesAt(at),
    market.collateralVault(at), market.metadataHash(at)
  ]);
  return { chain_id: CHAIN_ID, address: normalizeAddress(address), factory_index: event.args.index.toString(),
    creator: normalizeAddress(creator), collateral_vault: normalizeAddress(collateralVault), question: metadata.question,
    yes_definition: metadata.yesOutcome, no_definition: metadata.noOutcome, category: metadata.category,
    resolution_rules: metadata.rules, primary_source: metadata.primarySource, secondary_source: metadata.secondarySource,
    metadata_uri: metadata.metadataURI, metadata_hash: lowerHash(metadataHash), closes_at: iso(closesAt), resolves_at: iso(resolvesAt),
    created_block: event.log.blockNumber, created_block_hash: lowerHash(event.log.blockHash),
    created_tx_hash: lowerHash(event.log.transactionHash), created_log_index: event.log.index,
    created_at: iso(block.timestamp), updated_at: new Date().toISOString() };
}

function activity(base, wallet, activityType, extras = {}) {
  return { ...base, wallet: normalizeAddress(wallet), activity_type: activityType, ...extras };
}
function position(base, wallet, market, yes, eventType, sharesDelta, cashflow) {
  return { ...base, wallet: normalizeAddress(wallet), market_address: normalizeAddress(market), yes,
    event_type: eventType, shares_delta: sharesDelta.toString(), cashflow_usdg: cashflow.toString() };
}

export async function runIndexer({ provider, store, confirmations = 32, batchSize = 1000, reorgDepth = 64,
  loadMarketSnapshot = marketSnapshot } = {}) {
  if (!provider || !store) throw new Error('Indexer provider and store are required.');
  let state = await store.state(CHAIN_ID);
  if (!state) {
    await store.upsert('indexer_state', [{ chain_id: CHAIN_ID, start_block: DEPLOYMENT_BLOCK,
      last_indexed_block: DEPLOYMENT_BLOCK - 1, last_indexed_block_hash: null, confirmations }], 'chain_id');
    state = await store.state(CHAIN_ID);
  }
  const latest = await retry(() => provider.getBlockNumber(), 'latest block');
  const safeHead = latest - confirmations;
  let last = Number(state.last_indexed_block);
  if (last >= DEPLOYMENT_BLOCK && state.last_indexed_block_hash) {
    const canonical = await retry(() => provider.getBlock(last), `reorg check ${last}`);
    if (!canonical || lowerHash(canonical.hash) !== lowerHash(state.last_indexed_block_hash)) {
      const rewind = Math.max(DEPLOYMENT_BLOCK, last - reorgDepth + 1);
      await store.rpc('rollback_one_shot_from_block', { p_chain_id: CHAIN_ID, p_from_block: rewind });
      last = rewind - 1;
    }
  }
  if (last > safeHead) {
    const rewind = Math.max(DEPLOYMENT_BLOCK, safeHead + 1);
    await store.rpc('rollback_one_shot_from_block', { p_chain_id: CHAIN_ID, p_from_block: rewind });
    last = rewind - 1;
  }
  const fromBlock = last + 1;
  if (fromBlock > safeHead) return { status: 'caught_up', latest, safeHead, lastIndexedBlock: last, processedLogs: 0 };
  const toBlock = Math.min(safeHead, fromBlock + batchSize - 1);
  const logs = (await logsFor(provider, fromBlock, toBlock)).sort((a,b) => a.blockNumber-b.blockNumber || a.index-b.index);
  const blockMap = await blocksFor(provider, [...logs.map(log => log.blockNumber), toBlock]);
  const knownMarkets = new Set((await store.markets(CHAIN_ID)).map(normalizeAddress));
  const parsedFactory = [];
  for (const log of logs.filter(log => normalizeAddress(log.address) === normalizeAddress(FACTORY))) {
    const parsed = interfaces.factory.parseLog(log);
    if (parsed?.name === 'MarketCreated') {
      knownMarkets.add(normalizeAddress(parsed.args.market));
      parsedFactory.push({ log, args: parsed.args });
    }
  }
  const marketRows = [];
  for (const event of parsedFactory) marketRows.push(await loadMarketSnapshot(provider, event.args.market,
    { ...event, log: event.log }, blockMap.get(event.log.blockNumber)));

  const referencedIds = [];
  for (const log of logs.filter(log => normalizeAddress(log.address) === normalizeAddress(ORDER_BOOK))) {
    const parsed = interfaces.book.parseLog(log);
    if (parsed?.name === 'OrderCancelled') referencedIds.push(parsed.args.id.toString());
    if (parsed?.name === 'OrdersMatched') referencedIds.push(parsed.args.firstId.toString(), parsed.args.secondId.toString());
  }
  const orderMap = new Map((await store.orders(CHAIN_ID, [...new Set(referencedIds)])).map(order => [String(order.order_id), {
    id: String(order.order_id), market: order.market_address, owner: order.owner, yes: order.yes, buy: order.buy,
    price: Number(order.price), shares: BigInt(order.shares), remaining: BigInt(order.remaining), expiresAt: Date.parse(order.expires_at) / 1000
  }]));

  const rows = { indexed_logs: [], order_events: [], trades: [], wallet_activity: [], position_events: [],
    redemptions_claims: [], fee_events: [], chain_blocks: [] };
  for (const block of blockMap.values()) rows.chain_blocks.push({ chain_id: CHAIN_ID, block_number: block.number,
    block_hash: lowerHash(block.hash), block_timestamp: iso(block.timestamp) });

  for (const log of logs) {
    const address = normalizeAddress(log.address);
    const block = blockMap.get(log.blockNumber);
    const base = rowBase(log, block);
    let parsed;
    let source;
    if (address === normalizeAddress(FACTORY)) { parsed = interfaces.factory.parseLog(log); source = 'factory'; }
    else if (address === normalizeAddress(ORDER_BOOK)) { parsed = interfaces.book.parseLog(log); source = 'book'; }
    else if (address === normalizeAddress(FEE_VAULT)) { parsed = interfaces.fees.parseLog(log); source = 'fees'; }
    else if (knownMarkets.has(address)) { parsed = interfaces.market.parseLog(log); source = 'market'; }
    if (!parsed) continue;
    const marketAddress = source === 'market' ? address : parsed.args.market ? normalizeAddress(parsed.args.market) : null;
    rows.indexed_logs.push({ ...base, contract_address: address, event_name: parsed.name,
      market_address: marketAddress, payload: jsonValue(parsed.args.toObject ? parsed.args.toObject() : parsed.args) });

    if (parsed.name === 'MarketCreated') {
      rows.wallet_activity.push(activity(base, parsed.args.creator, 'market_created', { market_address: normalizeAddress(parsed.args.market),
        payload: { factoryIndex: parsed.args.index.toString(), metadataHash: lowerHash(parsed.args.metadataHash) } }));
    } else if (parsed.name === 'OrderPlaced') {
      const id = parsed.args.id.toString();
      const order = { id, market: normalizeAddress(parsed.args.market), owner: normalizeAddress(parsed.args.owner),
        yes: parsed.args.yes, buy: parsed.args.buy, price: Number(parsed.args.price), shares: BigInt(parsed.args.shares),
        remaining: BigInt(parsed.args.shares), expiresAt: Number(parsed.args.expiresAt) };
      orderMap.set(id, order);
      const payload = { yes: order.yes, buy: order.buy, price: order.price, shares: order.shares.toString(), expiresAt: order.expiresAt };
      rows.order_events.push({ ...base, event_type: 'placed', market_address: order.market, order_id: id,
        secondary_order_id: null, wallet: order.owner, payload });
      const principal = order.shares * BigInt(order.price) * 10000n;
      rows.wallet_activity.push(activity(base, order.owner, 'order_placed', { market_address: order.market, order_id: id,
        yes: order.yes, amount: order.shares.toString(), quote_amount: order.buy ? (principal + principal / 100n).toString() : null, payload }));
    } else if (parsed.name === 'OrderCancelled') {
      const id = parsed.args.id.toString();
      const order = orderMap.get(id);
      if (!order) throw new Error(`OrderCancelled references unknown order ${id}`);
      rows.order_events.push({ ...base, event_type: 'cancelled', market_address: order.market, order_id: id,
        secondary_order_id: null, wallet: normalizeAddress(parsed.args.owner), payload: { refundedShares: parsed.args.refundedShares.toString() } });
      rows.wallet_activity.push(activity(base, parsed.args.owner, 'order_cancelled', { market_address: order.market,
        order_id: id, yes: order.yes, amount: parsed.args.refundedShares.toString() }));
      order.remaining = 0n;
    } else if (parsed.name === 'OrdersMatched') {
      const firstId = parsed.args.firstId.toString(), secondId = parsed.args.secondId.toString();
      const first = orderMap.get(firstId), second = orderMap.get(secondId);
      if (!first || !second) throw new Error(`OrdersMatched references unknown orders ${firstId}/${secondId}`);
      const shares = BigInt(parsed.args.shares), notional = BigInt(parsed.args.notional);
      const market = normalizeAddress(parsed.args.market);
      const payload = { shares: shares.toString(), yesPrice: Number(parsed.args.yesPrice),
        notional: notional.toString(), mint: parsed.args.mint, timestamp: parsed.args.timestamp.toString() };
      rows.order_events.push({ ...base, event_type: 'matched', market_address: market, order_id: firstId,
        secondary_order_id: secondId, wallet: null, payload });
      rows.trades.push({ ...base, market_address: market, first_order_id: firstId, second_order_id: secondId,
        first_owner: first.owner, second_owner: second.owner, first_yes: first.yes, second_yes: second.yes,
        first_buy: first.buy, second_buy: second.buy, shares: shares.toString(), yes_price: Number(parsed.args.yesPrice),
        notional: notional.toString(), mint: parsed.args.mint, traded_at: iso(parsed.args.timestamp) });
      for (const order of [first, second]) rows.wallet_activity.push(activity(base, order.owner, 'trade', {
        market_address: market, order_id: order.id, yes: order.yes, amount: shares.toString(),
        quote_amount: (shares * BigInt(order.price) * 10000n).toString(), payload: { ...payload, buy: order.buy } }));
      if (parsed.args.mint) {
        for (const order of [first, second]) {
          const principal = shares * BigInt(order.price) * 10000n;
          rows.position_events.push(position(base, order.owner, market, order.yes, 'buy', shares, principal + principal / 100n));
        }
      } else {
        const buyer = first.buy ? first : second, seller = first.buy ? second : first;
        const principal = shares * BigInt(buyer.price) * 10000n;
        rows.position_events.push(position(base, buyer.owner, market, buyer.yes, 'buy', shares, principal + principal / 100n));
        rows.position_events.push(position(base, seller.owner, market, seller.yes, 'sell', -shares, -principal));
      }
      first.remaining -= shares; second.remaining -= shares;
    } else if (parsed.name === 'Resolved') {
      // Resolution is rebuilt from canonical indexed_logs so replays cannot leave stale state.
    } else if (parsed.name === 'Redeemed') {
      const account = normalizeAddress(parsed.args.account), shares = BigInt(parsed.args.shares), payout = BigInt(parsed.args.payout);
      rows.position_events.push(position(base, account, address, parsed.args.yes, 'redeem', -shares, -payout));
      rows.redemptions_claims.push({ ...base, event_type: 'redemption', wallet: account, market_address: address,
        yes: parsed.args.yes, shares: shares.toString(), amount: payout.toString() });
      rows.wallet_activity.push(activity(base, account, 'redemption', { market_address: address, yes: parsed.args.yes,
        amount: shares.toString(), quote_amount: payout.toString() }));
    } else if (parsed.name === 'FeesAccrued') {
      const creator = normalizeAddress(parsed.args.creator), market = normalizeAddress(parsed.args.market);
      rows.fee_events.push({ ...base, event_type: 'accrued', market_address: market, creator,
        protocol_fee: parsed.args.protocolFee.toString(), creator_fee: parsed.args.creatorFee.toString(), claimed_amount: '0' });
      rows.wallet_activity.push(activity(base, creator, 'creator_fee_accrued', { market_address: market,
        quote_amount: parsed.args.creatorFee.toString() }));
      rows.wallet_activity.push(activity(base, TREASURY, 'protocol_fee_paid', { market_address: market,
        quote_amount: parsed.args.protocolFee.toString() }));
    } else if (parsed.name === 'FeesClaimed') {
      const creator = normalizeAddress(parsed.args.creator), amount = parsed.args.amount.toString();
      rows.fee_events.push({ ...base, event_type: 'claimed', market_address: null, creator,
        protocol_fee: '0', creator_fee: '0', claimed_amount: amount });
      rows.redemptions_claims.push({ ...base, event_type: 'creator_fee_claim', wallet: creator,
        market_address: null, yes: null, shares: null, amount });
      rows.wallet_activity.push(activity(base, creator, 'creator_fee_claim', { quote_amount: amount }));
    }
  }

  await store.upsert('chain_blocks', rows.chain_blocks, 'chain_id,block_number');
  await store.upsert('markets', marketRows, 'chain_id,address');
  await store.upsert('indexed_logs', rows.indexed_logs, 'chain_id,tx_hash,log_index');
  await store.upsert('order_events', rows.order_events, 'chain_id,tx_hash,log_index');
  await store.upsert('trades', rows.trades, 'chain_id,tx_hash,log_index');
  await store.upsert('wallet_activity', rows.wallet_activity, 'chain_id,tx_hash,log_index,wallet,activity_type');
  await store.upsert('position_events', rows.position_events, 'chain_id,tx_hash,log_index,wallet,yes,event_type');
  await store.upsert('redemptions_claims', rows.redemptions_claims, 'chain_id,tx_hash,log_index');
  await store.upsert('fee_events', rows.fee_events, 'chain_id,tx_hash,log_index');
  await store.rpc('rebuild_one_shot_derived', { p_chain_id: CHAIN_ID });
  const finalBlock = blockMap.get(toBlock);
  await store.upsert('indexer_state', [{ chain_id: CHAIN_ID, start_block: DEPLOYMENT_BLOCK,
    last_indexed_block: toBlock, last_indexed_block_hash: lowerHash(finalBlock.hash), confirmations,
    updated_at: new Date().toISOString() }], 'chain_id');
  return { status: toBlock === safeHead ? 'caught_up' : 'progress', latest, safeHead, fromBlock, toBlock,
    lastIndexedBlock: toBlock, processedLogs: rows.indexed_logs.length, marketsDiscovered: marketRows.length,
    tradesIndexed: rows.trades.length };
}
