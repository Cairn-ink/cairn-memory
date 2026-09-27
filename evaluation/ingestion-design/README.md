# Offline ingestion design comparison

Decision: **revise before a live test**. Scripted successful cases suggest a
bounded request saving; the combined prototype fails a case that current core
partitioning completes. No implementation or default is adopted.

Run `node evaluation/ingestion-design/report.mjs` after installing the existing
locked OpenAI adapter dependencies. It emits deterministic JSON, including
exact original/exposed text, request/schema digests, full-body token and byte
counts, refusal stages, count/generation pairs and output work. Tests live in
`adapters/openai/test/ingestion-design.test.mjs` so the dependency-free generic
suite does not import optional tokenizer dependencies.

## Frozen design

`fixtures.mjs` contains 12 deeply frozen synthetic source-only cases; fixture
SHA-256 is `778e6292fb3fc4ca4ca87d1b7922c2923cff20c41e77cdfa55a1b576a3a7ee86`.
The medium case was added before the first runnable capacity report. Extraction
and combined requests/schemas contain no oracle cards, labels or citations.
Downstream qualification receives scripted extractor cards and core-prepared
source candidates as normal pipeline input; these are output-conditioned
mechanics, not a blind end-to-end semantic measurement. Separate `oracle.mjs`
scripts conditional extraction and interpretation; these are not measured
semantic judgments. Preliminary authoring corrected the suggestion
and uncertain-cause commitments to unknown and the first person's decision
attribution to direct; it did not produce scored evidence.

All controls use the current adapter's `DEFAULT_MODEL` and o200k tokenizer.
Legacy extraction is an unqualified resource control, exposes up to 4,000
UTF-16 units per message, and retains 800-unit receipts. Both qualified arms
and combined use core's `retainedSourceView` (800-unit prefixes). The qualifier
sees only extracted receipts; combined sees all retained sources before card
selection. End-to-end retained source exposure matches; per-stage tasks differ.
No additional source truncation occurs. Classification, persistence, transport
latency and dollar cost are excluded uniformly.

Legacy and qualified extraction execute `callModel`, the real adapter and
`extractedItems`. Whole-batch uses the real adaptive fit capability, inline
then text catalog, and refuses when neither fits. Bounded partition executes
unchanged `qualifyCandidateItems`, including its all-groups-before-dispatch
preflight. Their count/generation bodies are captured at fake HTTP. Refused
extraction request measurements are separately reconstructed and checked
against dispatched bodies on fitting cases. Existing qualification-wire
serialization is reused for attempted request measurements, not as an arm.

Combined bodies are reconstructed evaluator-only requests; no adapter dispatch
or provider schema acceptance is claimed. Source candidates are prepared from
canonical retained messages before cards, using core's Unicode-safe passage
segmentation. Generated `sourceIndices` select receipts; candidate references
map by source and exact canonical position into the unchanged core compiler.
No model-authored quote/offset, deduplication, repair, fallback or persistence
exists. The shared qualification interpretation guide is reused with two
explicit adaptations: extracted becomes proposed output memory, and THIS-item
candidate membership is defined by the output's selected `sourceIndices`.
The incompatible extraction output wrapper is replaced by one combined wrapper.

## Conditional measurements

Totals below sum all 12 fixtures, retaining failed-stage work. Input is full
generation-body local tokens; serialized work includes both count and generation
bodies. Provider count/usage 120/80 are fake fixtures, not observations or a
bill. Current local/provider/output ceilings remain 6,000/7,024/1,024 tokens.

| Arm | Completed / 12 | Count/generation pairs | Generation input | Serialized input work | Scripted output |
| --- | ---: | ---: | ---: | ---: | ---: |
| Legacy | 11 | 11 actual | 15,668 | 31,171 | 863 |
| Whole-batch qualified | 10 | 21 actual | 47,638 | 94,961 | 3,256 |
| Bounded partition qualified | 11 | 26 actual | 62,217 | 124,044 | 3,831 |
| Combined | 10 | 10 modeled | 29,530 | 58,910 | 2,673 |

Short-fact generation input is 2,876 tokens across the two qualified calls
versus 2,249 for one modeled combined call (21.8% lower, conditional on these
outputs). Distinct five-source long input is 8,640 versus 5,151. The medium
20-source fixture succeeds with six current pairs and 19,005 generation-input
tokens; whole-batch refuses after extraction and combined refuses before a
modeled dispatch (5,555 logical / 6,983 full count-body tokens). The genuinely
unfit 24-source fixture refuses in all arms before fake HTTP. No retry or raised
ceiling is used.

Selected legal-long output cases use seeded mixed ASCII labels/content. In
five-short, extraction needs 1,779 output tokens and whole qualification needs
2,611 wire / 2,558 decoded DTO tokens; combined needs 4,317. All exceed 1,024.
Singleton qualifier long outputs fit, but five-card extraction still does not.
These are selected legal-long cases, not maximum token bounds; compact scripted
outputs fitting does not establish completion for real outputs. Validation
tests deliberately accept a certainly-wrong DNS interpretation with real
evidence and an all-unknown interpretation with one anchor. Structure verifies
source attachment, not usefulness, entailment, truth, adoption or currentness.

Frozen report SHA-256, including final newline:
`ff974bfa10e8d64900d6a18fc1fea1972e238cf74be0d30129820bb8fe59cbf8`.
The same report is repeated twice on Node 22.16.0 and 24.15.0. See the
[plan](../../docs/plans/ingestion-design-comparison.md) for gates and commands.
Future real-model work needs a fresh blinded rubric, source-only cases and
separate reviewed narrow live guard contract; combined cannot be smuggled under
the existing extraction schema guard. This module reads no key or ledger,
makes no paid call, and establishes no installed MCP/Hermes behavior.
