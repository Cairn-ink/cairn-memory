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
The [public benchmark design protocol](plans/public-benchmark-protocol.md)
inventories the missing live harness and freezes proposed measurement rules;
it is not an executable run manifest or a result.

## Where the evidence lives

- [Semantic evaluation](semantic-evaluation.md)
- [Paired update-reliability experiment](evidence/qualified-comparison.md)
- [Source-support pilot results](../evaluations/results/source-support-v1.json)
- [Source-only context](source-evidence-context.md)
- [Integration inventory](source-reliability-integration.md)
- [First live evidence](evidence/first-live-evidence.md)
- [ROADMAP](../ROADMAP.md): the gates that must pass before broad promotion.
