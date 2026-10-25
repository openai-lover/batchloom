import assert from 'node:assert/strict';
import test from 'node:test';
import { createLibraryScenario, REQUEST_LIBRARY, readPrivateDraft } from '../lib/request-library.ts';
import { validateExtraction, validateRequestList, freezeBatch } from '../lib/batch-domain.ts';

test('all three authored scenarios keep exact evidence and a viable reviewed proposal on a future date', () => {
  for (const entry of REQUEST_LIBRARY) {
    const now = '2026-12-15T12:00:00.000Z';
    const scenario = createLibraryScenario(entry.id, now);
    assert.equal(scenario.requests.length, 8);
    assert.equal(validateRequestList(scenario.requests).valid, true);
    assert.equal(scenario.policy.variant, entry.variant);
    assert.equal(scenario.summary.eligibleRequestCount, 3);
    assert.equal(scenario.summary.conflictCount, 3);
    assert.equal(scenario.summary.reviewCount, 2);
    assert.equal(scenario.summary.eligibleUnits, entry.id === 'circle' ? 12 : entry.id === 'workshop' ? 13 : 18);
    for (const record of scenario.analysis) assert.equal(validateExtraction(record.source, record.extraction).valid, true, record.source.id);
    const frozen = freezeBatch({ id: `test-${entry.id}`, version: 1, title: entry.collection, policy: scenario.policy, requests: scenario.analysis, makerApprovedAt: now, now });
    assert.equal(frozen.policy.unitPriceCents, 2400);
    assert.equal(frozen.policy.variant, entry.variant);
    assert.match(scenario.label, /not a live AI run/);
  }
});
test('a total budget never silently becomes a per-unit budget in the retail example', () => {
  const row = createLibraryScenario('restock').analysis.find(row => row.source.id === 'restock-7')!;
  assert.equal(row.extraction.unitBudgetCents.value, null);
  assert.equal(row.status, 'needs_review');
});
test('draft restoration validates inputs, preserves empty drafts, and drops stored analysis or payment claims', () => {
  const scenario = createLibraryScenario('workshop');
  const draft = { id: 'workshop', requests: scenario.requests, shipBy: scenario.policy.shipBy, savedAt: new Date().toISOString(), analysis: [{ status: 'eligible' }], capturedCents: 999999, policy: { unitPriceCents: 1 } };
  const restored = readPrivateDraft(draft)!;
  assert.ok(restored);
  assert.deepEqual(Object.keys(restored).sort(), ['id','requests','savedAt','shipBy']);
  assert.equal(readPrivateDraft({ ...draft, requests: [] })?.requests.length, 0);
  assert.equal(readPrivateDraft({ ...draft, id: 'unknown' }), null);
  assert.equal(readPrivateDraft({ ...draft, shipBy: '2026-02-30' }), null);
  assert.equal(readPrivateDraft({ ...draft, requests: [...scenario.requests, scenario.requests[0]] }), null);
  assert.equal(readPrivateDraft({ ...draft, requests: [{ ...scenario.requests[0], body: 'x'.repeat(4001) }] }), null);
});
