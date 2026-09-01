const { getAddress } = require('ethers');
const { getDatabase, getProvider, contract } = require('./services.cjs');
const { databaseError } = require('./http.cjs');
const config = require('./config.cjs');

const MARKET_LIVE_ABI = [
  'function marketState() view returns(uint8)', 'function resolvedOutcome() view returns(uint8)',
  'function volume() view returns(uint256)', 'function lastYesPrice() view returns(uint8)',
  'function collateralVault() view returns(address)', 'function sharesOf(address,bool) view returns(uint256)'
];
const VAULT_ABI = ['function locked() view returns(uint256)'];
const ORDER_ABI = ['function orders(uint256) view returns(address market,address owner,uint64 expiresAt,uint8 price,bool yes,bool buy,uint256 remaining)'];
const FEE_ABI = ['function claimable(address) view returns(uint256)', 'function earnedByMarket(address) view returns(uint256)'];

const seconds = value => Math.floor(Date.parse(value) / 1000);
function marketJson(row, live = {}) {
  const outcome = Number(live.outcome ?? row.outcome ?? 0);
  const state = Number(live.state ?? (outcome === 1 ? 2 : outcome === 2 ? 3 : outcome === 3 ? 4 : seconds(row.closes_at) <= Date.now()/1000 ? 1 : 0));
  return { address: getAddress(row.address), creator: getAddress(row.creator), question: row.question,
    yesOutcome: row.yes_definition, noOutcome: row.no_definition, category: row.category, rules: row.resolution_rules,
    primarySource: row.primary_source, secondarySource: row.secondary_source, metadataURI: row.metadata_uri,
    closesAt: seconds(row.closes_at), resolvesAt: seconds(row.resolves_at), state, outcome, resolved: outcome !== 0,
    yesWins: outcome === 1, volume: String(live.volume ?? row.volume_usdg ?? '0'),
    yesPrice: Number(live.yesPrice ?? row.last_yes_price ?? 0), locked: String(live.locked ?? '0'),
    metadataHash: row.metadata_hash, resolverMultisig: config.resolverSafe,
    createdAt: row.created_at, tradeCount: Number(row.trade_count || 0), uniqueTraders: Number(row.unique_traders || 0),
    trendingScore: String(row.trending_score || '0'), ...(live.chainTimestamp ? {chainTimestamp:Number(live.chainTimestamp)} : {}) };
}
function orderJson(row) {
  return { id: String(row.order_id), market: getAddress(row.market_address), owner: getAddress(row.owner),
    expiresAt: seconds(row.expires_at), price: Number(row.price), yes: row.yes, buy: row.buy,
    remaining: String(row.remaining), status: row.status, blockNumber: Number(row.placed_block), hash: row.placed_tx_hash };
}
function tradeJson(row) {
  return { firstId: String(row.first_order_id), secondId: String(row.second_order_id), market: getAddress(row.market_address),
    firstOwner: getAddress(row.first_owner), secondOwner: getAddress(row.second_owner), shares: String(row.shares),
    yesPrice: Number(row.yes_price), notional: String(row.notional), mint: row.mint,
    timestamp: seconds(row.traded_at), hash: row.tx_hash, blockNumber: Number(row.block_number), index: row.log_index };
}

async function listMarkets({ offset, end, category, status, sort = 'trending', search }) {
  const db = getDatabase();
  let query = db.from('market_overview').select('*', { count: 'exact' }).eq('chain_id', config.chainId);
  if (category) query = query.eq('category', category);
  if (status && status !== 'all') query = status === 'resolved' ? query.gt('outcome', 0)
    : status === 'open' ? query.eq('status', 'open') : query.eq('status', status);
  if (search) {
    const term = search.replace(/[%(),]/g, ' ').trim().slice(0, 120);
    if (term) query = query.or(`question.ilike.%${term}%,category.ilike.%${term}%,yes_definition.ilike.%${term}%,no_definition.ilike.%${term}%`);
  }
  const order = sort === 'newest' ? ['created_at', false] : sort === 'closing' ? ['closes_at', true] : ['trending_score', false];
  query = query.order(order[0], { ascending: order[1] }).order('factory_index', { ascending: false }).range(offset, end);
  const { data, error, count } = await query;
  databaseError(error, 'list markets');
  return { markets: (data || []).map(row => marketJson(row)), total: count || 0, offset, limit: end-offset+1 };
}

async function categories() {
  const { data, error } = await getDatabase().from('markets').select('category').eq('chain_id', config.chainId)
    .order('category', { ascending: true }).limit(1000);
  databaseError(error, 'load categories');
  return { categories: [...new Set((data || []).map(row => row.category).filter(Boolean))] };
}

async function marketRow(address) {
  const { data, error } = await getDatabase().from('market_overview').select('*').eq('chain_id', config.chainId)
    .eq('address', address).maybeSingle();
  databaseError(error, 'load market');
  if (!data) throw Object.assign(new Error('Market not found.'), { statusCode: 404 });
  return data;
}

async function getMarket(address) {
  const row = await marketRow(address);
  const market = contract(address, MARKET_LIVE_ABI);
  const [state, outcome, volume, yesPrice, vault, block] = await Promise.all([
    market.marketState(), market.resolvedOutcome(), market.volume(), market.lastYesPrice(), market.collateralVault(), getProvider().getBlock('latest')
  ]);
  const locked = await contract(vault, VAULT_ABI).locked();
  return marketJson(row, { state, outcome, volume, yesPrice, locked, chainTimestamp:block.timestamp });
}

async function trades(address, offset, end) {
  const { data, error, count } = await getDatabase().from('trades').select('*', { count: 'exact' })
    .eq('chain_id', config.chainId).eq('market_address', address).order('block_number', { ascending: false })
    .order('log_index', { ascending: false }).range(offset, end);
  databaseError(error, 'load trades');
  return { trades: (data || []).map(tradeJson), total: count || 0, offset, limit: end-offset+1 };
}

async function prices(address, offset, end) {
  const { data, error, count } = await getDatabase().from('market_price_history').select('*', { count: 'exact' })
    .eq('chain_id', config.chainId).eq('market_address', address).order('block_number', { ascending: true })
    .order('log_index', { ascending: true }).range(offset, end);
  databaseError(error, 'load prices');
  return { prices: (data || []).map(row => ({ timestamp: seconds(row.traded_at), yesPrice: Number(row.yes_price),
    noPrice: Number(row.no_price), shares: String(row.shares), notional: String(row.notional), hash: row.tx_hash,
    blockNumber: Number(row.block_number), index: row.log_index })), total: count || 0 };
}

async function orders(filters, offset, end, live = true) {
  let query = getDatabase().from('orders').select('*', { count: 'exact' }).eq('chain_id', config.chainId);
  if (filters.market) query = query.eq('market_address', filters.market);
  if (filters.owner) query = query.eq('owner', filters.owner);
  if (filters.open) query = query.gt('remaining', 0);
  const { data, error, count } = await query.order('placed_block', { ascending: false }).range(offset, end);
  databaseError(error, 'load orders');
  const result = (data || []).map(orderJson);
  if (live && result.length) {
    const book = contract(config.orderBook, ORDER_ABI);
    for (let start = 0; start < result.length; start += 12) {
      const current = await Promise.all(result.slice(start, start+12).map(order => book.orders(order.id)));
      current.forEach((value,index) => {
        const order = result[start+index];
        order.remaining = value.remaining.toString();
        order.status = value.remaining === 0n ? order.status === 'cancelled' ? 'cancelled' : 'filled' : 'open';
      });
    }
  }
  return { orders: result, total: count || 0, offset, limit: end-offset+1, canonicalRemaining: live };
}

async function walletActivity(wallet, offset, end) {
  const { data, error, count } = await getDatabase().from('wallet_activity').select('*', { count: 'exact' })
    .eq('chain_id', config.chainId).eq('wallet', wallet).order('block_number', { ascending: false })
    .order('log_index', { ascending: false }).range(offset, end);
  databaseError(error, 'load wallet activity');
  return { activity: data || [], total: count || 0, offset, limit: end-offset+1 };
}

async function walletPositions(wallet, offset, end) {
  const { data, error, count } = await getDatabase().from('wallet_position_overview').select('*', { count: 'exact' })
    .eq('chain_id', config.chainId).eq('wallet', wallet).order('last_activity_at', { ascending: false }).range(offset, end);
  databaseError(error, 'load wallet positions');
  const result = [];
  for (const row of data || []) {
    const market = contract(row.market_address, MARKET_LIVE_ABI);
    const available = await market.sharesOf(wallet, row.yes);
    const positionMarket = await marketRow(row.market_address);
    result.push({ market: marketJson(positionMarket), yes: row.yes, indexedShares: String(row.indexed_shares),
      available: available.toString(), netInvestment: String(row.net_investment_usdg), lastActivityAt: row.last_activity_at });
  }
  return { positions: result, total: count || 0, offset, limit: end-offset+1, canonicalAvailableShares: true };
}

async function walletSummary(wallet) {
  const db = getDatabase();
  const [marketsResult, tradesResult, claimsResult, claimable] = await Promise.all([
    db.from('market_overview').select('*').eq('chain_id', config.chainId).eq('creator', wallet).order('created_at', {ascending:false}),
    db.from('trades').select('*').eq('chain_id', config.chainId).or(`first_owner.eq.${wallet},second_owner.eq.${wallet}`).order('block_number',{ascending:false}).limit(100),
    db.from('redemptions_claims').select('*').eq('chain_id', config.chainId).eq('wallet', wallet).order('block_number',{ascending:false}).limit(100),
    contract(config.feeVault, FEE_ABI).claimable(wallet)
  ]);
  databaseError(marketsResult.error, 'load wallet markets'); databaseError(tradesResult.error, 'load wallet trades');
  databaseError(claimsResult.error, 'load wallet claims');
  const marketsCreated = (marketsResult.data || []).map(row => marketJson(row));
  const fees = contract(config.feeVault, FEE_ABI);
  const earnedByMarket = {};
  for (let offset = 0; offset < marketsCreated.length; offset += 12) {
    const group = marketsCreated.slice(offset, offset+12);
    const values = await Promise.all(group.map(market => fees.earnedByMarket(market.address)));
    values.forEach((value,index) => { earnedByMarket[group[index].address] = value.toString(); });
  }
  return { wallet: getAddress(wallet), claimableCreatorFees: claimable.toString(), marketsCreated,
    earnedByMarket,
    trades: (tradesResult.data || []).map(tradeJson), claims: claimsResult.data || [] };
}

module.exports = { listMarkets, categories, getMarket, trades, prices, orders, walletActivity, walletPositions, walletSummary };
