import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi, MAX_BODY_BYTES, sessionFor } from '../lib/http.ts';
import type { HttpEnvironment } from '../lib/http.ts';
import type { HttpStore, StoredBatch } from '../lib/storage.ts';
import type { BatchSnapshot, SettlementRepository } from '../lib/settlement.ts';
import { DEMO_ANALYSIS, DEMO_POLICY, DEMO_REQUESTS, createDemoScenario } from '../lib/demo-data.ts';
import type { PayPalOrder, PayPalPort } from '../lib/paypal.ts';
import { PayPalError } from '../lib/paypal.ts';
import { LOCAL_MODEL_ID } from '../lib/private-proposal.ts';
import { createLibraryScenario } from '../lib/request-library.ts';

const START = Date.parse('2026-10-25T12:00:00Z');
const ORIGIN = 'https://batchloom.example';
const env: HttpEnvironment = { PAYPAL_CLIENT_ID: 'test-client', PAYPAL_CLIENT_SECRET: 'test-secret-not-real', PAYPAL_MERCHANT_ID: 'MERCHANT1' };
function request(path: string, options: { cookie?: string; method?: string; body?: unknown; origin?: string | null; type?: string; raw?: string } = {}) {
  const method = options.method ?? (options.body !== undefined || options.raw !== undefined ? 'POST' : 'GET');
  const headers = new Headers();
  if (options.cookie) headers.set('cookie', options.cookie);
  if (method === 'POST') { if (options.origin !== null) headers.set('origin', options.origin ?? ORIGIN); headers.set('content-type', options.type ?? 'application/json'); }
  return new Request(`${ORIGIN}/api/${path}`, { method, headers, ...(method === 'POST' ? { body: options.raw ?? JSON.stringify(options.body) } : {}) });
}
function makeStore(): HttpStore & { records: Map<string, StoredBatch>; quotas: Map<string, number> } {
  const records = new Map<string, StoredBatch>(); const buyers = new Map<string, { batch: string; owner: string }>(); const receipts = new Map<string, number>(); const quotas = new Map<string, number>(); const leases = new Map<string, { token: string; until: number }>();
  const settlement: SettlementRepository = {
    async load(id) { return records.has(id) ? structuredClone(records.get(id)!.snapshot) : null; },
    async acquireLease(id, token, now, until) { if (leases.has(id) && leases.get(id)!.until > now) return false; leases.set(id, { token, until }); return true; },
    async renewLease(id, token, now, until) { if (leases.get(id)?.token !== token || leases.get(id)!.until <= now) return false; leases.set(id, { token, until }); return true; },
    async save(next, expected, token, now) { const row = records.get(next.id); if (!row || row.snapshot.version !== expected || leases.get(next.id)?.token !== token || leases.get(next.id)!.until <= now) return false; row.snapshot = structuredClone(next); return true; },
    async releaseLease(id, token) { if (leases.get(id)?.token === token) leases.delete(id); },
  };
  return {
    records, quotas, settlement,
    async read(id) { return records.has(id) ? structuredClone(records.get(id)!) : null; },
    async list(owner) { return [...records.values()].filter(row => row.snapshot.ownerId === owner).map(row => structuredClone(row)); },
    async create(proposal, snapshot) { records.set(snapshot.id, structuredClone({ proposal, snapshot })); },
    async linkBuyer(pledge, batch, owner) { if (!buyers.has(pledge)) buyers.set(pledge, { batch, owner }); },
    async buyerPledges(batch, owner) { return [...buyers].filter(([, value]) => value.batch === batch && value.owner === owner).map(([pledge]) => pledge); },
    async quota(key, limit) { const value = (quotas.get(key) ?? 0) + 1; quotas.set(key, value); return value <= limit; },
    async rememberAnalysis(owner, hash, expires) { receipts.set(`${owner}:${hash}`, expires); },
    async hasAnalysis(owner, hash, now) { return (receipts.get(`${owner}:${hash}`) ?? 0) > now; },
  };
}
function setup() {
  const store = makeStore(); let now = START; let creates = 0; let authorizes = 0; let voids = 0; let timeoutCreate = false; let timeoutAuthorize = false;
  const orders = new Map<string, PayPalOrder>(); const createKeys = new Map<string, string>();
  const paypal: PayPalPort = {
    async createOrder(input) {
      creates++;
      let oid = createKeys.get(input.requestId);
      if (!oid) {
        oid = `ORDER${orders.size + 1}`; createKeys.set(input.requestId, oid);
        orders.set(oid, { id: oid, status: 'PAYER_ACTION_REQUIRED', intent: 'AUTHORIZE', purchase_units: [{ reference_id: input.pledgeId, invoice_id: input.pledgeId, custom_id: `${input.batchId}@${input.revision}`, amount: { currency_code: 'USD', value: (input.amountMinor / 100).toFixed(2) }, payee: { merchant_id: env.PAYPAL_MERCHANT_ID! }, payments: {} }], links: [{ rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=${oid}` }] });
      }
      if (timeoutCreate) { timeoutCreate = false; throw new PayPalError('TIMEOUT', { uncertain: true }); }
      return structuredClone(orders.get(oid)!);
    },
    async getOrder(id) { return structuredClone(orders.get(id)!); },
    async authorizeOrder(id) {
      authorizes++; const order = orders.get(id)!;
      order.purchase_units![0].payments!.authorizations = [{ id: `AUTH${id}`, status: 'CREATED', amount: order.purchase_units![0].amount, create_time: new Date(now).toISOString() }]; order.status = 'COMPLETED';
      if (timeoutAuthorize) { timeoutAuthorize = false; throw new PayPalError('TIMEOUT', { uncertain: true }); }
      return structuredClone(order);
    },
    async getAuthorization(id) { return structuredClone([...orders.values()].flatMap(order => order.purchase_units![0].payments!.authorizations ?? []).find(auth => auth.id === id)!); },
    async voidAuthorization(id) { voids++; const auth = [...orders.values()].flatMap(order => order.purchase_units![0].payments!.authorizations ?? []).find(auth => auth.id === id)!; auth.status = 'VOIDED'; },
    async getCapture() { throw new Error('not used'); }, async getRefund() { throw new Error('not used'); }, async captureAuthorization() { throw new Error('not used'); }, async refundCapture() { throw new Error('not used'); }, async verifyWebhook() { return false; },
  };
  const options = { store, paypal, now: () => now };
  const call = (req: Request) => handleApi(req, env, options);
  return { store, orders, call, options, advance(ms: number) { now += ms; }, counts: () => ({ creates, authorizes, voids }), timeoutCreate() { timeoutCreate = true; }, timeoutAuthorize() { timeoutAuthorize = true; } };
}
async function cookie(call: (request: Request) => Promise<Response>) { const response = await call(request('config')); return response.headers.get('set-cookie')!.split(';')[0]; }
async function publish(call: (request: Request) => Promise<Response>, owner: string, provenance = 'example') {
  const response = await call(request('batches', { cookie: owner, body: { title: 'Synthetic notebook batch', policy: DEMO_POLICY, requests: DEMO_ANALYSIS, makerApproved: true, provenance } }));
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  return await response.json() as { proposal: { id: string; version: number } };
}

test('HTTP MOCK: sessions are random, HttpOnly, host-bound, and ownership is hashed', async () => {
  const { call } = setup(); const response = await call(request('config')); const header = response.headers.get('set-cookie')!;
  assert.match(header, /^__Host-batchloom-session=[a-f0-9]{64};/); assert.match(header, /HttpOnly/); assert.match(header, /SameSite=Lax/); assert.match(header, /Secure/); assert.doesNotMatch(header, /Domain=/);
  const a = await sessionFor(request('config', { cookie: header.split(';')[0] })); const b = await sessionFor(request('config'));
  assert.notEqual(a.ownerId, b.ownerId); assert.ok(!header.includes(a.ownerId));
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('HTTP MOCK: maker sessions cannot list or settle one another’s batches', async () => {
  const { call } = setup(); const a = await cookie(call); const b = await cookie(call); const batch = await publish(call, a);
  const own = await (await call(request('batches', { cookie: a }))).json() as { batches: unknown[] };
  const other = await (await call(request('batches', { cookie: b }))).json() as { batches: unknown[] };
  assert.equal(own.batches.length, 1); assert.equal(other.batches.length, 0);
  assert.equal((await call(request(`batches/${batch.proposal.id}/settle`, { cookie: b, body: { revision: 1 } }))).status, 404);
});

test('HTTP MOCK: public batch omits owner, source evidence, merchant and other browser reservations', async () => {
  const { call } = setup(); const maker = await cookie(call); const buyer = await cookie(call); const stranger = await cookie(call); const batch = await publish(call, maker); const id = batch.proposal.id;
  await call(request(`batches/${id}/checkout`, { cookie: buyer, body: { quantity: 1, revision: 1, consent: true, nonce: 'one' } }));
  const publicResponse = await call(request(`batches/${id}`, { cookie: stranger })); const text = await publicResponse.text();
  assert.doesNotMatch(text, /ownerId|merchantId|sourceRequestIds|customerLabel|MERCHANT1|test-secret/);
  assert.equal(JSON.parse(text).reservations.length, 0);
  const own = await (await call(request(`batches/${id}`, { cookie: buyer }))).json() as { reservations: unknown[] }; assert.equal(own.reservations.length, 1);
});

test('HTTP MOCK: cross-origin, missing origin, and non-JSON mutations are rejected', async () => {
  const { call, store } = setup();
  for (const origin of ['https://attacker.example', null]) assert.equal((await call(request('batches', { origin, body: {} }))).status, 403);
  assert.equal((await call(request('batches', { type: 'text/plain', body: {} }))).status, 415);
  assert.equal(store.records.size, 0);
});

test('HTTP MOCK: streamed body limit and malformed JSON are rejected before processing', async () => {
  const { call } = setup();
  assert.equal((await call(request('batches', { raw: '{"data":"' + 'x'.repeat(MAX_BODY_BYTES) + '"}' }))).status, 413);
  assert.equal((await call(request('batches', { raw: '{not-json' }))).status, 400);
});

test('HTTP MOCK: former server-model provenance is rejected even with old credentials present', async () => {
  const f = setup(); const a = await cookie(f.call);
  const payload = { title: 'Synthetic notebook batch', policy: DEMO_POLICY, requests: DEMO_ANALYSIS, makerApproved: true, provenance: 'live' };
  const environment = { ...env, BATCHLOOM_AI_API_KEY: 'must-never-be-used', BATCHLOOM_AI_BASE_URL: 'https://ai.invalid/v1', BATCHLOOM_AI_MODEL: 'obsolete', BATCHLOOM_AI_ALLOWED_HOSTS: 'ai.invalid' };
  assert.equal((await handleApi(request('batches', { cookie: a, body: payload }), environment, f.options)).status, 400);
  assert.equal(f.store.records.size, 0);
});

test('HTTP MOCK: checkout retries reuse one pledge and provider idempotency key', async () => {
  const f = setup(); const maker = await cookie(f.call); const buyer = await cookie(f.call); const batch = await publish(f.call, maker); const path = `batches/${batch.proposal.id}/checkout`;
  const options = { cookie: buyer, body: { quantity: 2, revision: 1, consent: true, nonce: 'same-request' } };
  f.timeoutCreate(); assert.equal((await f.call(request(path, options))).status, 202);
  const response = await f.call(request(path, options)); assert.equal(response.status, 200);
  const repeated = await f.call(request(path, options)); assert.equal(repeated.status, 200);
  assert.equal(f.orders.size, 1); assert.equal(f.store.records.get(batch.proposal.id)!.snapshot.pledges.length, 1); assert.equal(f.counts().creates, 2);
});

test('HTTP MOCK: another browser cannot authorize a buyer’s pledge', async () => {
  const f = setup(); const maker = await cookie(f.call); const buyer = await cookie(f.call); const other = await cookie(f.call); const batch = await publish(f.call, maker); const path = `batches/${batch.proposal.id}`;
  const created = await (await f.call(request(`${path}/checkout`, { cookie: buyer, body: { quantity: 1, revision: 1, consent: true, nonce: 'one' } }))).json() as { pledgeId: string };
  assert.equal((await f.call(request(`${path}/authorize`, { cookie: other, body: { pledgeId: created.pledgeId, revision: 1 } }))).status, 404); assert.equal(f.counts().authorizes, 0);
});

test('HTTP MOCK: timed-out authorization is recovered, not duplicated or cancelled after checkout TTL', async () => {
  const f = setup(); const maker = await cookie(f.call); const buyer = await cookie(f.call); const batch = await publish(f.call, maker); const path = `batches/${batch.proposal.id}`;
  const created = await (await f.call(request(`${path}/checkout`, { cookie: buyer, body: { quantity: 1, revision: 1, consent: true, nonce: 'one' } }))).json() as { pledgeId: string };
  f.orders.values().next().value!.status = 'APPROVED'; f.timeoutAuthorize();
  const approve = () => f.call(request(`${path}/authorize`, { cookie: buyer, body: { pledgeId: created.pledgeId, revision: 1 } }));
  assert.equal((await approve()).status, 202); f.advance(20 * 60_000);
  assert.equal((await approve()).status, 200); assert.equal(f.store.records.get(batch.proposal.id)!.snapshot.pledges[0].state, 'AUTHORIZED');
  assert.equal(f.counts().authorizes, 1); assert.equal(f.counts().voids, 0);
});

test('HTTP MOCK: expired unapproved checkout cannot create a new authorization', async () => {
  const f = setup(); const maker = await cookie(f.call); const buyer = await cookie(f.call); const batch = await publish(f.call, maker); const path = `batches/${batch.proposal.id}`;
  const created = await (await f.call(request(`${path}/checkout`, { cookie: buyer, body: { quantity: 1, revision: 1, consent: true, nonce: 'one' } }))).json() as { pledgeId: string };
  f.orders.values().next().value!.status = 'APPROVED'; f.advance(16 * 60_000);
  assert.equal((await f.call(request(`${path}/authorize`, { cookie: buyer, body: { pledgeId: created.pledgeId, revision: 1 } }))).status, 409); assert.equal(f.counts().authorizes, 0);
});

test('HTTP MOCK: pending checkout capacity is counted; unapproved price and revision are never used', async () => {
  const f = setup(); const maker = await cookie(f.call); const buyer = await cookie(f.call); const batch = await publish(f.call, maker); const path = `batches/${batch.proposal.id}/checkout`;
  const first = await f.call(request(path, { cookie: buyer, body: { quantity: 48, revision: 1, consent: true, nonce: 'all', amountMinor: 1 } })); assert.equal(first.status, 200);
  assert.equal(f.store.records.get(batch.proposal.id)!.snapshot.pledges[0].amountMinor, 48 * 2400);
  assert.equal((await f.call(request(path, { cookie: buyer, body: { quantity: 1, revision: 1, consent: true, nonce: 'extra' } }))).status, 409);
  assert.equal((await f.call(request(path, { cookie: buyer, body: { quantity: 1, revision: 2, consent: true, nonce: 'revision' } }))).status, 409);
});

test('HTTP MOCK: an interrupted authorization reserves capacity after checkout expiry and cannot be downgraded by checkout retry', async () => {
  const f = setup(); const maker = await cookie(f.call); const buyer = await cookie(f.call); const batch = await publish(f.call, maker); const path = `batches/${batch.proposal.id}`;
  const body = { quantity: 48, revision: 1, consent: true, nonce: 'all' };
  await f.call(request(`${path}/checkout`, { cookie: buyer, body }));
  const pledge = f.store.records.get(batch.proposal.id)!.snapshot.pledges[0];
  Object.assign(pledge, { state: 'UNCERTAIN', uncertainOperation: 'authorize', authorizeRequestId: 'stable-interrupted' });
  const retry = await f.call(request(`${path}/checkout`, { cookie: buyer, body }));
  assert.equal(retry.status, 202); assert.equal(f.store.records.get(batch.proposal.id)!.snapshot.pledges[0].state, 'UNCERTAIN');
  f.advance(16 * 60_000);
  const extra = await f.call(request(`${path}/checkout`, { cookie: buyer, body: { quantity: 1, revision: 1, consent: true, nonce: 'extra' } }));
  assert.equal(extra.status, 409); assert.equal((await extra.json() as { code: string }).code, 'CAPACITY_REACHED'); assert.equal(f.counts().creates, 1);
});

test('HTTP PRIVACY: retired analysis endpoints reject without reading or forwarding customer text', async () => {
  const f = setup();
  for (const endpoint of ['analyze', 'analyze-local']) {
    const input = request(endpoint, { body: { requests: DEMO_REQUESTS, privateNote: 'Private source marker' } });
    const response = await f.call(input);
    assert.equal(response.status, 410); assert.equal(input.bodyUsed, false); assert.doesNotMatch(await response.text(), /Private source marker/);
  }
  assert.equal(f.store.records.size, 0); assert.equal(f.store.quotas.size, 0);
});

test('HTTP MOCK: fresh browser sessions cannot bypass global publish or checkout quotas', async () => {
  const f = setup(); f.store.quotas.set('publish:global', 40);
  const blocked = await f.call(request('batches', { body: { title: 'Synthetic notebook batch', policy: DEMO_POLICY, requests: DEMO_ANALYSIS, makerApproved: true, provenance: 'example' } }));
  assert.equal(blocked.status, 429); assert.equal(f.store.records.size, 0);
  const g = setup(); const maker = await cookie(g.call); const batch = await publish(g.call, maker);
  g.store.quotas.set('checkout:global', 200);
  const attempted = await g.call(request(`batches/${batch.proposal.id}/checkout`, { body: { quantity: 1, revision: 1, consent: true, nonce: 'fresh-browser' } }));
  assert.equal(attempted.status, 429); assert.equal(g.counts().creates, 0); assert.equal(g.store.records.get(batch.proposal.id)!.snapshot.pledges.length, 0);
});

const reviewedPlan = { requestCount: 3, eligibleUnits: 12, eligibleRequestCount: 1, reviewCount: 1, conflictCount: 1, modelId: LOCAL_MODEL_ID };
function privatePayload() { return { title: 'Reviewed notebook collection', policy: { ...DEMO_POLICY }, makerApproved: true, provenance: 'local-model', reviewedPlan: { ...reviewedPlan } }; }

test('HTTP PRIVACY: local analysis publishes only self-reported summary and fixed server-priced terms', async () => {
  const f = setup(); const maker = await cookie(f.call);
  const config = await (await f.call(request('config'))).json() as { aiMode: string; modelId: string };
  assert.equal(config.aiMode, 'browser-local'); assert.equal(config.modelId, LOCAL_MODEL_ID);
  const response = await f.call(request('batches', { cookie: maker, body: privatePayload() }));
  assert.equal(response.status, 201);
  const result = await response.json() as { proposal: { id: string; sourceRequestIds: string[]; analysis: { attestation: string; modelId: string }; demand: { kind: string; totalCents: number } }; authorizedUnits: number; capturedCents: number };
  assert.equal(result.proposal.analysis.attestation, 'self-reported'); assert.equal(result.proposal.analysis.modelId, LOCAL_MODEL_ID);
  assert.deepEqual(result.proposal.sourceRequestIds, []); assert.equal(result.proposal.demand.kind, 'uncommitted_demand'); assert.equal(result.proposal.demand.totalCents, 12 * 2400);
  assert.equal(result.authorizedUnits, 0); assert.equal(result.capturedCents, 0);
  assert.doesNotMatch(JSON.stringify(f.store.records.get(result.proposal.id)), /customerLabel|"body"|"quote"|"extraction"/);
});

test('HTTP PRIVACY: raw text, quotations, source IDs and extra nested fields are rejected before storage', async () => {
  const mutations = [
    (p: Record<string, any>) => { p.requests = DEMO_REQUESTS; },
    (p: Record<string, any>) => { p.quote = 'private customer quote'; },
    (p: Record<string, any>) => { p.reviewedPlan.sourceRequestIds = ['customer-id']; },
    (p: Record<string, any>) => { p.reviewedPlan.customerLabel = 'private name'; },
    (p: Record<string, any>) => { p.policy.note = 'private body'; },
  ];
  for (const mutate of mutations) {
    const f = setup(); const maker = await cookie(f.call); const payload = privatePayload(); mutate(payload);
    const response = await f.call(request('batches', { cookie: maker, body: payload }));
    assert.equal(response.status, 400); assert.equal(f.store.records.size, 0); assert.doesNotMatch(await response.text(), /private customer quote|private name|private body|customer-id/);
  }
});

test('HTTP MOCK: fresh and previous-UTC-day examples publish during December judging', async () => {
  const f = setup(); const judgedAt = Date.parse('2026-12-15T00:01:00Z'); f.advance(judgedAt - START); const maker = await cookie(f.call);
  for (const date of [judgedAt, judgedAt - 24 * 3600_000]) {
    const example = createDemoScenario(new Date(date));
    const response = await f.call(request('batches', { cookie: maker, body: { title: 'December synthetic collection', policy: example.policy, requests: example.analysis, makerApproved: true, provenance: 'example' } }));
    assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
    const body = await response.json() as { proposal: { closesAt: string; policy: { shipBy: string } } };
    assert.equal(Date.parse(body.proposal.closesAt), judgedAt + 48 * 3600_000);
    assert.ok(body.proposal.policy.shipBy > '2026-12-17');
  }
});

test('HTTP MOCK: each new authored library set publishes with fixed terms and zero payment records; modified examples fail', async () => {
  for (const id of ['workshop', 'restock'] as const) {
    const f = setup(); const maker = await cookie(f.call);
    const example = createLibraryScenario(id, new Date(START));
    const payload = { title: `Library ${id}`, policy: example.policy, requests: example.analysis, makerApproved: true, provenance: 'example' };
    const response = await f.call(request('batches', { cookie: maker, body: payload }));
    assert.equal(response.status, 201, await response.clone().text());
    const result = await response.json() as { proposal: { policy: { variant: string; unitPriceCents: number } }; authorizedUnits: number; capturedCents: number };
    assert.equal(result.proposal.policy.variant, example.policy.variant);
    assert.equal(result.proposal.policy.unitPriceCents, 2400);
    assert.equal(result.authorizedUnits, 0); assert.equal(result.capturedCents, 0); assert.equal(f.orders.size, 0);
    const changed = structuredClone(payload); changed.requests[0].source.customerLabel = 'Unapproved substitution';
    const rejected = await f.call(request('batches', { cookie: maker, body: changed }));
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json() as { code: string }).code, 'EXAMPLE_CHANGED');
    assert.equal(f.store.records.size, 1);
  }
});
