# Experiment budget foundation — offline only

The next real-chat experiment must share one budget between the host chat model
and Cairn's count/generation requests, including after process restart. This
module supplies persistent reservation accounting. Verification targets Linux
on Node 22.16 and 24; POSIX mode checks are not a Windows ACL guarantee, and no
Windows support is claimed. It does **not** intercept
Hermes or provider traffic and does not authorize any paid execution.

Use one new ledger per separately approved experiment, never a new ledger per
session, subprocess or retry. All participating adapters must eventually open
that same ledger with the same immutable run identity, limit and request cap.
Creating a fresh ledger is not permission to refill historical spending authority.
The benchmark's separately audited extension conditionally changed the
existing run from the fixed cumulative US$50 ceiling to US$100 while retaining
every row and binding. A separately bound `benchmark-budget-chain-v1`
US$100→US$200 chain was first validated offline, then applied once through
`authorizeChainedBenchmarkBudgetExtension` while retaining the completed
US$100 history; see the [historical milestone record](plans/comparative-reliability-milestones.md).
That record is not a current balance audit or permission to repeat the
transition, change the ledger, spend, or grant transport. Neither transition
is exposed by the ordinary constructors; see
[the guarded benchmark contract](experiment-request-guard.md#benchmark-monetary-budget-extension).

## Accounting contract

Amounts are safe-integer micro-US dollars (1 USD = 1,000,000 units), not floating
point dollars. Before a future request is sent, its adapter must reserve a
conservative upper bound under a unique attempt ID. Host completion, Cairn count
and Cairn generation consume the same limit and request cap. A zero-cost count
still consumes one request slot. Retries require separate attempts and fresh
reservations; the ledger never retries a request itself.

Reservations are never refunded, even when observed usage is lower, a request
fails or a process dies. An unfinished reservation is unresolved, not evidence
that a provider was never called. Unknown usage remains unknown. Terminal
outcomes cannot be rewritten. If actual reported cost exceeds a reservation,
the overrun is retained and later reservations are blocked.

The invariant is about **reserved upper bounds**, not a guaranteed provider
invoice ceiling. Incorrect prices, underestimates or traffic bypassing the
ledger can still overspend. Before live use, separately reviewed adapters must
enforce pinned models/prices, bounded request sizes/output, all paid count and
generation paths, transport retries, the shared ledger path and crash handling.
Those adapters and the real-host experiment are not implemented by this slice.

## Storage and safety

The ledger is experiment metadata, separate from the memory engine/database.
It stores validated opaque IDs, channels, amounts and outcomes, not prompts,
API keys, transcripts or raw provider errors. Keep its new directory private
(0700) and SQLite file private (0600). Supply an explicit controlled path with
real nonsymlink ancestors. Do not replace paths while processes are using it.
Filesystem validation is not a sandbox against a hostile same-user process.

Writable ledger connections use a fixed 1,000 ms SQLite busy timeout so a short
concurrent reader can release its lock before a reservation or settlement
transaction fails. Read-only inspectors keep their existing behavior. This is
a bounded local lock wait, not a provider retry, transaction replay, automatic
reconnect or second settlement attempt. Journal mode, schema and permissions
are unchanged. A lock that outlasts the wait still fails closed as `ledger_busy`;
an unsuccessful settlement retains the full pending reservation.

Synthetic child-reader tests demonstrate this contention mechanism. They do
not establish why an earlier terminal experiment failed, settle its pending
record, refund reservations or authorize another run.

Creation and reopening are separate operations. Reopening must not initialize
a missing ledger, reset prior reservations or accept different configuration.
Do not delete an experiment ledger to recover budget. Keep failed/partial files
for inspection and choose a new path only for a newly authorized experiment.

## API example (synthetic, no model request)

From the repository root, Node >=22.16:

```sh
npm run test:experiment-budget
npm run demo:experiment-budget
```

The demo creates and retains its own synthetic temporary ledger; its amounts
are simulated, not actual model charges. The equivalent minimal API usage is:

```js
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createExperimentBudget, reopenExperimentBudget,
} from './evaluation/experiment-budget/index.mjs';

const parent = mkdtempSync(join(tmpdir(), 'cairn-budget-example-'));
const config = {
  directory: join(parent, 'ledger'),
  runId: randomUUID(),
  limitMicroUsd: 1_000_000, // Synthetic accounting ceiling, not spending approval.
  requestCap: 10,
};
const attemptId = randomUUID();
const first = createExperimentBudget(config);
try {
  first.reserve({ attemptId, channel: 'host-completion', reservedMicroUsd: 100_000 });
  // No network operation here. Unknown means the attempt remains reserved.
  first.recordOutcome({ attemptId, outcome: 'unknown' });
} finally { first.close(); }

// Another process/session must receive this same config, not create a new run.
const resumed = reopenExperimentBudget(config);
try { console.log(resumed.getState()); }
finally { resumed.close(); }
```

Configuration and attempt IDs are canonical lowercase UUIDs. The supported
channels are `host-completion`, `cairn-count` and `cairn-generation`. Outcomes
are `succeeded`, `failed` and `unknown`; `actualMicroUsd` is optional, and
omission means unknown usage. Duplicate attempt IDs reject instead of replaying
a reservation. A `ledger_busy` failure means no authorization to send a
request; there is no built-in retry or permission to bypass the ledger.

## Exact API contract

All methods are synchronous and throw on failure; they do not return the
memory core's `{ok, value}` envelope. Exports are `createExperimentBudget`,
`reopenExperimentBudget`, `inspectExperimentBudgetSnapshot`,
`transitionExperimentBudgetCaps`, `ExperimentBudgetError`, `CHANNELS` and
`OUTCOMES`.
The last two are frozen arrays containing the channel/outcome strings above.
All option objects have closed key sets; arbitrary metadata is rejected.

Both constructors require exactly `{directory, runId, limitMicroUsd, requestCap}`
and return a frozen handle. Limits/caps are positive safe integers. The directory
is resolved against the current working directory; use an absolute path so
independent processes resolve the same ledger. `createExperimentBudget` requires
an absent leaf; `reopenExperimentBudget` requires the existing private ledger
and matching identity/configuration. Neither constructor grants network access.

| Handle method | Input | Return |
| --- | --- | --- |
| `reserve` | Exactly `{attemptId, channel, reservedMicroUsd}`; amount is a nonnegative safe integer | Frozen attempt record, with `outcome: null`, `actualMicroUsd: null` |
| `recordOutcome` | `{attemptId, outcome}` and optionally `actualMicroUsd`, a nonnegative safe integer | Frozen terminal attempt record; omitted cost becomes `null` |
| `getState` | No arguments | Frozen state snapshot described below |
| `close` | No arguments | `undefined`; releases the connection, idempotent |

Attempt records have exactly `{attemptId, channel, reservedMicroUsd, outcome,
actualMicroUsd}`. `outcome: null` denotes an unresolved reservation; terminal
values are the exported outcomes. `actualMicroUsd: null` is unknown usage, not
zero; callers omit the input field rather than passing `null`.

State snapshots have exactly `{runId, limitMicroUsd, requestCap, reservedMicroUsd,
requestCount, state, attempts}`. `state` is `open` or `overrun`; the ordered
attempt array and each record are frozen too. Snapshots are detached observations,
not live views: call `getState` again for a later coherent transaction snapshot.
Valid operations on a closed handle throw `ledger_closed`; closing again is safe.

The separate maintainer-only `inspectExperimentBudgetSnapshot(configuration)`
checks an existing private ledger in a read-only SQLite transaction and returns
that same frozen state shape without a writable handle. It does not require
settled rows. `transitionExperimentBudgetCaps({oldConfiguration,
newConfiguration, expectedCheckpoint, authorize})` is existing-only: the two
configurations have the same resolved directory and run ID and strictly higher
monetary and request caps. It owns a writer transaction, validates the exact
settled checkpoint and immutable attempt prefix, and calls one synchronous
trusted `authorize({mode, state, checkpointAttempts})` binding callback while
locked. `mode` is `transition` at the old caps or `replay` at the exact new
caps. Only an `undefined` callback return is valid. The helper updates the two
cap fields conditionally, verifies the post-state and returns the frozen state;
it never hands the callback a database handle. A callback is not a sandbox or
operator authorization. The [benchmark chain](experiment-request-guard.md)
owns the only intended campaign binding; direct helper use grants no transport.

The snapshot and transition APIs reject hard-linked database files and check path identity
and private modes under the transaction. The transition uses an encoded
`mode=rw` SQLite file URL, so disappearance before open cannot create a new
database; special-character paths remain encoded. This is a bounded race
defense, not isolation from a privileged same-user actor repeatedly swapping
paths: Node SQLite does not expose the opened database file descriptor for an
independent inode check. Older create/reopen paths are unchanged.

`openBoundExperimentBudget({configuration, authorize})` is a separate
maintainer-only existing-ledger path for one prospective guard. It takes the
same exact four-field configuration and one synchronous trusted callback. A
single existing-only writable connection owns `BEGIN IMMEDIATE`, validates a
fully settled exact state, passes a frozen detached snapshot to `authorize`,
and checks unchanged state and private path identity before committing. The
callback must return `undefined`; it is neither a sandbox nor permission to
make a request. It may durably create an authorization file or claim, which is
never removed merely because a later step fails.

The returned handle has the usual `reserve`, `recordOutcome`, `getState` and
`close` signatures. Unlike ordinary reopened handles, it witnesses the whole
initial ledger history and accepts only the exact changes committed by its own
reserve/settlement calls. It checks that witness within every transaction,
including reservation, and checks the intended post-state and path before
commit. Foreign rows, edits, mode/link/path changes and schema failures fence
it before further transport. Any failed bound transaction, including an
exhausted cap, also fences it conservatively; subsequent operations return
`ledger_closed`. No balance is refunded or adopted, and old create/reopen
behavior is unchanged. The bound
handle still cannot police direct network egress or hostile privileged writes
after the final path check.

`ExperimentBudgetError` has `name: 'ExperimentBudgetError'`, a fixed `code`, and
the same code as `message`. The fixed code set is:

| Codes | Meaning |
| --- | --- |
| `invalid_options` | Invalid option shape, UUID, channel, outcome or integer |
| `unsafe_path`, `unsafe_database_file` | Unsafe path/type/permissions, including checked sidecars |
| `directory_exists`, `ledger_missing` | Create would reuse a directory, or reopen lacks its ledger |
| `invalid_ledger` | Unrecognized schema or inconsistent persisted state |
| `run_mismatch`, `configuration_mismatch` | Identity, ceiling or cap differs from the persisted run |
| `attempt_exists`, `attempt_not_found`, `attempt_terminal` | Duplicate reservation, missing attempt or terminal rewrite |
| `budget_exceeded`, `request_cap_exceeded`, `budget_blocked` | Reservation would exceed a bound, or an overrun has blocked the run |
| `ledger_busy`, `ledger_closed`, `ledger_failed` | SQLite contention, closed handle or another mapped storage/connection failure |

Failure supplies no permission to send a request. Reservations remain
conservative after a terminal outcome; even `state: 'open'` does not mean there
is enough remaining allowance for the next attempt. Re-read/inspect on an
uncertain storage outcome instead of assuming it is safe to replay.

## Exact orphan settlement — maintainer only

`settleOrphanedEmbeddingAttemptUnknown({configuration, expectedCheckpoint,
expectedAttempt, authorize})` is one existing-only accounting operation, not a
recovery, spending or resume capability. It requires the exact schema-v2 ledger
and existing four-field configuration. `expectedCheckpoint` has exactly
`{requestCount, reservedMicroUsd, historySha256}`; `expectedAttempt` has exactly
`{attemptId, channel, reservedMicroUsd}`. The latter implies a pending outcome
and unknown actual usage. Embedding channels additionally include
`host-embedding`. Option descriptors must contain data, not accessors; symbols,
extra fields and malformed values are refused.

Under one `BEGIN IMMEDIATE` transaction the helper checks the complete inspected
history, open state, private filesystem identity, and exactly one pending row
matching that target. It calls a synchronous trusted `authorize({state, target})`
once with detached frozen data and requires `undefined`. Declared asynchronous
callbacks are refused before invocation; promises/nonundefined returns and thrown
exceptions fail closed. The callback receives no database or writable handle and
is not a sandbox or proof of operator approval. History and path identity are
checked again afterward. A conditional single-row update changes only the target
outcome to `unknown`, preserving null actual usage, its full reservation, every
other row/rowid/order, counters, schema, caps and run state. The precise intended
post-history is checked before commit. The returned frozen snapshot has the
existing v2 inspection shape, including `historySha256`, not execution authority.

Duplicate/terminal settlement refuses rather than succeeding idempotently.
Failure before commit rolls back; a failed acknowledgement or close after commit
may leave the settlement committed. Inspect the ledger read-only to resolve that
uncertainty; do not automatically retry or reconnect. Existing bound constructors
still refuse pending histories, and legacy reopen semantics are unchanged.
The bounded path checks do not defend against a hostile same-user actor; the
history hash is an integrity witness, not authentication. Primary-held exact
target approval and independent verification that the old local process has
stopped and no local dispatch ownership remains are external prerequisites.
Remote provider completion and charges can remain unknown after a crash; the
full reservation is retained. Pending rows contain no case identity and cannot
establish request success, billed cost or lost answers.

The [orphan-settlement plan](plans/orphan-attempt-settlement.md) defines synthetic
coverage in the existing `test:experiment-budget` CI gate. Those checks settle no
actual orphan and authorize no new experiment, refund or budget increase.

## Remaining gate

A separate [experiment HTTP guard](experiment-request-guard.md) now connects
this ledger to explicitly injected, bounded host/Cairn transports and verifies
them with fake HTTP. The ledger API itself remains accounting-only; the new
guard does not yet route a real Hermes host or authorize paid execution.

The [acceptance plan](plans/experiment-budget.md) defines the offline tests.
Passing these tests does not mark the combined live guard in V05 complete.
Transport integration, protected real Hermes sessions and a new explicit paid
budget remain required. No Stripe, private provider billing or release change
is implied: this is test-spending protection, not customer billing.
