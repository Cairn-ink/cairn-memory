# Explicit embedding ledger migration (offline operator API)

This is an opt-in, synthetic-tested accounting schema transition. It does not
send HTTP requests, own credentials, set a model or price, authorize a Mem0
run, or migrate any operator ledger. The legacy `createExperimentBudget` and
`reopenExperimentBudget` APIs continue to create and require schema v1 with
their original three channels. The exported `CHANNELS` list is unchanged.

## Operator sequence

Given the original exact `{ directory, runId, limitMicroUsd, requestCap }`
configuration, call `inspectExperimentBudgetForEmbeddingUpgrade(config)` on
the existing private ledger. It accepts a valid v1 or v2 file and returns only
`schemaVersion`, `runId`, `limitMicroUsd`, `requestCap`, `reservedMicroUsd`,
`requestCount`, `state`, and `historySha256`. It exposes no
attempts. The caller must independently decide whether transition is allowed;
inspection itself confers no spending or transport authority.

To transition, pass those same four config fields to
`upgradeExperimentBudgetForEmbeddings`, plus
`expectedCheckpoint: { requestCount, reservedMicroUsd }` and
`expectedHistorySha256` copied from the inspection. The call validates the
complete ledger and binding again under one `BEGIN IMMEDIATE` transaction.
Only an open ledger with every attempt terminal can transition. A matching v1
file returns `status: 'upgraded'`; an unchanged, matching v2 file returns
`status: 'already-upgraded'`. A new attempt or changed history invalidates the
old request. A busy writer is reported without automatic retry. A crash before
commit leaves v1; a crash after commit leaves v2, so the same bound request can
be used to distinguish and recover either durable state.
After an abrupt pre-commit process loss, SQLite may need writable hot-journal
recovery; the bound upgrade is the recovery path. Read-only inspection never
repairs the file and can report a fixed failure until that recovery occurs.
The upgrade and explicit v2 reopen use existing-only writable SQLite opens:
if the checked file disappears before open, neither API creates a replacement.
This does not resolve every hostile same-user inode swap or filesystem race.
Legacy v1 opening behavior is unchanged.

`reopenEmbeddingExperimentBudget(config)` requires an existing exact v2 file.
Its handle has the original reserve, record-outcome, get-state and close
semantics, plus channel `host-embedding`. All four channels share one request
counter and one reservation total. An unsettled attempt after a crash remains
charged and must not be silently settled, deleted, retried or refunded. A
legacy v1 handle fails its next operation after the file becomes v2. Old
binaries cannot read v2; do not roll one back onto a migrated file.

For a later separately authorized transport, use
`inspectEmbeddingExperimentBudgetSnapshot(config)` to read a detached, frozen
exact-v2 state and rowid-aware history digest without repairing or changing
the ledger. It can inspect a valid pending or overrun ledger for diagnosis.
`openBoundEmbeddingExperimentBudget({ configuration: config, authorize })`
requires an open, terminal exact-v2 ledger. It calls a synchronous authorizer
with that snapshot inside a write transaction, requires an `undefined` return
and unchanged ledger identity and state, and returns a bound handle. The bound
handle rechecks the whole rowid-aware witness and file identity around every
operation; its `getState()` includes the history digest. Neither API grants
HTTP access or performs an upgrade. Existing v1 readers and G request guards
continue to refuse v2; a future mixed-engine grant needs a separate protocol.

## History binding and limits

`historySha256` is lowercase SHA-256 of UTF-8 `JSON.stringify` on this exact
array (where `attempts` are in ascending SQLite rowid order):

```text
[
  "cairn.embedding-budget-history.v1",
  [run_id, limit_micro_usd, request_cap, reserved_micro_usd, request_count, state],
  attempts.map(a => [a.rowid, a.attempt_id, a.channel,
    a.reserved_micro_usd, a.outcome, a.actual_micro_usd])
]
```

Null outcome/actual values are JSON `null`. Explicit rowids, including gaps,
and every attempt are included. `schemaVersion` is excluded so migration alone
does not change the digest. This is an optimistic concurrency/history check,
not a signature or protection against a party able to forge database contents.
The new APIs reject non-plain, accessor-bearing or extra-field input before
filesystem access. Rowids outside JavaScript's safe-integer range are rejected
by the new inspection/migration path; the legacy v1 read path is unchanged.
No new cap, separate grant file, HTTP route, retry policy, embedding price or
model is supplied here. Those require a separately frozen transport packet.
The bound witness detects edits relative to its observed snapshot, not an
attacker able to replace both database and application state. SQLite can roll
back changes inside an authorization transaction; it cannot undo arbitrary
filesystem writes by a malicious callback.
