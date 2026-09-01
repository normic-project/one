import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownToLine, ArrowUpRight, Plus, ShieldCheck } from 'lucide-react';
import { useWallet } from '../lib/Wallet';
import { useProtocol } from '../lib/Protocol';
import { errorMessage, loadMarkets, money, stateLabel } from '../lib/chain';
import type { Market } from '../lib/chain';
import { EmptyState, StatusBanner, timeRemaining, useTransaction } from '../components/Common';

export default function CreatorPage() {
  const wallet = useWallet();
  const { protocol } = useProtocol();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [claimable, setClaimable] = useState(0n);
  const [earned, setEarned] = useState<Record<string, bigint>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    setMarkets([]); setClaimable(0n); setEarned({}); setError('');
    if (!wallet.account || !protocol) return;
    setLoading(true);
    try {
      const count = Number(await protocol.factory.marketCount());
      const all: Market[] = [];
      for (let offset = 0; offset < count; offset += 24) all.push(...(await loadMarkets(protocol, offset)).markets);
      const mine = all.filter(m => m.creator.toLowerCase() === wallet.account.toLowerCase());
      const fees: Record<string, bigint> = {};
      for (const m of mine) fees[m.address] = await protocol.fees.earnedByMarket(m.address);
      setClaimable(await protocol.fees.claimable(wallet.account)); setMarkets(mine); setEarned(fees);
    } catch (e) { setError(errorMessage(e)); } finally { setLoading(false); }
  }, [wallet.account, protocol]);
  useEffect(() => { void refresh(); }, [refresh]);
  const tx = useTransaction(refresh);
  return <div className="page"><div className="page-heading heading-row"><div><span className="eyebrow">MAKE ROOM FOR A NEW PERSPECTIVE</span><h1>Creator studio</h1><p>Your markets. Your share of the action.</p></div><Link className="button primary" to="/create"><Plus size={16} />Create market</Link></div><StatusBanner />
    <div className="creator-summary"><div className="panel claim-panel"><span className="eyebrow">READY TO CLAIM</span><div className="claim-amount">{wallet.account ? money(claimable, 4) : '—'}<span>USDG</span></div><p>Fees belong to you as soon as a trade settles.</p><button className="button primary" disabled={!protocol || !wallet.account || claimable === 0n || tx.pending} onClick={() => void tx.run(async () => protocol!.fees.connect(await wallet.signer()).getFunction('claim')())}><ArrowDownToLine size={16} />{tx.pending ? 'Claiming…' : 'Claim creator fees'}</button>{tx.feedback}</div><div className="panel creator-stats"><div><small>Created markets</small><strong>{wallet.account ? markets.length : '—'}</strong></div><div><small>Total market volume</small><strong>${money(markets.reduce((v, m) => v + m.volume, 0n))}</strong></div><div><small>Your fee rate</small><strong className="green">0.6%<span>of matched notional</span></strong></div></div></div>
    <section className="panel detail-section"><div className="section-title"><h2>Your markets</h2><span className="badge">Immutable by design</span></div>{error && <div className="notice danger" role="alert">{error}</div>}
      {!wallet.account ? <EmptyState title="A space for your ideas." action={<button className="button primary" onClick={wallet.connect}>Connect wallet</button>}>Connect your wallet to manage your created markets and claim earned fees.</EmptyState> : loading ? <p className="table-empty">Loading your markets…</p> : markets.length ? <div className="table-scroll"><table><thead><tr><th>Market</th><th>Type / status</th><th>Volume</th><th>Lifetime creator fees</th><th /></tr></thead><tbody>{markets.map(m => <tr key={m.address}><td className="market-cell"><Link to={`/market/${m.address}`}>{m.question}</Link></td><td>Event · {m.state === 0 ? timeRemaining(m.closesAt) : stateLabel(m.state)}</td><td>${money(m.volume)}</td><td>{money(earned[m.address] || 0n, 4)} USDG</td><td><Link className="text-button" to={`/market/${m.address}`}><ArrowUpRight size={17} /><span className="sr-only">Open market</span></Link></td></tr>)}</tbody></table></div> : <EmptyState title="Your first question could start something." action={<Link className="button secondary" to="/create">Create a market <Plus size={15} /></Link>}>Pay a fixed 0.0006 ETH listing fee. No liquidity deposit. Earn fees when traders match.</EmptyState>}</section>
    <div className="notice creator-notice"><ShieldCheck size={20} /><span>Creator fees are isolated from trader collateral. You can claim fees at any time, but cannot edit market terms, access backing, or select a winner.</span></div>
  </div>;
}
