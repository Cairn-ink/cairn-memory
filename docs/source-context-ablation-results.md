# Source-context ablation v1: not a reliability improvement

Adding explicit context citations did not improve mechanical completion in this
fixed development sample: original basis completed 15/24 arms, contextual basis
8/24. Completion is not semantic correctness. Some completed outputs still
mislabel non-adoption or challenge a newer state with an older report. Keep the
mode experimental and opt-in; no default model or reliability claim is promoted.

## What ran

Eight new synthetic texts adapted from known failure categories × three existing
models × original/context modes, one attempt per slot. The locally built and
offline-installed shared core and real adapter made 96 actual-provider HTTP
requests. All 48 source and warm/cold nonpersistence checks pass; 25 outputs were
rejected as invalid_model_output and remain failures. No failed arm was retried.

The [fixture](../evaluation/live/source-context-fixture.json) and
[rubric](source-context-rubric.md) were frozen before calls. All arms received
the same canonical receipts for their case, with manual admission. This is not
automatic extraction, MOC retrieval, answer generation, an end-to-end MCP test,
a blind holdout or a real-user study. Semantic judgments are nonblind agent
review. Prompt/schema/representation changed together under the same local
6,000-input/1,024-output-token ceilings; their individual effects are not isolated.

Before calls, independent review clarified that a valid confirmation-premise
support is not a false relationship merely because it omits original-source
coverage. This distinction does not alter the pinned fixture or rubric.

| Model | Original mechanically completed | Context mechanically completed |
| --- | --- | --- |
| gpt-4.1-mini-2025-04-14 | 2/8 | 0/8 |
| gpt-5.6-luna | 6/8 | 3/8 |
| gpt-5.6-sol | 7/8 | 5/8 |

## Failure localization

All provider generations reported completed; replayed local output token counts
were at most 459, below 1,024. Thus observed rejections are not evidence that the
output budget must be raised. Every failed context arm contains a fabricated,
cross-receipt or nonunique context citation; some also have graph errors. Common
short subjects such as `I`, `我`, or `Linen` recur in a receipt. Other fields
paraphrase their meaning instead of quoting it. Correct literal unit citations
do not rescue an invalid whole proposal. Do not pick the first ambiguous match,
repair quotes or silently retain only successful fragments.

The original mode also rejects wrong role directions/selflinks, with one
fabricated unit quote. These failure reasons are diagnostic, not a partition of
independent semantic mistakes: one output can contain several problems.

## Source-aware review across the eight cases

| Case | Evidence and limits |
| --- | --- |
| Backup region / unchanged restore speed | Luna retains the correct separate reasons and regional challenge in both modes. Sol does too, but both Sol modes additionally label explicit non-adoption as a decision. Mini original misses the regional challenge and also mislabels non-adoption; contextual output invents context quotes. Exact anchors do not settle commitment. |
| Beginner versus advanced class | All original arms retain two stage-specific supports without a false challenge. All contextual arms reject. Sol has otherwise useful supports but ambiguous `我` citations; Luna/mini additionally paraphrase context, and mini falsely challenges reaffirmed historical reasons. |
| Two device owners | Sol original separates Lee's lost read-aloud reason from the user's unchanged matte display. Sol context has those links but rejects a repeated `Linen` subject quote. Luna context also falsely challenges matte reaffirmation. Other rejected arms contain wrong directions or roles; source isolation is not generally solved. |
| Friday-only delivery | Sol contextual output retains both normal and exceptional reasons, a useful local signal versus its original arm's omission of the normal chain. Both mini and Luna arms reject; Luna contextual output also wrongly supports the temporary choice with the usual supplier reason. One favorable case does not establish a net gain. |
| Late inspection | Sol retains correct support without a stale challenge in both modes. Luna original accepts a false challenge from the pre-ramp report; its contextual output instead challenges with today's successful ramp visit and also has an ambiguous subject citation. Mini arms reject role/context errors. |
| Unadopted notebook advice | Luna/Sol appropriately abstain in both modes. Mini invents decision roles in both; contextual fields also turn roles or interpretations into nonexistent quotes. Ordinary memory still must not create purchase authority. |
| Reaffirmed heater rating | Luna/Sol retain the original support without a false challenge in both modes. Mini original fabricates an ellipsis-prefixed quote; both mini outputs additionally treat confirmation as a challenge. |
| Explicit train change | Luna original retains the old support but omits both the challenged basis and new choice's support. Every other arm rejects. Sol original proposes three semantically relevant links, but the same updated meeting-time unit serves both as update and new premise, which the exclusive role-direction contract rejects. Contextual outputs do not fully recover the new support and have ambiguous/nonliteral citations. |

The train example exposes representation friction, not literal impossibility:
the existing schema can duplicate a source span under separate premise/update
roles, but this consumes units and asks the model to duplicate a fact to express
its two functions. A simpler explicit representation of those functions deserves
testing. Removing role checks without replacing their contract is not a fix.

## Immutable evidence and accounting

The [full public projection](../evaluations/results/source-context-ablation-v1.json)
preserves all 48 arms, source texts, selected context, proposals, compiled anchors,
failure codes and accounting, excluding private paths and credentials.

- Source candidate: `1e95cf1a1a00683bc10f27a6c99a7ecd13888143` (#91).
- Operator SHA: `0fac51a9fa059d26923f2b35c18fbe53c09ecace704ec8586150319f8c1b0638`.
- Artifact SHA: `98541995f058cc534eed67c90d2b508fef7344ba908c1738d5881d0c3cffb7ae`.
- Raw report SHA: `e7a72cf52802457bed64db4922cf88de3727d1ecd5f4cd6d387ddc3ef9f09725`.
- Public projection SHA: `a5d564793e48d6605073f791ed778fd05f4bc80e7b30d167453644d9f5b0d28f`.
- Requests: 762 → 858. Conservative reservations: US$6.946 → US$8.994
  (US$2.048 additional), within the unchanged aggregate US$50 ledger.
- Known token-priced estimates: US$0.313152 → US$0.467512 (US$0.154360
  additional), not a billing invoice. Unknown actual costs: 381 → 429 requests;
  unknown does not mean free. Zero unsettled requests; no refund or ledger reset.

## DRI decision

Do not promote this mode or buy more output tokens to hide the failure. Next,
test choosing machine-addressed source evidence rather than asking the model
to reproduce quotations, and separate a source statement from its potentially
multiple roles in a decision chain. Reuse the same source store and provenance
boundary. Any replay of this sample is development diagnosis, not a fresh score.
Fresh held-out source interpretation and installed full capture/restart/recall
still gate the eventual lightweight, reliable-memory claim.
