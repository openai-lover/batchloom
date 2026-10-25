import assert from 'node:assert/strict';
import test from 'node:test';
import { freezeBatch, validateExtraction, validateSourceRequest } from '../lib/batch-domain.ts';
import { createDemoScenario, DEMO_ANALYSIS, DEMO_EXTRACTIONS, DEMO_POLICY, DEMO_REQUESTS, DEMO_SUMMARY } from '../lib/demo-data.ts';

test('future judging date moves messages, timestamps, policy and exact quotation evidence together', () => {
  const scenario = createDemoScenario('2026-12-15T12:30:00.000Z');
  assert.equal(scenario.referenceDate, '2026-12-15');
  assert.equal(scenario.policy.shipBy, '2026-12-25');
  assert.equal(scenario.requests[0].receivedAt, '2026-12-15T08:10:00.000Z');
  assert.match(scenario.requests[0].body, /by 2027-01-02\./);
  assert.deepEqual(scenario.analysis[0].extraction.deadline, { value: '2027-01-02', quote: 'by 2027-01-02' });
  assert.equal(scenario.analysis[2].extraction.deadline.value, '2026-12-30');
  assert.match(scenario.label, /^Synthetic scenario dated 2026-12-15/);
  assert.match(scenario.label, /not a live AI run/);
  for (const item of scenario.analysis) {
    assert.equal(validateSourceRequest(item.source).valid, true, item.source.id);
    assert.equal(validateExtraction(item.source, item.extraction).valid, true, item.source.id);
  }
});

test('the future synthetic batch can still freeze after a real 48-hour reservation window', () => {
  const now = '2026-12-15T23:59:59.000Z';
  const scenario = createDemoScenario(now);
  const frozen = freezeBatch({ id: 'judge-cobalt', version: 1, title: 'Cobalt Field Notes', policy: scenario.policy, requests: scenario.analysis, makerApprovedAt: now, now });
  assert.equal(frozen.closesAt, '2026-12-17T23:59:59.000Z');
  assert.equal(frozen.policy.shipBy, '2026-12-25');
  assert.equal(frozen.demand.eligibleUnits, 12);
  assert.deepEqual(frozen.sourceRequestIds, ['req-ada', 'req-ellis', 'req-noor']);
});

test('ambiguity, unsupported instructions and conflicts remain unresolved after moving the dates', () => {
  const scenario = createDemoScenario('2026-12-15');
  const byId = new Map(scenario.analysis.map((request) => [request.source.id, request]));
  assert.equal(byId.get('req-quinn')?.status, 'needs_review');
  assert.deepEqual(byId.get('req-quinn')?.extraction.quantity, { value: null, quote: null });
  assert.deepEqual(byId.get('req-quinn')?.extraction.deadline, { value: null, quote: null });
  assert.equal(byId.get('req-test')?.status, 'needs_review');
  assert.ok(byId.get('req-test')?.issues.some((issue) => issue.code === 'MISSING_REQUIRED_VALUE'));
  assert.equal(byId.get('req-moss')?.status, 'conflict');
  assert.equal(byId.get('req-june')?.status, 'conflict');
  assert.equal(byId.get('req-rory')?.status, 'conflict');
  assert.equal(byId.get('req-rory')?.extraction.deadline.value, '2026-12-19');
  assert.deepEqual(scenario.summary, DEMO_SUMMARY);
});

test('the reference day follows UTC across offsets, midnight and a leap day', () => {
  const localEvening = createDemoScenario('2026-12-15T23:30:00-05:00');
  assert.equal(localEvening.referenceDate, '2026-12-16');
  assert.equal(localEvening.requests[0].receivedAt, '2026-12-16T08:10:00.000Z');
  const leapDay = createDemoScenario(new Date('2028-02-29T00:00:00.000Z'));
  assert.equal(leapDay.referenceDate, '2028-02-29');
  assert.equal(leapDay.policy.shipBy, '2028-03-10');
  assert.equal(leapDay.requests[0].receivedAt, '2028-02-29T08:10:00.000Z');
});

test('fresh scenarios do not mutate the fixed fixtures or leak edits into the next visitor', () => {
  const originals = structuredClone({ DEMO_REQUESTS, DEMO_POLICY, DEMO_ANALYSIS, DEMO_EXTRACTIONS });
  const first = createDemoScenario('2026-12-15');
  first.requests[0].body = 'Changed by a visitor';
  first.policy.shipBy = '2027-01-30';
  first.analysis[0].extraction.deadline.quote = 'Changed evidence';
  const next = createDemoScenario('2026-12-15');
  assert.notEqual(next.requests[0].body, first.requests[0].body);
  assert.equal(next.policy.shipBy, '2026-12-25');
  assert.equal(next.analysis[0].extraction.deadline.quote, 'by 2027-01-02');
  assert.deepEqual({ DEMO_REQUESTS, DEMO_POLICY, DEMO_ANALYSIS, DEMO_EXTRACTIONS }, originals);
  assert.equal(DEMO_POLICY.shipBy, '2026-11-04');
  assert.match(DEMO_REQUESTS[0].body, /2026-11-12/);
});

test('invalid calendar dates fail instead of silently moving the scenario', () => {
  assert.throws(() => createDemoScenario('not-a-date'), RangeError);
  assert.throws(() => createDemoScenario('2026-02-30'), RangeError);
  assert.throws(() => createDemoScenario(new Date(Number.NaN)), RangeError);
});
