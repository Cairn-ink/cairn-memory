# Relation-bound first-answer: closed diagnostic results

Decision: `reject-stop` under the unchanged [prospective RB1–RB9 contract](relation-binding-probe.md#acceptance-contract).
Baseline and relation-instruction arms each scored 12 correct / 0 incorrect /
0 unresolved, including six supported and six uncertain requested relations.
Paired correct-answer gain is zero; baseline targeted binding errors are zero.
Four abstention classifications remain null after first-judge disagreement, so
the frozen `safetyKnown` gate is false. `positiveSignal: false` and
`advances: false`. The instruction branch is closed: no tuning, corpus rerun,
rescore or default promotion follows.

This is a full-source, answer-only diagnostic on twelve newly authored cases,
not natural capture, MOC/retrieval quality, installed-host or end-to-end QA,
independent holdout, an official benchmark, competitive parity or a D12 repair.
The [earlier 24-case scores](complementary-qa24-results.md),
[six-case scores](large-pool-six-results.md) and
[16-answer format probe](large-pool-six.md#separate-closed-answer-format-probe-identity)
retain their original denominators and decisions; none is pooled or rescored.

## Frozen runtime and first judgments

Runtime `e1ebee6c015833453d873cc3258f658ddb752b40` executed once on
2026-10-11 with Node 22.16.0 and `gpt-4.1-mini-2025-04-14`, closing at
`2026-10-11T11:03:20.486Z`. Execution's actual exit was 0: all 24 first answers
completed, with no fatal, accounting or persistence failure. Blind preparation
and the single first scoring operation also exited 0; scoring closed at
11:08 UTC. No retry, resume, replacement, post-result top-up or adjudication
occurred. Successful execution is separate from diagnostic acceptance.

Both arms received the same full submitted source units, question, dates,
evidence order, model and output allowance. Forty original source units are
retained across the twelve cases (three or four per case); none was omitted.
Only the system instruction differs: treatment appends the fixed generic
relation-binding instruction. First-arm order is balanced six/six. All 24
serialized requests matched their prospectively frozen exact bytes.

Two fresh independent nonauthor blind judges, requested and actual GPT-6.1
Sol/high in separate fork-none contexts, each submitted all 24 first judgments:
`/root/relation_blind_a61` and `/root/relation_blind_b61`. They agreed on every
requested-correctness, unsupported, stale, severe and targeted-binding field.
They disagreed only on `abstained` for both arms of R03 and R11: judge A treated
an explicit nonappointment as a factual answer (`false`), while judge B treated
it as declining the requested identity (`true`). This uncertain-case distinction
was not defined prospectively. The original first submissions and four nulls
are retained without retrospective clarification or favorable adjudication.
Same-family agent agreement is not independent human ground truth.

## Fixed-denominator outcomes and gates

| Arm /12 | Completed | Correct | Incorrect | Unresolved | Known correct /6 | Uncertain correct /6 | Targeted binding errors | Unsupported / stale / severe |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Baseline | 12 | 12 | 0 | 0 | 6 | 6 | 0 | 0 / 0 / 0 |
| Relation instruction | 12 | 12 | 0 | 0 | 6 | 6 | 0 | 0 / 0 / 0 |

There are zero wins, zero losses, twelve both-correct pairs, zero neither-correct
pairs and zero unresolved correctness pairs. Known-answer abstention is zero
in both arms. Each arm has four agreed uncertain-case abstentions and two
unknown abstention classifications. Correctness is fully resolved; the
classification uncertainty is not a newly observed incorrect or harmful answer.

| Case / family | Answerability | Baseline | Relation | Agreed abstained, baseline / relation |
| --- | --- | --- | --- | --- |
| R01, supported two-hop | known | correct | correct | false / false |
| R02, missing link | uncertain | correct | correct | true / true |
| R03, explicit unknown | uncertain | correct | correct | null / null |
| R04, explicit alias | known | correct | correct | false / false |
| R05, transfer event time | known | correct | correct | false / false |
| R06, unresolved conflict | uncertain | correct | correct | true / true |
| R07, organization/scope collision | uncertain | correct | correct | true / true |
| R08, same ID in different environments | known | correct | correct | false / false |
| R09, role versus owner | known | correct | correct | false / false |
| R10, inapplicable time | uncertain | correct | correct | true / true |
| R11, proposal versus adoption | uncertain | correct | correct | null / null |
| R12, CJK alias and join | known | correct | correct | false / false |

| Frozen gate | Result |
| --- | --- |
| `noFatal` | true |
| `baselineOpportunities`, at least two targeted-error cases | false (0) |
| `positiveQA`, paired net correct >0 | false (0) |
| `knownNoRegression` / `knownUseful` | true / true |
| `safetyKnown` | false (four null `abstained` fields) |
| `correctnessKnown` / `noNewHarm` | true / true |
| `resourcesWithinLimits` | true |
| `positiveSignal` / `advances` | false / false |
| `decision` | `reject-stop` |

The frozen evaluator checks unresolved safety classification before baseline
opportunity or equal-QA branches. Its exact decision is therefore `reject-stop`,
not `inconclusive-stop`. No safety regression was observed in the agreed claim
fields. The baseline ceiling independently prevents this cohort from showing
the predicted binding-error reduction; zero QA gain closes the instruction
branch under RB7. No threshold or evaluator changed after answers.

## Observed resources and original ledger

All 21 frozen resource/integrity checks passed, including exact request bytes,
first-answer uniqueness, token/price caps, bounded request/case/run deadlines,
balanced order and ledger-delta accounting. Primary separately checked the raw
57,271-row ledger prefix and exact 24-row suffix in its independent postflight
audit; that raw-prefix check is not one of the 21 wrapper checks. Twenty-four HTTP attempts
reserved $0.12 at $0.005 each, below the $1 local ceiling. Local/provider input
caps remained 6,000/7,024 and output allowance 512 tokens. Maximum planned
local input was 710 tokens; provider usage below is measured separately.

| Resource | Baseline | Relation | Relation minus baseline |
| --- | ---: | ---: | ---: |
| First answers / HTTP attempts | 12 / 12 | 12 / 12 | 0 / 0 |
| Planned local answer-input tokens | 5,868 | 6,912 | +1,044 |
| Reported provider input tokens | 4,444 | 5,488 | +1,044 |
| Reported provider output tokens | 433 | 540 | +107 |
| Reported provider total tokens | 4,877 | 6,028 | +1,151 |
| Unknown-usage requests | 0 | 0 | 0 |
| Conservative reservation | $0.060000 | $0.060000 | $0 |
| Known model-profile usage estimate | $0.002475 | $0.003064 | +$0.000589 |
| Summed HTTP request elapsed, ms | 14,764.318 | 12,204.486 | −2,559.832 |
| Summed answer elapsed, ms | 34,443.162 | 32,272.190 | −2,170.971 |

Total usage was 9,932 input / 973 output / 10,905 tokens, estimated $0.005539
from the known model profile, not an invoice. Total run elapsed was
68,437.373 ms. The treatment consumed more input and output without a correct
answer gain. These one-run sequential timings do not establish a repeatable
latency improvement. There was no capture database or installed-host measurement;
peak RSS and CPU use were not measured.

The original cumulative ledger changed from 57,271 to 57,295 requests and from
330,692,281 to 330,812,281 reserved microUSD: exact delta 24 / $0.12.
All 57,271 original rows were unchanged, the 24-row suffix matched the actual
attempts, and pending requests were zero. The original $400 ceiling and
protected $30 remained intact; $39.187719 was available outside that protection
at closure. The campaign remained open. This retained accounting snapshot is
not a grant or a future-affordability check.

## Artifact identity and private evidence boundary

Operational source/answer snapshots, exact requests, blind packet and label
mapping, first judgments and local acceptance logs remain retained privately.
Those artifacts and local paths are not added by this delivery; the authored
synthetic source and rubric files are already tracked separately. The SHA-256
identities bind this report; they do not make the private artifacts independently
downloadable or the paid result reproducible from the public checkout alone.

| Artifact / identity | SHA-256 |
| --- | --- |
| Prospective manifest identity (canonical payload) | `486fb03867e10ead4ed6cb0032091ebbbf58495d5c5111e9b0a76702adea510c` |
| Prospective manifest file bytes | `847488f13e1ed1376dbd5b6e9d680151e1def9499f55b27fb37d17b2f2f60a1d` |
| Model-facing source inputs | `7e77946707382299c3e7f54a860cfe396895b032f83c6b3513f55fef98f1df64` |
| Evaluator rubric | `6b07b395a432b130f7cc67d2c41278e3585f6135beade8a59aaf3db1f4aa5a24` |
| Prospective plan at frozen runtime | `aeabe781771a459dd7713cbae9efdd9b61263ae72ccb3b4e9891de3dc3b942bb` |
| Report | `0779b80d2239bc0ab2f2395878fe9862366be59d1f656529a52ec3854cbbb701` |
| Resource audit | `6756b51d9a63e96242deb22f1b8a735bb85875d97ba662598a5b7e2ca5fe3ae6` |
| First judgment A | `19ed128a534843407673b076f7b0e026931db1b2348bffb4986517867be4be75` |
| First judgment B | `8a24a34975645d4035968c7f0fac9ec6adad09475f21b9432ae4546a27b98bc6` |
| Agreement-only aggregate | `8df3222aa7be8e49f6a5e7bb04498d5dce3b48370d68dcfe071ee8173ba50215` |
| Judgment identities | `fcaf512d455156418aa08ca0ae770669890de0163b847d757660c45dd4be1a68` |

Primary's independent nonsemantic postflight audit exited 0 at 11:06 UTC,
matching recursive `lstat` and scoped `find` inventories: 108 artifacts at that
checkpoint, including 99 observations and 48 request snapshots; all 434 frozen
runtime hashes passed. It verified the exact unchanged ledger prefix and
24-attempt append without changing ledger bytes. Later judge/score artifacts
are additional files; 108 is the pre-judgment checkpoint count, not a claim
about the final directory count. First scoring recorded all 99 observation
identities unchanged and made no provider calls or ledger writes.

The instruction branch is closed. The next proposed direction is a bounded
relevant-source MOC candidate-visibility experiment, with controls that establish
query relevance and trace retained source through the actual visible pages.
The existing offline 96-card scripted source-backed pressure diagnostic retained
the target source but did not expose it in two inspected visible pages. Its
generic query had no explicit identity link to that target; this is visibility
pressure evidence, not a semantic QA failure. No MOC fix, D12 repair claim or
repeat of this closed answer corpus follows from it.

## Engineering acceptance and delivery boundary

The [prospective plan's verification history](relation-binding-probe.md#worker-verification-record)
retains the initial offline failures and their pre-paid corrections. Primary's
earlier precommit matrix ran 24 commands across Node 22.16.0/24.15.0, all actual
exits 0, including generic 669/669 and workspace-lifecycle 27/27 per runtime.
After the independent-review corrections, the affected matrix ran 16 commands,
all actual exits 0: algorithm 121/121 and LongMemEval 212/212 per runtime,
root validation, four LongMemEval demos and runtime version. Those are
precommit-content checks, not later docs-head CI. Primary then reran the three
focused relation files on exact runtime `e1ebee6`, 19/19 with actual exit 0 on
both Nodes. Two independent nonauthor Standards/Spec reviews passed the full
fixed diff at that same runtime, and both private manifest preflight axes passed.

Before paid execution, all 27 PR #395 checks succeeded on exact `e1ebee6`;
retained run associations are 38133648374 / 38133648308 / 38133617812. These
engineering gates establish the diagnostic's plumbing and containment, not
semantic superiority. Results documentation uses a separate worktree/branch
`cairn-memory-worktrees/relation-binding-results` / `docs/relation-binding-results`
from that fixed runtime. Its primary acceptance, final independent reviews,
commit and latest-head CI are separate delivery gates and remain pending at
this writing. The frozen execution worktree is unchanged. No merge, release,
deployment, paid rerun or broader MOC fix is part of this results delivery.

The bounded results-documentation owner was `/root/relation_results61`, actual
GPT-6.1 Sol/high, with primary retaining integration/acceptance. Only five docs
were edited. Worker numeric/hash checks matched all twelve paired rows, seven
artifact byte hashes, four frozen identities and all 21 resource checks, actual
exit 0. Git diff plus untracked discovery independently matched tracked HEAD
bytes plus scoped filesystem discovery: five changed files, exit 0; changed-doc
local links passed in that same check. `git diff --check` exited 0. Direct
`node scripts/validate-json.mjs` exited 0 on both pinned Node versions. These
worker checks do not replace primary's required final-candidate gates or reviews;
no commit, push, provider call or ledger write occurred in this documentation
assignment. Worker token/cost and routing elapsed-time measurements are unknown.
