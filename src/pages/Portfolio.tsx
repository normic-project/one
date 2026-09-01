import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Layers3, RefreshCw } from 'lucide-react';
import { useProtocol } from '../lib/Protocol';
import { useWallet } from '../lib/Wallet';
import { errorMessage, loadMarket, loadOrders, loadTrades, marketContract, money } from '../lib/chain';
import type { Market, Order } from '../lib/chain';
import { EmptyState, StatusBanner, useTransaction } from '../components/Common';

type Position = { market: Market; yes: boolean; shares: bigint; available: bigint; cost: bigint; value: bigint; average: number };
export default function PortfolioPage() {
  const { protocol } = useProtocol();
  const wallet = useWallet();
  const [positions, setPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('Open positions');
  const refresh = useCallback(async () => {
    setPositions([]); setOrders([]); setError('');
    if (!wallet.account || !protocol) return;
    setLoading(true);
    try {
      const myOrders = await loadOrders(protocol, wallet.account, true);
      const histories = new Map<string, { quantity: bigint; cost: bigint }>();
      const byId = new Map(myOrders.map(order => [String(order.id), order]));
      const markets = [...new Set(myOrders.map(o => o.market))];
      for (const address of markets) {
        const trades = await loadTrades(protocol, address);
        for (const trade of trades) {
          const order = byId.get(String(trade.firstId)) || byId.get(String(trade.secondId));
          if (!order) continue;
          const key = `${address}:${order.yes}`;
          const state = histories.get(key) || { quantity: 0n, cost: 0n };
          if (order.buy) { state.quantity += trade.shares; state.cost += trade.shares * BigInt(order.price) * 10100n; }
          else if (state.quantity > 0n) { state.cost -= state.cost * trade.shares / state.quantity; state.quantity -= trade.shares; }
          histories.set(key, state);
        }
      }
      const found: Position[] = [];
      for (const address of markets) {
        const market = await loadMarket(address);
        for (const yes of [true, false]) {
          const available: bigint = await marketContract(address).sharesOf(wallet.account, yes);
          const escrow = myOrders.filter(o => o.market === address && !o.buy && o.yes === yes).reduce((sum, o) => sum + o.remaining, 0n);
          const shares = available + escrow;
          if (!shares) continue;
          const basis = histories.get(`${address}:${yes}`);
          const cost = basis && basis.quantity > 0n ? basis.cost * shares / basis.quantity : 0n;
          const price = market.resolved ? (market.outcome === 3 ? 50 : (yes && market.outcome === 1) || (!yes && market.outcome === 2) ? 100 : 0)
            : market.yesPrice ? (yes ? market.yesPrice : 100 - market.yesPrice) : 0;
          found.push({ market, yes, shares, available, cost, value: shares * BigInt(price) * 10000n,
            average: shares ? Number(cost / shares) / 1000000 : 0 });
        }
      }
      setOrders(myOrders); setPositions(found);
    } catch (e) { setError(errorMessage(e)); } finally { setLoading(false); }
  }, [wallet.account, protocol]);
  useEffect(() => { void refresh(); }, [refresh]);
  const tx = useTransaction(refresh);
  const visible = positions.filter(p => p.market.resolved === (tab === 'Resolved positions'));
  const value = positions.reduce((sum, p) => sum + p.value, 0n);
  const cost = positions.reduce((sum, p) => sum + p.cost, 0n);
  const escrow = orders.filter(o => o.buy).reduce((sum, o) => sum + o.remaining * BigInt(o.price) * 10100n, 0n);
  return <div className="page"><div className="page-heading heading-row"><div><span className="eyebrow">YOUR CONVICTION, IN VIEW</span><h1>Portfolio</h1><p>Your positions, orders, and next moves.</p></div><button className="button secondary" disabled={loading} onClick={() => void refresh()}><RefreshCw size={15} />Refresh</button></div><StatusBanner />
    <div className="metric-grid"><div className="panel metric"><small>Indicative position value</small><strong>{wallet.account ? `$${money(value)}` : '—'}</strong><span>USDG · based on last trades</span></div><div className="panel metric"><small>Unrealized PnL</small><strong className={value >= cost ? 'green' : 'red'}>{wallet.account ? `${value >= cost ? '+' : '−'}$${money(value >= cost ? value - cost : cost - value)}` : '—'}</strong><span>Includes entry trading fees</span></div><div className="panel metric"><small>Open buy-order escrow</small><strong>{wallet.account ? `$${money(escrow)}` : '—'}</strong><span>Includes refundable unearned fees</span></div></div>
    <section className="panel portfolio-panel"><div className="tabs">{['Open positions', 'Resolved positions', 'Orders'].map(t => <button className={tab === t ? 'active' : ''} onClick={() => setTab(t)} key={t}>{t}</button>)}</div>
      {error && <div className="notice danger" role="alert">Could not load complete accounting history: {error}. Values are unavailable until the RPC query succeeds.</div>}
      {!wallet.account ? <EmptyState title="Your positions start here." action={<button className="button primary" onClick={wallet.connect}>Connect wallet</button>}>Connect your wallet to view your shares, track performance and redeem resolved positions.</EmptyState> : loading ? <div className="table-empty">Loading your complete onchain history…</div> : tab === 'Orders' ? orders.length ? <div className="table-scroll"><table><thead><tr><th>Order</th><th>Side</th><th>Price</th><th>Remaining</th><th>Action</th></tr></thead><tbody>{orders.map(o => <tr key={String(o.id)}><td><Link to={`/market/${o.market}`}>#{String(o.id)} ↗</Link></td><td>{o.buy ? 'Buy' : 'Sell'} {o.yes ? 'YES' : 'NO'}</td><td>{o.price}¢</td><td>{String(o.remaining)}</td><td>{o.remaining ? <button className="text-button" disabled={tx.pending} onClick={() => void tx.run(async () => protocol!.book.connect(await wallet.signer()).getFunction('cancelOrder')(o.id))}>{o.expiresAt <= Date.now() / 1000 ? 'Reclaim expired' : 'Cancel & reclaim'}</button> : 'Filled / cancelled'}</td></tr>)}</tbody></table></div> : <EmptyState title="No orders yet.">Your onchain orders will appear here as soon as you place one.</EmptyState> : visible.length ? <div className="table-scroll"><table><thead><tr><th>Market / outcome</th><th>State</th><th>Shares</th><th>Average entry</th><th>Value</th><th>PnL</th><th /></tr></thead><tbody>{visible.map(p => <tr key={`${p.market.address}:${p.yes}`}><td className="market-cell"><Link to={`/market/${p.market.address}`}>{p.market.question}</Link><span className={`pill ${p.yes ? 'yes' : 'no'}`}>{p.yes ? 'YES' : 'NO'}</span></td><td>{p.market.outcome === 3 ? 'INVALID · 0.5 USDG' : p.market.resolved ? `Resolved ${p.market.outcome === 1 ? 'YES' : 'NO'}` : p.market.state === 3 ? 'Disputed' : 'Open / pending'}</td><td>{p.shares.toLocaleString()}<small>{(p.shares - p.available).toString()} in sell orders</small></td><td>${money(p.average, 4)}</td><td>${money(p.value)}</td><td className={p.value >= p.cost ? 'green' : 'red'}>{p.value >= p.cost ? '+' : '−'}${money(p.value >= p.cost ? p.value - p.cost : p.cost - p.value)}</td><td>{p.market.resolved ? <button className="button secondary small-button" disabled={tx.pending || !p.available} onClick={() => void tx.run(async () => marketContract(p.market.address, await wallet.signer()).redeem(p.yes, p.available))}>{p.market.outcome === 3 ? 'Redeem 0.5' : (p.yes && p.market.outcome === 1) || (!p.yes && p.market.outcome === 2) ? 'Redeem' : 'Clear'}</button> : <Link className="text-button" to={`/market/${p.market.address}`}>Trade <ArrowUpRight size={14} /></Link>}</td></tr>)}</tbody></table></div> : <EmptyState title={tab === 'Resolved positions' ? 'No resolved positions.' : 'Find your next position.'} action={<Link className="button secondary" to="/">Explore markets <ArrowUpRight size={15} /></Link>}>Matched shares appear here. Unmatched buy orders are escrow, not positions.</EmptyState>}
      {tx.feedback}</section><p className="portfolio-disclaimer"><Layers3 size={16} />Values are indicative, not executable bids. PnL uses moving-average entry cost including fees and excludes gas. Cancel sell orders before redeeming their escrowed shares. Unavailable historical data is never replaced with an estimated cost basis.</p>
  </div>;
}
