# Batchloom — demo storyboard and English captions

Draft checkpoint: 2026-10-25. Target runtime **2:40 (160 seconds)**, leaving a buffer below the official limit. Use English narration or English on-screen captions. The final video must be publicly visible on YouTube and show working software. [Official submission rules](https://paypalaihackathon.devpost.com/rules)

This is a production plan, not an existing video. It does not certify model accuracy, recovery behavior or production readiness.

## Evidence available at this checkpoint

The root agent verified an actual PayPal sandbox flow: one buyer reserved 12 units at $24.00, authorization was confirmed, and maker-initiated settlement reached COMMITTED with $288.00 captured. No real money or real inventory was involved.

An actual local Qwen3 1.7B workflow now produced a reviewed and explicitly approved new collection with zero reservations. A separate earlier sandbox run supplied the authorization/capture evidence. Six unseen synthetic English cases produced four correct complete records and two held for review. A controlled isolated-ledger deadline test confirmed actual PayPal sandbox VOIDED without capture; no real 48-hour wait or application database change occurred. A separate controlled external-invalidation test confirmed an actual sandbox refund through the original settlement engine (capture REFUNDED, refund COMPLETED, other authorization VOIDED). The refund test used a real clock and left application D1 unchanged; it was not a full application UI refund workflow.

## Shot list

### 1. 00:00–00:10 — 10 seconds

**Screen action:** Maker desk, then the generated notebook photo. Keep the fictional/sample label visible.

**On-screen caption:** Scattered interest is not permission to pay.

**English narration:** A printmaker gets scattered requests, but matching a color, budget and deadline is not the same as having an order. Batchloom makes that boundary visible.

**Evidence gate:** Use the working app, not a static mockup or invented customer story.

### 2. 00:10–00:32 — 22 seconds

**Screen action:** Press Analyze privately on the final build. Show actual loading/progress, then the real completed result. Shorten waiting transparently if needed.

**On-screen caption:** Qwen3 reads requests locally. Publishing sends approved terms and aggregate counts.

**English narration:** Qwen3 reads these synthetic requests in the browser through WebLLM. Model files download on first use. The messages are not sent to a cloud AI service, and publishing sends approved terms and aggregate counts rather than the original text.

**Evidence gate:** Record only after the final model run succeeds. Identify the actual model. If cached or time-compressed, label that explicitly.

### 3. 00:32–00:53 — 21 seconds

**Screen action:** Open one actual analyzed request and its exact source quotes. Then show one actual missing or incompatible field in the same run.

**On-screen caption:** Source words, interpretation, human review.

**English narration:** The interpretation keeps source quotations beside the values. A total budget should not become a guessed unit price, and a missing count needs clarification. Small models can still be wrong, so the maker reviews the evidence before opening a collection.

**Evidence gate:** Do not swap authored sample output under a live-model label. Use an observed result; do not claim every ambiguity or attack is caught.

### 4. 00:53–01:12 — 19 seconds

**Screen action:** Show the actual AI-derived terms, explicit maker approval, published OPEN collection and its buyer page. This newly published collection has zero reservations; do not imply it is the earlier paid test batch.

**On-screen caption:** AI-reviewed terms, human approval, then a new collection with 0 reservations.

**English narration:** The maker approves a fixed price, a twelve-unit minimum and a forty-eight-hour window. Publishing opens this new collection with zero reservations. A separate recorded sandbox run will show the payment stage.

**Evidence gate:** Use the local-model publishing flow for the raw-request privacy claim. Show a clearly future dispatch date and no invented delivery guarantee.

### 5. 01:12–01:38 — 26 seconds

**Screen action:** Switch with an explicit separate-recorded-run label to the earlier buyer sandbox test: 12 units, $288.00, consent, PayPal approval and the actual AUTHORIZED result.

**On-screen caption:** Separate sandbox run: 12 × $24.00 = $288.00 authorized, not charged.

**English narration:** In a separate recorded sandbox run, one buyer chooses twelve notebooks for two hundred and eighty-eight dollars. The buyer sees the exact amount before PayPal approval. The returned record confirms an authorization: a hold, not a completed charge.

**Evidence gate:** Use the actual verified sandbox run or a fresh verified recording. Cut credential-entry frames. Do not imply twelve separate customers.

### 6. 01:38–02:02 — 24 seconds

**Screen action:** Return to the maker collection. Show verified authorized units, press Close batch & settle, then the actual COMMITTED state and $288.00 captured record.

**On-screen caption:** Maker starts settlement. PayPal confirms $288.00 captured.

**English narration:** The maker starts settlement. The server checks the approved batch and provider records, then captures the qualifying authorization. This recorded sandbox run reached committed with two hundred and eighty-eight dollars captured. A redirect or AI summary did not create that result.

**Evidence gate:** Show actual provider-backed results, not fixture totals. Keep any edited wait labeled. Retain the sanitized authorization and capture evidence.

### 7. 02:02–02:28 — 26 seconds

**Screen action:** Show the actual six-case holdout list, then two clearly labelled controlled-test result cards: deadline void with a simulated cutoff, and external-invalidation refund recovery using the real clock. Both used actual PayPal sandbox operations in isolated ledgers, with no application D1 change. Do not present either card as application UI.

**On-screen caption:** 6 unseen cases: 4 correct, 2 held. Controlled tests: actual sandbox void and refund confirmed.

**English narration:** Six unseen synthetic cases produced four correct records and two held for review. Controlled tests confirmed actual sandbox void and refund. For recovery, a completed charge and an invalidated second hold led the original settlement engine to refund. Both tests used isolated ledgers. Only the deadline test simulated time; the application database stayed unchanged.

**Evidence gate:** Update this segment only after new evidence exists. Controlled tests must be labeled controlled tests; never relabel them as actual PayPal recovery.

### 8. 02:28–02:40 — 12 seconds

**Screen action:** Return to the buyer/maker UI. End on actual public repository and demo URLs, plus the project name and sandbox label.

**On-screen caption:** Private interpretation. Human approval. Confirmed payment records.

**English narration:** Batchloom brings considered small-batch planning together with explicit permission to pay. It is a fictional-product prototype, with a working PayPal sandbox flow and an honest record of what is confirmed.

**Evidence gate:** Replace end-card URL placeholders with tested public URLs. Do not show localhost as remote judge access.


## Caption-only track

Use these main English scene captions with the actual UI. The full narration remains separate; these highlights are not a word-aligned transcript.

- **00:00–00:10:** Scattered interest is not permission to pay.
- **00:10–00:32:** Qwen3 reads requests locally. Publishing sends approved terms and aggregate counts.
- **00:32–00:53:** Source words, interpretation, human review.
- **00:53–01:12:** AI-reviewed terms, human approval, then a new collection with 0 reservations.
- **01:12–01:38:** Separate sandbox run: 12 × $24.00 = $288.00 authorized, not charged.
- **01:38–02:02:** Maker starts settlement. PayPal confirms $288.00 captured.
- **02:02–02:28:** 6 unseen cases: 4 correct, 2 held. Controlled tests: actual sandbox void and refund confirmed.
- **02:28–02:40:** Private interpretation. Human approval. Confirmed payment records.

The optional narration above contains approximately **298 words**. Record a timed read; if it runs long, shorten the wording instead of accelerating speech beyond legibility. Keep the entire export, including opening/end cards, under three minutes.

## Recording and edit direction

- Capture real maker and buyer interaction footage. Decorative product photos can open a scene, but they do not replace a functional software demonstration.
- Record a clean browser window using only synthetic requests and sandbox identities. Exclude password entry, merchant credentials, tokens, personal email, unrelated tabs and developer dashboards that reveal secrets.
- Keep critical amounts and state labels legible. Use restrained crops or zooms of the actual footage, not reconstructed success screens.
- Show the $24.00 unit price, 12 units, $288.00 authorization, and $288.00 confirmed capture as separate facts. Do not call interest revenue or a hold a charge.
- Use a small persistent “PayPal sandbox · fictional product · no real money” label. Product photography can be captioned “AI-generated illustration.”
- If a previous verified run supplies the payment segment, label it “Recorded sandbox run.” If loading/waiting is edited out, label the time cut; do not imply instant download, inference, settlement or refunds.
- Prefer no background music, or use only material with documented permission. Avoid unrelated third-party logos or borrowed media. Keep third-party integration UI within its applicable authorized-use terms.
- Avoid a fake failure demo. If a recovery screen is based on controlled provider responses, label it explicitly and keep it distinct from the actual authorization/capture segment.
- Finish with tested public repository/demo links. Check the exported video from a signed-out browser, including YouTube embedding and captions.

## Specific scene fallbacks

**If 1.7B has no successful completed result:** do not publish the video as a completed local AI demonstration. Record the actual limitations and continue fixing/evaluating the feature. The authored illustrative sample cannot stand in for a real model run.

**If a clear result works but an ambiguous case is wrong:** show the real interpretation with the original source and explain why human review is necessary. Do not imply the app has an edit/clarification feature that is not implemented.

**If capture footage is unavailable:** use the root's sanitized actual authorization/capture evidence with an explicit recorded-run caption, plus live working buyer/maker navigation. Do not animate a fake COMMITTED badge.

**Additional recovery coverage:** the verified refund is a controlled external-invalidation harness result, not a complete application UI refund flow. Keep its real-clock scope separate from the earlier simulated-cutoff void test. Do not generalize either test into a production reliability guarantee.

## Source media inventory

Buyer design QA produced:

- artifacts/screenshots/buyer-desktop-qa.jpg — actual desktop buyer page, including amount, authorization explanation, consent and journal area.
- artifacts/screenshots/buyer-mobile-390-qa.jpg — actual 390px responsive buyer page.
- public/images/notebook-cobalt.png — original generated fictional cobalt product.
- public/images/notebook-vermilion.png — matching generated vermilion colorway.
- public/images/studio-hero.png — generated fictional studio still life.
- public/images/action-stamp.png — generated studio glyph.

Reported payment evidence is located under the task workspace:

- outputs/dual-hackathons/paypal-authorized.png
- outputs/dual-hackathons/paypal-captured-maker.png

Inspect and sanitize those payment files before public use. These paths are source material, not public URLs and not proof that a final demo video has been recorded or uploaded.

## Final factual check

Before export, compare every narration claim with the **final** app and evidence. Use the actual selected model/version and measured evaluation result, keep sandbox-only behavior explicit, and remove any statement that no longer matches the demonstrated build. Do not add a user biography, team affiliation, customer traction, revenue, savings, security score or accuracy percentage that has not been established.


## Current local assembly

The ignored video-production manifest is the authoritative current edit. The local 160-second MP4 uses actual CUA still/crop sequences and an explicitly labelled controlled-test result card. It remains marked EDITING DRAFT / NOT A FINAL SUBMISSION VIDEO. No continuous interaction recording, upload, publication or final submission is claimed. See outputs/dual-hackathons/video/PRODUCTION-QA.md under the task workspace for the source/timing handoff.

Current private review deployment: https://batchloom-studio.nununong.chatgpt.site . The end card identifies it as a private preview; public approval, source-repository URL and final upload remain pending. The local assembly remains finalReady=false.
