# Known limitations

This is the one place where Cairn Memory records what does not yet work, what
the frozen evaluations found, and which claims the evidence does not support.
The README links here from its first screen and stays short. A PR that adds or
revises evidence appends to or edits this file rather than the README; see
[CONTRIBUTING](../CONTRIBUTING.md#where-to-record-evaluation-limitations).

The section below is the text that opened the README until 2026-09-18, moved
here unchanged apart from link paths and the bold lead-in becoming this section's heading.

## Preview, not a quality guarantee

An installed subprocess has passed a real
model-backed remember → restart → sourced recall → forget loop. The frozen
semantic evaluation still fails source support: an extractor sometimes turns
“uses a language” into “is implemented using it.” [All retained results](https://github.com/Cairn-ink/cairn-memory/pull/23)
remain visible. This is synthetic evidence, not a competitor benchmark or a
claim that real users save a measured amount of time.

An explicitly selected [experimental extraction profile](plans/extraction-model-profile.md)
passed the frozen synthetic gate after independent agent review. The default
model's failure remains; MCP does not automatically enable the experimental
profile, which is a programmatic adapter option. MCP `remember_memory` saves
explicit content directly; it does not run that extractor. Those extraction
scores therefore do not certify the MCP recall experience.

The [paired update-reliability experiment](evidence/qualified-comparison.md)
also remains failed: the experimental source-ordered capture path can retire an
unchanged fact or another person's still-valid preference. A source receipt and
model-declared update labels are not a truth guarantee. This is separate from
the MCP tools' explicit remember/correct operations; no automatic transcript
capture or new quality certification is implied.

The latest [eight-case source-support pilot](../evaluations/results/source-support-v1.json)
stored and recalled all ten records but still showed false adoption and lost
uncertainty. Optional [source-only context](source-evidence-context.md)
separates retained passages from generated interpretations; it does not certify
source completeness or downstream answers. The
[integration inventory](source-reliability-integration.md) distinguishes
shipped security work, developer-preview changes and unfinished reliability goals.

## Verified preview baseline is not a semantic benchmark

The [consolidation baseline](plans/pr-consolidation.md) combines a narrow
filing-only rationale preservation fix, a bounded direct premise-challenge
read fix extracted from #136, an explicit local MCP source-evidence recall
startup default, provider response-byte ownership, and an installed cold-recall
regression. These are engineering and offline regression checks.
They do not show that proposed rationale is correct, that source selection is
complete, or that an answer faithfully uses the retained evidence. The larger
rationale lifecycle in #142 and the remaining #136 branch, as well as later
experimental assessment paths, were not adopted as a whole; their code and
prior failures remain in archived branches and evidence.

There is no measured LongMemEval score for this combined candidate. A public,
reproducible benchmark needs a frozen dataset and scoring protocol, declared
model/configuration and comparison arms, retained per-case failures, and an
independent review before any quality claim. Offline ingestion/comparison demos
exercise mechanics with scripted models; they are not that measurement. No
paid evaluation or broad promotion is authorized by this consolidation.

The [comparative reliability plan](plans/comparative-reliability-milestones.md)
preserves the audited 30-case pilot: Cairn had 15 correct, 8 wrong and 7
unresolved; full history had 19 correct, 8 wrong and 3 unresolved. That small
fixed-N cohort is neither a competing-product comparison nor a newly measured
score. The plan's MemPalace figures are retrieval-only, project-reported metrics
with a different scorer and denominator; they cannot establish answer accuracy
or product parity for Cairn. The old cases remain read-only for stage tracing.

The earlier fixed-six development smoke completed and was judged 6/6 in each
arm, but completion is not semantic quality: Cairn was 2 correct, 4 wrong,
0 unresolved; full history 3/3/0; and no memory 0/6/0. A later R5 run stopped
before scoring: seven requests, US$0.035 conservatively reserved, zero scored
and six unresolved cases per arm. That is not a 0% accuracy result. The global
halt followed an observed indexed count of 8,701 exceeding the 7,024 bounded
dispatch limit. A separate earlier prefix-capture record is labeled
`invalid_model_output` / `ingestion_incomplete`; no subreason or model output
was retained, so that prefix failure's exact cause is unknown. The consumed
roster and prior cohorts must not be retried; the separately reserved 30-case
set remains untouched. The audited 30-case result remains 15/8/7 and was not
rerun.

An earlier offline budget-boundary control through the real core, adapter and
fake-HTTP guard produced one pass and one red on each of Node 22.16 and 24.15.
In each of four source turns, source text length increased from 113 to 114
UTF-16 units; for the 114-unit fixture, local partial preflight counted 2,379
while full wire serialization was 7,032. This established an analogous
schema-budget gap, not an explanation of R5's distinct global halt or prefix
failure. PR #230 later passed its bounded repair gates. PR #231's separate
source-free failure-diagnostics candidate passed reviews, local dual-Node gates
and exact-head CI run `36125459749` (21/21); it was open, mergeable and unmerged
at the last check. These mechanics do not establish provider-exact usage or
semantic evidence.

The current primary read-only accounting audit recorded 12,646 terminal
requests, US$86.236460 conservatively reserved and zero pending. The user
ceiling remains US$200; the operational cap was atomically extended from
US$100 to US$200 with a 50,000-request cap. The separate embedding-ledger
migration is not complete. Preserve at least US$70 for comparator work and
US$10 for host work; the audit does not authorize a new call.

Using PR #230's accepted runtime, before PR #231's remote CI completed, a
separate installed-compatibility check passed count, generation and core
compilation on three fixed synthetic shapes (1×1, 4×4 and 5×1). Local
serialized estimates were 1,929, 4,680 and 4,987; provider-validated counts
were 1,526, 3,434 and 3,476. It made six requests, reserved
US$0.030000, recorded US$0.005377 known actual cost, left three count-route
costs unknown, and had zero pending requests. Its source-free report SHA-256 is
`b75dcea6bb317adc988c846f6493a5703ca536b702b17d7f88aef0796b6d119f`; runtime
`5ec4793` and the pinned installed-source set were used. This is narrow
compatibility evidence only—not QA, recall, judging, a semantic score or a
quality improvement. No consumed or earlier cohort was rerun.

Recent synthetic work also includes a Mem0 fake-HTTP preflight, optional
indexed-window capture mechanics and an existing-only embedding-ledger
migration. None is a matched answer-quality comparison, semantic improvement,
installed-growth result or onboarding pass. PR #220's synthetic guard
regression is denial-only; no new paid capability or paid request is
established. Indexed windows leave the default first-prefix behavior unchanged
and do not prove that a model selects or answers correctly from a later
passage. With PR #231's remote CI and acceptance gates closed, the next step is
operator-only preparation for a separately frozen fresh six-case development
run: one case per type and fixed seed, excluding 124 used or reserved cases.
Its 30-case reserve stays untouched, and no old cohort is retried. Before any
run, recheck the frozen plan, accepted source-free diagnostics, installed
inputs and budget gates; cap this allocation at US$29.935 (29,935,000
micro-USD), protecting at least US$70 for comparator work and US$10 for host
work. S2 answer-stage quality, S3
matched comparison, S4 installed growth and S5 cold-context onboarding remain
open. This documentation update makes no provider call; see the [current
milestone checkpoint](plans/comparative-reliability-milestones.md).

## Where the evidence lives

- [Semantic evaluation](semantic-evaluation.md)
- [Paired update-reliability experiment](evidence/qualified-comparison.md)
- [Source-support pilot results](../evaluations/results/source-support-v1.json)
- [Source-only context](source-evidence-context.md)
- [Integration inventory](source-reliability-integration.md)
- [First live evidence](evidence/first-live-evidence.md)
- [ROADMAP](../ROADMAP.md): the gates that must pass before broad promotion.
