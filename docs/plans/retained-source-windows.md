# Indexed retained source windows: bounded core experiment

Fixed base: `330ecb13555832003015c5850905860903bfacc4` (PR #218 candidate).
Branch: `feat/retained-source-windows`. Primary owns this contract and acceptance;
GPT-6 Sol/high owns implementation. Preparation may proceed now; implementation
starts only after this dependency's primary gates, both independent reviews and
exact-head CI pass. No merge, release, deployment or paid call is included.

## Goal and decision

The product goal remains a lightweight reliable memory layer usable by Hermes,
MCP and other harnesses through one shared core. Separate source retention from
candidate discovery: navigation cannot recover evidence that was never retained.
Default capture exposes up to 4,000 normalized UTF-16 units per message to the
extractor, but binds a selected message to its first 800 units. The v2 qualified
path instead exposes only that retained prefix. Neither behavior establishes
that the relevant passage survives. This is a structural boundary, not a proven
cause of any historical wrong answer.

Before promoting a MOC navigation change, test an optional source-window path
through the actual core: the host prepares bounded passages, the extractor
selects their indices, and the host binds exact source receipts. Keep bounded
storage and provenance rather than storing a full transcript or inventing
source positions. This packet proves mechanics on new synthetic data only.
MOC navigation, semantic entailment and matched Mem0 scoring remain separate.

## Frozen acceptance

- W1 Opt-in boundary: accept only the own, snapshotted constructor option
  `captureSourcePolicy: 'indexed-windows-v1'`, and only with
  `captureQualification: 'source-bound-v2'`. Reject invalid/explicit-undefined
  values and combinations with `captureEvidence` or `captureRationale` before
  database creation or model work. Omitted/inherited policy preserves existing
  v1/v2 behavior, prompts, digests and result shapes byte-for-byte. Do not add
  an MCP/native/host profile flag in this packet or promote the default.
- W2 Trusted catalog: normalize/redact using the existing capture snapshot
  first. Tile each canonical message deterministically in source order into
  non-overlapping passages of at most 800 UTF-16 units, never splitting a
  surrogate pair. Use no overlap, query-conditioned choice or model offsets.
  A catalog entry privately binds global index, original message index/identity,
  role, normalized start/end and exact canonical excerpt. Trim boundary spaces
  with corresponding offset adjustment; never fabricate a raw-text offset.
  Validate the final excerpt is an exact canonical-message slice and is already
  a fixed point of receipt canonicalization. If a nonempty passage cannot be
  represented honestly, reject before claim/model rather than changing text or
  silently claiming complete retention. Existing message/batch limits stay
  4,000/20,000 units and 24 messages; cap the derived catalog at 64 entries.
- W3 Model boundary: use a distinct prompt stating these are untrusted partial
  source windows and that selecting an index proves neither entailment, truth,
  adoption nor permission. Send only bounded index/message-group index/role/text
  descriptors, never client/session/event IDs, digests, namespaces, target labels
  or evaluator answers. Continue the existing `extract` model port and five-item,
  600-unit content limits. Each item selects one to four unique catalog indices.
  The host resolves identity/text from its immutable catalog, not model output.
  Preserve speaker, negation, uncertainty and source conditions; if sufficient
  support needs more than four windows, narrow or omit rather than add neighbors.
  Existing exact call-model input/output/deadline limits remain authoritative;
  overflow is an honest failure, never an automatic split, retry or limit raise.
- W4 Receipt and qualification binding: resolve selected windows to the original
  trusted client/session/message identity and exact bounded excerpt. Keep the
  existing receipt schema, four-receipt limit and v2 qualification compiler.
  Reject duplicate canonical receipt identities even when two distinct catalog
  indices would produce them; do not shift qualification anchors by silently
  deduplicating. Receipt-local anchor offsets stay local. Catalog offsets are
  transient derivation metadata, not newly persisted or claimed raw-source
  offsets; stored receipts identify the original message and retained passage.
  Do not add a transcript archive or a storage migration.
- W5 Replay/state safety: bind the new policy and segmentation version into a
  new opt-in payload digest domain while leaving legacy digest bytes unchanged.
  Same-event policy/content changes conflict; changed unselected text still
  changes the digest. Empty, processing and cold duplicate behavior remains
  honest and does not issue another model call. Preserve namespace, correction,
  forget/suppression, transaction and invocation-deadline fences. For ordered
  v2 capture, map selected windows back to original source-message indices and
  preserve `qualification_requires_identity` / no automatic retirement; do not
  introduce new semantic reconciliation authority.
- W6 Coverage disclosure: an opt-in successful response may carry only bounded
  `sourceWindowCatalog` metadata: version 1, maxUnitsPerWindow 800, messageCount,
  windowCount, semanticCoverage `unassessed`. It describes the submitted source
  view, not how an earlier duplicate was executed, full retention or relevance.
  Do not also emit the old prefix-only `retainedSourceWindow` claim for this
  policy. Failure envelopes contain no success/coverage metadata. No source
  text, offsets, IDs or secrets in diagnostics beyond the normal authorized
  model input and stored selected receipts.
- W7 Synthetic regressions: first retain a default/v2 prefix control with a
  useful fact after unit 800; then prove the opt-in actual capture → admission →
  qualification → cold get/source recall path can retain the selected tail
  passage with original role/identity. This is scripted selection, not semantic
  accuracy. Cover 799/800/801/4,000 boundaries, Unicode/surrogates, NFKC, whitespace,
  redaction, boundary-spanning support requiring two windows, nonadjacent
  antecedent/response, repeated identical passage ambiguity, mixed speakers,
  invalid/duplicate/foreign indices, five receipts, malformed later item atomic
  rejection, source/caller/model/counter mutation, exact duplicate/conflicting
  replay, cold restart, ordered unresolved behavior, correction/forget, namespace
  isolation and deadline-before-admission. Expected labels never enter a model
  request. At least one new test must fail against the old core at the actual
  tail-source capture seam, not merely a pure helper.
- W8 Honest integration: update the inspected archive file allowlist for any
  runtime helper/prompt dependency. Installed synthetic core tests must exercise
  the opt-in path; no provider or user data. Document that staged evidence,
  rationale integration and public benchmark verification are unsupported:
  the existing public comparison verifies the exact first-800 prefix and must
  reject incompatible window receipts. Do not relax that verifier or count an
  old result as windowed. Later scored use needs its own versioned provenance
  contract, frozen fixtures/roster, guards and independent review.

## Allowed files and exclusions

Allowed: this plan; `core/contract.mjs`, `core/capture.mjs`,
`core/capture-input.mjs`; one focused `core/source-windows.mjs` helper if useful;
one `core/prompts/extract-source-windows.md` prompt; focused new tests under
`core/test/` and `packaging/test/`; `packaging/artifact-files.json` for required
runtime dependencies only; technical `docs/retained-source-windows.md`, a narrow
privacy/boundary addition in `docs/protocol.md`, `docs/limitations.md`, and
`CHANGELOG.md`. No existing failures removed, model/price/default changes,
storage schema change, provider/ledger/scorer/host changes, source corpus use,
historical case reruns, npm publication or new dependency.

If the existing v2/ordered interfaces cannot satisfy these constraints, worker
reports the exact mismatch to primary before widening files or semantics.

## Verification and delivery

Trace changed constructor/capture/model/receipt/qualification/ordered entrypoints
and installed consumers; record every affected test and its owner. Worker and
primary run the focused tests, full core and applicable capture/admission/
recall/qualification regressions, generic tests, JSON and isolated locked strict
plugin validation on Node 22.16 and 24.15. Follow CONTRIBUTING's artifact gate:
install isolated adapter dependencies, prepare the metadata cache, then run the
actual installed artifact suite on both runtimes using synthetic temporary data.
No network model call is authorized by those commands. Freeze the candidate;
independent Standards and Spec review the same complete fixed-base diff; correct,
reverify and rereview before a dependent PR and all exact-head CI checks.

Completion of W1–W8 means a bounded optional source-binding mechanism works in
the tested paths, not that memory is semantically reliable or S2–S5 passed.
Next: separately version benchmark/source verification and measure source-window
and navigation effects at matched budgets on fresh development/holdout cases.
Preserve the six-case smoke and original ledger unchanged; no new API spending.

## Evidence and resume

Planning only. Dependency acceptance and worker implementation are pending.
At resume check the base PR's exact head/CI, this worktree's status, and the
latest evidence. Never infer a paid run is unlaunched from a missing report.
The prior six-case run is terminal and must not be retried.
