# Initial capture classification journal (bounded S1 slice)

Fixed base: `632c0d8b1ad0e79ea5c9ccc8c4bbfee022d8ab9b` (PR #211).
Branch: `feat/capture-classification-journal`. Implementation owner: GPT-6
Sol/high; primary owns architecture, acceptance and independent review.
This contract precedes implementation. It does not declare S1 complete.

## Decision and scope

Keep one bounded, source-free journal row for the initial classification of
each newly captured admission batch. Do not use a memory's latest filing or
another batch's outcome as evidence that this initial attempt succeeded.
One deduplicated memory may belong to several batches. Explicit general-ref
classification recovery remains separate and cannot rewrite initial outcomes.
This is durable observation, not a task queue, automatic retry or batch replay.

Use the existing embedded store, with a real v13-to-v14 migration. No second
engine or database service. New private capture admission paths create the row;
old admissions and public manual finish do not invent initial attempts.
No provider calls, paid evaluation, real ledger edits, production data, merge,
publication, deployment, old-cohort rerun or semantic score is in this packet.
Whole-capture deadlines and durable explicit-recovery attempts remain later work.

## Observable acceptance

- CJ1 — Atomic admission: ordinary, source-qualified, staged and ordered new
  captures commit completed admission and their initial journal in one existing
  transaction. A journal-write failure rolls back admission and related source
  receipts/ordered transitions. Empty admission records `skipped_empty`;
  nonempty starts `not_started`. Duplicate/processing capture never creates,
  replaces or reruns the initial attempt. Manual finish and migrated claims
  stay unknown. No model call occurs in a transaction.
- CJ2 — Bounded initial attempt: before interpretation, persist
  `in_flight_or_interrupted` with an internal attempt token and revision guards
  for at most five admitted members. Closed terminal statuses are `applied`,
  `skipped_already_filed`, `failed`, and `skipped_empty`. Missing model, invalid
  model output and model timeout can record `failed`, but a crash/inability to
  persist failure must remain incomplete, never inferred failed/successful.
  Persist no content, receipts, prompts, provider errors, outputs or error text.
  Tokens and stored revision guards are private and are never inspection refs.
  There is at most one row per claim, not an append-only attempt history. Total
  rows can grow with admitted batches; do not claim constant total storage.
- CJ3 — Atomic placement: a private trusted completion hook, not a public
  caller-controlled applyPlacement field, verifies token and current guards
  and commits `applied` inside the SAME placement transaction, including its
  early no-op return. Store final member revisions after filing changes, and
  retain unchanged member guards for a mixed batch. A journal failure rolls
  back changed placement. Empty parent lists may be `applied` while memories
  remain unfiled; neither status means semantic quality or whole capture
  completion. A later terminal/failure write cannot overwrite a terminal
  success or a successor token. Cleanup cannot mask the original model error.
- CJ4 — Honest cold inspection: `core.inspectAdmission` accepts optional
  boolean `includeInitialClassification`. Omitted/false preserves the exact
  existing response, including overall `classification:{status:'unknown'}`.
  True adds only `initialClassification:{status:<closed enum>}`. Unknown covers
  absent/pending/manual/legacy records and any changed, deleted, historical,
  missing or foreign bound member. Inspect journal, admission and member state
  in the existing single read transaction, with no model, writes, clock/lease
  changes or replay. A valid old attempt cannot certify corrected content.
  Malformed persisted guards/status fail closed, not silently certify success.
  Fresh actionable refs still come ONLY from existing `members`; never return
  old revisions, tokens, digests or source text from the journal. An in-flight
  status explicitly does not distinguish a running process from a crash.
- CJ5 — Public integration: existing opt-in MCP `inspect_capture_admission`
  accepts the same strict optional flag, with fixed server namespace/client.
  No new tool, no default inventory change, and no permission in model-provided
  arguments. `classify_unfiled_memories` does not mutate this journal, even for
  an initially failed batch or a successful no-op on the same revision.
  Actual SDK and installed-artifact tests cover cold read, failed versus
  applied-but-unfiled, and unchanged sources. Capture response and duplicate
  response shapes remain compatible; new proof is via the opt-in read view.
- CJ6 — Migration and lifecycle: v13 data and every already-supported upgrade
  path upgrade transactionally to v14, preserving identities, receipts,
  generations, claims and existing evidence. Legacy claims have no fabricated
  outcomes. Reject future/unsupported schemas, and document that older open
  processes must stop before upgrade; this does not retroactively fence them.
  Correction/forget/supersession and independent placement/recovery invalidate
  stale journal applicability by exact fresh member-revision/current checks.
  No operation recreates sources or reverses suppression. Rollback tests cover
  failed migration plus admission and placement journaling failure.

## Required observable tests

Cold reopen after committed admission but before classification, during a
paused classifier, after failure, after successful empty-parent no-op, and after
real filing. Verify mixed already-filed/unfiled members; empty extraction;
deduplication within and across batches; successful independent recovery not
rewriting the initial failure; invalid configuration/flags; manual admissions
and actual old-format migration unknown; sibling-project and personal/project
isolation; forged persisted foreign member refs; corrected, forgotten and
superseded refs; late classifier success/failure after these mutations; two
instances/concurrent batches; injected transactional journal-write failure;
no source text/token/ref leakage in read view. Inspect actual DB and receipts,
not just returned strings, and preserve default behavior assertions.

## Entrypoints, ownership and gates

Implementation allowlist: core capture/contract/runtime/admission/MOC storage,
new classification-journal storage/schema modules, database migration wiring;
new focused core tests plus existing tests whose schema version assertions or
strict option expectations change; MCP server and focused SDK test; focused
installed-artifact test; technical docs (capture, admission claims, local
store, standalone MCP, protocol, limitations, this plan), CHANGELOG and two
glossary terms in CONTEXT. A short ADR may record initial-attempt attribution
if the domain-modeling criteria warrant it. Do not rewrite historical plans
as if this had always been implemented. No other shared-file changes without
primary rescoping; no dependency, prompt, query, evaluator or ledger changes.

Trace public capture -> private validated admission -> journal -> classification
-> atomic placement; ordered/staged paths and failure cleanup are dependent
callers. Trace core read -> exact namespace -> MCP -> installed archive.
Root must inspect actual final diff and personally rerun key integration paths.
Run focused tests before full gates on Node 22.16.0 and 24.15.0: generic tests,
JSON, strict plugin validation, core, MCP, installed artifact, store/MOC/capture/
admission/history demos. Since shared core capture changes, also run offline
live-evidence and LongMemEval tests plus ingestion/public comparison demos,
and request-guard tests to detect shared call behavior regressions. No provider
keys are needed. Independent Standards and Spec review the exact committed
full-base diff. Final-head CI must pass before ready; no merge is authorized.

Implementation starts only after prior PR #212's exact-head CI passes. Next
S1 work is bounded interruption/recovery semantics and a whole-capture
deadline, followed by newly frozen development smoke tests; this journal alone
cannot establish improved accuracy or completion on real-model tasks.
