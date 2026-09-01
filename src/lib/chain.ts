import { Contract, JsonRpcProvider, formatUnits, getAddress, isAddress } from 'ethers';
import type { ContractRunner, EventLog } from 'ethers';
import factoryAbi from '../generated/MarketFactory.json';
import marketAbi from '../generated/PredictionMarket.json';
import eventMarketAbi from '../generated/EventMarket.json';
import bookAbi from '../generated/OrderBook.json';
import feeAbi from '../generated/FeeVault.json';
import { CHAIN_ID, USDG, RPC, FACTORY, DEPLOYMENT_BLOCK, TOKEN_ABI } from './config';

export const provider = new JsonRpcProvider(RPC);
export const money = (value: bigint | number, digits = 2) => new Intl.NumberFormat('en-US', {
  minimumFractionDigits: digits, maximumFractionDigits: digits }).format(typeof value === 'bigint' ? Number(formatUnits(value, 6)) : value);
export const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
export const errorMessage = (error: unknown) => {
  const e = error as { code?: string; shortMessage?: string; message?: string };
  if (e.code === 'ACTION_REJECTED' || String(e.code) === '4001') return 'Transaction declined in your wallet. Nothing was changed.';
  return e.shortMessage || e.message || 'Something went wrong. Please try again.';
};

export const marketContract = (address: string, runner: ContractRunner = provider) => new Contract(address, marketAbi, runner);
export const eventMarketContract = (address: string, runner: ContractRunner = provider) => new Contract(address, eventMarketAbi, runner);

export type Protocol = { factory: Contract; book: Contract; fees: Contract; treasury: string; resolverMultisig: string };
export type Market = { address: string; creator: string; question: string; yesOutcome: string; noOutcome: string;
  category: string; rules: string; primarySource: string; secondarySource: string; metadataURI: string;
  closesAt: number; resolvesAt: number; state: number; outcome: number; resolved: boolean;
  yesWins: boolean; volume: bigint; yesPrice: number; locked: bigint; metadataHash: string; resolverMultisig: string };
export type Order = { id: bigint; market: string; owner: string; expiresAt: number; price: number; yes: boolean; buy: boolean; remaining: bigint; };
export type Trade = { firstId: bigint; secondId: bigint; market: string; shares: bigint; yesPrice: number;
  notional: bigint; mint: boolean; timestamp: number; hash: string; blockNumber: number; index: number; };

export const outcomeLabel = (outcome: number) => ['Pending', 'YES', 'NO', 'INVALID'][outcome] || 'Unknown';
export const stateLabel = (state: number) => ['Open', 'Closed', 'Resolved YES', 'Resolved NO', 'Resolved INVALID'][state] || 'Unknown';

export async function loadProtocol(): Promise<Protocol> {
  if (!FACTORY) throw new Error('Deployment not configured. No live markets are available yet.');
  if (!isAddress(FACTORY) || !Number.isSafeInteger(DEPLOYMENT_BLOCK) || DEPLOYMENT_BLOCK <= 0)
    throw new Error('Invalid deployment configuration. Set the mainnet factory address and deployment block.');
  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(CHAIN_ID)) throw new Error('RPC network mismatch. Only Robinhood Chain mainnet is supported.');
  if (await provider.getCode(FACTORY) === '0x') throw new Error('No factory contract exists at the configured address.');
  const factory = new Contract(FACTORY, factoryAbi, provider);
  const [token, bookAddress, feeAddress, treasury, resolverMultisig] = await Promise.all([
    factory.token(), factory.orderBook(), factory.feeVault(), factory.treasury(), factory.resolverMultisig()
  ]);
  if (getAddress(token) !== getAddress(USDG)) throw new Error('Factory does not use canonical mainnet USDG.');
  const usd = new Contract(USDG, TOKEN_ABI, provider);
  if (await usd.decimals() !== 6n) throw new Error('Unexpected USDG precision.');
  return { factory, book: new Contract(bookAddress, bookAbi, provider), fees: new Contract(feeAddress, feeAbi, provider),
    treasury, resolverMultisig };
}

export async function loadMarket(address: string): Promise<Market> {
  const contract = marketContract(address);
  const event = eventMarketContract(address);
  const [metadata, creator, stateRaw, outcomeRaw, volume, price, vault, metadataHash, closesAt, resolvesAt, resolverMultisig] = await Promise.all([
    contract.metadata(), contract.creator(), contract.marketState(), contract.resolvedOutcome(), contract.volume(),
    contract.lastYesPrice(), contract.collateralVault(), contract.metadataHash(), contract.closesAt(), contract.resolvesAt(),
    event.resolverMultisig()
  ]);
  const state = Number(stateRaw);
  const outcome = Number(outcomeRaw);
  const collateral = new Contract(vault, ['function locked() view returns(uint256)'], provider);
  return { address, creator, question: metadata.question, yesOutcome: metadata.yesOutcome,
    noOutcome: metadata.noOutcome, category: metadata.category, rules: metadata.rules,
    primarySource: metadata.primarySource, secondarySource: metadata.secondarySource, metadataURI: metadata.metadataURI,
    closesAt: Number(closesAt), resolvesAt: Number(resolvesAt), state, outcome, resolved: outcome !== 0,
    yesWins: outcome === 1, volume, yesPrice: Number(price), locked: await collateral.locked(), metadataHash, resolverMultisig };
}
export async function loadMarkets(protocol: Protocol, offset = 0, limit = 24): Promise<{ markets: Market[]; total: number }> {
  const total = Number(await protocol.factory.marketCount());
  const indices = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => total - 1 - offset - i);
  const markets: Market[] = [];
  for (let i = 0; i < indices.length; i += 6)
    markets.push(...await Promise.all(indices.slice(i, i + 6).map(async index => loadMarket(await protocol.factory.markets(index)))));
  return { markets, total };
}

export async function loadOrders(protocol: Protocol, address: string, user = false): Promise<Order[]> {
  const count = Number(await protocol.book[user ? 'userOrderCount' : 'marketOrderCount'](address));
  const results: Order[] = [];
  for (let offset = 0; offset < count; offset += 100) {
    const ids: bigint[] = await protocol.book[user ? 'userOrderIds' : 'marketOrderIds'](address, offset, 100);
    for (let i = 0; i < ids.length; i += 12)
      results.push(...await Promise.all(ids.slice(i, i + 12).map(id => loadOrder(protocol, id))));
  }
  return results;
}
export async function loadOrder(protocol: Protocol, id: bigint): Promise<Order> {
  const o = await protocol.book.orders(id);
  return { id, market: o.market, owner: o.owner, expiresAt: Number(o.expiresAt), price: Number(o.price),
    yes: o.yes, buy: o.buy, remaining: o.remaining };
}

export async function loadTrades(protocol: Protocol, market?: string): Promise<Trade[]> {
  const latest = await provider.getBlockNumber();
  const events: EventLog[] = [];
  for (let from = DEPLOYMENT_BLOCK; from <= latest; from += 10000) {
    const logs = await protocol.book.queryFilter(protocol.book.filters.OrdersMatched(null, null, market || null), from, Math.min(from + 9999, latest));
    events.push(...logs as EventLog[]);
  }
  return events.map(log => ({ firstId: log.args.firstId, secondId: log.args.secondId, market: log.args.market,
    shares: log.args.shares, yesPrice: Number(log.args.yesPrice), notional: log.args.notional, mint: log.args.mint,
    timestamp: Number(log.args.timestamp), hash: log.transactionHash, blockNumber: log.blockNumber, index: log.index }))
    .sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
}

export function compatible(order: Order, yes: boolean, buy: boolean, price: number, account: string) {
  if (!order.remaining || order.expiresAt <= Date.now() / 1000 || order.owner.toLowerCase() === account.toLowerCase()) return false;
  return buy && order.buy ? order.yes !== yes && order.price + price === 100 :
    order.buy !== buy && order.yes === yes && order.price === price;
}
