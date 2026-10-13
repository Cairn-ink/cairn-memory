# Closed receipt-ID first-response feasibility result

Status: **rejected; do not advance to matched QA24**. The one frozen six-case
run closed on 2026-10-13 with operator exit **0** and reconciled accounting,
but only **2/6** first responses compiled and selected nonempty cards, below
the required **5/6**. All six provider generations completed; four retained
`invalid_model_output` failures are not timeout, network or writing failures.
Successful execution is not a passed engineering gate.

The [prospective contract](receipt-group-feasibility.md) fixed the denominator,
sources, interface and threshold before model output. Capture used normal
scripted indexed-evidence admission, including the one-card/six-receipt dedup
case; it did not measure model extraction quality. No answer or judge was called.
This is structural feasibility, not first-answer accuracy, a competitor result,
semantic reliability or installed-host acceptance.

## Original six outcomes

Generation-body tokens are measured complete request serializations, not the
provider's reported input usage. All fit the unchanged 6000-token input cap;
case 06 was largest. The rank output cap stayed 1024.

| Case ordinal | Provider generation | Compile / nonempty selection | Generation-body tokens | Accepted cards / receipt endpoints | Groups with terminal also in context |
| --- | --- | --- | --- | --- | --- |
| 01 | completed | `invalid_model_output` | 635 | no accepted selection | 1 |
| 02 | completed | compiled / nonempty | 1684 | 2 / 2 | 0 |
| 03 | completed | compiled / nonempty | 926 | 1 / 3 | 0 |
| 04 | completed | `invalid_model_output` | 1097 | no accepted selection | 2 |
| 05 | completed | `invalid_model_output` | 1347 | no accepted selection | 6 |
| 06 | completed | `invalid_model_output` | 3309 | no accepted selection | 1 |

Case 02 selected 2/2 diagnostic anchors and case 03 selected 3/3; the same
anchors were available on their chosen whole cards. Endpoint selection and
whole-card source availability are separate diagnostics, **not delivered answer
context** or proof of semantic sufficiency. Failed cases have no accepted
selection or coverage; their rejected outputs are not salvaged into successes.

The original permitted raw responses in cases 01/04/05/06 each placed a terminal
receipt in that group's context list. Version 1 required distinct endpoints
within a group and enforced its original rule. This observed output shape is
not an implementation bug, proof of model-internal reasoning or permission to
deduplicate a closed response. No case was retried, repaired, recompiled,
rejudged or rescored.

## Separate fresh diagnostic

A later tiny synthetic compiler probe used entirely new text and IDs: one card,
one source, the same terminal R, and only context `[]` versus `[R]` changed.
Its valid singleton, current overlap rejection and unknown-ID controls passed
3/3 with actual exit 0. A prospective assertion that useful selection should
survive context-terminal group-role overlap failed 0/1 with actual exit 1 and
`invalid_model_output`. Actual request/proposal tokens were 425 / 24 versus 34.
This is a red-capable future-contract question, not an old-case replay, evidence
that v1 incorrectly enforced its rule, or a changed six-case score. No fix or
future schema was implemented by the probe.

## Resources and immutable provenance

The run retained 12 physical intents: six count requests and six generations,
24 pre/post records and six checkpoints. There were zero pending or unknown
intents, and the complete original accounting prefix remained intact.
Conservative reserved micro-USD increased from **334152281** to **334212281**,
an addition of **60000** (US$0.06). The original cumulative ceiling remains
400000000 micro-USD (US$400), with 30000000 protected (US$30); no reservation
was reset, refunded or replaced.

Known generation pricing totals **4617 micro-USD** (US$0.004617), using reported
**8166 input / 843 output tokens**. Count settlements retain null priced usage.
This is a generation-only model-profile estimate, not an invoice, full spend
or a replacement for conservative reservations. A later budget gate needs a
fresh original-campaign check, not this historical checkpoint.

| Immutable binding | SHA / SHA256 |
| --- | --- |
| Accepted runtime commit | `3aecc220d30a6c6efabae4a29decea60f054753d` |
| Frozen source fixture | `176fba365369bc36e85b371aa209ae1ed32e864b3e14b0bb7fbecbf3b70d5a8d` |
| Original operator result | `80b728ffa514d891db10a332cb9407c877ede6a760b250a7f13f8fcd5e097fe8` |
| Original returned / formal report | `ba885f68610642838aafe515051533a002878670fb60e123601d8669dd4ae95a` |

Before execution, required full gates passed on pinned Node 22.16.0 and 24.15.0,
separate nonauthor Standards/Spec reviews passed, and all 27 latest-head CI checks
passed. These accepted the execution artifact, not model success. Primary and
an independent auditor checked 83 retained artifacts by independent routes and
all 18 preparation files remained unchanged. The documentation worker also read
the original reports and permitted response shapes without executing them.
This documentation delivery requires its own gates and independent final reviews;
earlier runtime acceptance is not borrowed approval of these new documents.

## Disposition

The conditional newly matched 24-case first-answer comparison is **blocked**:
2/6 does not meet its entry threshold of 5/6. Review a separately versioned,
source-preserving representation offline; no successor implementation or
improvement is delivered by this result. Any later paid feasibility needs new
prospectively frozen cases,
an exact reviewed implementation and fresh original-budget checks.

The [three-stage plan](reliability-three-stage.md), its gain/safety/resource gates,
all earlier failed results, and the separate Hermes/installed-host requirements
remain unchanged. No consumed CQ/BQ or other closed cohort may be reopened.
No product default, release, merge, deployment or quality claim follows.
