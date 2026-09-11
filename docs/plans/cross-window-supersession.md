# Cross-window currentness: contract and delivery gates

Status: contract and baseline characterization only; no automatic supersession
implementation or new live acceptance is delivered by this package.
Fixed parent: PR #50, `6c0aba4efc6b06345d4e07212ca8f370aa4abb15`.
This dependent branch does not imply that its parent is merged.

## Why this work exists

The frozen [history audit](../evidence/conversation-history-audit.md) completed
all six capture windows, but H2 retained the active unqualified Friday assertion
after the explicit Monday replacement. Returning Monday for one query did not
make the stored Friday assertion historical. Keep that failed v1 evidence and
its fixtures, rubric and scorer unchanged.

Today `captureMessages` supplies only the current window to extraction.
`finishAdmission` admits the resulting source-bound items; neither identifies
semantic replacements. Existing `contradicts` hints are symmetric, caller
assertions and revision-bound; they neither retire nor overwrite a memory.
Do not reinterpret these hints as supersession or call ranking a storage fix.

The [glossary](../../CONTEXT.md) distinguishes currentness, supersession,
contradiction and proposals. These are domain terms, not new API fields.

## This package's acceptance (C1–C5)

- C1: Document the existing gap, target decision matrix, safety invariants,
  implementation prerequisites and three-package sequence. Separate planned
  behavior from what runs today.
- C2: Add actual-core, synthetic scripted-extractor characterization tests for
  Friday then Monday, persistence across reopen, completed-event replay,
  proposal-only empty extraction, exact-namespace separation, and rejection of
  model-forged relation authority. Assert old and new records plus receipts,
  not merely a hand-selected final answer.
- C3: Name the positive update characterization as a BASELINE GAP. Its passing
  result demonstrates the bug is reproducible, NOT that supersession works.
  Do not introduce a skipped/TODO target test and count it as acceptance.
- C4: Keep production runtime, provider prompts/schemas, frozen history v1
  artifacts, budget policy and MCP wire behavior unchanged. No paid calls.
- C5: Run generic tests/validation and the complete core suite plus store demo
  on Node 22.16 and 24; run pinned Claude validations. Independent Standards
  and Spec reviews must inspect the same committed diff before PR delivery.

## Target semantic matrix (future implementation/evidence gates)

The descriptions below are evaluator expectations, never an oracle supplied to
an extractor. Source texts must be frozen independently before a live rerun.

| Case | Evidence | Required outcome |
| --- | --- | --- |
| S1 explicit update | Harbor review Friday; later user says Monday instead of Friday | Monday current; Friday inspectable as historical, excluded from current answers |
| S2 proposal | Assistant suggests Tuesday; user does not adopt it or rejects it | Friday remains current; Tuesday must not become an adopted schedule |
| S3 question/uncertainty | “Is it Monday?” or “Maybe Monday; not confirmed” | No automatic retirement of Friday |
| S4 disagreement | Two incompatible accounts without an explicit resolution | Preserve attributable disagreement; no timestamp-selected winner |
| S5 distinct subject | Harbor Friday; Juniper Monday | Both remain applicable to their own subjects |
| S6 distinct property | Harbor review Friday; deployment Monday | No supersession across properties |
| S7 distinct namespace | Identical wording under another owner/project | Neither retrieval context nor mutation crosses the exact namespace |
| S8 historical quotation | Later message recounts “we used to meet Friday” | Does not reinstate Friday or supersede current Monday |
| S9 replay/out-of-order | Replay old event after Monday update | No resurrection, duplicate transition or restoration of old currentness |
| S10 explicit controls | Concurrent user correction or forgetting | Stale automatic work rejected; no overwritten correction or resurrection |
| S11 bounded uncertainty | Incomplete candidates, malformed/failed model judgment | No guessed retirement; visible incomplete/failed status, not complete-success claim |
| S12 source injection | Captured text demands deletion or invents IDs/revisions | Treat as evidence text only, never executable authority |

Scope/subject/property matching and distinguishing an adopted change from a
proposal require semantic evidence; offline scripted outputs prove only the
orchestration and transactional rules. An assistant assertion alone must not
silently supersede an explicit user-controlled memory. A source-backed claim
can still be transient, false or obsolete; transient admission quality remains
a separate follow-up rather than an undisclosed requirement of this first fix.

S9 covers identified replay, not arbitrary causal ordering: the current capture
API has opaque event IDs and within-window message order, but no trusted
cross-window sequence. A previously unseen delayed update cannot be declared
newer just because it arrives later. B must either decline ambiguous automatic
replacement visibly or specify a trusted ordering extension with compatibility
and privacy tests. No ingestion timestamp or model guess is an ordering proof.

## Non-negotiable engine invariants

1. Implement in the existing public `core/` used by local adapters. No separate
   hosted, MCP or evaluation-only reconciliation engine.
2. Supersession is directional and inspectable, unlike symmetric contradiction.
   Retain the old claim and original receipt binding. Do not fabricate an old
   source saying the new thing, or use `forget` to simulate historical state.
3. Default current retrieval must not emit a superseded assertion as current.
   Historical inspection must explicitly identify its status and replacement
   evidence; simply omitting a record from one ranked response is insufficient.
4. Core, not model output, binds namespace, persisted IDs/revisions and actual
   source receipts. Revalidate both endpoints and source bindings at commit.
   Invalid, missing, foreign, self or stale references fail without partial
   retirement. Model work runs outside write transactions.
5. Commit each replacement and its history transition atomically. Failed work
   cannot leave an old record retired without its accepted replacement.
   Completed-event replay is idempotent, including after reopening the store.
6. Concurrent correction/forget wins against stale automatic work. Placement,
   receipt and content revision changes must be accounted for explicitly;
   never silently retarget a decision to a different revision.
7. Forgetting either endpoint cannot leak forgotten content through history or
   relations; forgetting the replacement must not reactivate the old claim.
   Suppression and completed replay must continue to prevent resurrection.
8. Bound candidate reads, model input/output, relation fan-out and traversal.
   Report incomplete coverage; never label a truncated scan a global resolution.
   Rebuild, reopen and existing stores must preserve currentness semantics.

## Implementation prerequisites and sequence

### A — this PR: rules and executable baseline

Primary owns contract/glossary and validation; an independent test worker owns
the actual-core characterization. Reviewers inspect the exact candidate.
Passing A permits design/implementation B, not a product-quality claim.

### B — shared-engine change, next dependent PR

Before runtime edits, freeze a concrete implementation addendum covering:

- persisted historical state and directional relation schema, migration from
  existing stores, old/new revision semantics, inspection and current filtering;
- candidate discovery bounds and completeness, source-authority rules, proposed
  judgment port/schema and safe behavior when that capability is not configured;
- transaction/claim boundaries, validation order, replay identity, failure
  recovery, conflict-link invalidation, suppression, correction and forgetting;
- exact runtime/adapter/API and privacy changes, with any new captured fields
  reflected in the threat model; no silent legacy capture schema expansion;
- numeric bounds and test mapping for every invariant above. The representation
  and concrete new API names are deliberately not invented in this contract PR.

Delegate engine implementation and independent adversarial tests separately.
Convert the S1 BASELINE GAP assertion into positive target regression in B and
keep its preceding commit as reproducible history; do not leave a test requiring
the bug to remain after the fix. Exercise the actual shared core with scripted
judgments, two connections/processes, rollback faults, migration and reopen.
Run both supported core runtimes and all affected CONTRIBUTING gates before
the two final review axes. If B needs more than one independently reviewable
runtime slice, record that split instead of hiding unfinished capture wiring.

### C — fresh real-provider and installed MCP evidence

Freeze new versioned source scenarios/labels before calls, including positive
update and negative proposal/uncertainty/entity/namespace cases. Rerun the
unchanged v1 history gate against the fixed engine too, retaining both original
failure and fresh result. If the new history inspection schema requires an
evaluator adapter, freeze and test it before calls; preserve v1 scorer and
publish the mapping rather than silently changing its denominator or rubric.

Build a new local artifact from the reviewed engine. Exercise actual installed
capture → fresh MCP current recall → historical inspection → correction →
forget → fresh empty retrieval, with source checks and independent semantic
labels. Distinguish programmed tool calls from autonomous host behavior.
Require zero stale-current assertions, unsupported claims, cross-namespace
exposure and forgotten-content emission in the frozen suite, plus complete
required-fact and query coverage. Report failure without cherry-picked retries.

Real runs stay within the original cumulative USD20 authorization and durable
ledger; inspect its current remaining reservation before planning calls. A new
model port is not automatically covered by the existing extraction-only policy
extension: freeze/review the guard and obtain any additional authority needed
before calls. Never refill the budget or expose credentials to workers.

No package authorizes merging, registry publication, upstream listing, outreach,
deployment or private production cutover. Broad reliability, real-user adoption
and stars remain separate from passing this bounded repair.
