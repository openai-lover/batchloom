# Sanitized PayPal Sandbox recovery evidence

Observed 25 October 2026. All payment activity used PayPal Sandbox, synthetic buyers and fictional goods; no live funds were involved. These files report actual provider responses, not unit-test doubles.

| Report | Outcome | Scope |
| --- | --- | --- |
| [Underfilled void](underfilled-void.json) | Verified | One USD 24 authorization was voided when the unchanged settlement engine ran with an injected post-deadline clock. No capture or refund. |
| [External invalidation refund](external-invalidation-refund.json) | Verified | Two USD 144 holds; first capture completed, the fixture harness deliberately voided the second, and the unchanged engine automatically refunded the first. Real clock, second capture forbidden. |
| [Mock-expiration preflight](mock-expiration-preflight-not-verified.json) | Not verified | Fake-ID capture preflight returned 403 instead of the requested 422. It stopped before any legitimate capture. A read-only mock probe succeeded; capture mock injection remains unverified. |

Both successful recovery tests used newly approved orders and an isolated in-memory ledger. They did not update the application's database. The original fixture pages can therefore retain stale state. The underfilled test did not wait 48 real hours; the compensation test deliberately induced an external authorization invalidation and did not use a mock header. The earlier unsuccessful preflight occurred before that later recovery test.

The separate browser end-to-end authorization and USD 288 capture sequence is described in [the full verification report](../../docs/provider-verification.md). Its original successful batch was preserved. Do not describe the isolated recovery tests as browser end-to-end recovery, automatic scheduling, natural authorization expiration, or hosted-production validation.

Reports retain only scenario flags, fixed synthetic amounts, timestamps, operation/status labels and limitations. Credential values, buyer details, merchant/payment/batch identifiers, owner hashes and private recovery ledgers are omitted. The local operator harness and checkpoints remain outside the published source in an ignored runtime directory.

PayPal references: [void authorization](https://developer.paypal.com/api/payments/v2/authorizations-void/), [full refund](https://developer.paypal.com/api/payments/v2/captures-refund/), [negative-response request headers](https://developer.paypal.com/negative-testing/request-headers).
