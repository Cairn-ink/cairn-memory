# Optional model failure diagnostics

The shared core and OpenAI adapter support a trusted in-process `onDiagnostic`
callback on the model. It is disabled by default; it does not write logs, send
telemetry, change MCP responses or expose model output. Rebuild an installed
artifact before using new source behavior: changing a checkout does not change
an existing installed Hermes process.

```js
const events = [];
const model = createOpenAIModel({
  apiKey,
  onDiagnostic(event) { if (events.length < 100) events.push(event); },
});
const core = openMemoryCore({ path: syntheticDatabasePath, model });
```

For another trusted model implementation, supply the same optional callback as
`model.onDiagnostic`. A non-function value other than `undefined` is rejected.
Observers are not awaited; thrown errors and rejected promises are swallowed so
observation cannot replace the operation result. A callback is trusted host code:
it must be fast and should not perform reentrant mutations. No callback mechanism
can prevent a callback from blocking the JavaScript event loop or using authority
already held by its own closure.

## Finite event schema

Each event is a frozen object with exactly four fields:

- `version`: `1`
- `stage`: `extract`, `classify`, `select`, or `rank`
- `layer`: `adapter`, `core_call`, or `core_validation`
- `reason`: one of the static reasons for that layer below

| Layer | Reasons |
| --- | --- |
| `adapter` | `response_envelope`, `response_usage`, `response_message`, `response_content`, `output_json`, `output_shape`, `output_bounds`, `request_invalid`, `request_bounds`, `token_count_response`, `transport_failure`, `response_body_bounds`, `response_json`, `model_cancelled` |
| `core_call` | `model_not_configured`, `context_budget_exceeded`, `token_count_unavailable`, `model_timeout`, `model_cancelled`, `provider_failure`, `adapter_output_invalid`, `output_serialization`, `output_bounds` |
| `core_validation` | `invalid_extraction`, `invalid_classification`, `malformed_refs`, `duplicate_ref`, `non_visible_ref`, `namespace_selection_limit` |

An adapter failure can also produce a core-call event. These are failing
boundaries, not unique-operation counters. Success is silent. Invalid input
before a model boundary need not emit an event. Event values describe checks,
not semantic truth or the provider's underlying root cause.

## Privacy and authority

Events contain no text, exception messages or stacks, response bodies, IDs,
namespace identity, queries, receipts, keys, paths or dynamic counts. Caller
and provider error properties are not copied into events. The callback does not
receive a core handle, request, output or mutation authority. No event is added
after recall's authoritative final read. Existing revision, namespace, source
binding and output checks remain mandatory; diagnostic collection never repairs
a failed output or turns failed classification into a rollback of admission.

The host owns any explicit storage/export of these events. Use bounded retention;
this API is not consent to capture transcripts or publish user-derived records.
This is an in-process preview extension, not a hosted HTTP protocol change.

## Evidence boundary and next step

Offline synthetic tests verify observation and unchanged failures, not recall
quality. The original #40 failure omitted nested causes, so its particular
`invalid_model_output` cannot be attributed retroactively. The experiment runner
now supports opt-in bounded collection and preserves nested ingestion summary
causes. These enable a newly frozen, authorized live diagnostic run; they do not
replace one. Do not overwrite old results or repeat a paid run until it passes.

## Installed Hermes collection

`runHermesValueExperiment({ ..., collectDiagnostics: true })` enables collection
for this experiment only. The default is `false`, preserving the report shape;
there is no consumer CLI flag or automatic logging. Rebuild and install the
current artifact first. Before discovery or proxy traffic, the runner compares
every installed source in `packaging/artifact-files.json` with this checkout.
Enabled frozen evidence records those hashes plus collector and launcher hashes.

Each executed stage gets a separate private directory (0700) with at most 64
exclusive event files (0600), each bounded to 256 bytes. Two fixed empty markers
record observed overflow or write failure. No append journal is used. The writer
and reader both reproject exactly the finite schema above, rejecting extra fields
and accessors. The reader checks only fixed filenames with bounded, no-follow
reads; malformed, oversized, linked or nonregular files become corruption flags,
not report contents. Nothing is printed on the MCP stdout channel.

The stage's `diagnostics` field contains `{version, events, collection}`. Collection
metadata is limited to fixed slot/byte limits and boolean `capacityReached`,
`overflow`, `corrupted`, `writeFailed`, and `deliveryGuaranteed` (always false).
No paths, raw file bytes or additional transcript content enter these fields.
The enclosing synthetic experiment report still has its existing tool results,
store snapshots and identifiers; this does not make that whole report content-free.

Slot order is reservation order, not a global model-call trace. Duplicate boundary
events are not unique failures. Full capacity is conservative: exactly 64 writes
can fill capacity without overflow. Crashes, permission changes or other observer
failures can prevent an event or marker from being persisted. Empty events never
prove absence of failure, and collection errors never repair an operation result.
This is bounded local retention, not an OS sandbox against a malicious same-user
process. The operator owns retention and any export; no telemetry is sent.

Acceptance: [installed collection plan](plans/hermes-diagnostic-collection.md).

Acceptance: [diagnostic plan](plans/model-failure-diagnostics.md).
