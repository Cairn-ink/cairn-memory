# Fresh qualification meaning diagnostic

Reported 2026-09-28. Decision: continue a **fresh long-history six-type paired
feasibility check**, with source fidelity still an unresolved product gate.
All 24 attempts mechanically completed, producing 31 cards; only 13/24 passed
all six frozen semantic dimensions. Completion supports investigating the next
capacity boundary. It does not establish reliability, release eligibility or
a causal improvement over the earlier, different cohort.

## Frozen protocol and public evidence

The [Q1–Q8 contract](../plans/qualification-meaning-probe.md),
[twelve source fixtures](../../evaluation/qualification-meaning/fixtures.mjs),
[rubric](../../evaluation/qualification-meaning/rubric.json),
[pre-score calibration](../../evaluation/qualification-meaning/calibration.json)
and [sanitized results](../../evaluation/qualification-meaning/results.json)
retain the evidence. Two fixed repetitions per short synthetic scenario are
24 attempts, not 24 independent questions. Both English and Traditional Chinese
sources remain fully visible. The core canonicalizes retained source text with
NFKC; five Chinese messages normalize punctuation. Original fixture bytes and
canonical retained sources are distinct, explicitly bound representations.

Execution candidate was `daf48d2fba4ddd7c3bb84300f06e69eefd053f77`. The unchanged
guarded baseline runner used actual source-bound-v2 extraction and bounded
qualification with `gpt-4.1-mini-2025-04-14`, 6,000 local / 7,024 provider input
and 1,024 output token bounds. There were no retries, replacement cases,
combined calls, persistence, classification, retrieval, answer scoring, tools
or installed-host execution. This report changes no prompt, runtime, rubric,
calibration, model output or earlier artifact.

The public artifact includes all original attempt identities/statuses, exact
canonical source/card projections, content, receipt excerpts, qualification
fields and exact anchors. It preserves original provider output text decoded
from the response body's `output_text`, and exact source-only request input
text, alongside allowlisted usage/count/status/latency metrics. Provider
headers, response/message IDs, transport attempt IDs, campaign capabilities,
session/owner metadata, private paths and audit payload are excluded. The
public receipt projection keeps source index, role and exact excerpt; the
compiler replay reconstructs trusted synthetic receipt identity from fixtures.
No sanitized field is a repaired model output.

Two independent GPT-6 Sol/high agents reviewed calibration before seeing
scored outputs. Their projections hid repetition IDs and resource costs. This
single-arm experiment has no arm blinding; agent-family judgments are not
independent human labels, benchmark ground truth or universal reliability.
Primary adjudication was frozen before aggregates or the repetition mapping,
at SHA256 `f2b79f79ff3fe306f84a9153801e625fa987319beb8d97cfdf8bfd4a8469bc7a`.
Raw A/B ratings and notes remain exact and separately inspectable.

## Fixed-denominator outcomes

All counts use all 24 planned attempts. Semantic failure is distinct from a
failed request. Every attempt completed the structural extraction/qualification
contract; that contract validates structure and source references, not meaning.

| Outcome or dimension | Adjudicated | Raw A | Raw B |
| --- | ---: | ---: | ---: |
| Mechanical completion | 24/24 | 24/24 | 24/24 |
| Full success: all six dimensions | 13/24 | 12/24 | 12/24 |
| Supported meaning | 16/24 | 15/24 | 15/24 |
| Uncertainty preserved | 16/24 | 15/24 | 16/24 |
| Attribution preserved | 21/24 | 21/24 | 21/24 |
| Scope/time preserved | 22/24 | 22/24 | 21/24 |
| Useful coverage | 20/24 | 20/24 | 19/24 |
| Cited evidence entails | 15/24 | 14/24 | 14/24 |
| Attempts with unsupported-assertion notes | 8/24 | 9/24 | 9/24 |
| Attempts with material omission notes | 4/24 | 4/24 | 5/24 |

Raw raters agreed on 22/24 complete rows and 137/144 dimension judgments.
Two rows have seven dimension disagreements. Both resolutions are genuine
interpretation close calls under the frozen rubric, not verified objective
rater mistakes. Neither raw document was corrected:

- `alpine-seed-record-preference`, repetition 0: the selected property is the
  scoped handwritten preference. Complete content/fields distinguish spreadsheet
  use elsewhere without asserting a spreadsheet preference. Primary accepted
  B's interpretation; A's concern about the composite value remains visible.
- `foldout-stock-proposal-adopted-zh`, repetition 0: the proposal card names the
  foldout, while the later choice card retains the user's dated choice for
  printed versions. Primary accepted A's across-card representation under the
  allowance for different card layouts. This does not establish that a detached
  retrieved card preserves its antecedent; that remains a separate concern.

| Scenario | Adjudicated full success / 2 |
| --- | ---: |
| Scoped alpine archive preference | 2 |
| Dated seed-tray sensor observation | 0 |
| Dated voiceover mood | 0 |
| Considered ink / rejected foil | 2 |
| Assistant clipboard suggestion | 2 |
| Inez's courtyard selection | 2 |
| Planetarium route choice and premise | 0 |
| Atlas choice with corrected rationale | 0 |
| Dated recital envelope selection | 2 |
| Imported historical rain-gauge repair | 0 |
| Scoped exhibition layout preference | 2 |
| Foldout proposal, adoption and application dates | 1 |

## Concrete retained weaknesses

Eight attempts incorrectly assign `adopted` to nondecision claims: two sensor
readings, two dated moods, the corrected drying-speed fact in both atlas
repetitions, and two historical repairs. For example, the first sensor card
preserves the 09:10/2026-04-18 observation and 23°C value, but its commitment
anchor `[0,80)` supplies no choice or settled preference. Useful coverage still
passes. The mood cards preserve the day-only/non-personality caveat; their
false commitment does not by itself prove a fabricated stable trait. Unknown
commitment would not erase useful observations or historical events under the
frozen rubric. These failures are retained despite the new observation/dated
feeling guidance being present in all actual qualification requests. Guidance
is not a reliable semantic validator.

Both planetarium cards omit `我們` (the group) as decision maker from usable
content and meaningful qualification, while preserving the route/event/premise.
User receipt role and `direct` attribution do not supply that missing claimant.
The first atlas correction card also labels a supplier's corrected assertion
`direct`, despite identifying the supplier in its content. The other atlas
repetition preserves `reported` attribution but still incorrectly assigns
`adopted` to the factual drying-speed premise.

Both repair cards preserve the 2023-04-02 repair date but omit the separate
2026-08-19 import date and field-journal provenance from usable content/fields.
The full receipt retains these words, but receipt recoverability does not
satisfy useful coverage of import time. The source concerns importing the repair
account; it does not establish importing the entire journal.

The second foldout repetition emits scope `《溪徑》摺頁印製版本` on its choice
card, citing only source 1's anchor `[0,45)`. That passage supports the user
decision and application period, but the named publication appears only in
source 0. Overall source meaning and coverage pass across cards; the exact
field citation still fails entailment. A valid anchor cannot import an uncited
antecedent. The first repetition's adjudicated across-card close call does not
rescue this different output.

No currentness or retirement write occurred. These unverified descriptors do
not demonstrate an automatic-retirement or authority bypass; trusted transition
binding remains separate. This experiment also does not resolve reliable
factual state updates or earlier baseline/combined/official failures.

## Resource observations

| Quantity | Observed or retained |
| --- | ---: |
| HTTP requests | 96: 48 generations + 48 counts |
| Generated cards | 31 |
| Generation input / output tokens | 62,238 / 5,954 |
| Known generation uncached ceiling, microUSD | 34,440 |
| New retained reservation, microUSD | 427,008 |
| Count requests with unknown cost | 48 |
| Median instrumented attempt latency, ms | 6,024.0707765 |
| Sum of instrumented attempt latency, ms | 152,452.061548 |
| Sum of guarded HTTP latency, ms | 110,671.009031 |
| Instrumented run latency, ms | 152,773.809438 |

Each HTTP request reserved 4,448 microUSD before dispatch; none was refunded or
reset. Known generation usage is conservatively priced at uncached rates and
rounded up per request. US$0.034440 known usage and US$0.427008 reserved are not
invoices; the 48 count costs remain unknown. The cumulative US$200 campaign
finished at 18,768 requests, 121,064,614 microUSD reserved, 78,935,386 headroom
and zero pending attempts. No ledger identity or history payload is published.

Latency includes local serializer/tokenizer work, guard and persistence work,
body reading and validation. It is an instrumented short-probe observation,
not isolated provider time, user-endpoint latency, cold-session performance
or long-history performance.

## Next gate and offline integrity

Proceed to NEW long-history six-type paired feasibility using the already merged
fixes. Keep claimant, commitment, time and exact-anchor weaknesses as an unresolved
semantic product gate; do not tune or replay this consumed cohort to seek 100%.
Before new paid dispatch, review the v3 resource/budget projection and source-only
operator manifest. Only six common resolved cases permit a separately assessed,
fresh fixed-30 comparative score gate. Ordinary installed Hermes/MCP remains
another gate. This evidence supplies no additional dispatch authority or public
reliability/promotion claim.

The [public integrity tests](../../adapters/openai/test/qualification-meaning-results.test.mjs)
recompute fixed joins, repetitions, rating/case totals, agreement, source/receipt
and field anchors, usage/cost/budget and latency totals. All 24 exact retained
output texts reproduce the public cards through fake HTTP and the actual OpenAI
adapter, evidence decoder and core compiler. Deliberate output/foreign-citation,
grade/join/anchor/budget and nested privacy corruption must fail. Frozen fixtures,
rubric, calibration and original raw-rating/adjudication documents are hash bound.
These checks establish artifact integrity, not semantic truth.

The primary independently compared every public attempt/card/record, decoded
input/output, blind projection, raw rating and adjudication to private immutable
evidence and found exact equivalence within the declared privacy projection.
Engineering gate outcomes and final fixed-candidate review/CI are recorded in
the [existing plan](../plans/qualification-meaning-probe.md) and delivery PR.
