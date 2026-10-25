'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Inbox, Layers3, Library, ReceiptText, Check, ArrowRight, ShieldCheck, CircleHelp } from 'lucide-react';
import { createLibraryScenario, REQUEST_LIBRARY, libraryEntry, DRAFT_KEY, readPrivateDraft } from '@/lib/request-library';
import type { LibraryId, PrivateDraft } from '@/lib/request-library';
import { summarizeRequests, assessRequest, isIsoDate } from '@/lib/batch-domain';
import type { SourceRequest, AnalyzedRequest, BatchPolicy, FrozenBatch } from '@/lib/batch-domain';
import type { LocalAIProgress } from '@/lib/local-ai';
import { LOCAL_MODEL } from '@/lib/local-model';

type Screen = 'desk' | 'batches' | 'payments' | 'library' | 'guide';
type Config = { ai: boolean; paypal: boolean; storage: boolean };
type SavedBatch = { proposal: FrozenBatch; status: string; authorizedUnits: number; capturedCents: number };
type ApiPayload = { batches?: SavedBatch[]; status?: string; requests?: AnalyzedRequest[]; error?: string; issues?: {message: string}[]; acquired?: boolean };
const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(cents / 100);

function Glyph({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <span className={`glyph ${className}`} aria-hidden="true">{children || <ShieldCheck size={24} strokeWidth={1.5} />}</span>;
}
function Action({ children, onClick, secondary, disabled, type = 'button', className = '' }: { children: React.ReactNode; onClick?: () => void; secondary?: boolean; disabled?: boolean; type?: 'button' | 'submit'; className?: string }) {
  return <button type={type} className={`action ${secondary ? 'paper' : 'cobalt'} ${className}`} onClick={onClick} disabled={disabled}>{children}</button>;
}
function Tag({ children, tone = '' }: { children: React.ReactNode; tone?: string }) { return <span className={`tag ${tone}`}>{children}</span>; }

export default function Studio() {
  const [libraryId, setLibraryId] = useState<LibraryId>('circle');
  const scenario = useMemo(() => createLibraryScenario(libraryId), [libraryId]);
  const collection = libraryEntry(libraryId);
  const drafts = useRef<Partial<Record<LibraryId, PrivateDraft>>>({});
  const [draftReady, setDraftReady] = useState(false);
  const [saveState, setSaveState] = useState('Draft stays in this tab');
  const [sort, setSort] = useState('name');
  const [collectionFilter, setCollectionFilter] = useState('all');
  const [collectionQuery, setCollectionQuery] = useState('');
  const [screen, setScreen] = useState<Screen>('desk');
  const [requests, setRequests] = useState<SourceRequest[]>(scenario.requests);
  const [analysis, setAnalysis] = useState<AnalyzedRequest[]>([]);
  const [analysisMode, setAnalysisMode] = useState<'none' | 'example' | 'local'>('none');
  const [policy, setPolicy] = useState<BatchPolicy>(scenario.policy);
  const [dispatchDate, setDispatchDate] = useState(scenario.policy.shipBy);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [newLabel, setNewLabel] = useState('Guest request');
  const [newText, setNewText] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<Config>({ ai: false, paypal: false, storage: false });
  const [batches, setBatches] = useState<SavedBatch[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [settlingId, setSettlingId] = useState('');
  const [aiProgress, setAiProgress] = useState<LocalAIProgress | null>(null);
  const [modelId, setModelId] = useState<string>(LOCAL_MODEL.id);
  const [aiHint, setAiHint] = useState(`About ${LOCAL_MODEL.estimatedDownloadMB / 1000} GB on first use · compatible desktop GPU required. No API key or inference fee.`);
  const aiController = useRef<AbortController | null>(null);
  const latestInput = useRef('');
  latestInput.current = JSON.stringify({ requests, policy });
  const summary = useMemo(() => summarizeRequests(analysis, policy), [analysis, policy]);
  const selectedSource = requests.find(r => r.id === selected);
  const selectedAnalysis = analysis.find(r => r.source.id === selected);
  const filtered = requests.filter(r => {
    const result = analysis.find(a => a.source.id === r.id);
    return (!query || `${r.customerLabel} ${r.body}`.toLowerCase().includes(query.toLowerCase())) && (filter === 'all' || result?.status === filter);
  }).sort((a, b) => sort === 'name' ? a.customerLabel.localeCompare(b.customerLabel) : sort === 'attention' ? (analysis.find(r => r.source.id === a.id)?.status === 'eligible' ? 1 : 0) - (analysis.find(r => r.source.id === b.id)?.status === 'eligible' ? 1 : 0) : Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
  const visibleBatches = batches.filter(batch => (!collectionQuery || batch.proposal.title.toLowerCase().includes(collectionQuery.toLowerCase())) && (collectionFilter === 'all' || (collectionFilter === 'open' ? batch.status === 'OPEN' : collectionFilter === 'complete' ? ['COMMITTED', 'CANCELLED'].includes(batch.status) : !['OPEN', 'COMMITTED', 'CANCELLED'].includes(batch.status))));
  const openCount = batches.filter(batch => batch.status === 'OPEN').length;
  const capturedTotal = batches.reduce((sum, batch) => sum + batch.capturedCents, 0);
  useEffect(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || '{}');
      for (const entry of REQUEST_LIBRARY) {
        const checked = readPrivateDraft(stored.drafts?.[entry.id]);
        if (checked && checked.id === entry.id) drafts.current[entry.id] = checked;
      }
      const active = drafts.current[stored.active as LibraryId];
      if (active) { setLibraryId(active.id); setRequests(active.requests); setPolicy({ ...createLibraryScenario(active.id).policy, shipBy: active.shipBy }); setDispatchDate(active.shipBy); setNotice('Draft restored from this tab. Run analysis again before approving a collection.'); }
    } catch { /* Invalid or unavailable browser storage never becomes trusted input. */ }
    setDraftReady(true);
  }, []);
  useEffect(() => {
    if (!draftReady) return;
    drafts.current[libraryId] = { id: libraryId, requests, shipBy: policy.shipBy, savedAt: new Date().toISOString() };
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ active: libraryId, drafts: drafts.current })); setSaveState('Draft saved in this tab'); }
    catch { setSaveState('Storage unavailable · download your proposal'); }
  }, [draftReady, libraryId, requests, policy.shipBy]);
  function switchScenario(id: LibraryId) {
    if (busy) return;
    const next = createLibraryScenario(id);
    const saved = drafts.current[id];
    setLibraryId(id); setRequests(saved?.requests ?? next.requests); setPolicy({ ...next.policy, shipBy: saved?.shipBy ?? next.policy.shipBy }); setDispatchDate(saved?.shipBy ?? next.policy.shipBy);
    setAnalysis([]); setAnalysisMode('none'); setSelected(null); setQuery(''); setFilter('all'); setScreen('desk'); setAiProgress(null); setConfirmed(false);
    setNotice(saved ? 'Your draft for this scenario is restored. Analyze the current wording before approval.' : 'New fictional request set loaded. Explore its evidence or run private AI.');
  }
  async function copyText(text: string, success: string) {
    try { await navigator.clipboard.writeText(text); setNotice(success); }
    catch { setNotice('Copy is unavailable in this browser. You can select the text and copy it manually.'); }
  }
  async function refresh() {
    try {
      const response = await fetch('/api/config');
      if (response.ok) setConfig(await response.json());
      const listed = await fetch('/api/batches');
      if (listed.ok) setBatches(((await listed.json()) as ApiPayload).batches || []);
    } catch { /* A connection message appears when an operation is requested. */ }
  }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => () => { aiController.current?.abort(); }, []);
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [screen]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 9000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') { setSelected(null); setAdding(false); setReviewing(false); } };
    window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close);
  }, []);
  useEffect(() => {
    if (!selected && !adding && !reviewing) return;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = [...document.querySelectorAll<HTMLElement>('.sidebar, .workspace')];
    background.forEach(element => { element.inert = true; });
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), [tabindex="0"]')];
    focusable()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const elements = focusable(); const first = elements[0]; const last = elements.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    dialog.addEventListener('keydown', trap);
    return () => {
      background.forEach(element => { element.inert = false; });
      dialog.removeEventListener('keydown', trap);
      if (previous?.isConnected && !dialog.contains(previous)) previous.focus();
      else document.querySelector<HTMLElement>('.wordmark')?.focus();
    };
  }, [selected, adding, reviewing]);
  function exampleAnalysis() {
    if (requests.length !== scenario.requests.length || requests.some((r, i) => r.id !== scenario.requests[i]?.id || r.customerLabel !== scenario.requests[i]?.customerLabel || r.body !== scenario.requests[i]?.body)) {
      setNotice('The illustrated analysis matches the original sample only. Run live analysis for edited requests, or restore the sample.'); return;
    }
    setAnalysis(scenario.analysis.map(a => assessRequest(a.source, a.extraction, policy)));
    setAnalysisMode('example'); setNotice('Illustrative analysis loaded. These are authored examples, not a live AI result.');
  }
  async function analyze() {
    const inputVersion = latestInput.current;
    const controller = new AbortController();
    aiController.current = controller;
    setBusy(true);
    try {
      const { analyzeLocalRequests } = await import('@/lib/local-ai');
      const data = await analyzeLocalRequests(requests, policy, { signal: controller.signal, onProgress: setAiProgress });
      if (inputVersion !== latestInput.current) { setNotice('The requests changed while analysis was running. Run it again for the current version.'); return; }
      if (data.status !== 'complete') throw new Error(data.issues[0]?.message || 'Local analysis could not complete. The illustrated example is still available.');
      setAnalysis(data.requests); setAnalysisMode('local'); setModelId(data.model);
      setAiHint(`Qwen3 ran on this device in ${Math.round((data.elapsedMs || 0) / 1000)} seconds, including loading. Your original requests stay in this browser.`);
      setNotice('Local analysis complete. Check the source evidence and any unresolved fields before approving a batch.');
    } catch (error) { const message = error instanceof Error ? error.message : 'Local analysis could not complete. Please try again.'; setNotice(message); setAiHint(message); }
    finally { aiController.current = null; setBusy(false); }
  }
  function addRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!newText.trim() || (!editingId && requests.length >= 24)) return;
    aiController.current?.abort();
    const fields = { customerLabel: newLabel.trim() || 'Guest request', body: newText.trim() };
    setRequests(editingId ? requests.map(request => request.id === editingId ? { ...request, ...fields } : request) : [...requests, { id: `request-${crypto.randomUUID()}`, ...fields, receivedAt: new Date().toISOString() }]);
    setAnalysis([]); setAnalysisMode('none'); setAdding(false); setNewText(''); setEditingId(null); setNotice(editingId ? 'Request updated. Analyze the current wording again before opening a batch.' : 'Request added. Run a new analysis to include it.');
  }
  function editRequest(source?: SourceRequest) {
    setEditingId(source?.id ?? null); setNewLabel(source?.customerLabel ?? 'Guest request'); setNewText(source?.body ?? ''); setSelected(null); setAdding(true);
  }
  function removeRequest(id: string) {
    aiController.current?.abort(); setRequests(requests.filter(request => request.id !== id)); setAnalysis([]); setAnalysisMode('none'); setSelected(null); setNotice('Request removed from this draft. Analyze the remaining requests again.');
  }
  function exportPlan() {
    const file = new Blob([JSON.stringify({ title: collection.collection, policy, requests, analysis, provenance: analysisMode, generatedAt: new Date().toISOString(), note: 'Proposal only. Demand is not a payment authorization.' }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(file); const link = document.createElement('a'); link.href = url; link.download = 'batchloom-proposal.json'; link.click(); URL.revokeObjectURL(url);
    setNotice('Proposal downloaded, with source evidence and analysis provenance.');
  }
  async function publishBatch() {
    if (!confirmed || !isIsoDate(dispatchDate) || dispatchDate !== policy.shipBy) return;
    setBusy(true);
    try {
      const proposal = analysisMode === 'local'
        ? { title: collection.collection, policy, makerApproved: true, provenance: 'local-model', reviewedPlan: { requestCount: requests.length, eligibleUnits: summary.eligibleUnits, eligibleRequestCount: summary.eligibleRequestCount, reviewCount: summary.reviewCount, conflictCount: summary.conflictCount, modelId } }
        : { title: collection.collection, policy, requests: analysis, makerApproved: true, provenance: 'example' };
      const response = await fetch('/api/batches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(proposal) });
      const data = await response.json() as ApiPayload; if (!response.ok) throw new Error(data.error || 'The batch could not be opened.');
      await refresh(); setReviewing(false); setScreen('batches'); setNotice('Sandbox batch opened. Buyers approve their own payment holds.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'The batch could not be opened.'); }
    finally { setBusy(false); }
  }
  async function settle(batch: SavedBatch) {
    setSettlingId(batch.proposal.id);
    try {
      const response = await fetch(`/api/batches/${batch.proposal.id}/settle`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: batch.proposal.version }) });
      const data = await response.json() as ApiPayload; if (!response.ok) throw new Error(data.error || 'Settlement needs review.');
      setNotice(data.acquired ? `Provider state checked: ${(data.status || 'unconfirmed').toLowerCase()}.` : 'A settlement is already in progress. Refresh shortly.'); await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Settlement could not be confirmed.'); }
    finally { setSettlingId(''); }
  }
  const nav = (id: Screen, label: string, mark: React.ReactNode, count?: number) => <button className={`nav-item ${screen === id ? 'active' : ''}`} onClick={() => setScreen(id)} aria-current={screen === id ? 'page' : undefined}><span aria-hidden="true">{mark}</span>{label}{typeof count === 'number' && <small>{count}</small>}</button>;
  return <div className="studio-shell">
    <aside className="sidebar">
      <button className="wordmark" onClick={() => setScreen('desk')} aria-label="Batchloom home"><img src="/images/action-stamp.png" alt="" />batchloom</button>
      <div className="studio-switch"><span className="studio-avatar">F.</span><div>Fieldwork Studio<small>Independent print & paper</small></div><span className="switch-dot" /></div>
      <p className="nav-label">YOUR WORKSPACE</p>
      <nav aria-label="Workspace">{nav('desk', 'Request desk', <Inbox size={19} />, requests.length)}{nav('batches', 'Collections', <Layers3 size={19} />, batches.length)}{nav('payments', 'Payment journal', <ReceiptText size={19} />)}{nav('library', 'Request library', <Library size={19} />)}{nav('guide', 'Studio guide', <BookOpen size={19} />)}</nav>
      <div className="sidebar-note"><p className="nav-label">CURRENT WORKSPACE</p><p>{collection.title}<br/><small>{requests.length} requests · {policy.variant} edition</small></p><button className="text-button" onClick={() => setScreen('library')}>Switch request set <ArrowRight size={14} /></button></div>
      <div className="sidebar-bottom"><Tag tone="sage">SANDBOX STUDIO</Tag><p>Fictional requests.<br/>No real money or shipments.</p><button className="text-button" disabled={busy} onClick={() => { setRequests(scenario.requests); setAnalysis([]); setAnalysisMode('none'); setPolicy(scenario.policy); setDispatchDate(scenario.policy.shipBy); setNotice('Original sample restored. Saved sandbox batches were kept.'); }}>Restore sample ↺</button></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div><span className="breadcrumb">FIELDWORK</span><span className="slash">/</span>{screen === 'desk' ? 'Request desk' : screen === 'batches' ? 'Collections' : screen === 'payments' ? 'Payment journal' : screen === 'library' ? 'Request library' : 'Studio guide'}</div><div className="topbar-right"><span className="draft-saved"><Check size={13} />{saveState}</span><span className="sandbox-pill">PayPal sandbox</span></div></header>
      <main>
        {screen === 'desk' && <>
          <div className="page-heading"><div><p className="eyebrow">THE MAKER’S DESK / 01</p><h1>Your next production run.</h1><p>Review what people want. Bring the right requests together.</p></div><Action secondary onClick={() => editRequest()}>+ Add a request</Action></div>
          <div className="workflow-bar" aria-label="Collection workflow"><span className="done"><b>01</b> Gather requests <Check size={14} /></span><span className={analysis.length ? 'done' : 'current'}><b>02</b> Read & review {analysis.length ? <Check size={14} /> : null}</span><span className={analysis.length ? 'current' : ''}><b>03</b> Approve fixed terms</span><span><b>04</b> Invite buyers</span></div><section className={`studio-hero collection-${collection.tone}`} aria-label="Current collection">
            <div className="hero-copy"><span className="collection-kicker">{collection.context} / {collection.number}</span><h2>{collection.collection}</h2><p>{collection.description}</p><button className="hero-link" onClick={() => document.getElementById('request-inbox')?.scrollIntoView({ behavior: 'smooth' })}>Review this request set <span>↘</span></button><div className="edition-mark">{collection.challenge}</div></div>
            <div className="hero-photo"><img src={collection.image} alt={collection.imageAlt} /><span className="image-caption">FICTIONAL COLLECTION · GENERATED IMAGERY</span></div>
          </section>
          <section className="summary-strip" aria-label="Workspace summary"><div><span>On the desk</span><strong>{requests.length.toString().padStart(2, '0')}<small>requests</small></strong></div><div><span>Worth bringing together</span><strong>{analysis.length ? summary.eligibleUnits.toString().padStart(2, '0') : '—'}<small>potential units</small></strong></div><div><span>Needs a human eye</span><strong>{analysis.length ? (summary.reviewCount + summary.conflictCount).toString().padStart(2, '0') : '—'}<small>to review</small></strong></div><div className="summary-note"><Glyph /><p>Interest is a beginning.<br/><b>A buyer’s approval makes it a reservation.</b></p></div></section>
          <div className="desk-grid">
            <section className="inbox" id="request-inbox"><div className="section-heading"><div><p className="eyebrow">01 / LISTEN</p><h2>Requests to consider</h2></div><button className="text-button quiet-label" onClick={() => setScreen('library')}>Browse 24 examples ↗</button></div><div className="inbox-toolbar"><div className="segmented" aria-label="Filter requests">{[['all', `All ${requests.length}`], ['eligible', `Ready ${analysis.filter(a => a.status === 'eligible').length}`], ['needs_review', `Review ${summary.reviewCount}`], ['conflict', `Conflicts ${summary.conflictCount}`]].map(([id, label]) => <button key={id} className={filter === id ? 'selected' : ''} onClick={() => setFilter(id)}>{label}</button>)}</div><input className="search" aria-label="Search requests" placeholder="Find a request…" value={query} onChange={e => setQuery(e.target.value)} /></div>
              <div className="inbox-subtools"><span>{filtered.length} of {requests.length} requests · fictional examples</span><label>Sort <select aria-label="Sort requests" value={sort} onChange={e => setSort(e.target.value)}><option value="received">Newest first</option><option value="name">Name A–Z</option><option value="attention">Needs attention first</option></select></label></div><div className="request-list">{filtered.map((r, index) => { const a = analysis.find(item => item.source.id === r.id); return <button className="request-row" key={r.id} onClick={() => setSelected(r.id)}><span className={`request-avatar av-${index % 4}`}>{r.customerLabel.split(' ').map(s => s[0]).slice(0, 2).join('')}</span><span className="request-content"><span className="request-name">{r.customerLabel}<small>REQUEST {String(requests.indexOf(r) + 1).padStart(2, '0')}</small></span><span className="request-preview">{r.body}</span><span className="request-meta">{a ? <><span className={`status-dot ${a.status}`} />{a.status === 'eligible' ? `${a.extraction.quantity.value} notebooks · matches this batch` : a.issues[0]?.message || 'A detail needs clarification'}</> : <><span className="status-dot unread" />Awaiting review</>}</span></span><span className="row-arrow"><ArrowRight size={16} /></span></button>; })}{!filtered.length && <div className="empty-inline">No requests match this view.<button className="text-button" onClick={() => { setFilter('all'); setQuery(''); }}>Show all requests</button></div>}</div>
              <div className="inbox-foot"><span>Source words stay attached to every decision.</span><span>↳ Evidence, always.</span></div>
            </section>
            <aside className="proposal-panel"><div className="section-heading"><div><p className="eyebrow">02 / BRING TOGETHER</p><h2>The collection brief</h2></div><Glyph /></div><div className="product-photo"><img src={policy.variant === 'cobalt' ? '/images/notebook-cobalt.png' : '/images/notebook-vermilion.png'} alt={`${policy.variant} notebook, generated fictional product study`} /><span className="product-flag">EDITION {collection.number} / {policy.variant.toUpperCase()}</span></div><div className="product-title"><div><h3>{collection.collection}</h3><p>A5 notebook · botanical riso cover</p></div><span className={`swatch ${policy.variant}`} aria-label={policy.variant} /></div><div className="batch-facts"><div><span>Price per notebook</span><b>$24</b></div><div><span>Minimum production run</span><b>12 units</b></div><div><span>Reservation window</span><b>48 hours</b></div></div>
              {analysis.length > 0 ? <div className="readiness"><div><b>{summary.eligibleUnits} / 12</b><span>potential units</span></div><div className="progress-track"><span style={{ width: `${Math.min(100, summary.eligibleUnits / 12 * 100)}%` }} /></div><p>{summary.minimumReached ? 'Enough compatible interest for a proposal.' : `${summary.remainingUnits} more compatible units needed.`} Buyers still need to approve payment.</p><span className="provenance">{analysisMode === 'example' ? scenario.label : 'Qwen3 on this device · evidence checked'}</span></div> : <div className="readiness unanalysed"><span className="tiny-star">✳</span><p>A promising collection starts with listening. Read the requests, then explore what fits.</p></div>}
              <Action onClick={analyze} disabled={busy || requests.length === 0} className="full-width">{busy ? (aiProgress?.phase === 'loading' ? 'Loading private AI…' : 'Reading on this device…') : <><span>✳</span> Analyze privately <span>↗</span></>}</Action><div className="connection-label"><span className="status-dot eligible" />Open-source AI · runs in your browser</div><p className="local-ai-note">{aiHint}</p>{busy && aiProgress && <div className="local-ai-progress" role="status"><p>{aiProgress.phase === 'analyzing' ? `Reading ${aiProgress.completed} / ${aiProgress.total} requests` : aiProgress.message}</p><progress max={1} value={aiProgress.progress} /><button className="text-button" onClick={() => aiController.current?.abort()}>Cancel local analysis</button></div>}
              {analysis.length ? <Action secondary onClick={() => { setConfirmed(false); setReviewing(true); }} className="full-width">Review batch proposal →</Action> : <button className="text-button example-button" onClick={exampleAnalysis}>Explore the illustrated example →</button>}
              <p className="panel-fineprint">Fixed at $24 · capacity {policy.capacityUnits} notebooks.<br/>Original wording stays on this device.</p><button className="text-button" onClick={() => setScreen('library')}>Try another request set <ArrowRight size={14} /></button>
            </aside>
          </div>
          <section className="principles"><div><span>01</span><h3>Every choice has a source.</h3><p>Trace quantities, colours and deadlines back to the original words.</p></div><div><span>02</span><h3>Make only what comes together.</h3><p>A fixed batch, a clear threshold, and a short reservation window.</p></div><div><span>03</span><h3>Keep the money story clear.</h3><p>Separate approvals, charges, released holds and refunds.</p></div></section>
        </>}
        {screen === 'library' && <><div className="page-heading"><div><p className="eyebrow">THE REQUEST LIBRARY / 24 EXAMPLES</p><h1>Different people. Different decisions.</h1><p>Three fictional situations to explore how a considered collection comes together.</p></div></div><div className="library-intro"><div><span className="eyebrow">CHOOSE A WORKING CONTEXT</span><p>Each set has eight original requests: clear orders, conflicting requirements and details that need a conversation.</p></div><Tag tone="sage">INPUTS, NOT TRANSACTIONS</Tag></div><section className="case-grid">{REQUEST_LIBRARY.map(entry => <article className={`case-card case-${entry.tone}`} key={entry.id}><div className="case-image"><img src={entry.image} alt={entry.imageAlt} loading="lazy" /><span>{entry.number} / FIELDWORK</span></div><div className="case-body"><span className="eyebrow">{entry.context}</span><h2>{entry.title}</h2><p>{entry.description}</p><dl><div><dt>Collection</dt><dd>{entry.collection}</dd></div><div><dt>Working set</dt><dd>8 fictional requests · $24 / unit</dd></div></dl><p className="case-challenge">{entry.challenge}</p><Action secondary={entry.id !== libraryId} disabled={busy} onClick={() => switchScenario(entry.id)} className="full-width">{entry.id === libraryId ? 'Return to this desk' : drafts.current[entry.id] ? 'Resume this draft' : 'Work with this set'} <ArrowRight size={15} /></Action></div></article>)}</section><div className="library-bottom"><BookOpen size={24} strokeWidth={1.4} /><div><h3>Look beyond a happy path.</h3><p>Try the unknown quantity, a colour mismatch or the total-budget request. Read its source, revise a fictional detail, then analyze again. Each request set keeps its own draft in this tab.</p></div><button className="text-button" onClick={() => setScreen('guide')}>Read the studio guide ↗</button></div></>}
        {screen === 'batches' && <><div className="page-heading"><div><p className="eyebrow">THE COLLECTIONS / 02</p><h1>Every run, in one place.</h1><p>Approved terms, confirmed reservations and the next action.</p></div><Action secondary onClick={() => setScreen('desk')}>New collection <ArrowRight size={15} /></Action></div><section className="operations-summary"><div><span>Total collections</span><strong>{batches.length.toString().padStart(2,'0')}</strong></div><div><span>Open for reservations</span><strong>{openCount.toString().padStart(2,'0')}</strong></div><div><span>Confirmed captured</span><strong>{money(capturedTotal)}<small>Sandbox USD</small></strong></div></section><div className="collection-toolbar"><div className="segmented">{[['all','All collections'],['open','Open'],['complete','Closed'],['attention','Needs attention']].map(([id,label]) => <button className={collectionFilter === id ? 'selected' : ''} key={id} onClick={() => setCollectionFilter(id)}>{label}</button>)}</div><input aria-label="Find a collection" className="search" placeholder="Find a collection…" value={collectionQuery} onChange={e => setCollectionQuery(e.target.value)} /></div>{!batches.length ? <section className="collection-empty"><div className="empty-sequence"><span><Inbox size={25} />Requests</span><ArrowRight size={20}/><span><Check size={25} />Review</span><ArrowRight size={20}/><span><Layers3 size={25} />Collection</span></div><h2>Your first collection starts with a clear brief.</h2><p>Review a request set, check the source evidence and approve its fixed terms. Your published collection and reservation link will appear here.</p><div className="action-row"><Action onClick={() => setScreen('desk')}>Open your request desk ↗</Action><Action secondary onClick={() => setScreen('library')}>Choose an example set</Action></div></section> : visibleBatches.length ? visibleBatches.map(batch => <section className="collection-row" key={batch.proposal.id}><div className={`collection-monogram ${batch.proposal.policy.variant}`}><Layers3 size={24}/><span>{batch.proposal.policy.variant === 'cobalt' ? 'CO' : 'VE'}</span></div><div className="collection-main"><div className="collection-heading"><h2>{batch.proposal.title}</h2><Tag tone={batch.status === 'COMMITTED' ? 'sage' : ''}>{batch.status.replaceAll('_',' ')}</Tag></div><p>Version {batch.proposal.version} · {batch.proposal.policy.variant} · {money(batch.proposal.policy.unitPriceCents)} / notebook</p><div className="collection-numbers"><div><span>Confirmed units</span><b>{batch.authorizedUnits} / {batch.proposal.policy.minimumUnits}</b><progress max={batch.proposal.policy.minimumUnits} value={Math.min(batch.proposal.policy.minimumUnits,batch.authorizedUnits)} /></div><div><span>Captured</span><b>{money(batch.capturedCents)}</b><small>Sandbox USD</small></div><div><span>Reservation deadline</span><b>{new Date(batch.proposal.closesAt).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</b><small>{new Date(batch.proposal.closesAt).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}</small></div></div><div className="collection-actions"><a className="text-button" href={`/batch/${batch.proposal.id}`}>Buyer page ↗</a><button className="text-button" onClick={() => copyText(window.location.origin + '/batch/' + batch.proposal.id, 'Buyer link copied. Share it with your Sandbox tester.')}>Copy buyer link</button><Action secondary onClick={() => settle(batch)} disabled={!!settlingId || ['COMMITTED','CANCELLED'].includes(batch.status)}>{settlingId === batch.proposal.id ? 'Checking PayPal…' : 'Close batch & settle'}</Action></div><p className="collection-next"><span>Next step</span>{batch.status === 'COMMITTED' ? 'Settlement complete. Review the confirmed receipt on the buyer page.' : batch.status === 'CANCELLED' ? 'This collection is closed. Review its final payment state before starting another.' : batch.status === 'OPEN' ? batch.authorizedUnits >= batch.proposal.policy.minimumUnits ? 'The minimum is reached. Review reservations before starting settlement.' : 'Share the buyer link. Interest counts only after each buyer approves a hold.' : 'A provider operation needs review. Check the journal before trying again.'}</p></div></section>) : <div className="empty-inline">No collections match this view.<button className="text-button" onClick={() => {setCollectionFilter('all');setCollectionQuery('');}}>Show all collections</button></div>}</>}
        {screen === 'payments' && <><div className="page-heading"><div><p className="eyebrow">THE PAYMENT JOURNAL / 03</p><h1>No loose ends.</h1><p>Real provider states. A clear record of what happened.</p></div><Action secondary onClick={refresh}>↻ Refresh payment journal</Action></div><section className="operations-summary journal-totals"><div><span>Collections in this browser</span><strong>{batches.length.toString().padStart(2,'0')}</strong></div><div><span>Confirmed captured</span><strong>{money(capturedTotal)}<small>Sandbox USD</small></strong></div><div><span>Record source</span><strong className="source-word">PayPal</strong><small>Provider-confirmed operations</small></div></section><div className="journal-explainer"><Glyph><ReceiptText size={25} strokeWidth={1.5}/></Glyph><div><h2>An approval is not a charge.</h2><p>A buyer first authorizes a fixed amount. Captures, voids and refunds only appear here after confirmation from PayPal Sandbox.</p></div><Tag tone="sage">SANDBOX ONLY</Tag></div>{batches.length ? batches.map(batch => <div className="journal-row" key={batch.proposal.id}><div><h3>{batch.proposal.title}</h3><p>{batch.authorizedUnits} confirmed units · {batch.proposal.policy.variant} · version {batch.proposal.version}</p></div><Tag>{batch.status}</Tag><strong>{money(batch.capturedCents)}</strong><a className="text-button" href={`/batch/${batch.proposal.id}`}>View record ↗</a></div>) : <div className="empty-journal"><ReceiptText className="empty-journal-icon" size={36} strokeWidth={1.3}/><h2>Ready for the first reservation.</h2><p>Publish a reviewed collection and share its buyer page.<br/>Confirmed Sandbox activity will appear here.</p><Action secondary onClick={() => setScreen('desk')}>Start with a batch →</Action></div>}</>}
        {screen === 'guide' && <><div className="page-heading"><div><p className="eyebrow">THE STUDIO GUIDE</p><h1>A considered way to make.</h1><p>Human intent, source evidence and accountable payments.</p></div></div><section className="guide-grid">{[['01', 'Listen closely', 'Paste synthetic requests. The AI extracts the product, quantity, colour, explicit budget and date. Every supported field keeps an exact quote. Missing or conflicting details stay visible.'], ['02', 'Make the call', 'Review the proposed collection. Price is fixed at $24 and the threshold at 12 notebooks. Approving locks that version. Customer interest does not imply consent to pay.'], ['03', 'Invite your people', 'Each buyer approves a PayPal Sandbox hold for the exact quantity and amount. Only provider-confirmed authorizations count toward the threshold.'], ['04', 'Close every loop', 'The maker closes a viable batch and captures its payments. If captures partly fail, the batch enters recovery: completed captures are refunded and remaining holds are voided. Unconfirmed actions stay unresolved.']].map(([n, title, description]) => <article key={n}><span>{n}</span><h2>{title}</h2><p>{description}</p></article>)}</section><div className="privacy-note"><h3>Your workspace, your decisions.</h3><p>Fieldwork Studio, its customers and products are fictional. Product imagery is AI generated. Use synthetic messages only. Browser examples never create payments. Real integration uses PayPal’s test environment; this prototype does not ship products, provide escrow, or guarantee that separate captures succeed together.</p><p>Qwen3 analyzes text on your device. Model files are downloaded from public repositories, but original requests and evidence quotes are not sent to an AI service or our publishing server. Opening a local-AI batch sends only your approved product terms and anonymous counts. Payment credentials remain on the server. Payment state is retained for reconciliation. Request drafts are saved in this tab only and restored after refresh; AI results must be run again. Use “Clear saved drafts” below to remove them. Clear this browser’s site data to end the local payment session; that does not cancel existing sandbox authorizations.</p><button className="text-button" onClick={() => { drafts.current = {}; try {sessionStorage.removeItem(DRAFT_KEY);} catch {} setSaveState('Saved drafts cleared'); setNotice('Saved request drafts removed. Current on-screen work and existing Sandbox payments are unchanged. New edits save a new draft.'); }}>Clear saved drafts</button></div></>}
        <footer className="studio-footer"><span>batchloom <i>— made for the makers.</i></span><span>PRIVATE BY DESIGN · PAYPAL SANDBOX</span></footer>
      </main>
    </div>
    {notice && <div className="toast" role="status"><span>✳</span>{notice}<button aria-label="Dismiss message" onClick={() => setNotice('')}>×</button></div>}
    {selectedSource && <div className="modal-backdrop" onClick={() => setSelected(null)}><section className="evidence-drawer" role="dialog" aria-modal="true" aria-label="Request evidence" onClick={e => e.stopPropagation()}><button className="close-button" autoFocus onClick={() => setSelected(null)} aria-label="Close evidence">×</button><p className="eyebrow">THE WORDS BEHIND THE NUMBERS</p><h2>{selectedSource.customerLabel}</h2><div className="evidence-context"><Tag>FICTIONAL REQUEST</Tag><span>{collection.title}</span></div><blockquote>{selectedSource.body}</blockquote><div className="request-edit-actions"><button className="text-button" onClick={() => editRequest(selectedSource)}>Revise this request ↗</button><button className="text-button" onClick={() => removeRequest(selectedSource.id)}>Remove from draft</button></div>{selectedAnalysis ? <><h3>What the evidence supports</h3><div className="evidence-fields">{Object.entries(selectedAnalysis.extraction).filter(([k]) => k !== 'requestId').map(([key, value]) => { const evidence = value as { value: unknown; quote: string | null }; return <div key={key}><span>{key.replace('unitBudgetCents', 'Budget / unit').replace('product', 'Product').replace('quantity', 'Quantity').replace('variant', 'Colour').replace('deadline', 'Requested date')}</span><b>{evidence.value == null ? 'Not stated' : key === 'unitBudgetCents' ? money(Number(evidence.value)) : String(evidence.value)}</b>{evidence.quote && <q>{evidence.quote}</q>}</div>; })}</div><h3>What needs your attention</h3>{selectedAnalysis.issues.length ? selectedAnalysis.issues.map((issue, i) => <p className={`issue-note ${issue.severity}`} key={i}>{issue.message}</p>) : <p className="issue-note info">This request matches the collection. A separate buyer approval is still required.</p>}<div className="next-action"><CircleHelp size={20}/><div><b>{selectedAnalysis.status === 'eligible' ? 'Ready for your batch review' : 'Resolve the source, then analyze again'}</b><p>{selectedAnalysis.status === 'eligible' ? 'This is compatible interest. Payment still needs the buyer’s own approval.' : 'Use Revise to explore a correction to this fictional request. Changing a detail clears the old analysis.'}</p></div></div><p className="small-note">{analysisMode === 'example' ? scenario.label : 'On-device Qwen3 extraction, checked against the original words.'}</p></> : <p className="issue-note">This request has not been analyzed. Review the source or run AI analysis from the desk.</p>}</section></div>}
    {adding && <div className="modal-backdrop" onClick={() => setAdding(false)}><form className="modal-card" role="dialog" aria-modal="true" aria-label={editingId ? "Revise a fictional request" : "Add a fictional request"} onClick={e => e.stopPropagation()} onSubmit={addRequest}><button type="button" className="close-button" onClick={() => setAdding(false)} aria-label="Close add request">×</button><p className="eyebrow">{editingId ? "A CLEARER THREAD" : "A NEW THREAD"}</p><h2>{editingId ? "Refine the request." : "What would they like?"}</h2><p>Use a fictional request to explore the workflow.</p><label>Display label<input autoFocus maxLength={80} value={newLabel} onChange={e => setNewLabel(e.target.value)} required /></label><label>Original request<textarea rows={6} maxLength={4000} value={newText} onChange={e => setNewText(e.target.value)} placeholder="We’d love 4 cobalt notebooks for the studio…" required /></label><button type="button" className="text-button" onClick={() => setNewText(`Could we get 4 ${policy.variant} notebooks for the workshop? Our budget is $24 per notebook. We need them by ${scenario.policy.shipBy}.`)}>Use a sample request ↗</button><p className="small-note">Use fictional details for this demonstration. Local AI reads this text on your device; publishing sends only the approved batch terms and counts.</p><Action type="submit" disabled={!newText.trim() || (!editingId && requests.length >= 24)} className="full-width">{editingId ? "Save the revised request ↗" : "Add to the desk +"}</Action></form></div>}
    {reviewing && <div className="modal-backdrop" onClick={() => setReviewing(false)}><section className="modal-card review-card" role="dialog" aria-modal="true" aria-label="Review batch proposal" onClick={e => e.stopPropagation()}><button className="close-button" autoFocus onClick={() => setReviewing(false)} aria-label="Close proposal">×</button><p className="eyebrow">THE FINAL PROOF / REVIEW BEFORE OPENING</p><h2>{collection.collection}</h2><p>{summary.eligibleRequestCount} compatible requests · {summary.eligibleUnits} potential units</p><dl className="review-facts"><div><dt>Price</dt><dd>$24 / notebook</dd></div><div><dt>Minimum</dt><dd>12 authorized units</dd></div><div><dt>Capacity</dt><dd>{policy.capacityUnits} units</dd></div><div><dt>Window</dt><dd>48 hours from approval</dd></div></dl><label>Studio dispatch date<input type="date" value={dispatchDate} onChange={e => { const value = e.target.value; setDispatchDate(value); setConfirmed(false); if (isIsoDate(value)) { const next = { ...policy, shipBy: value }; setPolicy(next); setAnalysis(analysis.map(a => assessRequest(a.source, a.extraction, next))); } }} /></label><div className="issue-note">This is a proposal based on {analysisMode === 'example' ? 'an illustrative sample' : 'AI-analyzed requests'}. No buyer has consented to pay. Opening the batch fixes its price, product and timing.</div><label className="check-label"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I have reviewed the source evidence and approve this exact sandbox batch.</label><Action onClick={publishBatch} disabled={!confirmed || busy || !summary.minimumReached || !isIsoDate(dispatchDate) || dispatchDate !== policy.shipBy} className="full-width">{busy ? 'Opening the collection…' : 'Open sandbox reservations ↗'}</Action><Action secondary onClick={exportPlan} className="full-width">Download this proposal ↓</Action><p className="small-note">{!config.paypal ? 'PayPal Sandbox connection is pending. You can save the proposal now.' : 'Buyers will approve their own holds in PayPal Sandbox.'}</p></section></div>}
  </div>;
}
