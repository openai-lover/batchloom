# Actual local-model evaluation

These are real browser inference runs from 2026-10-25 using synthetic requests. No customer data, credentials, local usernames, paths or device identifiers are included. Browser metadata is reduced to desktop Chromium with WebGPU and shader-f16. Model IDs, immutable asset revisions, runtime version, corpus hashes, raw output and observed timing remain available for reproducibility.

The final model is Qwen3 1.7B q4f16, running locally through WebLLM 0.2.86. The `evidence-choice-v3.1` contract restricts model output to actual source spans or null, derives quantities/cents in code, and conservatively holds ambiguous records. The model never controls payments.

| Actual run | Exact checked fields | Known values retained | Incorrect non-null accepted values | Review records | Elapsed |
|---|---:|---:|---:|---:|---:|
| [24-case development set](local-ai-qwen17-development-final.json) | 84/120 (70%) | 65/101 | 0 | 13/24 | 41.1 s |
| [6-case independent English holdout](local-ai-qwen17-holdout-final.json) | 21/30 (70%) | 19/28 | 0 | 2/6 | 13.7 s |

The first column of the interactive evaluation scores each normalized source span independently: 100/120 development fields and 27/30 holdout fields matched. Whole-record validation subsequently discards otherwise correct fields when another field fails, reducing recall. The English development subset scored 57/60 per-field and 48/60 after whole-record validation. Korean quantity/currency grammar is not supported comprehensively. Neither sample establishes production accuracy or a general safety guarantee.

[Field-by-field CSV](final-field-results.csv) contains all 150 final evaluated fields, including unknowns and failures. The holdout was authored independently after the first development failures and was not used for further tuning. The corpus itself is in `tests/fixtures/local-ai-holdout-v1.json`.

The actual eight-message product flow returned 12 compatible potential units, three constraint conflicts and two review cases in 15 seconds. This was a live local-model run over synthetic source messages, not the hand-authored illustrated analysis. See [product result](batchloom-local-ai-live-desktop.jpg) and [source evidence](batchloom-local-ai-live-evidence.jpg).

[Cancellation evidence](local-ai-cancel-evidence.json) records a run stopped during request 5 after four diagnostic responses. The returned accepted requests array is empty. Partial diagnostics are not a completed product analysis.

## Earlier failures retained

- [Qwen3 0.6B original run](local-ai-qwen06-initial-baseline.json): 91 seconds including first download; all records initially rejected because the runtime prepended its empty thinking marker.
- [Same 0.6B outputs with only the documented marker normalized](local-ai-qwen06-normalized-baseline.json): 94/120 raw values matched, but only 1/24 records passed source evidence checks. This is a reanalysis, not another model run.
- [Qwen3 1.7B value-generating baseline](local-ai-qwen17-value-baseline.json): 104/120 raw values matched; 5/24 records passed. Arithmetic and rewritten quotes caused failures.
- [Unrestricted span output v2](local-ai-qwen17-spans-v2.json): preserved intermediate run; quote rewriting remained a problem.
- [Source-choice v3](local-ai-qwen17-choice-v3.json): preserved intermediate run before the explicit English non-order guard. One instruction-only payload supplied five incorrect non-null fields; the final conservative guard was added before the independent holdout.

All comparisons using the 24 development cases are development evidence, not untouched benchmark claims. Model behavior is not a payment authorization. Human review and buyer approval remain required.
