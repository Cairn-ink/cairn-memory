# Source-qualified recall (S6a)

Base `133d32757611c3b5224a415077d3a55bcf88a9b2`. Private dependent delivery;
security hold unchanged. This is source-support preservation, not decision
resolution, automatic slot binding, truth verification or a new memory engine.

## Acceptance

- R1: Core `fetch` and `recall` accept optional strictly boolean
  `includeQualification`. Absent/false preserve previous shapes and behavior;
  true adds `qualification` to each returned item (the existing complete bounded
  inspection DTO or null for unqualified memory). Missing support never means
  confirmed/adopted. No new model method, storage schema or authority input.
- R2: Enabled fetch includes qualification inside its counted success envelope,
  both current and explicit historical views. Bind enabled cursors to this
  option; absent/false cursors cannot cross with enabled cursors. Existing
  namespace/ref/revision/view/epoch/token rules remain. If evidence cannot fit,
  return `context_item_too_large`; never remove qualification or its anchors to
  fit. Receipt pages may omit receipts cited by qualification, but its exact
  anchor text and receipt IDs remain complete; document following get receipt
  pages and that source roles are submitted claims, not authenticated speakers.
- R3: Enabled recall carries qualification through both fetch pages, rank input
  and authoritative final output. Read it via the existing validated storage
  helper inside each fetch transaction and the final recall transaction. Keep
  current MOC candidate policy, two selection rounds/36 candidates/two fetch
  pages and 4000-page/6000-model-input/1024-output ceilings. No dropping source
  support to fit ranking; explicit context-budget failure is correct. No model
  or tokenizer callback after final authoritative read. Existing freshness and
  namespace checks cover empty/unselected output too.
- R4: Use a separate qualified-rank prompt only when enabled; preserve legacy
  prompt bytes/call framing when disabled. Tell ranker that source descriptions
  are unverified, preserve proposals/quotes/uncertainty/temporal limits, and that
  relevant considered/rejected evidence can still answer a question about it.
  No filtering by adopted as a substitute for relevance, no generated reason,
  no trusted decision/status field. Qualification does not assert current truth,
  identity, entailment, adoption or execution authorization. Coverage remains
  bounded retrieval coverage, not semantic completeness.
- R5: MCP recall accepts optional boolean includeQualification. When its
  captureQualification is configured (v1 or v2), omitted defaults true; with no
  capture configuration omitted retains legacy behavior. Explicit true works
  on a reopened keyless-configured server with an injected recall model and
  existing qualified data; false is an explicit compatibility opt-out, clearly
  documented. Namespace/owner remain server-bound, queries redacted, same tool
  counts and envelope/output limits. Inspect remains unchanged.
- R6: Independent core tests exercise proposal, quote, temporary considered
  option, unknown and unqualified records; exact labels/anchors persist in rank
  and result, including UTF-16 and anchors outside first receipt page. Verify
  strict options/cursor separation, exact budget boundaries and no silent
  omission, cross-namespace denial, source corruption, concurrent correction/
  forget, cold reopen and legacy behavior. No slots/bindings/retirement writes.
- R7: Actual SDK MCP tests verify configured v1/v2 default-on, unconfigured
  absent/explicit behavior, invalid overrides and cold behavior. Root installed
  archive probe must capture via actual v2 core+OpenAI adapter with fake parent
  HTTP, recall with qualifications in actual rank request and final envelope,
  restart and verify source equality. No real key/model, no mocked core or
  manual metadata retrofit in this installed probe. Retain source-trust label.
- R8: Root dual Node22.16/24 generic/JSON/plugin/core/OpenAI/MCP/artifact/live
  offline gates and store/recall/capture/openai-offline demos. Artifact contains
  new prompt with exact integrity manifest. Update changelog, fetch/recall and
  MCP/protocol documentation. Fixed-head independent Standards+Spec review.
  Existing paid experiment sources, operators and evidence remain frozen.

## Explicitly next, not claimed here

A recorded choice A and a challenged offline premise need a directional,
revision-bound rationale/dependency relation. Symmetric contradiction links are
not that relation. This slice must not derive needs_reconfirmation as established
state or invent choice B. It preserves the evidence available to the host, and
does not demonstrate that model-produced qualifications are semantically right.
