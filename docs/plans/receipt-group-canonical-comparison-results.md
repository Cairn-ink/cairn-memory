# Closed canonical selection-policy QA24 result

Disposition: **STOP CURRENT CANONICAL CANDIDATE**. Ordinary A has 21 correct
answers; canonical B has 19, over the same fixed 24 questions. B delivered more
required anchors but failed the unchanged accuracy and safety gates. Operator
exit 0 and accepted accounting do not establish semantic success. No promotion,
default change, Stage 3 advancement or product acceptance follows.

This is the source-free result of one consumed operation at runtime
`fa5e6d1b4f8e56ad89c7fcc0c63426d3a867a070` (PR #419). The
[fixed Q1–Q8 contract](https://github.com/Cairn-ink/cairn-memory/blob/fa5e6d1b4f8e56ad89c7fcc0c63426d3a867a070/docs/plans/receipt-group-canonical-comparison.md)
and [three-stage plan](reliability-three-stage.md) retain their original gates.
The preceding canonical six-case structural pass permitted this fresh QA24;
it was not an answer-quality score and does not override this rejection.

## Population and matched comparison

The frozen, hand-authored synthetic population has six families of four cases:
24 questions, 216 scripted literal cards, 240 source turns and 31 required
positive anchors. Genuine project-scoped indexed-evidence capture, cold stores
and complete source/role/date wrappers were used; extraction/classification
were scripted bookkeeping, not measured model memory formation.

A uses ordinary rank plus genuine card-plan assembly; B uses the separately
versioned canonical receipt-group selector plus genuine assembly. Both use the
same complete flat whole-card answer packing. Query and ordered candidate
identity, revision, currentness, receipt IDs, roles and full wrapped excerpts
were matched on actual count/generation wires before policy-envelope translation.
Instruction/schema/constraints and resulting selection order are intended
policy differences; this does not isolate deduplication alone.

The evaluated model remained `gpt-4.1-mini-2025-04-14`. Local input 6,000,
provider count 7,024, selection output 1,024 and answer output 512 token caps
were unchanged, as were core logical 30-second, physical 200-second, case
1,200-second and run 28,800-second bounds. No additional answer-format arm,
source shortening after selection or default/profile change was introduced.

## One frozen first score

Two distinct nonauthor, same-family blind judges each submitted one first
response. Correctness and harm/rule observations use agreement-only scoring,
without adjudication. These are their original recorded verdicts, independently
recounted for this report, not new judgments or a rerun of the scorer.

| Arm | Correct | Incorrect | Unresolved | Unanswered | Completed answers |
| --- | ---: | ---: | ---: | ---: | ---: |
| A ordinary | 21 | 3 | 0 | 0 | 24/24 |
| B canonical | 19 | 3 | 0 | 2 | 22/24 |

Net correct B−A is **−2/24** (−8.3333 percentage points), not the required
at least +3/24. The paired transitions are 17 correct/correct, 2
incorrect/correct, 2 correct/incorrect, 2 correct/unanswered and 1
incorrect/incorrect; they sum to all 24 pairs. RQ10/RQ17 are B wins;
RQ12/RQ19 are semantic losses; RQ22 is a shared semantic failure.
RQ01/RQ02 are unanswered B selections, not incorrect accepted answers.

| Family, fixed denominator 4 | A correct / incorrect / unresolved / unanswered | B correct / incorrect / unresolved / unanswered | A / B completion |
| --- | --- | --- | --- |
| detail-retention | 4 / 0 / 0 / 0 | 2 / 0 / 0 / 2 | 4/4 / 2/4 |
| lexical-paraphrase-cjk | 4 / 0 / 0 / 0 | 4 / 0 / 0 / 0 | 4/4 / 4/4 |
| multi-session-links | 3 / 1 / 0 / 0 | 3 / 1 / 0 / 0 | 4/4 / 4/4 |
| event-time-late-import | 4 / 0 / 0 / 0 | 4 / 0 / 0 / 0 | 4/4 / 4/4 |
| proposal-adoption-premise | 3 / 1 / 0 / 0 | 3 / 1 / 0 / 0 | 4/4 / 4/4 |
| unknown-conflict | 3 / 1 / 0 / 0 | 3 / 1 / 0 / 0 | 4/4 / 4/4 |

Actual-sent required-anchor presence was **25/31 A versus 29/31 B**, a gain
of four. This is literal presence with source/role binding, not semantic
support, correct interpretation or answer utility. Missing B answers receive
no sent-anchor credit and remain in every fixed denominator.

The exploratory paired percentile interval is **[−29.1667 pp, +12.5 pp]**,
using fixed seed 20261013, Mulberry32, 10,000 draws of 24 paired case indices
with replacement and sorted indices 249/9749. Correct is 1; every other outcome
is 0. It is not a significance or random-population interval. Unresolved
best/worst net bounds are **[−2, −2]**; known unanswered slots cannot receive
hypothetical correct credit.

### All 24 paired outcomes

| Case | A | B |
| --- | --- | --- |
| RQ01 | correct | unanswered |
| RQ02 | correct | unanswered |
| RQ03 | correct | correct |
| RQ04 | correct | correct |
| RQ05 | correct | correct |
| RQ06 | correct | correct |
| RQ07 | correct | correct |
| RQ08 | correct | correct |
| RQ09 | correct | correct |
| RQ10 | incorrect | correct |
| RQ11 | correct | correct |
| RQ12 | correct | incorrect |
| RQ13 | correct | correct |
| RQ14 | correct | correct |
| RQ15 | correct | correct |
| RQ16 | correct | correct |
| RQ17 | incorrect | correct |
| RQ18 | correct | correct |
| RQ19 | correct | incorrect |
| RQ20 | correct | correct |
| RQ21 | correct | correct |
| RQ22 | incorrect | incorrect |
| RQ23 | correct | correct |
| RQ24 | correct | correct |

## Safety and unchanged gates

| Question-level observation, denominator 24 | A | B |
| --- | ---: | ---: |
| Known unsupported claims present | 2 | 3 |
| Known stale-use claims present | 0 | 0 |
| Agreed predefined severe-rule flags | 2 | 2 |
| Produced-answer safety unknown/disagreed | 2 | 0 |
| No accepted answer: safety N/A, not clean | 0 | 2 |

A's RQ12/RQ17 safety disagreements are not safe observations. RQ17 still has
an agreed severe-rule flag despite disputed claim counts. A severe cases are
RQ17/RQ22; B severe cases are RQ19/RQ22. **RQ19 is a new severe regression**:
equal aggregate severe counts do not satisfy the per-case no-new-severe gate.
Known unsupported-question counts are lower bounds, not credit for unknown
claims. Correctness on full truth and support from actually delivered evidence
are different tests.

Each judge's original claim totals remain separate, without forcing identical
segmentation or pooling disagreements. Across the 46 produced answers in both
arms, judge 1 records 9 unsupported / 0 stale / 5 severe claims over 78 reviewed
claims; judge 2 records 9 / 0 / 4 over 70. These combined-arm per-judge totals
are not agreement-based arm scores or substitutes for the question-level gates.

| Frozen gate | Observation | Result |
| --- | --- | --- |
| Net correct gain at least +3/24 | −2/24 | FAIL |
| Strictly improved actual-sent anchors | 25/31 → 29/31 | PASS |
| No higher unsupported-question count | 2 → 3 | FAIL |
| No higher stale-use count | 0 → 0 | PASS |
| No newly failing predefined severe case | New B RQ19 | FAIL |
| Known produced-answer safety | A RQ12/RQ17 unknown/disagreed | FAIL |
| Resource/integrity accounting accepted | Closed audit accepted | PASS |

The fixed scorer records `advance:false` / revise-or-stop. The primary DRI
chooses **STOP** for this candidate; no old threshold, verdict or cohort changes.

## Failure boundaries, not model-internal causes

Static inspection of RQ01/RQ02's retained first requests/responses shows each
B proposal has one raw group spanning four distinct cards against cap three.
Exact receipt IDs and schema fields otherwise match; both provider envelopes
completed. This is a sufficient violated predicate at
`compileCanonicalReceiptGroupPlan`, not a replayed stack or a claim about why
the model chose that grouping. Terminal/context overlap is explicitly allowed
by canonical v1 and is not blamed. No truncation cause is established.
No response was repaired, split, retried, recompiled or hypothetically rescored.

The two selection failures are not the sole semantic problem. Primary's
read-only boundary check matched all six RQ12/RQ19/RQ22 actual answer requests
to their checked packers and found zero packing omissions:

| Case | A / B sent required anchors | Recorded B answer-use boundary |
| --- | --- | --- |
| RQ12 | 1/2 / 2/2 | Required evidence was delivered alongside another object's location; the first answer was incorrect and unsupported. |
| RQ19 | 1/1 / 1/1 | Explicit non-reconfirmation evidence was delivered; the first answer asserted current adoption using another object's information, a new severe failure. |
| RQ22 | 0/1 / 1/1 | Both conflicting values and the unresolved record were delivered; the first answer gave a definite resolution. A also failed. |

These source-free observations retain the original judgments. They do not prove
distractor/order effects, a formatting cause, a model-internal mechanism or a
successful intervention. Cap compliance alone is not QA improvement.

## Resources, accounting and immutable closure

The operation closed with actual operator exit **0**. The closed audit accepted
accounting: **142 physical requests / 142 intents = 48 count + 48 selection
generation + 46 answer**, **94 generations**, zero unknown/pending intents.
New conservative reservations were **US$0.71**. The **US$0.055196**
provider-reported generation estimate is neither invoiced cost nor independent
billing verification, and reservations are not refunded.

At closure cumulative reserved cost was **US$334.982281**; under the original
US$400 ceiling, **US$35.017719** remained beyond the protected US$30.
This is a historical closed checkpoint, not current affordability or dispatch
authority. All **815 files / 2 directories**, including **54 prepared files**,
were preserved. A successful process/accounting audit is not a semantic pass.

Sources, stores, literal first requests/responses, first judge replies and first
score are immutable. All older six/QA cohorts remain closed forever: no replay,
reprepare, repair, recompile, rescore, rejudge, pooling or replacement.

## Identity and firstness receipts

SHA-256 values below bind the fixed public inputs/runtime and retained private
first artifacts; no raw passages, answers, receipt IDs or private locations are
published. Hashes support inspection but do not alone authenticate provenance,
author identity or judge independence.

| Fixed public file | SHA-256 |
| --- | --- |
| [receipt-group-canonical-comparison.md](https://github.com/Cairn-ink/cairn-memory/blob/fa5e6d1b4f8e56ad89c7fcc0c63426d3a867a070/docs/plans/receipt-group-canonical-comparison.md) | `c55bbc4ff79241b538df3dc304d54f1ca20b21bd66552c1e17964ff4f2453b71` |
| [receipt-group-canonical-comparison-cases.json](https://github.com/Cairn-ink/cairn-memory/blob/fa5e6d1b4f8e56ad89c7fcc0c63426d3a867a070/evaluation/algorithm-development/receipt-group-canonical-comparison-cases.json) | `99576fcbe40d1a228d81bdc0f135e3358269e994b724821d036de3e9f65efa25` |
| [receipt-group-canonical-comparison-rubric.json](https://github.com/Cairn-ink/cairn-memory/blob/fa5e6d1b4f8e56ad89c7fcc0c63426d3a867a070/evaluation/algorithm-development/receipt-group-canonical-comparison-rubric.json) | `07b7601424962fe9dff3c868f5f6c671a7fbedc3e8cba4d775d3b8c12620c143` |
| [receipt-group-canonical-comparison-store.mjs](https://github.com/Cairn-ink/cairn-memory/blob/fa5e6d1b4f8e56ad89c7fcc0c63426d3a867a070/evaluation/algorithm-development/receipt-group-canonical-comparison-store.mjs) | `c68f4c7a42f538abf70d435182ea767ae4c8d0b07cdc12b5e56f21712c4e11ef` |
| [receipt-group-canonical-comparison-runner.mjs](https://github.com/Cairn-ink/cairn-memory/blob/fa5e6d1b4f8e56ad89c7fcc0c63426d3a867a070/evaluation/algorithm-development/receipt-group-canonical-comparison-runner.mjs) | `a2812fb97d35a0d478ae1f9cc81d03c462b5c76cde7c0acaa151fefa53aad6ab` |
| [receipt-group-canonical-comparison-evaluation.mjs](https://github.com/Cairn-ink/cairn-memory/blob/fa5e6d1b4f8e56ad89c7fcc0c63426d3a867a070/evaluation/algorithm-development/receipt-group-canonical-comparison-evaluation.mjs) | `1f22c4a9b24d593db3d73a761ed11f09e09dff54384bab57f6ab5dbc5183f334` |

| Retained first artifact / acceptance receipt | SHA-256 |
| --- | --- |
| Blind judge 1 original first reply | `982ecb2afe06e3a17e16e683fdc6e367f31b3af7c6545093280f9e51e2ba02b3` |
| Blind judge 2 original first reply | `0568b505443d95c799b01c18f3cf1eb79ce64a45909974bedea214ec8b786d34` |
| Original first score | `9eba7e6b3624a08cf00f696c1cb2f5ffdd1eb5fa422bf3f181bab23277d7a6ac` |
| Primary read-only first-score arithmetic acceptance | `7fbb1e2cc6f632ba1d3254fb19a334e96e55d5c07e44e28f15b7413f0391121d` |
| Closed artifact/accounting audit | `33b3b87e5c4377f7302ac01d37693d0b0b0ca6b920db31fbb6a1d9ec2214ce22` |
| Static two-selection forensics | `86d67520517dbb7df5fe745746b8087e6609e4589f68ab44ad0c0344cc4bcb11` |
| Read-only six-arm semantic boundary check | `78e2e98cf657688af23cae75484bb1fa81b3456904e9ddd6d4112df13344db12` |

The primary accepted first seals/literal copies and independently recounted
case/family counts, transitions and sent anchors (actual exit 0). The doc worker
also recounted the existing scalar/case verdicts and rehashed these bindings
read-only (actual exit 0), without importing a runner/evaluator or invoking
a scorer. Implementation owner is actual GPT 6.1 Sol/high. Documentation-only
generic/validation gates and separate fixed-head reviews remain primary-owned.

## Limitations and next bounded checkpoint

This is a small hand-authored, stratified synthetic development population with
scripted literal capture, not natural memory formation, random sampling, an
official LongMemEval score or held-out generalization. Two same-family blind
agent judgments can share bias despite independent first submissions. No Mem0
or Supermemory parity, resource lightness, installed Hermes natural new-session
use, release readiness or product acceptance is proven. Models, caps and
candidate inputs were unchanged; historical scores are not pooled.

The next checkpoint is design review, not another paid canonical trial:
trace RQ12/RQ19/RQ22 through retained selected/sent evidence and existing first
verdicts without new labels; then prospectively freeze one fresh **non-scored**
controlled evidence-use probe with explicit falsifiable alternatives and
red-capable negative controls before selecting a successor. No implementation
or model-internal explanation is selected by this result. A later paid
validation requires separate frozen/reviewed scope and a fresh check against
the original cumulative budget/protected reserve. P1–P10 and the original
Stage 3, reliability, Hermes and resource milestones remain the destination.
