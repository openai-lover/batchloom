# PayPal sandbox integration

Batchloom uses a 48-hour order window for a single maker's production batch. Buyers authorize a fixed amount; the maker settles a qualifying batch. If the batch fails, uncaptured authorizations are voided. If settlement partially succeeds, completed captures receive compensating full refunds. This is a sandbox demonstration of a recoverable workflow, **not escrow, an atomic group payment, or a production guarantee**.

## What is implemented

`lib/paypal.ts` is a server-only REST adapter. Its API origin is hardcoded to `https://api-m.sandbox.paypal.com`; it cannot be configured to use live PayPal. OAuth credentials and merchant access tokens never belong in browser code or public source. Responses are reduced to typed resources and errors do not include provider bodies or credentials.

Requests use `redirect: "manual"` and reject every 3xx response, so credentials never follow a redirect. Workers does not support `redirect: "error"`; that option fails before the network request. `cache: "no-store"` also prevents framework caching from replacing a fresh provider-state read.

Supported operations: create an `AUTHORIZE` order, authorize an approved order, fetch order/authorization/capture/refund, capture authorization, void authorization, full refund, and webhook signature postback verification. Financial mutations carry a stable operation request ID wherever the endpoint supports it. Network timeouts and server errors are reported as uncertain outcomes; the application must reconcile rather than assume a failure.

`verifyOrder` requires the expected `AUTHORIZE` intent, one purchase unit, exact integer-cent USD amount, pledge reference/invoice ID, batch revision correlation, and merchant ID. The settlement engine repeats those checks before acting on a pledge. Default physical-goods checkout asks PayPal for the buyer's shipping address; explicitly use `NO_SHIPPING` only for a pickup/no-shipping flow.

## Configuration

Provide a PayPal sandbox REST client ID, client secret, and the sandbox business merchant ID to `createPayPalClient`. A distinct sandbox personal buyer is needed for actual approval. Obtain keys through the user's authorized PayPal developer dashboard and store them as runtime secrets; do not paste keys into source or include them in screenshots. Configure a public HTTPS webhook URL and retain its webhook ID if using webhooks.

The current application creates the order on the server and redirects the buyer to the validated Sandbox approval URL. Its return flow calls the application's server-side **authorize** endpoint; it does not capture on approval. The returned authorization ID is the later capture target. The application does not embed a PayPal browser SDK or payment iframe.

## Local analysis and data boundary

The public HTTP API no longer imports the server AI adapter or reads AI-provider credentials. `/api/analyze` and `/api/analyze-local` return `410` before consuming their request bodies. Browser and server share the pinned model identity in `lib/local-model.ts`. `/api/config` reports `aiMode: "browser-local"`; this advertises the intended analysis path, not GPU compatibility, model availability, or evidence that inference ran successfully on a visitor's device.

For a local-model proposal, `POST /api/batches` accepts only a title, fixed policy, maker approval, `provenance: "local-model"`, and `reviewedPlan` with integer `requestCount`, `eligibleUnits`, `eligibleRequestCount`, `reviewCount`, `conflictCount`, and `modelId`. Extra source records, quotations, customer labels, IDs, and nested metadata are rejected. The server independently validates price, capacity, count consistency, a 48-hour window, and dispatch timing. It stores no source request IDs for this path. The returned proposal explicitly records `analysis.attestation: "self-reported"`: the server cannot prove that a browser model executed or that aggregate interest matches private source text. These interest totals never authorize or settle payment; only provider-confirmed buyer reservations can do that.

The synthetic example path remains separately checked against the canonical current/previous UTC day fixture. Former `live` provenance is refused. The unused cloud AI adapter and its dedicated tests were removed. The historical analysis-receipt table and storage methods remain for schema compatibility but are never called by current HTTP routes; they are not proof of browser inference.

## Durable settlement contract

`runSettlement` accepts a `SettlementRepository` and `PayPalPort`. `BatchSnapshot` in `lib/settlement.ts` is the persistence schema. The repository must implement atomic lease acquisition/renewal, version compare-and-swap, and token-checked release. `save(next, expectedVersion, token, nowMs)` receives `next.version = expectedVersion + 1`; it must reject an expired/superseded lease or version mismatch. Use a durable database, not process memory in production.

Every mutation is preceded by a durable pending state with a stable request ID. A restart reads PayPal's current state and continues. A batch is committed only after all frozen participant captures are completed. Uncertain capture, pending refund, and failed compensation remain visibly unresolved. Fully captured payments cannot be voided; the engine refunds their capture IDs instead.

Checkout/authorization routes must acquire **the same batch lease** and preserve immutable pledge details while creating authorizations. They must reject late approvals after settlement seals the batch, or reconcile/void an authorization that already exists. Otherwise an authorization finishing concurrently with batch closure can become an orphaned hold. Browser ownership and maker authorization must be enforced before entering these server operations. The engine independently checks maker identity and approved revision.

Each checkout reserves capacity for 15 minutes, bounded by the batch deadline. An authorization attempt records its start and response times. Both the provider's creation timestamp and the recorded response must be inside that reservation window; a late hold is voided and cannot qualify for capture. Recovering a provider-confirmed, in-time authorization later does not itself make that authorization late. A negative order read after an interrupted authorization is not proof that no hold exists: the pledge remains uncertain, continues reserving capacity, and prevents terminal commitment until resolved. Recovery also revisits terminal snapshots containing unfinished authorization work, releases unexpected holds, and preserves captures belonging to an already committed plan.

If PayPal never supplies a positive authorization or definitive terminal result for an interrupted request, this prototype leaves it visibly unresolved. It has no automatic timeout that declares such funds safe, and no scheduled reconciliation worker. The maker must retry the reconciliation action; persistent uncertainty needs operator review rather than a fabricated paid/cancelled result.

The engine deliberately restricts collection to at most 48 hours and stops new capture outside the first 72 hours after authorization. PayPal's three-day honor period increases the likelihood of success but does not guarantee it; the larger authorization window is 29 days. This version does not extend authorizations or change prices. A server scheduler or authenticated maker action must invoke settlement and retry unresolved work. A countdown displayed in a browser does not run background settlement by itself.

## Webhooks

`verifyWebhook` calls PayPal's signature-verification endpoint using the configured webhook ID and received signature headers. It does not download arbitrary certificate URLs. The route must reject verification failure, deduplicate provider event IDs durably, and reconcile associated resources before updating payment state. PayPal's synthetic webhook simulator cannot use postback signature verification, so simulator-only results do not prove live sandbox webhook correctness.

## Verification status

The Node tests named `MOCK:` use in-memory storage and a fake provider. They validate the transport contract, sandbox restriction, exact order matching, concurrency, restart recovery, identical idempotency keys, underfilled-batch voids, partial-settlement refunds, pending compensation, tampering, and uncertain provider responses. They make **no real network calls** and are not evidence that PayPal credentials or a live sandbox demonstration worked.

Run: `node --test tests/paypal.test.ts tests/settlement.test.ts tests/http.test.ts tests/security-review.test.ts`. Security counterexamples cover authorization crossing the checkout deadline, delayed creation after a timeout, and an unresolved approval alongside another qualifying reservation. Additional regressions check capacity retention and cleanup after terminal snapshots.

Actual evidence must remain distinct from provider-double tests. PayPal notes that Sandbox authorizations do not automatically expire after 29 days; the underfilled test below used an explicit controlled clock and does not claim natural expiration.

On 2026-10-25, the actual local Vinext/Workers HTTP flow was checked with the configured sandbox account: config returned 200, creating a synthetic batch returned 201, and its checkout returned 200 with a PayPal sandbox approval URL. This confirms OAuth and server order creation through the application runtime. It does not by itself prove buyer approval, capture, void, refund, or deployment correctness; those require their separate recorded flows.

The browser end-to-end sequence then confirmed 12 authorized units/USD 288 with zero captured funds, followed by maker settlement reaching `COMMITTED` with USD 288 captured and the buyer page reflecting capture.

Separate actual-provider fixtures verified two recovery paths using the unchanged settlement engine and an isolated in-memory ledger. A one-unit underfilled batch used a clock injected after its original deadline and reached provider `VOIDED` / fixture `CANCELLED`. A two-hold batch captured USD 144 first; the harness deliberately voided the second hold after that capture was persisted; the engine observed provider `VOIDED` and automatically completed a full refund, leaving the first capture `REFUNDED` and fixture `CANCELLED`. This second test used the real clock. Both left the application database unchanged and preserved the earlier successful browser batch.

The successful refund test is an explicitly induced external authorization invalidation race, not a successful `AUTHORIZATION_EXPIRED` negative-header test. That earlier capture preflight failed with HTTP 403 on an intentionally nonexistent ID and stopped before any legitimate capture. A read-only mock probe succeeded, but capture mock injection remains unverified. Full methods, limitations and sanitized results are in [provider verification](provider-verification.md) and the [public evidence index](../artifacts/provider-verification/README.md). Public reports exclude provider resource IDs, buyer/merchant identity, owner hashes, credentials and private recovery ledgers. A hosted-origin flow remains a separate verification requirement.

## Official references checked 2026-10-25

- [Authorization and honor period](https://developer.paypal.com/payment-methods/auth-honor/)
- [Authorize and delay capture](https://developer.paypal.com/checkout/delay-capture/)
- [Create order](https://developer.paypal.com/api/orders/v2/orders-create)
- [Authorize order](https://developer.paypal.com/api/orders/v2/orders-authorize)
- [Capture authorization](https://developer.paypal.com/api/payments/v2/authorizations-capture/)
- [Void authorization](https://developer.paypal.com/api/payments/v2/authorizations-void/)
- [Refund capture](https://developer.paypal.com/api/payments/v2/captures-refund/)
- [REST request and idempotency semantics](https://developer.paypal.com/api/rest/requests/)
- [Webhook verification](https://developer.paypal.com/api/rest/webhooks/rest/)
- [JavaScript SDK v6 reference](https://developer.paypal.com/sdk/js/reference/)
- [Negative-response request headers](https://developer.paypal.com/negative-testing/request-headers)
- [Negative-testing overview](https://developer.paypal.com/negative-testing/overview)
