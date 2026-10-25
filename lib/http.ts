// Explicit .ts imports also allow the HTTP contract tests to run in Node 24.
import { assessRequest, DomainValidationError, freezeBatch, validateBatchPolicy, validateSourceRequest, validateExtraction } from './batch-domain.ts';
import type { AnalyzedRequest, BatchPolicy, FrozenBatch } from './batch-domain.ts';
import { createDemoScenario } from './demo-data.ts';
import { freezeReviewedTerms, LOCAL_MODEL_ID } from './private-proposal.ts';
import { createPayPalClient, moneyMatches, PayPalError, paymentRequestId, sandboxApprovalUrl, verifyOrder } from './paypal.ts';
import type { PayPalPort } from './paypal.ts';
import { authorizationWithinWindow, runSettlement, SettlementError } from './settlement.ts';
import type { BatchSnapshot, SettlementPledge } from './settlement.ts';
import { createHttpStore } from './storage.ts';
import type { HttpStore, StoredBatch } from './storage.ts';

export interface HttpEnvironment {
  DB?: D1Database;
  PAYPAL_CLIENT_ID?: string; PAYPAL_CLIENT_SECRET?: string; PAYPAL_MERCHANT_ID?: string;
}
export interface HttpOptions {
  store?: HttpStore; paypal?: PayPalPort; now?: () => number;
}
export const MAX_BODY_BYTES = 131_072;
const HOUR = 3600_000;
const LEASE_MS = 120_000;
const CHECKOUT_MS = 15 * 60_000;
class HttpError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.name = 'HttpError'; this.status = status; this.code = code; }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'INVALID_BODY', 'Expected a JSON object.');
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new HttpError(400, 'INVALID_ID', 'Invalid resource identifier.');
  return value;
}
export async function digest(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function sessionFor(request: Request): Promise<{ ownerId: string; cookie: string }> {
  const secure = new URL(request.url).protocol === 'https:';
  const name = secure ? '__Host-batchloom-session' : 'batchloom-session';
  const candidates = (request.headers.get('cookie') ?? '').split(';').map(item => item.trim()).filter(item => item.startsWith(`${name}=`));
  if (candidates.length > 1) throw new HttpError(400, 'DUPLICATE_SESSION', 'Reload after clearing this site’s cookies.');
  let token = candidates[0]?.slice(name.length + 1);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
  return { ownerId: await digest(`batchloom-session-v1:${token}`), cookie: `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure ? '; Secure' : ''}` };
}
export function assertSameOriginMutation(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new HttpError(403, 'ORIGIN_REQUIRED', 'This action must be requested from the Batchloom page.');
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) throw new HttpError(415, 'JSON_REQUIRED', 'Send application/json.');
}
export async function readJsonBounded(request: Request): Promise<Record<string, unknown>> {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) throw new HttpError(413, 'BODY_TOO_LARGE', 'The request is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'INVALID_JSON', 'A JSON request body is required.');
  const decoder = new TextDecoder(); let bytes = 0; let text = '';
  try {
    for (;;) {
      const result = await reader.read(); if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > MAX_BODY_BYTES) { await reader.cancel(); throw new HttpError(413, 'BODY_TOO_LARGE', 'The request is too large.'); }
      text += decoder.decode(result.value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  try { return record(JSON.parse(text)); }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'INVALID_JSON', 'The JSON request could not be read.'); }
}
function analysisDigest(requests: AnalyzedRequest[], policy: BatchPolicy): Promise<string> {
  return digest(JSON.stringify({ requests: requests.map(request => ({
    source: { id: request.source.id, customerLabel: request.source.customerLabel, body: request.source.body, receivedAt: request.source.receivedAt },
    extraction: { requestId: request.extraction.requestId, ...Object.fromEntries(['product', 'quantity', 'variant', 'unitBudgetCents', 'deadline'].map(field => {
      const evidence = request.extraction[field as keyof Omit<typeof request.extraction, 'requestId'>];
      return [field, { value: evidence.value, quote: evidence.quote }];
    })) },
  })), policy }));
}
function checkedAnalysis(input: unknown, policy: BatchPolicy): AnalyzedRequest[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 24) throw new HttpError(400, 'INVALID_REQUESTS', 'Review between 1 and 24 requests.');
  return input.map(item => {
    const raw = record(item); const source = validateSourceRequest(raw.source);
    if (!source.valid || !source.value) throw new DomainValidationError(source.issues);
    const extraction = validateExtraction(source.value, raw.extraction);
    if (!extraction.valid || !extraction.value) throw new DomainValidationError(extraction.issues);
    return assessRequest(source.value, extraction.value, policy);
  });
}
function totals(snapshot: BatchSnapshot) {
  return {
    authorizedUnits: snapshot.pledges.filter(p => ['AUTHORIZED', 'CAPTURE_PENDING', 'CAPTURED'].includes(p.state)).reduce((sum, p) => sum + p.quantity, 0),
    capturedCents: snapshot.pledges.filter(p => p.state === 'CAPTURED').reduce((sum, p) => sum + p.amountMinor, 0),
  };
}
function listedBatch(stored: StoredBatch) { return { proposal: stored.proposal, status: stored.snapshot.status, ...totals(stored.snapshot) }; }
function publicBatch(stored: StoredBatch, ownIds: string[]) {
  const { proposal, snapshot } = stored;
  return {
    id: proposal.id, title: proposal.title, revision: proposal.version, policy: proposal.policy,
    opensAt: snapshot.opensAt, closesAt: snapshot.closesAt, status: snapshot.status,
    sandbox: true, ...totals(snapshot),
    reservations: snapshot.pledges.filter(p => ownIds.includes(p.id)).map(p => ({ id: p.id, quantity: p.quantity, amountMinor: p.amountMinor, state: p.state, checkoutExpiresAt: p.checkoutExpiresAt, providerStatus: p.providerStatus })),
  };
}

export async function handleApi(request: Request, env: HttpEnvironment, options: HttpOptions = {}): Promise<Response> {
  let cookie: string | undefined;
  const reply = (value: unknown, status = 200) => {
    const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
    if (cookie) headers.set('Set-Cookie', cookie);
    return Response.json(value, { status, headers });
  };
  try {
    if (request.method !== 'GET' && request.method !== 'POST') return reply({ error: 'Method not supported.' }, 405);
    if (request.method === 'POST') assertSameOriginMutation(request);
    const session = await sessionFor(request); cookie = session.cookie;
    const now = options.now ?? Date.now;
    const store = options.store ?? (env.DB ? createHttpStore(env.DB) : undefined);
    const configured = {
      storage: !!store,
      paypal: !!(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET && env.PAYPAL_MERCHANT_ID),
      ai: true, aiMode: 'browser-local' as const, modelId: LOCAL_MODEL_ID,
    };
    const path = new URL(request.url).pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
    if (request.method === 'GET' && path.join('/') === 'config') return reply(configured);
    // Refuse former server-analysis routes before reading any customer request body.
    if (path.join('/') === 'analyze' || path.join('/') === 'analyze-local') return reply({ error: 'Analysis runs in your browser. Customer request text is not accepted by this endpoint.', code: 'BROWSER_LOCAL_ANALYSIS_REQUIRED' }, 410);
    if (!store) throw new HttpError(503, 'STORAGE_NOT_CONFIGURED', 'The sandbox workspace is not connected yet. You can still explore the illustrated example.');
    const ip = await digest(`ip:${request.headers.get('cf-connecting-ip') ?? 'local-preview'}`);
    async function limit(action: string, sessionLimit: number, ipLimit: number, globalLimit?: number, windowMs = HOUR) {
      if (!await store!.quota(`${action}:session:${session.ownerId}`, sessionLimit, windowMs) || !await store!.quota(`${action}:ip:${ip}`, ipLimit, windowMs) ||
          (globalLimit !== undefined && !await store!.quota(`${action}:global`, globalLimit, 24 * HOUR))) throw new HttpError(429, 'RATE_LIMITED', 'This sandbox has reached its request limit. Please try again later.');
    }
    function paymentClient(): PayPalPort {
      if (!configured.paypal) throw new HttpError(503, 'PAYPAL_NOT_CONFIGURED', 'PayPal sandbox is not connected yet. No payment request was made.');
      return options.paypal ?? createPayPalClient({ clientId: env.PAYPAL_CLIENT_ID!, clientSecret: env.PAYPAL_CLIENT_SECRET!, merchantId: env.PAYPAL_MERCHANT_ID! });
    }
    async function requireBatch(batchId: string): Promise<StoredBatch> {
      const stored = await store!.read(id(batchId));
      if (!stored) throw new HttpError(404, 'BATCH_NOT_FOUND', 'This batch could not be found.');
      return stored;
    }
    if (request.method === 'GET' && path.join('/') === 'batches') {
      await limit('read', 120, 300);
      return reply({ batches: (await store.list(session.ownerId)).map(listedBatch) });
    }
    if (request.method === 'GET' && path[0] === 'batches' && path.length === 2) {
      await limit('read', 120, 300);
      const stored = await requireBatch(path[1]);
      return reply(publicBatch(stored, await store.buyerPledges(stored.snapshot.id, session.ownerId)));
    }
    if (request.method !== 'POST') return reply({ error: 'Endpoint not found.' }, 404);
    const body = await readJsonBounded(request);
    if (path.join('/') === 'batches') {
      await limit('publish', 8, 20, 40);
      paymentClient();
      if (body.makerApproved !== true || !['local-model', 'example'].includes(String(body.provenance))) throw new HttpError(400, 'APPROVAL_REQUIRED', 'Review the batch and approve its fixed terms.');
      const checkedPolicy = validateBatchPolicy(body.policy);
      if (!checkedPolicy.valid || !checkedPolicy.value) throw new DomainValidationError(checkedPolicy.issues);
      const policy = checkedPolicy.value;
      const created = new Date(now()).toISOString(); const newId = `batch-${crypto.randomUUID()}`;
      let proposal: FrozenBatch;
      if (body.provenance === 'local-model') {
        if (Object.keys(body).some(key => !['title', 'policy', 'makerApproved', 'provenance', 'reviewedPlan'].includes(key))) throw new HttpError(400, 'PRIVATE_SUMMARY_ONLY', 'Send only the reviewed summary and batch terms. Customer text stays in this browser.');
        const plan = record(body.reviewedPlan);
        const { modelId, ...summaryOfInterest } = plan;
        proposal = freezeReviewedTerms({ id: newId, version: 1, title: body.title, policy: body.policy, summaryOfInterest, modelId, makerApproved: body.makerApproved, now: created });
      } else {
        const requests = checkedAnalysis(body.requests, policy);
        const evidenceHash = await analysisDigest(requests, policy);
        const hashes = await Promise.all([now(), now() - 24 * HOUR].map(async date => {
          const originals = createDemoScenario(new Date(date)).analysis.map(item => assessRequest(item.source, item.extraction, policy));
          return analysisDigest(originals, policy);
        }));
        if (!hashes.includes(evidenceHash)) throw new HttpError(400, 'EXAMPLE_CHANGED', 'Restore today’s synthetic sample, or run live analysis for edited requests.');
        proposal = freezeBatch({ id: newId, version: 1, title: body.title as string, policy, requests, makerApprovedAt: created, now: created });
      }
      const snapshot: BatchSnapshot = { id: proposal.id, ownerId: session.ownerId, revision: 1, makerApprovedRevision: 1, version: 0, status: 'OPEN', currency: 'USD', merchantId: env.PAYPAL_MERCHANT_ID!, targetUnits: policy.minimumUnits, capacityUnits: policy.capacityUnits, opensAt: now(), closesAt: Date.parse(proposal.closesAt), pledges: [] };
      await store.create(proposal, snapshot);
      return reply({ ...listedBatch({ proposal, snapshot }), buyerUrl: `/batch/${proposal.id}`, provenance: body.provenance }, 201);
    }
    if (path[0] !== 'batches' || path.length !== 3) return reply({ error: 'Endpoint not found.' }, 404);
    const stored = await requireBatch(path[1]); const batchId = stored.snapshot.id;
    if (path[2] === 'settle') {
      if (stored.snapshot.ownerId !== session.ownerId) throw new HttpError(404, 'BATCH_NOT_FOUND', 'This batch could not be found.');
      await limit('settle', 30, 60);
      const result = await runSettlement({ batchId, actorId: session.ownerId, expectedRevision: Number(body.revision), repository: store.settlement, paypal: paymentClient(), now });
      return reply({ acquired: result.acquired, status: result.snapshot?.status, ...(result.snapshot ? totals(result.snapshot) : {}) });
    }
    if (path[2] !== 'checkout' && path[2] !== 'authorize') return reply({ error: 'Endpoint not found.' }, 404);
    await limit('checkout', 30, 80, 200);
    const paypal = paymentClient(); const lease = crypto.randomUUID();
    if (!await store.settlement.acquireLease(batchId, lease, now(), now() + LEASE_MS)) throw new HttpError(409, 'BATCH_BUSY', 'This batch is processing another action. Try again shortly.');
    try {
      const snapshot = await store.settlement.load(batchId);
      if (!snapshot) throw new HttpError(404, 'BATCH_NOT_FOUND', 'This batch could not be found.');
      if (body.revision !== snapshot.revision) throw new HttpError(409, 'REVISION_CHANGED', 'Reload this batch and review its current terms.');
      async function persist() {
        if (!await store!.settlement.renewLease(batchId, lease, now(), now() + LEASE_MS)) throw new HttpError(409, 'LEASE_LOST', 'The payment state needs to be refreshed.');
        const expected = snapshot!.version; snapshot!.version++;
        if (!await store!.settlement.save(snapshot!, expected, lease, now())) throw new HttpError(409, 'STATE_CHANGED', 'The payment state needs to be refreshed.');
      }
      const origin = new URL(request.url).origin;
      if (path[2] === 'checkout') {
        if (body.consent !== true || !Number.isSafeInteger(body.quantity) || Number(body.quantity) < 1 || Number(body.quantity) > snapshot.capacityUnits) throw new HttpError(400, 'BUYER_REVIEW_REQUIRED', 'Choose a quantity and accept the sandbox reservation terms.');
        if (snapshot.status !== 'OPEN' || now() < snapshot.opensAt || now() >= snapshot.closesAt) throw new HttpError(409, 'BATCH_CLOSED', 'This reservation window has closed.');
        const nonce = id(body.nonce);
        const pledgeId = `p-${(await digest(`${session.ownerId}:${batchId}:${nonce}`)).slice(0, 48)}`;
        let pledge = snapshot.pledges.find(item => item.id === pledgeId);
        if (pledge && pledge.quantity !== body.quantity) throw new HttpError(409, 'CHECKOUT_CHANGED', 'A pending checkout has different terms. Resume it or start a new reservation.');
        if (!pledge) {
          const reserved = snapshot.pledges.filter(p => !['FAILED', 'VOIDED', 'REFUNDED'].includes(p.state) && (p.authorizationId || p.authorizeRequestId || p.uncertainOperation === 'authorize' || (p.checkoutExpiresAt ?? 0) > now())).reduce((sum, p) => sum + p.quantity, 0);
          if (reserved + Number(body.quantity) > snapshot.capacityUnits) throw new HttpError(409, 'CAPACITY_REACHED', 'There is not enough space left in this batch.');
          pledge = { id: pledgeId, batchRevision: snapshot.revision, quantity: Number(body.quantity), amountMinor: stored.proposal.policy.unitPriceCents * Number(body.quantity), currency: 'USD', state: 'CHECKOUT_CREATED', checkoutExpiresAt: Math.min(now() + CHECKOUT_MS, snapshot.closesAt), createRequestId: await paymentRequestId(pledgeId, 'create') };
          await store.linkBuyer(pledgeId, batchId, session.ownerId, now());
          snapshot.pledges.push(pledge); await persist();
        }
        if ((pledge.checkoutExpiresAt ?? 0) <= now() && !pledge.authorizationId) throw new HttpError(409, 'CHECKOUT_EXPIRED', 'This checkout expired. Start a new reservation.');
        if (pledge.authorizationId) return reply({ pledgeId, state: pledge.state });
        if (pledge.authorizeRequestId || pledge.state === 'AUTHORIZING' || pledge.uncertainOperation === 'authorize') return reply({ pledgeId, state: 'UNCERTAIN', error: 'An authorization is still being checked. Use “Check PayPal approval” for this same reservation.' }, 202);
        try {
          const order = pledge.orderId ? await paypal.getOrder(pledge.orderId) : await paypal.createOrder({ pledgeId, batchId, revision: snapshot.revision, amountMinor: pledge.amountMinor, currency: 'USD', description: `${stored.proposal.title} — ${pledge.quantity} ${stored.proposal.policy.variant} notebooks. Conditional sandbox reservation.`, returnUrl: `${origin}/batch/${batchId}?approval=1&pledge=${pledgeId}`, cancelUrl: `${origin}/batch/${batchId}?cancelled=1`, requestId: pledge.createRequestId! });
          verifyOrder(order, { pledgeId, batchId, revision: snapshot.revision, amountMinor: pledge.amountMinor, currency: 'USD', merchantId: snapshot.merchantId });
          pledge.orderId = order.id; pledge.state = 'CHECKOUT_CREATED'; delete pledge.uncertainOperation;
          await persist();
          return reply({ pledgeId, state: pledge.state, approvalUrl: sandboxApprovalUrl(order) });
        } catch (error) {
          if (error instanceof PayPalError && error.uncertain) { pledge.state = 'UNCERTAIN'; pledge.uncertainOperation = 'create'; await persist(); return reply({ pledgeId, state: 'UNCERTAIN', error: 'PayPal’s response was interrupted. Resume the same reservation to check it safely.' }, 202); }
          throw error;
        }
      }
      const pledgeId = id(body.pledgeId);
      if (!(await store.buyerPledges(batchId, session.ownerId)).includes(pledgeId)) throw new HttpError(404, 'RESERVATION_NOT_FOUND', 'This reservation could not be found in this browser.');
      const pledge = snapshot.pledges.find(p => p.id === pledgeId);
      if (!pledge?.orderId) throw new HttpError(409, 'ORDER_NOT_CONFIRMED', 'Resume checkout before confirming this reservation.');
      if (pledge.authorizationId && !['AUTHORIZING', 'UNCERTAIN'].includes(pledge.state)) return reply({ pledgeId, state: pledge.state });
      const expected = { pledgeId, batchId, revision: snapshot.revision, amountMinor: pledge.amountMinor, currency: pledge.currency, merchantId: snapshot.merchantId };
      let order = await paypal.getOrder(pledge.orderId); verifyOrder(order, expected);
      let authorization = order.purchase_units?.[0].payments?.authorizations?.[0];
      const authorizedInTime = !!authorization?.create_time && authorizationWithinWindow(snapshot, pledge, Date.parse(authorization.create_time), now());
      const partOfSettlement = snapshot.settlementPledgeIds?.includes(pledge.id) === true;
      const late = (snapshot.status !== 'OPEN' && !partOfSettlement) || (!authorizedInTime && (now() >= snapshot.closesAt || now() >= (pledge.checkoutExpiresAt ?? 0)));
      if (late && !authorization) throw new HttpError(409, 'BATCH_CLOSED', 'The reservation window closed before this payment was authorized. No new hold was created.');
      if (!authorization) {
        if (order.status !== 'APPROVED') throw new HttpError(409, 'APPROVAL_REQUIRED', 'Complete the PayPal sandbox approval first.');
        pledge.authorizeRequestId ??= await paymentRequestId(pledgeId, 'authorize'); pledge.authorizationAttemptedAt ??= now(); pledge.state = 'AUTHORIZING'; await persist();
        try {
          await paypal.authorizeOrder(pledge.orderId, pledge.authorizeRequestId);
          pledge.authorizationResponseAt = now();
          order = await paypal.getOrder(pledge.orderId); verifyOrder(order, expected);
          authorization = order.purchase_units?.[0].payments?.authorizations?.[0];
        } catch (error) {
          pledge.authorizationResponseAt = now();
          pledge.state = 'UNCERTAIN'; pledge.uncertainOperation = 'authorize'; await persist();
          if (error instanceof PayPalError) return reply({ pledgeId, state: 'UNCERTAIN', error: 'The authorization result needs another check. No automatic second reservation was made.' }, 202);
          throw error;
        }
      }
      if (!authorization || !moneyMatches(authorization.amount, pledge.amountMinor, pledge.currency) || !authorization.create_time || !Number.isFinite(Date.parse(authorization.create_time))) throw new HttpError(409, 'AUTHORIZATION_UNVERIFIED', 'PayPal authorization details need review.');
      pledge.authorizationId = authorization.id; pledge.authorizedAt = Date.parse(authorization.create_time); pledge.providerStatus = authorization.status;
      // Recheck after the provider round trip. A pre-call deadline check alone
      // cannot admit an authorization created or returned beyond the window.
      const lateAfterResponse = late || !authorizationWithinWindow(snapshot, pledge, pledge.authorizedAt, now()) || (snapshot.status !== 'OPEN' && !partOfSettlement);
      if (lateAfterResponse && authorization.status === 'CREATED') {
        pledge.state = 'VOID_PENDING'; await persist();
        try {
          await paypal.voidAuthorization(authorization.id); const confirmed = await paypal.getAuthorization(authorization.id);
          if (confirmed.status !== 'VOIDED') throw new Error('Void not confirmed');
          pledge.state = 'VOIDED'; pledge.providerStatus = 'VOIDED'; delete pledge.uncertainOperation; await persist();
          return reply({ pledgeId, state: 'VOIDED', message: 'The late authorization was cancelled.' });
        } catch { pledge.state = 'UNCERTAIN'; pledge.uncertainOperation = 'void'; await persist(); return reply({ pledgeId, state: 'UNCERTAIN', error: 'The late hold needs reconciliation. The maker can check and release it.' }, 202); }
      }
      if (authorization.status === 'CREATED') { pledge.state = 'AUTHORIZED'; delete pledge.uncertainOperation; }
      else if (authorization.status === 'VOIDED') { pledge.state = 'VOIDED'; delete pledge.uncertainOperation; }
      else if (authorization.status === 'CAPTURED' && pledge.captureId) { /* Settlement already recorded this capture. */ }
      else { pledge.state = 'UNCERTAIN'; pledge.uncertainOperation = 'authorize'; }
      await persist(); return reply({ pledgeId, state: pledge.state });
    } finally { await store.settlement.releaseLease(batchId, lease); }
  } catch (error) {
    if (error instanceof HttpError) return reply({ error: error.message, code: error.code }, error.status);
    if (error instanceof DomainValidationError) return reply({ error: error.issues[0]?.message ?? 'Review the batch information.', code: 'INVALID_BATCH' }, 400);
    if (error instanceof SettlementError) return reply({ error: error.code === 'MINIMUM_NOT_REACHED_BEFORE_DEADLINE' ? 'The minimum has not been reached. Wait for more reservations or the deadline.' : 'Settlement needs another review. Refresh the batch before retrying.', code: error.code }, 409);
    if (error instanceof PayPalError) return reply({ error: error.uncertain ? 'PayPal’s result is uncertain. Refresh before retrying this same action.' : 'PayPal sandbox could not complete this request. No success has been assumed.', code: error.code }, 502);
    return reply({ error: 'This action could not be completed. Refresh and try again.', code: 'REQUEST_FAILED' }, 500);
  }
}
