# Storage adapter conformance

`@cairn-ink/conformance` runs shared tests for storage adapters. The suite covers transactions, error mapping, capabilities, and memory storage.

An `AdapterFactory` supplies a `name` and an `open({ capabilities })` method that returns an `OpenedAdapter`. The result exposes `adapter` with its actual capabilities, `uow`, and `memories`, along with `harness`, `nativeErrorMap`, `busyNativeCodes`, `embeddingDimensions` (`null` uses four), and an async `close()` method.

Optional `settleMs` gives a started run time to reach its lock waits. The default is 100 ms. Raise it for stores with slow transaction start.

Optional `timeoutMs` bounds one concurrency phase, excluding settle waits. The default is 5000 ms. Raise it for slow stores. The same bound applies to `close()`. Both timing options must be finite positive numbers when supplied.

The `TestHarness` provides four async hooks. Harness hooks belong in test builds only.

- `dump()` returns a JSON-safe snapshot of committed state for equality checks. Use `JsonValue` data: null, booleans, finite numbers, strings, arrays, and plain objects with string keys. Encode bigints as strings.
- `seedFact(owner, fact)` inserts a test fact for the owner.
- `setWriteTime(scope, id, updatedAtUs)` sets only the committed row's write time. It rejects with `invalid_input` for an open run for the owner or a time other than a nonnegative bigint, and with `memory_not_found` if the row is outside the scope or missing.
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

Cases treat the store as the authority for write times. To create fixed times, including ties, call `harness.setWriteTime` after the write run closes. Derive the expected order from the forced microsecond times and the IDs the adapter returned.

Cases compare port results by projecting the fields they need into plain tuples or objects, such as `[id, updatedAtUs]`. This lets adapters return rows and matches as class instances or with extra fields. Cases can compare documented plain shapes whole when they assert every field, such as `{ outcome, revision }` or `[[]]` for an empty match batch. Snapshots from `dump()` must be JSON-safe.
