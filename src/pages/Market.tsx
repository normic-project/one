import { useCallback, useEffect, useState } from 'react';
import { Contract, isAddress } from 'ethers';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Clock3, ShieldCheck } from 'lucide-react';
import { useProtocol } from '../lib/Protocol';
import { useWallet } from '../lib/Wallet';
import { compatible, errorMessage, eventMarketContract, loadMarket, loadOrders, loadTrades,
  marketContract, money, outcomeLabel, provider, short, stateLabel } from '../lib/chain';
import type { Market, Order, Trade } from '../lib/chain';
import { CHAIN_ID, EXPLORER, TOKEN_ABI, USDG } from '../lib/config';
import { EmptyState, StatusBanner, timeRemaining, useTransaction } from '../components/Common';

function safeExternalHref(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch { return null; }
}

export default function MarketPage() {
  const { address = '' } = useParams();
  const { protocol } = useProtocol();
  const wallet = useWallet();
  const [market, setMarket] = useState<Market | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [balances, setBalances] = useState<[bigint, bigint]>([0n, 0n]);
  const [error, setError] = useState('');
  const [yes, setYes] = useState(true);
  const [buy, setBuy] = useState(true);
  const [price, setPrice] = useState('50');
  const [quantity, setQuantity] = useState('10');
  const [finalOutcome, setFinalOutcome] = useState(1);
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(async () => {
    if (!protocol) return;
    try {
      if (!isAddress(address) || !await protocol.factory.isMarket(address)) throw new Error('This is not a market registered with the configured protocol.');
      const [m, o, t, block] = await Promise.all([loadMarket(address), loadOrders(protocol, address),
        loadTrades(protocol, address), provider.getBlock('latest')]);
      setMarket(m); setOrders(o); setTrades(t); setNow(block ? block.timestamp * 1000 : Date.now()); setError('');
      if (wallet.account) setBalances(await Promise.all([marketContract(address).sharesOf(wallet.account, true), marketContract(address).sharesOf(wallet.account, false)]) as [bigint, bigint]);
      else setBalances([0n, 0n]);
    } catch (e) { setError(errorMessage(e)); }
  }, [address, protocol, wallet.account]);
  useEffect(() => { void refresh(); const timer = setInterval(() => { void refresh(); }, 15000); return () => clearInterval(timer); }, [refresh]);
  const tx = useTransaction(refresh);

  const validOrder = /^\d+$/.test(price) && +price >= 1 && +price <= 99 && /^\d+$/.test(quantity) && +quantity >= 1 && +quantity <= 1e12;
  const shares = validOrder ? BigInt(quantity) : 0n;
  const principal = validOrder ? shares * BigInt(price) * 10000n : 0n;
  const fee = buy ? principal / 100n : 0n;
  const active = market && !market.resolved && now / 1000 < market.closesAt;
  const liveOrders = orders.filter(o => o.remaining > 0 && o.expiresAt > now / 1000);
  const myOrders = orders.filter(o => o.owner.toLowerCase() === wallet.account.toLowerCase());
  const matches = validOrder ? liveOrders.filter(o => compatible(o, yes, buy, +price, wallet.account)) : [];
  const matchingShares = matches.reduce((sum, o) => sum + o.remaining, 0n);
  const primaryHref = market ? safeExternalHref(market.primarySource) : null;
  const secondaryHref = market ? safeExternalHref(market.secondarySource) : null;

  async function approveUSDG(spender: string, amount: bigint, update: (message: string) => void) {
    let signer = await wallet.signer();
    const token = new Contract(USDG, TOKEN_ABI, signer);
    if (await token.balanceOf(wallet.account) < amount) throw new Error('Insufficient USDG.');
    if (await token.allowance(wallet.account, spender) < amount) {
      update('Approve the exact USDG amount in your wallet…');
      await (await token.approve(spender, amount)).wait();
      signer = await wallet.signer();
    }
    return signer;
  }

  async function submitOrder() {
    if (!protocol || !market || !validOrder) return;
    await tx.run(async update => {
      let signer = await wallet.signer();
      if (buy) signer = await approveUSDG(protocol.book.target as string, principal + fee, update);
      update('Confirm your limit order in your wallet…');
      const book = protocol.book.connect(signer);
      const request = { market: address, yes, buy, price: +price, shares, expiresAt: market.closesAt };
      const candidates = matches.slice(0, 20).map(o => o.id);
      await book.getFunction('placeAndMatch').staticCall(request, candidates);
      return book.getFunction('placeAndMatch')(request, candidates);
    });
  }

  return <div className="page"><Link className="back-link" to="/"><ArrowLeft size={15} />All markets</Link><StatusBanner />
    {error && <div className="notice danger" role="alert">{error}<button className="text-button" onClick={() => void refresh()}>Retry</button></div>}
    {!market ? <EmptyState title={protocol ? 'Loading market…' : 'No live market connected'}>Market details are read directly from verified mainnet contracts.</EmptyState> : <>
      <div className="market-heading"><div><span className="eyebrow">{market.category.toUpperCase()} · EVENT MARKET</span><h1>{market.question}</h1><div className="market-meta"><span><Clock3 size={14} />{market.resolved ? `Resolved ${outcomeLabel(market.outcome)}` : timeRemaining(market.closesAt)}</span><span>Created by <a href={`${EXPLORER}/address/${market.creator}`} target="_blank" rel="noreferrer">{short(market.creator)}</a></span></div></div><span className={`pill ${market.resolved ? 'neutral' : active ? 'yes' : 'no'}`}>{stateLabel(market.state)}</span></div>
      <div className="trading-layout"><div>
        <section className="panel price-panel"><div className="price-heading"><div><small>YES · last matched price</small><strong>{market.yesPrice ? `${market.yesPrice}¢` : '—'}</strong></div><div><small>NO · complementary price</small><strong>{market.yesPrice ? `${100 - market.yesPrice}¢` : '—'}</strong></div><span className="badge">All history</span></div>
          {trades.length > 1 ? <svg className="price-chart" viewBox="0 0 640 190" role="img" aria-label="YES price history"><line x1="0" y1="95" x2="640" y2="95" className="gridline" /><polyline points={trades.map((t, i) => `${i / (trades.length - 1) * 640},${180 - t.yesPrice * 1.6}`).join(' ')} /></svg> : <div className="chart-empty">{trades.length ? 'One trade recorded. More matches will build the price history.' : 'The first matched trade sets the first price.'}</div>}
          <div className="chart-stats"><div><small>Total matched volume</small><b>${money(market.volume)}</b></div><div><small>Locked collateral</small><b>${money(market.locked)}</b></div><div><small>Open orders</small><b>{active ? liveOrders.length : 0}</b></div></div>
        </section>
        <section className="panel detail-section"><div className="section-title"><h2>Order book</h2><span className="badge">Real matched demand</span></div><p>No instant exit is promised. Orders fill only when compatible demand exists.</p>
          {active && liveOrders.length ? <div className="table-scroll"><table><thead><tr><th>Side</th><th>Order</th><th>Price</th><th>Shares</th><th /></tr></thead><tbody>{liveOrders.map(o => <tr key={String(o.id)}><td><span className={`pill ${o.yes ? 'yes' : 'no'}`}>{o.yes ? 'YES' : 'NO'}</span></td><td>{o.buy ? 'Buy' : 'Sell'}</td><td>{o.price}¢</td><td>{o.remaining.toLocaleString()}</td><td><button className="text-button" disabled={o.owner.toLowerCase() === wallet.account.toLowerCase()} onClick={() => { setYes(o.buy ? !o.yes : o.yes); setBuy(true); setPrice(String(o.buy ? 100 - o.price : o.price)); setQuantity(String(o.remaining)); }}>Take side <ArrowUpRight size={13} /></button></td></tr>)}</tbody></table></div> : <p className="table-empty">No executable orders. A new order will wait for matching demand.</p>}
        </section>
        <section className="panel detail-section"><h2>Your orders & positions</h2>{wallet.account ? <><div className="position-pills"><span>Available YES <b>{balances[0].toString()}</b></span><span>Available NO <b>{balances[1].toString()}</b></span></div>{myOrders.length ? <div className="table-scroll"><table><thead><tr><th>Order</th><th>Limit</th><th>Remaining</th><th>Status / action</th></tr></thead><tbody>{myOrders.map(o => <tr key={String(o.id)}><td>#{o.id.toString()} · {o.buy ? 'Buy' : 'Sell'} {o.yes ? 'YES' : 'NO'}</td><td>{o.price}¢</td><td>{o.remaining.toString()}</td><td>{o.remaining ? <button className="text-button" disabled={tx.pending} onClick={() => void tx.run(async () => protocol!.book.connect(await wallet.signer()).getFunction('cancelOrder')(o.id))}>{o.expiresAt <= now / 1000 ? 'Expired · reclaim' : 'Cancel & reclaim'}</button> : 'Filled / cancelled'}</td></tr>)}</tbody></table></div> : <p>You have no orders here.</p>}{market.resolved && [true, false].map((side, i) => balances[i] > 0n && <button className="button secondary" key={String(side)} disabled={tx.pending} onClick={() => void tx.run(async () => marketContract(address, await wallet.signer()).redeem(side, balances[i]))}>{market.outcome === 3 ? 'Redeem at 0.5 USDG' : (side && market.outcome === 1) || (!side && market.outcome === 2) ? 'Redeem' : 'Clear losing'} {side ? 'YES' : 'NO'}</button>)}</> : <p>Connect your wallet to see positions.</p>}</section>
        <section className="panel detail-section"><div className="section-title"><h2>Resolution rules</h2><span className="badge">Resolver Safe</span></div><p>{market.rules}</p><dl className="details"><dt>Market type</dt><dd>EVENT_MARKET</dd><dt>Current state</dt><dd>{stateLabel(market.state)}</dd><dt>YES meaning</dt><dd>{market.yesOutcome}</dd><dt>NO meaning</dt><dd>{market.noOutcome}</dd><dt>Trading close</dt><dd>{new Date(market.closesAt * 1000).toUTCString()}</dd><dt>Resolution date</dt><dd>{new Date(market.resolvesAt * 1000).toUTCString()}</dd><dt>Primary source</dt><dd>{primaryHref ? <a href={primaryHref} target="_blank" rel="noopener noreferrer">Open source <ArrowUpRight size={13} /></a> : <span>{market.primarySource}</span>}</dd>{market.secondarySource && <><dt>Secondary source</dt><dd>{secondaryHref ? <a href={secondaryHref} target="_blank" rel="noopener noreferrer">Open backup source <ArrowUpRight size={13} /></a> : <span>{market.secondarySource}</span>}</dd></>}<dt>Resolver Safe</dt><dd><a href={`${EXPLORER}/address/${market.resolverMultisig}`} target="_blank" rel="noopener noreferrer">{short(market.resolverMultisig)} ↗</a></dd><dt>Metadata commitment</dt><dd>{market.metadataHash}</dd><dt>Market contract</dt><dd><a href={`${EXPLORER}/address/${address}`} target="_blank" rel="noopener noreferrer">{short(address)} ↗</a></dd></dl>
        </section>
        {!market.resolved && <section className="panel detail-section"><div className="section-title"><h2>Final resolution</h2><span className="badge">One-time Safe action</span></div>
          <p>Only the configured Resolver Safe can select YES, NO or INVALID, and only after the resolution date.</p>
          {now / 1000 >= market.resolvesAt && wallet.account.toLowerCase() === market.resolverMultisig.toLowerCase() && <div className="resolution-action"><label>Final outcome<select aria-label="Final outcome" value={finalOutcome} onChange={e => setFinalOutcome(Number(e.target.value))}><option value={1}>YES</option><option value={2}>NO</option><option value={3}>INVALID</option></select></label><button className="button secondary" disabled={tx.pending} onClick={() => void tx.run(async () => eventMarketContract(address, await wallet.signer()).resolve(finalOutcome))}>Finalize market outcome</button></div>}
          {now / 1000 >= market.resolvesAt && <p>Redemption remains disabled until the configured Resolver Safe finalizes this market.</p>}
        </section>}
      </div><aside className="trade-aside"><section className="panel order-entry"><div className="segmented">{[true, false].map(isBuy => <button key={String(isBuy)} className={buy === isBuy ? 'active' : ''} onClick={() => setBuy(isBuy)}>{isBuy ? 'Buy' : 'Sell'}</button>)}</div><div className="side-select"><button className={yes ? 'selected yes' : ''} onClick={() => setYes(true)}>Yes <span>{market.yesPrice ? `${market.yesPrice}¢` : '—'}</span></button><button className={!yes ? 'selected no' : ''} onClick={() => setYes(false)}>No <span>{market.yesPrice ? `${100 - market.yesPrice}¢` : '—'}</span></button></div>
        <label>Limit price <span className="label-hint">1–99¢</span><div className="input-affix"><input aria-label="Limit price" type="number" min="1" max="99" step="1" value={price} onChange={e => setPrice(e.target.value)} /><span>¢ / share</span></div></label><label>Number of shares<div className="input-affix"><input aria-label="Number of shares" type="number" min="1" max="1000000000000" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} /><span>shares</span></div></label>
        {!buy && <small>Available: {balances[yes ? 0 : 1].toString()} {yes ? 'YES' : 'NO'} shares</small>}
        <div className="order-summary"><div><span>{buy ? 'Principal escrow' : 'Sale proceeds if filled'}</span><b>{money(principal)} USDG</b></div><div><span>Trading fee {buy ? '(1%)' : '(paid by buyer)'}</span><b>{money(fee, 4)} USDG</b></div>{buy && <div className="sub"><span>Protocol 0.4% / Creator 0.6%</span><span>Separate from collateral</span></div>}<div className="total"><span>{buy ? 'Maximum debit' : 'Proceeds'}</span><b>{money(principal + fee)} USDG</b></div></div>
        <p className="matching-note">{matchingShares ? `Up to ${matchingShares} shares can match visible demand.` : 'No matching demand at this price. Your order will remain open and cancellable.'}</p>{tx.feedback}
        <button className="button primary full" disabled={!protocol || !active || !validOrder || tx.pending || (buy ? false : balances[yes ? 0 : 1] < shares) || (!!wallet.account && wallet.chainId !== CHAIN_ID)} onClick={wallet.account ? () => void submitOrder() : wallet.connect}>{wallet.account ? active ? `${buy ? 'Buy' : 'Sell'} ${yes ? 'YES' : 'NO'} · limit order` : 'Trading closed' : 'Connect wallet'}</button>
        <p className="small">Shares can lose all value. INVALID pays 0.5 USDG per share. There is no house liquidity or guaranteed exit.</p>
      </section><div className="aside-note"><ShieldCheck size={20} /><p>Every matched YES/NO pair locks exactly 1 USDG. Trading fees use separate balances.</p></div></aside></div>
    </>}
  </div>;
}
