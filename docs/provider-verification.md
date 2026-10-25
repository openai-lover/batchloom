# PayPal Sandbox verification

Observed on 2026-10-25, Asia/Seoul. These were actual PayPal **Sandbox** responses and browser interactions, not real funds. No production payment endpoint was used.

## Browser end-to-end: authorization and qualifying capture

1. A maker opened a fixed Cobalt Field Notes batch in the application: USD 24 per notebook, 12-unit threshold, 48-unit capacity, 48-hour reservation window.
2. A synthetic Sandbox buyer selected 12 notebooks, reviewed the USD 288.00 total and consented to the fixed reservation terms.
3. The application created an `AUTHORIZE` order through PayPal Sandbox. The buyer signed in and approved it on `www.sandbox.paypal.com`.
4. On returning to the application, the server verified the order correlation, seller, amount and currency and obtained the authorization. The buyer page displayed **Payment authorized — not charged**, 12/12 confirmed units and USD 0.00 captured.
5. The maker selected **Close batch & settle**. The application captured the authorization and displayed `COMMITTED` and USD 288.00 captured.
6. Reloading the buyer page showed **Sandbox payment captured** and provider status `completed`. Further reservations were disabled.

The browser screenshots are kept in the authoring workspace as `paypal-authorized.png`, `paypal-captured-maker.png` and `paypal-captured-buyer.png`. They show a fictional product and synthetic buyer workflow. Authentication screens and credentials are not publication assets. This successful application batch was preserved during the separate recovery tests below.

## Actual provider recovery through isolated fixtures

Both tests used newly created synthetic Sandbox orders approved in the browser. The existing settlement engine and real Sandbox adapter operated against a cloned snapshot in an isolated in-memory repository. The original application database was not changed. These are actual provider recovery tests, **not browser end-to-end recovery sequences**; the fixture pages can retain stale application state.

| Test | Deliberate fixture condition | Actual provider result | Fixture ledger |
| --- | --- | --- | --- |
| Underfilled release | One USD 24 hold, 12-unit minimum; clock injected just after the original 48-hour deadline | Authorization `VOIDED`; no captures or refunds | `CANCELLED`, `MINIMUM_NOT_REACHED` |
| Compensation | Two six-unit holds of USD 144 each; harness voided the second after the engine persisted the first capture | First capture `REFUNDED`, refund `COMPLETED`, second authorization `VOIDED`; second capture forbidden | `CANCELLED`, `AUTHORIZATION_NO_LONGER_VALID` |

The underfilled test did not wait 48 real hours. Its injected clock exercised the deadline branch without rewriting the frozen batch deadline. The compensation test used the real clock: first capture `COMPLETED` → deliberate external void `VOIDED` → engine-driven full refund `COMPLETED`. The engine re-read actual provider state before compensating. No mock response header was used in that successful recovery sequence. It verifies an intentionally induced authorization invalidation race, not a spontaneous provider failure or natural authorization expiration.

Sanitized evidence is published in [artifacts/provider-verification](../artifacts/provider-verification/README.md): [underfilled void](../artifacts/provider-verification/underfilled-void.json) and [external invalidation refund](../artifacts/provider-verification/external-invalidation-refund.json). Credentials, buyer details, merchant/payment/batch identifiers, owner hashes and private recovery snapshots are excluded.

## Negative-test attempt retained as not verified

Before the compensation test, a fake-authorization capture preflight requested `AUTHORIZATION_EXPIRED` using PayPal's official mock header. It returned HTTP **403**, rather than the expected 422, so the harness stopped before any legitimate capture. A separate read-only probe of an existing authorization returned `CREATED` normally, 404 / `INVALID_RESOURCE_ID` with the read mock header, and `CREATED` after removing it. Both holds remained untouched at that stage.

This establishes that the tested read mock worked; it does not establish capture-error injection. Earlier resource/access validation is a plausible explanation for the fake-ID failure, not a confirmed provider implementation detail. The [not-verified preflight report](../artifacts/provider-verification/mock-expiration-preflight-not-verified.json) is retained alongside the successful recovery evidence. No unverified header was used to capture a valid hold, and no account-wide negative-testing setting was changed. See PayPal's [REST header guide](https://developer.paypal.com/negative-testing/request-headers) and [negative-testing overview](https://developer.paypal.com/negative-testing/overview).

## Limitations of this evidence

- The evidence covers one browser authorization/capture sequence and two isolated actual-provider recovery sequences. It does not prove every provider failure, concurrency case or production behavior.
- Automated tests separately cover deadline behavior, late responses, retry safety and partial recovery using controlled provider doubles. Those tests do not add actual transaction evidence.
- Model inference has its own evaluation; the payment sequence above used the clearly labeled authored example proposal.
- Settlement is explicitly initiated by the maker. There is no automatic background scheduler or live webhook endpoint.
- Separate captures are not atomic, authorizations are not escrow, and a recovery refund may not complete immediately.
- Local verification does not establish the correctness of a separately deployed HTTPS origin, payment return URL or hosted model worker. Those require their own checks.

## Integration issue found and resolved

The first local app request failed before reaching PayPal because the Worker runtime did not implement `fetch` with `redirect: "error"`. The adapter now uses manual redirect handling, rejects every redirect response and requests uncached provider state. The fix preserved TLS validation and credential destination restrictions. A direct Node success was not counted as app integration success; the browser sequence above was completed after the runtime fix.
