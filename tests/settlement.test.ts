import test from "node:test";
import assert from "node:assert/strict";
// @ts-ignore -- Node 24 native TypeScript tests.
import { runSettlement, SettlementError } from "../lib/settlement.ts";
import type { BatchSnapshot, SettlementRepository } from "../lib/settlement";
// @ts-ignore -- Node 24 native TypeScript tests.
import { PayPalError } from "../lib/paypal.ts";
import type { PayPalPort, PayPalOrder, PayPalAuthorization, PayPalCapture, PayPalRefund } from "../lib/paypal";

const START = Date.parse("2026-10-25T00:00:00Z");
function snapshot(count = 2): BatchSnapshot {
  return { id: "batch1", ownerId: "maker1", revision: 1, makerApprovedRevision: 1, version: 0, status: "OPEN", currency: "USD", merchantId: "MERCHANT1", targetUnits: 2, capacityUnits: 3, opensAt: START, closesAt: START + 48 * 3600_000,
    pledges: Array.from({ length: count }, (_, index) => ({ id: `p${index + 1}`, batchRevision: 1, quantity: 1, amountMinor: 2500, currency: "USD", state: "AUTHORIZED", orderId: `O${index + 1}`, authorizationId: `A${index + 1}`, authorizedAt: START + 1000 })) };
}
class MemoryRepository implements SettlementRepository {
  current: BatchSnapshot; lease?: { token: string; until: number }; failSave = false;
  constructor(value: BatchSnapshot) { this.current = structuredClone(value); }
  async load() { return structuredClone(this.current); }
  async acquireLease(_id: string, token: string, now: number, until: number) { if (this.lease && this.lease.until > now) return false; this.lease = { token, until }; return true; }
  async renewLease(_id: string, token: string, now: number, until: number) { if (this.lease?.token !== token || this.lease.until <= now) return false; this.lease.until = until; return true; }
  async save(next: BatchSnapshot, expected: number, token: string, now: number) { if (this.failSave || this.current.version !== expected || this.lease?.token !== token || this.lease.until <= now) return false; assert.equal(next.version, expected + 1); this.current = structuredClone(next); return true; }
  async releaseLease(_id: string, token: string) { if (this.lease?.token === token) this.lease = undefined; }
}
function fakeProvider(repo: MemoryRepository) {
  const orders = new Map<string, PayPalOrder>();
  const authorizations = new Map<string, PayPalAuthorization>();
  const captures = new Map<string, PayPalCapture>();
  const refunds = new Map<string, PayPalRefund>();
  const captureKeys = new Map<string, PayPalCapture>();
  const refundKeys = new Map<string, PayPalRefund>();
  const calls = { capture: [] as string[], refund: [] as string[], void: [] as string[] };
  let failCapture = "", timeoutAfterCapture = "", timeoutBeforeCapture = "", pendingRefund = false, readFailure = false, failSaveAfterCapture = false, declineCapture = "";
  for (const pledge of repo.current.pledges) {
    const auth: PayPalAuthorization = { id: pledge.authorizationId!, status: "CREATED", amount: { currency_code: "USD", value: "25.00" }, create_time: new Date(pledge.authorizedAt!).toISOString() };
    authorizations.set(auth.id, auth);
    orders.set(pledge.orderId!, { id: pledge.orderId!, status: "COMPLETED", intent: "AUTHORIZE", purchase_units: [{ reference_id: pledge.id, invoice_id: pledge.id, custom_id: "batch1@1", amount: { currency_code: "USD", value: "25.00" }, payee: { merchant_id: "MERCHANT1" }, payments: { authorizations: [auth], captures: [] } }] });
  }
  const provider: PayPalPort = {
    async createOrder() { throw new Error("Not used by settlement"); },
    async authorizeOrder() { throw new Error("Not used by settlement"); },
    async getOrder(id) { if (readFailure) throw new PayPalError("NETWORK_ERROR"); return structuredClone(orders.get(id)!); },
    async getAuthorization(id) { return structuredClone(authorizations.get(id)!); },
    async getCapture(id) { return structuredClone(captures.get(id)!); },
    async getRefund(id) { return structuredClone(refunds.get(id)!); },
    async captureAuthorization(id, input) {
      const pledge = repo.current.pledges.find((p) => p.authorizationId === id)!;
      assert.equal(pledge.state, "CAPTURE_PENDING", "pending mutation was durably recorded first");
      assert.equal(pledge.captureRequestId, input.requestId);
      calls.capture.push(input.requestId);
      if (id === timeoutBeforeCapture) { timeoutBeforeCapture = ""; throw new PayPalError("TIMEOUT", { uncertain: true }); }
      if (id === failCapture) throw new PayPalError("HTTP_422", { status: 422 });
      if (captureKeys.has(input.requestId)) return structuredClone(captureKeys.get(input.requestId)!);
      const capture: PayPalCapture = { id: `C${id}`, status: "COMPLETED", amount: { currency_code: "USD", value: "25.00" }, final_capture: true, supplementary_data: { related_ids: { authorization_id: id, order_id: pledge.orderId } } };
      if (id === declineCapture) capture.status = "DECLINED";
      captures.set(capture.id, capture); captureKeys.set(input.requestId, capture);
      if (capture.status === "COMPLETED") authorizations.get(id)!.status = "CAPTURED";
      orders.get(pledge.orderId!)!.purchase_units![0].payments!.captures!.push(capture);
      if (id === timeoutAfterCapture) { timeoutAfterCapture = ""; throw new PayPalError("TIMEOUT", { uncertain: true }); }
      if (failSaveAfterCapture) { failSaveAfterCapture = false; repo.failSave = true; }
      return structuredClone(capture);
    },
    async voidAuthorization(id) { calls.void.push(id); authorizations.get(id)!.status = "VOIDED"; },
    async refundCapture(id, requestId) {
      const pledge = repo.current.pledges.find((p) => p.captureId === id)!;
      assert.equal(pledge.state, "REFUND_PENDING"); assert.equal(pledge.refundRequestId, requestId);
      calls.refund.push(requestId);
      if (refundKeys.has(requestId)) return structuredClone(refundKeys.get(requestId)!);
      const refund: PayPalRefund = { id: `R${id}`, status: pendingRefund ? "PENDING" : "COMPLETED", amount: { currency_code: "USD", value: "25.00" } };
      refunds.set(refund.id, refund); refundKeys.set(requestId, refund);
      if (!pendingRefund) captures.get(id)!.status = "REFUNDED";
      return structuredClone(refund);
    },
    async verifyWebhook() { return false; },
  };
  return { provider, calls, orders, authorizations, captures, refunds,
    failCapture(id: string) { failCapture = id; }, timeoutAfterCapture(id: string) { timeoutAfterCapture = id; }, timeoutBeforeCapture(id: string) { timeoutBeforeCapture = id; },
    pendingRefund(value: boolean) { pendingRefund = value; }, failReads(value: boolean) { readFailure = value; },
    failSaveAfterCapture() { failSaveAfterCapture = true; }, declineCapture(id: string) { declineCapture = id; } };
}
function setup(count = 2) { const repo = new MemoryRepository(snapshot(count)); const fake = fakeProvider(repo); const run = (at = START + 3600_000, actorId = "maker1", expectedRevision = 1) => runSettlement({ batchId: "batch1", actorId, expectedRevision, repository: repo, paypal: fake.provider, now: () => at }); return { repo, fake, run }; }

test("MOCK: qualified batch captures all pledges and repeated settlement does not charge twice", async () => {
  const { repo, fake, run } = setup();
  await run(); await run();
  assert.equal(repo.current.status, "COMMITTED"); assert.equal(fake.calls.capture.length, 2); assert.equal(new Set(fake.calls.capture).size, 2); assert.equal(fake.calls.refund.length, 0);
});

test("MOCK: concurrent settlement calls use one durable lease", async () => {
  const { repo, fake, run } = setup();
  const results = await Promise.all([run(), run()]);
  assert.equal(results.filter((r) => !r.acquired).length, 1); assert.equal(repo.current.status, "COMMITTED"); assert.equal(fake.calls.capture.length, 2);
});

test("MOCK: early underfilled batch cannot settle; expired underfilled batch voids, never captures", async () => {
  const { repo, fake, run } = setup(1);
  await assert.rejects(run(), /MINIMUM_NOT_REACHED_BEFORE_DEADLINE/);
  assert.equal(fake.calls.capture.length, 0); assert.equal(fake.calls.void.length, 0);
  await run(START + 48 * 3600_000 + 1);
  assert.equal(repo.current.status, "CANCELLED"); assert.deepEqual(fake.calls.void, ["A1"]); assert.equal(fake.calls.capture.length, 0);
});

test("MOCK: partial capture failure refunds completed charges and voids remaining holds", async () => {
  const { repo, fake, run } = setup(3); fake.failCapture("A2");
  await run();
  assert.equal(repo.current.status, "CANCELLED"); assert.deepEqual(repo.current.pledges.map((p) => p.state), ["REFUNDED", "VOIDED", "VOIDED"]);
  assert.equal(fake.calls.capture.length, 2); assert.equal(fake.calls.refund.length, 1); assert.deepEqual(fake.calls.void, ["A2", "A3"]);
});

test("MOCK: timeout after provider capture remains uncertain, then recovers without a second charge", async () => {
  const { repo, fake, run } = setup(); fake.timeoutAfterCapture("A1");
  await run(); assert.equal(repo.current.status, "SETTLING"); assert.equal(repo.current.pledges[0].state, "UNCERTAIN");
  await run(); assert.equal(repo.current.status, "COMMITTED"); assert.equal(fake.calls.capture.length, 2); assert.equal(fake.captures.size, 2);
});

test("MOCK: timeout before provider capture retries the identical persisted request ID", async () => {
  const { repo, fake, run } = setup(); fake.timeoutBeforeCapture("A1");
  await run(); const key = repo.current.pledges[0].captureRequestId;
  await run(); assert.equal(repo.current.status, "COMMITTED"); assert.equal(fake.calls.capture[0], key); assert.equal(fake.calls.capture[1], key); assert.equal(fake.captures.size, 2);
});

test("MOCK: unknown provider state never becomes paid or cancelled", async () => {
  const { repo, fake, run } = setup(); fake.failReads(true);
  await run(START + 49 * 3600_000); assert.equal(repo.current.status, "OPEN"); assert.ok(repo.current.pledges.every((p) => p.state === "UNCERTAIN")); assert.equal(fake.calls.capture.length, 0); assert.equal(fake.calls.void.length, 0);
});

test("MOCK: mismatched merchant or amount cannot trigger capture", async () => {
  for (const kind of ["merchant", "amount"]) {
    const { repo, fake, run } = setup(); const unit = fake.orders.get("O1")!.purchase_units![0];
    if (kind === "merchant") unit.payee!.merchant_id = "ATTACKER"; else unit.amount!.value = "0.01";
    await run(); assert.equal(repo.current.status, "OPEN"); assert.equal(fake.calls.capture.length, 0); assert.equal(repo.current.pledges[0].state, "UNCERTAIN");
  }
});

test("MOCK: maker, immutable approved revision, and CAS are enforced before mutations", async () => {
  const { repo, fake, run } = setup();
  await assert.rejects(run(undefined, "attacker"), /MAKER_REQUIRED/);
  await assert.rejects(run(undefined, "maker1", 2), /APPROVED_REVISION_REQUIRED/);
  repo.failSave = true; await assert.rejects(run(), /CONCURRENT_STATE_CHANGE/); assert.equal(fake.calls.capture.length, 0);
});

test("MOCK: pending compensation is visible and completes only after provider confirmation", async () => {
  const { repo, fake, run } = setup(3); fake.failCapture("A2"); fake.pendingRefund(true);
  await run(); assert.equal(repo.current.status, "ATTENTION"); assert.equal(repo.current.pledges[0].state, "UNCERTAIN");
  await run(); assert.equal(repo.current.status, "ATTENTION"); assert.equal(fake.calls.refund.length, 1);
  fake.refunds.values().next().value!.status = "COMPLETED";
  await run(); assert.equal(repo.current.status, "CANCELLED"); assert.equal(repo.current.pledges[0].state, "REFUNDED"); assert.equal(fake.calls.refund.length, 1);
});

test("MOCK: old authorizations are voided rather than captured outside the chosen honor window", async () => {
  const { repo, fake, run } = setup();
  await run(START + 73 * 3600_000); assert.equal(repo.current.status, "CANCELLED"); assert.equal(fake.calls.capture.length, 0); assert.equal(fake.calls.void.length, 2);
});

test("MOCK: process interruption after capture but before persistence recovers from provider truth", async () => {
  const { repo, fake, run } = setup(); fake.failSaveAfterCapture();
  await assert.rejects(run(), /CONCURRENT_STATE_CHANGE/);
  assert.equal(repo.current.pledges[0].state, "CAPTURE_PENDING"); assert.equal(fake.captures.size, 1);
  repo.failSave = false;
  await run(); assert.equal(repo.current.status, "COMMITTED"); assert.equal(fake.calls.capture.length, 2); assert.equal(fake.captures.size, 2);
});

test("MOCK: declined capture still has its remaining authorization voided", async () => {
  const { repo, fake, run } = setup(3); fake.declineCapture("A2");
  await run(); assert.equal(repo.current.status, "CANCELLED"); assert.deepEqual(repo.current.pledges.map((p) => p.state), ["REFUNDED", "VOIDED", "VOIDED"]); assert.deepEqual(fake.calls.void, ["A2", "A3"]);
});

test("MOCK: terminal cleanup releases an extra late hold without refunding the committed plan", async () => {
  const { repo, fake, run } = setup(3);
  const extra = repo.current.pledges.pop()!;
  await run();
  assert.equal(repo.current.status, "COMMITTED");
  repo.current.pledges.push({ ...extra, authorizationId: undefined, authorizedAt: undefined, state: "UNCERTAIN", uncertainOperation: "authorize", authorizeRequestId: "stable-extra", checkoutExpiresAt: START + 60_000 });
  fake.authorizations.get("A3")!.create_time = new Date(START + 120_000).toISOString();
  await run(); await run();
  assert.equal(repo.current.status, "COMMITTED");
  assert.deepEqual(repo.current.pledges.map(p => p.state), ["CAPTURED", "CAPTURED", "VOIDED"]);
  assert.deepEqual(fake.calls.void, ["A3"]); assert.equal(fake.calls.refund.length, 0); assert.equal(fake.calls.capture.length, 2);
});

test("MOCK: terminal cleanup stays visible while a late authorization is still unproven", async () => {
  const { repo, fake, run } = setup(3);
  const extra = repo.current.pledges.pop()!;
  await run();
  repo.current.pledges.push({ ...extra, authorizationId: undefined, authorizedAt: undefined, state: "UNCERTAIN", uncertainOperation: "authorize", authorizeRequestId: "stable-extra" });
  const order = fake.orders.get("O3")!; const authorization = order.purchase_units![0].payments!.authorizations!.pop()!; order.status = "APPROVED";
  await run(); await run();
  assert.equal(repo.current.status, "ATTENTION"); assert.equal(repo.current.recoveryTarget, "COMMITTED");
  assert.equal(repo.current.pledges[2].state, "UNCERTAIN"); assert.equal(fake.calls.refund.length, 0);
  order.purchase_units![0].payments!.authorizations!.push(authorization);
  await run();
  assert.equal(repo.current.status, "COMMITTED"); assert.equal(repo.current.pledges[2].state, "VOIDED"); assert.equal(fake.calls.refund.length, 0);
});

test("MOCK: a frozen plan cannot commit past an unresolved off-plan authorization", async () => {
  const { repo, fake, run } = setup(3);
  repo.current.status = "SETTLING"; repo.current.settlementPledgeIds = ["p1", "p2"];
  Object.assign(repo.current.pledges[2], { authorizationId: undefined, authorizedAt: undefined, state: "UNCERTAIN", uncertainOperation: "authorize", authorizeRequestId: "stable-extra" });
  const order = fake.orders.get("O3")!; order.purchase_units![0].payments!.authorizations = []; order.status = "APPROVED";
  await run(); await run();
  assert.equal(repo.current.status, "SETTLING"); assert.equal(repo.current.pledges[2].state, "UNCERTAIN"); assert.equal(fake.calls.capture.length, 0);
});
