# Closed dialogue-context QA result

**STOP the predecessor-context candidate.** Both arms produced 14 supported
answers and two wrong completed answers out of the fixed 24 first attempts;
eight outcomes per arm had no completed answer. There were zero gains, zero
regressions, zero newly unsupported/severe/stale issues and zero lost supported
required decisions. There is no measured answer-quality lift.

The unchanged 30-minute deadline stopped the run on 2026-10-17 (Asia/Taipei),
with terminal reason `run_deadline` and actual process exit code **1**. The
public runner result records `stopped` / `assert_active_failed`; the partial
baseline arm failed at packing. These are distinct layers of the same stop,
not missing rows or unresolved semantic ratings. Original attempts are closed:
no retry, repair, extension, replacement question or post-unmask regrading.

The [frozen contract and R1–R8 delivery requirements](dialogue-context-qa.md)
govern this report. The execution runtime was
`884b03b2274558b6e64f9db2bd7d36a93cc9b794`, using the fixed
`gpt-4.1-mini-2025-04-14` snapshot. All submitted source material is synthetic.

## All first attempts

“Supported” means completed, all required claims correct and supported, and no
material assertion issue under the supplied adjudication. “Wrong” means a
completed answer failed that whole-answer rule. Failed and not-run outcomes
remain in the denominator and receive no wrong-answer or success credit.

| Outcome | Baseline | Candidate |
| --- | ---: | ---: |
| Supported answer | 14 | 14 |
| Wrong completed answer | 2 | 2 |
| Failed execution | 1 | 0 |
| Not run | 7 | 8 |
| Total first attempts | 24 | 24 |
| Unresolved semantic judgments | 0 | 0 |

The frozen rubric has 38 required claims, including 34 positive necessary-
evidence claims across 20 cases and four insufficient-information claims.
Neither arm reached the four insufficient-information cases; this result
provides no observed uncertainty-answer performance for those cases.

| # | Case ID | Question topic | Baseline | Candidate |
| ---: | --- | --- | --- | --- |
| 1 | `7b6e201a9c43` | Pottery class consideration | Supported | Supported |
| 2 | `a2d97308fb61` | Prerequisite for train visit | Supported | Supported |
| 3 | `e04b7c926d15` | Book club commitment | Supported | Supported |
| 4 | `19f82a5c40de` | Curtain/blind condition | Wrong | Wrong |
| 5 | `c85a1603e7bd` | Yarn choice and purchase | Supported | Supported |
| 6 | `4d9b20af8673` | Picnic food and dressing | Supported | Supported |
| 7 | `86ce35b149a0` | Backup routine and first copy | Supported | Supported |
| 8 | `d71a6fb2308c` | Blanket destination and count | Supported | Supported |
| 9 | `2ea5419cd670` | Detergent rejection and plan | Wrong | Wrong |
| 10 | `b9037e14a5cf` | Trail navigation plan | Supported | Supported |
| 11 | `5f8d69a207bc` | Cooking course rejection | Supported | Supported |
| 12 | `f24c0b8e916d` | Desk protection choice | Supported | Supported |
| 13 | `a6e3107fd258` | Corrected reading time/place | Supported | Supported |
| 14 | `08b5d92e46ac` | Corrected cat age/sex | Supported | Supported |
| 15 | `63dc1a70be95` | Optician and corrected time | Supported | Supported |
| 16 | `eb7294f108da` | Corrected workshop fee/date | Supported | Supported |
| 17 | `94ac820e7f36` | Canal observation/camera | Failed | Not run |
| 18 | `3c1f75a9d082` | Loaf observation and baking change | Not run | Not run |
| 19 | `6a08de4b137f` | Flickering lamp and cause | Not run | Not run |
| 20 | `fd2649a08c71` | Knee-ache timing | Not run | Not run |
| 21 | `15d8f02bc6a9` | Unknown kitten name | Not run | Not run |
| 22 | `c0b7a3149ed2` | Unknown flat | Not run | Not run |
| 23 | `7ed65a209bf4` | Unknown ferry confirmation | Not run | Not run |
| 24 | `ba418f630d97` | Unknown soup | Not run | Not run |

## Every Q8 check

| Frozen check | Result | Observation |
| --- | --- | --- |
| At least three net supported-answer gains | Fail | 0 gains − 0 regressions = 0 |
| Increased retained necessary evidence | Fail | Candidate 27/34; baseline 29/34 |
| Increased packed necessary evidence | Fail | Candidate 27/34; baseline 29/34 |
| No paired completion loss | Pass | No baseline-completed case became candidate-incomplete |
| No newly unsupported assertion | Pass | One equivalent existing issue in each arm; no new issue |
| No newly severe assertion | Pass | Zero severe occurrences |
| No newly stale assertion | Pass | Zero stale occurrences |
| No lost supported required decision | Pass | Zero lost decisions |
| No unresolved judgments | Pass | Zero unresolved claims or pairs |
| Completed run | Fail | 32 completed arms, one failed, 15 not run |
| Formal opportunity guard | Pass | Remaining answer/quote gaps across the full denominator |

The final scorer `pass` is **false**. A passing paired completion check does
not make the run complete. The formal opportunity guard includes cases that
were never answered; it does not establish opportunity in the completed pairs.

## Evidence delivery and the two wrong answers

Formal retained and packed positive claim coverage is baseline **29/34** versus
candidate **27/34**, with 17 versus 16 fully covered positive cases. The partial
17th case accounts for the two-claim difference: baseline retained and packed
its one 138-byte passage before stopping, but delivered no answer; candidate
did not run. This is not an observed paired evidence regression. Positive
coverage excludes all four insufficient-information cases, whose quotes are
audit context rather than evidence that an unspecified fact does not exist.

As an explicitly **secondary** diagnostic, restrict comparison to the 16 cases
where both arms completed. Both retained and packed all **27/27** necessary
claims. Baseline packed **38 passages / 2,873 source bytes**; candidate packed
**44 passages / 3,163 source bytes**. Ten answer requests were identical and six
differed. These source-byte counts exclude request framing and are not token
counts. Formal all-attempt source bytes are 3,011 versus 3,163. The extra
passages increased context size without increasing necessary-claim coverage
in the completed pairs.

In the curtain case, both answers omitted the user's requirement to see a
fabric sample first. The full source sentence, including that condition, was
delivered to both arms. This is a missing required condition, not a fabricated
assertion issue. In the detergent case, both correctly stated lavender
rejection and the plan to use the current unscented bottle, but added an
unsupported history that lavender had caused the earlier headache. The source
only attributes that headache to unspecified scented detergent; the necessary
source was present in both arms. This is one shared unsupported proposition,
with one occurrence per arm. These observations do not establish the model's
internal cause or prove a different answer policy would fix either failure.

## Masked judgment and calibration limits

Two non-author raters and a fresh adjudicator judged before unmasking. All
**152 correctness/support boolean comparisons** agreed. The originals retain
two source-ID-only differences and one issue-existence disagreement, resolved
while masked. For the optician, the shorter source-ID set was sufficient. For
detergent, the exact wording “specifically lavender-scented detergent” did not
assert rejection of every scented variant, so that separate alleged issue was
excluded. The lavender-specific headache embellishment remains flagged in
both answers. There were no severe/stale occurrences or unresolved judgments.

These were same-family agent judgments, not independent human calibration.
Masking removed arm labels; visible delivered contexts can reveal the
intervention. The pure scorer checks packet integrity and aggregates supplied
judgments; it does not independently establish semantic correctness.

## Structural audit and dated accounting

The independent structural audit inspected **616 records**, found **zero
errors**, and passed its structural checks. It explicitly marked execution
incomplete and Q8 evidence ineligible. A valid accounting/capture record is not
a semantic or promotion pass.

| Observation at the post-run audit | Value |
| --- | ---: |
| Physical HTTP requests | 164: 82 input counts + 82 generations |
| Generation split | 17 extraction + 33 classification + 32 answer |
| Generation usage | 44,529 input + 4,711 output tokens |
| Conservative reserved delta | US$0.82 |
| Known generation estimate | US$0.025381 |
| Count-endpoint cost | Unknown |
| Agent/judging cost | Unknown |
| Original cumulative reservation | US$339.142281 |
| Protected amount | US$30 |
| Remaining outside protected amount | US$30.857719 |
| New unknown / pending usage | 0 / 0 |

The generation estimate is not an invoice. No reservations were refunded or
reset. These are dated observations of the existing cumulative accounting,
not a fresh grant to dispatch requests.

## Public replay and integrity conventions

The [recorded packet](../../evaluation/architecture/fixtures/dialogue-context-qa-recorded-v1.json)
contains source, rubric, `report.result`, seed, both original rater objects,
accepted masked judgments, a public notes projection, structural audit,
accounting observations and exact expected score. It excludes operating
configuration, ledger state, local paths and credentials. The notes projection
omits only `validation.node`. Parsed originals preserve judgment values; this
JSON packet does **not** reproduce each original file's literal whitespace.

`provenance.originalArtifactSha256` identifies literal original artifact bytes.
`publicObjectSha256` and `publicRaterObjectSha256` identify the public objects
serialized with `JSON.stringify(value, null, 2)` plus one LF, preserving key
order. Those hashes are intentionally different where projection or original
formatting differs. The scorer's packet digest uses its existing recursive
key-sorting convention. Raw frozen source/rubric and runtime hashes are recorded
separately in `frozenFileSha256`.

| Hash identity | SHA-256 |
| --- | --- |
| Public recorded packet bytes | `ae8cbe10395ab04d20782cc66b0f8a0d3cbdea5b835d52f24bc48f88748f647b` |
| Public `report.result` object serialization | `a3c3b1d611848817a3f34a19ea8e331d6341554daf8a357abe8982151dccaf38` |
| Accepted judgment serialization / original bytes | `31978dd3ae9ab56749843a9397fc7940673083fedd8522b1c3c3b00e78d0e518` |
| Public notes object serialization | `9f2230b605b0c0927fc5c16d5296cc63d4d2e7c7359fcba8bac4b43d1dd70451` |
| Expected score serialization / original bytes | `019915bf4c4fb0f118682a5de84b3856a746eb53b0eed7cbf8a3a13623466027` |

The [offline replay test](../../evaluation/architecture/test/dialogue-context-qa-recorded.test.mjs)
reconstructs the masked packet and calls the unchanged scorer. It verifies
hashes, all 24 statuses, the fixed denominator, exact score, every gate,
preserved disagreements and the secondary paired arithmetic. It performs no
model call and no new semantic judgment. Run separately on Node 22.16.0 and
24.15.0:

```sh
node tools/testing/run.mjs evaluation/architecture/test/dialogue-context-qa-recorded.test.mjs
```

## Disposition and remaining boundary

Stop this candidate. The completion, necessary-evidence improvement and
net-answer-gain gates failed. Even the completed portion had no necessary-
evidence opportunity, so correcting operating overhead alone does not justify
spending on the reserved fresh cohort. That cohort remains unused and was not
launched.

This tiny source-only diagnostic resolves every admitted memory; it does not
measure ordinary MOC/vector retrieval, LongMemEval, or competitive benchmark
parity. It authorizes no algorithm/default promotion, Stage 3, source-retention
contract change, merge, release or deployment. The next bounded work is a review
of multi-memory retrieval/assembly opportunities. No successor mechanism has
been selected or shown successful.
