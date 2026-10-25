'use client';

import { useRef, useState } from 'react';
import developmentSet from '../../tests/fixtures/local-ai-eval.json';
import holdoutSet from '../../tests/fixtures/local-ai-holdout-v1.json';
import { createBatchPolicy } from '../../lib/batch-domain';
import { analyzeLocalRequests, checkLocalAISupport, LOCAL_MODEL } from '../../lib/local-ai';
import type { LocalAIProgress, LocalAIRecord, LocalAIResult } from '../../lib/local-ai';
import { normalizeLocalContent, normalizeEvidenceSpans, LOCAL_PIPELINE_VERSION, LOCAL_SYSTEM_PROMPT, LOCAL_SPAN_SCHEMA } from '../../lib/local-ai-core';

const DATASET_HASHES = { development: 'cdf55112d8e34d8defb794156eac278d102b56597a179134a7ccf1afb1550397', holdout: 'd18492c8c0ed3faeb7758a322b82e40214cbcc7a9602adfff55aaf8cc78607a6' };
const fields = ['product', 'quantity', 'variant', 'unitBudgetCents', 'deadline'] as const;
type Field = typeof fields[number];
type Counts = { fields: number; exact: number; wrongNonNull: number; knownFields: number; knownRecovered: number; unknownFields: number; nullCorrect: number };

function counts(records: LocalAIRecord[], raw: boolean, dataset: typeof developmentSet | typeof holdoutSet, group?: string): Counts {
  const score = { fields: 0, exact: 0, wrongNonNull: 0, knownFields: 0, knownRecovered: 0, unknownFields: 0, nullCorrect: 0 };
  for (const row of records) {
    const fixture = dataset.cases.find((item) => item.id === row.requestId);
    if (!fixture || (group && fixture.group !== group)) continue;
    let output: Partial<Record<Field, { value?: unknown }>> = row.analyzed.extraction;
    if (raw) {
      try {
        const spans = JSON.parse(normalizeLocalContent(row.content ?? 'null')) ?? {};
        output = {};
        for (const field of fields) {
          const isolated = Object.fromEntries(fields.map((name) => [name, name === field ? spans[field] : null]));
          const normalized = normalizeEvidenceSpans(fixture.source, JSON.stringify(isolated));
          output[field] = { value: normalized.extraction ? normalized.extraction[field].value : '[rejected evidence]' };
        }
      } catch { output = {}; }
    }
    for (const field of fields) {
      const expected = fixture.expected[field].value;
      const actual = output?.[field]?.value;
      score.fields++;
      if (actual === expected) score.exact++;
      if (actual !== null && actual !== undefined && actual !== expected) score.wrongNonNull++;
      if (expected === null) { score.unknownFields++; if (actual === null) score.nullCorrect++; }
      else { score.knownFields++; if (actual === expected) score.knownRecovered++; }
    }
  }
  return score;
}

const pct = (part: number, total: number) => total ? `${(part / total * 100).toFixed(1)}% (${part}/${total})` : 'Not measured';

export default function Evaluation() {
  const [datasetKey, setDatasetKey] = useState<'development' | 'holdout'>('development');
  const dataset = datasetKey === 'development' ? developmentSet : holdoutSet;
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<LocalAIProgress | null>(null);
  const [records, setRecords] = useState<LocalAIRecord[]>([]);
  const [result, setResult] = useState<LocalAIResult | null>(null);
  const [support, setSupport] = useState<Awaited<ReturnType<typeof checkLocalAISupport>> | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  const cancel = useRef<AbortController | null>(null);
  const rawScore = counts(records, true, dataset);
  const validatedScore = counts(records, false, dataset);

  async function run() {
    if (running) return;
    setRunning(true); setRecords([]); setResult(null); setProgress(null); setDiagnostic(null);
    setStartedAt(new Date().toISOString());
    const controller = new AbortController(); cancel.current = controller;
    try {
      setSupport(await checkLocalAISupport());
      const outcome = await analyzeLocalRequests(dataset.cases.map((item) => item.source), createBatchPolicy(dataset.referencePolicy.shipBy), {
        signal: controller.signal, onProgress: setProgress,
        onRecord: (record) => setRecords((previous) => [...previous, record]),
        onDiagnostic: setDiagnostic,
      });
      setResult(outcome);
    } finally { setRunning(false); cancel.current = null; }
  }

  function actualReport() {
    return {
      reportVersion: 1, datasetId: dataset.corpusId, datasetSha256: DATASET_HASHES[datasetKey],
      startedAt, exportedAt: new Date().toISOString(), model: LOCAL_MODEL,
      analysisContract: { version: LOCAL_PIPELINE_VERSION, systemPrompt: LOCAL_SYSTEM_PROMPT, schema: LOCAL_SPAN_SCHEMA, grammar: 'Per-request field enums contain only literal source spans or null.', temperature: 0, seed: 17, maxTokens: 640 },
      environment: { userAgent: navigator.userAgent, secureContext: window.isSecureContext, support },
      caveats: ['Synthetic, not real customer data.', `${dataset.cases.length} cases; no population-level accuracy claim.`, 'Some Korean evidence grammar is intentionally unsupported by the application parser.', 'Cancelled/failed runs may contain diagnostic records but never accepted partial product results.'],
      result, diagnostic, fieldLevelSpanScore: rawScore, validatedSystemFieldScore: validatedScore,
      groups: [...new Set(dataset.cases.map((item) => item.group))].map((group) => ({ group, spans: counts(records, true, dataset, group), validated: counts(records, false, dataset, group) })),
      records,
    };
  }

  function exportResults() {
    if (!result) return;
    const report = actualReport();
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url;
    anchor.download = `batchloom-local-ai-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <main style={{ maxWidth: 1160, margin: '0 auto', padding: '40px 24px 80px', fontFamily: 'Arial, sans-serif', color: '#253229' }}>
    <a href="/" style={{ color: '#294fb8' }}>← Back to Batchloom</a>
    <p style={{ marginTop: 28, letterSpacing: 2, fontSize: 12 }}>BATCHLOOM / TRANSPARENT MODEL EVALUATION</p>
    <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 42, margin: '16px 0' }}>A small model. An honest test.</h1>
    <p style={{ lineHeight: 1.7, maxWidth: 850 }}>Run fixed synthetic requests through the real local model: a 24-case development set, or 6 separately authored English holdout cases. No API key, no paid inference, no customer text upload. Initial model assets download from their official hosts (about 1 GB); about 2 GB of GPU memory may be needed. This screen never opens a batch or moves money.</p>
    <p style={{ fontSize: 13, lineHeight: 1.7 }}>The model selects exact source spans. Code derives quantities and cents without asking the model to calculate. Each span is scored separately, then the complete record is checked: one bad span holds the whole record. A null counts as correct only when the reference is unknown. Unsupported Korean evidence syntax may cause safe abstention. Small synthetic samples cannot establish production accuracy.</p>
    <label style={{ fontSize: 14 }}>Evaluation set <select aria-label="Evaluation set" value={datasetKey} disabled={running} onChange={(event) => { setDatasetKey(event.target.value as 'development' | 'holdout'); setRecords([]); setResult(null); setProgress(null); }} style={{ padding: 10, marginLeft: 12, border: '1px solid #65716a', background: '#fffdf7' }}><option value="development">24 development cases</option><option value="holdout">6 independent English holdout cases</option></select></label>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, margin: '24px 0' }}>
      <button onClick={run} disabled={running} style={{ padding: '14px 20px', background: running ? '#7b879f' : '#294fb8', border: 0, borderRadius: 6, color: 'white', fontSize: 14, cursor: running ? 'wait' : 'pointer' }}>Download model & run {dataset.cases.length} cases</button>
      <button onClick={() => cancel.current?.abort()} disabled={!running} style={{ padding: '14px 20px', border: '1px solid #65716a', borderRadius: 6, background: '#f8f5ed', fontSize: 14 }}>Cancel run</button>
      <button onClick={exportResults} disabled={!result} style={{ padding: '14px 20px', border: '1px solid #65716a', borderRadius: 6, background: '#f8f5ed', fontSize: 14 }}>Export actual results JSON</button>
    </div>
    <section role="status" aria-live="polite" style={{ border: '1px solid #c5cdc4', borderRadius: 8, padding: 20, background: '#edf1e8' }}>
      <strong>{result ? `Run ${result.status}` : running ? 'Real model running' : 'Not run yet'}</strong>
      <p>{progress?.message ?? 'Start the test to download or reuse the model, then analyze requests one at a time.'}</p>
      {running && <progress value={progress?.progress ?? 0} max={1} style={{ width: '100%' }} />}
      {progress && <p style={{ fontSize: 13 }}>{progress.phase} · {progress.completed}/{progress.total} requests completed</p>}
      {support && <p style={{ fontSize: 13 }}>{support.message}</p>}
      {result && result.status !== 'complete' && <p>{result.issues.map((issue) => issue.message).join(' ')}</p>}
      {diagnostic && <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>Diagnostic: {diagnostic}</pre>}
    </section>
    <section style={{ marginTop: 28, overflowX: 'auto' }}>
      <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 28 }}>Observed results</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, lineHeight: 1.7 }}>
        <thead><tr><th style={{ textAlign: 'left', padding: 12 }}>Metric</th><th>Each evidenced field</th><th>Accepted whole records</th></tr></thead>
        <tbody>{[
          ['Exact field value', pct(rawScore.exact, rawScore.fields), pct(validatedScore.exact, validatedScore.fields)],
          ['Known field recovered', pct(rawScore.knownRecovered, rawScore.knownFields), pct(validatedScore.knownRecovered, validatedScore.knownFields)],
          ['Correct unknown', pct(rawScore.nullCorrect, rawScore.unknownFields), pct(validatedScore.nullCorrect, validatedScore.unknownFields)],
          ['Incorrect or unsupported non-null fields', String(rawScore.wrongNonNull), String(validatedScore.wrongNonNull)],
        ].map((cells) => <tr key={cells[0]} style={{ borderTop: '1px solid #c5cdc4' }}>{cells.map((cell, i) => <td key={i} style={{ padding: 12, textAlign: i ? 'center' : 'left' }}>{cell}</td>)}</tr>)}</tbody>
      </table>
      <p style={{ fontSize: 13 }}>{records.length} model responses observed. {records.filter((row) => row.analyzed.status === 'needs_review').length} held for review. {result?.elapsedMs ? `Total elapsed including load: ${(result.elapsedMs / 1000).toFixed(1)} seconds.` : ''}</p>
    </section>
    <section style={{ marginTop: 28 }}><h2 style={{ fontFamily: 'Georgia, serif', fontSize: 28 }}>Every case, including failures</h2>
      {dataset.cases.map((fixture) => {
        const record = records.find((row) => row.requestId === fixture.id);
        return <details key={fixture.id} style={{ borderTop: '1px solid #c5cdc4', padding: '16px 0' }}>
          <summary style={{ cursor: 'pointer', fontSize: 14 }}>{fixture.id} · {record ? `${record.analyzed.status} · ${(record.elapsedMs / 1000).toFixed(1)}s` : 'not run'}</summary>
          <p style={{ lineHeight: 1.7 }}>{fixture.source.body}</p>
          <p style={{ fontSize: 13 }}>Parser support: {fixture.applicationSupport.grounding}</p>
          {record && <><p style={{ color: '#7a3f31', fontSize: 13 }}>{record.analyzed.issues.map((issue) => issue.message).join(' ')}</p><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12, background: '#f0eee6', padding: 16 }}>{record.content}</pre></>}
        </details>;
      })}
    </section>
    {result && <details style={{ marginTop: 28 }}><summary style={{ cursor: 'pointer' }}>View actual JSON report</summary><textarea aria-label="Actual evaluation JSON" readOnly value={JSON.stringify(actualReport(), null, 2)} style={{ width: '100%', height: 360, marginTop: 16, fontFamily: 'monospace', fontSize: 12 }} /></details>}
    <footer style={{ marginTop: 30, fontSize: 11, overflowWrap: 'anywhere', lineHeight: 1.8 }}>Model: {LOCAL_MODEL.id} · runtime {LOCAL_MODEL.runtimeVersion}<br />Model revision: {LOCAL_MODEL.revision}<br />Dataset SHA-256: {DATASET_HASHES[datasetKey]}<br />Analysis contract: {LOCAL_PIPELINE_VERSION}</footer>
  </main>;
}

