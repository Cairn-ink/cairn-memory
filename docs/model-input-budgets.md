# Model input budgets

Every core model call goes through one guard, `callModel` in
[`core/model-call.mjs`](../core/model-call.mjs). It counts the exact text
`JSON.stringify({system, input, maxOutputTokens: 1024})` with the host's
`countTokens` and refuses anything over 6,000 tokens (`MODEL_INPUT_TOKENS`) with
`context_budget_exceeded` before the adapter runs. Output is capped at 1,024
tokens, and the context window must be at least 8,192.

The guard never fails silently. Beyond that, no call's allowed input may exceed
its budget: each call is either **fixed** (it packs or plans its input to fit),
**degrades** (a smaller part is skipped and reported, the operation completes),
or is **bounded** by a stated limit, with the measurement that proves it.
`relate` and `reviewBasis` are the only accepted refusals.

Measurements use two counters: exact o200k_base × 1.15, as a host that pads its
count does, and the test counter (`core/testing/cjk-token-counter.mjs`, about one
token per CJK character and a quarter per other character, × 1.15). They cover
ordinary Chinese, Japanese, Korean and English, and dense text: CJK Extension A
and B, Yi, Tangut and C0 control characters.

## Audit

| Call | Where | What bounds its input | Status |
|---|---|---|---|
| `select` | `core/recall.mjs` | Query ≤4,000 UTF-16 units; ≤2 namespaces; ≤1 map page per namespace per round, each ≤4,000 counted tokens and ≤100 items. Two full pages are about 8,000 tokens. | **Fixed.** Map items are interleaved across namespaces and the largest prefix that fits is sent. A trimmed page is shown as `exhausted:false`, and only shown refs are selectable. |
| `rank` | `core/recall.mjs` | ≤36 candidates, each ≤2 fetch pages of ≤4,000 counted tokens (≤200 receipts). | **Fixed.** See [recall](fetch-recall.md#fitting-the-model-budget). Every sent candidate carries all of its returned receipts with identity whole; only text is cut, possibly to empty. A candidate whose receipt identities alone cannot fit is left out whole and counted. |
| `classify` | `core/classification.mjs` | ≤5 memories (≤600 units each from capture, ≤4,000 via `classifyPlacement`) plus a topic-catalog page of ≤4,000 counted tokens; the catalog grows with topics. | **Fixed.** Memory bodies are cut to a common prefix, never below 120 code points, with the catalog complete. Only then is the catalog's tail left out, which forbids new topics. |
| `qualify` | `core/automatic-qualification.mjs` | ≤5 extracted items; content ≤600 units; ≤4 receipts of ≤800 each. | **Fixed; degrades per item.** All items together, else one request per item. An item that does not fit alone gets its excerpts cut to a common prefix of at least 120 units; receipt index and role stay whole, and anchors remain exact offsets into the stored excerpt. If even that cannot fit, only that item is admitted unqualified, with a diagnostic and `qualificationTruncated`. Size never fails a valid capture. Five maximum items of Extension A or Yi text were shortened, and none was left unqualified, under o200k × 1.15. |
| `qualifyCandidates` | `core/qualification-candidates.mjs` | The same items as 200-unit candidates. The OpenAI adapter's `fitsQualificationRequest` measures its larger wire (pool instructions and strict schema). | **Fixed; degrades per item.** All items, their text catalog, then per item (inline, then catalog), then per item with receipt text cut to a common prefix of at least 120 units. Candidate indices stay; every receipt keeps its first candidate. The adapter's fit check applies when present, and the core count otherwise. Otherwise as for `qualify`. |
| `reconcile` | `core/ordered-capture.mjs` | This capture's messages, ≤5 items and discovered predecessor candidates. | **Degrades.** Reconciliation is skipped with `reconciliation.reason: 'context_budget'`; the capture commits. |
| `interpretEpisode` | `core/episode-capture.mjs` | The target event's messages (≤24 × 800 units), plus history packed newest-first. | **Degrades.** History never fails. An oversized target records gap code `context_budget_exceeded`, and ordinary admission of the same batch proceeds. Nothing is retried or split. |
| `extract` (capture) | `core/capture.mjs` | ≤24 messages, ≤4,000 units each, ≤20,000 in total (`capture-input.mjs`); retained and episode views ≤800 per message; indexed windows ≤64 per batch. | **Bounded by the planning contract.** A batch whose request cannot fit is refused as an input error before any claim, staging, write or provider call. `core.planCaptureBatches` splits batches by whole messages with the same measurement, and every batch it returns is admitted. One message always fits alone in 800-unit-view modes (`source-bound-v2`, episodes): at most 3,608 tokens under o200k × 1.15 and about 2,400 under the test counter, for every script above. In 4,000-unit modes (plain, `source-bound-v1`, indexed evidence), an ordinary-text message fits alone: at most 4,611 (o200k) and 5,135 (test counter). Dense scripts reach 9,400–14,200 under o200k, and control characters 6,860 even under the test counter. The planner reports such a message in `oversizedMessageIndices` and never splits it. **This is the one open item.** |
| `extract` (`keepEpisode`) | `core/capture.mjs` | The episode's cited sources: ≤16 (four anchors × four fields), each ≤800 units, all drawn from one interpretation request that itself fit. | **Degrades.** If the extraction prompt makes them exceed the budget, every source stays in the request with its text cut to a common prefix of at least 120 units, reported as `extractionTruncated`. |
| `relate` | `core/rationale.mjs` | ≤6 refs; complete receipt sets of ≤100 each; snapshot ≤24,000 JSON characters. | **Accepted refusal.** Explicit, nothing written; automatic rationale reports `rationale.status: 'failed'` and the capture is unaffected. |
| `reviewBasis` | `core/source-basis.mjs` | The same snapshot bound. | **Accepted refusal.** Explicit, nothing stored. |

Extraction's own 1,024-token output limit also bounds what reaches
qualification: five 600-unit CJK items cannot be returned at once, so the
largest qualification inputs arise from long receipts, not long content.

## Why relate and reviewBasis are not packed

Both prompts state that each memory carries its complete retained receipts, and
their outputs cite receipts by index and, for `reviewBasis`, quote or address
spans inside complete excerpts. `relate` also persists its proposals as
rationale edges. Existing tests pin the choice to refuse rather than drop
evidence (`RF4`, `R4`, source-address and basis budget tests). Packing them would
let a persisted interpretation rest on evidence the model never saw, so they
still refuse explicitly. This remains a limitation; see
[limitations](limitations.md#model-input-budgets).

## Shared rules for packed and planned calls

- A request that already fits is sent unchanged, as the same object: byte parity
  with earlier releases. `core/test/recall-budget.test.mjs` compares six small
  recalls against a fixture frozen from main `3a1c17d`.
- Packers and planners measure only whole requests with the same `countTokens`
  and the same serialization as the guard, including system text and JSON
  framing. The request they return has been measured and fits, whatever the
  counter does with fragments.
- IDs, revisions, namespace indices, receipt identity, candidate indices and
  qualification are never shortened. Only text is: content and excerpts, always
  to an original slice. Every shortened piece is marked (`textShortened`,
  `excerptShortened`, `contentShortened`).
- Output is validated against what the model was actually shown. A ref, topic or
  candidate that packing left out is rejected as `invalid_model_output`.
- Packing and planning are deterministic for the same inputs and counter.
- Anything left out or shortened is reported in the result:
  `recallTruncated`, `classificationTruncated`, `qualificationTruncated` or
  `extractionTruncated`. These fields are absent when nothing was packed.
- If even an empty list does not fit (in practice, a recall query that alone
  exceeds the budget), the guard refuses with `context_budget_exceeded`, because
  nothing can be packed.
