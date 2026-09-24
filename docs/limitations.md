# Known limitations

This is the one place where Cairn Memory records what does not yet work, what
the frozen evaluations found, and which claims the evidence does not support.
The README links here from its first screen and stays short. A PR that adds or
revises evidence appends to or edits this file rather than the README; see
[CONTRIBUTING](../CONTRIBUTING.md#where-to-record-evaluation-limitations).

The section below is the text that opened the README until 2026-09-18, moved
here unchanged apart from link paths and the bold lead-in becoming this section's heading.

## Preview, not a quality guarantee

The [offline synthetic evidence-lineage harness](plans/synthetic-evidence-lineage.md)
uses scripted model callbacks and fresh temporary stores to show where fixed
source receipts stop moving through capture, recall and answer packing. It adds
no quality score and measures no semantic accuracy. A source-to-receipt link
does not prove that the needed fact, qualification or meaning was retained.
An unobserved downstream stage is unknown, including when classification
failure stops the public comparison before recall. The harness cannot diagnose
the historical eight wrong questions or support a product reliability claim.
Its small capture-based fixtures do not test candidate discovery beyond the
index scan prefix. A separate direct-admit synthetic capacity diagnostic put
1,025 current unfiled memories in one namespace; a query for the memory beyond
the first 1,024 scanned IDs was not visible in two map pages and recall reported
`budget_exhausted`. After one different low-ID memory was forgotten, the same
target became visible and returned with 1,024 current rows. This demonstrates
a scan-prefix boundary, not a diagnosis of past wrong answers. A positive
beyond-prefix regression is needed before changing candidate retrieval.

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

The private public-pilot loader defaults to seven prepared cases. Its explicit
`--max-prepared-cases` opt-in can raise only that manifest-count ceiling, up to
500; it neither enlarges the fixed artifact byte limits nor proves that a
larger cohort fits them. It also grants no monetary or request authority and
does not establish benchmark quality. Current coverage is synthetic and
offline; any paid larger-cohort run remains separately gated.

The public-comparison provenance adapter previously expected only capture's
first 800-unit normalized source prefix. When that prefix ended in whitespace,
admission's existing second canonicalization trimmed it before storage and the
adapter incorrectly blocked the exact stored receipt. The adapter now derives
the same single canonical form as capture plus admission while retaining exact
identity, role, source-map and excerpt equality. This is an evaluation-adapter
repair, not a storage migration, recall improvement, semantic-quality result or
reason to revise any retained historical outcome.

The experimental answer-template v2 only moves the quoted evidence before a
separate final current question/date in the private evaluation request. Its
synthetic tests establish request, identity, resume, and merge mechanics—not
better instruction following or answer quality. V1 and v2 scores are distinct
protocols and must not be compared as though the request were unchanged.

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

## Capture-admission diagnostics are prospective mechanics, not coverage

Fresh private public-pilot diagnostics can distinguish a completed empty
capture, suppression, admitted references, an exact duplicate, a capture
failure and admission followed by classification failure. This observation is
prospective. An old completed batch did not retain this observation or the
receipts needed to determine retroactively which submitted messages extraction
omitted; absence of the new subsection is unavailable evidence, not a measured
zero. This does not erase separately retained failure evidence.

`admittedReferenceCount` counts references accepted by the core. It is not a
new-memory count: content deduplication may return an existing memory. It is
also not retained-message or source coverage: partial extraction can omit
messages despite a nonzero count, and stage `admitted` can accompany zero
references. The diagnostic says nothing about semantic quality, answer quality
or whether a source claim is true.

The private observation retains at most 64 primitive-only rows per case, counts
overflow and marks malformed response projections unavailable. It retains no
source text or identifiers and does not enter ordinary comparison output,
scoring, aggregates or the redacted report. Qualified deduplication attaches to
an existing memory only for identical resolved source anchors. A changed source
identity intentionally fails with `qualification_conflict`; the observer does
not turn that immutable provenance boundary into a successful attach. No source
archive, staging default, retry or source-bound-v2 benchmark switch is added.

## Historical extraction rejection remains unattributed

Three retained cohort failures are categorized as
`invalid_extraction_source_range`, but the offending indices and provider
objects are unavailable. The optional OpenAI adapter now limits its outgoing
extract schema to the current canonical message indices, closing a demonstrated
request-schema gap in synthetic fake-HTTP tests. This does not identify why the
three earlier requests failed, repair an invalid historical output, prevent
semantic misinterpretation, or establish a new benchmark result. Core still
rejects invalid and duplicate references independently. See the
[bounded repair plan](plans/extraction-source-domain.md).

The retained six-case public pilot records one legacy `invalid_extraction`
event, but not the rejected extraction object or provider response. Its exact
validation branch is therefore unproven. Prospective fixed extraction reasons
can distinguish shape, text/value and source-selection checks without retaining
returned values or indices; they cannot refine that old event, repair the old
case or justify a paid retry. This is an observability change, not evidence of
better extraction, recall or answer quality.

## Recall-stage observations are mechanics, not retrieval quality

Fresh private public-pilot diagnostics can prospectively distinguish visible
map items followed by empty model selection, selected/fetched candidates followed
by empty model ranking, and final ranked candidates omitted by whole-item answer
packing. Old pilot artifacts did not retain these stage observations and cannot
be reconstructed from storage counts or final `candidateCount`; absence is
unavailable evidence, not an observed zero.

Selection and rank counts describe bounded adapter-returned shapes before core
validates membership, duplicates, freshness, namespace limits and output
budgets. They are not counts of accepted, relevant or correct memories. Final
`candidateCount` remains post-core-ranking output, and `selectedCount` remains
answer-packed items. Likewise, core `budget_exhausted` means map/fetch traversal
did not prove completion under its bounds; it is not evidence that the experiment
spent its monetary/request allowance or exhausted provider tokens, and it does
not explain why a model returned no refs.

The private observation contains only bounded counts, booleans, ordinals,
closed status enums and overflow state. It retains no question, source, label,
answer or identifier and no source-derived hash; identifiers used to count
unique model-returned refs remain transient. Malformed fields are null/unavailable,
late settlements are ignored after case close, and the subsection never enters
comparison output, scoring, aggregates or the redacted report. These mechanics
do not establish answer quality, semantic recall, source sufficiency or a fix
for any historical result.

## Complementary ranking is an unscored prompt candidate

The explicit source-evidence rank prompt now asks one existing rank call to
preserve complementary directly relevant evidence for multi-part, temporal and
changed-reason questions. Offline actual-core tests show that complete retained
receipts reach that call and valid selected references survive the unchanged
final read. Scripted outputs do not establish that a provider will select those
references, improve answers or resist source-embedded instructions.

The twelve-case public fixture is wholly synthetic and its expectations are
kept outside model input. The exact prior prompt is retained for a future paired
comparison; no paid call or semantic score is included here. Earlier examples
where rank reduced several selected references to one only motivate the
hypothesis. They do not prove ranking caused the missing answer evidence, that
the selected sources were necessary, or that this candidate repairs an old
LongMemEval result.

The candidate does not change navigation, the 120-unit query-aware selector
label, map/fetch traversal, caps, token budgets, current-only ordinary recall or
answer synthesis. Required evidence can therefore remain outside the rank pool,
the fixed result limit can still exclude it, additional context can add noise,
and a final answer can still misread perfectly retained source. See the
[candidate description](source-coverage-ranking.md).

## Source-aware candidate navigation is a bounded literal heuristic

Explicit `source-evidence` and `rationale-evidence` recall can now use at most
the first four stable-ID receipt excerpts of each eligible current memory as
private select-label features. This improves literal reachability when a
generated interpretation omits query words, but it is not semantic retrieval,
source completeness or answer-quality evidence. Whole Unicode letter/number
runs still do not handle paraphrases, stemming, synonyms or dictionary-style
CJK segmentation. A useful match in receipt five or later remains invisible to
candidate scoring in a crowded store, although complete fetched sources are
still returned if some other feature selects that memory. Stable receipt-ID
order is deterministic, not chronological.

Internally, explicit source mode reads and scores up to four retained excerpts
of 800 UTF-16 units per eligible memory within the existing 1,024-current-memory
scan. The supplied selector receives only the winning 120-code-point preview for
each candidate packed into the existing at-most-100-item, 4,000-token page over
at most two rounds, not those four full excerpts, receipt IDs or source metadata.
Each candidate receipt must first pass the same authoritative stored identity,
memory binding, role, canonical-excerpt and receipt-key validation as final source
output; corruption fails before selector invocation, including empty selection.
That preview still widens opt-in personal-data exposure. It does not widen
namespace authority or affect default recall and automatic rationale discovery;
public maps and the classification topic catalog remain unchanged. Existing
freshness checks stop later use or finalization after a valid mutation, but data
already sent in a begun model request cannot be withdrawn retroactively.

Synthetic actual-core tests demonstrate bounded page visibility, including one
offline run with the pinned local tokenizer. A post-hoc development replay over
already exposed copied stores moved one previously absent target onto the first
candidate page while preserving two targets that were already visible; an
explicit visibility oracle could then fetch and finalize them. This does not
measure model selection, answer quality or a benchmark score. Neither probe
measures provider token accounting, latency or total SQLite page I/O. The row
and excerpt limits describe returned SQL rows and core scoring work only.

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

The opt-in local MCP `classify_unfiled_memories` tool can explicitly place
retained current unfiled references under core revision guards. It is a general
placement action, not verification of a failed capture batch. The accompanying
keyless `inspect_capture_admission` can now recover committed batch membership
from an existing admission claim after a lost response, with fresh current refs
and a bounded suppression count. It reports classification as unknown even for
empty or fully filed membership, and closed historical/deleted members have no
actionable refs. It does not recover source text or infer missing extracted
items. A v14 opt-in read can now report the exact initial capture attempt's
bounded, source-free journal status after a cold restart. It can distinguish
failed from an applied no-op that left members unfiled; it cannot certify model
quality, current filing, later explicit recovery or whether an in-flight
attempt is still running. A changed, deleted, historical, missing or foreign
original member makes that initial status unknown. Manual and older batches
also remain unknown. There is no persistent retry queue or durable history of
later classification attempts. By default, a whole capture may run several
separately bounded model stages, so it has no single 30-second deadline. Trusted
embedded callers can configure an opt-in monotonic `captureDeadlineMs` of 1–120000
for the whole invocation. It does not preempt synchronous SQLite or token
accounting mid-instruction, guarantee a wall-clock return bound, or change
native Hermes/MCP defaults. Before admission it fails with `model_timeout`;
after admission it preserves receipts and reports downstream failure. This
mechanical boundary does not establish semantic quality or repair older cases.
Concurrent explicit requests
may duplicate provider work. Stale guards prevent a second conflicting change,
but no-op proposals can both succeed. An applied empty-parent proposal can
remain unfiled and be classified again by another explicit call. These limits
leave S1 incomplete and do not repair or rerun any historical pilot result.

The optional OpenAI adapter now requires the response array length to equal
the distinct target count for zero through five classification targets, and
rejects duplicate or oversized direct target lists before HTTP. Core still
validates exact target coverage, including repeated IDs, after the model call.
This prospective schema constraint does not reconstruct the pilot's rejected
response or establish its cause. It does not change that pilot's partial result,
stop policy or score denominators.

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

The optional OpenAI adapter now compresses repeated classification target/MOC
UUIDs into request-local role-separated wire aliases and decodes validated
references before core/storage. Offline fixed fixtures and a separately replayed
copy show material local-token and byte reduction with the same visible
candidate/card/MOC content, but local tokenizer measurements are not provider
counts. Aliases do not hide personal content, titles or metadata, do not solve
arbitrary catalog growth or source-support quality, and do not recover the
historical count or prove its cause. The 6,000/7,024/1,024 limits, incomplete-map
behavior and benchmark halt policy remain. Any paid rerun still requires a
frozen, independently reviewed candidate and separate authorization.

## Public pilot v2: halted before scoring

The [retained v2 halted-run record](plans/public-pilot-v2-halted-results.md)
preserves a prospectively frozen seven-slot roster, the first-six packet and
the conditional seventh slot. The run stopped in the first packet: `fixedN=6`,
one generation wrapper was written, five following cases were blocked during
generation, all six were blocked during scoring, and `commonN=0`. Every arm's
accuracy is `null`, not zero percent; there is no v2 score.

The wrapper's one generated case is not a successful Cairn result. Batches 0–4
completed, batch 5 failed during extraction, and batches 6–50 were not run.
The Cairn arm is `ingestion_incomplete` within the one completed generation
wrapper; full-history and no-memory are `answer_failed` because the halt guard
prevented answer work. No answer or judge request was made. Admission
reference counts in the private diagnostics are not semantic source coverage,
extracted unique-unit counts or verified truth.

The safe audited packet contains 22 unique requests (11 count and 11
generation), 110,000 micro-USD reserved, 12,037 micro-USD of known actual
usage that is incomplete billing, and 12 requests with unknown billing. The
observed `core_call/model_timeout` and `adapter/model_cancelled` labels do not
identify a provider, network, HTTP or model-quality cause, and no fix is
claimed. No automatic retry or new session is implied, and a longer timeout is
not a proven remedy.

Optional `bounded-v1` transport milestones can localize a future synthetic
case-deadline attempt to fetch wait versus response-body wait at the guard.
They cannot distinguish provider processing from network buffering or prove
provider cancellation, billing, model quality, or a remedy for the old pilot.
The collector does not authorize rerunning that pilot; only generation
observations are persisted in private diagnostics, not scoring observations.

This is a selected engineering packet without population, representativeness,
blindness or contamination guarantees. It is not an official benchmark,
competitiveness, production-reliability, installed-real-host or Hermes-quality
claim. The offline diagnosis records fail-closed timing mechanics but cannot
identify a provider or network cause; its focused and live-offline gates pass
on Node 22.16 and 24.15. The legacy v1 result remains separate and is not
combined with this v2 roster or identity. Any future score requires a new
prospectively frozen and independently reviewed protocol and separate
authorization.

## Where the evidence lives

- [Semantic evaluation](semantic-evaluation.md)
- [Paired update-reliability experiment](evidence/qualified-comparison.md)
- [Source-support pilot results](../evaluations/results/source-support-v1.json)
- [Source-only context](source-evidence-context.md)
- [Integration inventory](source-reliability-integration.md)
- [First live evidence](evidence/first-live-evidence.md)
- [ROADMAP](../ROADMAP.md): the gates that must pass before broad promotion.
