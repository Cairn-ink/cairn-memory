# Storage adapter conformance

`@cairn-ink/conformance` runs shared tests for storage adapters. The kit covers transactions, error mapping, capabilities, memory storage, retrieval, privacy, capture, raw archives, and topic placement.

## Writing an adapter factory

### Factory shape

An `AdapterFactory` has a `name` used in test names and an async `open({ capabilities })` that returns an `OpenedAdapter`. Open an isolated test instance. Each run gets fresh fixture owners, and a follow-up calls `open` again. The returned object contains these fields.

| Field | Contract |
| --- | --- |
| `adapter` | The storage ports and their actual `capabilities`. The suite map lists the ports the cases call. Optional ports are present exactly when their corresponding flags are enabled. |
| `harness` | A `TestHarness` with the test-only hooks in the table below. |
| `nativeErrorMap` | Maps native error codes to core error codes. |
| `busyNativeCodes` | Lists native codes for contention that the map must classify as retryable. Use an empty list when there are none. |
| `embeddingDimensions` | The dimension of generated fixture vectors. Use `null` for the default of four, or supply the test store's dimension. |
| `sessionRefs` | The store's suppression fact profile, `"plain"` or `"hashed"`. |
| `settleMs` | Optional delay for a started run to reach its lock waits. Defaults to 100 ms. |
| `timeoutMs` | Optional bound for each timed concurrency phase, excluding settle waits, and for `close()`. Defaults to 5000 ms. |
| `close()` | Asynchronously release the instance's resources. The runner calls it after each successful open, including when the case skips or fails. |

Both timing options must be finite and greater than zero when supplied. The runner rounds each value up to a whole millisecond before calculating phase budgets. Increase them as needed for slow transaction starts or concurrency phases.

### Capability handshake

Honor a requested flag setting when the store supports it. To decline a setting and let the kit report a skip where appropriate, return the adapter with the actual flag value. For `capability_unavailable` during `open`, the runner can retry without a preferred `rawArchive` request or a required `sessionLineage` request. It rethrows the original error if the reopened adapter still advertises `sessionLineage`.

- `needs` requests flags on. The runner returns `needs <flag>` for the first required flag that is off.
- `needsOff` requests flags off. The runner returns `needs <flag> off` for the first required-off flag that is on, after checking `needs`.
- `requests` supplies additional preferences at open. The runner applies `requests`, then `needs`, then `needsOff`. It checks only explicit requirements for automatic capability skips. A case can branch on the actual flags or return its own reason.
- `pending` returns the given skip reason before opening an adapter. `followUp` runs with its own requests on a fresh open after the first run succeeds and closes.

`runCase` returns `null` on success, a reason string on a skip, and rejects on failure. Pass the string to `t.skip(reason)` so `node:test` reports a skipped test with its reason. Treat a skip as missing coverage, even if an earlier check ran successfully. `defineConformanceTests(factory)` from `@cairn-ink/conformance/node-test` does this for `CASES`.

### Test harness hooks

Hooks are async except for `hashSessionKey`. An absent required hook fails the case when reached. The optional hooks affect specific checks as follows.

| Hook | Required | Used by and behavior |
| --- | --- | --- |
| `dump()` | Yes | `CASES`, `PRIVACY_CASES`, `CAPTURE_CASES`, `K-ADM-7`, `SOURCE_FILTER_CASES`, `KEYED_DIGEST_CASES`, `RAW_CASES`, `IMPORT_ARCHIVE_CASES`, `PROVEN_FORK_CASES`, `TOPIC_CASES`. Return a comparable snapshot of committed state, including retained raw rows even when hidden and retained anchor IDs with opaque proofs. Use `JsonValue` data with finite numbers, dense arrays, and plain objects with enumerable string keys. Encode bigints as strings. |
| `seedFact(owner, fact)` | Yes | `CASES`, `PRIVACY_MATCH_CASES`, `CAPTURE_CASES`, `SOURCE_FILTER_CASES`, `KEYED_DIGEST_CASES`, `RAW_CASES`, `IMPORT_ARCHIVE_CASES`, `PROVEN_FORK_CASES`, `FENCE_INTENT_CASES`, `RELATION_CASES`, `TOPIC_CASES`, `TOPIC_FOR_MEMORIES_CASES`. Insert a committed test fact and advance the owner's index revision. |
| `setWriteTime(scope, id, updatedAtUs)` | Yes | `CASES`, `K-IMP-T3`, `RETRIEVAL_WINDOW_CASES`. Set the committed row's write time and advance the owner's index revision. Reject with `invalid_input` for an open run for that owner or a time other than a nonnegative bigint, and with `memory_not_found` for a missing or out-of-scope row. |
| `counters()` | Yes | `CASES`, `RAW_CASES`. Return numeric diagnostics. `nearSkippedUnembedded` counts non-exact comparisons skipped because a vector is missing or the lengths differ when near matching is on. `rawKeyConflict` counts raw key conflicts without logging content. |
| `setFingerprintSecret(secret)` | Optional | Rotate the fingerprint secret. `PRIVACY_CASES` checks signing key stability and owner isolation, then skips rotation with a reason if the hook is absent. `KEYED_DIGEST_CASES` skips the affected rotation and retained-key checks with a reason. |
| `rowsMissingKeyedDigest(owner)` | Optional | Count uncovered row and live signing domain pairs, including the enabled current domain. A row missing two domains counts twice. Use the digest pipeline when the label is absent. Return zero when no key is enabled. The rotation and retained-domain coverage cases skip with a reason if the hook is absent. |
| `setRetainedDigestFixture(owner, fixture)` | Optional | Configure a synthetic foreign HMAC-SHA256 signer with `{ keyId, label, secret }`. The signer uses the UTF-8 fixture secret and signs the normalized text it receives. Pass `null` to remove it. The retained-save cases skip with a reason if the hook is absent. |
| `advanceClock(ms)` | Optional | `CAPTURE_CASES` skips the lease-expiry follow-up with a reason if the hook is absent. The initial abandon checks still run. Advance the store clock by the requested milliseconds. |
| `hashSessionKey(client, sessionId)` | For hashed session fixtures and raw archive spans | A missing hook fails hashed fixture checks in `PRIVACY_MATCH_CASES`, `SOURCE_FILTER_CASES`, `RAW_CASES`, `IMPORT_ARCHIVE_CASES`, `PROVEN_FORK_CASES`, and `TOPIC_CASES`. The provisional policy case in `CASES` skips with a reason when its hashed fixture lacks the hook. Raw archive span fixtures in `RAW_CASES` and `IMPORT_ARCHIVE_CASES` need the hook in both profiles. A missing hook skips these span checks in the plain profile and fails them in the hashed profile. `K-FACT-3r` supplies its own hash. The plain-profile source filter case without the hook checks how the store handles a hashed fact it cannot compare. |
| `seedClientlessRaw(scope, sessionId, message)` | Optional | `RAW_CASES` skips the missing-client check with a reason if the hook is absent. Seed a legacy raw message with missing client provenance. |

### Store clock, opaque values, and comparisons

The store is the authority on write times. Cases check write times independently of the `nowMs` argument. To force exact microsecond times, including ties, the cases call `setWriteTime` after the write run closes and use the IDs the store returned.

IDs, tokens, and cursors are opaque. Cases use returned IDs to check ordering where the port specifies it. Lexical scores and equal-score order are store-defined under [PHASE0](../core/docs/PHASE0.md). The lexical cases check membership and non-increasing scores. The vector cases check cosine distances with float32 tolerance, order, and coverage for the query model and dimensions. Raw search compares expected scores at float32 precision and allows any candidate tied at the cutoff.

Cases generally project port results into the tuples or objects they need, such as `[id, updatedAtUs]`. They can compare a documented plain shape whole when they assert every field, such as `{ outcome, revision }` or `[[]]` for an empty match batch. Hydration and fence cases check visibility and input order. Hydration also checks receipts and source dates.

Recent pages use separate read-only runs. Stable re-reads treat rows sharing a timestamp and ID across namespaces as an unordered group. State tokens must be valid when issued, stable without writes, and bound to the read set and owner revision. A committed write in any namespace for the owner invalidates an earlier token.

### Profiles

- `sessionRefs` controls session references in suppression facts. The `"plain"` profile accepts plaintext and hashed references. The `"hashed"` profile accepts hashed references and rejects plaintext ones. Supply a synchronous `hashSessionKey` for hashed fixtures, using the adapter's own conversion and returning 64 lowercase hexadecimal characters for fixture inputs. The hashed receipt check fails without the hook on a hashed factory and skips with `needs hashed session refs` on the plain profile. Raw archive span fixtures need the hook in both profiles. `K-FACT-3r` supplies its own hash.
- `embeddingRequiredOnInsert` makes the kit give ordinarily unembedded fixtures separated vectors under the `"fixture-only"` model. Reference vectors need at least two dimensions and use the first two axes. The generator packs two separated fixtures per additional axis using opposite signs. For *n* separated fixture vectors in one run, the minimum `embeddingDimensions` is 2 + ceil(n / 2). The largest current run allocates nine, so use at least seven to avoid dimension skips across suites when embeddings are required.
- The runner recognizes a fixture-allocation error marked by the generator for that run and returns its message as a skip when `embeddingRequiredOnInsert` is enabled. Other errors, including dimension errors from the adapter, fail. The unembedded-row diagnostic also skips in an embedding-required profile.

### Suite map

Each row lists the ports used across the export, including those used only in a conditional case or follow-up. Missing required flags skip the affected run with a reason. Missing called ports fail when reached. The capability-alignment check in `CASES` also checks whether optional ports are present for the flags the adapter reports.

| Export | Ports | Capability gates and requests | Required hooks when reached |
| --- | --- | --- | --- |
| `CASES` | `uow`, `memories`, `lexical`, `snapshot`, `hydrate`, `fence`, `recent`, `vector` for semantic retrieval, `supersession` in a pending case | `nearDuplicate` on and off in distinct checks, `semanticRetrieval` on for vector retrieval and off in a follow-up. Other cases request `nearDuplicate`, `vectorSuppression`, or `semanticRetrieval` as preferences. Two `supersession` cases are pending. | `dump`, `seedFact`, `setWriteTime`, `counters`. The provisional policy case skips on the hashed profile without `hashSessionKey`. |
| `PRIVACY_CASES` | `uow`, `suppressions`, `memories`, `pause`, `keys` | `rawSpans` for distinct span targets. `fingerprintKey` off for the initial key check and on for its follow-up. | `dump`. |
| `PRIVACY_MATCH_CASES` | `uow`, `memories`, `fence`, `hydrate`, `lexical`, `recent`, `suppressions`, `vector` in a follow-up. One check can consult `keys` when `fingerprintKey` is on. | No initial gate. Vector follow-ups need `semanticRetrieval`, with `vectorSuppression` also required for the vector text suppression and write policy checks. | `seedFact`, plus `hashSessionKey` for hashed fixtures. |
| `CAPTURE_CASES` | `uow`, `capture`, `memories`, `snapshot` | No initial gate. The vector suppression follow-up needs `vectorSuppression` and `semanticRetrieval`. The dispatch check branches on `stagedEvidence`. | `dump`, `seedFact`. |
| `CAPTURE_CASES` (`K-CLM-6`) | `uow`, `capture.claim`, `capture.finish` | Finish reports the positions its write policy suppressed. Checks the optional list when supplied and compares it with the result of a finished claim when replay is available. | `seedFact`. |
| `CAPTURE_CONTAINMENT_CASES` | `uow`, `suppressions.snapshot`, `keys` | A forgotten passage inside a new capture output is withheld. Containment and shingle key mismatch need `fingerprintKey` on. The exact-only check needs it off. | `seedFact`. |
| `ADMISSION_CASES` | `uow`, `capture`, `snapshot` | No capability gate. Each case skips if `capture.admit` or a needed `capture.load` or `capture.status` method is absent. | `dump` for the status side-effect check. |
| `IMPORT_TIME_CASES` | `uow`, `memories`, `lexical`, `recent` | No capability gate. The insert cases pass explicit `nowMs` values to check creation and update times. | `setWriteTime` for recent ordering. |
| `SOURCE_FILTER_CASES` | `uow`, `capture`, `suppressions`, `keys` for keyed text | No initial gate. The text case requests `fingerprintKey` off and reports a reason if that path is unavailable. Its follow-up requires the flag on and skips if the provider returns no owner key. | `dump`, `seedFact`, plus `hashSessionKey` for hashed fixtures. |
| `CAPTURE_LATE_FORGET_CASES` | `uow`, `capture.admit`, `capture.claim`, `capture.eligible`, `capture.assertEligible`, `raw.archive`, `raw.recordLineage` | Both cases need `rawArchive` and skip if `capture.admit` is absent. The window case also needs `rawWindowHide`. Callers guard lineage writes with the eligibility check. | `dump`, `seedFact`, plus `hashSessionKey` for the hashed session fixture. |
| `CAPTURE_DELETE_CASES` | `uow`, `raw`, `memories.exportPage`, and the service capture ports | All cases need `rawArchive` and skip if `capture.admit` is absent. Each deletes a conversation after admission, during extraction, or during embedding, with and without a prior archive. A later capture in the same owner must still store its memory and Raw row. | `dump`, including capture ledger text. |
| `FINISH_BINDING_CASES` | `uow`, `capture`, `memories.exportPage` | All cases need `rawArchive` and skip if `capture.admit` is absent. Finish must refuse receipts outside the latest same-transaction selection or with an unmatched address, without writing or completing the claim. A matching receipt and an assertion-free empty finish succeed. | `dump` for rollback checks. |
| `KEYED_DIGEST_CASES` | `uow`, `memories`, `keys`, `capture`, `lexical`, `recent`, `hydrate` | All cases need `fingerprintKey`. An enabled provider that returns no owner key fails when the case requests one. | `seedFact`, `dump` in the rotation refusal check. |
| `RETAINED_KEYED_DIGEST_CASES` | `uow`, `memories`, `keys`, `capture`, `pause`, `suppressions`, `snapshot`, `fence`, `recent` | All cases need `fingerprintKey`. The retained-save cases also require `keys.retainedDigesters`. | `seedFact`, `setRetainedDigestFixture` for the retained-save cases, and `rowsMissingKeyedDigest` and `dump` for coverage. The dump exposes `[{ owner, rows: [{ row: { id, digests } }] }]`. |
| `RAW_CASES` | `uow`, `raw`, `suppressions`, `capture`, `keys` | All need `rawArchive`. Window cases also need `rawWindowHide`. Span cases also need `rawSpans`. The session and text visibility case requests `fingerprintKey` as a preference. | `dump`, `seedFact`, `counters`, plus `hashSessionKey` for hashed session or raw span fixtures as described above. |
| `RECEIPT_WITHHELD_CASES` (`K-RCPT-W1`) | `uow`, `raw.archive`, `raw.deleteConversation`, `raw.fenceSession`, `suppressions.receiptWithheld`, and the service save ports | An adapter with `rawArchive` must implement `suppressions.receiptWithheld`. Visible archived messages allow receipts. Deleted and fenced conversations withhold receipts and suppress explicit saves without changing storage or the index revision. | `dump`. |
| `SPAN_LINEAGE_CASES` | `uow`, `capture.claim`, `capture.finish`, `raw.archive`, `raw.deleteConversation`, `spanLineage.resolveSpans` | Both need `spanLineage` and `rawArchive`. Deleted Raw resolves to an empty list. An unknown memory throws `raw_lineage_unavailable`. | None. |
| `IMPORT_ARCHIVE_CASES` | `uow`, `raw`, `keys` for keyed text | All need `rawArchive` and skip with a reason when `raw.importArchive` is absent. Window checks need `rawWindowHide`. Raw span checks need `rawSpans`. Keyed containment needs `fingerprintKey` and `shingleSuppression`. | `dump`, `seedFact`, plus `hashSessionKey` for hashed session and raw span fixtures as described above. |
| `PROVEN_FORK_CASES` | `uow`, `raw`, `capture`, `suppressions` | All need `rawArchive`. | `dump`, including retained anchor IDs and opaque proof metadata, `seedFact`, plus `hashSessionKey` for hashed session fixtures. |
| `TOPIC_CASES` | `uow`, `memories`, `placement` | All cases need `placement`. | `dump`, `seedFact`, plus `hashSessionKey` for the hashed session fixture. |
| `DELIVERY_VISIBILITY_CASES` | `uow`, `memories`, `fence`, `documentCards`, `placement`, `raw` for message-backed cards | All cases need `documentCards` and `placement` with `forCards`. The session case also needs `rawArchive` and `raw.fenceSession`. | `seedFact`, plus `hashSessionKey` for hashed session fixtures. |

### Minimal driver

The typed factory contract describes the full port shape. For a store with only `uow` and `suppressions`, this JavaScript driver registers selected cases from `CASES` and `PRIVACY_CASES`. Pass your factory to this function from a test file and run it with `node --test`. The rollback check uses `dump()`. The span case reports a skip if the store declines `rawSpans`.

```js
import { test } from "node:test";
import { CASES, PRIVACY_CASES, runCase } from "@cairn-ink/conformance";

export default function (factory) {
  const cases = [...CASES, ...PRIVACY_CASES].filter(({ id }) =>
    ["K-UOW-3", "K-UOW-3r", "K-FACT-1", "K-FACT-2", "K-FACT-3r"].includes(id));

  for (const testCase of cases) {
    test(`${factory.name} ${testCase.id} ${testCase.title}`, async (t) => {
      const reason = await runCase(factory, testCase);
      if (reason !== null) t.skip(reason);
    });
  }
}
```

### Reporting a failure

The kit asserts the port contract. Raise a kit or contract question with the kit owners and include the failing case ID, requested and actual capabilities, profile, and error. Keep the assertions and adapter behavior intact while the discrepancy is investigated.

### Privacy cases

Signing key stability and owner isolation are checked with signatures over a fixed test message. When the rotation hook is present, the check sets a known initial secret and checks that both the key ID and signature change after rotation.

The in-memory reference adapter uses the public fixtures `TEST_FINGERPRINT_SECRET` and `TEST_FINGERPRINT_LABELS` when `fingerprintKey` is enabled with no configuration. Use these fixtures for tests only.

### Privacy matching cases

The cases seed facts and check visibility, write policy, and suppression reads through the ports. Exact-digest checks run on either session profile with or without the vector flags.

### Capture cases

The cases exercise claim identity, dispatch, finish, and rollback through the adapter ports. They compare relative index revisions and treat tokens as opaque.

### Sticky write failures

After a write port touches store state, the in-memory adapter records its first failure code.
If the callback returns normally, the run rolls back and rejects with a fresh `CoreError` for that code.

Write ports validate arguments before reading state. Argument failures are never sticky.
