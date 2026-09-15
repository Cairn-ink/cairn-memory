# Multi-window fidelity beyond small snapshots

The [first qualifier experiment](qualifier-preservation-results.md) lost required
sources in selection/ranking and strengthened some commitments even with complete
source input. The shared engine now offers a
[bounded admitted-source snapshot](bounded-source-snapshot.md), but that explicit
operation stops at twelve memories. It cannot establish useful memory behavior
for longer histories simply by rejecting an oversized set safely.

This new diagnostic separates those questions. Three authored scenario pairs
each span three capture windows, with distractors, changing reasons and one
decisive qualifier that is not repeated in a final recap. Each window contains
five user statements and one assistant suggestion. Fifteen user statements are
not assumed to become fifteen memories: admission may omit or consolidate them.
The report must measure actual active memory count; a history at twelve or fewer
does not demonstrate beyond-cap behavior. These are three paired development
cases, not six independent samples or an external benchmark.

## Observable boundaries

For each window the injected driver captures once, closes the writer and inspects
staged/admitted source after reopening. Inspection is evaluation evidence only;
it is not fed back into ordinary recall. An operational failure stops further
capture in that history without removing its remaining report slots. A separate
classification error stays visible even when source admission succeeded.

After the final successful cold inspection, the driver requests the bounded
snapshot once and ordinary source-evidence recall once. Expected rejection above
the snapshot cap is a safety observation, not an answer or a quality pass. Actual
recall is evaluated against source identities and exact passages, not generated
memory summaries. Failure and partial output cannot silently become complete
answer context.

Two answer inputs use the unchanged baseline instructions and question:

- Ordinary recalled source passages.
- The complete canonical submitted history, explicitly a constructed control.

Both are untrusted source data. The control cannot rescue a failed memory path.
No expected answer, paired-variant label or required-source list enters a model
request. Mechanical coverage and generated-answer semantics remain separate.
Semantic review must check changed premises without inventing a changed decision,
preserve conditions and time scope, distinguish actors, and avoid inventing reasons.

There is no new quotation-only API here: existing MCP source-evidence responses
already return exact excerpts. Displaying those excerpts separately from generated
explanation may be useful in a host, but does not certify the explanation or
justify building another retrieval engine.

## Evidence status and later execution

This package is an offline-verifiable diagnostic, not a new real-provider result,
installed-host acceptance, semantic repair or launch-readiness claim. It changes
no existing experiment, prompt, model default or runtime behavior.

A later installed operator must freeze artifact and protocol hashes, retain actual
selection/ranking traces, and rehearse failures before making any paid request.
Only those traces can localize a recall omission beyond the admission boundary;
missing instrumentation must be reported as unlocalized. Context size, latency,
request counts, conservative cost reservations and failures are separate outcomes
from answer fidelity. No failure is retried out of the denominator.

See the [acceptance plan](plans/multi-window-fidelity.md) for exact limits and the
proposed per-run cap inside the existing cumulative campaign. Passing these mocks
does not authorize publication, deployment or a broad reliability claim.
