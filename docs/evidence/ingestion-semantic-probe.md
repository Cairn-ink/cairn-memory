# Paired ingestion semantic probe

Reported 2026-09-28. Decision: **do not adopt combined ingestion**. Combined
used fewer requests and completed 24/24 attempts, but useful coverage was 18/24
against baseline's 19/24. That fails the frozen adoption hypothesis. This PR
changes no engine, prompt, compiler, default or installed host behavior, and
does not complete the overall memory-reliability goal.

These are same-model-family independent agent judgments, not human labels or
an independent benchmark. Twelve new short synthetic scenarios were attempted
twice per arm; the 24 attempts are not 24 independent questions. Neither small
differences nor the latency observations establish broad superiority.

## Protocol and inspectable evidence

The [frozen acceptance contract](../plans/ingestion-semantic-probe.md),
[source fixtures](../../evaluation/ingestion-semantic/fixtures.mjs),
[rubric](../../evaluation/ingestion-semantic/rubric.json), and
[sanitized results](../../evaluation/ingestion-semantic/results.json) preserve
the experiment. File hashes for the runner, transport, combined implementation
and dependency lock are historical provenance at candidate `658e2dc`; they do
not require future code or lock updates to remain byte-identical. Fixtures,
rubric and original rating/adjudication documents remain frozen. The results
contain all 48 attempts, compiled cards, retained
source/card projections shown to the raters, original A/B ratings and notes,
frozen adjudication, the arm/repetition mapping, and metric-only HTTP records.
Local random blind aliases remain inspectable; provider response IDs, transport
attempt UUIDs, campaign UUIDs and raw HTTP bodies are excluded. Private raw
synthetic requests/responses remain operator evidence rather than public data.

Both arms used `gpt-4.1-mini-2025-04-14` and the same retained source window.
Baseline ran real source-bound-v2 extraction and bounded-partition qualification
through the core/current adapter. Combined used the unchanged evaluation-only
prepare/prompt/schema/compiler. The 6,000 local / 7,024 provider input and 1,024
output ceilings remained unchanged. No classification, admission, persistence,
retrieval, recalled answer, official benchmark replay, retry or replacement
case was involved. Qualification sees evidence at different stages in the two
decompositions despite equal end-to-end source exposure.

Two agents independently rated anonymized source/card rows without arm, cost
or repetition labels. Their original ratings remain unchanged. Primary
adjudication was frozen before reading/joining the arm mapping, at SHA256
`1e215c4948e05ab07c58c53ee5be146d645e20376e3bb5c762f64ec76aae05b9`.
Primary had already inspected a baseline example while preparing the projection
and the failed baseline raw output. This partial blinding limit is disclosed;
adjudication is not an independent human assessment.

## Fixed-denominator results

Every count below uses all 24 attempts per arm. The mechanically failed attempt
has six null semantic dimensions and remains a full-success failure.

| Outcome or dimension | Baseline | Combined |
| --- | ---: | ---: |
| Mechanical completion | 23/24 | 24/24 |
| Strict full success: all six dimensions | 11/24 | 12/24 |
| Supported meaning | 13/24 | 14/24 |
| Uncertainty preserved | 13/24 | 17/24 |
| Attribution preserved | 21/24 | 20/24 |
| Scope/time preserved | 23/24 | 22/24 |
| Useful coverage | 19/24 | 18/24 |
| Evidence entailment | 13/24 | 14/24 |
| Attempts with strict unsupported-assertion notes | 10/24 | 10/24 |
| Attempts with material omission notes | 4/24 | 6/24 |

Raw rater A full-success counts were 9/24 baseline and 12/24 combined; raw
rater B counts were 11/24 and 15/24. Six rows had eleven dimension disagreements.
Adjudication retained the disagreements and source-cited reasons rather than
averaging ratings or discarding awkward cases.

Two baseline preference rows were consensus failures in the original ratings
and corrected in adjudication. The preexisting
[qualification guidance](../../core/prompts/qualify-candidates-shared.md) permits
`adopted` for a source-supported settled position or choice; the scoped explicit
preference meets that definition without implying implementation or a mandate.
Both raters separately agreed that their narrower preference interpretation
was an error. The raw ratings are still published.

Four assistant-suggestion rows fail strict attribution and useful coverage:
the content and seven fields do not identify the assistant as claimant, although
the assistant role remains recoverable in the receipt. This is the frozen
projection/coverage rule, not proof that the user adopted the suggestion.
The dated-adoption disagreement distinguishes the May 12 approval date from
the April audit application month; approval does not establish that the audit
was conducted then. The cap disagreement distinguishes lifting the specified
$40 cap for shipment two from asserting there is no possible delivery cap.

Eleven other full-success failures are solely interpretation-sensitive
`adopted` labels on nondecision facts or a temporary mood. The strict judgment
does not establish fabricated actions, implementation, or enduring personality
traits. Accepting those labels as factual acceptance in a **post-hoc sensitivity
analysis** would give 17/24 full successes in each arm. This does not replace
the frozen score, modify the rubric or outputs, satisfy adoption, or authorize
a default change.

| Scenario | Baseline strict full / 2 | Combined strict full / 2 |
| --- | ---: | ---: |
| Explicit preference | 2 | 2 |
| Tentative incident cause | 1 | 2 |
| Proposal not adopted | 2 | 2 |
| Dated scoped adoption | 2 | 0 |
| Invalidated reason, choice unchanged | 0 | 2 |
| Adopted reversal with reason | 2 | 1 |
| Late import, historical event | 0 | 0 |
| Distinct environment scopes | 0 | 0 |
| Quoted third-party claim | 2 | 2 |
| Dated one-day reflection | 0 | 0 |
| Assistant suggestion only | 0 | 0 |
| Conditional cap exception | 0 | 1 |

## Retained mechanical failure

Baseline `conditional-cap-exception`, repetition 1 (the second declared
attempt), failed during qualification. The retained provider output contained
`scope.evidenceSlots: [1, 1]` with `pool: [1, 2]`; the actual decoder rejected it
as `qualification_slot_mapping`. Extraction and qualification HTTP work remains
counted, with no partial compiled result and no retry.

Primary's local diagnostic deduplicated only that exact valid repeated field
reference in memory. The unchanged decoder/compiler then accepted it. This
was not a model replay, output repair used for scoring, or engine change. It
supports a separate narrow fix proposal; it does not establish the cause of
older official-run slot failures.

## Resource observations

| Measured or reserved quantity | Baseline | Combined |
| --- | ---: | ---: |
| HTTP attempts, including counts | 96 | 48 |
| Generation attempts | 48 | 24 |
| Observed generation input tokens | 57,952 | 44,754 |
| Observed output tokens | 5,945 | 4,970 |
| Known-usage uncached cost ceiling, microUSD | 32,713 | 25,864 |
| Retained reservation, microUSD | 427,008 | 213,504 |
| Count requests with unknown cost | 48 | 24 |
| Median instrumented arm time, ms | 5,794.5835 | 3,566.1748 |
| Total guarded HTTP transaction time, ms | 101,521.8172 | 64,000.3657 |

Each HTTP attempt reserved 4,448 microUSD before dispatch. Known generation
usage was conservatively priced at uncached input/output rates and rounded
up per request. Count cost remains unknown, and all reservations are retained.
Known usage totals US$0.058577; new reservation totals US$0.640512. Neither is
a billing invoice. The campaign finished at 120,637,606 microUSD reserved,
79,362,394 remaining, 18,672 requests and zero pending attempts; the cumulative
cap remains US$200.

Arm time includes baseline guard's additional local synthetic serializer
capture/tokenization. HTTP transaction time includes body reading, validation
and pre-dispatch persistence. These are instrumented observations, not isolated
provider latency or a production speed comparison. Fewer requests do not offset
the frozen useful-coverage failure.

## Next gates

1. Propose a separate minimal semantics-preserving duplicate-field-reference
   fix. Preserve distinct pool entries, request/output bounds and foreign or
   cross-item citation rejection; do not generally relax citation validation.
2. Clarify nondecision commitment semantics and preservation of claimant,
   decision/event/import time and conditional scope. Keep receipt recoverability
   distinct from covered assertions in content/fields.
3. Establish scalable bounded ingestion and output capacity. The earlier
   [offline design comparison](../plans/ingestion-design-comparison.md) still
   retains a multi-source fit refusal and legal-long output exceeding 1,024
   tokens; this short-source probe does not resolve those limits.
4. Pass offline checks and independent review, then freeze NEW held-out cases
   and a reviewed operator manifest with a fresh budget audit within the already
   authorized cumulative US$200 cap. The completed one-shot manifest supplies
   no additional dispatch or consumed official-case replay.
5. Only after a completion gate, return to an official-style Cairn/Mem0 fixed-N
   score, then ordinary installed Hermes/MCP validation. Integration, source
   fidelity, answer quality and overall reliability remain separate gates.

Pre-live candidate `658e2dcce2f11b27afbec7f1da2a3ed0078d1765` passed independent
Standards/Spec review. Primary reran the full OpenAI suite 266/266 on Node22.16
and24.15, and strict plugin validations; worker generic checks passed 112/112
plus JSON/version validation on both runtimes. The public result integrity
test independently recomputes joins, fixed denominators, scores, disagreements,
source/card identity, frozen input hashes and resource totals offline. Those
engineering checks do not validate the agents' semantic judgments as truth.

After adding the result artifact, primary reran the complete OpenAI suite on
both runtimes: 267 passed, zero failures/skips. Original rating/projection data
and all 48 public metric projections were also checked directly against the
private retained evidence. Final exact-candidate review and CI are recorded in
the delivery PR; the historical runner/transport hashes are not promises that
future code will remain unchanged.
