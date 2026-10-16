# Role-stratified v2: closed development result

The unchanged advancement gate **failed**. Both arms completed all 24 cases
with 24/24 supported-correct first answers and 38/38 positive minimum support
claims/quotes retained and packed. The candidate introduced 23 unsupported
memory propositions, including one severe/stale proposition. Role-stratified
extraction is not adopted or a product default. No tuned rerun follows.

This is the separately authored fresh v2 synthetic development cohort, executed
once at runtime `9f21697bfc1c43b7b7f23782b46771c866db47b2`, with execution
exit code **0**. The [prospective contract](role-stratified-extraction.md) and
unchanged scorer were frozen before outputs. The earlier v1 operation stopped
before any paired answer because of a runner revision-binding defect; it remains
closed, preserved separately in that plan, and excluded from these scores.

## Outcomes and counting units

| Measure | Baseline | Candidate |
| --- | ---: | ---: |
| Completed first answers / all cases | 24/24 | 24/24 |
| Supported-correct first answers / all cases | 24/24 | 24/24 |
| Supported-correct / completed answers | 24/24 | 24/24 |
| Correctly recognized unknowns | 4/4 | 4/4 |
| Supported-correct required answer claims | 42/42 | 42/42 |
| Positive minimum claims/quotes retained | 38/38 | 38/38 |
| Positive minimum claims/quotes packed | 38/38 | 38/38 |
| Supported memory statements / reviewed | 86/111 | 76/95 |
| Unsupported memory statements | 25 | 19 |
| Unsupported memory issue propositions | 31 | 26 |
| Severe memory issue propositions | 0 | 1 |
| Stale memory issue propositions | 0 | 1 |
| Answer issues: unsupported / severe / stale | 0 / 0 / 0 | 0 / 0 / 0 |

The four unknown claims are excluded from positive necessary-source coverage;
their answers are included in the 24-case and 42-required-claim denominators.
All-case and common-completed coverage are identical because every arm completed.
Coverage measures exact quote conservation at original source coordinates,
not semantic recall or whether a generated memory correctly expresses a quote.

There were zero paired gains, regressions, completion losses, lost supported
decisions, assistant-information answer losses or assistant-information claim
losses, and zero unresolved judgments. The candidate produced 16 fewer memory
statements and six fewer unsupported statement verdicts, but introduced **23 new
unsupported memory propositions**. One new proposition was both severe and
stale; these flags do not identify two separate severe events. Issue propositions
are matched within each pair and separately by memory/answer layer. Several
issues can occur in one statement; statement verdicts and issue totals are not
interchangeable atomic-fact rates. Repairs elsewhere do not cancel a new issue.

The gate fails on net supported-answer gain 0 (required >=3), retained support
gain 0, packed support gain 0, and new memory issues. Complete execution and the
private resource audit pass; neither overrides those quality failures. The pure
scorer labels resource accounting `not-evaluated` and never grants advancement.

## Why correct answers coexist with the stale puppet memory

Case `b72c84000401` asks for both conditions allowing rod puppets. The updated
user source, also attached to candidate memory-1, says:

> For the setup sheet, the rod puppets need wind strictly below 20 and a latched gate. A reading of exactly 20 means hand puppets.

Candidate memory-1 instead includes:

> If the anemometer reads 20 kilometers per hour or more at setup, only the hand puppets will be used; below 20 means rod puppets can be used.

The last clause presents the earlier wind-only condition as sufficient despite
the updated gate requirement in its own receipts. The fixed masked adjudication
marks the exact clause `below 20 means rod puppets can be used` unsupported,
severe and stale (packet pair 11, right memory-1). Candidate memory-2 separately
preserves the added gate requirement; the gate is not absent from the whole bank.

The baseline answer is:

> Both conditions that must hold for your courtyard show to use the rod puppets are: the wind reading must be strictly below 20 kilometers per hour, and the side gate must be latched. If either condition is not met, you must use the hand puppets instead.

The candidate answer is:

> The wind reading must be strictly below 20 kilometers per hour, and the side gate must be latched.

The common answer policy receives deduplicated retained source receipts, not
generated memory prose. It can therefore answer correctly from the updated
source union while a stored statement remains unsafe. This experiment does
not measure how an answerer relying on memory prose would behave.

## Independent judgments

Two independent nonauthor masked agent ratings and a separate masked
adjudication were fixed before arm unmasking. Original rating/adjudication
JSON strings are published verbatim, including their reasons and exact issue
quotes; replay does not rerate them. The 18 memory-support flag disagreements
span 13 pairs. Required-answer-claim correctness/support flags had no
disagreements; cited source sets differed on 26 required-claim verdicts.

Adjudication independently corrected two memories the raters had agreed to
support: packet pair 4 left memory-3 generalized an observed unstamped-box
referral into an instruction, and pair 17 left memory-4 added a station archive
identity absent from its own passages. Final review covers 48 answers, 84
required-claim verdicts and 206 memory statements, with no unresolved judgment.
This is same-family agent review, not human calibration. Label masking does not
prove blindness because content, memory counts and wording can reveal style.

## Every case

Both answers in every row completed and were supported-correct. Memory columns
show supported statements / reviewed statements. New issues count candidate
unsupported memory propositions absent from that pair's baseline memory layer;
the dagger identifies the one proposition also marked severe/stale.

| Case | Family | Baseline / candidate answers | Baseline memory | Candidate memory | New issues |
| --- | --- | --- | ---: | ---: | ---: |
| b72c84000101 | dated personal events | correct / correct | 4/5 | 3/4 | 1 |
| b72c84000102 | dated personal events | correct / correct | 3/5 | 5/5 | 0 |
| b72c84000103 | dated personal events | correct / correct | 4/5 | 3/4 | 1 |
| b72c84000104 | dated personal events | correct / correct | 4/5 | 2/2 | 0 |
| b72c84000201 | changed observations | correct / correct | 3/5 | 3/4 | 2 |
| b72c84000202 | changed observations | correct / correct | 4/5 | 5/5 | 0 |
| b72c84000203 | changed observations | correct / correct | 5/5 | 3/5 | 2 |
| b72c84000204 | changed observations | correct / correct | 1/2 | 2/2 | 0 |
| b72c84000301 | intentions / adoption | correct / correct | 5/5 | 2/5 | 3 |
| b72c84000302 | intentions / adoption | correct / correct | 5/5 | 2/3 | 1 |
| b72c84000303 | intentions / adoption | correct / correct | 4/5 | 4/5 | 1 |
| b72c84000304 | intentions / adoption | correct / correct | 3/5 | 5/5 | 0 |
| b72c84000401 | conditions / uncertainty | correct / correct | 3/5 | 2/3 | 1† |
| b72c84000402 | conditions / uncertainty | correct / correct | 3/4 | 4/5 | 3 |
| b72c84000403 | conditions / uncertainty | correct / correct | 4/5 | 2/4 | 1 |
| b72c84000404 | conditions / uncertainty | correct / correct | 3/4 | 2/2 | 0 |
| b72c84000501 | assistant information | correct / correct | 5/5 | 4/5 | 1 |
| b72c84000502 | assistant information | correct / correct | 4/5 | 5/5 | 0 |
| b72c84000503 | assistant information | correct / correct | 1/4 | 0/2 | 1 |
| b72c84000504 | assistant information | correct / correct | 4/4 | 1/2 | 2 |
| b72c84000601 | mixed attribution | correct / correct | 5/5 | 5/5 | 0 |
| b72c84000602 | mixed attribution | correct / correct | 3/5 | 2/3 | 3 |
| b72c84000603 | mixed attribution | correct / correct | 2/4 | 5/5 | 0 |
| b72c84000604 | mixed attribution | correct / correct | 4/4 | 5/5 | 0 |

## Resource observations

The private audit reports all **288 HTTP requests** fully accounted: 144 input
counts and 144 generations (48 extraction, 48 classification, 48 answer).
US$1.44 was conservatively reserved, with no reset or refund. The observed
provider usage totals are 169,627 input and 22,660 output tokens. The published
rate calculation is a **generation-only US$0.104164 estimate**; count-route
billing and the actual invoice remain unknown. These provider usage observations
are distinct from the local request/output counters retained in each arm.

Total elapsed time was **1,111,772.585455 ms**, including local accounting
overhead, not merely provider latency. The inner runner duration is separately
1,109,251.939853 ms. Agent review costs are not exposed by the campaign ledger.
The resource audit is an observed private accounting result, not a public
replay of ledger contents or independent invoice authentication. The protected
budget remains protected and supplies no authority for another paid operation.

## Public replay and byte bindings

The [synthetic evidence bundle](../../evaluation/architecture/results/role-stratified-v2.json)
contains the complete `report.result` projection (all original first outputs,
admission/classification evidence, cold receipts and packing decisions), frozen
seed and metadata, exact raw JSON strings for both ratings and adjudication,
expected scorer output excluding its regenerable packet/mapping, and resource
observations. The source/rubric fixtures already in the repository regenerate
the entire masked packet and unmasked mapping. HTTP records, credentials,
account identifiers, local machine paths, operational ledger contents and real
user data are excluded. Namespace/receipt IDs are synthetic experiment data.

| Binding | SHA-256 |
| --- | --- |
| Source fixture bytes | `6685fc6f5154e608f6e27946a2d3702c7b02dfc2d4ba69a9aa597f30db15b75a` |
| Rubric bytes | `1e1cd7a68945e45a0ae43a53fe5a53358123a32e1bce67b956c4960c8c0b6bd9` |
| Original private report file bytes | `d775f660a4fcd53edfe45ad193df05bb5a66642eda8f0434faa57d99b0c5ea09` |
| Public report projection, compact serialization | `184f04debc1dbaedcae18fa23a27a9496ff2186f9e342f72b3d8f025160991f0` |
| Packet logical digest | `9bb7fc882528c9b53b7f98429bdd710bc451568ec8bfd4b24a1e83e8a26ba08b` |
| Original packet file bytes, reproducible pretty serialization | `33abe84a0f7fd2096d5f4b43842bcda94b76b0a79a851d50c318127471b4df63` |
| Rater one original JSON bytes | `0186e25e799912ec2a420b1b09d930180e3ef3ccf556a20287fe3aa45a8179b7` |
| Rater two original JSON bytes | `062cb5929d3d34e78ded9c6a5dcdfaa35ce63fe593d343cc63ac02eae065f9fd` |
| Adjudication original JSON bytes | `530e1b9ea167c234da56ea2d67e2b816ddefb04bce823c5a7c3b2354aa68f7cd` |

The original private report-file digest records a different, withheld wrapper;
it is not the public projection's digest. Public replay verifies the projection
bytes, regenerates the packet and validates every original judgment. It cannot
authenticate the withheld wrapper or redo the private resource audit.

Run from the repository root with Node 22.16 or 24.15:

```sh
node tools/testing/run.mjs evaluation/architecture/test/role-stratified-v2-result.test.mjs
```

The [focused test](../../evaluation/architecture/test/role-stratified-v2-result.test.mjs)
passes **7/7, actual exit 0**, on both pinned runtimes. It reproduces the exact
frozen scorer output, asserts the full denominators and severe/stale issue,
checks original-byte bindings and disagreement counts, and rejects changed
originals, a dropped case and laundering the severe/stale flags. It imports the
unchanged pure scorer; no model, store, provider, private launcher or ledger is
used. Recomputing these fixed judgments is an offline replay, not a new semantic
rating or another paid execution.

## Interpretation and next boundary

The baseline was already at the answer and necessary-source ceiling in this
cohort. There is no observed QA improvement opportunity for the role allocation
to exploit, while newly unsafe memory wording independently blocks advancement.
The grouped intervention changed both role guidance and slot allocation, so
this result cannot isolate a numeric quota effect.

The 24 English synthetic cases include recordkeeping cues, twelve longer
dialogues, four short unknowns and concentrated assistant/late-evidence controls.
Their 100% answer score is not official LongMemEval QA, production recall,
natural installed Hermes use, long-history reliability, proof of general
memory quality or competitor parity. Next is an explicit representation and
opportunity review, with future architecture decisions owned separately.
This closed result authorizes no promotion, tuned role-quota retry, raw
retention/search, production mutation or additional paid run.
