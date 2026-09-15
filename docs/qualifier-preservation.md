# Qualifier preservation: a diagnostic, not a reliability score

The earlier [everyday-history experiment](everyday-history-results.md) retained
useful source context but one answer strengthened “for now” into a “final”
decision. Storing a quote does not guarantee a host will preserve its meaning.
This protocol separates three possible losses before changing the memory engine
or tuning a prompt around a known answer.

Six fresh everyday scenarios each have two matched four-message histories.
Only one user sentence changes between the pair: provisional/conditional versus
explicit commitment. The decisive qualifier appears once. Source inputs and
questions are separate from the human-readable scoring rubric. This is authored
development evidence, not an independent blind holdout or twelve independent
samples. Existing failed experiments and scores remain unchanged.

## What the comparison can tell us

For each history, capture once, close and reopen the store, inspect the staged
view and admitted receipts separately, then retrieve ordinary source evidence.
The answer consumer receives either retrieved sources or the complete canonical
four-message source control under the same question and instructions. Neither
input contains expected answers or rubric labels. The complete-source arm is an
experimental control, not a fabricated memory receipt or a new recall mode.
Both callback inputs carry the unchanged `SOURCE_ANSWER_INSTRUCTION` from the
existing source-answer consumer. Arm metadata identifies experimental routing;
it must not select a different answer prompt in a later installed operator.

| Observation | Question to investigate |
| --- | --- |
| Staged source has the qualifier; admitted receipts do not | Did capture omit necessary evidence? |
| Admitted receipts have the qualifier; retrieved sources do not | Did selection or ranking lose necessary context? |
| Retrieved sources have the qualifier; answer strengthens it | Did answer consumption amplify commitment? |
| Complete-source control also strengthens it | Is answer generation a problem even without retrieval loss? |

These observations locate hypotheses, not causal proof from one sampled answer.
Failures remain in all twelve history slots and twenty-four answer slots. Failed
capture cannot be rescued by silently feeding staged text into ordinary recall.
A complete-source control answer may be generated independently, but it never
turns a failed capture/retrieval into a successful memory-system outcome.
Likewise, admission can succeed while classification fails: the report retains
that separate error without pretending the saved memory was lost or the entire
capture workflow succeeded.

Exact source/qualifier coverage is mechanical evidence only. Generated answers
remain unassessed until separate review checks commitment amplification,
attribution, invented reasons and lost temporal limits. A word match is not a
semantic correctness score. Any observed amplification prevents a blanket claim
that qualifiers are preserved reliably.

## Execution boundaries

The first implementation is an injected offline driver with real-core/scripted
tests. It neither discovers credentials nor calls a model service. It is not
evidence of installed MCP execution, natural host tool selection, or real-model
quality. Fixtures, rubric and first-attempt reports must be pinned before a
later installed experiment; do not repair a fixture or regenerate an answer
after seeing a scored failure.

See the [acceptance plan](plans/qualifier-preservation.md) for callback contracts,
verification gates and the proposed bounded future experiment. No new retention
default, retry mechanism, source promotion, provider budget or release is created
by this diagnostic. Source text and remembered consent remain untrusted data,
never execution authority.
