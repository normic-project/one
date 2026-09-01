import { Contract, formatUnits, getAddress, isAddress } from 'ethers';
import type { ContractRunner } from 'ethers';
import factoryAbi from '../generated/MarketFactory.json';
import marketAbi from '../generated/PredictionMarket.json';
import eventMarketAbi from '../generated/EventMarket.json';
import bookAbi from '../generated/OrderBook.json';
import feeAbi from '../generated/FeeVault.json';
import { USDG, FACTORY, FEE_VAULT, ORDER_BOOK, TREASURY, RESOLVER_SAFE } from './config';
import { apiMarket, apiMarkets, apiOrders, apiTrades } from './api';

export const money = (value: bigint | number, digits = 2) => new Intl.NumberFormat('en-US', {
  minimumFractionDigits: digits, maximumFractionDigits: digits }).format(typeof value === 'bigint' ? Number(formatUnits(value, 6)) : value);
export const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
export const errorMessage = (error: unknown) => {
  const e = error as { code?: string; shortMessage?: string; message?: string; name?: string };
  if (e.code === 'ACTION_REJECTED' || String(e.code) === '4001') return 'Transaction declined in your wallet. Nothing was changed.';
  if (e.name === 'AbortError') return 'The data request timed out. Please retry.';
  return e.shortMessage || e.message || 'Something went wrong. Please try again.';
};

export const marketContract = (address: string, runner: ContractRunner | null = null) => new Contract(address, marketAbi, runner);
export const eventMarketContract = (address: string, runner: ContractRunner | null = null) => new Contract(address, eventMarketAbi, runner);

export type Protocol = { factory: Contract; book: Contract; fees: Contract; treasury: string; resolverMultisig: string };
export type Market = { address: string; creator: string; question: string; yesOutcome: string; noOutcome: string;
  category: string; rules: string; primarySource: string; secondarySource: string; metadataURI: string;
  closesAt: number; resolvesAt: number; state: number; outcome: number; resolved: boolean;
  yesWins: boolean; volume: bigint; yesPrice: number; locked: bigint; metadataHash: string; resolverMultisig: string;
  chainTimestamp?: number };
export type Order = { id: bigint; market: string; owner: string; expiresAt: number; price: number; yes: boolean; buy: boolean; remaining: bigint };
export type Trade = { firstId: bigint; secondId: bigint; market: string; shares: bigint; yesPrice: number;
  notional: bigint; mint: boolean; timestamp: number; hash: string; blockNumber: number; index: number };

export const outcomeLabel = (outcome: number) => ['Pending', 'YES', 'NO', 'INVALID'][outcome] || 'Unknown';
export const stateLabel = (state: number) => ['Open', 'Closed', 'Resolved YES', 'Resolved NO', 'Resolved INVALID'][state] || 'Unknown';

export async function loadProtocol(): Promise<Protocol> {
  if (!isAddress(FACTORY) || getAddress(USDG) !== USDG) throw new Error('Invalid production deployment configuration.');
  return { factory: new Contract(FACTORY, factoryAbi), book: new Contract(ORDER_BOOK, bookAbi),
    fees: new Contract(FEE_VAULT, feeAbi), treasury: TREASURY, resolverMultisig: RESOLVER_SAFE };
}
export const loadMarket = apiMarket;
export async function loadMarkets(_protocol: Protocol, offset = 0, limit = 24) { return apiMarkets(offset, limit); }
export async function loadOrders(_protocol: Protocol, address: string, user = false) { return apiOrders(address, user); }
export async function loadTrades(_protocol: Protocol, market?: string) { return market ? apiTrades(market) : []; }

export function compatible(order: Order, yes: boolean, buy: boolean, price: number, account: string) {
  if (!order.remaining || order.expiresAt <= Date.now() / 1000 || order.owner.toLowerCase() === account.toLowerCase()) return false;
  return buy && order.buy ? order.yes !== yes && order.price + price === 100 :
    order.buy !== buy && order.yes === yes && order.price === price;
}
