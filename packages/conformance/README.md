# Storage adapter conformance

`@cairn-ink/conformance` runs shared tests for storage adapters. The suite covers transactions, error mapping, capabilities, memory storage, and retrieval.

An `AdapterFactory` supplies a `name` and an `open({ capabilities })` method that returns an `OpenedAdapter`. The result exposes `adapter` with its actual capabilities, `uow`, `memories`, `lexical`, `snapshot`, `hydrate`, `fence`, and `recent`. The `vector` port is present exactly when `semanticRetrieval` is enabled. The factory also returns `harness`, `nativeErrorMap`, `busyNativeCodes`, `embeddingDimensions` (`null` uses four), and an async `close()` method.

Optional `settleMs` gives a started run time to reach its lock waits. The default is 100 ms. Raise it for stores with slow transaction start.

Optional `timeoutMs` bounds one concurrency phase, excluding settle waits. The default is 5000 ms. Raise it for slow stores. The same bound applies to `close()`. Both timing options must be finite positive numbers when supplied.

The `TestHarness` provides four async hooks. Harness hooks belong in test builds only.

- `dump()` returns a JSON-safe snapshot of committed state for equality checks. Use `JsonValue` data: null, booleans, finite numbers, strings, arrays, and plain objects with string keys. Encode bigints as strings.
- `seedFact(owner, fact)` inserts a test fact and advances the owner's index revision.
- `setWriteTime(scope, id, updatedAtUs)` sets the committed row's write time and advances the owner's index revision. It rejects with `invalid_input` for an open run for the owner or a time other than a nonnegative bigint, and with `memory_not_found` if the row is outside the scope or missing.
- `counters()` returns diagnostic counters. With near matching enabled, `nearSkippedUnembedded` counts non-exact comparisons skipped because a vector is missing or the lengths differ.

Register the suite in a Node test file and run it with `node --test`.

```js
import { defineConformanceTests } from "@cairn-ink/conformance/node-test";
import { factory } from "./factory.mjs";

defineConformanceTests(factory);
```

- `needs` requests enabled flags and skips with `needs <flag>` if any are off.
- `needsOff` requests disabled flags and skips with `needs <flag> off` if any are on.
- `requests` supplies optional flags at open. Skips depend on the explicit requirements, which override requests.
- `pending` skips with the given reason before opening an adapter.
- `followUp` runs a second check with its own capability requests and adapter after the first check passes and closes.

Cases treat the store as the authority for write times. To create fixed times, including ties, call `harness.setWriteTime` after the write run closes. Derive the expected order from the forced microsecond times and the IDs the adapter returned.

Cases compare port results by projecting the fields they need into plain tuples or objects, such as `[id, updatedAtUs]`. This lets adapters return rows and matches as class instances or with extra fields. Cases can compare documented plain shapes whole when they assert every field, such as `{ outcome, revision }` or `[[]]` for an empty match batch. Snapshots from `dump()` must be JSON-safe.

Retrieval cases check membership and non-increasing scores for lexical results. Lexical scores and equal-score ordering are store-specific. Vector cases check cosine distance and coverage for the query model and dimensions. Hydration and fence cases check visibility and input order, and hydration checks receipts and source dates. The historical-row case awaits the supersession suite.

Page cursors are opaque. Recent pages use separate read-only runs. Stable re-reads compare projected items, treating rows with the same timestamp and ID in different namespaces as an unordered group. State tokens must be valid when issued, stable without writes, and bound to the read set and owner revision. A committed write in any namespace for the owner invalidates an earlier token.

### Privacy cases

Run each entry in `PRIVACY_CASES` with `runCase(factory, testCase)`. The factory supplies
`suppressions`, `pause`, and `keys` on the adapter and declares `OpenedAdapter.sessionRefs`
as `"plain"` or `"hashed"`. The plain profile accepts both forms. The hashed profile
rejects plaintext session IDs.

The distinct-target raw span case, `K-FACT-3r`, requests `rawSpans` and reports
`needs rawSpans` when the adapter does not provide it.

The optional test hook `harness.setFingerprintSecret(secret)` rotates the fingerprint
secret. The runner reports a skip reason for the rotation check when the hook is
unavailable. Signing key stability and owner isolation are checked with signatures
over a fixed test message. With the hook, the rotation check sets a known initial
secret and checks that both the key ID and signature change after rotation.

The in-memory reference adapter uses the public fixture `TEST_FINGERPRINT_SECRET`
(`"test-secret-a"`) and `TEST_FINGERPRINT_LABELS` when `fingerprintKey` is enabled with
no configuration. Use these fixtures for tests only.
