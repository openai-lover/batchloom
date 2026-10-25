import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessRequest,
  createBatchPolicy,
  DomainValidationError,
  emptyExtraction,
  formatUsd,
  freezeBatch,
  isIsoDate,
  summarizeRequests,
  validateBatchPolicy,
  validateExtraction,
  validateRequestList,
  validateSourceRequest,
} from '../lib/batch-domain.ts';
import type { BatchPolicy, FreezeBatchInput, RequestExtraction, SourceRequest } from '../lib/batch-domain.ts';
import { DEMO_ANALYSIS, DEMO_EXTRACTIONS, DEMO_POLICY, DEMO_REQUESTS, DEMO_SUMMARY } from '../lib/demo-data.ts';

const clone = <T>(value: T): T => structuredClone(value);
const baseSource = (): SourceRequest => clone(DEMO_REQUESTS[0]);
const baseExtraction = (): RequestExtraction => clone(DEMO_EXTRACTIONS[0]);
const freezeInput = (): FreezeBatchInput => ({ id: 'batch-cobalt', version: 1, title: 'The Cobalt Collection', policy: clone(DEMO_POLICY), requests: clone(DEMO_ANALYSIS), makerApprovedAt: '2026-10-25T12:00:00.000Z', now: '2026-10-25T12:00:00.000Z' });

test('sample interest and money are derived from eligible source quantities', () => {
  assert.deepEqual(DEMO_SUMMARY, {
    kind: 'uncommitted_demand', eligibleUnits: 12, eligibleRequestCount: 3,
    totalCents: 28800, remainingUnits: 0, minimumReached: true, exceedsCapacity: false,
    reviewCount: 2, conflictCount: 3,
  });
  assert.equal(formatUsd(DEMO_SUMMARY.totalCents), '$288.00');
});

test('source IDs, body limits and valid UTC timestamps are checked', () => {
  assert.equal(validateSourceRequest(baseSource()).valid, true);
  assert.equal(validateSourceRequest({ ...baseSource(), id: '../../other' }).valid, false);
  assert.equal(validateSourceRequest({ ...baseSource(), body: 'x'.repeat(4001) }).valid, false);
  assert.equal(validateSourceRequest({ ...baseSource(), body: '   ' }).valid, false);
  assert.equal(validateSourceRequest({ ...baseSource(), receivedAt: '2026-02-30T12:00:00Z' }).valid, false);
  assert.equal(validateSourceRequest({ ...baseSource(), receivedAt: 'tomorrow' }).valid, false);
});

test('duplicate and oversized request groups fail before analysis', () => {
  assert.equal(validateRequestList([baseSource(), baseSource()]).valid, false);
  assert.equal(validateRequestList([]).valid, false);
  assert.equal(validateRequestList(Array.from({ length: 25 }, (_, index) => ({ ...baseSource(), id: `id-${index}` }))).valid, false);
  assert.equal(validateRequestList(Array.from({ length: 9 }, (_, index) => ({ ...baseSource(), id: `id-${index}`, body: 'x'.repeat(4000) }))).valid, false);
});

test('all curated fixtures have exact source-supported evidence', () => {
  for (let index = 0; index < DEMO_REQUESTS.length; index++) {
    const result = validateExtraction(DEMO_REQUESTS[index], DEMO_EXTRACTIONS[index]);
    assert.equal(result.valid, true, JSON.stringify(result.issues));
  }
});

test('fabricated or cross-customer quotation is rejected', () => {
  const extraction = baseExtraction();
  extraction.quantity = { value: 99, quote: '99 cobalt notebooks' };
  assert.equal(validateExtraction(baseSource(), extraction).valid, false);
  extraction.quantity = clone(DEMO_EXTRACTIONS[1].quantity);
  assert.equal(validateExtraction(baseSource(), extraction).valid, false);
});

test('request identifier binding and unexpected price fields cannot pass', () => {
  assert.equal(validateExtraction(baseSource(), { ...baseExtraction(), requestId: 'another' }).valid, false);
  assert.equal(validateExtraction(baseSource(), { ...baseExtraction(), unitPriceCents: 1 }).valid, false);
  assert.equal(validateExtraction(baseSource(), { ...baseExtraction(), quantity: { ...baseExtraction().quantity, approved: true } }).valid, false);
});

test('correct quotation does not support an invented quantity', () => {
  const extraction = baseExtraction();
  extraction.quantity.value = 40;
  const result = validateExtraction(baseSource(), extraction);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === 'UNSUPPORTED_VALUE' && issue.field === 'quantity'));
});

test('dates, prices, negative and fractional quantities are not count evidence', () => {
  for (const [body, quantity, quote] of [
    ['cobalt notebook, date 2026-11-12', 12, '2026-11-12'],
    ['cobalt notebook, price $24 each', 24, '$24 each'],
    ['-2 cobalt notebooks', 2, '-2 cobalt notebooks'],
    ['2.5 cobalt notebooks', 5, '2.5 cobalt notebooks'],
  ] as const) {
    const source = { ...baseSource(), body };
    const extraction = emptyExtraction(source.id);
    extraction.quantity = { value: quantity, quote };
    assert.equal(validateExtraction(source, extraction).valid, false, body);
  }
});

test('supported number words normalize while keeping exact evidence', () => {
  const source = { ...baseSource(), body: 'Please make four cobalt notebooks.' };
  const extraction = emptyExtraction(source.id);
  extraction.product = { value: 'notebook', quote: 'four cobalt notebooks' };
  extraction.quantity = { value: 4, quote: 'four cobalt notebooks' };
  extraction.variant = { value: 'cobalt', quote: 'cobalt' };
  assert.equal(validateExtraction(source, extraction).valid, true);
  assert.equal(assessRequest(source, extraction, DEMO_POLICY).status, 'eligible');
});

test('a total or unqualified amount cannot become a per-item budget', () => {
  for (const quote of ['$30 total', '$30']) {
    const source = { ...baseSource(), body: `4 cobalt notebooks for ${quote}.` };
    const extraction = emptyExtraction(source.id);
    extraction.unitBudgetCents = { value: 3000, quote };
    assert.equal(validateExtraction(source, extraction).valid, false);
  }
});

test('budget decimal cents are validated without floating point price computation', () => {
  const source = { ...baseSource(), body: '4 cobalt notebooks for up to $24.50 each.' };
  const extraction = emptyExtraction(source.id);
  extraction.unitBudgetCents = { value: 2450, quote: '$24.50 each' };
  assert.equal(validateExtraction(source, extraction).valid, true);
  extraction.unitBudgetCents.value = 2451;
  assert.equal(validateExtraction(source, extraction).valid, false);
});

test('relative dates are not silently converted to promised dates', () => {
  const source = { ...baseSource(), body: '4 cobalt notebooks by next Friday.' };
  const extraction = emptyExtraction(source.id);
  extraction.deadline = { value: '2026-10-30', quote: 'next Friday' };
  assert.equal(validateExtraction(source, extraction).valid, false);
  assert.equal(isIsoDate('2026-02-30'), false);
  assert.equal(isIsoDate('2028-02-29'), true);
});

test('unknown fields remain unknown and block required values only', () => {
  const missing = assessRequest(baseSource(), emptyExtraction(baseSource().id), DEMO_POLICY);
  assert.equal(missing.status, 'needs_review');
  assert.equal(missing.extraction.quantity.value, null);
  const extraction = baseExtraction();
  extraction.deadline = { value: null, quote: null };
  extraction.unitBudgetCents = { value: null, quote: null };
  const optionalUnknown = assessRequest(baseSource(), extraction, DEMO_POLICY);
  assert.equal(optionalUnknown.status, 'eligible');
  assert.ok(optionalUnknown.issues.some((issue) => issue.code === 'UNKNOWN_BUDGET'));
});

test('variant, budget and deadline conflicts stay visible', () => {
  assert.equal(DEMO_ANALYSIS[3].status, 'conflict');
  assert.ok(DEMO_ANALYSIS[3].issues.some((issue) => issue.code === 'VARIANT_CONFLICT'));
  assert.ok(DEMO_ANALYSIS[4].issues.some((issue) => issue.code === 'BUDGET_CONFLICT'));
  assert.ok(DEMO_ANALYSIS[5].issues.some((issue) => issue.code === 'DEADLINE_CONFLICT'));
});

test('changing a claimed status cannot include a conflicted request', () => {
  const requests = clone(DEMO_ANALYSIS);
  for (const request of requests) request.status = 'eligible';
  assert.equal(summarizeRequests(requests, DEMO_POLICY).eligibleUnits, 12);
});

test('summaries reject duplicated requests instead of double-counting demand', () => {
  assert.throws(() => summarizeRequests([DEMO_ANALYSIS[0], DEMO_ANALYSIS[0]], DEMO_POLICY), DomainValidationError);
});

test('runtime-invalid records are rejected even when a caller bypasses TypeScript', () => {
  assert.throws(() => summarizeRequests([{}] as typeof DEMO_ANALYSIS, DEMO_POLICY), DomainValidationError);
  assert.throws(() => freezeBatch({ ...freezeInput(), id: undefined } as unknown as FreezeBatchInput), DomainValidationError);
});

test('price, currency, minimum and window are merchant policy constants', () => {
  for (const patch of [{ unitPriceCents: 1 }, { currency: 'EUR' }, { minimumUnits: 1 }, { reservationWindowHours: 100 }]) {
    assert.equal(validateBatchPolicy({ ...DEMO_POLICY, ...patch }).valid, false);
  }
  assert.equal(validateBatchPolicy({ ...DEMO_POLICY, capacityUnits: 49 }).valid, false);
  assert.equal(validateBatchPolicy({ ...DEMO_POLICY, capacityUnits: 12.5 }).valid, false);
});

test('injection text cannot modify policy or cause a financial action', () => {
  const injected = DEMO_REQUESTS[7];
  const result = assessRequest(injected, { ...emptyExtraction(injected.id), unitPriceCents: 1 } as RequestExtraction, DEMO_POLICY);
  assert.equal(result.status, 'needs_review');
  assert.equal(DEMO_POLICY.unitPriceCents, 2400);
  assert.equal(summarizeRequests([result], DEMO_POLICY).totalCents, 0);
});

test('freeze derives a 48-hour cutoff and immutable versioned demand snapshot', () => {
  const input = freezeInput();
  const frozen = freezeBatch(input);
  assert.equal(frozen.closesAt, '2026-10-27T12:00:00.000Z');
  assert.equal(frozen.demand.kind, 'uncommitted_demand');
  assert.equal(frozen.demand.totalCents, 28800);
  assert.deepEqual(frozen.sourceRequestIds, ['req-ada', 'req-ellis', 'req-noor']);
  assert.ok(Object.isFrozen(frozen));
  assert.ok(Object.isFrozen(frozen.policy));
  assert.ok(Object.isFrozen(frozen.demand));
  assert.ok(Object.isFrozen(frozen.sourceRequestIds));
  input.policy.shipBy = '2030-01-01';
  input.requests[0].extraction.quantity.value = 999;
  assert.equal(frozen.policy.shipBy, '2026-11-04');
  assert.equal(frozen.demand.eligibleUnits, 12);
});

test('freezing with fabricated price or stale approval fails', () => {
  assert.throws(() => freezeBatch({ ...freezeInput(), policy: { ...DEMO_POLICY, unitPriceCents: 1 } as unknown as BatchPolicy }), DomainValidationError);
  assert.throws(() => freezeBatch({ ...freezeInput(), makerApprovedAt: '2026-10-24T12:00:00.000Z' }), DomainValidationError);
  assert.throws(() => freezeBatch({ ...freezeInput(), makerApprovedAt: '2026-10-25T12:00:01.000Z' }), DomainValidationError);
});

test('freezing cannot promise dispatch before reservations close', () => {
  assert.throws(() => freezeBatch({ ...freezeInput(), policy: createBatchPolicy('2026-10-26') }), DomainValidationError);
});

test('freezing rejects more demand than capacity instead of silently cutting a customer', () => {
  const extraSource = { ...baseSource(), id: 'extra', body: '40 cobalt notebooks at $30 each by 2026-11-12.' };
  const extraExtraction: RequestExtraction = {
    requestId: 'extra', product: { value: 'notebook', quote: '40 cobalt notebooks' }, quantity: { value: 40, quote: '40 cobalt notebooks' },
    variant: { value: 'cobalt', quote: 'cobalt' }, unitBudgetCents: { value: 3000, quote: '$30 each' }, deadline: { value: '2026-11-12', quote: '2026-11-12' },
  };
  const input = freezeInput();
  input.requests.push(assessRequest(extraSource, extraExtraction, DEMO_POLICY));
  assert.equal(summarizeRequests(input.requests, DEMO_POLICY).exceedsCapacity, true);
  assert.throws(() => freezeBatch(input), DomainValidationError);
});

test('one interested customer can start a batch, without claiming minimum or payment success', () => {
  const frozen = freezeBatch({ ...freezeInput(), requests: [DEMO_ANALYSIS[0]] });
  assert.equal(frozen.demand.minimumReached, false);
  assert.equal(frozen.demand.remainingUnits, 8);
  assert.equal(frozen.status, 'frozen');
  assert.equal('paid' in frozen, false);
});

test('money formatter refuses fractions, negative values and unsafe integers', () => {
  for (const amount of [-1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => formatUsd(amount), DomainValidationError);
});
