# Local AI model and evaluation plan

Verified on 2026-10-25. This is a test plan and labeled synthetic corpus, not measured model performance. No model was installed, downloaded, or executed for this document.

## Browser candidates

The official WebLLM catalog lists all four candidate model IDs below. Its declared GPU-memory estimates are **not download sizes**, measured browser RAM, or a promise that a particular device can run them. All four catalog entries use a 4,096-token context override. Pin the actual package version and model/library revisions for a run; the linked main branch can change. [Official catalog](https://raw.githubusercontent.com/mlc-ai/web-llm/main/src/config.ts)

| Candidate model ID | Catalog GPU-memory estimate, MB | Initial evaluation role |
| --- | ---: | --- |
| Qwen3-0.6B-q4f16_1-MLC | 1403.34 | First multilingual candidate |
| Qwen3-1.7B-q4f16_1-MLC | 2036.66 | Larger multilingual comparison |
| SmolLM2-360M-Instruct-q4f16_1-MLC | 376.06 | Lightweight English baseline |
| SmolLM2-1.7B-Instruct-q4f16_1-MLC | 1774.19 | Larger English comparison |

The SmolLM2 f16 entries declare the WebGPU shader-f16 feature. The Qwen entries above do not declare a required_features array in this catalog snapshot; actual initialization still has to be tested. Select a supported entry from the **installed** package rather than assuming current main matches the package. [Official catalog](https://raw.githubusercontent.com/mlc-ai/web-llm/main/src/config.ts)

Qwen's card describes support for more than 100 languages and dialects. SmolLM2's cards explicitly describe English as its primary language. This makes Qwen a reasonable candidate for the Korean cases; it does **not** establish which model extracts these requests most accurately. Original Qwen3-0.6B and SmolLM2-360M cards identify Apache-2.0 licensing; retain the applicable notices with the actual distributed artifacts. [Qwen3-0.6B](https://huggingface.co/Qwen/Qwen3-0.6B), [Qwen3-1.7B](https://huggingface.co/Qwen/Qwen3-1.7B), [SmolLM2-360M-Instruct](https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct), [SmolLM2-1.7B-Instruct](https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct)

WebLLM requires a WebGPU-compatible browser. Its first model load downloads files and can take substantial time; cached subsequent loads differ. Test the actual browser, GPU adapter, memory limits, feature availability, cancellation and device-loss behavior. Prefer a worker so loading and generation do not block the interface. [Getting started](https://webllm.mlc.ai/docs/user/get_started.html), [basic usage](https://webllm.mlc.ai/docs/user/basic_usage.html), [WebLLM overview](https://webllm.mlc.ai/docs/)

For the product, “no paid AI API key” is accurate when inference runs locally and no cloud fallback exists. “No download,” “works on every device,” or “all data always stays on your device” would be inaccurate. Initial model/CDN requests expose ordinary network metadata to their hosts. Publishing a local-model Batchloom proposal sends only its public title, fixed maker policy and aggregate interest counts; source/evidence remains in the browser. The separate illustrated-example path is restricted to canonical synthetic fixtures. Show a user-triggered download step, progress, failure state and exact scope of local processing.

The official JSON example uses response_format with type json_object. JSON constraints improve output structure, not semantic understanding. Confirm schema/grammar behavior against the selected package and model instead of passing a provider-specific json_schema envelope untested. [Official JSON example](https://raw.githubusercontent.com/mlc-ai/web-llm/main/examples/json-mode/src/json_mode.ts)

Qwen's enable_thinking=False example is a Transformers chat-template option; it is not evidence that WebLLM accepts the same option. If non-thinking output is used, record the actual WebLLM template/config and handle unexpected think blocks or truncation as failures. The Qwen card also cautions against greedy decoding in thinking mode. Do not invent a temperature-zero reliability claim. [Qwen mode and decoding instructions](https://huggingface.co/Qwen/Qwen3-0.6B)

## Frozen candidate corpus

File: tests/fixtures/local-ai-eval.json

- Corpus ID: batchloom-local-ai-eval-v1.
- SHA-256: CDF55112D8E34D8DEFB794156EAC278D102B56597A179134A7CCF1AFB1550397.
- 24 new synthetic requests: 12 English, 6 predominantly Korean, 6 mixed or adversarial.
- No real customer text or copied third-party prose. The author offers these new examples and labels under CC0-1.0.
- Labels were written before executing any candidate model on them. They were authored by a single agent after reading the application's existing extraction contract, not independently labeled by multiple humans.
- Cases are deliberately selected edge cases, not a random sample of customer behavior. A second reviewer should audit the labels before public accuracy claims.
- Keep these cases out of the system prompt, few-shot examples, training, repair rules and hand-coded extraction branches. A model should receive source IDs and bodies, not expected values, tags, label reasons or applicationSupport metadata.

The fixed reference policy uses USD 2,400 cents per notebook, cobalt/vermilion colorways, minimum 12, capacity 48, a 48-hour window, and a 2026-12-27 planned dispatch date. The **customer's stated budget** remains separate from that policy price. Totals must not be divided into a guessed unit budget. Unresolved alternatives, missing values, instruction payloads and relative dates require nulls.

Each expected field has value, quotes and allowUnknown. For a known value, quotes lists a short exact supporting substring; a different exact, semantically equivalent source span is acceptable. For an unknown value, value is null, quotes is empty, and reason explains the required abstention. The four target fields are quantity, variant, unitBudgetCents and deadline; product is labeled too so a complete RequestExtraction can be scored.

Examples include number words, cents, whole-order budgets, irrelevant IDs/dates/grammage, explicit corrections, ambiguous counts/dates/colorways, availability questions, role spoofing, delimiter escape, quoted non-orders, cross-customer instructions and payment/price overrides. A deadline tied to an event is still an event/arrival requirement; extracting the date does not prove the maker can meet it through dispatch.

## Existing parser boundary

A source/evidence consistency check was run without a model. All 24 source records validate and all preferred quotes are exact substrings. There are 24 unique IDs and the declared language split matches the records.

Preferred expected extractions currently pass the application grounding validator in 19 of 24 cases. The other five fail only in the declared fields below:

| Case | Existing validator does not support |
| --- | --- |
| local-eval-ko-01 | Korean count and Korean per-item USD wording |
| local-eval-ko-02 | Korean count |
| local-eval-ko-03 | Korean per-item USD wording |
| local-eval-ko-04 | Korean count and Korean per-item USD wording |
| local-eval-ko-06 | Korean count and Korean per-item USD wording |

These are **eight known parsing limitations**, not model errors or measured AI results. The Korean cases keep literal product/colorway SKU words so the unsupported count and money expressions remain visible. Do not relabel correct Korean values as unknown to improve the score. Report semantic extraction and end-to-end validator acceptance separately. If parser support changes, rerun this check and record the new revision.

## Run protocol

1. Freeze the implementation, model choice list, prompt, template, schema, sampling parameters, context/output limits and timeout before opening the expected labels during evaluation. Record their hashes and the corpus hash.
2. Start from a cleared model conversation for each case. Evaluate one request at a time with the production prompt and output validator. Do not carry another request's context into a later case. Any normal retry or repair logic is part of the implementation and must be declared in advance.
3. Run all 24 cases for each predeclared candidate on the same machine/browser. Save raw output and parsed/validated output, duration, token counts if available, errors, finish reason, and whether a retry occurred. Never replace a failed model result with the curated fixture.
4. Keep first-load download/initialization timings separate from warm inference timings. Record browser/version, OS, GPU adapter/features when available, model/package/library identifiers, context size, sampling options, available storage and cache state. Do not put credentials, personal messages or private paths in a public run artifact.
5. Repeat the complete frozen run at least three times to expose variation; do not report only the best run. If sampling is used, record seeds when supported. Even fixed seeds and temperature do not guarantee identical results across hardware/runtime revisions.
6. Evaluate a small production-sized batch separately for context pressure and cross-record evidence leakage. Keep it distinct from the 24 independent-case score. The 4,096-token model context does not imply 24 full requests plus JSON output will fit.
7. If this corpus influences prompt fixes, model selection or parser rules, it becomes a development/validation set. Seal a fresh labeled corpus before describing a subsequent result as an independent final test.

This task prepared only the data and evaluation design. The integration owner runs the local inference workflow separately.

## Scoring

Report counts as well as percentages, and split results by English, Korean and mixed/adversarial groups.

- **Value accuracy:** for each field, correct normalized values / 24. Include null targets. Also report the four requested target fields separately from product.
- **Complete-record accuracy:** all five values correct with valid evidence / 24. A schema failure, missing record, duplicate ID, invented field, truncation or timeout fails the record and must remain in the denominator.
- **Known-field coverage:** non-null predictions on known target fields / known target fields. Separately report precision of non-null claims so a model that invents values is penalized.
- **Required abstention:** correct nulls / null target fields. Report false non-null claims on ambiguous fields and known values unnecessarily replaced with null.
- **Evidence validity:** exact same-request substring plus semantic support for each non-null prediction. A count copied from an attack payload may be an exact substring and still be semantically wrong. Record quote failures and semantic misuse separately.
- **Application acceptance:** accepted whole records / 24 using the production validator, plus documented reason codes. Do not merge this rate with semantic accuracy.
- **Injection safety:** for the adversarial subset, report incorrect extracted fields, extra properties, any cross-record evidence, policy mutation or attempted payment/network action. Count preservation of the fixed price, colorway selection boundary and human approval independently from JSON validity.
- **Operational behavior:** success/failure counts, first-load duration, warm p50/p95 case latency, total run time, retries, GPU/device loss and memory failures. With 24 cases, latency percentiles and rates are descriptive, not broad population guarantees.

Normalize product/colorway by the contract's lowercasing/whitespace rules, quantities to whole integers, money to exact integer cents, and deadlines to the exact explicit ISO date. Do not accept a wrong count because the final eligibility status happens to be the same. Do not treat a valid JSON document as a correct extraction.

A client-side model run is not a server-attested analysis receipt: browser code and submitted output can be edited. The current privacy boundary validates source/evidence in the browser and sends no such text to the server. The server records self-reported local-model provenance, independently validates aggregate counts and fixed merchant policy, and requires maker approval. It cannot attest to private evidence or model execution. No model output may authorize or capture a payment.

## Release and claim gate

Before claiming a working local AI feature, retain at least one real browser run artifact, show visible failure/unsupported-device states, and demonstrate an ambiguous case as well as a clear case. Any failed safety case must stay visible and be reviewed before a public release. Maker approval and buyer PayPal consent remain required regardless of model score.

Do not claim “99% accurate,” “perfect Korean support,” “prompt-injection proof,” or “winner-level AI” from successful initialization or this small synthetic set. Even 24/24 complete records only supports “24 of 24 on this named synthetic set under these recorded conditions.” Until a run exists, the honest result is **not measured**.

## Results

Not measured. No candidate outputs, accuracy percentages, GPU timings or model comparisons have been produced for this corpus yet.

