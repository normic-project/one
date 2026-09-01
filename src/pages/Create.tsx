import { useMemo, useState } from 'react';
import { parseEther } from 'ethers';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, LockKeyhole, Plus, ShieldCheck } from 'lucide-react';
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
  const tx = useTransaction(refresh);
  const complete = [question, yesOutcome, noOutcome, category, rules, primarySource, closes, resolves].every(Boolean);
  const ambiguous = useMemo(() => question.length > 0 &&
    (question.length < 20 || /\b(soon|likely|probably|best|successful|significant|major|good|bad)\b/i.test(question) || rules.length < 50),
  [question, rules]);

  async function submit() {
    if (!protocol || !complete) return;
    await tx.run(async update => {
      const contract = protocol.factory.connect(await wallet.signer());
      const value = { value: parseEther('0.0006') };
      const metadata = { question, yesOutcome, noOutcome, category, rules, primarySource, secondarySource, metadataURI };
      await contract.getFunction('createEventMarket').staticCall(timestamp(closes), timestamp(resolves), metadata, value);
      update('Confirm the 0.0006 ETH listing fee in your wallet…');
      const result = await contract.getFunction('createEventMarket')(timestamp(closes), timestamp(resolves), metadata, value);
      const receipt = await result.wait();
      const created = receipt.logs.map((log: { topics: readonly string[]; data: string }) => {
        try { return contract.interface.parseLog(log); } catch { return null; }
      }).find((log: { name?: string } | null) => log?.name === 'MarketCreated');
      if (created) setTimeout(() => navigate(`/market/${created.args.market}`), 900);
      return result;
    });
  }

  return <div className="page"><Link className="back-link" to="/"><ArrowLeft size={15} />Explore markets</Link>
    <div className="page-heading"><span className="eyebrow">CREATOR STUDIO</span><h1>Turn any resolvable question into a market.</h1><p>Define immutable terms and sources. The configured Resolver Safe selects the final outcome after the resolution date.</p></div><StatusBanner />
    <div className="create-layout"><form className="panel create-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <div className="form-section-title"><span>01</span><h2>Question and outcomes</h2><span className="badge">General event market</span></div>
      <p className="muted">Questions may cover any lawful, objectively resolvable topic. Resolution follows only the immutable meanings, rules and sources below.</p>
      <label>Question<textarea aria-label="Event question" required maxLength={280} rows={3} value={question} onChange={e => setQuestion(e.target.value)} placeholder="Will the named team win the 2027 tournament?" /></label>
      <label>YES means<textarea required maxLength={280} rows={2} value={yesOutcome} onChange={e => setYesOutcome(e.target.value)} /></label>
      <label>NO means<textarea required maxLength={280} rows={2} value={noOutcome} onChange={e => setNoOutcome(e.target.value)} /></label>
      <label>Category<select value={category} onChange={e => setCategory(e.target.value)}>{['Crypto', 'Politics', 'Sports', 'Tech', 'Culture', 'Entertainment', 'World', 'Other'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Trading closes<input aria-label="Trading closes" required type="datetime-local" value={closes} onChange={e => setCloses(e.target.value)} /></label>
      <label>Resolution date<input aria-label="Resolution date" required type="datetime-local" value={resolves} onChange={e => setResolves(e.target.value)} /></label>
      <div className="form-section-title"><span>02</span><h2>Immutable resolution terms</h2><span className="badge">Resolver Safe</span></div>
      <label>Resolution rules<textarea aria-label="Resolution rules" required maxLength={2048} rows={6} value={rules} onChange={e => setRules(e.target.value)} placeholder="Define the exact event, cutoff, evidence hierarchy and INVALID conditions." /></label>
      <label>Primary resolution source<input aria-label="Primary resolution source" required maxLength={512} value={primarySource} onChange={e => setPrimarySource(e.target.value)} placeholder="https://official-source.example/result" /></label>
      <label>Secondary source · optional<input maxLength={512} value={secondarySource} onChange={e => setSecondarySource(e.target.value)} placeholder="https://independent-source.example/result" /></label>
      <label>Metadata URI · optional<input maxLength={512} value={metadataURI} onChange={e => setMetadataURI(e.target.value)} placeholder="ipfs://…" /></label>
      {ambiguous && <div className="notice warning" role="alert"><AlertTriangle size={17} /><span>This question or its rules may be ambiguous. Define measurable terms, exact cutoffs and an evidence hierarchy before publishing.</span></div>}
      <label className="checkbox"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} /><span>I understand these terms and source commitments cannot be edited, the listing fee is non-refundable, liquidity requires matching traders, and only the configured Resolver Safe can finalize after the resolution date.</span></label>
      {tx.feedback}<button className="button primary full" disabled={!protocol || !complete || !accepted || tx.pending || (!!wallet.account && wallet.chainId !== CHAIN_ID)} type={wallet.account ? 'submit' : 'button'} onClick={wallet.account ? undefined : wallet.connect}>{tx.pending ? 'Waiting for confirmation…' : wallet.account ? 'Create market · 0.0006 ETH' : 'Connect wallet to create'}<ArrowRight size={16} /></button>
    </form><aside><div className="panel fee-summary"><div className="summary-icon"><Plus size={24} /></div><h2>Your question.<br />An open market.</h2><p>No creator or protocol liquidity is required.</p><div className="fee-line"><span>One-time listing fee</span><strong>0.0006 ETH</strong></div><div className="fee-line"><span>Your share of matched trades</span><strong className="green">0.6%</strong></div><div className="fee-line"><span>Creator liquidity required</span><strong>$0</strong></div><hr /><p className="icon-copy"><Check size={17} />Listing fees go directly to the protocol treasury.</p><p className="icon-copy"><Check size={17} />Trading fees remain separate from collateral.</p><p className="icon-copy"><LockKeyhole size={17} />Creators cannot edit rules, access backing or select winners.</p></div><div className="aside-note"><ShieldCheck size={20} /><p>All resolution-critical terms are immutable from creation and have deterministic onchain hashes.</p></div></aside></div>
  </div>;
}
