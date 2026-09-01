import { useEffect, useMemo, useState } from 'react';
import { parseEther, parseUnits } from 'ethers';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, LockKeyhole, Plus, ShieldCheck } from 'lucide-react';
import { errorMessage } from '../lib/chain';
import { useProtocol } from '../lib/Protocol';
import { useWallet } from '../lib/Wallet';
import { CHAIN_ID } from '../lib/config';
import { StatusBanner, useTransaction } from '../components/Common';

const localDate = (offset: number) => { const d = new Date(Date.now() + offset); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const timestamp = (value: string) => Math.floor(new Date(value).getTime() / 1000);

export default function CreatePage() {
  const { protocol, refresh } = useProtocol();
  const wallet = useWallet();
  const navigate = useNavigate();
  const [marketType, setMarketType] = useState<'auto' | 'event'>('auto');
  const [threshold, setThreshold] = useState('');
  const [condition, setCondition] = useState(0);
  const [question, setQuestion] = useState('');
  const [yesOutcome, setYesOutcome] = useState('');
  const [noOutcome, setNoOutcome] = useState('');
  const [category, setCategory] = useState('Other');
  const [rules, setRules] = useState('');
  const [primarySource, setPrimarySource] = useState('');
  const [secondarySource, setSecondarySource] = useState('');
  const [metadataURI, setMetadataURI] = useState('');
  const [closes, setCloses] = useState(localDate(86400000));
  const [resolves, setResolves] = useState(localDate(90000000));
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState('');
  const [autoPreview, setAutoPreview] = useState<{ question: string; rules: string; primarySource: string } | null>(null);
  const tx = useTransaction(refresh);

  const eventComplete = [question, yesOutcome, noOutcome, category, rules, primarySource, closes, resolves].every(Boolean);
  const ambiguous = useMemo(() => marketType === 'event' && question.length > 0 &&
    (question.length < 20 || /\b(soon|likely|probably|best|successful|significant|major|good|bad)\b/i.test(question) || rules.length < 50),
  [marketType, question, rules]);

  useEffect(() => {
    let active = true;
    setAutoPreview(null);
    if (marketType === 'auto' && protocol && /^\d{1,13}$/.test(threshold) && Number(threshold) > 0 && closes && resolves) {
      const terms = { threshold: parseUnits(threshold, 6), closesAt: timestamp(closes), resolvesAt: timestamp(resolves), condition };
      void protocol.autoResolver.describe(terms)
        .then(result => { if (active) { setAutoPreview({ question: result.question, rules: result.rules, primarySource: result.primarySource }); setError(''); } })
        .catch(() => { if (active) setError('Close must be at least 60 seconds from now. Resolution must follow close and be within one year. Use a whole-USDG threshold.'); });
    }
    return () => { active = false; };
  }, [protocol, marketType, threshold, condition, closes, resolves]);

  async function submit() {
    if (!protocol || (marketType === 'auto' ? !autoPreview : !eventComplete)) return;
    await tx.run(async update => {
      const contract = protocol.factory.connect(await wallet.signer());
      const value = { value: parseEther('0.0006') };
      if (marketType === 'auto') {
        const terms = { threshold: parseUnits(threshold, 6), closesAt: timestamp(closes), resolvesAt: timestamp(resolves), condition };
        await contract.getFunction('createAutoMarket').staticCall(terms, value);
        update('Confirm the 0.0006 ETH listing fee in your wallet…');
        return contract.getFunction('createAutoMarket')(terms, value);
      }
      const metadata = { question, yesOutcome, noOutcome, category, rules, primarySource, secondarySource, metadataURI };
      await contract.getFunction('createEventMarket').staticCall(timestamp(closes), timestamp(resolves), metadata, value);
      update('Confirm the 0.0006 ETH listing fee in your wallet…');
      return contract.getFunction('createEventMarket')(timestamp(closes), timestamp(resolves), metadata, value);
    });
  }

  return <div className="page"><Link className="back-link" to="/"><ArrowLeft size={15} />Explore markets</Link>
    <div className="page-heading"><span className="eyebrow">CREATOR STUDIO</span><h1>Turn any resolvable question into a market.</h1><p>Choose automatic onchain settlement or immutable rules with optimistic event resolution.</p></div><StatusBanner />
    <div className="create-layout"><form className="panel create-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <div className="form-section-title"><span>01</span><h2>Market type</h2><span className="badge">Choose resolution</span></div>
      <div className="segmented market-type-select" aria-label="Market type">
        <button type="button" className={marketType === 'auto' ? 'active' : ''} onClick={() => { setMarketType('auto'); setError(''); }}>Automatic</button>
        <button type="button" className={marketType === 'event' ? 'active' : ''} onClick={() => { setMarketType('event'); setError(''); }}>Event</button>
      </div>

      {marketType === 'auto' ? <>
        <p className="muted">Automatic markets use the approved WETH/USDG Uniswap V3 pool. Asset, pool and 60-minute TWAP window cannot be changed.</p>
        <label>Asset<input value="ETH / USDG" readOnly /></label>
        <label>Condition<select value={condition} onChange={e => setCondition(Number(e.target.value))}><option value={0}>ABOVE OR EQUAL</option><option value={1}>BELOW</option></select></label>
        <label>Threshold in USDG<div className="input-affix"><span>$</span><input aria-label="Automatic threshold" required type="number" min="1" step="1" max="1000000000000" placeholder="4000" value={threshold} onChange={e => setThreshold(e.target.value)} /><span>USDG</span></div></label>
        <label>Oracle<input value="Uniswap V3 WETH/USDG historical TWAP" readOnly /></label>
        <label>TWAP window<input value="60 minutes · protocol selected" readOnly /></label>
        <div className="outcome-definition"><div><span className="pill yes">YES</span>{condition === 0 ? 'At or above threshold' : 'Below threshold'}</div><div><span className="pill no">NO</span>{condition === 0 ? 'Below threshold' : 'At or above threshold'}</div></div>
      </> : <>
        <p className="muted">Questions may cover any lawful, objectively resolvable topic. Resolution follows only the immutable meanings, rules and sources below.</p>
        <label>Question<textarea aria-label="Event question" required maxLength={280} rows={3} value={question} onChange={e => setQuestion(e.target.value)} placeholder="Will the named team win the 2027 tournament?" /></label>
        <label>YES means<textarea required maxLength={280} rows={2} value={yesOutcome} onChange={e => setYesOutcome(e.target.value)} /></label>
        <label>NO means<textarea required maxLength={280} rows={2} value={noOutcome} onChange={e => setNoOutcome(e.target.value)} /></label>
        <label>Category<select value={category} onChange={e => setCategory(e.target.value)}>{['Crypto', 'Politics', 'Sports', 'Tech', 'Culture', 'Entertainment', 'World', 'Other'].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Resolution rules<textarea aria-label="Resolution rules" required maxLength={2048} rows={6} value={rules} onChange={e => setRules(e.target.value)} placeholder="Define the exact event, cutoff, evidence hierarchy and INVALID conditions." /></label>
        <label>Primary resolution source<input aria-label="Primary resolution source" required maxLength={512} value={primarySource} onChange={e => setPrimarySource(e.target.value)} placeholder="https://official-source.example/result" /></label>
        <label>Secondary source · optional<input maxLength={512} value={secondarySource} onChange={e => setSecondarySource(e.target.value)} placeholder="https://independent-source.example/result" /></label>
        <label>Metadata URI · optional<input maxLength={512} value={metadataURI} onChange={e => setMetadataURI(e.target.value)} placeholder="ipfs://…" /></label>
        {ambiguous && <div className="notice warning" role="alert"><AlertTriangle size={17} /><span>This question or its rules may be ambiguous. Define measurable terms, a precise cutoff and what happens if sources disagree or disappear.</span></div>}
      </>}

      <div className="form-section-title"><span>02</span><h2>Set the timeline</h2></div>
      <div className="form-columns"><label>Trading closes<input required type="datetime-local" value={closes} onChange={e => setCloses(e.target.value)} /></label><label>Resolution date<input required type="datetime-local" value={resolves} onChange={e => setResolves(e.target.value)} /></label></div>
      <small>Times are shown locally and committed onchain as exact UTC timestamps.</small>

      <div className="form-section-title"><span>03</span><h2>Review immutable terms</h2></div>
      {marketType === 'auto' && <><label>Market question<textarea value={autoPreview?.question || 'Enter a valid threshold and timeline to preview the canonical question.'} readOnly rows={3} /></label><label>Exact resolution rules<textarea value={autoPreview?.rules || 'The historical Uniswap V3 TWAP must cover the fixed interval ending at the resolution timestamp.'} readOnly rows={5} /></label>{autoPreview && <a className="small" href={autoPreview.primarySource} target="_blank" rel="noreferrer">View canonical pool ↗</a>}</>}
      <label>Creator wallet<input readOnly value={wallet.account || 'Connect your wallet'} /></label>
      <label className="checkbox"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} /><span>I understand these terms and source commitments cannot be edited, the listing fee is non-refundable, liquidity requires matching traders, and event proposals require a 25 USDG bond.</span></label>
      {error && <div className="notice danger" role="alert">{errorMessage(new Error(error))}</div>}{tx.feedback}
      <button className="button primary full" disabled={!protocol || (marketType === 'auto' ? !autoPreview : !eventComplete) || !accepted || tx.pending || (!!wallet.account && wallet.chainId !== CHAIN_ID)} type={wallet.account ? 'submit' : 'button'} onClick={wallet.account ? undefined : wallet.connect}>{tx.pending ? 'Waiting for confirmation…' : wallet.account ? 'Create market · 0.0006 ETH' : 'Connect wallet to create'}<ArrowRight size={16} /></button>
      {tx.confirmed && <button className="text-button full" type="button" onClick={() => navigate('/creator')}>View creator studio</button>}
    </form><aside><div className="panel fee-summary"><div className="summary-icon"><Plus size={24} /></div><h2>Your question.<br />An open market.</h2><p>No creator or protocol liquidity is required.</p><div className="fee-line"><span>One-time listing fee</span><strong>0.0006 ETH</strong></div><div className="fee-line"><span>Your share of matched trades</span><strong className="green">0.6%</strong></div><div className="fee-line"><span>Creator liquidity required</span><strong>$0</strong></div><hr /><p className="icon-copy"><Check size={17} />Listing fees go directly to the protocol treasury.</p><p className="icon-copy"><Check size={17} />Event bonds remain separate from trader collateral and fees.</p><p className="icon-copy"><LockKeyhole size={17} />Creators cannot edit rules, access backing or adjudicate disputes.</p></div><div className="aside-note"><ShieldCheck size={20} /><p>All resolution-critical terms are immutable from creation and have deterministic onchain hashes.</p></div></aside></div>
  </div>;
}
