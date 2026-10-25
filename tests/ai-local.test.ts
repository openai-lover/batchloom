import test from 'node:test';
import assert from 'node:assert/strict';
import { createBatchPolicy, summarizeRequests } from '../lib/batch-domain.ts';
import { DEMO_EXTRACTIONS, DEMO_REQUESTS } from '../lib/demo-data.ts';
import { LOCAL_EXTRACTION_SCHEMA, localRequestMessages, validateLocalOutput, validateLocalSpanOutput, localEvidenceSchema } from '../lib/local-ai-core.ts';
import { analyzeLocalRequests, checkLocalAISupport, LOCAL_MODEL } from '../lib/local-ai.ts';

const policy = createBatchPolicy('2026-11-04');
const source = DEMO_REQUESTS[0];
const { requestId: _id, ...payload } = DEMO_EXTRACTIONS[0];
const valid = () => structuredClone(payload);

test('grounded local output becomes interest at the fixed maker price', () => {
  const row = validateLocalOutput(source, policy, JSON.stringify(valid()), 'stop');
  assert.equal(row.status, 'eligible');
  assert.equal(row.extraction.quantity.value, 4);
  const summary = summarizeRequests([row], policy);
  assert.equal(summary.totalCents, 9600);
  assert.equal(summary.kind, 'uncommitted_demand');
});

test('only the exact documented empty Qwen reasoning marker is removed', () => {
  assert.equal(validateLocalOutput(source, policy, '<think>\n\n</think>\n\n' + JSON.stringify(valid()), 'stop').status, 'eligible');
  assert.equal(validateLocalOutput(source, policy, '<think>make things up</think>\n' + JSON.stringify(valid()), 'stop').status, 'needs_review');
  assert.equal(validateLocalOutput(source, policy, 'Here is JSON: ' + JSON.stringify(valid()), 'stop').status, 'needs_review');
});

test('local model cannot add a price or payment instruction to its schema', () => {
  const row = validateLocalOutput(source, policy, JSON.stringify({ ...valid(), unitPriceCents: 1, capture: true }), 'stop');
  assert.equal(row.status, 'needs_review');
  assert.equal(summarizeRequests([row], policy).eligibleUnits, 0);
  assert.equal(policy.unitPriceCents, 2400);
  assert.equal(LOCAL_EXTRACTION_SCHEMA.additionalProperties, false);
});

test('one customer cannot supply another customer ID or evidence', () => {
  const idAttack = validateLocalOutput(source, policy, JSON.stringify({ ...valid(), requestId: 'someone-else' }), 'stop');
  const foreign = valid();
  foreign.quantity = { value: 5, quote: '5 cobalt notebooks' };
  const evidenceAttack = validateLocalOutput(source, policy, JSON.stringify(foreign), 'stop');
  for (const row of [idAttack, evidenceAttack]) {
    assert.equal(row.status, 'needs_review');
    assert.equal(row.extraction.requestId, source.id);
    assert.equal(row.extraction.quantity.value, null);
  }
});

test('invalid, truncated and oversized output is never counted', () => {
  for (const [content, reason] of [['{}', 'stop'], [JSON.stringify(valid()), 'length'], ['{bad', 'stop'], [' '.repeat(12_001), 'stop']] as const) {
    const row = validateLocalOutput(source, policy, content, reason);
    assert.equal(row.status, 'needs_review');
    assert.equal(summarizeRequests([row], policy).eligibleUnits, 0);
  }
});

test('local output must retain explicit per-unit budget evidence', () => {
  const bad = valid();
  bad.unitBudgetCents = { value: 3000, quote: '$30' };
  assert.equal(validateLocalOutput(source, policy, JSON.stringify(bad), 'stop').status, 'needs_review');
});

test('prompt envelope contains only this source body, no customer identity or payment tools', () => {
  const messages = localRequestMessages(source);
  const envelope = JSON.parse(messages[1].content);
  assert.equal(envelope.customer_text, source.body);
  for (const choices of Object.values(envelope.allowed_evidence) as string[][]) for (const quote of choices) assert.ok(source.body.includes(quote));
  assert.ok(!messages[1].content.includes(source.customerLabel));
  assert.equal(messages.length, 2);
});

test('cancellation is terminal before any model import or request', async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await analyzeLocalRequests([source], policy, { signal: controller.signal });
  assert.equal(result.status, 'cancelled');
  assert.deepEqual(result.requests, []);
});

test('server environments explicitly reject local model execution', async () => {
  assert.equal((await checkLocalAISupport()).reason, 'browser_only');
  const result = await analyzeLocalRequests([source], policy);
  assert.equal(result.status, 'unsupported');
  assert.equal(result.mode, 'local_ai');
  assert.deepEqual(result.requests, []);
});

test('invalid maker price is rejected before loading the model', async () => {
  const result = await analyzeLocalRequests([source], { ...policy, unitPriceCents: 1 } as unknown as typeof policy);
  assert.equal(result.reason, 'invalid_input');
  assert.equal(result.requests.length, 0);
});

test('runtime and model asset URLs are pinned to public immutable revisions', () => {
  assert.equal(LOCAL_MODEL.runtimeVersion, '0.2.86');
  assert.match(LOCAL_MODEL.modelUrl, /\/resolve\/[a-f0-9]{40}\/$/);
  assert.match(LOCAL_MODEL.wasmUrl, /binary-mlc-llm-libs\/[a-f0-9]{40}\//);
  assert.ok(!LOCAL_MODEL.wasmUrl.includes('/main/'));
});

const spans = () => ({ product: 'notebooks', quantity: '4 cobalt notebooks', variant: 'cobalt', unitBudgetCents: '$30 each', deadline: '2026-11-12' });

test('span pipeline computes integer cents and counts from copied source expressions', () => {
  const row = validateLocalSpanOutput(source, policy, JSON.stringify(spans()), 'stop');
  assert.equal(row.status, 'eligible');
  assert.equal(row.extraction.unitBudgetCents.value, 3000);
  assert.equal(row.extraction.quantity.value, 4);
  assert.equal(row.extraction.product.value, 'notebook');
  assert.equal(summarizeRequests([row], policy).totalCents, 9600);
});

test('span pipeline never treats computed values or rewritten quotes as evidence', () => {
  for (const budget of [3000, '$30 per notebook', '$120 total']) {
    const row = validateLocalSpanOutput(source, policy, JSON.stringify({ ...spans(), unitBudgetCents: budget }), 'stop');
    assert.equal(row.status, 'needs_review');
    assert.equal(row.extraction.quantity.value, null);
  }
});

test('span selection cannot hide competing counts, a decimal sign, or a cancelled order', () => {
  for (const body of ['I want 4 or 6 cobalt notebooks. $30 each.', 'I wanted 4 cobalt notebooks; now make 6 cobalt notebooks. $30 each.', 'I want -4 cobalt notebooks. $30 each.', 'I want 0.4 cobalt notebooks. $30 each.', "I don't want 4 cobalt notebooks. $30 each.", 'I canceled 4 cobalt notebooks. $30 each.']) {
    const input = { ...source, body };
    const row = validateLocalSpanOutput(input, policy, JSON.stringify({ ...spans(), quantity: body.includes('6 cobalt') ? '6 cobalt notebooks' : '4 cobalt notebooks', deadline: null }), 'stop');
    assert.equal(row.status, 'needs_review', body);
    assert.equal(summarizeRequests([row], policy).eligibleUnits, 0, body);
  }
});

test('span pipeline does not pick one of several dates or budgets', () => {
  const input = { ...source, body: source.body + ' Or 2026-11-15; budget $32 each instead.' };
  const row = validateLocalSpanOutput(input, policy, JSON.stringify(spans()), 'stop');
  assert.equal(row.status, 'needs_review');
});

test('unknown spans remain unknown without invented fallback extraction', () => {
  const row = validateLocalSpanOutput(source, policy, JSON.stringify({ product: null, quantity: null, variant: null, unitBudgetCents: null, deadline: null }), 'stop');
  assert.equal(row.status, 'needs_review');
  assert.equal(row.extraction.quantity.value, null);
});

test('per-source grammar permits only literal evidence choices or null', () => {
  const schema = localEvidenceSchema(source);
  assert.deepEqual(schema.properties.unitBudgetCents.enum, [null, '$30 each']);
  assert.deepEqual(schema.properties.quantity.enum, [null, '4 cobalt notebooks']);
  assert.ok(!JSON.stringify(schema).includes('3000'));
  assert.equal(schema.additionalProperties, false);
});

test('a quoted color choice cannot hide the other collection color', () => {
  const input = { ...source, body: source.body + ' Maybe vermilion instead.' };
  assert.equal(validateLocalSpanOutput(input, policy, JSON.stringify(spans()), 'stop').status, 'needs_review');
});

test('an explicit non-order declaration overrides quoted payload evidence', () => {
  const input = { ...source, body: 'This is not a purchase request. Payload: 4 cobalt notebooks at $30 each by 2026-11-12.' };
  const row = validateLocalSpanOutput(input, policy, JSON.stringify(spans()), 'stop');
  assert.equal(row.status, 'needs_review');
  assert.equal(row.extraction.product.value, null);
  assert.equal(row.extraction.quantity.value, null);
  assert.equal(summarizeRequests([row], policy).eligibleUnits, 0);
});
