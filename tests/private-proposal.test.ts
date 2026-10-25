import test from 'node:test';
import assert from 'node:assert/strict';
import { freezeReviewedTerms, LOCAL_MODEL_ID } from '../lib/private-proposal.ts';
import { DEMO_POLICY } from '../lib/demo-data.ts';

function input() {
  return { id: 'batch-test', version: 1, title: '  Reviewed collection  ', policy: { ...DEMO_POLICY },
    summaryOfInterest: { requestCount: 3, eligibleUnits: 12, eligibleRequestCount: 1, reviewCount: 1, conflictCount: 1 },
    modelId: LOCAL_MODEL_ID, makerApproved: true, now: '2026-10-25T12:00:00.000Z' };
}

test('PRIVATE TERMS: fixed amounts, immutable 48-hour terms and self-reported provenance are server-derived', () => {
  const proposal = freezeReviewedTerms(input());
  assert.equal(proposal.title, 'Reviewed collection'); assert.equal(proposal.closesAt, '2026-10-27T12:00:00.000Z');
  assert.equal(proposal.demand.totalCents, 28800); assert.equal(proposal.demand.kind, 'uncommitted_demand');
  assert.deepEqual(proposal.sourceRequestIds, []); assert.equal(proposal.analysis.attestation, 'self-reported');
  assert.ok(Object.isFrozen(proposal)); assert.ok(Object.isFrozen(proposal.policy)); assert.ok(Object.isFrozen(proposal.analysis));
});

test('PRIVATE TERMS: inconsistent counts, fractional quantities and capacity overflow fail', () => {
  for (const patch of [{ requestCount: 25 }, { reviewCount: -1 }, { conflictCount: 2 }, { eligibleUnits: 1.5 }, { eligibleUnits: 49 }, { eligibleRequestCount: 0 }, { eligibleUnits: 0 }]) {
    const value = input(); Object.assign(value.summaryOfInterest, patch);
    assert.throws(() => freezeReviewedTerms(value));
  }
});

test('PRIVATE TERMS: source text and arbitrary metadata are not accepted summary fields', () => {
  for (const field of ['body', 'quote', 'sourceRequestIds', 'customerLabel', 'totalCents']) {
    const value = input(); Object.assign(value.summaryOfInterest, { [field]: 'private marker' });
    assert.throws(() => freezeReviewedTerms(value), /only the approved summary fields/);
  }
});

test('PRIVATE TERMS: approval, model identity, price and dispatch constraints cannot be bypassed', () => {
  const values = [
    { ...input(), makerApproved: false }, { ...input(), modelId: 'provider-claimed-proof' },
    { ...input(), policy: { ...DEMO_POLICY, unitPriceCents: 1 } },
    { ...input(), policy: { ...DEMO_POLICY, shipBy: '2026-10-26' } },
    { ...input(), now: 'not-a-date' },
  ];
  for (const value of values) assert.throws(() => freezeReviewedTerms(value));
});
