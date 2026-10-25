import { DomainValidationError, validateBatchPolicy } from './batch-domain.ts';
import type { FrozenBatch, Issue } from './batch-domain.ts';
import { LOCAL_MODEL } from './local-model.ts';

export const LOCAL_MODEL_ID = LOCAL_MODEL.id;
export interface ReviewedInterest {
  requestCount: number;
  eligibleUnits: number;
  eligibleRequestCount: number;
  reviewCount: number;
  conflictCount: number;
}
export interface PrivateFrozenBatch extends FrozenBatch {
  analysis: Readonly<{
    provenance: 'local-model';
    attestation: 'self-reported';
    modelId: typeof LOCAL_MODEL_ID;
    requestCount: number;
    sourceStorage: 'browser-only';
  }>;
}

function fail(code: string, field: string, message: string): never {
  throw new DomainValidationError([{ code, field, message, severity: 'review' } satisfies Issue]);
}
function strictRecord(value: unknown, fields: readonly string[], field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('INVALID_REVIEWED_PLAN', field, 'Review the local analysis summary before publishing.');
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !fields.includes(key)) || fields.some(key => !(key in result))) return fail('PRIVATE_SUMMARY_ONLY', field, 'Send only the approved summary fields. Customer text stays in this browser.');
  return result;
}

/** Validate aggregate terms, not AI execution. No source text, quotations or names are accepted. */
export function freezeReviewedTerms(input: {
  id: string; version: number; title: unknown; policy: unknown;
  summaryOfInterest: unknown; modelId: unknown; makerApproved: unknown; now: string;
}): PrivateFrozenBatch {
  if (input.makerApproved !== true) fail('MAKER_APPROVAL_REQUIRED', 'makerApproved', 'Review and approve the fixed batch terms.');
  if (input.modelId !== LOCAL_MODEL_ID) fail('UNSUPPORTED_LOCAL_MODEL', 'modelId', 'Use the supported browser model before reviewing this summary.');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(input.id) || !Number.isSafeInteger(input.version) || input.version < 1) fail('INVALID_BATCH_ID', 'id', 'The batch identity is invalid.');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 100) fail('INVALID_TITLE', 'title', 'Batch title must contain 1–100 characters.');
  const policyInput = strictRecord(input.policy, ['productId', 'currency', 'unitPriceCents', 'minimumUnits', 'capacityUnits', 'reservationWindowHours', 'variant', 'shipBy'], 'policy');
  const checkedPolicy = validateBatchPolicy(policyInput);
  if (!checkedPolicy.valid || !checkedPolicy.value) throw new DomainValidationError(checkedPolicy.issues);
  const policy = checkedPolicy.value;
  const summary = strictRecord(input.summaryOfInterest, ['requestCount', 'eligibleUnits', 'eligibleRequestCount', 'reviewCount', 'conflictCount'], 'reviewedPlan');
  for (const field of ['requestCount', 'eligibleRequestCount', 'reviewCount', 'conflictCount'] as const) {
    if (!Number.isSafeInteger(summary[field]) || (summary[field] as number) < 0 || (summary[field] as number) > 24) fail('INVALID_SUMMARY_COUNT', field, 'Each summary count must be a whole number between 0 and 24.');
  }
  const counts = summary as unknown as ReviewedInterest;
  if (counts.requestCount < 1 || counts.eligibleRequestCount + counts.reviewCount + counts.conflictCount !== counts.requestCount) fail('INCONSISTENT_SUMMARY', 'requestCount', 'The reviewed, eligible and conflicted request counts must match the total.');
  if (!Number.isSafeInteger(counts.eligibleUnits) || counts.eligibleUnits < 0 || counts.eligibleUnits > policy.capacityUnits ||
      counts.eligibleUnits < counts.eligibleRequestCount || (counts.eligibleRequestCount === 0 && counts.eligibleUnits !== 0)) fail('INVALID_SUMMARY_UNITS', 'eligibleUnits', 'Eligible quantities must fit the fixed production capacity and request count.');
  if (!counts.eligibleRequestCount) fail('NO_ELIGIBLE_DEMAND', 'eligibleRequestCount', 'Resolve at least one request before publishing a batch.');
  const now = Date.parse(input.now);
  if (!Number.isFinite(now) || new Date(now).toISOString() !== input.now) fail('INVALID_NOW', 'now', 'The server approval time is invalid.');
  const closesAt = new Date(now + 48 * 3600_000).toISOString();
  if (Date.parse(`${policy.shipBy}T23:59:59.999Z`) <= Date.parse(closesAt)) fail('SHIP_DATE_TOO_EARLY', 'shipBy', 'Dispatch must be scheduled after the reservation window closes.');
  return Object.freeze({
    id: input.id, version: input.version, title: input.title.trim(), status: 'frozen' as const,
    policy: Object.freeze({ ...policy }), makerApprovedAt: input.now, createdAt: input.now, closesAt,
    sourceRequestIds: Object.freeze([] as string[]),
    demand: Object.freeze({ kind: 'uncommitted_demand' as const, eligibleUnits: counts.eligibleUnits, eligibleRequestCount: counts.eligibleRequestCount,
      totalCents: counts.eligibleUnits * policy.unitPriceCents, remainingUnits: Math.max(0, policy.minimumUnits - counts.eligibleUnits),
      minimumReached: counts.eligibleUnits >= policy.minimumUnits, exceedsCapacity: false, reviewCount: counts.reviewCount, conflictCount: counts.conflictCount }),
    analysis: Object.freeze({ provenance: 'local-model' as const, attestation: 'self-reported' as const, modelId: LOCAL_MODEL_ID,
      requestCount: counts.requestCount, sourceStorage: 'browser-only' as const }),
  });
}
