# Batchloom

Good things come together. Batchloom helps a small stationery maker turn scattered expressions of interest into a fixed, 48-hour production batch, then collect buyer-approved PayPal sandbox reservations.

This hackathon prototype uses fictional goods and synthetic demo messages. It does not ship products or move live funds. Request interest is never a payment authorization.

## How it works

The request library contains **24 authored fictional requests across three contexts**: a writing circle, a vermilion print workshop and a bookshop restock. Each set includes compatible requests, conflicting terms and missing details. Distinct generated scenes identify the context; collections and the payment journal show actual ledger state rather than decorative product photography.

Search, status filters and sorting help prioritize review. Each set keeps its own editable draft in this tab. Reloading or switching sets restores raw inputs but clears analysis and approval; the maker must review the current wording again. **Studio guide → Clear saved drafts** removes saved draft copies. These examples are inputs, not customers or transactions.

1. Review the illustrated requests, or run the Qwen3 model locally on a compatible browser GPU.
2. Inspect the original quotation behind each extracted product, quantity, color, budget and date. Ambiguities and conflicts stay visible.
3. Approve fixed terms: $24 per notebook, a 12-unit minimum, capacity up to 48, and a 48-hour reservation window.
4. Share the buyer page. Each buyer reviews their own quantity and fixed amount, then approves a PayPal sandbox authorization.
5. The maker selects **Close batch & settle**. A qualified batch is captured sequentially. An underfilled batch after its deadline releases confirmed holds. Partial settlement failure starts compensating refunds and voids; uncertain provider results remain unresolved until checked.

This is a recoverable payment workflow, not escrow or an atomic group transaction. A browser countdown does not run settlement automatically.

## Local AI and privacy

The application uses WebLLM 0.2.86 and a pinned Qwen3 model. The shared identity and immutable asset URLs live in `lib/local-model.ts`. No personal AI API key, paid inference endpoint, or cloud-model fallback is used.

The first model load downloads approximately 1 GB and may need roughly 2 GB of GPU memory with the current Qwen3 1.7B candidate. Device performance varies. HTTPS or localhost, WebGPU and `shader-f16` are required. Unsupported devices get an explicit explanation and can use the separately labelled illustrated example.

Customer source text and evidence remain on the device during local analysis. Raw draft requests, labels and dispatch dates are also saved in this tab's sessionStorage; analysis and payment approval are not restored from storage. Storage is not encrypted by the application, and browser session recovery may retain it. Use fictional inputs and clear saved drafts on a shared device. Publishing a local-model batch sends its public title, approved policy and aggregate counts only. The server records model identity as **self-reported**; it cannot prove that a model ran or that a summary matches private source text. Only actual PayPal-confirmed reservations qualify for payment settlement.

Model downloads contact Hugging Face/CDN and GitHub, which receive normal network metadata. The optional **Export proposal** downloads source text and evidence to a local JSON file. That file is not uploaded by the app; do not publish real customer material in an export.

See [AI implementation and limitations](docs/AI.md), [evaluation design](docs/local-ai-evaluation.md), and [security/privacy review](docs/security-review.md). The `/evaluate` page runs a fixed synthetic corpus through the actual browser model. Unit tests and authored examples are not model accuracy results.

## PayPal integration

All REST calls are pinned to `https://api-m.sandbox.paypal.com`. The browser approval destination is validated as `https://www.sandbox.paypal.com`. There is no live-mode switch.

The server verifies the order's intent, merchant, amount, currency, pledge and batch revision. Durable D1 state uses a batch lease and version comparison; pending operations are recorded before crossing the provider boundary. Stable request IDs, provider reconciliation and explicit uncertainty prevent a retry from being treated as a new payment. Late authorizations are released. Interrupted authorizations continue reserving capacity until positively resolved.

Required server runtime secrets are `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `PAYPAL_MERCHANT_ID`, all for the same sandbox business. Keep them in ignored local runtime configuration or hosting secrets. Use a distinct sandbox personal buyer for approval. Never commit credentials, session cookies or account screenshots.

See [PayPal design, setup and verification scope](docs/PAYPAL.md), the [actual Sandbox verification report](docs/provider-verification.md), and [sanitized recovery evidence](artifacts/provider-verification/README.md). The adapter includes webhook signature verification, but this app does not expose a webhook receiver or scheduled settlement worker.

## Run locally

Use Node 24 for the native TypeScript tests. The development framework requires Node 22.13 or newer. Preserve the dependency lockfile and install once:

```sh
npm ci
npm run build:local-ai
npm run dev -- --port 4192
```

The app runs on Vinext/Vite with the Cloudflare Workers runtime and D1. `.openai/hosting.json` declares the `DB` binding. Apply `drizzle/0000_deep_rogue.sql` and then `drizzle/0001_boring_the_santerians.sql` to a fresh local D1 database; do not replay migrations already applied. A build generates the local Worker configuration used by Wrangler:

```sh
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_deep_rogue.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_boring_the_santerians.sql
```

The old analysis-receipt table remains for migration compatibility and is not used by current HTTP routes. `/api/analyze` and `/api/analyze-local` return 410 before reading request bodies.

A random HttpOnly browser cookie controls maker and buyer access in this prototype. There is no user signup, account recovery or cross-device ownership transfer. Clearing cookies loses the corresponding controls. Do not use real customer records or production funds in this demo.

## Verify

```sh
node --test tests/*.test.ts
node node_modules/typescript/bin/tsc --noEmit --pretty false --incremental false
```

The tests exercise source evidence, privacy boundaries, ownership isolation, fixed prices, malformed inputs, redirect rejection, concurrency, uncertain outcomes, late holds, recovery and compensation. Payment tests use an explicitly fake provider. Actual browser inference and actual sandbox transactions must be recorded separately.

Actual local verification includes the browser authorization/capture sequence and two separately labeled provider fixtures: an underfilled void with an injected clock, and an automatic refund after the harness deliberately invalidated a second authorization. The recovery fixtures used an isolated ledger and left the application database unchanged. An unsuccessful mock-expiration preflight is also retained; it is not presented as successful provider-error injection. These results do not establish hosted-origin behavior.

## Publish safely

Publish a filtered source archive and use the Sites hosting workflow for the Worker and D1 migrations. Local runtime files are not deployment configuration. The public repository must exclude `.env*`, `.dev.vars*`, `.sites-runtime/`, `.wrangler/`, `.vinext/`, dependency/build caches and private exports. Inspect the final archive's file list; `.gitignore` alone is not proof that an arbitrary archive is safe.

Validate the deployed HTTPS origin, model download/worker, session isolation, PayPal return URL and maker settlement there before treating a local success as deployment success. The [security review](docs/security-review.md) records the private v1 probe: `/api/config` included the intended security headers, while tested HTML and static assets did not. Global header coverage and CSP enforcement are not established. The review also lists the model-download hosts observed during the audit.

Generated stationery imagery provides the visual direction; source prompts are recorded in [image prompts](docs/image-prompts.md). Bundled third-party runtime/style licenses are retained with their assets.

## License

Original application source and documentation use the [MIT license](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md) for generated imagery permissions, the bundled worker, vendored styles, and separately downloaded model artifacts.
