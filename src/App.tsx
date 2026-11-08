import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, Check, ChevronDown, CircleHelp, Clock3, Code2, Compass, Database, FileText, Fingerprint, Globe2, History, Layers3, LayoutDashboard, LockKeyhole, Menu, Moon, Search, Settings2, Shield, ShieldCheck, SlidersHorizontal, Sparkles, Sun, X, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cancelSearch, isNative, openSource, saveReport, search } from './bridge';
import { csvReport, detectQuery, safeSourceUrl, statusLabels } from './models';
import type { Finding, SearchMode } from './models';

type Page = 'dashboard' | 'results' | 'exposure' | 'history' | 'reports' | 'settings';
const navigation: { id: Page; label: string; icon: LucideIcon }[] = [
  { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
  { id: 'results', label: 'Search results', icon: Compass },
  { id: 'exposure', label: 'Exposure', icon: Shield },
  { id: 'history', label: 'Local history', icon: History },
  { id: 'reports', label: 'Reports', icon: FileText },
];
const modes: { id: SearchMode; label: string; detail: string; icon: LucideIcon }[] = [
  { id: 'quick', label: 'Quick search', detail: 'A focused first look', icon: Zap },
  { id: 'deep', label: 'Deep search', detail: 'Explore supported sources', icon: Layers3 },
  { id: 'comprehensive', label: 'Comprehensive', detail: 'Every available connector', icon: Sparkles },
];
function initialTheme(): 'dark' | 'light' {
  try { return localStorage.getItem('nexonic.theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [theme, setTheme] = useState(initialTheme);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('quick');
  const [findings, setFindings] = useState<Finding[]>([]);
  const [running, setRunning] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [canceled, setCanceled] = useState(false);
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('website');
  const [timeout, setTimeout] = useState(12);
  const [redact, setRedact] = useState(false);
  const [help, setHelp] = useState(false);
  const [activeQuery, setActiveQuery] = useState('');
  const activeJob = useRef<string | null>(null);
  const queryInput = useRef<HTMLInputElement>(null);
  const helpDialog = useRef<HTMLDivElement>(null);
  const focusReturn = useRef<HTMLElement | null>(null);
  const sidebar = useRef<HTMLElement>(null);
  const kind = detectQuery(query);
  const confirmed = findings.filter(f => f.status === 'confirmed').length;
  const blocked = findings.filter(f => f.status === 'blocked').length;
  const inconclusive = findings.filter(f => f.status === 'inconclusive').length;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('nexonic.theme', theme); } catch { /* Appearance remains session-only when storage is unavailable. */ }
  }, [theme]);
  useEffect(() => {
    if (!help && !mobileMenu) return;
    const previous = focusReturn.current;
    const container = help ? helpDialog.current : sidebar.current;
    if (!container) return;
    const controls = () => Array.from(container.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select, [tabindex="0"]')).filter(element => element.getClientRects().length > 0);
    controls()[0]?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const elements = controls();
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', trapFocus);
    return () => { document.removeEventListener('keydown', trapFocus); previous?.focus(); };
  }, [help, mobileMenu]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault(); setPage('dashboard'); window.setTimeout(() => queryInput.current?.focus(), 0);
      }
      if (event.key === 'Escape') { setHelp(false); setMobileMenu(false); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  function navigate(next: Page) { setPage(next); setMobileMenu(false); setNotice(''); }
  async function startSearch(event: React.FormEvent) {
    event.preventDefault();
    if (activeJob.current) return;
    if (kind === 'empty' || kind === 'invalid') { setNotice('Enter a valid username or email address. Usernames may contain letters, numbers, underscores, and hyphens.'); return; }
    if (kind === 'email') { setNotice('Email discovery needs an authorized search provider. No provider is connected, so no requests have been made. Username discovery is available in the desktop app.'); return; }
    if (!isNative()) { setNotice('You’re viewing the interface preview. Live discovery is available in the desktop app; no search requests were made.'); return; }
    const jobId = crypto.randomUUID();
    activeJob.current = jobId;
    setRunning(true); setCanceling(false); setCompleted(false); setCanceled(false); setFindings([]); setNotice(''); setActiveQuery(query.trim());
    try {
      const result = await search(jobId, query.trim(), mode, timeout, update => {
        if (activeJob.current === update.jobId) setFindings(previous => [...previous.filter(f => f.site !== update.finding.site), update.finding]);
      });
      setFindings(result.findings); setCanceled(result.canceled); setCompleted(true);
    } catch (error) {
      setNotice(typeof error === 'string' ? error : error instanceof Error ? error.message : 'The search could not finish. Please try again.');
    } finally { activeJob.current = null; setRunning(false); setCanceling(false); }
  }
  async function cancel() {
    if (!activeJob.current) return;
    setCanceling(true);
    try { await cancelSearch(activeJob.current); } catch { setNotice('Cancellation could not be delivered. Requests will still time out.'); setCanceling(false); }
  }
  async function exportReport(format: 'json' | 'csv') {
    if (!findings.length) return;
    const output = format === 'csv' ? csvReport(findings, redact) : JSON.stringify({ application: 'Nexonic Trace', version: '0.1.0', generatedAt: new Date().toISOString(), query: redact ? '[redacted]' : activeQuery, canceled, ownership: 'Account existence does not establish identity ownership.', findings: findings.map(f => redact ? { ...f, url: '[redacted]', evidence: ['[redacted]'] } : f) }, null, 2);
    if (isNative()) {
      try { const saved = await saveReport(format, output); if (saved) setNotice('Report saved to your chosen location.'); }
      catch (error) { setNotice(typeof error === 'string' ? error : 'The report could not be saved.'); }
      return;
    }
    const url = URL.createObjectURL(new Blob([output], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `NexonicTrace-Report.${format}`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function deleteAll() {
    setFindings([]); setQuery(''); setActiveQuery(''); setCompleted(false); setCanceled(false); setTheme('dark'); setTimeout(12); setRedact(false);
    try { localStorage.removeItem('nexonic.theme'); } catch { /* No persistent storage to clear. */ }
    setNotice('Session results and saved appearance have been cleared. Search history and credentials have not been stored.');
  }
  const filtered = findings.filter(f => filter === 'all' || f.status === filter).sort((a, b) => sort === 'status' ? a.status.localeCompare(b.status) : a.site.localeCompare(b.site));

  const resultsPanel = <section className="panel results-panel" aria-label="Search results">
    <div className="panel-heading"><div><h2>Search results <span className="count">{findings.length}</span></h2><p>{activeQuery ? `Public source checks for ${activeQuery}` : 'Evidence, with every finding.'}</p></div><div className="result-tools">
      <label className="select-label"><SlidersHorizontal size={14}/><span className="sr-only">Filter results</span><select aria-label="Filter results" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All results</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <select aria-label="Sort results" value={sort} onChange={e => setSort(e.target.value)}><option value="website">Website A–Z</option><option value="status">Verification status</option></select>
    </div></div>
    {running && <div className="progress-area"><div className="progress-copy"><span><span className="live-dot"/> Checking public sources</span><button className="text-button" disabled={canceling} onClick={cancel}>{canceling ? 'Canceling…' : 'Cancel search'}</button></div><progress max={2} value={findings.length}/><small>{findings.length} of 2 sources checked · {confirmed} confirmed · {inconclusive} inconclusive · {blocked} blocked</small></div>}
    {completed && <div className="completion"><Check size={15}/>{canceled ? 'Search canceled. Partial results are shown.' : `Search complete. ${findings.length} of 2 sources checked.`}</div>}
    {!findings.length ? <div className="empty-state"><div className="empty-icon"><Fingerprint size={30} strokeWidth={1.3}/></div><h3>{running ? 'Following the public signals' : 'Your next discovery starts here'}</h3><p>{running ? 'Findings will appear as each source responds.' : 'Run a username search to see verified public profiles, source links, and the evidence behind each result.'}</p><span className="subtle-label"><ShieldCheck size={13}/> No generated or sample findings</span></div> : filtered.length === 0 ? <div className="empty-state"><h3>No results match this filter</h3><button className="text-button" onClick={() => setFilter('all')}>Show all results</button></div> : <div className="finding-list">{filtered.map(f => <article className="finding" key={f.site}><div className="site-monogram">{f.site === 'GitHub' ? <Code2 size={21}/> : 'DEV'}</div><div className="finding-body"><div className="finding-title"><h3>{f.site}</h3><span className={`badge ${f.status}`}>{statusLabels[f.status]}</span></div><p>{f.category} <span>·</span> {new Date(f.checkedAt).toLocaleString()}</p><details><summary>View verification evidence</summary><ul>{f.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul><p>Account existence does not establish who owns the account.</p></details></div>{safeSourceUrl(f.url) && <a className="source-link" href={f.url} onClick={event => { if (isNative()) { event.preventDefault(); void openSource(f.url).catch(() => setNotice('The source could not be opened.')); } }} target="_blank" rel="noopener noreferrer" aria-label={`Open ${f.site} source`}>Source <ArrowUpRight size={15}/></a>}</article>)}</div>}
    <div className="panel-footnote"><ShieldCheck size={14}/><span>A matching username is a lead, not proof of identity.</span></div>
  </section>;

  return <div className="app-shell">
    <a className="skip-link" href="#main">Skip to content</a>
    {mobileMenu && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileMenu(false)}/>}
    <aside ref={sidebar} inert={help} className={`sidebar ${mobileMenu ? 'open' : ''}`} aria-label="Main navigation">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); navigate('dashboard'); }}><img src="/mark.svg" width="39" height="39" alt=""/><span>NEXONIC <b>TRACE</b><small>BY NEXONIC TECHNOLOGIES</small></span></a>
      <div className="workspace-label">WORKSPACE <span>LOCAL</span></div>
      <nav>{navigation.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} aria-current={page === id ? 'page' : undefined} onClick={() => navigate(id)}><Icon size={18} strokeWidth={1.7}/><span>{label}</span>{id === 'results' && findings.length > 0 && <span className="nav-count">{findings.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="privacy-card"><div><ShieldCheck size={19}/><span>Private by design</span></div><p>No account. No analytics.<br/>Your searches stay yours.</p><span className="privacy-indicator"><i/> Local workspace</span></div><button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')} aria-current={page === 'settings' ? 'page' : undefined}><Settings2 size={18}/><span>Settings</span></button><button className="nav-item" onClick={event => { focusReturn.current = event.currentTarget; setHelp(true); }}><CircleHelp size={18}/><span>About & help</span><ArrowUpRight size={14}/></button><div className="sidebar-version"><span>Nexonic Trace</span><span>v0.1.0 <i>DEV</i></span></div></div>
    </aside>
    <div className="main-wrap" inert={mobileMenu || help}><header className="topbar"><div className="breadcrumb"><button className="icon-button menu-button" aria-label="Open navigation" aria-expanded={mobileMenu} onClick={event => { focusReturn.current = event.currentTarget; setMobileMenu(true); }}><Menu size={21}/></button><span>Workspace</span><span className="slash">/</span><strong>{page === 'settings' ? 'Settings' : navigation.find(n => n.id === page)?.label}</strong></div><div className="topbar-actions"><span className="environment"><i/>{isNative() ? 'Desktop workspace' : 'Interface preview'}</span><span className="topbar-divider"/><button className="icon-button" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={18}/> : <Moon size={18}/>}</button><button className="icon-button" aria-label="About Nexonic Trace" onClick={event => { focusReturn.current = event.currentTarget; setHelp(true); }}><CircleHelp size={18}/></button></div></header>
    <main id="main"><div className="page-heading"><div><div className="eyebrow"><span/> YOUR PUBLIC PRESENCE, IN FOCUS</div><h1>{page === 'dashboard' ? 'Discover your digital footprint.' : page === 'results' ? 'Follow the evidence.' : page === 'exposure' ? 'Understand your exposure.' : page === 'history' ? 'Your searches, on your terms.' : page === 'reports' ? 'Take your findings with you.' : 'Make this workspace yours.'}</h1><p>{page === 'dashboard' ? 'Explore public profiles. Understand what’s visible. Take back control.' : page === 'results' ? 'Review source checks and the evidence behind each classification.' : page === 'settings' ? 'Simple controls. Clear boundaries. Privacy comes first.' : 'Built around public evidence and your privacy.'}</p></div><span className="version-pill">EARLY DEVELOPMENT</span></div>
      {notice && <div className="notice" role="status"><CircleHelp size={18}/><p>{notice}</p><button className="icon-button" aria-label="Dismiss notice" onClick={() => setNotice('')}><X size={17}/></button></div>}
      {page === 'dashboard' && <>
        <section className="search-card"><div className="search-card-top"><span className="section-kicker"><Search size={15}/> NEW DISCOVERY</span><span className="private-label"><LockKeyhole size={12}/> No account required</span></div><div className="search-intro"><h2>Start with a single clue.</h2><p>A username can tell you where your public footprint begins.</p></div><form onSubmit={startSearch}><label className="sr-only" htmlFor="query">Username or email address</label><div className="search-input-wrap"><Search size={21}/><input ref={queryInput} id="query" placeholder="Enter a username or email address" value={query} onChange={e => setQuery(e.target.value)} maxLength={254} autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={running}/><span className="query-kind">{kind === 'empty' ? <kbd>⌘ K</kbd> : kind === 'invalid' ? 'Check format' : kind}</span></div><div className="search-modes" role="radiogroup" aria-label="Search depth">{modes.map(({ id, label, detail, icon: Icon }) => <label key={id} className={`mode-card ${mode === id ? 'selected' : ''}`}><input type="radio" name="mode" value={id} checked={mode === id} onChange={() => setMode(id)} disabled={running}/><Icon size={19}/><span><strong>{label}</strong><small>{detail}</small></span><span className="radio-mark">{mode === id && <span/>}</span></label>)}</div><div className="search-card-bottom"><span><ShieldCheck size={14}/> Public sources only. Evidence always.</span><button className="primary-button" type="submit" disabled={running}>{running ? 'Searching…' : 'Start discovery'}<ArrowRight size={17}/></button></div></form></section>
        <div className="stat-grid">{[{ label: 'Available sources', value: '02', icon: Globe2, note: 'Initial connector collection' }, { label: 'Profiles confirmed', value: String(confirmed).padStart(2, '0'), icon: Fingerprint, note: 'Evidence-backed existence' }, { label: 'Sources checked', value: String(findings.length).padStart(2, '0'), icon: Activity, note: 'In your current session' }, { label: 'Stored searches', value: '00', icon: Database, note: 'History storage is not enabled' }].map(({ label, value, icon: Icon, note }) => <div className="stat-card" key={label}><div><span>{label}</span><Icon size={16}/></div><strong>{value}</strong><small>{note}</small></div>)}</div>
        <div className="dashboard-columns"><div>{resultsPanel}</div><div className="right-column"><section className="panel coverage"><div className="panel-heading"><div><h2>Source coverage</h2><p>Small collection. Clear boundaries.</p></div><Globe2 size={19}/></div><div className="coverage-map" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="orbit orbit-three"/><div className="orbit-line"/><span className="orbit-center"><Fingerprint size={30}/></span><span className="orbit-dot dot-one"/><span className="orbit-dot dot-two"/><span className="orbit-dot dot-three"/></div><div className="coverage-row"><span><Code2 size={16}/> Developer communities</span><b>2 sources</b></div><div className="source-chips"><span>GitHub</span><span>DEV Community</span></div><p className="coverage-note">All search modes currently use the same two sources. Broader coverage will follow connector validation.</p><button className="panel-link" onClick={() => navigate('settings')}>Search configuration <ArrowRight size={14}/></button></section><section className="tip-card"><ShieldCheck size={21}/><h3>A footprint isn’t an identity.</h3><p>A profile with the same username may belong to someone else. Review the original source before drawing conclusions.</p><button className="text-button" onClick={event => { focusReturn.current = event.currentTarget; setHelp(true); }}>How verification works <ArrowUpRight size={13}/></button></section></div></div>
      </>}
      {page === 'results' && resultsPanel}
      {page === 'exposure' && <div className="feature-grid">{[{ icon: LockKeyhole, title: 'Password exposure', description: 'A separate, explicit check using the Pwned Passwords hash-prefix API. Password checking is not connected in this build.' }, { icon: Shield, title: 'Email breach intelligence', description: 'Authorized breach information needs a supported provider and appropriate credentials. No provider is connected.' }, { icon: Fingerprint, title: 'Public information', description: 'Evidence-backed associations require independent verification. This build does not combine profiles into an identity.' }].map(({ icon: Icon, title, description }) => <section className="panel feature-card" key={title}><Icon size={25}/><span className="coming-label">NOT CONNECTED</span><h2>{title}</h2><p>{description}</p></section>)}</div>}
      {page === 'history' && <section className="panel"><div className="panel-heading"><div><h2>Local search history</h2><p>History is optional and off by default.</p></div><History size={20}/></div><div className="empty-state"><div className="empty-icon"><Clock3 size={28}/></div><h3>No saved searches</h3><p>Search results stay in memory for this session. Local database storage and search comparisons are planned for a later milestone.</p><button className="secondary-button" onClick={() => navigate('dashboard')}>Start a search <ArrowRight size={15}/></button></div></section>}
      {page === 'reports' && <section className="panel"><div className="panel-heading"><div><h2>Export current results</h2><p>Reports contain actual source checks from this session.</p></div><ArrowDownToLine size={20}/></div><div className="report-content"><div className="report-summary"><FileText size={30}/><div><h3>{findings.length} source checks available</h3><p>{findings.length ? 'Includes verification status, source links, evidence, and timestamps.' : 'Run a desktop search before creating a report.'}</p></div></div><label className="toggle-row"><span><strong>Redact sensitive details</strong><small>Remove the query, profile URLs, and evidence text.</small></span><input type="checkbox" checked={redact} onChange={e => setRedact(e.target.checked)}/></label><div className="export-buttons"><button className="primary-button" onClick={() => exportReport('json')} disabled={!findings.length || running}>Export JSON <ArrowDownToLine size={16}/></button><button className="secondary-button" onClick={() => exportReport('csv')} disabled={!findings.length || running}>Export CSV <ArrowDownToLine size={16}/></button></div><p className="muted">PDF and HTML exports will be available in a later milestone.</p></div></section>}
      {page === 'settings' && <div className="settings-stack"><section className="panel"><div className="panel-heading"><div><h2>Appearance</h2><p>Choose your preferred workspace theme.</p></div><Sun size={19}/></div><div className="settings-body"><div className="theme-options">{(['dark', 'light'] as const).map(value => <button key={value} aria-pressed={theme === value} onClick={() => setTheme(value)} className={`theme-option ${theme === value ? 'selected' : ''}`}>{value === 'dark' ? <Moon size={20}/> : <Sun size={20}/>}<span>{value === 'dark' ? 'Dark' : 'Light'}</span>{theme === value && <Check size={16}/>}</button>)}</div></div></section><section className="panel"><div className="panel-heading"><div><h2>Search & network</h2><p>Requests use HTTPS and respect source access restrictions.</p></div><Settings2 size={19}/></div><div className="settings-body"><label className="setting-row"><span><strong>Request timeout</strong><small>Maximum wait for each source. Applies to the next search.</small></span><span className="timeout-control"><select value={timeout} onChange={e => setTimeout(Number(e.target.value))} aria-label="Request timeout"><option value={8}>8 seconds</option><option value={12}>12 seconds</option><option value={20}>20 seconds</option></select><ChevronDown size={14}/></span></label><div className="setting-row"><span><strong>Connector collection</strong><small>Version 1 · GitHub and DEV Community · preliminary validation</small></span><span className="badge">2 sources</span></div><div className="setting-row"><span><strong>Optional API providers</strong><small>Not connected. This build never requests or stores API keys.</small></span><LockKeyhole size={17}/></div></div></section><section className="panel"><div className="panel-heading"><div><h2>Data & privacy</h2><p>No analytics, account, or Nexonic hosted service.</p></div><ShieldCheck size={19}/></div><div className="settings-body"><div className="setting-row"><span><strong>Local history</strong><small>Off · database storage is not enabled in this build.</small></span><span className="badge">Session only</span></div><div className="setting-row"><span><strong>Delete all data</strong><small>Clear session results and your saved appearance preference.</small></span><button className="danger-button" onClick={deleteAll} disabled={running}>Delete all data</button></div></div></section></div>}
      <footer className="page-footer"><span><LockKeyhole size={12}/> Built for your privacy. By Nexonic Technologies.</span><span>Public evidence. Informed decisions.</span></footer>
    </main></div>
    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><div ref={helpDialog} className="modal panel" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={e => e.stopPropagation()}><button className="icon-button modal-close" aria-label="Close help" onClick={() => setHelp(false)}><X size={20}/></button><img src="/mark.svg" width="48" height="48" alt=""/><h2 id="help-title">Nexonic Trace</h2><p>Discover Your Digital Footprint.</p><p>Source checks verify public account existence using structured profile data. An HTTP success code alone is never sufficient. Matching usernames do not establish identity ownership.</p><p>This development build supports two initial username connectors in the native app. Browser preview does not perform live discovery. Email, password checks, and saved history are not connected.</p><p className="muted">v0.1.0 · By Nexonic Technologies</p><button className="primary-button" onClick={() => setHelp(false)}>Got it <Check size={16}/></button></div></div>}
  </div>;
}
