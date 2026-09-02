import { useState } from 'react';
import type { ReactNode } from 'react';
import type { TransactionResponse } from 'ethers';
import { AlertCircle, ArrowUpRight, Check, LoaderCircle, Radio, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { errorMessage, money, outcomeLabel } from '../lib/chain';
import type { Market } from '../lib/chain';
import { EXPLORER } from '../lib/config';
import { useProtocol } from '../lib/Protocol';

export function useTransaction(onSuccess?: () => Promise<void>) {
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState('');
  const [hash, setHash] = useState('');
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  async function run(action: (update: (message: string) => void) => Promise<TransactionResponse>) {
    setPending(true); setConfirmed(false); setError(''); setHash(''); setStatus('Confirm in your wallet…');
    try {
      const tx = await action(setStatus);
      setHash(tx.hash); setStatus('Transaction submitted. Waiting for confirmation…');
      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) throw new Error('Transaction did not succeed.');
      setStatus('Confirmed.');
      setConfirmed(true);
      if (onSuccess) {
        try { await onSuccess(); } catch (e) { setError(`Transaction confirmed, but data refresh failed: ${errorMessage(e)}`); }
      }
    } catch (e) { setError(errorMessage(e)); setStatus(''); } finally { setPending(false); }
  }
  const feedback = <>{status && <div className={`tx-status ${pending ? '' : 'success'}`} role="status">{pending ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}<span>{status} {hash && <a href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer">View transaction ↗</a>}</span></div>}{error && <div className="notice danger" role="alert"><AlertCircle size={17} /><span>{error}</span></div>}</>;
  return { pending, confirmed, run, feedback };
}
export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Radio size={29} strokeWidth={1.4} /></div><h3>{title}</h3><p>{children}</p>{action}</div>;
}
export function StatusBanner() {
  const state = useProtocol();
  if (state.error) return <div role="alert" className="notice danger"><AlertCircle size={17} /><span>{state.error}</span><button className="text-button" onClick={() => void state.refresh()}>Retry</button></div>;
  if (!state.configured) return <div className="notice"><ShieldCheck size={17} /><span><strong>Trading unavailable.</strong> Live actions remain disabled until the service is fully configured.</span></div>;
  return null;
}
export function timeRemaining(timestamp: number) {
  const seconds = timestamp - Date.now() / 1000;
  if (seconds <= 0) return 'Trading closed';
  if (seconds > 86400) return `${Math.ceil(seconds / 86400)}d remaining`;
  if (seconds > 3600) return `${Math.ceil(seconds / 3600)}h remaining`;
  return `${Math.ceil(seconds / 60)}m remaining`;
}
export function MarketCard({ market }: { market: Market }) {
  return <Link className="market-card" to={`/market/${market.address}`}><div className="card-top"><span className="asset-symbol">{market.category.slice(0, 1).toUpperCase()}</span><span className="category-label">{market.category} · Event</span><ArrowUpRight size={17} /></div>
    <h3>{market.question}</h3><div className="market-probability"><strong>{market.yesPrice || '—'}{market.yesPrice ? '%' : ''}</strong><span>YES · last trade</span></div>
    <div className="outcomes"><span className="yes">Yes <b>{market.yesPrice ? `${market.yesPrice}¢` : '—'}</b></span><span className="no">No <b>{market.yesPrice ? `${100 - market.yesPrice}¢` : '—'}</b></span></div>
    <div className="card-footer"><span>${money(market.volume)} vol.</span><span>{market.resolved ? `Resolved ${outcomeLabel(market.outcome)}` : timeRemaining(market.closesAt)}</span></div></Link>;
}
