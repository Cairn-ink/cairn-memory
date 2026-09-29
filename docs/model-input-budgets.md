# Model input budgets

Every core model call goes through one guard, `callModel` in
[`core/model-call.mjs`](../core/model-call.mjs). It counts the exact text
`JSON.stringify({system, input, maxOutputTokens: 1024})` with the host's
`countTokens` and refuses anything over 6,000 tokens (`MODEL_INPUT_TOKENS`) with
`context_budget_exceeded` before the adapter runs. Output is capped at 1,024
tokens, and the context window must be at least 8,192.

The guard never fails silently. But a refusal is only acceptable when the caller
controls the input size. A call whose input grows with how much a person has
remembered must fit the budget instead of failing. This page records, for each
call, what bounds its input and what happens when that input is too large.
Token figures below use about one token per CJK character, which is how CJK text
counts under an o200k tokenizer with a 15% host margin.

## Audit

| Call | Where | What bounds its input | Can allowed input exceed 6,000? | Grows with stored memory? | Behavior when too large |
|---|---|---|---|---|---|
| `select` | `core/recall.mjs` | Query ≤4,000 UTF-16 units; read set ≤2 namespaces; each round shows ≤1 map page per namespace, each ≤4,000 counted tokens and ≤100 items. | Yes: two full pages are about 8,000 tokens. | Yes | **Packed.** Items are interleaved round-robin across namespaces, and the largest prefix that fits is sent. A page that lost items is shown as `exhausted:false`, and only shown refs may be selected. |
| `rank` | `core/recall.mjs` | ≤36 candidates, each ≤2 fetch pages of ≤4,000 counted tokens (≤200 receipts). | Yes: one memory re-captured about 15 times from a 300-character CJK turn is enough. | Yes | **Packed.** See [recall](fetch-recall.md#fitting-the-model-budget). |
| `classify` | `core/classification.mjs` | ≤5 memories (capture: ≤600 units each; public `classifyPlacement`: ≤4,000 each) plus one topic-catalog page of ≤4,000 counted tokens. | Yes: a full catalog plus two long CJK memories. | Yes: the catalog grows with topics. | **Packed.** Memory bodies are shortened to a common prefix (never below 120 code points) with the catalog complete. Only if that cannot fit is the catalog's tail left out, which marks it incomplete and forbids new topics. |
| `reconcile` | `core/ordered-capture.mjs` | This capture's messages (≤20,000 units), ≤5 items and discovered predecessor candidates. | Yes | Yes: candidates | **Degrades already.** Reconciliation is skipped with `reconciliation.reason: 'context_budget'`; the capture still commits. |
| `interpretEpisode` | `core/episode-capture.mjs` | The target event's messages (≤24 × 800 units) plus older events and prior sources. | Yes: the target alone. | No for the target. History is packed newest-first and never fails. | The target event is caller input. If it cannot fit, the attempt records gap code `context_budget_exceeded`; ordinary admission is not blocked. |
| `extract` | `core/capture.mjs` | ≤24 messages, each ≤4,000 and ≤20,000 UTF-16 units in total (`capture-input.mjs`). Retained and episode views are ≤800 per message. | Yes: CJK input over about 5,000 characters. | No: only this request's messages. | Explicit refusal: `context_budget_exceeded`. The admission claim is abandoned, nothing is written, and no provider call is made. Split the batch. |
| `qualify` | `core/automatic-qualification.mjs` | ≤5 extracted items: content ≤600, ≤4 receipts of ≤800 each. | Yes: CJK | No | Explicit refusal; the capture fails with `context_budget_exceeded` and nothing is admitted. |
| `qualifyCandidates` | `core/qualification-candidates.mjs` | The same items. If the adapter exposes `fitsQualificationRequest`, a text catalog and then singleton groups are planned first. | Yes, when one item cannot fit alone. | No | Explicit refusal before the first request when a singleton cannot fit. |
| `relate` | `core/rationale.mjs` | ≤6 refs; each source is its complete retained receipt set (≤100 receipts); the snapshot is ≤24,000 JSON characters (`rationale-storage.mjs`). | Yes: CJK | Yes: receipts accumulate on a re-captured memory, and automatic discovery adds stored neighbors. | Explicit refusal; nothing is written. Automatic rationale reports `rationale.status: 'failed'` and the capture is unaffected. **Not packed:** see limitations. |
| `reviewBasis` | `core/source-basis.mjs` | The same snapshot bound. | Yes: CJK | Yes: receipt accumulation | Explicit refusal; nothing is stored. **Not packed:** see limitations. |

## Why relate and reviewBasis are not packed

Both prompts state that each memory carries its complete retained receipts, and
their outputs cite receipts by index and, for `reviewBasis`, quote or address
spans inside complete excerpts. `relate` also persists its proposals as
rationale edges. Existing tests pin the choice to refuse rather than drop
evidence (`RF4`, `R4`, source-address and basis budget tests). Packing them would
let a persisted interpretation rest on evidence the model never saw, so they
still refuse explicitly. This remains a limitation; see
[limitations](limitations.md#model-input-budgets).

## Shared rules for packed calls

- A request that already fits is sent unchanged, as the same object: byte parity
  with earlier releases. `core/test/recall-budget.test.mjs` compares six small
  recalls against a fixture frozen from main `3a1c17d`.
- Packers measure only whole requests with the same `countTokens` and the same
  serialization as the guard, including system text and JSON framing. The
  request they return has been measured and fits, whatever the counter does with
  fragments.
- IDs, revisions, namespace indices, receipt identity and qualification are
  never shortened. Only text is: memory content, receipt excerpts in recall,
  and memory content in classification.
- Output is validated against what the model was actually shown. A ref or topic
  that packing left out is rejected as `invalid_model_output`.
- Packing is deterministic for the same inputs and counter.
- If even an empty list does not fit (in practice, a query that alone exceeds
  the budget), the guard refuses with `context_budget_exceeded`, because nothing
  can be packed.
