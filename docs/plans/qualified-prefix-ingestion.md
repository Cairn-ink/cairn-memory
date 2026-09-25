# Qualified-prefix ingestion control

## Purpose and fixed boundary

This is the control-path prerequisite for a later qualified-prefix versus
indexed-window comparison. Both paths must use source-bound-v2 qualification;
otherwise changing qualification and source exposure together would not isolate
the window treatment. This packet is offline ingestion, not a scored comparison.

Fixed base: `3cc9fbea0f3d26e886223dfc6b2b86ce34635e5d` (PR #222).
Worktree: `qualified-prefix-ingestion`; branch `test/qualified-prefix-ingestion`.
Primary owns the contract and acceptance; one GPT-6 Sol/high worker implements.
Independent Standards and Spec review the full original-base diff at final HEAD.

## Acceptance

### Q1 — Separate named entrypoints

Add `planQualifiedPrefixLongMemEvalCase` and
`ingestQualifiedPrefixLongMemEvalCase` in the existing ingestion module, with
schema `cairn-longmemeval-qualified-prefix-ingestion-plan-v1`.
Their option shapes match their existing counterparts exactly, without a
caller-selectable arbitrary policy. Plan explicitly records
`captureQualification: 'source-bound-v2'` and the evaluation label
`captureSourcePolicy: 'retained-prefix-v1'`; that label is NOT passed as a core
constructor or snapshot source policy. Legacy and indexed exports, accepted
shapes, identities, errors and serialized plans stay unchanged.

### Q2 — Actual canonical plan and digest

Reuse the exact legacy raw partition, batch/client/message/event/session IDs
and source map. Recompute every batch using actual
`captureSnapshot(input, 'source-bound-v2')` and `retainedSourceView(snapshot)`.
Keep full normalized messages in normalizedCapture with the real v3 digest;
retain detached canonical `retainedMessages` and `retainedSourceWindow` in the
private plan. No hand-built equivalent digest, rebatching, injected dates,
fallback to the legacy digest or truncation of the full capture input.
The first-800 retained view is the treatment, not full-source coverage.

A qualified preflight/retained-view failure adds finite
`qualified_prefix_preflight_failed` with batchIndex and makes the whole plan
nonexecutable. Preserve a valid qualified snapshot digest if only retained-view
construction failed; otherwise digest is null, never legacy. No capture callback
runs for a nonexecutable plan. Existing raw blockers remain intact.

### Q3 — Closed response metadata

Every successful response form (processing, duplicate, completed empty/applied,
and partial classification failure) requires exactly the planned
`retainedSourceWindow`, with exactly maxUnitsPerMessage and
truncatedMessageIndices. The latter is a dense ordered integer array equal to
the host-derived indices, not merely plausible/in-range. Preserve metadata in
classified outcomes and nested success result where applicable. Do not accept
sourceWindowCatalog, extra fields, missing metadata, mixed policies or a caller
claim that an unqualified capture is qualified. Failure responses retain their
existing closed shape and cannot attach success metadata.

Use a small closed internal metadata mode if sharing the response classifier;
never loosen existing legacy/indexed checks to accommodate the new mode.
Capture failure/throw/unknown/partial stops the current ingestion without retry;
later planned batches remain not_run. Freeze all caller data and callback
references before the first await, matching the existing denominator contract.

### Q4 — Observable synthetic tests

Use real local source-bound-v2 core capture and synthetic stores/scripted
models to show completed, duplicate, empty, and partial outcomes. A mixed-role
long message must retain exactly canonical prefix receipt text; changing only
its omitted tail changes full payloadDigest but not the retained prefix.
Exercise NFKC/redaction/whitespace, surrogate boundary and malformed Unicode.
Compare identical raw partitions/IDs/maps across all three planners, and
distinct actual core digest domains. Test every response form and metadata
mutation above, failure shapes, zero callbacks for preflight failure, caller
mutation across await, fixed outcomes and no retry. Legacy and indexed paths
must reject the qualified-prefix metadata, and the new path must reject theirs.

Pin at least one full legacy and one indexed plan SHA from the fixed base,
independently computed by the primary; existing golden tests alone must not
silently redefine the compatibility baseline. No live provider, key, downloaded
corpus, actual budget ledger or hidden evaluator labels are used.

### Q5 — Verification and delivery

On Node 22.16.0 and 24.15.0: focused tests, full `test:longmemeval`,
`test:live-evidence-offline`, `test:experiment-request-guard`, `npm test`, all
three LongMemEval demos, `npm run validate`, verified local Claude Code 2.1.260
and `npm run validate --prefix tools/plugin-validation`, plus diff hygiene.
Read CONTRIBUTING and current CI before final checks. Primary inspects the
actual full diff, reproduces the original qualified-ingestion mismatch, and
reruns key full gates. Commit locally, then separate full-base Standards/Spec;
fixes require rerun on the new final candidate. Push a dependent PR against
`test/indexed-window-provenance` only after local acceptance; all exact-head
remote CI must pass before marking ready. No merge, release or deployment.

## Scope and remaining gates

Allowed implementation: ingestion module, focused ingestion tests, technical
ingestion documentation, CHANGELOG and limitations. No public-comparison,
official-scoring, core/default, adapter, host, storage, dependencies, paid guard,
ledger, models/prices or paid calls. Changes to this frozen contract require a
primary decision before implementation, not an implicit worker expansion.

The later two-arm runner/scorer and per-arm accounting fence are separate
requirements. Neither this control nor indexed provenance demonstrates better
answer quality. No old six/30-case run may be retried or relabeled. Fresh matched
scoring, Mem0 comparison, installed growth and onboarding remain open. The
cumulative user ceiling remains US$200; this packet spends none on model APIs.
