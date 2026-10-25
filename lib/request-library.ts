/** Authored fictional scenarios. Never presented as model output or paid orders. */
import { assessRequest, createBatchPolicy, emptyExtraction, summarizeRequests, validateRequestList, isIsoDate } from './batch-domain.ts';
import type { Evidence, RequestExtraction, SourceRequest } from './batch-domain.ts';
import { createDemoScenario } from './demo-data.ts';
import type { DemoScenario } from './demo-data.ts';

export const REQUEST_LIBRARY = [
  { id: 'circle', number: '01', title: 'The writing circle', collection: 'Cobalt Field Notes', variant: 'cobalt', image: '/images/case-circle.png', imageAlt: 'Generated illustration of notebooks at a quiet writing-circle table', context: 'Community orders', description: 'Gather a few individual requests into one thoughtful edition.', challenge: 'Mixed budgets · unclear quantities · timing conflicts', outcome: 'Decide which requests belong in the same run.', tone: 'cobalt' },
  { id: 'workshop', number: '02', title: 'The print workshop', collection: 'Vermilion Workshop Notes', variant: 'vermilion', image: '/images/case-workshop.png', imageAlt: 'Generated illustration of vermilion notebooks beside printmaking tools', context: 'Event stationery', description: 'Prepare a shared notebook run for a hands-on creative workshop.', challenge: 'A fixed event date · another colour · missing budgets', outcome: 'Separate viable workshop demand from requests to clarify.', tone: 'vermilion' },
  { id: 'restock', number: '03', title: 'The bookshop restock', collection: 'Cobalt Bookshop Edition', variant: 'cobalt', image: '/images/case-restock.png', imageAlt: 'Generated illustration of notebook bundles prepared for a fictional bookshop', context: 'Small retail orders', description: 'Bring independent shops together without guessing their commitments.', challenge: 'Larger quantities · total vs unit budget · capacity', outcome: 'Review retail interest without treating it as payment consent.', tone: 'forest' },
] as const;
export type LibraryId = typeof REQUEST_LIBRARY[number]['id'];
export const libraryEntry = (id: string) => REQUEST_LIBRARY.find(entry => entry.id === id) ?? REQUEST_LIBRARY[0];

type AuthoredRequest = { name: string; body: string; product?: string; quantity?: number; quantityQuote?: string; variant?: string; budget?: number; budgetQuote?: string; date?: string };
const ev = <T>(value: T | null, quote: string | null): Evidence<T> => ({ value, quote });

export function createLibraryScenario(id: LibraryId, now: Date | string = new Date()): DemoScenario {
  const original = createDemoScenario(now);
  if (id === 'circle') return original;
  const date = (days: number) => new Date(Date.parse(original.referenceDate + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  const v = id === 'workshop' ? 'vermilion' : 'cobalt';
  const policy = createBatchPolicy(date(10), v);
  const rows: AuthoredRequest[] = id === 'workshop' ? [
    { name: 'Mira / workshop host', body: `Please reserve 6 vermilion notebooks for our print workshop. Our budget is $28 each. Dispatch by ${date(15)}.`, quantity: 6, budget: 2800, budgetQuote: '$28 each', date: date(15) },
    { name: 'Rowan / tutor', body: `I need 4 vermilion notebooks for teaching notes. I can pay $24 per notebook. Please dispatch by ${date(12)}.`, quantity: 4, budget: 2400, budgetQuote: '$24 per notebook', date: date(12) },
    { name: 'Aster / community team', body: `We want 3 vermilion notebooks for the volunteers. Up to $30 each is fine. Dispatch by ${date(16)}.`, quantity: 3, budget: 3000, budgetQuote: '$30 each', date: date(16) },
    { name: 'Leonie / visiting artist', body: `Could I order 2 cobalt notebooks for my sketches? My budget is $26 each. Dispatch by ${date(14)}.`, quantity: 2, variant: 'cobalt', budget: 2600, budgetQuote: '$26 each', date: date(14) },
    { name: 'Nico / weekend class', body: `Please make 5 vermilion notebooks. Our limit is $20 per notebook. Dispatch by ${date(14)}.`, quantity: 5, budget: 2000, budgetQuote: '$20 per notebook', date: date(14) },
    { name: 'Fern / exhibition desk', body: `We need 2 vermilion notebooks at $25 each, dispatched by ${date(4)} for opening night.`, quantity: 2, budget: 2500, budgetQuote: '$25 each', date: date(4) },
    { name: 'Ivo / workshop assistant', body: 'Could you reserve some vermilion notebooks? The attendee list is still changing. Our budget is $24 each.', budget: 2400, budgetQuote: '$24 each' },
    { name: 'Sana / participant', body: `I would like some vermilion notebooks by ${date(17)}. I still need to confirm the quantity and stationery budget.`, date: date(17) },
  ] : [
    { name: 'Paper & Pine / bookshop', body: `Please reserve 8 cobalt notebooks for our stationery shelf. We can pay $27 per notebook. Dispatch by ${date(18)}.`, quantity: 8, budget: 2700, budgetQuote: '$27 per notebook', date: date(18) },
    { name: 'Little Atlas / bookshop', body: `We would like 6 cobalt notebooks for the front counter. Budget is $24 each. Dispatch by ${date(16)}.`, quantity: 6, budget: 2400, budgetQuote: '$24 each', date: date(16) },
    { name: 'Chapter House / reading room', body: `Could we order 4 cobalt notebooks? Our unit budget is $29 each. Dispatch by ${date(20)}.`, quantity: 4, budget: 2900, budgetQuote: '$29 each', date: date(20) },
    { name: 'Margin / design shop', body: `We need 5 vermilion notebooks for a red display. Up to $28 each is fine. Dispatch by ${date(18)}.`, quantity: 5, variant: 'vermilion', budget: 2800, budgetQuote: '$28 each', date: date(18) },
    { name: 'North Window / kiosk', body: `We want 6 cobalt notebooks. The retail buying budget is $19 each. Dispatch by ${date(16)}.`, quantity: 6, budget: 1900, budgetQuote: '$19 each', date: date(16) },
    { name: 'Sunday Pages / pop-up', body: `Please reserve 3 cobalt notebooks at $24 each, dispatched by ${date(3)} for this weekend.`, quantity: 3, budget: 2400, budgetQuote: '$24 each', date: date(3) },
    { name: 'Open Book / gifts counter', body: `We would like some cobalt notebooks. We have $100 total for stationery, including packaging, and the quantity is undecided. Dispatch by ${date(17)}.`, date: date(17) },
    { name: 'Second Story / shop manager', body: 'I am interested in some cobalt notebooks for our new shelf. Please send the details; the quantity and budget are undecided.' },
  ];
  const requests: SourceRequest[] = rows.map((row, i) => ({ id: `${id}-${i + 1}`, customerLabel: `${row.name} · fictional`, body: row.body, receivedAt: `${original.referenceDate}T${String(8 + i).padStart(2, '0')}:15:00.000Z` }));
  const analysis = rows.map((row, i) => {
    const e: RequestExtraction = emptyExtraction(requests[i].id);
    e.product = ev('notebook', 'notebooks');
    e.quantity = row.quantity ? ev(row.quantity, row.quantityQuote ?? `${row.quantity} ${row.variant ?? v} notebooks`) : ev<number>(null, null);
    e.variant = ev(row.variant ?? v, row.variant ?? v);
    e.unitBudgetCents = row.budget ? ev(row.budget, row.budgetQuote!) : ev<number>(null, null);
    e.deadline = row.date ? ev(row.date, row.date) : ev<string>(null, null);
    return assessRequest(requests[i], e, policy);
  });
  return { requests, policy, analysis, summary: summarizeRequests(analysis, policy), referenceDate: original.referenceDate, label: `Authored ${id} scenario · illustrative analysis, not a live AI run` };
}

export const DRAFT_KEY = 'batchloom-private-drafts-v1';
export type PrivateDraft = { id: LibraryId; requests: SourceRequest[]; shipBy: string; savedAt: string };
/** Only raw draft input is restored; never trust stored AI or payment results. */
export function readPrivateDraft(value: unknown): PrivateDraft | null {
  if (!value || typeof value !== 'object') return null;
  const draft = value as Record<string, unknown>;
  if (!REQUEST_LIBRARY.some(entry => entry.id === draft.id) || !isIsoDate(draft.shipBy) || typeof draft.savedAt !== 'string' || !Number.isFinite(Date.parse(draft.savedAt))) return null;
  if (Array.isArray(draft.requests) && draft.requests.length === 0) return { id: draft.id as LibraryId, requests: [], shipBy: draft.shipBy, savedAt: draft.savedAt };
  const checked = validateRequestList(draft.requests);
  return checked.valid && checked.value ? { id: draft.id as LibraryId, requests: checked.value, shipBy: draft.shipBy, savedAt: draft.savedAt } : null;
}
