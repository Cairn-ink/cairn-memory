# Six-case larger-pool: closed development results

Decision: INCONCLUSIVE under the [prospective L1–L10 contract](large-pool-six.md).
Linked B and complementary C each scored 6 correct / 0 incorrect / 0 unresolved.
C−B has zero wins, zero losses and six both-correct pairs. Four cases exercised
the larger-pool lexical branch, and C packed 29/36 diagnostic anchors versus
B's 26/36, with one added anchor attributable to lexical additions. The
predeclared positive-QA gate fails: `supportsFurtherDevelopment: false`.
This result supplies no advancement, product/default promotion, Stage 3,
old D12 repair or competitive-parity evidence.

These are six newly authored development cases L01–L06, four known-answer
questions and two uncertainty/scope controls, not independent holdout or official
LongMemEval. The [closed 24-case comparison](complementary-qa24-results.md)
remains ordinary 19/24, linked 23/24 and complementary 23/24 with severe D12 harm.
The separate [closed 16-answer format probe](large-pool-six.md#separate-closed-answer-format-probe-identity)
found no nested/flat advantage or D12 reproduction. Neither cohort is pooled,
rescored, repaired or superseded by this six-case result.

## Runtime, coupling and first judgments

Frozen runtime `954507b1ef8b404b6f09b36a6ccd12da91b347ca` executed once on
2026-10-11 using Node 22.16.0 and `gpt-4.1-mini-2025-04-14`, closing at
`2026-10-11T09:25:24.755Z`. Primary recorded actual execution exit 0, all six
captures and twelve answers completed, no fatal or execution failure. Blind
preparation and the single post-run scoring operation exited 0; primary schema
validation of both first submissions also exited 0. No retry, resume, replacement
case, post-result top-up or scorer rerun occurred.

Both arms use the existing source-diverse selector, recorded-role evidence
verifier and unchanged source-role answer packer. B uses the linked compiler;
C uses the frozen complementary compiler. One natural select/rank trace per
case supplies strict ordered raw-response replay to the second arm through the
real reopened core. Natural-first orders alternate B/C three times each;
request identity, trace consumption and captured state passed. Answers are
generated independently once. This is a coupled compiler intervention, not two
independent end-to-end retrieval runs; standalone treatment latency and cost
cannot be inferred from replay-arm timings.

Two fresh independent nonauthor judges, requested and actual GPT-6.1 Sol/high
in separate fork-none contexts, each submitted all twelve first blind judgments.
All verdicts and safety classifications agreed; disagreement, missing and unknown
counts are zero. Agreement-only aggregation used no adjudication or favorable
selection. Correctness uses full original histories; claim support uses actual
packed evidence. Same-family agent agreement is not independent human ground
truth. Blind-label mappings and whole raw answers remain unpublished.

## Fixed-denominator outcomes and gates

| Arm /6 | Completed | Correct | Incorrect | Unresolved | Unsupported known / unknown | Stale known / unknown | Severe known / unknown |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| B linked | 6 | 6 | 0 | 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| C complementary | 6 | 6 | 0 | 0 | 0 / 0 | 0 / 0 | 0 / 0 |

C−B: wins 0, losses 0, both correct 6, neither correct 0, unresolved pairs 0,
net correct 0, denominator 6. Each judge reviewed 22 claims per arm and found
zero unsupported or stale claims. All six cases are retained, including the two
ineligible cases and the eligible zero-addition case. There are no QA losses to
omit; complete correctness resolution does not impose a perfect-accuracy gate.

| Frozen L8 gate | Result |
| --- | --- |
| `noFatal` | true |
| `eligibleCases`, at least four | true (L01/L03/L04/L06) |
| `pairingIntegrity` | true |
| `correctnessResolved` | true |
| `positiveQA`, C−B >0 | false (0) |
| `positivePackedGain`, lexical-attributable >0 | true (+1) |
| `safety`, no increase in unsupported/stale or new severe case | true |
| `resourcesWithinLimits` | true |
| `supportsFurtherDevelopment` | false |
| `productPromotion` / `stage3` / `oldD12Repaired` | false / false / false |

Thresholds remain those frozen before paid answers. Eligible live exercise is
established, but greater literal coverage without a positive QA difference does
not support advancement under this contract. New-cohort zero harm does not
resolve the earlier D12 safety failure.

## Actual cards, rank intervention and source coverage

Each case completed six normal indexed-source capture batches from six short
sessions and retained one database. Captured cards total 117, range 15–23;
none is a >36-card archive. Rank pools, seed slack and the compiler reason,
rather than archive size, determine larger-pool eligibility.

| Case / family | First arm | Cards | Rank pool | Raw seeds | C added / displaced refs | Compiler reason | Eligible | B / C correct |
| --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |
| L01, three-source handoff | B | 22 | 7 | 3 | 3 / 0 | `lexical_bridges` | yes | 1 / 1 |
| L02, dated location update | C | 21 | 6 | 2 | 4 / 0 | `complete_small_seeded_pool` | no | 1 / 1 |
| L03, decision-premise reconfirmation | B | 18 | 8 | 4 | 2 / 0 | `lexical_bridges` | yes | 1 / 1 |
| L04, CJK/paraphrase retrieval | C | 18 | 7 | 3 | 0 / 0 | `lexical_bridges` | yes | 1 / 1 |
| L05, missing entity binding | B | 23 | 6 | 2 | 4 / 0 | `complete_small_seeded_pool` | no | 1 / 1 |
| L06, lexical/scope collision | C | 15 | 7 | 2 | 2 / 0 | `lexical_bridges` | yes | 1 / 1 |

L02/L05 are excluded only from larger-pool eligibility, because their actual
rank pools contain six candidates; both remain in every outcome denominator.
L04 meets the >6 pool, 1–5 seeds, limit-six and lexical-reason preconditions
despite adding zero refs. Across eligible cases there are seven one-hop lexical
paths (3/2/0/2), no displacements. Raw seed count totals 16; C adds 15 refs
overall, seven lexical and eight small-pool completions. These are ref counts,
not anchor counts or proof of entity identity.

The metric is literal normalized origin-bound anchor presence, with NFKC,
secret redaction and whitespace normalization; it is not semantic relevance,
claim support, completeness or additional correct answers. All 36 anchors were
retained and candidate-reachable in both arms. Unknown/not-run counts are zero
at every stage; absent counts are 36 minus present.

| Stage, present /36 | B | C |
| --- | ---: | ---: |
| Capture-retained | 36 | 36 |
| Candidate-reachable | 36 | 36 |
| Effectively selected | 32 | 32 |
| Recalled | 26 | 29 |
| Actually packed | 26 | 29 |

| Case | Anchor denominator | Retained / reachable, both | Selected, both | Recalled / packed B | Recalled / packed C | Packed gain |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| L01 | 4 | 4 | 4 | 4 | 4 | 0 |
| L02 | 5 | 5 | 4 | 3 | 4 | +1 |
| L03 | 7 | 7 | 6 | 6 | 6 | 0 |
| L04 | 6 | 6 | 6 | 6 | 6 | 0 |
| L05 | 7 | 7 | 5 | 4 | 5 | +1 |
| L06 | 7 | 7 | 7 | 3 | 4 | +1 |

Only L06's +1 is attributed to larger-pool lexical additions; the other two
gains come from small-pool completion. C packs 31 evidence units and 4,545
locally estimated packed answer-input tokens versus B's 16 units and 2,788
tokens (`observations[].arms[arm].packed.inputTokens`). No whole units were
omitted. Extra context has a resource cost even when QA remains tied.

## Paired resources, retained storage and original ledger

All frozen resource checks passed. Each case made 12 capture logical calls,
two natural recall logical calls, two replay recall logical calls and two paid
answer requests: totals 72 / 12 / 12 / 12. The twelve replay calls incurred no
HTTP or paid recall. Actual HTTP attempts were 180 (30 per case): 84 core
token-count requests, 84 core generations and twelve answer generations.
The ceiling was 252 HTTP, $1.26 maximum request reservation and $2 local
reservation, with original $400 cumulative ceiling and $30 protection intact.
Input/output and request/case/run caps were unchanged and passed.

| Resource | Observed |
| --- | ---: |
| HTTP attempts | 180 |
| Conservative reservation | $0.900000 |
| Known model-profile usage estimate | $0.053136 |
| Generation input / output / total tokens | 97,582 / 8,791 / 106,373 |
| Unknown-usage requests | 0 |
| Total paired elapsed time | 499,206.30151 ms (499.206 seconds) |
| Six retained SQLite files | 3,592,192 bytes |

Per-case SQLite bytes are L01 606,208; L02 598,016; L03 593,920; L04 589,824;
L05 614,400; L06 589,824. These are retained file sizes, not incremental growth,
peak RSS, CPU use or an installed-host lightweight measurement; no peak-memory
measurement was made. The usage estimate is based on the known model profile,
not an invoice. Paired execution does not measure standalone-arm cost/latency.

The original ledger changed from 57,091 to 57,271 requests and from
329,792,281 to 330,692,281 reserved microUSD: exact delta 180 / $0.90.
Its original 57,091-request prefix was unchanged, the append matched all 180
attempts, and pending attempts were zero. The campaign remained open;
$39.307719 was available outside protected $30 at closure. This retained
snapshot does not establish future affordability or authorize another run.

## Artifact identity and audit

Private raw source/answer bodies, blind labels/mapping, request snapshots and
databases remain retained locally. These public SHA-256 identities bind the
result without publishing their payloads:

| Artifact | SHA-256 |
| --- | --- |
| Prospective manifest | `70c2d284f6a4664021c227e295524f89035503b4c3b3a5253625e1fc497e8ce4` |
| Model-facing source inputs | `cb3834f6b4672e95fe5d79d51d93bcf3fe042a73f829aecc8b813b3e7ce8c118` |
| Evaluator rubric | `39bb513e254d489912540f9cdc762f7cac5c3dac70fc3f26f236ccf836b4c27e` |
| Judging protocol | `d4db35c96e3cce0eeb951c1f07e9678352d9b0ecd1df1925c80111844169430b` |
| Freeze | `a023c09187be25c10d20acbff13751fb536479b57bc157a09347d033411963fe` |
| Report | `0cc91d65c68e140c1126264ba0b14070af28cd59ac4f4f536cb2dcd623a037e7` |
| Coverage | `1ef563d2f985c41d006f1187ce8f094d7902dfaf5e4cab72e8995084682236cb` |
| Resource audit | `c319cccbbae3a6b2ac114f92d8d2108b3590f6e4a50eae3230286a561193e54f` |
| First judgment A | `00da555628bd166fb15b26bbb835c332ce3376e6e801f16f1e1fc7e103c9ceea` |
| First judgment B | `bcf6fb3fff15b66cd70bff50fd07f28b2d598ab710a9710ec016144a23f89577` |
| Agreement-only aggregate | `86de1448aad130050fd1c183faa0ca38c6230b87ad866caad19c1057c9a0ba8e` |
| Judgment identities | `918c551c551db7c34f3063ba149fb74dc0308954af6f3cf6c7d891db06407ad8` |

Independent nonauthor nonsemantic post-run audit passed on 360 request
snapshots, 366 bound observation hashes, six databases, cold-state/replay
identity and exact unchanged-prefix accounting. Its independent inventories
matched 382 nonblind material / 386 total files before the two aggregate files
were appended. Primary's post-score recursive-filesystem versus `find -print0`
inventory independently matched 384 nonblind / 388 total, with those two
appends accounted for; all 366 bound hashes and first-judgment identities
remained unchanged. Neither audit generated answers or altered scoring.

## Engineering acceptance and delivery boundary

Before the paid operation, primary's exact-runtime acceptance at `954507b`
passed 22 commands across Node 22.16.0 and 24.15.0, all actual exits 0:
algorithm 104, generic 669, lifecycle 27 and LongMemEval 210 tests per runtime,
plus three validators and three demos per runtime. Eighteen non-demo scratch
parents were removed through owned cleanup; four intentional demo SQLite files
were retained and independently inventoried. Two independent reviews and
manifest preflight reviews passed. Eighteen runtime/corpus/delivery files were
independently inventoried against dependency base
`afa68cb47ead699725aef6878194b6d4fe6f8236`.

The retained CI association records all 27 PR #394 checks successful on exact
runtime `954507b`, in runs 38127371283 / 38127371264 / 38127331367. These
engineering checks establish orchestration/containment, not QA superiority,
and do not certify the later documentation candidate. Historical one-off
inventory and manifest-check commands exited 1 on harness invocation/path
assumptions; corrected read-only checks exited 0 without runtime changes.

Results delivery is one bounded requested/actual GPT-6.1 Sol/high documentation
assignment under R1–R8, at runtime base `954507b`, in
`docs/large-pool-six-results`. Primary owns final-head contributor checks,
full-diff nonauthor Standards/Spec review and the existing PR #394 update;
those checks and latest-head CI remain pending at this worker checkpoint.
Primary's initial documentation numeric check exited 1 on a transcription:
C's packed-input sum was written as 4,543 instead of the actual 4,545. Correction
round 1 fixes that sum and labels its local-estimate field explicitly; it changes
no runtime, usage record, answer, first judgment or score. Worker verification
checks cover the corrected sum; primary's independent rerun remains due.
Worker `git diff --check`, mechanical numerical/hash/link checks and two-route
five-file inventory exited 0; the exact checks and correction are recorded in
the [delivery checkpoint](large-pool-six.md#results-delivery-ownership-and-checkpoint).
No commit, push, merge, release, deployment, paid rerun or old-run mutation is
performed by this documentation worker.

The next bounded direction is source-bound entity/answer-use diagnosis of the
retained failure boundary. This result establishes neither a definitive causal
mechanism nor a fix; it supplies no new paid plan and does not permit tuning
and rerunning L01–L06.
