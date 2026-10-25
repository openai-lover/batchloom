import assert from 'node:assert/strict';
import test from 'node:test';
import { freezeBatch } from '../lib/batch-domain.ts';
import { createDemoScenario } from '../lib/demo-data.ts';
import { handleApi, sessionFor } from '../lib/http.ts';
import type { HttpEnvironment } from '../lib/http.ts';
import { PayPalError } from '../lib/paypal.ts';
import type { PayPalAuthorization, PayPalCapture, PayPalOrder, PayPalPort } from '../lib/paypal.ts';
import { runSettlement, SettlementError } from '../lib/settlement.ts';
import type { SettlementPledge, SettlementRepository } from '../lib/settlement.ts';
import type { HttpStore, StoredBatch } from '../lib/storage.ts';

const START = Date.parse('2026-10-25T12:00:00.000Z');
const ORIGIN = 'https://batchloom.example';
const COOKIE = `__Host-batchloom-session=${'a'.repeat(64)}`;
const ENV: HttpEnvironment = { PAYPAL_CLIENT_ID: 'test-client', PAYPAL_CLIENT_SECRET: 'not-real', PAYPAL_MERCHANT_ID: 'MERCHANT1' };

function post(path: string, body: unknown): Request {
  return new Request(`${ORIGIN}/api/batches/batch-review/${path}`, { method: 'POST', headers: { cookie: COOKIE, origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

async function fixture(pledges: SettlementPledge[]) {
  let time = START;
  const session = await sessionFor(new Request(`${ORIGIN}/api/config`, { headers: { cookie: COOKIE } }));
  const scenario = createDemoScenario(new Date(START));
  const proposal = freezeBatch({ id: 'batch-review', version: 1, title: 'Security review fixture', policy: scenario.policy, requests: scenario.analysis, makerApprovedAt: new Date(START).toISOString(), now: new Date(START).toISOString() });
  let record: StoredBatch = { proposal, snapshot: { id: proposal.id, ownerId: session.ownerId, revision: 1, makerApprovedRevision: 1, version: 0, status: 'OPEN', currency: 'USD', merchantId: 'MERCHANT1', targetUnits: 12, capacityUnits: 48, opensAt: START, closesAt: START + 48 * 3600_000, pledges: structuredClone(pledges) } };
  let lease: { token: string; until: number } | undefined;
  const settlement: SettlementRepository = {
    async load() { return structuredClone(record.snapshot); },
    async acquireLease(_id, token, now, until) { if (lease && lease.until > now) return false; lease = { token, until }; return true; },
    async renewLease(_id, token, now, until) { if (lease?.token !== token || lease.until <= now) return false; lease.until = until; return true; },
    async save(next, expected, token, now) { if (record.snapshot.version !== expected || lease?.token !== token || lease.until <= now) return false; record.snapshot = structuredClone(next); return true; },
    async releaseLease(_id, token) { if (lease?.token === token) lease = undefined; },
  };
  const store: HttpStore = {
    settlement, async read(id) { return id === proposal.id ? structuredClone(record) : null; }, async list() { return [structuredClone(record)]; },
    async create(nextProposal, nextSnapshot) { record = structuredClone({ proposal: nextProposal, snapshot: nextSnapshot }); },
    async linkBuyer() {}, async buyerPledges(_id, owner) { return owner === session.ownerId ? pledges.map(p => p.id) : []; },
    async quota() { return true; }, async rememberAnalysis() {}, async hasAnalysis() { return false; },
  };
  const orders = new Map<string, PayPalOrder>();
  const auths = new Map<string, PayPalAuthorization>();
  const captures = new Map<string, PayPalCapture>();
  const calls = { capture: 0, void: 0 };
  for (const pledge of pledges) orders.set(pledge.orderId!, { id: pledge.orderId!, status: 'APPROVED', intent: 'AUTHORIZE', purchase_units: [{ reference_id: pledge.id, invoice_id: pledge.id, custom_id: 'batch-review@1', amount: { currency_code: 'USD', value: (pledge.amountMinor / 100).toFixed(2) }, payee: { merchant_id: 'MERCHANT1' }, payments: {} }] });
  function authorizeAt(pledgeId: string, at: number) {
    const pledge = pledges.find(p => p.id === pledgeId)!;
    const order = orders.get(pledge.orderId!)!;
    const auth = { id: `A-${pledge.id}`, status: 'CREATED', amount: order.purchase_units![0].amount, create_time: new Date(at).toISOString() };
    auths.set(auth.id, auth); order.purchase_units![0].payments!.authorizations = [auth]; order.status = 'COMPLETED';
    return auth;
  }
  let onAuthorize: ((id: string) => void) | undefined;
  const paypal: PayPalPort = {
    async getOrder(id) { return structuredClone(orders.get(id)!); },
    async getAuthorization(id) { return structuredClone(auths.get(id)!); },
    async getCapture(id) { return structuredClone(captures.get(id)!); },
    async authorizeOrder(id) { if (onAuthorize) onAuthorize(id); else authorizeAt(pledges.find(p => p.orderId === id)!.id, time); return structuredClone(orders.get(id)!); },
    async captureAuthorization(id) {
      calls.capture++;
      const pledge = pledges.find(p => `A-${p.id}` === id)!;
      const capture = { id: `C-${pledge.id}`, status: 'COMPLETED', amount: orders.get(pledge.orderId!)!.purchase_units![0].amount, supplementary_data: { related_ids: { authorization_id: id, order_id: pledge.orderId } } };
      captures.set(capture.id, capture); orders.get(pledge.orderId!)!.purchase_units![0].payments!.captures = [capture]; auths.get(id)!.status = 'CAPTURED';
      return structuredClone(capture);
    },
    async voidAuthorization(id) { calls.void++; auths.get(id)!.status = 'VOIDED'; },
    async createOrder() { throw new Error('not used'); }, async getRefund() { throw new Error('not used'); }, async refundCapture() { throw new Error('not used'); }, async verifyWebhook() { return false; },
  };
  const now = () => time;
  return { paypal, calls, orders, auths, authorizeAt, snapshot: () => record.snapshot,
    setTime(at: number) { time = at; }, onAuthorize(fn: (id: string) => void) { onAuthorize = fn; },
    call: (request: Request) => handleApi(request, ENV, { store, paypal, now }),
    settle: () => runSettlement({ batchId: proposal.id, actorId: session.ownerId, expectedRevision: 1, repository: settlement, paypal, now }),
  };
}

function pending(id: string, quantity = 12): SettlementPledge {
  return { id, batchRevision: 1, quantity, amountMinor: quantity * 2400, currency: 'USD', state: 'CHECKOUT_CREATED', orderId: `O-${id}`, checkoutExpiresAt: START + 15 * 60_000 };
}

test('SECURITY COUNTEREXAMPLE: authorization completing after checkout expiry is voided immediately', async () => {
  const pledge = pending('p-expiry'); pledge.checkoutExpiresAt = START + 1_000;
  const f = await fixture([pledge]);
  f.onAuthorize(() => { f.setTime(START + 2_000); f.authorizeAt(pledge.id, START + 2_000); });
  const response = await f.call(post('authorize', { revision: 1, pledgeId: pledge.id }));
  assert.equal(response.status, 200);
  assert.equal(f.snapshot().pledges[0].state, 'VOIDED', 'a pre-call deadline check must not admit a hold created after the approved checkout window');
  assert.equal(f.calls.void, 1);
});

test('SECURITY COUNTEREXAMPLE: settlement never charges a recovered authorization created after its checkout deadline', async () => {
  const pledge = pending('p-late'); pledge.state = 'UNCERTAIN'; pledge.uncertainOperation = 'authorize';
  const f = await fixture([pledge]);
  f.authorizeAt(pledge.id, pledge.checkoutExpiresAt! + 1_000); f.setTime(pledge.checkoutExpiresAt! + 2_000);
  try { await f.settle(); } catch (error) { if (!(error instanceof SettlementError && error.code === 'MINIMUM_NOT_REACHED_BEFORE_DEADLINE')) throw error; }
  assert.equal(f.calls.capture, 0, 'provider discovery must enforce the reservation deadline before counting or capturing the recovered hold');
  assert.notEqual(f.snapshot().status, 'COMMITTED');
});

test('SECURITY COUNTEREXAMPLE: an interrupted authorization cannot be forgotten when another pledge reaches the minimum', async () => {
  const qualified = pending('p-qualified'); const interrupted = pending('p-interrupted', 1);
  const f = await fixture([qualified, interrupted]); f.authorizeAt(qualified.id, START);
  f.onAuthorize(() => { f.setTime(START + 15_000); throw new PayPalError('TIMEOUT', { uncertain: true }); });
  const response = await f.call(post('authorize', { revision: 1, pledgeId: interrupted.id }));
  assert.equal(response.status, 202); assert.equal(f.snapshot().pledges[1].state, 'UNCERTAIN');
  await f.settle();
  // PayPal may finish processing after our timeout and after an earlier GET still showed APPROVED.
  f.setTime(START + 16_000); const lateResult = f.authorizeAt(interrupted.id, START + 16_000);
  await f.settle();
  assert.ok(f.snapshot().status !== 'COMMITTED' || lateResult.status !== 'CREATED', 'a terminal batch must not leave the known interrupted operation as an orphaned PayPal hold');
});
