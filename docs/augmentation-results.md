# Bounded augmentation: retained once-only results

The candidate is **not promoted**. More visible candidates did not reliably
preserve changed reasons through ranking or answer synthesis. Two histories
lost a required passage the baseline retained. Complete-source controls also
made reason/commitment errors. This is a negative diagnostic, not a product
accuracy claim or proof that a particular architecture cannot improve.

## Frozen execution and limits

The [protocol](augmentation-comparison.md) ran once on six histories (three
authored matched pairs), eighteen capture windows and eighteen answer slots.
All eighteen captures/classifications and cold inspections completed. Each
history reached 5,10,15 active user memories; all32 required passages were
admitted. The twelve-memory complete-snapshot limit correctly rejected all six
final snapshots. Of108 staged source statements,90 user statements were
admitted; assistant suggestions were not adopted into ordinary memory.

Baseline recall completed5/6; augmentation6/6. Seventeen answers completed:
five baseline, six augmentation and six canonical full-source controls. The
remaining baseline answer was **not run**, not a correct abstention. Source-based
experimental stdio used48 distinct child processes, all closed. This is not
an installed candidate CLI, natural host tool-choice test or human-use study.

Model: `gpt-4.1-mini-2025-04-14`; source candidate
`94e77a6f13fb0774cdae194072929bfc1010f433`. Ordinary and augmented recall used
the same captured store and alternated order. The candidate retained the
ordinary selector call, appended visible references in map order up to the
existing twelve-per-namespace limit, and used the unchanged rank limit6.
Both answer arms retained the original instruction and source representation.
No failed case was retried, regenerated or replaced by its control.

The a01a baseline failed at the adapter's usage check: preflight2251 versus
observed2377 input tokens,123 output and2500 total. Input-bearing count and
generation fields matched, and the returned references were valid. A fake-HTTP
replay reproduces `response_usage`; the public tool reports `invalid_tool_result`.
The provider-side cause is unknown. A separate bounded-usage repair cannot
retroactively turn this failed arm into a success.

## Evidence retention is not answer fidelity

Counts below concern predefined required source passages, not semantic scores.
`—` is an uncompleted baseline arm, not zero measured recall. All required
passages were visible in the maps for the eleven completed recall arms.

| History | Required | Baseline final | Augmentation candidates | Augmentation final | Missing after augmentation |
| --- | ---: | ---: | ---: | ---: | --- |
| a01a | 5 | — | 4 | 4 | w2m3 at selection |
| a01b | 5 | 3 | 4 | 3 | w2m3 at selection; w2m1 at ranking |
| a02a | 6 | 4 | 5 | 4 | w2m2 at selection; w2m1 at ranking |
| a02b | 6 | 4 | 6 | 3 | w2m1,w2m2,w2m4 at ranking |
| a03a | 5 | 4 | 4 | 3 | w2m2 at selection; w2m3 at ranking |
| a03b | 5 | 3 | 4 | 4 | w2m3 at selection |

Suffixes inherit the history ID. Baseline retains18/27 across its five completed
histories, with a separate failed5-passage history. Augmentation retains21/32
across six histories. On the five jointly completed histories it retains17/27,
versus baseline18/27; these denominators must not be collapsed into a misleading
18-to21 improvement. It loses a02b-w2m4 (successful hanging test) and a03a-w2m2
(price reversal), while gaining a03b-w2m2. The latter was already in that arm's
ordinary selector output, so its gain cannot be attributed to padding alone.

Within augmentation,22 original seed references become72 candidates, containing
27 required and45 predefined irrelevant passages. Only21 required references
survive ranking, and no predefined irrelevant passage reaches a final answer.
This candidate exposure is real work/data, not free recall. All three displaced
original augmentation seeds are in a02b: the leaning problem, wet readability
check and successful hanging test. Ranking returns only3–4 passages per history,
below its cap6. Five augmentation omissions are at selection and six at ranking;
baseline's nine omissions across completed arms are eight selection and one
ranking. The failed arm's missing-stage attribution remains unassessed.

All eleven completed retrievals contain the decisive qualifier passage. That
does not prevent an answer from strengthening its commitment. Exact accepted
reference unions were reconstructed with the pinned compiler and checked against
actual rank inputs, outputs, final receipts and host inputs. Identity/coverage
checks do not establish relevance, truth or current applicability.

## Review of every answer slot

The DRI and two separately working agents inspected all17 answers, the not-run
slot, actual input receipts and the original fixture/rubric. Review was nonblind
and same-family. One reviewer authored the operator; the other authored the
fixture/rubric, augmentation helper and analyzer. Neither authored provider
answers; neither is an independent human or independent-model benchmark.

- **a01a:** Baseline is not run. Augmentation preserves the tentative cover
  choice, reversed price and Elin's independent March choice. It says original
  reasons are only partly supported but lacks the renewed folding test and does
  not clearly identify the surviving reason. Control explicitly distinguishes
  higher price from reaffirmed clean folding and preserves tentative status.
- **a01b:** Baseline and augmentation say lower cost and clean folding remain
  supported, while both inputs omit the price reversal and folding retest.
  Control has those sources but still says both reasons remain supported while
  acknowledging the higher price: an answer-stage contradiction. All preserve
  the firm February choice and Elin's separate decision.
- **a02a:** Both retrieved answers preserve the provisional trial and actor
  separation but omit the planned return despite receiving it. Baseline explains
  the hanging test; augmentation omits that available explanation and treats
  trial-only scope as the cause of uncertainty. Both lack changed soil stability
  and reaffirmed readability. Control explains the jet problem and preserves
  the future return as a plan, but attaches upright stability to that return
  without renewed evidence. A historical/general reading is possible; retain
  that ambiguity rather than label it an unequivocal falsehood. The explicit
  wet-readability reaffirmation is not clearly distinguished.
- **a02b:** All preserve confirmed-but-trial-only status, a planned rather than
  completed return, and Oren's independence. Baseline explains the hanging test;
  augmentation loses it and says the usual arrangement is preferred because
  stakes stay upright, blurring historical reasons with continued support.
  Control has all sources but omits the stability change, readability check and
  successful hanging test. Correct choice alone is not a complete explanation.
- **a03a:** Baseline preserves uncertainty but invents price as its cause and
  says original reasons persist despite receiving the price reversal.
  Augmentation loses that update and says lower price still holds; it also
  strengthens “我暫定” into “選擇較確定”. Control receives all evidence but uses
  reaffirmed lightness to infer stronger commitment. All distinguish 映竹's
  separate group and leave the budget approver unknown.
- **a03b:** Baseline preserves the confirmed choice but falsely says both
  original reasons still hold, with both updates absent. Augmentation reports
  higher price but omits renewed lightness. “這點仍成立” has an ambiguous
  antecedent, plausibly higher price; it is not confidently graded as retaining
  cheapness. It still fails to identify the surviving reason clearly. Control
  separates reversed price from reaffirmed lightness. All preserve actor/scope
  and decline to invent a budget approver.

No observed answer adopts an assistant replacement suggestion or invents an
approval actor. These limited observations do not certify authorization safety,
multilingual reliability or general semantic quality. Source omissions,
unsupported causal inference and incomplete explanation remain distinct.

## Resources and retained provenance

There were171 guarded HTTP attempts:77 source counts,77 source generations and17
host answers. The run conservatively reserved US$1.62 of its US$3 ceiling, with
US$0.110755 known usage estimate and77 unknown-cost requests. Unknown is not free;
estimates are not invoices. The unchanged US$50 campaign moved from1614 requests /
US$19.076 reserved to1785 / US$20.696, with zero unsettled requests and no cleanup
failures. Cumulative known estimate US$1.191397, unknown845, conservative headroom
US$29.304. The older US$20 campaign is not renewed allowance.

| Answer arm | Completed slots | Source UTF-8 bytes | Provider prompt tokens | Completion tokens |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 5 | 2965 | 1758 | 548 |
| Augmentation | 6 | 3519 | 2070 | 647 |
| Canonical control | 6 | 13257 | 5057 | 833 |

Different completion denominators prevent direct aggregate efficiency claims.
Source generations additionally used169628 input /22520 output tokens. Guarded
host request durations ranged1.832–2.262s baseline,1.649–4.386s augmentation and
1.815–4.709s control; these include experiment overhead, not production latency
or a repeated performance benchmark. No empty selector seed or budget overflow
was observed; the usage mismatch remains a distinct recorded rejection.

Private synthetic evidence is retained under `cairn-augmentation-live-R8G0HT`.
The raw report binds request/response traces, source/dependency hashes, receipt
identity, process closure and budget snapshots. SHA-256 identities:

- Report: `79b5dfebaea12dce4cb65808b986fc7f43d9b4e9bd530ae5e45bbe776c277953`.
- Fixture: `fd1b9ef8fef8b7970f315553fe95c0f1d7c6d6b707242f78c88b8ff6d58fd9e0`.
- Rubric JSON: `bb4d089b899ca2b89c64f3c7762cf2265142768c759ab2e3c820e0da58d5502b`.
- Frozen protocol: `8a7eed3e6d93212750e52fb73222b6972c5e8714ea025c8375bb70d4a3278629`.
- Operator: `26a71e7c2d7810001b8d6aa319b44cf98e09fb0a8132b3773814ce559ecca04c`.
- Launcher: `860129f2a7e17e467e7f13d338a4f5ff0ad2b2f6a8552d8bf62a3937c74d96d8`.
- Comparison helper: `989e9c1ce82ac6798412d61734d4e969a6e438f16d31c120f4957d5025f4e1c9`.
- Read-only analyzer: `9fe24e902b41e03e667b6f711d8db227873109acf72c63f6eb7bf56ab835a30f`.

Six fake-HTTP rehearsals covered success, invalid selection, source failure,
transport halt, answer failure and cleanup failure before the once-only live
run. The read-only analyzer has10 offline regressions on Node22.16/24, including
canonical query normalization; the comparison helper has six on both runtimes.
Neither mocks nor analyzer tests are semantic evidence. No public package,
deployment, default selector switch or private-service change occurred.

## Decision and next work

The frozen no-regression rule fails. Keep augmentation evaluation-only. The next
bounded investigation separates candidate coverage from **source-linked answer
accounting**: explicit recorded choice and strength, original reasons, later
challenge/reaffirmation, and what remains unknown. A change in one reason must
not become a changed decision or new authorization. Reuse existing receipts and
decision-basis boundaries before considering another persistent graph. Full
source controls show why merely increasing caps or removing ranking cannot
solve every failure. Any new hypothesis needs independent offline verification
and a fresh frozen comparison; these results do not validate that future design.
