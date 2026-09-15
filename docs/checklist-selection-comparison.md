# Fresh checklist selection comparison (frozen protocol)

This protocol tests a selection change, not a new memory engine or a proven
reliability improvement. The [prior multi-window result](multi-window-fidelity-results.md)
lost seven required passages during navigation selection and one at ranking;
complete-source answers also mishandled changed reasons. Both problems remain
visible, but this comparison changes only selection.

## Cases and controls

The fixture contains three authored matched pairs in fresh domains: a community
board-game evening, puzzle-club meeting rooms, and local-history exhibit labels.
Each history has three windows of five user statements and one assistant
suggestion, with independent incidental details between relevant statements.
Within each pair only one user sentence changes provisional versus committed
status, while the question stays identical. These are not six independent
samples or an external benchmark.

The source-ID rubric separates original reasons, later changes, continuing
advantages, time scope, other actors and genuinely absent approval information.
It is evaluation-only and must never enter model input. A condition, suggestion
or another person's choice must not become a user commitment. A failed reason
does not imply an abandoned decision; absence of an approving person's name
does not authorize inventing one.

## Operator choreography

Reuse `runMultiWindowFidelity` unchanged for one capture per window, closed/reopened
staged/admitted inspection, explicit small-set snapshot attempt, ordinary recall
and baseline/canonical-control answers. No old fixture, sampled answer or
experiment is edited. Each history has one fresh synthetic namespace/store.

The operator adds a separately labelled comparison alongside that report:

1. On the final read phase, perform baseline recall and checklist recall once
   each against the same captured store. Alternate their order by history index.
   The checklist client uses `createChecklistSelectionModel`; the baseline uses
   the original adapter. Keep capture, classification, rank, model, question,
   source-evidence mode, limit6, navigation rounds and context limits unchanged.
2. Preserve raw MCP responses and method traces for both calls. Candidate source
   projections must match exact namespace, active memory revision, complete
   receipt identities and excerpts in the final admitted inspection before
   becoming answer input. Missing or malformed projections remain failures,
   not partial contexts. Do not label stored-current evidence as applicable-now.
3. Keep the original driver report intact. Record candidate recall, coverage and
   answer in a sidecar with six preallocated slots, including failed/not-run
   slots. When the driver invokes its retrieved-answer callback, alternate
   baseline/checklist answer order; return only the baseline answer to the driver.
   Its canonical-control answer remains a constructed full-history diagnostic,
   never a rescue of missing retrieved sources.
4. Both retrieved answer arms receive the unchanged baseline answer instruction
   and flat `{ question, sources }` representation. Preserve actual input/output,
   token/byte counts and guarded round-trip latency. Exact source presence is not
   a semantic answer score. If the candidate fails, do not replace its slot with
   the baseline or control, retry, or invent a new capture batch.

Use the existing MCP server/client and core factories with experimental wrapper
injection. A source-based launcher may use actual stdio child processes, recording
which processes and database handles close/reopen. This is not a published
package or ordinary installed CLI accepting a new selector flag; it does not
prove natural ChatGPT/Claude tool invocation. Do not create another retrieval
engine or copy model-generated summaries into authoritative source evidence.

## Safety, freeze and failure gates

The model stays `gpt-4.1-mini-2025-04-14`. The operator must pin source, fixture,
rubric, compiler, schema, instruction, launcher, operator and grant identities
before paid execution. The existing US$50 campaign stays cumulative. This run
is limited to US$3 conservative reservations,400 HTTP requests and18 answers,
including input counts, failed requests and the six constructed controls.
Require enough existing headroom; unknown costs are not free or invoices.

The selection-only grant cannot authorize baseline capture/rank or host calls.
Those retain existing separately scoped guards on the same serialized ledger.
Real provider credentials stay in the parent; child processes receive only an
authenticated loopback token. Verify pins and accounting before every send.
Transport, pin or accounting failures stop new sends, preserve denominators and
settle attempts conservatively. Cleanup failures are retained independently.

Before real issuance/execution, rehearse success, invalid checklist, source
failure, transport interruption, malformed answer and cleanup failure with fake
services. Review the exact operator independently. Fixture compatibility tests
alone do not replace those gates or authorize a paid request.

## Decision rule

Report measured active counts (not assumed from messages), required-source
coverage at admission/selection/rank/final receipt, qualifiers, explicitly labelled
irrelevant exposure, invalid output, abstention, answer errors, context size,
latency and conservative/known/unknown cost separately. Only actual stage traces
can localize an omission; the selector's checklist is not a completeness score.

Do not promote a candidate that loses previously retained evidence, merely adds
unrelated material, or does not improve premise coverage within the same bounds.
Review answer currentness separately: full-source mistakes cannot be attributed
solely to retrieval. Passing this authored sample would still not establish
general accuracy, production reliability, lower cost or adoption.

The operator and paid result remain unfinished. See the
[acceptance plan](plans/checklist-selection-comparison.md).
