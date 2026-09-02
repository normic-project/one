import { useMemo, useState } from 'react';
import { parseEther } from 'ethers';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, Plus } from 'lucide-react';
import { useProtocol } from '../lib/Protocol';
import { useWallet } from '../lib/Wallet';
import { CHAIN_ID } from '../lib/config';
import { StatusBanner, useTransaction } from '../components/Common';

const localDate = (offset: number) => { const d = new Date(Date.now() + offset); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const timestamp = (value: string) => Math.floor(new Date(value).getTime() / 1000);
const DEFAULT_YES_OUTCOME = 'The market question resolves affirmatively according to the specified resolution source.';
const DEFAULT_NO_OUTCOME = 'The market question resolves negatively according to the specified resolution source.';
const DEFAULT_RULES = 'Resolve YES if the specified resolution source confirms the condition described in the market question. Resolve NO if the source confirms the condition did not occur. Resolve INVALID if the outcome cannot be objectively determined from the specified source.';

export default function CreatePage() {
  const { protocol, refresh } = useProtocol();
  const wallet = useWallet();
  const navigate = useNavigate();
  const [question, setQuestion] = useState('');
  const [yesOutcome, setYesOutcome] = useState(DEFAULT_YES_OUTCOME);
  const [noOutcome, setNoOutcome] = useState(DEFAULT_NO_OUTCOME);
  const [category, setCategory] = useState('Other');
  const [rules, setRules] = useState(DEFAULT_RULES);
  const [primarySource, setPrimarySource] = useState('');
  const [secondarySource, setSecondarySource] = useState('');
  const [metadataURI, setMetadataURI] = useState('');
  const [closes, setCloses] = useState(localDate(86400000));
  const [resolves, setResolves] = useState(localDate(90000000));
  const tx = useTransaction(refresh);
  const complete = [question, yesOutcome, noOutcome, category, rules, primarySource, closes, resolves].every(Boolean);
  const now = Math.floor(Date.now() / 1000);
  const validTimeline = timestamp(closes) > now + 60 && timestamp(resolves) >= timestamp(closes) && timestamp(resolves) <= now + 365 * 86400;
  const ambiguous = useMemo(() => question.length > 0 &&
    (question.length < 20 || /\b(soon|likely|probably|best|successful|significant|major|good|bad)\b/i.test(question) || rules.length < 50),
  [question, rules]);

  async function submit() {
    if (!protocol || !complete || !validTimeline) return;
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
    <div className="page-heading"><span className="eyebrow">CREATOR STUDIO</span><h1>Turn any resolvable question into a market.</h1><p>Choose the question, timing and resolution source.</p></div><StatusBanner />
    <div className="create-layout"><form className="panel create-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <div className="form-section-title"><span>01</span><h2>Market details</h2><span className="badge">Event market</span></div>
      <label>Question<textarea aria-label="Question" required maxLength={280} rows={2} value={question} onChange={e => setQuestion(e.target.value)} placeholder="Will the named team win the 2027 tournament?" /></label>
      <label>Category<select aria-label="Category" value={category} onChange={e => setCategory(e.target.value)}>{['Crypto', 'Politics', 'Sports', 'Tech', 'Culture', 'Entertainment', 'World', 'Other'].map(value => <option key={value}>{value}</option>)}</select></label>
      <div className="form-columns"><label>Trading closes<input aria-label="Trading closes" required type="datetime-local" value={closes} onChange={e => setCloses(e.target.value)} /></label>
        <label>Resolution date<input aria-label="Resolution date" required type="datetime-local" value={resolves} onChange={e => setResolves(e.target.value)} /></label></div>
      <label>Resolution source<input aria-label="Resolution source" required maxLength={512} value={primarySource} onChange={e => setPrimarySource(e.target.value)} placeholder="https://official-source.example/result" /></label>
      {!validTimeline && <div className="notice danger" role="alert"><AlertTriangle size={17} /><span>Trading must close at least one minute from now. Resolution must be on or after close and within one year.</span></div>}
      {ambiguous && <div className="notice warning" role="alert"><AlertTriangle size={17} /><span>This question or its rules may be ambiguous. Define measurable terms, exact cutoffs and an evidence hierarchy before publishing.</span></div>}
      <details className="advanced-settings"><summary>Advanced resolution settings</summary><div className="advanced-settings-fields">
        <label>YES meaning<textarea aria-label="YES meaning" required maxLength={280} rows={2} value={yesOutcome} onChange={e => setYesOutcome(e.target.value)} /></label>
        <label>NO meaning<textarea aria-label="NO meaning" required maxLength={280} rows={2} value={noOutcome} onChange={e => setNoOutcome(e.target.value)} /></label>
        <label>Resolution rules<textarea aria-label="Resolution rules" required maxLength={2048} rows={5} value={rules} onChange={e => setRules(e.target.value)} /></label>
        <label>Secondary source · optional<input aria-label="Secondary source · optional" maxLength={512} value={secondarySource} onChange={e => setSecondarySource(e.target.value)} placeholder="https://independent-source.example/result" /></label>
        <label>Metadata URI · optional<input aria-label="Metadata URI · optional" maxLength={512} value={metadataURI} onChange={e => setMetadataURI(e.target.value)} placeholder="ipfs://…" /></label>
      </div></details>
      <p className="permanence-note">Market terms are permanent after creation.</p>
      {tx.feedback}<button className="button primary full" disabled={!protocol || !complete || !validTimeline || tx.pending || (!!wallet.account && wallet.chainId !== CHAIN_ID)} type={wallet.account ? 'submit' : 'button'} onClick={wallet.account ? undefined : wallet.connect}>{tx.pending ? 'Waiting for confirmation…' : wallet.account ? 'Create market' : 'Connect wallet to create'}<ArrowRight size={16} /></button>
    </form><aside><div className="panel fee-summary"><div className="summary-icon"><Plus size={24} /></div><h2>Create a market</h2><p>No liquidity deposit required.</p><div className="fee-line"><span>Listing fee</span><strong>0.0006 ETH</strong></div><div className="fee-line"><span>Creator fee share</span><strong className="green">0.6%</strong></div></div></aside></div>
  </div>;
}
