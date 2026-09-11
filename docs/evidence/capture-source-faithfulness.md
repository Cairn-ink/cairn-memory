# Default capture: retained source-faithfulness evidence

This is a diagnostic, not a runtime repair or broad accuracy claim. The frozen
[plan](../plans/capture-source-faithfulness.md) uses the unchanged default model,
prompts and normal capture/classification path on fresh synthetic SQLite stores.
The [machine-readable record](capture-source-faithfulness.json) contains every
source, captured statement, filing result, observation and exact runtime hashes.

## Nine-case relation-strength probe

Three repetitions each of two source statements about Harbor/Juniper usage,
Aster/Cedar usage and Marigold/Birch planned usage completed. Primary and an
independent agent reviewed every stored statement against its actual receipts:
18supported /0unsupported /0unreviewed; required-fact recovery18/18, no omissions.
“Uses the … programming language” preserved usage rather than asserting an
implementation; every planned-use statement retained future modality. Source
entity, event ID, user role and exact excerpt matched in every record.

All nine captures and placement applications completed, but this does **not**
mean all records were filed:17were filed; case7's Birch planned-use record remained
unfiled at revision1 with no placement. It was stored and supported, not omitted
or lost. No diagnostic events occurred. Recall was deliberately not called here.

The local source-support and ≥17/18 recovery gates passed. Earlier default-model
strengthening failures remain failed; this probe does not certify general capture
quality, turn the experimental profile into the default, or verify large histories.

Completed `2026-09-10T17:51:59.558Z`; frozen-intent SHA-256:
`6ae42935ba53455827780641cd3621d7082e5e3f9a707c8033f1513e19f2f66d`.
36guarded requests added USD0.180reserved, USD0.007738known usage estimates and
18unknown-cost requests. The original ledger at that checkpoint held993requests,
USD10.860reserved, USD0.824561known usage estimates,433unknown costs,0unsettled.
The USD20 cumulative cap was not refilled. These are not invoice totals.

## Complete default-profile semantic run: failed

One full run of the unchanged 12-case, three-repetition corpus completed after
the diagnostic. The [raw report](../../evaluations/results/semantic-excerpt-v1.json)
retains all 36 runs and its original pending-review summary; only private database
paths were removed. Separate [independent labels](../../evaluations/results/semantic-excerpt-v1-review.json)
were applied by the unchanged scorer. Primary independently inspected the same
captured statements, receipts, returned memories and topic placements and agreed.

| Gate | Result |
| --- | --- |
| Completed runs | 36/36 |
| Recall / relevance | 45/45 each |
| Source-supported captured records | 21/24; three unsupported |
| Supported required-fact recovery | 20/24 |
| Empty checks / MOC discoverability | 6/6 and 12/12 |
| Coherent organization / reported safety violations | 3/3 and zero |
| Resource gate | Pass; recall p95 5,097 ms |
| Overall unchanged scorer | **Failed**, no pending labels or review errors |

The unsupported statements were not missed by retrieval; they were retrieved
successfully. In C02 repetition 1, `Harbor uses Go.` and `Juniper uses Python.`
became claims that each entity **is a software project**. Neither source supplies
that type. In C03 repetition 2, `We adopted SQLite...` became **the project**
adopted it, substituting an unsupported actor. That combined memory covers two
required facts, so rejecting its source support removes two recovery credits.
Relevant content is not necessarily fully supported content. Zero structural
safety violations does not cancel these semantic failures.

No runtime, extraction prompt, rubric or default model was changed for this run.
The nine-case pass therefore must not be generalized to robust extraction, and
the 45/45 retrieval metric must not be advertised as overall memory accuracy.
No causal improvement over older runs is inferred from this non-controlled
model sample. Earlier reports remain unchanged.

Completed `2026-09-10T17:58:54.220Z`; frozen-intent SHA-256:
`195e5b68db90ab76376b5de60c5054a313bc5c6a781eb3374484246cf802d6e5`.
222 guarded requests added USD1.110 reserved, USD0.037337 known usage estimates
and 111 unknown-cost requests. Latest original ledger: 1,215 requests,
USD11.970 reserved of USD20, USD0.861898 known usage estimates, 544 unknown-cost
requests and zero unsettled. Remaining conservative authorization is USD8.030.
The old runner's USD0.987456 run-local reservation is an additional accounting
layer; it is not substituted for the stronger shared ledger or used to refill it.

Reproduce the review without a key or network:

```sh
node --input-type=module -e 'import {readFileSync} from "node:fs"; import {cases} from "./evaluations/semantic-cases.mjs"; import {summarizeEvaluation} from "./evaluations/score.mjs"; const read = name => JSON.parse(readFileSync(`evaluations/results/${name}.json`)); console.log(summarizeEvaluation(cases, read("semantic-excerpt-v1").results, read("semantic-excerpt-v1-review")));'
```
