# Explicit memory loop: repeated product success, retained control failures

On September11 Taipei (September10 UTC), the current installed Cairn core
completed a fresh diagnostic A-F loop, followed by a separately frozen three-trial
confirmation batch. All18 product steps in the confirmation batch passed both
actual tool/store checks and primary plus independent-agent semantic inspection.
The original recall failure did not reproduce; **no engine fix is claimed**.

The confirmation's combined gate also required three acceptable no-memory
controls. One control hallucinated a schedule, one was ambiguous, and one clearly
acknowledged unavailable access. Therefore **the frozen combined batch did not
pass**. We did not replace trials, tune the baseline or redefine that gate after
seeing results. [Machine-readable summary and exact hashes](reliable-memory-loop.json)
retain the separate denominators and budget checkpoint.

## What actually worked

Every trial started from a new dedicated synthetic profile; each stage used a
fresh pinned Hermes process, with no prior dialogue. The installed MCP/core used
the actual baseline model through the existing shared-budget loopback transport.
Tool choices and responses were not scripted in these paid trials.

1. Store the fictional Lantern Tuesday decision with one matching Source Receipt.
2. In a new session, recall the same memory/revision/receipt and answer Tuesday.
3. Read the current sourced decision, correct the same ID to Friday at revision2,
   retain one active decision and a new supporting receipt.
4. In a new session, recall revision2 and correctly answer Friday.
5. Read the current revision before an actual `forgotten:true` result; the target
   is then absent from the active store.
6. In a new session, obtain empty recall and honestly report no recorded schedule.

The separate initial diagnostic trial also passed all six steps and its control.
That trial retained authority-v2. Confirmation used authority-v3, which fixes
two reproduced **evaluator** defects: duplicate initial memories could pass A,
and an `ok:true` no-op with `forgotten:false` could pass E. Failed v3 checks do
not advance inspector state; all v3 verdicts require semantic review. The legacy
v2 inspector and explicit runner option remain available, not silently rewritten.

## Control outcomes and interpretation

| Trial | Cairn A-F reviewed | No-memory control reviewed |
| --- | --- | --- |
| 1 | 6/6 accepted | Rejected: asserted “every Friday at 3 PM” without tools or evidence |
| 2 | 6/6 accepted | Inconclusive: “I found no direct Cairn evidence…” could mean no available context or imply a completed check |
| 3 | 6/6 accepted | Accepted: requested access or relevant data before checking |

There were21/21 mechanical passes, but only19/21 semantically accepted stages,
one rejected and one inconclusive. Keyword/no-tools predicates are not semantic
judges. A lucky or fabricated control answer is not sourced memory value.

The control failures concern a host without Cairn access. They do not show
undeleted Cairn data: every product F stage actually retrieved an empty store and
gave a truthful unknown answer. Future separately frozen studies should score
product lifecycle and control behavior separately. This observation does not
retroactively change this combined gate's failure.

## Resource and evidence boundaries

The diagnostic trial took65.078seconds including process startup, discovery and
seven turns. The three sequential confirmation trials took179.225seconds total,
including those same costs. These are one-machine synthetic workflow timings,
not per-query latency, measured user savings or a general “lightweight” benchmark.

The diagnostic and confirmation added133 guarded requests, USD3.410 reserved and
USD0.093414 known usage estimates, with36 unknown-cost requests. The original
USD20 experiment now has862 requests, USD9.530 reserved, USD0.780189 known usage
estimates and375 unknown-cost requests; none are unsettled. Remaining reservation
allowance is USD10.470, not a refill. Unknown costs are not zero; these are not
audited provider invoices. Pricing remained the frozen
[GPT-4.1 mini standard-text policy](https://developers.openai.com/api/docs/models/gpt-4.1-mini).

No failure diagnostic events or collector corruption/overflow were observed.
Silent diagnostics do not prove a universally failure-free implementation. The
same inspected archive/core served baseline and confirmation; only the evaluation
gate changed. Raw synthetic snapshots and pre-run intents stay in the existing
private experiment directory, with intent hashes in the public summary. No user
conversation, provider credential or raw corpus is included here.

## What is still not established

- Historical #40 `invalid_model_output` root cause or a fix for that exact failure.
- Robust retrieval with many memories, varied questions or long histories. The
  [original seven-case pilot](first-live-evidence.md) still has negative outcomes.
- Automatic capture, arbitrary client support, a stock-host release, upstream
  listing, production readiness or human adoption.
- Statistical reliability or superiority over Mem0, Supermemory or a baseline.

Next: retain this narrow explicit lifecycle result; reproduce the long-history
coverage/ingestion failures offline where possible, then freeze distinct broader
tests before more paid calls. Do not keep rerunning this one example until all
controls happen to pass.
