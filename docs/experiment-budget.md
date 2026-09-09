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

## Remaining gate

The [acceptance plan](plans/experiment-budget.md) defines the offline tests.
Passing these tests does not mark the combined live guard in V05 complete.
Transport integration, protected real Hermes sessions and a new explicit paid
budget remain required. No Stripe, private provider billing or release change
is implied: this is test-spending protection, not customer billing.
