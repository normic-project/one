import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownToLine, ArrowUpRight, Plus, ShieldCheck } from 'lucide-react';
import { useWallet } from '../lib/Wallet';
import { useProtocol } from '../lib/Protocol';
import { errorMessage, money, stateLabel } from '../lib/chain';
import type { Market } from '../lib/chain';
import { apiWalletSummary } from '../lib/api';
import { EmptyState, StatusBanner, timeRemaining, useTransaction } from '../components/Common';

type LoadState = 'idle' | 'loading' | 'success' | 'error';

function exactUsdg(value: bigint) {
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '').padEnd(2, '0');
  return `${whole.toLocaleString('en-US')}.${fraction}`;
}

export default function CreatorPage() {
  const wallet = useWallet();
  const { protocol, loading: protocolLoading, error: protocolError } = useProtocol();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [claimable, setClaimable] = useState(0n);
  const [earned, setEarned] = useState<Record<string, bigint>>({});
  const [error, setError] = useState('');
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [loadedAccount, setLoadedAccount] = useState('');
  const requestVersion = useRef(0);

  const refresh = useCallback(async (background = false) => {
    const version = ++requestVersion.current;
    const account = wallet.account;
    setError('');
    if (!account) {
      setMarkets([]); setClaimable(0n); setEarned({}); setLoadedAccount(''); setLoadState('idle');
      return;
    }
    if (!protocol) {
      setLoadedAccount(account);
      setLoadState(protocolLoading ? 'loading' : 'error');
      return;
    }
    if (!background) setLoadState('loading');
    setLoadedAccount(account);
    try {
      const summary = await apiWalletSummary(account);
      if (version !== requestVersion.current) return;
      setClaimable(summary.claimableCreatorFees);
      setMarkets(summary.marketsCreated);
      setEarned(summary.earnedByMarket);
      setLoadState('success');
    } catch (e) {
      if (version !== requestVersion.current) return;
      setError(errorMessage(e));
      setLoadState('error');
    }
  }, [wallet.account, protocol, protocolLoading]);

  useEffect(() => {
    void refresh();
    if (!wallet.account || !protocol) return;
    const poll = window.setInterval(() => void refresh(true), 30_000);
    const onFocus = () => void refresh(true);
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(poll); window.removeEventListener('focus', onFocus); };
  }, [refresh, wallet.account, protocol]);

  const tx = useTransaction(() => refresh());
  const summaryState: LoadState = !wallet.account ? 'idle' : loadedAccount === wallet.account ? loadState : 'loading';
  const placeholder = summaryState === 'error' || protocolError ? 'Unavailable' : 'Loading…';
  const totalVolume = markets.reduce((value, market) => value + market.volume, 0n);
  const claimDisplay = summaryState === 'success' ? exactUsdg(claimable) : summaryState === 'idle' ? 'Connect wallet' : placeholder;
  const createdDisplay = summaryState === 'success' ? String(markets.length) : summaryState === 'idle' ? 'Connect wallet' : placeholder;
  const volumeDisplay = summaryState === 'success' ? `$${money(totalVolume)}` : summaryState === 'idle' ? 'Connect wallet' : placeholder;

  return <div className="page"><div className="page-heading heading-row"><div><span className="eyebrow">MAKE ROOM FOR A NEW PERSPECTIVE</span><h1>Creator studio</h1><p>Your markets. Your share of the action.</p></div><Link className="button primary" to="/create"><Plus size={16} />Create market</Link></div><StatusBanner />
    <div className="creator-summary"><div className="panel claim-panel"><span className="eyebrow">READY TO CLAIM</span><div className="claim-amount">{claimDisplay}{summaryState === 'success' && <span>USDG</span>}</div><p>Fees belong to you as soon as a trade settles.</p><button className="button primary" disabled={!protocol || !wallet.account || summaryState !== 'success' || claimable === 0n || tx.pending} onClick={() => void tx.run(async () => protocol!.fees.connect(await wallet.signer()).getFunction('claim')())}><ArrowDownToLine size={16} />{tx.pending ? 'Claiming…' : 'Claim creator fees'}</button>{tx.feedback}</div><div className="panel creator-stats"><div><small>Created markets</small><strong>{createdDisplay}</strong></div><div><small>Total market volume</small><strong>{volumeDisplay}</strong></div></div></div>
    <section className="panel detail-section"><div className="section-title"><h2>Your markets</h2><span className="badge">Immutable by design</span></div>{error && <div className="notice danger" role="alert">{error}<button className="text-button" onClick={() => void refresh()}>Retry</button></div>}
      {!wallet.account ? <EmptyState title="A space for your ideas." action={<button className="button primary" onClick={wallet.connect}>Connect wallet</button>}>Connect your wallet to manage your created markets and claim earned fees.</EmptyState> : summaryState === 'loading' ? <p className="table-empty">Loading your markets…</p> : summaryState === 'error' ? null : markets.length ? <div className="table-scroll"><table><thead><tr><th>Market</th><th>Type / status</th><th>Volume</th><th>Lifetime creator fees</th><th /></tr></thead><tbody>{markets.map(m => <tr key={m.address}><td className="market-cell"><Link to={`/market/${m.address}`}>{m.question}</Link></td><td>Event · {m.state === 0 ? timeRemaining(m.closesAt) : stateLabel(m.state)}</td><td>${money(m.volume)}</td><td>{money(earned[m.address] || 0n, 4)} USDG</td><td><Link className="text-button" to={`/market/${m.address}`}><ArrowUpRight size={17} /><span className="sr-only">Open market</span></Link></td></tr>)}</tbody></table></div> : <EmptyState title="Your first question could start something." action={<Link className="button secondary" to="/create">Create a market <Plus size={15} /></Link>}>Pay a fixed 0.0006 ETH launch fee. No liquidity deposit. Earn fees when traders match.</EmptyState>}</section>
    <div className="notice creator-notice"><ShieldCheck size={20} /><span>Creator fees are isolated from trader collateral. You can claim fees at any time, but cannot edit market terms, access backing, or select a winner.</span></div>
  </div>;
}
