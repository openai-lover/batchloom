// Explicit extension supports Node's native TypeScript test runner as well as Vite.
// @ts-ignore -- repository tsconfig predates allowImportingTsExtensions.
import { PayPalError, moneyMatches, paymentRequestId, verifyOrder } from "./paypal.ts";
import type { Currency, PayPalPort, PayPalCapture, PayPalOrder, PayPalAuthorization, PayPalRefund } from "./paypal";

export type BatchState = "OPEN" | "SETTLING" | "UNWINDING" | "COMMITTED" | "CANCELLED" | "ATTENTION";
export type PledgeState = "CHECKOUT_CREATED" | "AUTHORIZING" | "AUTHORIZED" | "CAPTURE_PENDING" | "CAPTURED" | "VOID_PENDING" | "VOIDED" | "REFUND_PENDING" | "REFUNDED" | "FAILED" | "UNCERTAIN";
export interface SettlementPledge {
  id: string; batchRevision: number; quantity: number; amountMinor: number; currency: Currency;
  state: PledgeState; orderId?: string; authorizationId?: string; authorizedAt?: number;
  captureId?: string; refundId?: string; captureRequestId?: string; refundRequestId?: string;
  createRequestId?: string; authorizeRequestId?: string; checkoutExpiresAt?: number;
  authorizationAttemptedAt?: number; authorizationResponseAt?: number;
  uncertainOperation?: "create" | "authorize" | "capture" | "void" | "refund";
  providerStatus?: string; errorCode?: string;
}
export interface BatchSnapshot {
  id: string; ownerId: string; revision: number; makerApprovedRevision: number; version: number;
  status: BatchState; currency: Currency; merchantId: string;
  targetUnits: number; capacityUnits: number; opensAt: number; closesAt: number;
  pledges: SettlementPledge[]; settlementPledgeIds?: string[]; failureReason?: string;
  /** Preserve successful planned charges while cleaning up an unexpected late hold. */
  recoveryTarget?: "COMMITTED" | "CANCELLED";
}
/**
 * Implement these atomically in durable storage. acquire/renew/save must reject
 * an expired or superseded token. save uses both version CAS and the live lease.
 * save persists next.version = expectedVersion + 1, never silently overwrites.
 */
export interface SettlementRepository {
  load(batchId: string): Promise<BatchSnapshot | null>;
  acquireLease(batchId: string, token: string, nowMs: number, untilMs: number): Promise<boolean>;
  renewLease(batchId: string, token: string, nowMs: number, untilMs: number): Promise<boolean>;
  save(next: BatchSnapshot, expectedVersion: number, token: string, nowMs: number): Promise<boolean>;
  releaseLease(batchId: string, token: string): Promise<void>;
}
export interface SettlementResult { acquired: boolean; snapshot: BatchSnapshot | null }
export class SettlementError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = "SettlementError"; this.code = code; }
}

const HONOR_MS = 72 * 60 * 60 * 1000;
const WINDOW_MS = 48 * 60 * 60 * 1000;
const LEASE_MS = 120_000;
export function authorizationWithinWindow(batch: Pick<BatchSnapshot, "opensAt" | "closesAt">, pledge: Pick<SettlementPledge, "checkoutExpiresAt" | "authorizationAttemptedAt" | "authorizationResponseAt">, createdAt: number, observedAt: number): boolean {
  const cutoff = Math.min(batch.closesAt, pledge.checkoutExpiresAt ?? batch.closesAt);
  return Number.isFinite(createdAt) && createdAt >= Math.floor(batch.opensAt / 1000) * 1000 && createdAt <= observedAt && createdAt < cutoff &&
    (pledge.authorizationAttemptedAt === undefined || (pledge.authorizationAttemptedAt >= batch.opensAt && pledge.authorizationAttemptedAt < cutoff)) &&
    (pledge.authorizationResponseAt === undefined || pledge.authorizationResponseAt < cutoff);
}
function unresolvedAuthorization(pledge: SettlementPledge): boolean {
  return !pledge.authorizationId && (pledge.state === "AUTHORIZING" || pledge.uncertainOperation === "authorize" || !!pledge.authorizeRequestId) &&
    !["VOIDED", "REFUNDED", "FAILED"].includes(pledge.state);
}
function mayHaveUnsettledFunds(pledge: SettlementPledge): boolean {
  if (unresolvedAuthorization(pledge)) return true;
  if (["AUTHORIZED", "AUTHORIZING", "CAPTURE_PENDING", "VOID_PENDING", "REFUND_PENDING"].includes(pledge.state)) return true;
  return pledge.state === "UNCERTAIN" && pledge.uncertainOperation !== "create";
}
function terminalNeedsCleanup(batch: BatchSnapshot): boolean {
  return batch.pledges.some(pledge => {
    if (batch.status === "COMMITTED" && batch.settlementPledgeIds?.includes(pledge.id) && pledge.state === "CAPTURED") return false;
    return mayHaveUnsettledFunds(pledge) || pledge.state === "CAPTURED";
  });
}
function errorCode(error: unknown): string {
  if (error instanceof PayPalError) return error.code;
  return "PROVIDER_STATE_UNVERIFIED";
}
function checkSnapshot(batch: BatchSnapshot, actorId: string, expectedRevision: number): void {
  if (batch.ownerId !== actorId) throw new SettlementError("MAKER_REQUIRED");
  if (batch.revision !== expectedRevision || batch.makerApprovedRevision !== batch.revision) throw new SettlementError("APPROVED_REVISION_REQUIRED");
  if (!Number.isInteger(batch.targetUnits) || batch.targetUnits < 1 || !Number.isInteger(batch.capacityUnits) || batch.capacityUnits < batch.targetUnits ||
      batch.currency !== "USD" || !batch.merchantId || !Number.isFinite(batch.opensAt) || !Number.isFinite(batch.closesAt) ||
      batch.closesAt <= batch.opensAt || batch.closesAt - batch.opensAt > WINDOW_MS) throw new SettlementError("INVALID_BATCH_POLICY");
  if (new Set(batch.pledges.map((p) => p.id)).size !== batch.pledges.length) throw new SettlementError("DUPLICATE_PLEDGE");
  for (const pledge of batch.pledges) {
    if (pledge.batchRevision !== batch.revision || pledge.currency !== batch.currency || !Number.isInteger(pledge.quantity) || pledge.quantity < 1 ||
        !Number.isSafeInteger(pledge.amountMinor) || pledge.amountMinor < 1 || pledge.amountMinor > 100_000_000) throw new SettlementError("INVALID_PLEDGE");
  }
}

/** Restartable, sandbox-only saga. All provider mutations are preceded by a CAS save. */
export async function runSettlement(input: {
  batchId: string; actorId: string; expectedRevision: number;
  repository: SettlementRepository; paypal: PayPalPort; now?: () => number;
}): Promise<SettlementResult> {
  const { repository, paypal } = input;
  const now = input.now ?? Date.now;
  let batch = await repository.load(input.batchId);
  if (!batch) throw new SettlementError("BATCH_NOT_FOUND");
  checkSnapshot(batch, input.actorId, input.expectedRevision);
  if ((batch.status === "COMMITTED" || batch.status === "CANCELLED") && !terminalNeedsCleanup(batch)) return { acquired: true, snapshot: batch };
  if (now() < batch.opensAt) throw new SettlementError("BATCH_NOT_OPEN");
  const token = crypto.randomUUID();
  if (!await repository.acquireLease(batch.id, token, now(), now() + LEASE_MS)) return { acquired: false, snapshot: batch };
  try {
    // Reload after claiming the lease: the preceding snapshot may be stale.
    batch = await repository.load(input.batchId);
    if (!batch) throw new SettlementError("BATCH_NOT_FOUND");
    checkSnapshot(batch, input.actorId, input.expectedRevision);
    const current = batch;
    async function heartbeat(): Promise<void> {
      if (!await repository.renewLease(current.id, token, now(), now() + LEASE_MS)) throw new SettlementError("LEASE_LOST");
    }
    async function save(): Promise<void> {
      await heartbeat();
      const expected = current.version;
      current.version = expected + 1;
      if (!await repository.save(structuredClone(current), expected, token, now())) throw new SettlementError("CONCURRENT_STATE_CHANGE");
    }
    async function readOrder(pledge: SettlementPledge): Promise<PayPalOrder> {
      if (!pledge.orderId) throw new SettlementError("ORDER_MISSING");
      await heartbeat();
      const order = await paypal.getOrder(pledge.orderId);
      if (order.id !== pledge.orderId) throw new SettlementError("ORDER_ID_MISMATCH");
      verifyOrder(order, { pledgeId: pledge.id, batchId: current.id, revision: current.revision, amountMinor: pledge.amountMinor, currency: pledge.currency, merchantId: current.merchantId });
      return order;
    }
    function validateCapture(capture: PayPalCapture, pledge: SettlementPledge): void {
      if (!capture.id || !moneyMatches(capture.amount, pledge.amountMinor, pledge.currency) ||
          (capture.supplementary_data?.related_ids?.authorization_id && capture.supplementary_data.related_ids.authorization_id !== pledge.authorizationId) ||
          (capture.supplementary_data?.related_ids?.order_id && capture.supplementary_data.related_ids.order_id !== pledge.orderId)) throw new SettlementError("CAPTURE_MISMATCH");
    }
    function validateAuthorization(auth: PayPalAuthorization, pledge: SettlementPledge): void {
      if (!auth.id || !moneyMatches(auth.amount, pledge.amountMinor, pledge.currency) ||
          (pledge.authorizationId && auth.id !== pledge.authorizationId) ||
          (auth.supplementary_data?.related_ids?.order_id && auth.supplementary_data.related_ids.order_id !== pledge.orderId)) throw new SettlementError("AUTHORIZATION_MISMATCH");
    }
    function acceptCapture(pledge: SettlementPledge, capture: PayPalCapture): void {
      validateCapture(capture, pledge);
      pledge.captureId = capture.id;
      pledge.providerStatus = capture.status;
      if (capture.status === "COMPLETED") {
        pledge.state = "CAPTURED"; delete pledge.uncertainOperation; delete pledge.errorCode;
      } else if (capture.status === "REFUNDED") {
        pledge.state = "REFUNDED"; delete pledge.uncertainOperation;
      } else if (["DECLINED", "DENIED", "FAILED"].includes(capture.status)) {
        pledge.state = "FAILED"; pledge.errorCode = "CAPTURE_DECLINED";
      } else { pledge.state = "UNCERTAIN"; pledge.uncertainOperation = "capture"; }
    }
    function acceptRefund(pledge: SettlementPledge, refund: PayPalRefund): void {
      if (!refund.id || (refund.amount && !moneyMatches(refund.amount, pledge.amountMinor, pledge.currency))) throw new SettlementError("REFUND_MISMATCH");
      pledge.refundId = refund.id; pledge.providerStatus = refund.status;
      if (refund.status === "COMPLETED") {
        pledge.state = "REFUNDED"; delete pledge.uncertainOperation; delete pledge.errorCode;
      } else { pledge.state = "UNCERTAIN"; pledge.uncertainOperation = "refund"; }
    }
    async function reconcile(pledge: SettlementPledge): Promise<void> {
      if (!pledge.orderId || ["VOIDED", "REFUNDED"].includes(pledge.state)) return;
      const order = await readOrder(pledge);
      const payments = order.purchase_units![0].payments;
      if (pledge.refundId) {
        const refund = await paypal.getRefund(pledge.refundId);
        if (refund.id !== pledge.refundId) throw new SettlementError("REFUND_ID_MISMATCH");
        acceptRefund(pledge, refund); return;
      }
      const captures = payments?.captures ?? [];
      if (captures.length > 1) throw new SettlementError("MULTIPLE_CAPTURES_REQUIRE_REVIEW");
      const knownCapture = pledge.captureId ? await paypal.getCapture(pledge.captureId) : captures[0];
      if (knownCapture) {
        if (pledge.captureId && knownCapture.id !== pledge.captureId) throw new SettlementError("CAPTURE_ID_MISMATCH");
        acceptCapture(pledge, knownCapture);
        // Preserve an uncertain refund so its stable operation is retried, not a fresh capture.
        if (pledge.refundRequestId && pledge.state === "CAPTURED") { pledge.state = "UNCERTAIN"; pledge.uncertainOperation = "refund"; }
        if (pledge.state !== "FAILED") return;
        // A declined capture did not necessarily release its authorization.
        // Continue to the authorization so compensation can still void the hold.
        delete pledge.captureId;
      }
      const auths = payments?.authorizations ?? [];
      if (auths.length > 1) throw new SettlementError("MULTIPLE_AUTHORIZATIONS_REQUIRE_REVIEW");
      const auth = pledge.authorizationId ? await paypal.getAuthorization(pledge.authorizationId) : auths[0];
      if (auth) {
        validateAuthorization(auth, pledge);
        pledge.authorizationId = auth.id;
        const createdAt = auth.create_time ? Date.parse(auth.create_time) : pledge.authorizedAt;
        if (createdAt === undefined || !Number.isFinite(createdAt)) throw new SettlementError("AUTHORIZATION_TIME_MISSING");
        pledge.authorizedAt = createdAt;
        pledge.providerStatus = auth.status;
        if (auth.status === "CREATED" && !authorizationWithinWindow(current, pledge, createdAt, now())) {
          pledge.state = "VOID_PENDING"; pledge.uncertainOperation = "void"; pledge.errorCode = "AUTHORIZATION_OUTSIDE_RESERVATION_WINDOW";
          await save(); await heartbeat();
          await paypal.voidAuthorization(auth.id);
          const confirmed = await paypal.getAuthorization(auth.id);
          validateAuthorization(confirmed, pledge);
          if (confirmed.status !== "VOIDED") throw new SettlementError("LATE_AUTHORIZATION_VOID_UNCONFIRMED");
          pledge.state = "VOIDED"; pledge.providerStatus = "VOIDED"; delete pledge.uncertainOperation;
          await save();
        }
        else if (auth.status === "CREATED") { pledge.state = "AUTHORIZED"; delete pledge.uncertainOperation; delete pledge.errorCode; }
        else if (auth.status === "VOIDED") { pledge.state = "VOIDED"; delete pledge.uncertainOperation; }
        else if (["DENIED", "EXPIRED"].includes(auth.status)) { pledge.state = "FAILED"; delete pledge.uncertainOperation; }
        else { pledge.state = "UNCERTAIN"; pledge.uncertainOperation = "capture"; }
      } else if (order.status === "VOIDED") {
        pledge.state = "FAILED"; delete pledge.uncertainOperation;
      } else if (unresolvedAuthorization(pledge)) {
        // A negative read is not proof that an interrupted mutation did not run.
        // Preserve it until a positive authorization or terminal provider result exists.
        pledge.state = "UNCERTAIN"; pledge.uncertainOperation = "authorize";
      } else if (["CREATED", "PAYER_ACTION_REQUIRED", "APPROVED"].includes(order.status)) {
        pledge.state = "CHECKOUT_CREATED";
      } else { pledge.state = "UNCERTAIN"; pledge.uncertainOperation = "authorize"; }
    }
    async function reconcileAll(): Promise<boolean> {
      for (const pledge of current.pledges) {
        try { await reconcile(pledge); }
        catch (error) {
          if (error instanceof SettlementError && ["LEASE_LOST", "CONCURRENT_STATE_CHANGE"].includes(error.code)) throw error;
          pledge.errorCode = errorCode(error);
          // Verification failures do not turn a potentially charged payment into a failure.
          pledge.state = "UNCERTAIN";
          pledge.uncertainOperation ??= pledge.captureId ? "capture" : "authorize";
        }
      }
      await save();
      return !current.pledges.some((p) => p.state === "UNCERTAIN" && p.uncertainOperation !== "refund");
    }

    if (current.status === "COMMITTED" || current.status === "CANCELLED") {
      if (!terminalNeedsCleanup(current)) return { acquired: true, snapshot: current };
      current.recoveryTarget = current.status; current.status = "ATTENTION";
      current.failureReason = "TERMINAL_RESERVATION_RECONCILIATION"; await save();
    }
    if (current.status === "OPEN") {
      if (!await reconcileAll()) { current.failureReason = "PAYMENT_RECONCILIATION_REQUIRED"; await save(); return { acquired: true, snapshot: current }; }
      const authorized = current.pledges.filter((p) => p.state === "AUTHORIZED");
      const units = authorized.reduce((sum, pledge) => sum + pledge.quantity, 0);
      if (units < current.targetUnits && now() < current.closesAt) throw new SettlementError("MINIMUM_NOT_REACHED_BEFORE_DEADLINE");
      if (current.pledges.some((p) => p.state === "CAPTURED")) throw new SettlementError("UNEXPECTED_CAPTURE_BEFORE_SETTLEMENT");
      const outsideHonor = authorized.some((p) => p.authorizedAt === undefined || p.authorizedAt < current.opensAt || now() - p.authorizedAt >= HONOR_MS);
      if (units < current.targetUnits || units > current.capacityUnits || outsideHonor) {
        current.status = "UNWINDING";
        current.failureReason = units < current.targetUnits ? "MINIMUM_NOT_REACHED" : units > current.capacityUnits ? "CAPACITY_EXCEEDED" : "HONOR_WINDOW_EXCEEDED";
      } else {
        current.status = "SETTLING";
        current.settlementPledgeIds = authorized.map((p) => p.id);
      }
      await save();
    }
    if (current.status === "ATTENTION") {
      // ATTENTION is only entered after compensation began; never restart collection.
      current.status = "UNWINDING"; await save();
    }
    if (current.status === "SETTLING") {
      if (!current.settlementPledgeIds?.length) throw new SettlementError("SETTLEMENT_PLAN_MISSING");
      const plan = current.settlementPledgeIds.map((id) => current.pledges.find((p) => p.id === id));
      if (plan.some((p) => !p) || new Set(current.settlementPledgeIds).size !== plan.length) throw new SettlementError("SETTLEMENT_PLAN_INVALID");
      const planned = plan as SettlementPledge[];
      const units = planned.reduce((sum, pledge) => sum + pledge.quantity, 0);
      if (units < current.targetUnits || units > current.capacityUnits) throw new SettlementError("SETTLEMENT_PLAN_INVALID");
      // Frozen plans must never hide a mutation still processing outside the plan.
      for (const pledge of current.pledges.filter(p => !current.settlementPledgeIds!.includes(p.id))) {
        try { await reconcile(pledge); await save(); }
        catch (error) {
          if (error instanceof SettlementError && ["LEASE_LOST", "CONCURRENT_STATE_CHANGE"].includes(error.code)) throw error;
          pledge.state = "UNCERTAIN"; pledge.uncertainOperation ??= "authorize"; await save();
        }
        if (mayHaveUnsettledFunds(pledge) || pledge.state === "CAPTURED") {
          if (pledge.state === "AUTHORIZED" || pledge.state === "CAPTURED") { current.status = "UNWINDING"; current.failureReason = "UNPLANNED_AUTHORIZATION"; await save(); break; }
          current.failureReason = "UNPLANNED_PAYMENT_RECONCILIATION_REQUIRED"; await save(); return { acquired: true, snapshot: current };
        }
      }
      for (const pledge of planned) {
        if (current.status !== "SETTLING") break;
        try {
          await reconcile(pledge); await save();
          if (pledge.state === "CAPTURED") continue;
          if (pledge.state === "UNCERTAIN") return { acquired: true, snapshot: current };
          if (pledge.state !== "AUTHORIZED" || !pledge.authorizationId || pledge.authorizedAt === undefined || !authorizationWithinWindow(current, pledge, pledge.authorizedAt, now()) || now() - pledge.authorizedAt >= HONOR_MS) {
            current.status = "UNWINDING"; current.failureReason = "AUTHORIZATION_NO_LONGER_VALID"; await save(); break;
          }
          pledge.captureRequestId ??= await paymentRequestId(pledge.id, "capture");
          pledge.state = "CAPTURE_PENDING";
          await save(); // Persist the operation before crossing the network boundary.
          await heartbeat();
          const capture = await paypal.captureAuthorization(pledge.authorizationId, { amountMinor: pledge.amountMinor, currency: pledge.currency, invoiceId: pledge.id, requestId: pledge.captureRequestId });
          acceptCapture(pledge, capture); await save();
          const stateAfterCapture = (pledge as SettlementPledge).state;
          if (stateAfterCapture === "UNCERTAIN") return { acquired: true, snapshot: current };
          if (stateAfterCapture !== "CAPTURED") { current.status = "UNWINDING"; current.failureReason = "CAPTURE_FAILED"; await save(); break; }
        } catch (error) {
          if (error instanceof SettlementError && ["LEASE_LOST", "CONCURRENT_STATE_CHANGE"].includes(error.code)) throw error;
          pledge.errorCode = errorCode(error);
          if (error instanceof PayPalError && !error.uncertain && error.status !== undefined && error.status >= 400 && error.status < 500) {
            // Reconcile before compensation: 4xx can mean this authorization was already captured.
            try { await reconcile(pledge); }
            catch { pledge.state = "UNCERTAIN"; pledge.uncertainOperation = "capture"; }
            if (pledge.state === "CAPTURED") { await save(); continue; }
            if (pledge.state === "AUTHORIZED" || pledge.state === "FAILED" || pledge.state === "VOIDED") {
              current.status = "UNWINDING"; current.failureReason = "CAPTURE_FAILED"; await save(); break;
            }
          }
          pledge.state = "UNCERTAIN"; pledge.uncertainOperation = "capture";
          await save();
          return { acquired: true, snapshot: current };
        }
      }
      if (current.status === "SETTLING" && planned.every((p) => p.state === "CAPTURED")) {
        current.status = "COMMITTED"; delete current.failureReason; await save();
      }
    }
    if (current.status === "UNWINDING") {
      let needsAttention = false;
      for (const pledge of current.pledges) {
        if (current.recoveryTarget === "COMMITTED" && current.settlementPledgeIds?.includes(pledge.id) && pledge.state === "CAPTURED") continue;
        try {
          await reconcile(pledge); await save();
          if (["VOIDED", "REFUNDED", "FAILED", "CHECKOUT_CREATED"].includes(pledge.state)) continue;
          if (pledge.state === "CAPTURED" || (pledge.state === "UNCERTAIN" && pledge.uncertainOperation === "refund")) {
            if (!pledge.captureId) throw new SettlementError("CAPTURE_ID_MISSING");
            if (pledge.refundId) { needsAttention = true; continue; }
            pledge.refundRequestId ??= await paymentRequestId(pledge.id, "full-refund");
            pledge.state = "REFUND_PENDING"; await save(); await heartbeat();
            acceptRefund(pledge, await paypal.refundCapture(pledge.captureId, pledge.refundRequestId));
            await save();
            if ((pledge as SettlementPledge).state !== "REFUNDED") needsAttention = true;
          } else if (pledge.state === "AUTHORIZED" && pledge.authorizationId) {
            pledge.state = "VOID_PENDING"; await save(); await heartbeat();
            await paypal.voidAuthorization(pledge.authorizationId);
            const authorization = await paypal.getAuthorization(pledge.authorizationId);
            validateAuthorization(authorization, pledge);
            if (authorization.status !== "VOIDED") throw new SettlementError("VOID_NOT_CONFIRMED");
            pledge.state = "VOIDED"; pledge.providerStatus = "VOIDED"; delete pledge.uncertainOperation;
            await save();
          } else { needsAttention = true; }
        } catch (error) {
          if (error instanceof SettlementError && ["LEASE_LOST", "CONCURRENT_STATE_CHANGE"].includes(error.code)) throw error;
          pledge.errorCode = errorCode(error);
          pledge.uncertainOperation = pledge.refundRequestId ? "refund" : pledge.captureId ? "capture" : "void";
          pledge.state = "UNCERTAIN"; needsAttention = true; await save();
        }
      }
      current.status = needsAttention ? "ATTENTION" : (current.recoveryTarget ?? "CANCELLED");
      if (!needsAttention) delete current.recoveryTarget;
      await save();
    }
    return { acquired: true, snapshot: current };
  } finally { await repository.releaseLease(input.batchId, token); }
}
