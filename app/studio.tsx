'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createDemoScenario } from '@/lib/demo-data';
import { summarizeRequests, assessRequest, isIsoDate } from '@/lib/batch-domain';
import type { SourceRequest, AnalyzedRequest, BatchPolicy, FrozenBatch } from '@/lib/batch-domain';
import type { LocalAIProgress } from '@/lib/local-ai';
import { LOCAL_MODEL } from '@/lib/local-model';

type Screen = 'desk' | 'batches' | 'payments' | 'guide';
type Config = { ai: boolean; paypal: boolean; storage: boolean };
type SavedBatch = { proposal: FrozenBatch; status: string; authorizedUnits: number; capturedCents: number };
type ApiPayload = { batches?: SavedBatch[]; status?: string; requests?: AnalyzedRequest[]; error?: string; issues?: {message: string}[]; acquired?: boolean };
const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(cents / 100);

function Glyph({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <span className={`glyph ${className}`} aria-hidden="true">{children || <img src="/images/action-stamp.png" alt="" />}</span>;
}
function Action({ children, onClick, secondary, disabled, type = 'button', className = '' }: { children: React.ReactNode; onClick?: () => void; secondary?: boolean; disabled?: boolean; type?: 'button' | 'submit'; className?: string }) {
  return <button type={type} className={`action ${secondary ? 'paper' : 'cobalt'} ${className}`} onClick={onClick} disabled={disabled}>{children}</button>;
}
function Tag({ children, tone = '' }: { children: React.ReactNode; tone?: string }) { return <span className={`tag ${tone}`}>{children}</span>; }

export default function Studio() {
  const [scenario] = useState(() => createDemoScenario());
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
  });
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
    const file = new Blob([JSON.stringify({ title: 'Cobalt Field Notes', policy, requests, analysis, provenance: analysisMode, generatedAt: new Date().toISOString(), note: 'Proposal only. Demand is not a payment authorization.' }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(file); const link = document.createElement('a'); link.href = url; link.download = 'batchloom-proposal.json'; link.click(); URL.revokeObjectURL(url);
    setNotice('Proposal downloaded, with source evidence and analysis provenance.');
  }
  async function publishBatch() {
    if (!confirmed || !isIsoDate(dispatchDate) || dispatchDate !== policy.shipBy) return;
    setBusy(true);
    try {
      const proposal = analysisMode === 'local'
        ? { title: 'Cobalt Field Notes', policy, makerApproved: true, provenance: 'local-model', reviewedPlan: { requestCount: requests.length, eligibleUnits: summary.eligibleUnits, eligibleRequestCount: summary.eligibleRequestCount, reviewCount: summary.reviewCount, conflictCount: summary.conflictCount, modelId } }
        : { title: 'Cobalt Field Notes', policy, requests: analysis, makerApproved: true, provenance: 'example' };
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
  const nav = (id: Screen, label: string, mark: string, count?: number) => <button className={`nav-item ${screen === id ? 'active' : ''}`} onClick={() => setScreen(id)} aria-current={screen === id ? 'page' : undefined}><span aria-hidden="true">{mark}</span>{label}{typeof count === 'number' && <small>{count}</small>}</button>;
  return <div className="studio-shell">
    <aside className="sidebar">
      <button className="wordmark" onClick={() => setScreen('desk')} aria-label="Batchloom home"><img src="/images/action-stamp.png" alt="" />batchloom</button>
      <div className="studio-switch"><span className="studio-avatar">F.</span><div>Fieldwork Studio<small>Independent print & paper</small></div><span className="switch-dot" /></div>
      <p className="nav-label">YOUR WORKSPACE</p>
      <nav aria-label="Workspace">{nav('desk', 'Request desk', '▦', requests.length)}{nav('batches', 'Collections', '▤', batches.length)}{nav('payments', 'Payment journal', '◷')}{nav('guide', 'How it works', '↗')}</nav>
      <div className="sidebar-note"><span className="mini-star">✳</span><p>Made in small batches.<br/>Thought through together.</p><span className="note-line" /></div>
      <div className="sidebar-bottom"><Tag tone="sage">SANDBOX STUDIO</Tag><p>Fictional requests.<br/>No real money or shipments.</p><button className="text-button" onClick={() => { setRequests(scenario.requests); setAnalysis([]); setAnalysisMode('none'); setPolicy(scenario.policy); setDispatchDate(scenario.policy.shipBy); setNotice('Original sample restored. Saved sandbox batches were kept.'); }}>Restore sample ↺</button></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div><span className="breadcrumb">FIELDWORK</span><span className="slash">/</span>{screen === 'desk' ? 'Request desk' : screen === 'batches' ? 'Collections' : screen === 'payments' ? 'Payment journal' : 'Studio guide'}</div><div className="topbar-right"><span className="connection-dot" />PayPal sandbox<span className="profile-badge">FW</span></div></header>
      <main>
        {screen === 'desk' && <>
          <div className="page-heading"><div><p className="eyebrow">THE MAKER’S DESK / 01</p><h1>Good things come together.</h1><p>A little less guesswork. A batch worth making.</p></div><Action secondary onClick={() => editRequest()}>+ Add a request</Action></div>
          <section className="studio-hero" aria-label="Current collection">
            <div className="hero-copy"><span className="collection-kicker">FROM THE STUDIO</span><h2>Small runs.<br/>Shared beginnings.</h2><p>Turn scattered requests into a considered collection. Let the evidence lead, then invite your people in.</p><button className="hero-link" onClick={() => document.getElementById('request-inbox')?.scrollIntoView({ behavior: 'smooth' })}>Find your next batch <span>↘</span></button><div className="edition-mark">FIELD NOTES<br/><strong>COLLECTION NO. 001</strong></div></div>
            <div className="hero-photo"><img src="/images/studio-hero.png" alt="Cobalt botanical notebooks and printmaking materials on a warm paper studio desk. AI-generated concept imagery." /><span className="image-caption">COBALT / PAPER / POSSIBILITY</span></div>
          </section>
          <section className="summary-strip" aria-label="Workspace summary"><div><span>On the desk</span><strong>{requests.length.toString().padStart(2, '0')}<small>requests</small></strong></div><div><span>Worth bringing together</span><strong>{analysis.length ? summary.eligibleUnits.toString().padStart(2, '0') : '—'}<small>potential units</small></strong></div><div><span>Needs a human eye</span><strong>{analysis.length ? (summary.reviewCount + summary.conflictCount).toString().padStart(2, '0') : '—'}<small>to review</small></strong></div><div className="summary-note"><Glyph /><p>Interest is a beginning.<br/><b>A buyer’s approval makes it a reservation.</b></p></div></section>
          <div className="desk-grid">
            <section className="inbox" id="request-inbox"><div className="section-heading"><div><p className="eyebrow">01 / LISTEN</p><h2>Every request, a thread.</h2></div><span className="quiet-label">SYNTHETIC DEMO</span></div><div className="inbox-toolbar"><div className="segmented" aria-label="Filter requests">{[['all', 'All requests'], ['eligible', 'Ready'], ['needs_review', 'Review'], ['conflict', 'Conflicts']].map(([id, label]) => <button key={id} className={filter === id ? 'selected' : ''} onClick={() => setFilter(id)}>{label}</button>)}</div><input className="search" aria-label="Search requests" placeholder="Find a request…" value={query} onChange={e => setQuery(e.target.value)} /></div>
              <div className="request-list">{filtered.map((r, index) => { const a = analysis.find(item => item.source.id === r.id); return <button className="request-row" key={r.id} onClick={() => setSelected(r.id)}><span className={`request-avatar av-${index % 4}`}>{r.customerLabel.split(' ').map(s => s[0]).slice(0, 2).join('')}</span><span className="request-content"><span className="request-name">{r.customerLabel}<small>REQUEST {String(requests.indexOf(r) + 1).padStart(2, '0')}</small></span><span className="request-preview">{r.body}</span><span className="request-meta">{a ? <><span className={`status-dot ${a.status}`} />{a.status === 'eligible' ? `${a.extraction.quantity.value} notebooks · matches this batch` : a.status === 'conflict' ? 'Outside this batch’s constraints' : 'A detail needs clarification'}</> : <><span className="status-dot unread" />Awaiting review</>}</span></span><span className="row-arrow">↗</span></button>; })}{!filtered.length && <div className="empty-inline">No requests match this view.<button className="text-button" onClick={() => { setFilter('all'); setQuery(''); }}>Show all requests</button></div>}</div>
              <div className="inbox-foot"><span>Source words stay attached to every decision.</span><span>↳ Evidence, always.</span></div>
            </section>
            <aside className="proposal-panel"><div className="section-heading"><div><p className="eyebrow">02 / BRING TOGETHER</p><h2>Your next small run.</h2></div><Glyph /></div><div className="product-photo"><img src="/images/notebook-cobalt.png" alt="Cobalt botanical risograph notebook, generated concept product." onError={e => { e.currentTarget.src = '/images/studio-hero.png'; }} /><span className="product-flag">FIELDWORK EDITION 01</span></div><div className="product-title"><div><h3>Cobalt Field Notes</h3><p>A5 notebook · botanical riso cover</p></div><span className="swatch" aria-label="Cobalt blue" /></div><div className="batch-facts"><div><span>Price per notebook</span><b>$24</b></div><div><span>Minimum production run</span><b>12 units</b></div><div><span>Reservation window</span><b>48 hours</b></div></div>
              {analysis.length > 0 ? <div className="readiness"><div><b>{summary.eligibleUnits} / 12</b><span>potential units</span></div><div className="progress-track"><span style={{ width: `${Math.min(100, summary.eligibleUnits / 12 * 100)}%` }} /></div><p>{summary.minimumReached ? 'Enough compatible interest for a proposal.' : `${summary.remainingUnits} more compatible units needed.`} Buyers still need to approve payment.</p><span className="provenance">{analysisMode === 'example' ? scenario.label : 'Qwen3 on this device · evidence checked'}</span></div> : <div className="readiness unanalysed"><span className="tiny-star">✳</span><p>A promising collection starts with listening. Read the requests, then explore what fits.</p></div>}
              <Action onClick={analyze} disabled={busy} className="full-width">{busy ? (aiProgress?.phase === 'loading' ? 'Loading private AI…' : 'Reading on this device…') : <><span>✳</span> Analyze privately <span>↗</span></>}</Action><div className="connection-label"><span className="status-dot eligible" />Open-source AI · runs in your browser</div><p className="local-ai-note">{aiHint}</p>{busy && aiProgress && <div className="local-ai-progress" role="status"><p>{aiProgress.phase === 'analyzing' ? `Reading ${aiProgress.completed} / ${aiProgress.total} requests` : aiProgress.message}</p><progress max={1} value={aiProgress.progress} /><button className="text-button" onClick={() => aiController.current?.abort()}>Cancel local analysis</button></div>}
              {analysis.length ? <Action secondary onClick={() => { setConfirmed(false); setReviewing(true); }} className="full-width">Review batch proposal →</Action> : <button className="text-button example-button" onClick={exampleAnalysis}>Explore the illustrated example →</button>}
              <p className="panel-fineprint">AI proposes. You decide.<br/>Prices and payment rules stay under your control.</p>
            </aside>
          </div>
          <section className="principles"><div><span>01</span><h3>Every choice has a source.</h3><p>Trace quantities, colours and deadlines back to the original words.</p></div><div><span>02</span><h3>Make only what comes together.</h3><p>A fixed batch, a clear threshold, and a short reservation window.</p></div><div><span>03</span><h3>Keep the money story clear.</h3><p>Separate approvals, charges, released holds and refunds.</p></div></section>
        </>}
        {screen === 'batches' && <><div className="page-heading"><div><p className="eyebrow">THE COLLECTIONS / 02</p><h1>Ready for a shared beginning.</h1><p>Approved plans stay fixed while your customers reserve.</p></div><Action secondary onClick={() => setScreen('desk')}>← Back to the desk</Action></div>{!batches.length ? <section className="editorial-empty"><img src="/images/studio-hero.png" alt="Notebooks ready for a small production run" /><div><p className="eyebrow">NOTHING RUSHED. NOTHING INVENTED.</p><h2>Your first batch<br/>starts at the desk.</h2><p>Review the requests, approve the exact collection, then open a sandbox reservation page. No customer has been charged.</p><Action onClick={() => setScreen('desk')}>Review the requests ↗</Action></div></section> : batches.map(batch => <section className="saved-batch" key={batch.proposal.id}><img src="/images/notebook-cobalt.png" alt="Cobalt notebook collection" /><div><Tag tone={batch.status === 'COMMITTED' ? 'sage' : ''}>{batch.status}</Tag><h2>{batch.proposal.title}</h2><p>Version {batch.proposal.version} · {batch.authorizedUnits} confirmed units · {money(batch.capturedCents)} captured</p><p>Closes {new Date(batch.proposal.closesAt).toLocaleString()}</p><div className="action-row"><a className="action paper" href={`/batch/${batch.proposal.id}`}>Open buyer page ↗</a><Action onClick={() => settle(batch)} disabled={!!settlingId || ['COMMITTED', 'CANCELLED'].includes(batch.status)}>{settlingId === batch.proposal.id ? 'Checking PayPal…' : 'Close batch & settle'}</Action></div><p className="small-note">Closing before the deadline requires the threshold. After the deadline, uncommitted holds are released. Settlement is maker initiated.</p></div></section>)}</>}
        {screen === 'payments' && <><div className="page-heading"><div><p className="eyebrow">THE PAYMENT JOURNAL / 03</p><h1>No loose ends.</h1><p>Real provider states. A clear record of what happened.</p></div><Action secondary onClick={refresh}>↻ Refresh payment journal</Action></div><div className="journal-explainer"><Glyph /><div><h2>An approval is not a charge.</h2><p>A buyer first authorizes a fixed amount. Captures, voids and refunds only appear here after confirmation from PayPal Sandbox.</p></div><Tag tone="sage">SANDBOX ONLY</Tag></div>{batches.length ? batches.map(batch => <div className="journal-row" key={batch.proposal.id}><div><h3>{batch.proposal.title}</h3><p>{batch.proposal.id}</p></div><Tag>{batch.status}</Tag><strong>{money(batch.capturedCents)}</strong><a className="text-button" href={`/batch/${batch.proposal.id}`}>View record ↗</a></div>) : <div className="empty-journal"><span className="large-number">00</span><h2>A clean page.</h2><p>No sandbox payment has been recorded in this session.<br/>Your sample requests are interest, not financial transactions.</p><Action secondary onClick={() => setScreen('desk')}>Start with a batch →</Action></div>}</>}
        {screen === 'guide' && <><div className="page-heading"><div><p className="eyebrow">THE STUDIO GUIDE</p><h1>A considered way to make.</h1><p>Human intent, source evidence and accountable payments.</p></div></div><section className="guide-grid">{[['01', 'Listen closely', 'Paste synthetic requests. The AI extracts the product, quantity, colour, explicit budget and date. Every supported field keeps an exact quote. Missing or conflicting details stay visible.'], ['02', 'Make the call', 'Review the proposed collection. Price is fixed at $24 and the threshold at 12 notebooks. Approving locks that version. Customer interest does not imply consent to pay.'], ['03', 'Invite your people', 'Each buyer approves a PayPal Sandbox hold for the exact quantity and amount. Only provider-confirmed authorizations count toward the threshold.'], ['04', 'Close every loop', 'The maker closes a viable batch and captures its payments. If captures partly fail, the batch enters recovery: completed captures are refunded and remaining holds are voided. Unconfirmed actions stay unresolved.']].map(([n, title, description]) => <article key={n}><span>{n}</span><h2>{title}</h2><p>{description}</p></article>)}</section><div className="privacy-note"><h3>A demonstration, thoughtfully bounded.</h3><p>Fieldwork Studio, its customers and products are fictional. Product imagery is AI generated. Use synthetic messages only. Browser examples never create payments. Real integration uses PayPal’s test environment; this prototype does not ship products, provide escrow, or guarantee that separate captures succeed together.</p><p>Qwen3 analyzes text on your device. Model files are downloaded from public repositories, but original requests and evidence quotes are not sent to an AI service or our publishing server. Opening a local-AI batch sends only your approved product terms and anonymous counts. Payment credentials remain on the server. Payment state is retained for reconciliation. Clear this browser’s site data to end the local session; that does not cancel existing sandbox authorizations.</p></div></>}
        <footer className="studio-footer"><span>batchloom <i>— made for the makers.</i></span><span>PAYPAL AI HACKATHON · 2026 <span className="footer-star">✳</span></span></footer>
      </main>
    </div>
    {notice && <div className="toast" role="status"><span>✳</span>{notice}<button aria-label="Dismiss message" onClick={() => setNotice('')}>×</button></div>}
    {selectedSource && <div className="modal-backdrop" onClick={() => setSelected(null)}><section className="evidence-drawer" role="dialog" aria-modal="true" aria-label="Request evidence" onClick={e => e.stopPropagation()}><button className="close-button" autoFocus onClick={() => setSelected(null)} aria-label="Close evidence">×</button><p className="eyebrow">THE WORDS BEHIND THE NUMBERS</p><h2>{selectedSource.customerLabel}</h2><Tag>SYNTHETIC REQUEST</Tag><blockquote>{selectedSource.body}</blockquote><div className="request-edit-actions"><button className="text-button" onClick={() => editRequest(selectedSource)}>Revise this request ↗</button><button className="text-button" onClick={() => removeRequest(selectedSource.id)}>Remove from draft</button></div>{selectedAnalysis ? <><h3>What the evidence supports</h3><div className="evidence-fields">{Object.entries(selectedAnalysis.extraction).filter(([k]) => k !== 'requestId').map(([key, value]) => { const evidence = value as { value: unknown; quote: string | null }; return <div key={key}><span>{key.replace('unitBudgetCents', 'Budget / unit').replace('product', 'Product').replace('quantity', 'Quantity').replace('variant', 'Colour').replace('deadline', 'Requested date')}</span><b>{evidence.value == null ? 'Not stated' : key === 'unitBudgetCents' ? money(Number(evidence.value)) : String(evidence.value)}</b>{evidence.quote && <q>{evidence.quote}</q>}</div>; })}</div><h3>Review notes</h3>{selectedAnalysis.issues.length ? selectedAnalysis.issues.map((issue, i) => <p className={`issue-note ${issue.severity}`} key={i}>{issue.message}</p>) : <p className="issue-note info">This request matches the collection. A separate buyer approval is still required.</p>}<p className="small-note">{analysisMode === 'example' ? scenario.label : 'On-device Qwen3 extraction, checked against the original words.'}</p></> : <p className="issue-note">This request has not been analyzed. Review the source or run AI analysis from the desk.</p>}</section></div>}
    {adding && <div className="modal-backdrop" onClick={() => setAdding(false)}><form className="modal-card" role="dialog" aria-modal="true" aria-label={editingId ? "Revise a fictional request" : "Add a fictional request"} onClick={e => e.stopPropagation()} onSubmit={addRequest}><button type="button" className="close-button" onClick={() => setAdding(false)} aria-label="Close add request">×</button><p className="eyebrow">{editingId ? "A CLEARER THREAD" : "A NEW THREAD"}</p><h2>{editingId ? "Refine the request." : "What would they like?"}</h2><p>Use a fictional request to explore the workflow.</p><label>Display label<input autoFocus maxLength={80} value={newLabel} onChange={e => setNewLabel(e.target.value)} required /></label><label>Original request<textarea rows={6} maxLength={4000} value={newText} onChange={e => setNewText(e.target.value)} placeholder="We’d love 4 cobalt notebooks for the studio…" required /></label><button type="button" className="text-button" onClick={() => setNewText(`Could we get 4 cobalt notebooks for the workshop? Our budget is $24 per notebook. We need them by ${scenario.policy.shipBy}.`)}>Use a sample request ↗</button><p className="small-note">Use fictional details for this demonstration. Local AI reads this text on your device; publishing sends only the approved batch terms and counts.</p><Action type="submit" disabled={!newText.trim() || (!editingId && requests.length >= 24)} className="full-width">{editingId ? "Save the revised request ↗" : "Add to the desk +"}</Action></form></div>}
    {reviewing && <div className="modal-backdrop" onClick={() => setReviewing(false)}><section className="modal-card review-card" role="dialog" aria-modal="true" aria-label="Review batch proposal" onClick={e => e.stopPropagation()}><button className="close-button" autoFocus onClick={() => setReviewing(false)} aria-label="Close proposal">×</button><p className="eyebrow">THE FINAL PROOF / REVIEW BEFORE OPENING</p><h2>Cobalt Field Notes</h2><p>{summary.eligibleRequestCount} compatible requests · {summary.eligibleUnits} potential units</p><dl className="review-facts"><div><dt>Price</dt><dd>$24 / notebook</dd></div><div><dt>Minimum</dt><dd>12 authorized units</dd></div><div><dt>Capacity</dt><dd>{policy.capacityUnits} units</dd></div><div><dt>Window</dt><dd>48 hours from approval</dd></div></dl><label>Studio dispatch date<input type="date" value={dispatchDate} onChange={e => { const value = e.target.value; setDispatchDate(value); setConfirmed(false); if (isIsoDate(value)) { const next = { ...policy, shipBy: value }; setPolicy(next); setAnalysis(analysis.map(a => assessRequest(a.source, a.extraction, next))); } }} /></label><div className="issue-note">This is a proposal based on {analysisMode === 'example' ? 'an illustrative sample' : 'AI-analyzed requests'}. No buyer has consented to pay. Opening the batch fixes its price, product and timing.</div><label className="check-label"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I have reviewed the source evidence and approve this exact sandbox batch.</label><Action onClick={publishBatch} disabled={!confirmed || busy || !summary.minimumReached || !isIsoDate(dispatchDate) || dispatchDate !== policy.shipBy} className="full-width">{busy ? 'Opening the collection…' : 'Open sandbox reservations ↗'}</Action><Action secondary onClick={exportPlan} className="full-width">Download this proposal ↓</Action><p className="small-note">{!config.paypal ? 'PayPal Sandbox connection is pending. You can save the proposal now.' : 'Buyers will approve their own holds in PayPal Sandbox.'}</p></section></div>}
  </div>;
}
