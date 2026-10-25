# Local request analysis and evidence boundary

Batchloom uses Qwen3 for one narrow task: interpret a customer's free-text expression of interest. It returns a product, quantity, colorway, per-item USD budget and explicit date, with exact source quotations. Deterministic application code checks evidence and maker policy. The model cannot change price, approve a batch, authorize a purchase, or call PayPal.

## Current implementation

`lib/local-ai.ts` runs the public Qwen3 1.7B model on the browser's GPU in a dedicated Web Worker. There are no AI API keys, paid inference endpoints or cloud-model fallback. `@mlc-ai/web-llm` is pinned to **0.2.86** in the dependency lock. The model and compiled runtime URLs are pinned to immutable revisions:

- Model: `mlc-ai/Qwen3-1.7B-q4f16_1-MLC`, revision `80b3abcec6c3b3f5355dc0cc99cc4fb578f192bc`.
- Model runtime: official `mlc-ai/binary-mlc-llm-libs`, revision `00fe7a40e57e5e8eb9fef87526a4bf28ad5846c0`, WebLLM `v0_2_86/base` Qwen3 1.7B q4f16 WebGPU build.
- Upstream Qwen3 and WebLLM licenses: Apache-2.0.

The official model directory totals approximately **984 MB** (968 MB of weight shards plus tokenizer/config files). The UI reserves a rounded **1 GB initial download estimate**, including tokenizer and runtime assets; transfer size varies with compression and cache. This is not the GPU-memory requirement. The official WebLLM catalog estimates **2,036.66 MB VRAM** for this model. Browser overhead, available memory and performance vary. A compatible WebGPU device with `shader-f16`, a secure context (HTTPS or localhost), and enough storage/memory are required. Model assets are cached in the browser and can be evicted by the browser. This is not a guarantee that all phones work.

The worker is bundled from source with `npm run build:local-ai` into `public/local-ai/worker.js`. Its package license is served alongside it. Rebuild the worker after changing its entry point or WebLLM version; the origin-relative URL avoids SSR framework URL rewriting.

The former server AI adapter and its dedicated tests were removed on 2026-10-25. No personal AI provider credentials are needed. `/api/analyze` and `/api/analyze-local` return 410 before reading their request bodies; there is no server inference fallback.

## What leaves the device

The workspace saves raw fictional request drafts, display labels and dispatch dates in tab-scoped sessionStorage so editing survives reloads and context switches. Extracted evidence, analysis results and payment permissions are not restored from these drafts. Storage is not application-encrypted; browser session recovery may retain it. Clear saved copies from the Studio guide. This storage is separate from model caches and does not add a server inference path.

During **model analysis**, customer text is passed only from the page to its local worker. The model receives one source body at a time, without customer labels or received timestamps. It has no tools, fetch instructions, payment handles, or credentials. Initial model downloads contact Hugging Face/CDN and GitHub, which can receive ordinary connection metadata such as IP address. Cached model weights are not customer transcripts.

This does not mean every Batchloom action is offline. **Publishing a reviewed local-model batch** separately sends its public title, fixed maker policy, and aggregate counts to the application server. It does not send source text, customer names, quotations, or source IDs. The server records model identity as **self-reported**, validates fixed terms and count consistency, and does not claim to prove model execution or private evidence. The separate illustrated-example path sends only canonical synthetic fixtures. PayPal checkout separately contacts PayPal. Download hosts can receive ordinary network metadata. The optional proposal download contains source text and evidence in a local JSON file; it is not uploaded by the app and should not be shared publicly with real customer material.

## Client interface

```ts
analyzeLocalRequests(requests, policy, {
  signal: abortController.signal,
  onProgress: ({ phase, message, progress, completed, total }) => {},
});
```

The result has `mode: 'local_ai'`, the pinned model ID, and one of:

- `complete`: each request was processed or explicitly held for review. A completed run is not proof that every interpretation is correct.
- `unsupported`: the browser/device cannot run this model. Explain the constraint; the labelled synthetic example remains available.
- `cancelled`: the worker was terminated. No partial analysis is accepted.
- `failed`: invalid input, worker/model error, memory/download problem or timeout. Sources remain unchanged; no cloud fallback occurs.

`checkLocalAISupport()` checks the browser and GPU feature before downloading. `LOCAL_MODEL` supplies display metadata. Progress reports actual runtime load progress and per-request completed counts, not fabricated end-to-end percentages. The first use requires an explicit user action. Cancellation terminates the worker, including active download or inference; already cached model parts may remain. Completion also terminates the worker to release GPU resources. A subsequent run reloads from cache when available. Loading has a 15-minute limit; each generation has a 120-second limit.

## Narrow extraction contract

`lib/local-ai-core.ts` contains a versioned prompt and builds a per-source JSON schema. Each field can contain only one of the literal evidence spans found in that source, or `null`. WebLLM constrains generation with `response_format: {type: 'json_object', schema: ...}`. The Qwen-specific documented `extra_body.enable_thinking: false` avoids generating reasoning tokens; its exact empty runtime prefix is removed before JSON parsing. Other prose or reasoning is rejected. The app supplies the request ID after generation; the model cannot choose it. Each customer's context is reset before the next customer.

This MVP supports short English stationery messages with literal product/color names, digit counts or English number words one to twenty, explicit USD per-item budgets, and literal `YYYY-MM-DD` dates. The local model's input limit is 1,500 characters per request; longer messages are held for review without silent truncation. Application input also enforces at most 24 unique requests and 32,000 combined characters. Multilingual capability of the base model does not establish multilingual support in the evidence parser. For example, Korean quantity or currency grammar may be rejected and held for review.

The model returns five copied spans or nulls. Code converts supported spans into the domain format `{value, quote}`; it computes integer cents rather than asking the model to perform arithmetic. Unknown fields become `{value: null, quote: null}`. Model-added properties, invented quotations, copied evidence from another source, unsupported values, invalid JSON, and truncated output are rejected. A bad record becomes an empty extraction with a visible review reason; it cannot contribute units to the proposal. Good records from a fully completed run remain reviewable. Required product, quantity and variant must be present before interest can count. An absent budget/date remains visibly unknown and does not constitute buyer approval of the price or timing.

A budget means the customer's maximum per-item amount, not product price. The catalog price remains **$24**, minimum **12 units**, reservation window **48 hours**, and currency **USD**. Values are validated in integer cents. No model result can override these constants. A summary is always `kind: 'uncommitted_demand'`, never authorized or collected money.

Exact quotations narrow hallucinations but do not prove semantic correctness. Negation, sarcasm, corrections and competing dates can still confuse a small model. JSON grammar ensures structure, not truth. Human source review remains mandatory; do not advertise complete prompt-injection protection or perfect extraction.

## Payment separation

The worker has no financial API or tool. Actual authorization counts and payment totals come from the separate server's PayPal-confirmed ledger. A model interpretation, browser redirect or editable status cannot authorize a charge. Maker review freezes the proposal; each buyer still approves an individual PayPal authorization. Settlement remains a separate authenticated operation with policy and provider checks.

## Verification and honest demo labels

Run the dependency-free boundary tests with Node 24:

```sh
node --test tests/domain.test.ts tests/ai-local.test.ts tests/private-proposal.test.ts tests/http.test.ts
```

These tests check grounding, fixed policy, hostile output properties, foreign IDs/evidence, cancellation-before-start, unsupported server execution, and the private publishing boundary. They are **not real model accuracy measurements**. The 15 removed cloud-adapter tests are not counted as current feature coverage.

`tests/fixtures/local-ai-eval.json` contains 24 independently authored synthetic development cases: 12 English, 6 Korean and 6 mixed/injection cases, with explicit unsupported-parser annotations. A separate 6-case English holdout was authored without viewing the new prompt or individual failure outputs, then first run after `evidence-choice-v3.1` was fixed. Both were actually evaluated in a desktop Chromium browser on 2026-10-25. Public reports, raw model outputs, normalized results, dataset hashes and a 150-row field-level CSV are in [artifacts/evaluation](../artifacts/evaluation/README.md). These are small synthetic samples, not production or population-level accuracy estimates.

`lib/demo-data.ts` is a hand-authored illustrative scenario, **not a live or recorded AI result**. Keep this label visible when it is loaded. Neither these fixtures nor local model output represent real orders, payment commitments or a user study.

## Primary sources consulted on 2026-10-25

- [WebLLM basic usage](https://webllm.mlc.ai/docs/user/basic_usage.html)
- [WebLLM worker support](https://webllm.mlc.ai/docs/user/advanced_usage.html#using-web-workers)
- [Official model catalog](https://github.com/mlc-ai/web-llm/blob/main/src/config.ts)
- [WebLLM response format and Qwen thinking control](https://github.com/mlc-ai/web-llm/blob/main/src/openai_api_protocols/chat_completion.ts)
- [MLC Qwen3 1.7B files](https://huggingface.co/mlc-ai/Qwen3-1.7B-q4f16_1-MLC/tree/80b3abcec6c3b3f5355dc0cc99cc4fb578f192bc)
- [Qwen model card and license](https://huggingface.co/Qwen/Qwen3-1.7B)
- [Transformers.js WebGPU alternative](https://huggingface.co/docs/transformers.js/guides/webgpu) and [Qwen3 ONNX usage](https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX)

WebLLM was selected for its documented constrained JSON generation and worker interface. Transformers.js is a valid browser alternative, but this application does not silently switch engines or substitute CPU inference on unsupported devices.



### Recorded model comparison

The first real browser run on 2026-10-25 used Qwen3 0.6B, the fixed prompt, and all 24 synthetic cases. It completed in 91.0 seconds including the initial download. The original report preserves an integration defect: WebLLM prepended its documented empty non-thinking marker, so JSON parsing held every record for review. After removing **only** that exact empty runtime prefix and re-evaluating the same outputs, raw model field values matched 94/120 references (78.3%); known fields recovered were 85/101; 18 non-null claims were incorrect. Only 1/24 records passed source-evidence validation. Missing date quotations and fabricated quote spans made this model unsuitable for the product. These failures are retained in `outputs/dual-hackathons/local-ai-qwen06-initial-baseline.json` and `local-ai-qwen06-normalized-baseline.json` in the task workspace.

Qwen3 1.7B with the original value-generating prompt improved raw field values to 104/120 (86.7%), but only 5/24 complete records passed evidence validation; incorrect arithmetic and rewritten quotes remained. The subsequent span-generating and source-choice versions are preserved too. Changing the model and contract after observing the 24-case corpus makes those runs **development comparisons**. The separate 6-case holdout was not used for further tuning.

Final `evidence-choice-v3.1` results:

| Sample | Per-field checked spans | Fields surviving whole-record checks | Known fields recovered after whole-record checks | Incorrect non-null values surviving checks | Time with cached model assets |
|---|---:|---:|---:|---:|---:|
| 24 development cases | 100/120 (83.3%) | 84/120 (70.0%) | 65/101 (64.4%) | 0 | 41.1 s |
| English development subset (12 cases) | 57/60 (95.0%) | 48/60 (80.0%) | 39/51 (76.5%) | 0 | Included above |
| Independent English holdout (6 cases) | 27/30 (90.0%) | 21/30 (70.0%) | 19/28 (67.9%) | 0 | 13.7 s |

The development set held 13/24 records for review; the holdout held 2/6. Whole-record checks deliberately drop otherwise valid fields when another field is ambiguous or unsupported. Zero observed incorrect accepted values is a result for these samples only, not proof that unseen input is safe. Missing values and abstention are reported rather than disguised as perfect accuracy.

The actual product's eight supplied synthetic messages were also analyzed through **Analyze privately**, without loading the illustrative interpretation: 12 potential units from three matching requests, three constraint conflicts, and two review cases, in 15 seconds including cached loading. Source quotations were checked in the product drawer. A separate cancellation test interrupted request 5 after four completed diagnostic responses and returned `status: 'cancelled'` with **zero accepted requests**. The model has not been tested on a real phone or a device without WebGPU; those paths provide an unsupported-device message, not fabricated inference.

### Evidence-choice contract

The current `evidence-choice-v3.1` pipeline gives the model only literal source-evidence choices plus `null` for each field. Its per-request JSON grammar is generated from those choices. The model reads context and chooses a relevant span or abstains; it cannot emit a fabricated quotation or calculate money. Application code converts supported English counts, explicit per-item USD amounts and ISO dates into typed fields, then reuses the domain validator. A source containing competing counts, conflicting collection colors, competing budgets or dates is conservatively held when a single selection would hide that ambiguity. An explicit English non-order declaration overrides quoted payload values. This narrow guard does not solve all possible prompt injection or semantic ambiguity.

The public evaluation screen `/evaluate` keeps the 24-case development comparison separate from a newly authored 6-case English holdout. Its first column measures each source-checked, normalized span independently; the second measures fields surviving whole-record validation. It is not presenting raw numeric model accuracy: the model no longer generates numeric values. Actual raw span output remains in each exported record. A visible JSON view provides an export fallback if a browser blocks downloads.


