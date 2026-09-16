# Bounded correction of proposed rationale

Base: `3c7b9ee322a52b6af12ac169eddf1e75eea0a1f9` (`origin/main`).
Branch: `feat/rationale-reviewed-replacement`. Independent of PR139.

## Problem and sequence

Existing `reviewRationale` only unions proposals. A later empty or corrected
proposal cannot retract an earlier mistaken relationship without changing or
forgetting its source. Reliable memory needs to correct its interpretations
without falsifying original evidence. This is a correction capability, not
proof the replacement model judgment is right.

1. Add a narrowly scoped embedded correction mode with transactional tests.
2. After verification and independent review, expose an explicitly opted-in
   local MCP re-review entry point on a dependent branch, retaining namespaces,
   bounds and untrusted-evidence semantics. Do not enable automatic replacement.
3. Verify a cold-session lifecycle through that host with scripted positive and
   adversarial judgments. Real semantic evaluation remains separately bounded;
   do not repeat old failed paid runs or bypass the shared budget guard.

No production, package publication, deployment, merge, source-data repair or
new provider authorization. No schema migration, second engine or new model port.

## Acceptance for embedded slice

- RR1: `reviewRationale` accepts optional `writeMode: 'replace-reviewed'`.
  Absent retains the exact append-only contract and response shape. Any other
  explicitly supplied value rejects before model invocation. Existing optional
  `inputMode: 'claim-focus-v1'` remains compatible and independent.
  Only an own property enables the destructive mode; an inherited value/getter
  must neither enable replacement nor be read.
- RR2: Replacement scope is ONLY edges whose two endpoints both occur in the
  explicit 1–6 current, exact-namespace revision-guarded refs. Proposed edges
  remain limited to those refs and existing validated receipt indices/types.
  Preserve crossing edges, unrelated edges and other namespaces. An empty valid
  proposal removes in-scope edges; it does not retract evidence or confirm a
  decision. No model-selected deletion scope.
- RR3: Compute an exact set difference in one existing SQLite transaction;
  preserve unchanged rows. Return `writeMode`, `removed` plus the existing
  proposed/inserted/interpretationStatus/indexRevision fields in opted-in mode.
  Advance namespace epoch once iff an actual insertion/removal occurs; a repeat
  with identical proposals is a no-op. No new durable replay or edge-history
  retention is claimed. Memories, revisions, receipts, qualifications and MOC
  placement stay unchanged by link replacement.
- RR4: Existing source snapshot, receipt digest/revision and namespace epoch
  fences hold before/after all model and token callbacks and at commit. A
  concurrent graph edit with unchanged source revisions also invalidates the
  pending review. Provider failure, malformed output, timeout, invalid refs or
  post-delete insertion/degree failure leaves the operation's previous edges
  and epoch unchanged (except independently committed concurrent mutations).
  Validate in-scope existing edge revisions/receipt digests against the snapshot
  before deletion; reject corruption rather than silently repairing it. Bound
  existing-row reads using the six-reference/ten-incident-edge contract.
  Preserve the 10 incident-edge cap, budgets and no-retry behavior.
- RR5: Tests reproduce the old append-only persistence behavior, then show
  replacement removes a wrong challenge while retaining its supporting edge,
  original source records and out-of-scope links. Include empty replacement,
  identical repeat, self-support, receipt-distinct edges, cross-namespace/stale
  refs, concurrent review, malformed/failed model, late transactional rollback,
  claim-focus compatibility and actual fresh-process keyless inspection.
  State remains `unassessed` after removing the challenge, NOT confirmed.
- RR6: Update API/threat-boundary docs, automatic-loop docs and changelog so
  append-only automatic capture is distinguished from this explicit embedded
  mode. No automatic capture, MCP or HTTP behavior changes in this first slice.
  Source-bound metadata is not semantic truth or execution authority; correct
  edges can also be removed by a mistaken new model output.
- RR7: Primary inspects actual diff and runs targeted + full core, generic,
  JSON and strict plugin gates on Node22.16/24 plus store/recall demos. Independent
  Standards and Spec reviews use the same fixed candidate before push; monitor
  every latest-head CI check before marking PR ready. Continue the dependent
  host slice without waiting for user feedback unless a material decision arises.

## Ownership

One Sol/high implementation worker owns bounded runtime/test/docs changes.
Primary owns design, plan, integration and personally rerun acceptance.
Separate independent reviewers own Standards and Spec. Record findings and
corrections here or in the PR; actual agent cost is unknown unless exposed.

Primary inspection reproduced the old append-only empty-review behavior, then
required retained-row corruption checks, non-vacuous qualified/filed-memory and
foreign-graph preservation, timeout and output-counter mutation tests. A second
inspection found that reading an inherited `writeMode` could activate replacement
without an own opt-in; the worker changed only this new field's read and added
inherited-value/getter regressions. These corrections do not change capture or
legacy input-mode semantics. Targeted results and fixed-candidate independent
review evidence are recorded in the delivery PR.
