# Retained-source extraction (S6c)

Base `de47f02d58bbacff49a94b312d71a37f5a4e0d0d`. Private dependent work,
no paid run, security disclosure hold unchanged. The fixed v2 pilot exposed an
anaphor whose extracted expansion lacked its antecedent receipt. Separately,
extractor input can include4000 units/message but retained receipts only800.
Align available evidence before assessing new model quality; do not claim a
prompt or successful source mapping mechanically proves entailment.

## Acceptance

- P1: Preserve the complete normalized capture snapshot, IDs, message ordering,
  limits, mode binding and payload digest. For source-bound-v2 only, derive one
  detached source view before claiming/model work. Each content is exactly
  boundedText(boundedText(fullContent,800,true),800,true), matching final
  canonical receipt retention, with original IDs/roles/indices. Legacy and v1
  retain previous extractor input, prompt bytes and response shapes.
- P2: V2 extractor sees only that view's index/role/content, never omitted tails
  or trusted IDs. Use the SAME view to construct selected receipts. Do not
  reconstruct from the longer full message or silently add neighbors. Same
  extract method, limits, token accounting, no new call, no source reindexing.
  Malformed source view fails finitely before claim; no fallback to tail text.
- P3: Separate v2 extraction prompt requires all selected sources necessary to
  support a standalone paraphrase, including antecedents when expanding that/
  it/上述/它 and quotation/negation/uncertainty/temporal scope. Cite both source
  and response where needed. If evidence is absent or needs more than four
  source messages, narrow to a supported claim or omit; no guessed context.
  Existing zero-to-five outputs, strict source indices, secret handling and
  untrusted-data/authority rules remain. This is guidance, not an entailment gate.
- P4: Each successful v2 capture response, including empty/processing/duplicate
  and ordered duplicate, carries retainedSourceWindow:
  {maxUnitsPerMessage:800,truncatedMessageIndices:[original indices]}.
  Compute indices by full normalized content differing from retained view.
  It describes source-retention coverage of the submitted snapshot, NOT model
  execution history, all-conversation coverage, truth or source sufficiency.
  Old v2 duplicate batches may have been extracted with longer inputs; the
  unchanged digest does not attest their execution policy. Do not reread old
  receipts or introduce a persistence schema just to fabricate such an attestation.
  Failed captures keep existing error envelopes. No user-supplied window override.
- P5: Full-tail changes still conflict with existing event digest even when
  visible prefixes match. Capture/model input mutation cannot change the saved
  view. Cold duplicate replay needs no model/key and produces identical window
  metadata. Ordered nonempty output remains unresolved without trusted identity;
  no binding/retirement/reconciliation grant. Empty extraction skips qualification.
- P6: Independent tests cover tails absent from extract/qualification/receipts,
  exact 800 UTF-16 and astral-boundary/whitespace/NFKC/redaction alignment,
  reversed/nonadjacent source indices with exact antecedent+response receipts,
  no auto-neighbors/tail fallback, invalid indices/whole-batch atomicity,
  processing/empty/duplicate/ordered/cold paths, snapshot/digest safety, and
  unchanged legacy/v1 behavior. If an unreachable proposed edge is discovered,
  document why; do not fabricate fixture behavior or relax source validation.
- P7: Actual SDK MCP forwards retainedSourceWindow for v2 only and rejects
  caller overrides. Root installed actual core+adapter+MCP fake-HTTP probe sees
  prefix-only extract input, selected exact receipts, qualified recall and cold
  replay; omitted tail is reported and never sent. Update artifact integrity
  allowlist for the new prompt; existing paid fixtures/operators/results frozen.
- P8: Root dualNode22.16/24 generic/JSON/plugin/core/OpenAI/MCP/artifact/live-offline
  and store/capture/openai-offline demos pass. Update changelog, capture/MCP and
  protocol documentation. Fixed-head independent Standards+Spec before delivery.

## Tradeoffs and remaining work

V2 deliberately cannot extract tail-only facts from omitted source text. Larger
receipts, configurable windows or selecting other spans change retention and
budgeting and are not silently included. Source-window coverage must be reported,
not marketed as full-conversation memory. All-null qualification, attribution
interpretation, rationale dependency and real-user usefulness remain separately
unproven. Old failures are not retried or rescored.

Inspection ruled out the proposed public-input edge of a redaction-only prefix
followed by hidden whitespace and a tail: captureSnapshot collapses whitespace
and rejects exact `[REDACTED]` before window derivation. Tests do not fabricate
an unreachable snapshot; source-view errors still fail finitely before claim.
