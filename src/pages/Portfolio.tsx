import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Layers3, RefreshCw } from 'lucide-react';
import { useProtocol } from '../lib/Protocol';
import { useWallet } from '../lib/Wallet';
import { errorMessage, marketContract, money } from '../lib/chain';
import type { Order } from '../lib/chain';
import { apiOrders, apiWalletActivity, apiWalletPositions } from '../lib/api';
import type { WalletActivity } from '../lib/api';
import { EmptyState, StatusBanner, useTransaction } from '../components/Common';

type Position = Awaited<ReturnType<typeof apiWalletPositions>>[number] & { shares: bigint; cost: bigint; value: bigint; average: number };
export default function PortfolioPage() {
  const { protocol } = useProtocol();
  const wallet = useWallet();
  const [positions, setPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [activity, setActivity] = useState<WalletActivity[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('Open positions');
  const refresh = useCallback(async () => {
    setPositions([]); setOrders([]); setActivity([]); setError('');
    if (!wallet.account || !protocol) return;
    setLoading(true);
    try {
      const [indexed, myOrders, history] = await Promise.all([
        apiWalletPositions(wallet.account), apiOrders(wallet.account, true), apiWalletActivity(wallet.account)
      ]);
      const found = indexed.map(position => {
        const escrow = myOrders.filter(order => order.market.toLowerCase() === position.market.address.toLowerCase() &&
          !order.buy && order.yes === position.yes).reduce((sum, order) => sum + order.remaining, 0n);
        const shares = position.available + escrow;
        const cost = position.netInvestment > 0n ? position.netInvestment : 0n;
        const price = position.market.resolved ? (position.market.outcome === 3 ? 50 :
          (position.yes && position.market.outcome === 1) || (!position.yes && position.market.outcome === 2) ? 100 : 0)
          : position.market.yesPrice ? (position.yes ? position.market.yesPrice : 100-position.market.yesPrice) : 0;
        return { ...position, shares, cost, value: shares * BigInt(price) * 10000n,
          average: shares ? Number(cost / shares) / 1000000 : 0 };
      }).filter(position => position.shares > 0n || position.netInvestment !== 0n);
      setOrders(myOrders); setPositions(found); setActivity(history);
    } catch (e) { setError(errorMessage(e)); } finally { setLoading(false); }
  }, [wallet.account, protocol]);
  useEffect(() => { void refresh(); }, [refresh]);
  const tx = useTransaction(refresh);
  const visible = positions.filter(position => position.market.resolved === (tab === 'Resolved positions'));
  const value = positions.reduce((sum, position) => sum + position.value, 0n);
  const cost = positions.reduce((sum, position) => sum + position.cost, 0n);
  const escrow = orders.filter(order => order.buy).reduce((sum, order) => sum + order.remaining * BigInt(order.price) * 10100n, 0n);
  return <div className="page"><div className="page-heading heading-row"><div><span className="eyebrow">YOUR CONVICTION, IN VIEW</span><h1>Portfolio</h1><p>Your positions, orders, and onchain history.</p></div><button className="button secondary" disabled={loading} onClick={() => void refresh()}><RefreshCw size={15} />Refresh</button></div><StatusBanner />
    <div className="metric-grid"><div className="panel metric"><small>Indicative position value</small><strong>{wallet.account ? `$${money(value)}` : '—'}</strong><span>USDG · based on last trades</span></div><div className="panel metric"><small>PnL vs net cash flow</small><strong className={value >= cost ? 'green' : 'red'}>{wallet.account ? `${value >= cost ? '+' : '−'}$${money(value >= cost ? value-cost : cost-value)}` : '—'}</strong><span>Includes fees and realized sale proceeds</span></div><div className="panel metric"><small>Open buy-order escrow</small><strong>{wallet.account ? `$${money(escrow)}` : '—'}</strong><span>Includes refundable unearned fees</span></div></div>
    <section className="panel portfolio-panel"><div className="tabs">{['Open positions','Resolved positions','Orders','Activity'].map(value => <button className={tab === value ? 'active' : ''} onClick={() => setTab(value)} key={value}>{value}</button>)}</div>
      {error && <div className="notice danger" role="alert">Could not load indexed onchain history: {error}. <button className="text-button" onClick={() => void refresh()}>Retry</button></div>}
      {!wallet.account ? <EmptyState title="Your positions start here." action={<button className="button primary" onClick={wallet.connect}>Connect wallet</button>}>Connect your wallet to view public onchain positions, orders, and history.</EmptyState> : loading ? <div className="table-empty">Loading indexed onchain history…</div> : tab === 'Activity' ? activity.length ? <div className="table-scroll"><table><thead><tr><th>Activity</th><th>Side</th><th>Shares</th><th>USDG</th><th>Time</th></tr></thead><tbody>{activity.map(item => <tr key={`${item.tx_hash}:${item.log_index}:${item.activity_type}`}><td>{item.activity_type.replaceAll('_',' ')}</td><td>{item.yes === undefined ? '—' : item.yes ? 'YES' : 'NO'}</td><td>{item.amount || '—'}</td><td>{item.quote_amount ? money(BigInt(item.quote_amount),4) : '—'}</td><td>{new Date(item.block_timestamp).toLocaleString()}</td></tr>)}</tbody></table></div> : <EmptyState title="No activity yet.">Confirmed wallet activity will appear after the indexer processes it.</EmptyState> : tab === 'Orders' ? orders.length ? <div className="table-scroll"><table><thead><tr><th>Order</th><th>Side</th><th>Price</th><th>Remaining</th><th>Action</th></tr></thead><tbody>{orders.map(order => <tr key={String(order.id)}><td><Link to={`/market/${order.market}`}>#{String(order.id)} ↗</Link></td><td>{order.buy ? 'Buy' : 'Sell'} {order.yes ? 'YES' : 'NO'}</td><td>{order.price}¢</td><td>{String(order.remaining)}</td><td>{order.remaining ? <button className="text-button" disabled={tx.pending} onClick={() => void tx.run(async () => protocol!.book.connect(await wallet.signer()).getFunction('cancelOrder')(order.id))}>{order.expiresAt <= Date.now()/1000 ? 'Reclaim expired' : 'Cancel & reclaim'}</button> : 'Filled / cancelled'}</td></tr>)}</tbody></table></div> : <EmptyState title="No orders yet.">Your confirmed onchain orders will appear after they are indexed.</EmptyState> : visible.length ? <div className="table-scroll"><table><thead><tr><th>Market / outcome</th><th>State</th><th>Shares</th><th>Net basis/share</th><th>Value</th><th>PnL</th><th /></tr></thead><tbody>{visible.map(position => <tr key={`${position.market.address}:${position.yes}`}><td className="market-cell"><Link to={`/market/${position.market.address}`}>{position.market.question}</Link><span className={`pill ${position.yes ? 'yes' : 'no'}`}>{position.yes ? 'YES' : 'NO'}</span></td><td>{position.market.outcome === 3 ? 'INVALID · 0.5 USDG' : position.market.resolved ? `Resolved ${position.market.outcome === 1 ? 'YES' : 'NO'}` : 'Open / pending'}</td><td>{position.shares.toLocaleString()}<small>{(position.shares-position.available).toString()} in sell orders</small></td><td>${money(position.average,4)}</td><td>${money(position.value)}</td><td className={position.value >= position.cost ? 'green' : 'red'}>{position.value >= position.cost ? '+' : '−'}${money(position.value >= position.cost ? position.value-position.cost : position.cost-position.value)}</td><td>{position.market.resolved ? <button className="button secondary small-button" disabled={tx.pending || !position.available} onClick={() => void tx.run(async () => marketContract(position.market.address, await wallet.signer()).redeem(position.yes, position.available))}>{position.market.outcome === 3 ? 'Redeem 0.5' : (position.yes && position.market.outcome === 1) || (!position.yes && position.market.outcome === 2) ? 'Redeem' : 'Clear'}</button> : <Link className="text-button" to={`/market/${position.market.address}`}>Trade <ArrowUpRight size={14} /></Link>}</td></tr>)}</tbody></table></div> : <EmptyState title={tab === 'Resolved positions' ? 'No resolved positions.' : 'Find your next position.'} action={<Link className="button secondary" to="/">Explore markets <ArrowUpRight size={15} /></Link>}>Matched shares appear here. Unmatched buy orders are escrow, not positions.</EmptyState>}
      {tx.feedback}</section><p className="portfolio-disclaimer"><Layers3 size={16} />Values are indicative, not executable bids. Canonical share balances and open-order amounts are read from the live contracts by the server.</p>
  </div>;
}
