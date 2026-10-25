# Security and privacy review

Reviewed 2026-10-25 against the source in this checkout. This is a focused application review, not an independent penetration test, compliance certification, dependency-vulnerability audit, or guarantee about the eventual hosted deployment.

## Result and scope

The reviewed implementation is restricted to synthetic demonstrations and PayPal sandbox. Its private local-model publishing path does not store customer source text or evidence. The former cloud inference endpoint is closed. The independent payment race counterexamples pass, alongside the remaining automated tests and full TypeScript check. Automated payment tests use an in-memory fake provider and must not be presented as real PayPal execution.

Actual local application verification separately confirmed config 200, synthetic batch creation 201, and PayPal checkout 200 with a sandbox approval URL. The browser sequence then confirmed a 12-unit/USD 288 Sandbox buyer authorization with zero captured funds, maker settlement reaching `COMMITTED` with USD 288 captured, and the buyer page reflecting capture.

Two new synthetic fixtures separately confirmed actual provider void/refund. The underfilled test injected a post-deadline clock and confirmed `VOIDED`. The compensation test used the real clock: after the first USD 144 capture, the harness deliberately voided a second hold; the unchanged settlement engine observed actual `VOIDED` state and fully refunded the first capture (`REFUNDED` / refund `COMPLETED`). These tests used an isolated in-memory ledger and did not update the application database or touch the original successful batch. They are not browser end-to-end recovery or scheduler evidence. The [verification report](provider-verification.md) and [sanitized public artifacts](../artifacts/provider-verification/README.md) document the boundary.

The earlier mock-expiration capture preflight remains explicitly **not verified**: it returned 403 for an intentionally nonexistent ID and stopped before any legitimate capture. A read-only mock probe worked, but that is not proof of capture-error injection. This failure record is retained alongside the later successful external-invalidation refund test.

The public repository, final source archive and deployed HTTPS origin still require their own inspection. No claim of a verified public deployment is made by this document.

## Data boundary

| Data | Current handling |
| --- | --- |
| Customer body, label, extracted quotations | Page state and local model worker memory; not included in local-model publishing requests. Raw request bodies, labels and dispatch dates are additionally saved to tab-scoped sessionStorage. Analysis and payment approvals are never restored from drafts. |
| Draft retention | Not application-encrypted; browser session recovery may retain sessionStorage. Studio guide can clear saved draft copies. Current on-screen text remains until replaced; subsequent edits save a fresh draft. Use synthetic inputs only. |
| Model weights/tokenizer/WASM | Downloaded on explicit action from pinned public model/runtime revisions; model assets may remain in browser caches. |
| Local proposal export | A user-triggered JSON download containing source and evidence. The app does not upload it; a person can still share that file themselves. |
| Published local-model proposal | Public title, fixed product/dispatch policy, aggregate interest counts, self-reported model ID; empty source ID list. Do not put private information in the public title. |
| Illustrated example | Three canonical synthetic request sets only; server compares each set for today or the previous UTC day. Edits cannot be published as an authored result. |
| D1 payment state | Batch/pledge IDs, quantities, fixed amounts, provider resource IDs and statuses, idempotency IDs, lease/version state, hashed browser ownership IDs. No full PayPal payer profile or provider response body is persisted by these routes. |
| Browser access | A random 256-bit HttpOnly, host-only, SameSite=Lax cookie; Secure and `__Host-` prefix on HTTPS. D1 stores a hash, not the raw cookie. Cookie expiry is seven days and is renewed on requests. |
| Checkout retry identity | Random nonce in sessionStorage, scoped by batch; it is not a PayPal credential. |
| Rate limiting | Hashed session and IP-derived keys plus selected global quotas. IP hashes are pseudonymous, not guaranteed anonymous. |
| External metadata | Hosting, model/CDN and PayPal can see ordinary network metadata. PayPal manages its own buyer login and sandbox checkout data. |

There is no signup, cookie revocation dashboard, account recovery, ownership transfer, automatic data-retention cleanup, or scheduled settlement worker. Clearing cookies loses maker/buyer controls; it does not delete server records. Use synthetic inputs in the public demonstration.

`/api/analyze` and `/api/analyze-local` return 410 before body consumption. `local-model` publishing accepts only explicitly named summary fields and approved terms; raw request arrays, quotations, names, source IDs and extra nested fields are rejected before storage. The server checks aggregate consistency and monetary policy, but **does not attest to browser execution or private source evidence**. A malicious client can invent interest counts; that cannot produce a buyer authorization or qualify a payment without provider-confirmed reservations.

## Controls verified in source and tests

- Mutation requests require same-origin `Origin`, JSON content type, and reject cross-site fetch metadata. Request bodies are bounded to 128 KiB. No permissive CORS response is added.
- Publication is limited to 40 requests per shared 24-hour window, plus 8/session/hour and 20/IP/hour. Checkout and authorization share a global 200 requests/24-hour cap, plus 30/session/hour and 80/IP/hour. Fresh visitor sessions cannot evade the global keys. There is no lifetime batch-count cap or automatic expiry cleanup, and reads have session/IP limits but no global read cap; these controls do not replace hosting-level abuse/cost controls.
- Maker list/settlement and buyer authorization are bound to the browser session. Public batch responses omit owner/session/merchant identifiers, private source evidence and other browsers' reservations.
- SQL uses bound parameters. UI source/evidence renders as React text; current product paths do not inject source HTML. Client errors do not expose provider response bodies or credential values.
- PayPal REST origin is hardcoded to the sandbox. Approval links accept only the exact sandbox host, without credentials or alternate port. REST redirects are manual and every 3xx is rejected before any follow-up; provider reads bypass caches.
- Each order is checked against fixed amount, currency, merchant, intent, pledge and revision. Model output cannot change price or invoke payment operations.
- Checkout, authorization and settlement use the same durable batch lease and version comparison. Pending mutations and stable operation IDs are saved before provider calls.
- Provider creation time and authorization request/response timing enforce the reservation window. Late holds are voided. An interrupted authorization remains uncertain after a negative GET and continues occupying capacity after checkout expiry.
- A frozen settlement plan cannot commit past unresolved off-plan authorization work. Compensation refunds completed captures and voids remaining holds. Terminal recovery can release an unexpected hold while preserving the already committed plan.
- Unknown provider results remain visible. There is no timeout rule that silently declares an uncertain payment paid or cancelled. The maker/operator must reconcile persistent uncertainty.

The independent `tests/security-review.test.ts` was retained unchanged. Additional regressions cover off-plan uncertainty, terminal cleanup and capacity retention. Test commands are in the README.

## Source publication audit

A filename/pattern scan of candidate source and public assets found no private-key blocks, recognized GitHub/OpenAI access-token patterns, literal 64-character session cookies, or long literal credential assignments. It emitted only filenames/categories, never matched values. `.dev.vars` was identified by filename and excluded without reading it. This is a limited pattern scan, not proof that every possible credential or personal datum is absent.

An exact-value comparison against runtime secrets was **not performed**: automatic approval review rejected reading the credential file for that purpose. The audit continued with filename and known-pattern checks. Keep this limitation with the report; do not describe it as a full secret-value comparison.

The source archive must exclude `.env*`, `.dev.vars*`, private-key files, `.sites-runtime/`, `.wrangler/`, `.vinext/`, `.git/`, dependency/build caches and private exports. The ignore file covers local environment/key/runtime paths, but an archive tool can ignore those rules. Inspect the final upload file list and scan the final artifact separately. Screenshots and recordings also need review for account names, cookie values, login credentials and private browser tabs.

Public provider evidence is constructed from an explicit selection of scenario flags, fixed synthetic amounts, timestamps, allowlisted operation/status labels and stated limitations. It excludes credential values, buyer profiles, merchant/payment/batch identifiers, owner hashes and recovery snapshots. The operator harness and its detailed checkpoints stay in ignored `.sites-runtime/`; they are not public endpoints or deployment code. Reading approved runtime credentials for the Sandbox tests is distinct from the rejected exact-value source-scan request above.

The unused cloud AI adapter (`lib/ai-planner.ts`) and its 15 dedicated tests (`tests/ai.test.ts`) were removed on this date to eliminate a misleading paid/server inference option. Independent security/local-model tests were preserved. The historical `analysis_receipts` migration/table and unused storage methods remain for schema compatibility; no current route reads or writes analysis receipts. Stale documentation claiming that local-model publishing sends source/evidence was corrected.

## Network destinations and response headers

An actual owner-private Sites v1 HTTP probe at **2026-10-25 05:51:02 UTC** found the following. This is partial deployed-origin evidence, not a public-release security sign-off.

| Tested path | HTTP status | X-Content-Type-Options | Referrer-Policy | Permissions-Policy |
| --- | --- | --- | --- | --- |
| `/` | 200 | Absent | Absent | Absent |
| `/api/config` | 200 | `nosniff` | `same-origin` | `camera=(), microphone=(), geolocation=()` |
| `/local-ai/worker.js` | 200 | Absent | Absent | Absent |
| `/images/notebook-cobalt.png` | 200 | Absent | Absent | Absent |

Among those tested paths, only the API response carried the three headers. **Global header coverage is not verified and was absent on the tested HTML and static responses.** `next.config.ts` contains the intended global `headers()` rule, but its presence in source did not establish its effect on this deployed build. The config response also reported browser-local Qwen3 1.7B mode and configured PayPal/storage; those booleans do not prove hosted inference or a hosted payment transaction. The probe did not assess HSTS or every route.

The build uses `@cloudflare/vite-plugin` with `assets.directory: "../client"`. Cloudflare officially supports `public/_headers` for static assets through its Vite build/preview/deploy path, while warning that those rules do not apply to Worker-generated SSR responses. This is a possible static-asset correction, not evidence of Sites-specific forwarding: neither the reviewed Sites skill, its vendored `sites()` packaging integration, nor the official Sites guidance established that the Sites publishing pipeline preserves this custom asset metadata. No speculative `_headers` file or routing override was introduced. Static responses bypassing the framework could explain their missing headers; the exact cause of the HTML result remains unconfirmed. [Cloudflare Vite static assets](https://developers.cloudflare.com/workers/vite-plugin/reference/static-assets/), [Cloudflare custom-header scope](https://developers.cloudflare.com/workers/static-assets/headers/), [Vinext configuration support](https://github.com/cloudflare/vinext)

| Purpose | Approved/observed destination |
| --- | --- |
| App APIs, scripts, static model worker, images | Same deployed origin |
| Pinned model metadata/tokenizer/shards | `https://huggingface.co` |
| Pinned 1.7B first-shard redirect, HEAD verified | `https://us.aws.cdn.hf.co` (200 after Hugging Face 302) |
| Pinned compiled WebGPU runtime | `https://raw.githubusercontent.com` (HEAD 200) |
| PayPal REST and webhook-signature postback adapter | Server only: `https://api-m.sandbox.paypal.com` |
| Buyer approval page | Top-level browser navigation: `https://www.sandbox.paypal.com` |

The initial model-host probes used public manifests/HEAD responses, no credentials and no weight download. Other shard/CDN redirects must be checked during the deployed model load. Add only an observed official destination if upstream delivery changes; do not replace this list with `*`.

The remaining header work is to confirm a supported Sites delivery path for static header rules and response decoration for server-rendered HTML, then repeat the same deployed probes. Do not infer success from a source config or a local preview alone. Keep WebGPU available. A future Worker response wrapper must preserve streams, status and multiple `Set-Cookie` headers; it does not automatically fix assets served before the Worker. HSTS requires separate verification at the actual HTTPS hosting boundary. [Cloudflare Headers API](https://developers.cloudflare.com/workers/runtime-apis/headers/)

Start CSP testing in report-only mode on the deployed origin. A candidate baseline is below; **it is a design proposal, not an implemented or validated policy**. Vinext's inline boot scripts need per-response nonces or verified hashes before enforcement. Replace `NONCE_PER_RESPONSE` with actual nonce plumbing; never use it as a literal permanent nonce.

```text
default-src 'self';
base-uri 'self'; object-src 'none'; form-action 'self';
script-src 'self' 'nonce-NONCE_PER_RESPONSE' 'wasm-unsafe-eval';
worker-src 'self';
connect-src 'self' https://huggingface.co https://us.aws.cdn.hf.co https://raw.githubusercontent.com;
img-src 'self' data: blob:; font-src 'self';
style-src 'self' 'unsafe-inline'; frame-src 'none';
```

WebAssembly needs its specific CSP permission; do not add general JavaScript `unsafe-eval` merely to suppress errors. The same-origin worker response also needs a compatible policy for its own connections and WASM. The current PayPal flow redirects rather than embedding a PayPal SDK/frame, so PayPal is not needed in browser `connect-src` or `frame-src`. If that integration changes, re-audit the exact SDK resources. [WASM and script CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src), [worker CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/worker-src)

Set `frame-ancestors` after verifying the Sites preview/embedding origins: `'self'` is suitable only when legitimate cross-origin embedding is unnecessary. Do not blindly add `X-Frame-Options: DENY`, COOP or COEP while relying on embedded previews and cross-origin model assets. Report-only violations should be inspected without sending customer text or private URLs to a third-party telemetry endpoint.

## Remaining release work and limits

1. Inspect the actual public repository/archive and retain applicable source/runtime/asset licenses.
2. Verify the deployed HTTPS headers, same-browser ownership, model worker/download and PayPal return origin. Local success does not establish these.
3. Retain the published recovery evidence and its fixture limitations; review browser recordings/screenshots before publishing them. Do not portray fixture-induced invalidation as a spontaneous provider failure or mock-expiration success. The webhook adapter is not an implemented webhook endpoint.
4. Retain actual model evaluation failures and unsupported-device behavior. A successful load or a small synthetic score is not a general reliability or multilingual claim.
5. For use beyond a synthetic hackathon demo, implement account recovery, retention/deletion, scheduler/reconciliation operations, edge abuse controls and operational monitoring before accepting real customer data. This code deliberately has no live payment mode.

The remaining items are disclosed limits of the demo and deployment verification, not claims that every listed production capability is already implemented.
