import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { ArrowUpRight, BarChart3, ChevronDown, CircleHelp, Compass, Layers3, Plus, Search, ShieldCheck, Sparkles, TrendingUp, X } from 'lucide-react';
import { WalletButton } from './lib/Wallet';
import { useProtocol } from './lib/Protocol';
import { money } from './lib/chain';
import { EmptyState, MarketCard, StatusBanner } from './components/Common';
import MarketPage from './pages/Market';
import CreatePage from './pages/Create';
import PortfolioPage from './pages/Portfolio';
import CreatorPage from './pages/Creator';
import { useDialog } from './lib/useDialog';
import { SHOT_BUY_URL } from './lib/config';

function Logo() { return <Link className="logo" to="/" aria-label="One Shot home"><span className="logo-mark"><i /><i /></span>one<span className="logo-light">shot</span><span className="logo-dot">.</span></Link>; }
export default function App() {
  const [help, setHelp] = useState(false);
  const dialog = useDialog(help, () => setHelp(false));
  const location = useLocation();
  return <><header className="header"><div className="header-inner"><Logo /><nav aria-label="Main navigation">
    <NavLink to="/" end><Compass size={17} />Explore</NavLink><NavLink to="/portfolio"><Layers3 size={17} />Portfolio</NavLink><NavLink to="/creator"><BarChart3 size={17} />Creator studio</NavLink></nav>
    <div className="header-actions">{SHOT_BUY_URL
      ? <a className="button shot-buy" href={SHOT_BUY_URL} target="_blank" rel="noopener noreferrer">Buy $SHOT <ArrowUpRight size={14} /></a>
      : <button className="button shot-buy" type="button" disabled>Buy $SHOT <ArrowUpRight size={14} /></button>}
      <WalletButton /></div></div></header>
    <main key={location.pathname} className="main"><Routes><Route path="/" element={<Home />} /><Route path="/market/:address" element={<MarketPage />} />
      <Route path="/create" element={<CreatePage />} /><Route path="/portfolio" element={<PortfolioPage />} /><Route path="/creator" element={<CreatorPage />} />
      <Route path="*" element={<EmptyState title="This page is off the board." action={<Link className="button primary" to="/">Explore markets</Link>}>The page you’re looking for doesn’t exist.</EmptyState>} /></Routes></main>
    <footer><div className="footer-top"><Logo /><span>Conviction, considered.</span><button className="text-button" onClick={() => setHelp(true)}><CircleHelp size={15} />How it works</button></div>
      <div className="footer-bottom"><span>Independent market protocol.</span><span>Trading involves risk. Shares can lose their entire value. No guaranteed exits.</span></div></footer>
    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><section ref={dialog} className="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={e => e.stopPropagation()}><button className="icon-button close" aria-label="Close help" onClick={() => setHelp(false)}><X size={20} /></button><span className="eyebrow">THE MECHANICS</span><h2 id="help-title">Two sides. Fully backed.</h2><ol><li><b>Choose your side.</b> Place a limit order in USDG. Unmatched orders stay open and cancellable.</li><li><b>Meet the other side.</b> A 60¢ YES buyer and a 40¢ NO buyer jointly lock exactly 1 USDG.</li><li><b>Follow immutable resolution.</b> After the stated date, the configured Resolver Safe selects YES, NO or INVALID under the market's immutable rules.</li></ol><div className="notice">Buyers pay a separate 1% trading fee: 0.4% to the treasury, 0.6% to the creator. INVALID outcomes pay 0.5 USDG per YES or NO share.</div><p>No market maker. No guaranteed liquidity. Verify every question, rule and source before trading.</p></section></div>}
  </>;
}

function Home() {
  const { markets, categories: availableCategories, total, loading, configured, loadMore, queryMarkets } = useProtocol();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('Trending');
  const [status, setStatus] = useState('All markets');
  const [category, setCategory] = useState('All categories');
  const categories = ['All categories', ...availableCategories];
  useEffect(() => {
    const timer = window.setTimeout(() => void queryMarkets({
      sort: filter === 'Newest' ? 'newest' : filter === 'Closing soon' ? 'closing' : 'trending',
      ...(query.trim() ? { search: query.trim() } : {}),
      ...(category !== 'All categories' ? { category } : {}),
      ...(status === 'Resolved' ? { status: 'resolved' } : status === 'Open / pending' ? { status: 'open' } : {})
    }), 250);
    return () => window.clearTimeout(timer);
  }, [filter, status, category, query, queryMarkets]);
  return <><section className="hero"><div className="hero-copy"><div className="hero-tag"><span className="tiny-dot" />THE MARKETPLACE FOR CONVICTION</div>
    <h1>A market for<br />your <span>conviction.</span></h1><p>See what’s next. Take a position.<br />Trade real outcomes, with real skin in the game.</p>
    <div className="hero-buttons"><Link className="button primary" to="/create">Create a market <Plus size={16} /></Link></div>
    <div className="hero-assurance"><ShieldCheck size={15} />Fully collateralized <span />No house liquidity <span />Transparent terms</div></div>
    <div className="hero-visual" aria-label="Matching illustration: 60 cents YES plus 40 cents NO backs one dollar of collateral"><div className="visual-grid" /><div className="orb orb-one" /><div className="orb orb-two" />
      <div className="illustration-caption"><span className="tiny-dot" />HOW MATCHING WORKS</div>
      <div className="floating-card no-card"><span className="mini-label">THE OTHER SIDE</span><strong>No<span>40¢</span></strong><div className="mini-bars"><i /><i /><i /><i /><i /><i /></div><span className="mini-bottom">A different perspective.</span></div>
      <div className="floating-card yes-card"><div className="mini-label">YOUR CONVICTION <TrendingUp size={16} /></div><strong>Yes<span>60¢</span></strong><svg viewBox="0 0 220 58" aria-hidden="true"><path d="M0 52 20 43 38 47 58 31 78 35 99 24 119 32 142 13 162 20 186 8 208 15 220 3" /></svg><span className="mini-bottom"><i />Backed by matched demand.</span></div>
      <div className="collateral-pill"><ShieldCheck size={18} /><span>1 YES + 1 NO = <b>1 USDG locked</b></span></div>
    </div></section>
    <div className="overview-strip"><div><span className="stat-icon"><BarChart3 size={18} /></span><div><small>Loaded market volume</small><strong>${money(markets.reduce((v, m) => v + m.volume, 0n))}<span>USDG</span></strong></div></div>
      <div><span className="stat-icon"><Compass size={18} /></span><div><small>Markets on the protocol</small><strong>{configured ? total : '—'}<span>{configured ? 'all markets' : 'awaiting deployment'}</span></strong></div></div>
      <div><span className="stat-icon"><ShieldCheck size={18} /></span><div><small>Collateral model</small><strong>100%<span>trader funded</span></strong></div></div>
      <div className="strip-note"><Sparkles size={17} /><span>Have a different view?<br /><Link to="/create">Make a market for it <ArrowUpRight size={13} /></Link></span></div></div>
    <section className="markets-section" id="markets"><div className="section-heading"><div><span className="eyebrow">FIND YOUR EDGE</span><h2>What happens next?</h2></div><label className="search"><Search size={17} /><input aria-label="Search markets" placeholder="Search markets" value={query} onChange={e => setQuery(e.target.value)} /><kbd>/</kbd></label></div>
      <div className="market-controls"><div className="tabs">{['Trending', 'Newest', 'Closing soon'].map(tab => <button className={filter === tab ? 'active' : ''} key={tab} onClick={() => setFilter(tab)}>{tab === 'Trending' && <TrendingUp size={15} />}{tab}</button>)}</div><div className="filter-group"><label className="select-wrap"><select aria-label="Market category" value={category} onChange={e => setCategory(e.target.value)}>{categories.map(value => <option key={value}>{value}</option>)}</select><ChevronDown size={14} /></label><label className="select-wrap"><select aria-label="Market status" value={status} onChange={e => setStatus(e.target.value)}><option>All markets</option><option>Open / pending</option><option>Resolved</option></select><ChevronDown size={14} /></label></div></div>
      <StatusBanner />{loading && !markets.length ? <div className="skeleton-grid" aria-label="Loading markets">{[1, 2, 3].map(i => <div className="skeleton" key={i} />)}</div> : markets.length ? <div className="market-grid">{markets.map(m => <MarketCard key={m.address} market={m} />)}</div> :
        <EmptyState title={query ? 'No markets match your search.' : 'The next market starts with you.'} action={<Link className="button secondary" to="/create">Create the first market <Plus size={15} /></Link>}>{query ? 'Try a different asset or clear your filters.' : 'No live markets to show yet. Every market starts with a question—and fills only when traders take both sides.'}</EmptyState>}
      {markets.length < total && <button className="button secondary load-more" disabled={loading} onClick={() => void loadMore()}>{loading ? 'Loading…' : 'Load more markets'}</button>}
      {markets.length > 0 && <p className="muted small">Showing {markets.length} of {total} markets. Sorting applies to loaded markets. Prices reflect the last matched trade, not a guaranteed executable quote.</p>}
    </section>
    <section className="principles"><article><span>01</span><h3>Conviction meets a counterparty.</h3><p>No house, no hidden liquidity. Your order fills when another trader takes the other side.</p></article><article><span>02</span><h3>Every outcome is fully backed.</h3><p>One USDG backs each matched YES/NO pair. Trading fees remain separate.</p></article><article><span>03</span><h3>Rules set. Safe settles.</h3><p>The Resolver Safe selects one final outcome after the resolution date. Creators cannot select winners.</p></article></section>
  </>;
}
