# Source-to-proposition comparison: failed candidate

The completed controlled experiment fails its frozen adoption gate. Do not adopt
the joint source-to-proposition builder. Source passes rose from 10/24 to 11/24,
but ten previously correct required decisions were lost and three new severe
assertion instances appeared in two sources. No production default changes.

The [frozen contract](../plans/source-proposition-comparison.md) predates the
outputs. The evaluation-only builder and cohort ran at runtime commit
`bae2938bf170c4ce07b42f15c7a6b4010ed0ffc3`. Both arms used the same exact source
evidence and pinned OpenAI `gpt-4.1-mini-2025-04-14`, with 1,024 output tokens per
generation, 6,000 local counted input tokens and a 7,024 provider input-token
ceiling. Baseline extraction then qualification used two generations per source;
the candidate used one joint generation. Arms alternated first by source index.
These are first attempts only: no repaired output, retry, replacement or
post-hoc rubric change.

## Frozen result

All 24 authored synthetic sources remain in the denominator, including three
candidate structural failures. Baseline completed 24/24; candidate completed
21/24. Invalid, empty, overflowing or timed-out attempts cannot disappear from N.

| Check | Retained result | Required |
| --- | --- | --- |
| Whole-source passes | Baseline 10/24; candidate 11/24 | Source gains alone are insufficient |
| Paired gains / regressions | 7 / 6; net +1 | Net >=3: **fail** |
| Lost baseline-correct required decisions | 10 of 19 previously correct, from 21 required | 0: **fail** |
| New severe assertion instances | 3 in 2 source episodes | 0: **fail** |
| Unresolved judgments | 0 | 0: pass |
| Cold persistence failures | 0 | 0: pass |

Required-claim correctness was 21/34 to 20/34; coverage was 34/34 to 28/34.
Decision losses include individually correct baseline decisions inside sources
that failed another claim. Counting only the six whole-source regressions would
hide those losses. Source pass requires every required claim to be covered and
correct, every emitted material claim and tuple dimension to be faithful, and no
severe addition; successful execution alone earns no semantic pass.

Both arms happen to have three severe assertion instances in two sources each.
Those aggregate counts are never subtracted. The candidate's two completed-room
booking assertions (`21e5b8a6d047`, items 1 and 2) and unqualified museum-time
assertion (`5a0e729c4fd1`, item 0) have no severe baseline assertion in their
respective paired sources. All three are therefore new; no equivalence credit
is needed or taken. Three item-level assertion instances are two source-level
episodes, not three distinct failing sources.

## Where the ten decisions were lost

| Cause | Lost claim IDs | Count |
| --- | --- | --- |
| Atomic structural rejection | q22, q31, q32, q33 | 4 |
| Omitted consideration | q14, q26 | 2 |
| Omitted conditional branch | q21 | 1 |
| Considered stance became unknown | q25, q28 | 2 |
| Intended booking became completed booking | q12 | 1 |

The three rejected candidate outputs are retained in the public artifact.
`93b57e0a2fc6` selected observation plus adopted commitment. `bb6049f2a18e`
made that same contradiction in all three propositions, rejecting the entire
output and losing two previously correct required decisions. `3f92d6a081ce`
cited a field outside its own proposition's selected support set. These are
`invalid_proposition_output` at the candidate stage, not provider, storage or
timeout failures. Atomic rejection was the frozen compiler contract. Fixing the
typed wire alone would leave the six substantive losses above unresolved;
rejected outputs are not retroactively admitted or given credit.

A separate physical-source audit of these ten lost decisions finds five with
their entire necessary user message still present in candidate persisted
receipts: q12, q14, q21, q25 and q28. For q26, only the assistant's cotton-blanket
recommendation survived; the user's wool-blanket consideration is absent. The
other four have no candidate persisted receipt because their three source
outputs were rejected. This yields **5 present / 1 source-selection omission /
4 rejection losses**, with no partial or unknown classification. There are nine
source episodes because q31 and q32 share one source. The public replay checks
exact whole-user-message containment in retained receipt projections. This is
physical availability, not a semantic rescore, answer-recovery demonstration or
newly adopted algorithm. The public QA and mixed LongMemEval paths already use
source-evidence context; switching to exact receipts is not new there.

Cold persistence was independently audited in the retained run: 74/74 compiled
items survived (baseline 33/33, candidate 41/41). The public replay verifies
their accepted cold markers and indices; it does not reopen those databases or
repeat the persistence run. Mechanical persistence establishes neither truth nor
faithful interpretation.

## Resources and judging boundary

| Observed work | Baseline | Candidate |
| --- | --- | --- |
| Generation calls | 48 | 24 |
| Input-count calls | 48 | 24 |
| Known generation estimate | $0.035110 | $0.023554 |
| Generation input / output tokens | 63,174 / 6,139 | 26,391 / 8,117 |

All 144 physical requests are accounted for as 72 generation plus 72 counting
requests. Missing counting-endpoint charges and rater/adjudicator charges remain
unknown, not zero. The $0.72 paid reservation is not an invoice. These resource
figures cover extraction/qualification only; they exclude filing, rationale,
relationships and recall. Fewer generation calls and lower known generation
estimates do not establish complete-lifecycle savings, especially with unequal
completion and quality. Retained all-source operator latency includes accounting
overhead and all 24 first attempts per arm; it is not a matched-quality speedup.
The optional cumulative budget snapshot is $338.322281 conservatively reserved
and $31.677719 usable after the protected $30 reserve, not a final invoice or
permission for a new run.

The cohort contains 24 synthetic cases, 31 messages, 34 required claims and 21
required decisions. Two independent blinded GPT-6.1 Sol/high raters from the
same model family saw only the identical common persisted projection, exact
source and frozen rubric. A fresh masked adjudicator retained all final rows
and separate reasons. The raters agreed on 495/506 boolean fields, with seven
substantive-disagreement rows and two reference-selection rows. The primary
read all 48 projections, 68 claim judgments and 74 item judgments, accepted the
negative result and changed no original rating. This is model-based judging
with primary evidence acceptance, not human calibration or independent-family
validation. It establishes no official LongMemEval accuracy, real-user quality,
installed Hermes behavior, full-capture reliability, long-history performance or
competitor parity.

## Public mechanical reproduction

The [result artifact](../../evaluation/architecture/results/source-proposition-v1.json)
retains exact UTF-8 strings and SHA-256 hashes for the original masked packet,
unmasking map, two rater files, adjudication, judging contract and primary
acceptance. Original judgments have not been edited. The source/gold fixtures
remain public and unchanged. Key original hashes:

| Retained input | SHA-256 |
| --- | --- |
| Source fixture | `2018e0502c9e4533114855c2e336cc9414a0006f53b5aa2afec1f0ca577970eb` |
| Rubric | `39f2e1eef57d59d5a93c000dbceaae9b0a2077bc024c337ddf6cc7a5e9532f26` |
| Masked packet | `3a77806713612826421460ea90af0635d982c2e913659eea9d5a132d4e8fcf85` |
| Rater A | `3849ebb74a28d3612fd4d72312ac0d909f23f639a52ab8ba8baef3cc0b0bb5fc` |
| Rater B | `54d502ab4da9df5cc6eb6ee75657707cfa006d4ce3da72733f5e0064f20ffefa` |
| Adjudication | `d13646126f230a48ce743b3180d5891987586a402a6c693475acc5a5b3818dcd` |
| Primary acceptance | `46f31471f34a316a9df5b5cd8fb3f8f8195a1ed1ee0db0ad2d5048f559cea645` |

The [pure scorer](../../evaluation/architecture/source-proposition-score.mjs)
preserves the original mechanical scorer body byte-for-byte (SHA-256
`61d714042b6ae12b8009f228b1ca3b5d0985bf93ff309017dd2c3af1afe298ef`), then
adds a public replay boundary. `reproduceSourcePropositionResult(artifact,
{ sourceBytes, rubricBytes })` accepts the parsed public artifact and exact
fixture strings or buffers; it performs no file, model, network or SQLite work.
It validates fixed original hashes, source/gold mapping and all supplied ratings,
recomputes the complete retained score/agreement, and derives completion,
semantic and cold-marker counts. Resource and latency values are the exact
retained primary-audited measurements, not freshly measured provider charges.
Digests bind these retained bytes; they are not external signatures or proof
that a fresh operator would receive the same outputs.

Run the focused replay and mutation controls offline:

```sh
node tools/testing/run.mjs evaluation/architecture/test/source-proposition-score.test.mjs
```

The suite also retains the original scorer's synthetic edge cases and checks
dropped-failure denominators, lost-decision/severe laundering, wrong-source
equivalence, modified original judgments, altered source/gold bytes, source
availability, cold/resource counts and private-material exclusion. This is a
public supplied-judgment re-score, not fresh semantic validation or full paid
operator reproduction. No environment/configuration, operational ledger
locator, HTTP request metadata or private operator is published.

## Direction after the failure

The earlier post-hoc refinement and this joint builder are two failed controlled
approaches. Re-scope ownership and the evidence opportunity before selecting
another intervention; no third candidate is selected here. MOC or vectors cannot
reconstruct omitted write evidence. Check existing bounded source and session
episode functionality before proposing duplicate source capsules. Any future
design must identify what evidence is absent versus present but misinterpreted,
and needs its own observable acceptance and authority. This result grants no
broader Raw retention, consumed-source replay or new paid run.
