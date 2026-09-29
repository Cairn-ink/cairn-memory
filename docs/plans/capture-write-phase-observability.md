# M1a: optional capture-write phase timing

Status: bounded offline implementation contract, fixed base `c2212ce12fa0f31d4847bfc3838f11db377fa51f`. This adds observation only. The historical N7 indexed-evidence timeout has no retained raw provider response or causal phase record; the passing five-control fake-transport replay proves cancellation mechanics, not which live phase consumed its deadline. Do not raise the core 30-second deadline, change model/context limits, rerun old cases or make a paid call in this packet.

The 30 seconds are one existing `callModel` envelope, not a whole-capture service-level target: a capture may make multiple model calls and separate storage work. This observer measures only the OpenAI adapter invocation, beginning with its own preparation. It cannot time earlier core map/tokenization, capture orchestration or SQLite commit. Missing adapter time is therefore not proof that the rest of capture was fast. A separate small synthetic map probe showed fewer fit checks at a 32-item limit than at 100, but also returned fewer items; it neither identifies N7's cause nor authorizes changing the map limit.

## Closed observer contract

`createOpenAIModel` may receive an optional trusted in-process `onPhaseTiming(event)` function, separate from unchanged `onDiagnostic` v1. Omission or explicit `undefined` preserves model behavior and emits nothing; other non-functions are rejected at construction before HTTP. Each event is an immutable own-data object with **exactly** `{version:1, stage, phase, outcome, elapsedMs}`: no dynamic reason, ID, ordinal, URL, text, key, request, response, exception, stack, provider usage, or output. `stage` is one of the adapter ports `extract`, `classify`, `select`, `selectChecklist`, `rank`, `reconcile`, `qualify`, `qualifyCandidates`, `interpretEpisode`, `relate`, `reviewBasis`. `phase` is one of `prepare`, `count_transport`, `count_body`, `count_validation`, `generation_transport`, `generation_body`, `output_validation`. `outcome` is `completed`, `failed`, or `aborted`; `aborted` says only that the shared signal fired while a phase was open, not that the provider stopped work or cost. `elapsedMs` is a finite monotonic duration clamped to `[0, 2_147_483_647]`. At most seven events are emitted per adapter invocation, one per entered phase; later completion after abort cannot emit a second event. No log, network, disk, or collection is installed by default. Concurrent invocations are not correlatable from these content-free events; the host must isolate a single call to interpret a phase sequence.

`prepare` covers the adapter's local snapshot/schema/serialization/token-count work and emits only **after** both count and generation request bodies are serialized, or after a preparation failure; the observer cannot mutate unsnapshotted caller input before dispatch. `*_transport` runs from pre-dispatch through HTTP response/status availability; `*_body` runs through bounded body read and JSON decode. Count validation checks the count envelope and existing ceilings; output validation checks the generation envelope, schema/wire mapping and local output bounds. A phase with an unresolved fake transport/body still emits `aborted` when the shared signal aborts. The observer is not awaited; synchronous throws and asynchronous rejections (including hostile thenables) are swallowed. As with `onDiagnostic`, a trusted callback can still block the JavaScript thread or use authority from its own closure; this API does not sandbox it or guarantee event persistence. Timing does not report provider accounting or identify why an HTTP call stalled.

## Acceptance and verification

- **W01 — opt-in/schema:** invalid observer rejected before HTTP; enabled events are finite, frozen, closed, source-free and bounded per call, including failures and late completion; no default side effect.
- **W02 — parity:** disabled, enabled, throwing and rejecting observers yield identical request count/order/body, outputs/error envelopes, preflight ceilings and the existing single 30-second core envelope. Existing `onDiagnostic` v1 remains byte-for-byte unchanged.
- **W03 — deterministic phase controls:** fake HTTP and timers cover fast success, count-only stall, slow count then generation abort, generation transport/body stall, malformed output and late completion after abort. An ignored abort cannot create a second timing event or an unhandled rejection. No synthetic timer result is a claim about historical N7.
- **W04 — real core:** an owned synthetic SQLite capture whose **extraction** times out has no newly committed memory after cold reopen. A later classification timeout is different: extraction may already have admitted a memory, which remains source-backed and unfiled with an explicit failed-classification result. Successful capture survives reopen with unchanged exact receipts and duplicate behavior. No core semantics or store schema changes.
- **W05 — owned scratch:** tests use `createTestWorkspace`, close core before cleanup, verify success and real failed-adapter-capture cleanup, and print no raw fixture text or provider body.
- **W06 — limits:** documentation states timing is partial M1 evidence, not a timeout fix, causal attribution, semantic reliability gain, or installed-product claim. M1 stays open until a causal correction and fresh evaluation.
- **W07 — installed closure:** the explicit artifact allowlist includes the new adapter timing helper with its current source hash. An offline installed-archive test imports the packaged adapter and observes the same finite two-request fake-HTTP sequence; a source-checkout test alone cannot satisfy this. The existing installed manifest/runtime hash contracts for prior evidence are not rewritten.

The red-capable test must fail against the fixed base because `onPhaseTiming` is rejected, then pass after the adapter-only change. Verify `npm run test:openai`, `npm run demo:openai-offline`, `npm test`, `npm run validate`, and a focused real-core capture gate on pinned Node 22.16 and 24.15; record commands/results and exact candidate diff. W07 additionally requires the existing `test:artifact` gate after both isolated adapter dependency sets and the documented `packaging/prepare-cache.mjs` prerequisite. The primary approved that public-registry metadata preparation in this isolated worktree; the installed test uses fake HTTP and no provider. No CI, evaluation guard, ledger, prompt, resource, core, or default change is authorized.

The first red check ran `node tools/testing/run.mjs adapters/openai/test/phase-timing.test.mjs` on Node 22.16 against the unmodified adapter and failed in 199 ms with `invalid_openai_configuration` at `createOpenAIModel`, before HTTP. This is the intended W01 signal: the closed observer option does not yet exist. The test uses one synthetic request and fake HTTP, not a provider or historical case.

## Offline implementation evidence

GPT-6 Sol/high implemented this isolated packet under primary supervision. The primary inspected the frozen source/test bytes and independently reran the focused phase controls (13/13 on each of Node 22.16 and 24.15), the installed-hash/optional-timing checks (2/2 on each), and an 80-variant cross-base fake-transport parity matrix (four ports × five success/failure shapes, including a bare `AbortError` with no fired signal × four observer modes). That matrix found no changed request bodies/counts, results, or `onDiagnostic` events. It makes no provider, token-spend, or historical N7 causal claim.

The worker's frozen-candidate gates all exited zero on **each** of Node 22.16 and 24.15, with no failed or skipped tests:

| Command | Node 22.16 | Node 24.15 |
| --- | ---: | ---: |
| `npm run test:openai` | 323/323, 140,552 ms | 323/323, 145,182 ms |
| `npm run test:artifact` | 87/87, 135,736 ms | 87/87, 125,153 ms |
| `npm test` | 131/131 | 131/131 |
| `node tools/testing/run.mjs core/test/model-call.test.mjs core/test/capture.test.mjs` | 22/22 | 22/22 |
| `npm run validate` and `npm run demo:openai-offline` | pass | pass |

The primary also ran `npm run validate` from `tools/plugin-validation` with
the existing locked Claude 2.1.260 executable on each pinned Node runtime;
both marketplace and strict plugin validation passed. Earlier adapter runs
with 322 tests preceded the final bare-`AbortError` control and are not used
as final-candidate evidence. The committed candidate and independent reviews
will be recorded in the PR; no source/test bytes changed during these final
verification runs.

The phase controls exercise extraction timeout with no cold-committed memory, successful cold receipt/dedup parity, and separately a classification timeout **after** admission with the source-backed unfiled memory and failed initial-classification status still cold-readable. A child workspace also closes the real core and removes the child directory after a failed adapter capture. The installed suite includes the new helper's exact hash and two-request fake-HTTP probe. All are synthetic/offline; they establish mechanics, not semantic reliability, provider latency, spent tokens, or a production service-level bound.

## Later gates, not passes

M1 is long-write completion/recovery; these timings alone are partial. M2 is a retained-source read path **without** expanding retention. M3 is decision/current/history semantic reliability. M4 requires a separately frozen and independently reviewed fresh-six completion check within the existing cumulative allowance, followed only if gates permit by a fresh-30 matched comparison with latency, RSS, storage and cost, retaining fixed-N wrong/unresolved outcomes and no old-case reruns. M5 is installed MCP/Hermes capture, restart, recall, correct and forget. The last paid audit reserved USD 149.768405 of USD 200, leaving USD 50.231595 in that reservation; reservation is not an invoice or a fresh audit. This packet spends none of it. New scope/privacy or a cap above USD 200 requires additional authority.
