/** Pure proposal rules. Request interest is never a payment authorization. */
export type IssueSeverity = 'info' | 'review' | 'conflict';

export interface Issue {
  code: string;
  field: string;
  message: string;
  severity: IssueSeverity;
  requestId?: string;
}

export interface Evidence<T> {
  value: T | null;
  quote: string | null;
}

export interface SourceRequest {
  id: string;
  customerLabel: string;
  body: string;
  receivedAt: string;
}

export interface RequestExtraction {
  requestId: string;
  product: Evidence<string>;
  quantity: Evidence<number>;
  variant: Evidence<string>;
  unitBudgetCents: Evidence<number>;
  /** Only an explicit YYYY-MM-DD source date is accepted in this MVP. */
  deadline: Evidence<string>;
}

export interface ValidationResult<T> {
  valid: boolean;
  value: T | null;
  issues: Issue[];
}

export interface BatchPolicy {
  productId: 'riso-notebook';
  currency: 'USD';
  unitPriceCents: 2400;
  minimumUnits: 12;
  capacityUnits: number;
  reservationWindowHours: 48;
  variant: 'cobalt' | 'vermilion';
  /** Merchant-approved dispatch date, not an AI-generated delivery promise. */
  shipBy: string;
}

export interface AnalyzedRequest {
  source: SourceRequest;
  extraction: RequestExtraction;
  status: 'eligible' | 'needs_review' | 'conflict';
  issues: Issue[];
}

export interface BatchSummary {
  kind: 'uncommitted_demand';
  eligibleUnits: number;
  eligibleRequestCount: number;
  totalCents: number;
  remainingUnits: number;
  minimumReached: boolean;
  exceedsCapacity: boolean;
  reviewCount: number;
  conflictCount: number;
}

export interface FrozenBatch {
  id: string;
  version: number;
  title: string;
  status: 'frozen';
  policy: Readonly<BatchPolicy>;
  makerApprovedAt: string;
  createdAt: string;
  closesAt: string;
  sourceRequestIds: readonly string[];
  /** Interest only. A separate provider-confirmed reservation ledger settles payments. */
  demand: Readonly<BatchSummary>;
}

export interface FreezeBatchInput {
  id: string;
  version: number;
  title: string;
  policy: BatchPolicy;
  requests: AnalyzedRequest[];
  makerApprovedAt: string;
  now: string;
}

export const PRODUCT = Object.freeze({
  id: 'riso-notebook' as const,
  name: 'Riso notebook',
  currency: 'USD' as const,
  unitPriceCents: 2400 as const,
  minimumUnits: 12 as const,
  reservationWindowHours: 48 as const,
  variants: Object.freeze(['cobalt', 'vermilion'] as const),
});

export const MAX_REQUESTS = 24;
export const MAX_REQUEST_CHARS = 4000;
export const MAX_TOTAL_REQUEST_CHARS = 32000;

export class DomainValidationError extends Error {
  issues: Issue[];
  constructor(issues: Issue[]) {
    super(issues.map((issue) => issue.message).join(' '));
    this.name = 'DomainValidationError';
    this.issues = issues;
  }
}

const fields = ['product', 'quantity', 'variant', 'unitBudgetCents', 'deadline'] as const;
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const wordNumbers: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20,
};

function issue(code: string, field: string, message: string, severity: IssueSeverity = 'review', requestId?: string): Issue {
  return { code, field, message, severity, ...(requestId ? { requestId } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value.slice(0, 10);
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

export function validateSourceRequest(input: unknown): ValidationResult<SourceRequest> {
  const issues: Issue[] = [];
  if (!isRecord(input)) return { valid: false, value: null, issues: [issue('INVALID_REQUEST', 'request', 'Request must be an object.')] };
  if (typeof input.id !== 'string' || !idPattern.test(input.id)) issues.push(issue('INVALID_ID', 'id', 'Use a short, unique request ID.'));
  if (typeof input.customerLabel !== 'string' || input.customerLabel.trim().length < 1 || input.customerLabel.length > 80) issues.push(issue('INVALID_CUSTOMER_LABEL', 'customerLabel', 'Customer label must contain 1–80 characters.'));
  if (typeof input.body !== 'string' || input.body.trim().length < 1 || input.body.length > MAX_REQUEST_CHARS) issues.push(issue('INVALID_BODY', 'body', `Request must contain 1–${MAX_REQUEST_CHARS} characters.`));
  if (!validTimestamp(input.receivedAt)) issues.push(issue('INVALID_RECEIVED_AT', 'receivedAt', 'Request timestamp must be a valid UTC ISO timestamp.'));
  if (issues.length) return { valid: false, value: null, issues };
  return { valid: true, value: { id: input.id as string, customerLabel: input.customerLabel as string, body: input.body as string, receivedAt: input.receivedAt as string }, issues };
}

export function validateRequestList(inputs: unknown): ValidationResult<SourceRequest[]> {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > MAX_REQUESTS) {
    return { valid: false, value: null, issues: [issue('INVALID_REQUEST_COUNT', 'requests', `Analyze between 1 and ${MAX_REQUESTS} requests at a time.`)] };
  }
  const requests: SourceRequest[] = [];
  const issues: Issue[] = [];
  const ids = new Set<string>();
  for (const input of inputs) {
    const result = validateSourceRequest(input);
    issues.push(...result.issues);
    if (result.value) {
      if (ids.has(result.value.id)) issues.push(issue('DUPLICATE_REQUEST_ID', 'id', 'Each request must have a unique ID.', 'review', result.value.id));
      ids.add(result.value.id);
      requests.push(result.value);
    }
  }
  if (requests.reduce((total, request) => total + request.body.length, 0) > MAX_TOTAL_REQUEST_CHARS) issues.push(issue('INPUT_TOO_LARGE', 'requests', 'The combined request text is too long. Split it into smaller groups.'));
  return { valid: issues.length === 0, value: issues.length ? null : requests, issues };
}

/** A quantity quote needs a count expression, not an incidental date or price. */
function quantityHasEvidence(value: number, quote: string): boolean {
  const token = '(\\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)';
  const patterns = [
    new RegExp(`(?<![\\d.,-])\\b${token}\\s+(?:(?:cobalt|vermilion|riso|blue|red)\\s+)*(?:notebooks?|copies|units?|pieces?)\\b`, 'gi'),
    new RegExp(`\\b(?:qty|quantity)\\s*[:=]?\\s*${token}\\b`, 'gi'),
  ];
  return patterns.some((pattern) => [...quote.matchAll(pattern)].some((match) => (wordNumbers[match[1].toLowerCase()] ?? Number(match[1])) === value));
}

function budgetHasEvidence(value: number, quote: string): boolean {
  const monetaryPattern = /(?:\$|USD\s*)(\d{1,5}(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:each|apiece|per\s+(?:notebook|item|unit|copy))\b/gi;
  return [...quote.matchAll(monetaryPattern)].some((match) => {
    const parts = match[1].replaceAll(',', '').split('.');
    return Number(parts[0]) * 100 + Number((parts[1] ?? '').padEnd(2, '0')) === value;
  });
}

function stringHasEvidence(value: string, quote: string): boolean {
  const normalized = value.toLowerCase().trim();
  if (!normalized) return false;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}(?:s)?\\b`, 'i').test(quote);
}

export function emptyExtraction(requestId: string): RequestExtraction {
  return {
    requestId,
    product: { value: null, quote: null },
    quantity: { value: null, quote: null },
    variant: { value: null, quote: null },
    unitBudgetCents: { value: null, quote: null },
    deadline: { value: null, quote: null },
  };
}

/** Reject unsupported model claims. This never edits the merchant's price or policy. */
export function validateExtraction(source: SourceRequest, input: unknown): ValidationResult<RequestExtraction> {
  const sourceResult = validateSourceRequest(source);
  if (!sourceResult.valid) return { valid: false, value: null, issues: sourceResult.issues };
  if (!isRecord(input)) return { valid: false, value: null, issues: [issue('INVALID_EXTRACTION', 'extraction', 'The analyzer returned an invalid record.', 'review', source.id)] };
  const issues: Issue[] = [];
  const allowedKeys = new Set<string>(['requestId', ...fields]);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) issues.push(issue('UNEXPECTED_FIELD', 'extraction', 'The analyzer returned an unsupported field.', 'review', source.id));
  if (input.requestId !== source.id) issues.push(issue('REQUEST_ID_MISMATCH', 'requestId', 'The analysis does not belong to this request.', 'review', source.id));
  const extraction = emptyExtraction(source.id);
  for (const field of fields) {
    const evidence = input[field];
    if (!isRecord(evidence) || Object.keys(evidence).some((key) => key !== 'value' && key !== 'quote') || !('value' in evidence) || !('quote' in evidence)) {
      issues.push(issue('INVALID_EVIDENCE', field, `The ${field} evidence has an invalid shape.`, 'review', source.id));
      continue;
    }
    if (evidence.value === null && evidence.quote === null) continue;
    if (evidence.value === null || typeof evidence.quote !== 'string' || !evidence.quote.trim() || evidence.quote.length > 500 || !source.body.includes(evidence.quote)) {
      issues.push(issue('UNGROUNDED_EVIDENCE', field, `The ${field} claim needs an exact, nonempty quotation from this request.`, 'review', source.id));
      continue;
    }
    let supported = false;
    if (field === 'quantity') {
      supported = Number.isSafeInteger(evidence.value) && (evidence.value as number) > 0 && (evidence.value as number) <= 999 && quantityHasEvidence(evidence.value as number, evidence.quote);
    } else if (field === 'unitBudgetCents') {
      supported = Number.isSafeInteger(evidence.value) && (evidence.value as number) >= 0 && (evidence.value as number) <= 10_000_000 && budgetHasEvidence(evidence.value as number, evidence.quote);
    } else if (field === 'deadline') {
      supported = isIsoDate(evidence.value) && evidence.quote.includes(evidence.value);
    } else {
      supported = typeof evidence.value === 'string' && evidence.value.length <= 80 && stringHasEvidence(evidence.value, evidence.quote);
    }
    if (!supported) {
      issues.push(issue('UNSUPPORTED_VALUE', field, `The ${field} value is not supported by its quoted text. Review it before use.`, 'review', source.id));
      continue;
    }
    if (field === 'quantity' || field === 'unitBudgetCents') extraction[field] = { value: evidence.value as number, quote: evidence.quote };
    else extraction[field] = { value: (evidence.value as string).toLowerCase().trim(), quote: evidence.quote };
  }
  return { valid: issues.length === 0, value: issues.length ? null : extraction, issues };
}

export function createBatchPolicy(shipBy: string, variant: 'cobalt' | 'vermilion' = 'cobalt'): BatchPolicy {
  const policy: BatchPolicy = { productId: 'riso-notebook', currency: 'USD', unitPriceCents: 2400, minimumUnits: 12, capacityUnits: 48, reservationWindowHours: 48, variant, shipBy };
  const result = validateBatchPolicy(policy);
  if (!result.valid) throw new DomainValidationError(result.issues);
  return policy;
}

export function validateBatchPolicy(input: unknown): ValidationResult<BatchPolicy> {
  if (!isRecord(input)) return { valid: false, value: null, issues: [issue('INVALID_POLICY', 'policy', 'Batch policy is missing.')] };
  const issues: Issue[] = [];
  const fixed: [string, unknown][] = [['productId', PRODUCT.id], ['currency', 'USD'], ['unitPriceCents', 2400], ['minimumUnits', 12], ['reservationWindowHours', 48]];
  for (const [field, value] of fixed) if (input[field] !== value) issues.push(issue('POLICY_MISMATCH', field, `This collection requires ${field} to remain ${String(value)}.`, 'conflict'));
  if (!Number.isSafeInteger(input.capacityUnits) || (input.capacityUnits as number) < 12 || (input.capacityUnits as number) > 48) issues.push(issue('INVALID_CAPACITY', 'capacityUnits', 'Capacity must be a whole number between 12 and 48.', 'conflict'));
  if (input.variant !== 'cobalt' && input.variant !== 'vermilion') issues.push(issue('INVALID_VARIANT', 'variant', 'Select cobalt or vermilion.', 'conflict'));
  if (!isIsoDate(input.shipBy)) issues.push(issue('INVALID_SHIP_DATE', 'shipBy', 'Set a valid dispatch date in YYYY-MM-DD format.', 'conflict'));
  if (issues.length) return { valid: false, value: null, issues };
  return {
    valid: true,
    value: { productId: 'riso-notebook', currency: 'USD', unitPriceCents: 2400, minimumUnits: 12, capacityUnits: input.capacityUnits as number, reservationWindowHours: 48, variant: input.variant as BatchPolicy['variant'], shipBy: input.shipBy as string },
    issues,
  };
}

export function assessRequest(source: SourceRequest, extraction: RequestExtraction, policy: BatchPolicy): AnalyzedRequest {
  const policyResult = validateBatchPolicy(policy);
  if (!policyResult.valid) throw new DomainValidationError(policyResult.issues);
  const validation = validateExtraction(source, extraction);
  if (!validation.valid || !validation.value) return { source: { ...source }, extraction: emptyExtraction(source.id), status: 'needs_review', issues: validation.issues };
  const value = validation.value;
  const issues: Issue[] = [];
  for (const field of ['product', 'quantity', 'variant'] as const) {
    if (value[field].value === null) issues.push(issue('MISSING_REQUIRED_VALUE', field, `Confirm the ${field} before counting this request.`, 'review', source.id));
  }
  if (value.product.value !== null && value.product.value !== 'notebook') issues.push(issue('PRODUCT_CONFLICT', 'product', 'This request is for a different product.', 'conflict', source.id));
  if (value.variant.value !== null && value.variant.value !== policy.variant) issues.push(issue('VARIANT_CONFLICT', 'variant', `This request does not match the ${policy.variant} collection.`, 'conflict', source.id));
  if (value.quantity.value !== null && value.quantity.value > policy.capacityUnits) issues.push(issue('CAPACITY_CONFLICT', 'quantity', 'This request alone exceeds the production capacity.', 'conflict', source.id));
  if (value.unitBudgetCents.value === null) issues.push(issue('UNKNOWN_BUDGET', 'unitBudgetCents', 'No explicit per-unit budget. The buyer must still approve the $24 price at checkout.', 'info', source.id));
  else if (value.unitBudgetCents.value < policy.unitPriceCents) issues.push(issue('BUDGET_CONFLICT', 'unitBudgetCents', 'The stated per-unit budget is below $24.', 'conflict', source.id));
  if (value.deadline.value === null) issues.push(issue('UNKNOWN_DEADLINE', 'deadline', 'No explicit ISO date. Confirm timing with the buyer before production.', 'info', source.id));
  else if (value.deadline.value < policy.shipBy) issues.push(issue('DEADLINE_CONFLICT', 'deadline', 'The requested deadline is before the planned dispatch date.', 'conflict', source.id));
  const status = issues.some((item) => item.severity === 'conflict') ? 'conflict' : issues.some((item) => item.severity === 'review') ? 'needs_review' : 'eligible';
  return { source: { ...source }, extraction: value, status, issues };
}

/** Reassess raw evidence; callers cannot force eligibility by editing a status flag. */
export function summarizeRequests(requests: AnalyzedRequest[], policy: BatchPolicy): BatchSummary {
  const checkedPolicy = validateBatchPolicy(policy);
  if (!checkedPolicy.valid) throw new DomainValidationError(checkedPolicy.issues);
  if (!Array.isArray(requests) || requests.length > MAX_REQUESTS) throw new DomainValidationError([issue('INVALID_REQUEST_COUNT', 'requests', 'The batch contains too many requests.')]);
  const ids = new Set<string>();
  const checked: AnalyzedRequest[] = [];
  for (const request of requests) {
    const sourceResult = validateSourceRequest(request?.source);
    if (!sourceResult.valid) throw new DomainValidationError(sourceResult.issues);
    if (ids.has(request.source.id)) throw new DomainValidationError([issue('DUPLICATE_REQUEST_ID', 'requests', 'A source request cannot count twice.', 'conflict', request.source.id)]);
    ids.add(request.source.id);
    checked.push(assessRequest(request.source, request.extraction, policy));
  }
  const eligible = checked.filter((request) => request.status === 'eligible');
  const units = eligible.reduce((sum, request) => sum + (request.extraction.quantity.value ?? 0), 0);
  return {
    kind: 'uncommitted_demand',
    eligibleUnits: units,
    eligibleRequestCount: eligible.length,
    totalCents: units * policy.unitPriceCents,
    remainingUnits: Math.max(0, policy.minimumUnits - units),
    minimumReached: units >= policy.minimumUnits,
    exceedsCapacity: units > policy.capacityUnits,
    reviewCount: checked.filter((request) => request.status === 'needs_review').length,
    conflictCount: checked.filter((request) => request.status === 'conflict').length,
  };
}

/** Freeze only after authenticated maker approval in the calling server route. */
export function freezeBatch(input: FreezeBatchInput): FrozenBatch {
  const issues: Issue[] = [];
  const policyResult = validateBatchPolicy(input.policy);
  issues.push(...policyResult.issues);
  if (typeof input.id !== 'string' || !idPattern.test(input.id)) issues.push(issue('INVALID_BATCH_ID', 'id', 'Batch ID is invalid.'));
  if (!Number.isSafeInteger(input.version) || input.version < 1) issues.push(issue('INVALID_VERSION', 'version', 'Version must be a positive integer.'));
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 100) issues.push(issue('INVALID_TITLE', 'title', 'Batch title must contain 1–100 characters.'));
  if (!validTimestamp(input.now)) issues.push(issue('INVALID_NOW', 'now', 'Freeze time must be a valid UTC timestamp.'));
  if (!validTimestamp(input.makerApprovedAt)) issues.push(issue('MAKER_APPROVAL_REQUIRED', 'makerApprovedAt', 'A current maker approval is required.'));
  if (issues.length || !policyResult.value) throw new DomainValidationError(issues);
  const policy = policyResult.value;
  const now = Date.parse(input.now);
  const approved = Date.parse(input.makerApprovedAt);
  if (approved > now || now - approved > 15 * 60 * 1000) issues.push(issue('STALE_MAKER_APPROVAL', 'makerApprovedAt', 'Review and approve this batch again before freezing.'));
  const closesAt = new Date(now + 48 * 60 * 60 * 1000).toISOString();
  if (Date.parse(`${policy.shipBy}T23:59:59.999Z`) <= Date.parse(closesAt)) issues.push(issue('SHIP_DATE_TOO_EARLY', 'shipBy', 'Dispatch must be scheduled after the reservation window closes.'));
  const demand = summarizeRequests(input.requests, policy);
  if (!demand.eligibleRequestCount) issues.push(issue('NO_ELIGIBLE_DEMAND', 'requests', 'Resolve at least one request before publishing a batch.'));
  if (demand.exceedsCapacity) issues.push(issue('BATCH_OVER_CAPACITY', 'requests', 'Selected request quantities exceed production capacity.', 'conflict'));
  if (issues.length) throw new DomainValidationError(issues);
  const eligibleIds = input.requests.filter((request) => assessRequest(request.source, request.extraction, policy).status === 'eligible').map((request) => request.source.id);
  return Object.freeze({
    id: input.id,
    version: input.version,
    title: input.title.trim(),
    status: 'frozen' as const,
    policy: Object.freeze({ ...policy }),
    makerApprovedAt: new Date(approved).toISOString(),
    createdAt: new Date(now).toISOString(),
    closesAt,
    sourceRequestIds: Object.freeze(eligibleIds),
    demand: Object.freeze(demand),
  });
}

export function formatUsd(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new DomainValidationError([issue('INVALID_MONEY', 'amount', 'Amount must be nonnegative integer cents.')]);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}
