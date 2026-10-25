# Batchloom — Devpost submission draft

Prepared 2026-10-25 with the verified public-site model-to-payment workflow. This file separates reusable public copy from internal submission checks. It is not a submitted entry; the public YouTube URL and final Devpost workflow remain separate steps.

## Verified submission requirements

Deadline: **2026-11-12 12:00 PST / 2026-11-13 05:00 KST**. Use PayPal sandbox plus meaningful AI. Provide English project/tool descriptions, a working build or complete run instructions, and a public GitHub/GitLab/Bitbucket repository containing source, assets, instructions and a detectable open-source license. Video must be **under three minutes**, show working software and be publicly visible on YouTube; respect third-party rights. Keep judging access free through **2026-12-15 08:00 PST / 2026-12-16 01:00 KST**. New work or substantial in-period updates qualify. Entrant age, residence and conflicts must meet the rules. [Official rules](https://paypalaihackathon.devpost.com/rules)

The public overview confirms an online event, permits any AI model, and makes additional sponsor tools optional. It evaluates implementation, design, potential impact, innovation and presentation. [Official overview](https://paypalaihackathon.devpost.com/)

## Project overview fields

Devpost's standard flow includes a name, tagline, thumbnail, story, built-with tags, try-it-out links, gallery, video and final terms confirmation. Hackathon-specific additional fields can vary; the authenticated PayPal form has not been inspected for this draft. The following values are content preparation, not a claim that every field has been submitted. [Devpost participant guide](https://help.devpost.com/article/126-know-your-submission-steps)

| Field | Prepared value / remaining item |
| --- | --- |
| Project name | Batchloom |
| Tagline | Private AI turns maker requests into reviewed small batches, with conditional PayPal reservations. |
| Story | Copy the public project story below. |
| Built with | PayPal REST APIs, WebLLM, Qwen3, WebGPU, TypeScript, React, Cloudflare Workers, Cloudflare D1, HTML, CSS. Confirm final deployed stack and tags. |
| AI/tools explanation | Copy the tool-use text below; retain the final model manifest and evaluation report. |
| Try-it-out URL | https://batchloom-studio.nununong.chatgpt.site — public access and an actual local-AI → approved collection → buyer authorization → maker capture workflow were verified. Requires a compatible desktop WebGPU device for local AI and an initial model download of roughly 1 GB. PayPal is sandbox only. |
| Public repository | https://github.com/openai-lover/batchloom — public source, assets, run instructions and top-level open-source license. An independent unauthenticated archive check matched all 192 prepared files at commit e4181a905ffdbf5fc1308e39f48f6f55f557af55. Resync the final document/UI-only changes before final submission. |
| Video | Approved 160-second local release: outputs/dual-hackathons/video/batchloom-reviewable-release.mp4 under the task workspace. Add the actual public YouTube URL after upload and verify signed-out playback. The video uses actual recorded UI still/crop sequences, with that disclosure retained. |
| Thumbnail/gallery | Original generated 3:2 project cover: outputs/dual-hackathons/devpost-thumbnail.png under the task workspace (1536×1024, under 5 MB). Gallery: actual public UI screenshots with fictional/sample labeling. Decorative notebook photography is illustrative. |
| Team / submitter / country | Use the entrant's existing verified account details. Do not invent a biography, age, affiliation, collaborators or developer-account identifier. |
| Additional questions | Inspect the actual form and answer only verified facts. Do not opt into unused sponsor tools. |
| Final submission | Review the finished entry and applicable terms in the authorized submission workflow. Saving a draft is not submission. |

The tagline above is 98 characters, within Devpost's documented 140-character standard. Actual form constraints should still be checked. [Devpost form documentation](https://help.devpost.com/article/145-how-do-i-set-up-the-submission-period)

## Public project story — copy-ready draft

### Inspiration

For an independent printmaker, a few enthusiastic messages can look like a production order. Then the details disagree: different colors, an unclear count, a total budget mistaken for a unit price, or a deadline the maker cannot meet.

Batchloom explores the gap between that scattered interest and a buyer's actual permission to pay. The question is specific: can a maker assemble one considered production run while keeping the original intent, human decisions and payment state understandable?

### What it does

Batchloom is a production desk for a fictional risograph notebook studio.

A maker reviews synthetic customer requests with local AI assistance. The model proposes the product, quantity, colorway, explicit per-unit budget and date, alongside quotations from the source. The interface puts those words next to the interpretation so a person can inspect it. Missing or incompatible details can be held for review rather than treated as confirmed demand.

The maker then approves one fixed collection: $24.00 per notebook, a minimum of 12 units, a visible capacity and a 48-hour reservation window. Expressions of interest are kept separate from payment authorizations.

Buyers receive a public reservation page. They choose a quantity, review the exact amount and approve their own PayPal sandbox hold. An authorization is not a charge. The maker manually starts settlement; only provider-confirmed payment records count. The journal distinguishes captures, cancelled holds, refunds and outcomes that still need reconciliation.

### How it was built

The browser interface uses React and TypeScript with a restrained paper-and-ink visual system. Decorative product photography, paper button textures and the studio stamp were generated for this fictional collection.

Qwen3 runs through WebLLM in a browser worker. It downloads model assets on first use and needs a compatible WebGPU device. There is no paid cloud AI key or cloud inference fallback. In the local-model publishing flow, original messages and evidence quotations stay in the browser; the server receives the maker's approved product terms, model identifier and aggregate counts.

Application rules remain outside the model. The server validates fixed terms, capacity and timing. Browser analysis is self-reported, not a server-attested fact, and it never grants payment permission.

PayPal's sandbox Orders API creates AUTHORIZE orders. The server records authorization and settlement operations in a versioned Cloudflare D1 journal. Capture, void and refund paths use reconciliation and stable operation identifiers where supported, so an interrupted response is treated as uncertain instead of automatically becoming success or a fresh transaction.

### What is working

A verified workflow on the public site connected actual local model output to payment on the same collection. Qwen3 analyzed eight synthetic requests and identified three compatible requests totaling 12 potential units. The observed desktop run took 74 seconds including loading; this is one device measurement, not a speed guarantee.

After source-evidence review and explicit maker approval, that collection opened with zero reservations. One buyer then approved a PayPal sandbox authorization for 12 notebooks at $24.00 each. Maker-initiated settlement on the same collection reached COMMITTED with $288.00 captured, and the reserving buyer’s refreshed receipt showed the completed sandbox charge. Twelve units do not imply twelve customers. The authored illustrative sample remains distinct from actual model output.

The public demonstration is a fictional-product, test-environment integration. It establishes this observed workflow, not revenue or a production reliability guarantee.

### Challenges and limits

A small local model can misunderstand language even when its output is valid JSON. Exact quotations help a reviewer investigate a claim; they do not prove that every negation, ambiguous count or instruction attack was understood. On six unseen synthetic English requests, four complete records were correct and two were held for review. No incorrect non-null field survived whole-record validation in that small test. These counts do not establish general accuracy, production safety or Korean-language support.

Payment operations also do not succeed atomically across separate buyers. Recovery logic includes releasing holds and refunding completed captures after partial failure, and unresolved outcomes remain visible. A controlled deadline test also confirmed an actual PayPal sandbox void and a subsequent VOIDED lookup, without capture. The deadline was advanced in an isolated in-memory ledger; no real 48-hour wait or application database change occurred. A separate controlled external-invalidation recovery test then confirmed an actual sandbox refund: after a first capture completed, the harness voided a second authorization and the original settlement engine refunded the completed charge. Provider lookups confirmed the capture as REFUNDED, the refund as COMPLETED and the other authorization as VOIDED. This used a real clock and an isolated in-memory ledger without changing the application database; it was not a full application UI refund workflow.

The prototype uses synthetic people and products. Nothing is manufactured or shipped, settlement is initiated manually, and compatible desktop graphics hardware is required for local AI.

### Lessons from the build

The most important boundary is between interpretation and permission. A plausible AI summary cannot authorize a purchase. A browser redirect cannot prove payment success. And a missing provider response cannot prove that nothing happened.

Making those boundaries visible became part of the product, not just its backend.

### What's next

Expand the published model evaluation with more independent requests, Korean cases and required abstentions. Exercise end-to-end UI recovery and a wider range of provider failures. Improve clarification and correction workflows, then study the process with consenting makers before considering real inventory or live payments.

## AI and developer tools — additional-field copy

Batchloom uses the open-weight Qwen3 model through WebLLM for on-device structured request extraction. The selected model is **Qwen3-1.7B-q4f16_1-MLC**, using WebLLM 0.2.86 and model revision **80b3abcec6c3b3f5355dc0cc99cc4fb578f192bc**. The current evidence-choice analysis contract was run on the actual browser workflow and on six unseen synthetic English cases: four fully correct complete records, two held for review. Retain the final manifest and original evaluation report; do not turn this small result into a general accuracy percentage. Model files download from public hosts, while inference processes request text locally.

OpenAI Codex assisted implementation, and the built-in image generator produced original decorative fictional product photographs, button textures and a stamp. Generated imagery is not evidence of inventory, customers, payment success or model performance. PayPal REST APIs handle buyer-approved sandbox authorizations and maker-initiated settlement; browser model output cannot call financial actions.

## Internal evidence and remaining checks — do not paste as public story

| Claim / deliverable | Checkpoint evidence | Publication handling |
| --- | --- | --- |
| Maker/buyer interface | Public deployment actually exercised through model analysis, human approval, publication, authorization and capture | Actual CUA still/crop sequences illustrate the working public demo; they are not continuous interaction footage. |
| Actual authorization | Same public model-created collection: one buyer authorized 12 units / $288.00 | Actual post-authorization receipt and maker totals. No credentials or login-entry footage. |
| Actual capture | Same public collection: maker COMMITTED / 12 units / $288.00 captured; reserving buyer refreshed to completed sandbox charge | Keep public collection evidence separate from the controlled recovery tests. |
| Void/refund | Actual sandbox void confirmed in a controlled deadline test; actual refund confirmed in a separate controlled external-invalidation recovery test | Both used isolated ledgers and left application D1 unchanged. Only the deadline test simulated time. Do not describe the refund test as a full application UI flow. |
| Local AI | Insufficient earlier baselines retained; actual 1.7B workflow and six-case holdout completed (4 correct records, 2 held) | Report sample size, full-record result and abstentions together. Do not claim broad accuracy or Korean support. |
| Raw request privacy | Current local-model API accepts reviewed terms/counts and rejects extra source fields | Verify the production build and network requests before publishing the privacy wording. |
| Source/license | Public repository independently downloaded without authentication; all 192 files matched prepared bytes at e4181a905ffdbf5fc1308e39f48f6f55f557af55, including the top-level license and notices | This audit is a source checkpoint. Final document/UI-only amendments must be synced; do not imply the earlier hash audit attests future commits. |
| Judge access | Hosted URL or complete setup, model/device requirements and sandbox-only testing route | Verify from a fresh browser and keep available through judging. Do not publish personal account passwords, private keys or reusable merchant secrets. |
| Video | Approved 160-second release assembled from actual public workflow screenshots and labelled separate test-result cards | English narration and highlight captions; verify the final public YouTube playback after upload. No upload was performed by this document/video production task. |
| Identity / eligibility | Not established by this file | Use only the user's real account information and existing trusted evidence. |

Buyer QA screenshots saved by this task:

- artifacts/screenshots/buyer-desktop-qa.jpg
- artifacts/screenshots/buyer-mobile-390-qa.jpg

Current public workflow evidence:

- outputs/dual-hackathons/public-deployment-qa.json
- outputs/dual-hackathons/public-paypal-authorized.png
- outputs/dual-hackathons/public-qa-maker-captured.jpg
- outputs/dual-hackathons/public-paypal-captured-buyer.png
- outputs/dual-hackathons/public-source-check-report.json

The root evidence paths are relative to the task workspace, not necessarily this application folder. Inspect and sanitize the actual files before using them in a public entry.


Latest evidence checkpoint: the public same-collection model → approval → authorization → capture workflow supersedes the earlier separate-run demonstration. The six-case holdout and controlled void/refund tests remain separate evidence with their stated limits. The locally approved release retains the recorded UI still-sequence disclosure. Public YouTube upload and Devpost submission are not performed by this document/video production task.
