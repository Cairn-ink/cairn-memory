# Known limitations

This is the one place where Cairn Memory records what does not yet work, what
the frozen evaluations found, and which claims the evidence does not support.
The README links here from its first screen and stays short. A PR that adds or
revises evidence appends to or edits this file rather than the README; see
[CONTRIBUTING](../CONTRIBUTING.md#where-to-record-evaluation-limitations).

The section below is the text that opened the README until 2026-09-18, moved
here unchanged apart from link paths and the bold lead-in becoming this section's heading.

## Preview, not a quality guarantee

The optional [Python reference sidecar](official-reference-rendering.md)
preserves number/array rendering from original JSON for official-style judging.
It is evaluator-only and requires an independently pinned sidecar digest.
Hash/capability checks bind reviewed artifacts; they do not authenticate the
corpus or prove a model was called. Without that opt-in binding, non-string
references still remain unresolved. No public accuracy result follows from
these synthetic compatibility tests.

The [offline public comparison](public-longmemeval-comparison.md) and
[official-style scoring adapter](official-longmemeval-scoring.md) provide
synthetic plumbing, not measured accuracy. The three arms now retain source
dates and Cairn uses source receipts rather than generated summaries. Capture
itself is still source-time-unaware. Context counts are caller estimates, not
proof of a provider's context-window fit. The default scorer verifies string
references only; numeric/array references require the opt-in bound Python
sidecar above or remain unresolved. A complete
protocol record does not prove that a real provider ran. Dataset exposure,
configuration freeze, guarded transport and independently reviewed paid results
remain separate gates; no competitor comparison or promotion readiness follows.

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

Prepared LongMemEval v1 histories exposed raw session-ID labels to ingestion
and answer evidence, and legacy turn IDs depended on those labels. A source
session ID could itself encode an answer or abstention. Preparation v2 blinds
that metadata and makes turn identities label-independent, with an offline
synthetic preparation → local-core comparison → scoring regression. Old v1
artifacts must be regenerated, not counted as blinded. This repair does not
scrub exact source prose, prove public benchmark quality, or revise retained
historical results.

## Classification count limit: pilot halted before scoring

The [P3 pilot report](https://github.com/Cairn-ink/cairn-memory/issues/180#issuecomment-5751116229)
records 67 provider requests, USD0.335 reserved, and no answer or judge requests.
The first case stopped during classification and the second never started;
common resolved N is zero, not a measured zero-percent accuracy. These failures
and their reservations must remain visible in any subsequent experiment.

The run's `a31f9d9` classification path sends a token-bounded MOC catalog page
and at most five target memories, not all stored memory bodies. The ordinary
OpenAI adapter also has a 6,000-token local-input limit and a 7,024-token
provider-input limit; these are not only benchmark guard settings. The provider
request includes the dynamic output schema as well as instructions and input.
The benchmark guard can turn a count-response rejection into an unknown
outcome and a paid-work halt; the ordinary adapter's own oversize check refuses
generation with `context_budget_exceeded`.

Classification runs after admission. A failed classification can therefore leave
retained current memories unfiled; a successful top-level capture envelope is
not proof of successful filing. The MCP/Hermes bridge passes this nested status
through rather than turning it into a host-wide halt. The classification call
currently reads one catalog page, with no public continuation for that private
catalog cursor; an incomplete map cannot propose new topics. These are product
boundaries to test separately from the pilot's whole-run stop policy.

The rejected provider response and its exact token count were not retained.
Database size and a matching synthetic rejection do not establish that the
historical response exceeded the token ceiling. Neither a deterministic repeat
at batch 16 nor failure of all seven cases has been demonstrated. See the
[bounded diagnosis plan](plans/classification-count-diagnostics.md). A later
[benchmark-only guard diagnostic](plans/guard-count-reason.md) can retain a
finite reason and exact structurally validated count in private attempt
accounting, but it is not retroactive and does not recover this response or
resolve its cause. No budget increase, automatic retry, successful score or
historical count is implied.

## Where the evidence lives

- [Semantic evaluation](semantic-evaluation.md)
- [Paired update-reliability experiment](evidence/qualified-comparison.md)
- [Source-support pilot results](../evaluations/results/source-support-v1.json)
- [Source-only context](source-evidence-context.md)
- [Integration inventory](source-reliability-integration.md)
- [First live evidence](evidence/first-live-evidence.md)
- [ROADMAP](../ROADMAP.md): the gates that must pass before broad promotion.
