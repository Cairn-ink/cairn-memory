# Bounded augmentation: fresh comparison protocol

This tests the [offline candidate](bounded-selection-augmentation.md), not a
production switch. Earlier checklist and multi-window failures remain retained.
The previous read-only padding analysis demonstrated candidate eligibility only;
this comparison must observe actual selection, ranking and final answers.

## Cases and fixed controls

Use three new authored matched pairs: bookbinding materials, balcony plant
markers, and a Traditional Chinese sketching-group supply choice. Each history
has three windows of five user statements and one assistant suggestion. Only one
user sentence varies within each pair, distinguishing provisional from committed
status. Questions remain identical within pairs. Required passages are spread
across windows, with domain-word distractors and no convenient final recap.

The separate rubric identifies required and irrelevant source IDs, the decisive
qualifier, actors, reasons and time limits. These annotations are never model
input. Human review must distinguish changed premises from changed decisions,
reaffirmed reasons from obsolete ones, another person's choice from the user's,
and missing approval from authority to act. One Chinese pair is a small probe,
not a multilingual benchmark or a population accuracy estimate.

Reuse `runMultiWindowFidelity` unchanged for staged capture, classification,
cold inspection, ordinary recall and the original retrieved/control answer
slots. Preserve this report. An operator adds six separate augmentation slots;
it never overwrites a baseline failure, re-captures a history or retries an arm.

Both recall arms use the same store, with order alternating by history. The
candidate injects `createAugmentedSelectionModel`; everything else stays fixed:
`gpt-4.1-mini-2025-04-14`, extraction, qualification, classification, query,
navigation rounds, rank limit6, source-evidence context and output budgets.
The candidate still invokes the ordinary selector once. No checklist method or
grant is involved. Empty seeds remain empty, and any expanded rank-input
overflow remains a failure rather than widening the ceiling.

Before either retrieved answer, validate source projections against final cold
inspection: exact namespace, active memory revision, full receipt identities,
roles and excerpts. Every answer receives the unchanged
`SOURCE_ANSWER_INSTRUCTION` and `{question,sources}` representation. The
canonical-control arm receives all authored sources; it is a constructed
diagnostic, not retrieved context and not a rescue. Alternate retrieved answer
order too; preserve actual requests and raw responses for every arm.

## Execution boundary

Use actual MCP stdio server/client factories with the experimental injected
wrapper. Record distinct processes and cold reopen/cleanup events. This remains
source-based experimental MCP execution: it does not establish installed CLI
support, natural host tool choice, published-package readiness or user adoption.
Real credentials stay only in the parent. Children receive authenticated
loopback tokens, never the provider key or evaluation rubric.

Freeze source and installed dependency bytes, fixture, rubric, instructions,
wrapper, operator, launcher and existing guard identities before paid requests.
Independently review the exact operator. Rehearse success, malformed original
selection, source failure, transport interruption, malformed answer and cleanup
failure using fake HTTP and separate synthetic ledgers. Compatibility tests
alone do not substitute for this rehearsal or authorize provider calls.

Use the existing cumulative US$50 campaign, not a reset ledger. This fresh run
has a US$3 conservative reservation ceiling,400 HTTP attempts and18 answer
requests, including input counts, failed attempts and constructed controls.
Require sufficient conservative headroom before starting. Recheck pins and
accounting before each send; transport, pin or accounting failures halt new
sends. Preserve failed/not-run slots, unknown usage and cleanup failures. Never
retry or regenerate a frozen failed case to improve the result.

## Decision rule and reporting

For each arm, report required-source retention separately at admission, visible
map, selected candidates, rank and final receipts. Padding preserves original
selection, but the ranker can still displace it: report every original required
source lost after augmentation. Count predefined irrelevant candidate exposure
separately from irrelevant passages actually returned to the answer model.
Do not equate unlabelled passages with irrelevant ones.

Review all18 answers, including full-source controls, for commitment strength,
changed versus continuing reasons, scope, actors, unsupported certainty and
unnecessary abstention. Report concrete errors rather than an aggregate accuracy
claim for three authored pairs. A citation or exact quote is not proof that its
conclusion applies now. Full-source failures cannot be blamed solely on recall.

Report empty seeds, invalid output and budget failures alongside bytes, tokens,
guarded latency, total attempts, conservative reservation and known/unknown
estimated usage. More evidence is not automatically a lighter or better product.
Do not promote if final required evidence regresses, additions merely expose
noise, resource limits fail or answer fidelity worsens. Even a positive result
would still need broader unseen histories and installed/natural-host validation.

This package freezes a protocol only. It changes no production default, real
grant or ledger, publishes no package and performs no deployment. Acceptance:
[comparison plan](plans/augmentation-comparison.md).

Subsequent [once-only results](augmentation-results.md) retain the failed baseline
arm and candidate regressions. The candidate is not promoted; this link does not
change the frozen protocol used for execution.
