import type { Market, Order, Trade } from './chain';

type JsonMarket = Omit<Market, 'volume' | 'locked'> & { volume: string; locked: string };
type JsonOrder = Omit<Order, 'id' | 'remaining'> & { id: string; remaining: string };
type JsonTrade = Omit<Trade, 'firstId' | 'secondId' | 'shares' | 'notional'> & {
  firstId: string; secondId: string; shares: string; notional: string
};
export type PricePoint = { timestamp: number; yesPrice: number; noPrice: number; shares: bigint;
  notional: bigint; hash: string; blockNumber: number; index: number };
export type WalletActivity = { activity_type: string; market_address?: string; yes?: boolean;
  amount?: string; quote_amount?: string; block_timestamp: string; tx_hash: string; log_index: number };
export type WalletPosition = { market: Market; yes: boolean; indexedShares: bigint; available: bigint;
  netInvestment: bigint; lastActivityAt: string };
export type WalletSummary = { wallet: string; claimableCreatorFees: bigint; marketsCreated: Market[];
  earnedByMarket: Record<string,bigint>; trades: Trade[]; claims: Array<Record<string, unknown>> };

const market = (item: JsonMarket): Market => ({ ...item, volume: BigInt(item.volume), locked: BigInt(item.locked) });
const order = (item: JsonOrder): Order => ({ ...item, id: BigInt(item.id), remaining: BigInt(item.remaining) });
const trade = (item: JsonTrade): Trade => ({ ...item, firstId: BigInt(item.firstId), secondId: BigInt(item.secondId),
  shares: BigInt(item.shares), notional: BigInt(item.notional) });

async function request<T>(path: string): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(path, { headers: { accept: 'application/json' }, signal: controller.signal });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
      return body as T;
    } catch (error) { last = error; if (attempt === 0) await new Promise(resolve => window.setTimeout(resolve, 350)); }
    finally { window.clearTimeout(timeout); }
  }
  throw last;
}

export async function apiMarkets(offset = 0, limit = 24, options: Record<string,string> = {}) {
  const normalized: Record<string,string> = { ...options, ...(options.search ? { q: options.search } : {}) };
  delete normalized.search;
  const params = new URLSearchParams({ offset: String(offset), limit: String(limit), ...normalized });
  const data = await request<{ markets: JsonMarket[]; total: number }>(`/api/markets?${params}`);
  return { ...data, markets: data.markets.map(market) };
}
export async function apiCategories() { return (await request<{categories:string[]}>('/api/categories')).categories; }
export async function apiMarket(address: string) { return market(await request<JsonMarket>(`/api/markets/${address}`)); }
export async function apiOrders(address: string, wallet = false) {
  const path = wallet ? `/api/wallet/${address}/orders?limit=100` : `/api/markets/${address}/orders?limit=100`;
  const data = await request<{ orders: JsonOrder[] }>(path); return data.orders.map(order);
}
export async function apiTrades(address: string) {
  const data = await request<{ trades: JsonTrade[] }>(`/api/markets/${address}/trades?limit=200`);
  return data.trades.map(trade).sort((a,b) => a.blockNumber-b.blockNumber || a.index-b.index);
}
export async function apiPrices(address: string) {
  const data = await request<{ prices: Array<Omit<PricePoint,'shares'|'notional'> & {shares:string;notional:string}> }>(`/api/markets/${address}/prices?limit=500`);
  return data.prices.map(item => ({ ...item, shares: BigInt(item.shares), notional: BigInt(item.notional) }));
}
export async function apiWalletActivity(address: string) {
  const data = await request<{ activity: WalletActivity[] }>(`/api/wallet/${address}/activity?limit=100`); return data.activity;
}
export async function apiWalletPositions(address: string) {
  const data = await request<{ positions: Array<Omit<WalletPosition,'market'|'indexedShares'|'available'|'netInvestment'> &
    {market:JsonMarket;indexedShares:string;available:string;netInvestment:string}> }>(`/api/wallet/${address}/positions?limit=100`);
  return data.positions.map(item => ({ ...item, market: market(item.market), indexedShares: BigInt(item.indexedShares),
    available: BigInt(item.available), netInvestment: BigInt(item.netInvestment) }));
}
export async function apiWalletSummary(address: string) {
  const data = await request<Omit<WalletSummary,'claimableCreatorFees'|'marketsCreated'|'trades'|'earnedByMarket'> &
    {claimableCreatorFees:string;marketsCreated:JsonMarket[];trades:JsonTrade[];earnedByMarket:Record<string,string>}>(`/api/wallet/${address}`);
  return { ...data, claimableCreatorFees: BigInt(data.claimableCreatorFees), marketsCreated: data.marketsCreated.map(market),
    trades: data.trades.map(trade), earnedByMarket: Object.fromEntries(Object.entries(data.earnedByMarket)
      .map(([key,value]) => [key,BigInt(value)])) };
}
