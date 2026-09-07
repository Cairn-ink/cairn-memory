# Model-free core contract — S2a preview

This is the first implementation slice of the Memory/MOC core contract, not the
complete memory engine. It uses the **same SQLite storage** as `openMemoryStore`.
There is no model, MCP server, hosted account, network client, telemetry, or cloud
fallback in this path. The released HTTP plugin is unchanged.

Use Node >=22.16 and a source checkout; this is not an npm-published package:

```js
import { openMemoryCore } from './core/contract.mjs';

const core = openMemoryCore({ path: '/your/private/directory/memory.sqlite' });
const namespace = { ownerId: 'local-user', scope: 'project', projectId: 'demo' };
try {
  const result = core.admit({
    namespace,
    memory: { content: 'Show sequence diagrams for protocols.', kind: 'instruction' },
    receipts: [{ client: 'example', sessionId: 'session-1', eventId: 'message-1',
      role: 'user', excerpt: 'Show sequence diagrams for protocols.' }],
  });
  if (!result.ok) throw new Error(result.error.code);
  const { id, revision } = result.value.memory;
  console.log(core.list({ namespace, limit: 20 })); // metadata only
  console.log(core.get({ namespace, memoryId: id, receiptLimit: 20 }));
  console.log(core.forget({ namespace, memoryId: id, expectedRevision: revision }));
} finally { core.close(); }
```

Only use synthetic content when trying the example. The path must be controlled
by the application; do not point preview code at production or a user's only
database. The [local store security and retention limits](local-store.md) apply:
no encryption or secure erasure, local file access is trusted, and redaction is
best-effort. Constructor/storage-opening errors throw; operation failures return
`{ok:false,error:{code,retryable}}`, never an empty success or raw database message.

## What works

- Explicit `admit`: one to four source receipts in one transaction, stable
  memory/source IDs, duplicate no-op handling and namespace-scoped suppression.
- `list`: metadata only, including unfiled memories, bounded keyset pages beyond
  any recent-40 window. No content or receipt excerpts are returned here.
- `get`: content with separately paginated receipts at a consistent revision.
- `correct` and `forget`: revision checks, replacement/removal of active receipts,
  persistent suppression and atomic invalidation of inspection cursors.

The exact inputs, result fields and acceptance gates are in the
[S2a plan](plans/s2-storage-contract.md). Unknown fields are rejected. The subsequent
[S2b extension](moc-placement.md) adds real placements and filed/unfiled state;
[1c](conflicts.md) adds optional admission hints and attributed conflict inspection.

Personal scope must be exactly `{ownerId,scope:'personal',projectId:null}`.
Project scope must be exactly `{ownerId,scope:'project',projectId}` with a
nonempty opaque project ID. Namespace is selected by a trusted host; the library
does not authenticate callers. Inspection/mutations never implicitly include
another namespace, even for the same owner. IDs outside the scope are not found.

## Pagination and revisions

Pass `nextCursor` back as `cursor` to `list`, or `nextReceiptCursor` as
`receiptCursor` to `get`, keeping the namespace, limit and filters unchanged.
Only `exhausted:true` indicates the end of the requested range. A signed cursor
survives restart but is invalid in another store, operation or scope. Cursors
are tamper-evident, not encrypted credentials or authorization grants.

A namespace mutation makes its old cursors `cursor_stale`; restart pagination
from the beginning. Exact no-op retries do not invalidate them. A stale mutation
returns `revision_conflict`; reread before deciding whether to retry. Writes via
the existing low-level store also update the same namespace epoch, so switching
between APIs cannot bypass this safety rule.

Temporary SQLite lock contention returns `storage_busy` with `retryable:true`.
Other failures return `retryable:false`; a CAS conflict requires a fresh read and
an explicit decision, not blind replay of the stale request.

## Database upgrade boundary

Opening the committed v1, v3, v4 or v5 format performs an atomic upgrade to v6, retaining
existing memory/source data, revisions and suppression. Back up the file while
all writers are closed before upgrading meaningful data. Old v1/v3/v4/v5 binaries cannot
open v6; there is no downgrade tool. The unmerged engine draft reserved v2; this
slice deliberately **rejects v2** rather than guessing its migration semantics.
Keep draft-engine test databases separate. Unknown/foreign databases are refused,
not reset. Reconciliation with that draft belongs to the later engine work.

## Verification without overstating coverage

`npm run test:core` includes real temporary SQLite storage scenarios, negative
adapter checks, migration, cursor, rollback and restart tests, in the existing
Node22.16/24 CI matrix. `npm run demo:store` still exercises the old store API.

For a locally available frozen S1 oracle, the test-only runner accepts an
explicit file path; no private fixture contents are bundled or fetched:

```bash
node examples/check-storage-oracle.mjs /absolute/path/to/oracle.json
```

It runs **only M08, M10, M13, M16, M18, M20, M23, M29** against a fresh SQLite
store per case. It compares actual records, source identities and declared
assertions, and rejects unsupported action/assertion fields. It does not run
the rest of the memory/placement suite, infer model quality or emulate model
output. Synthetic setup pins timestamps only; generated runtime IDs and actual
returned revisions/content are never rewritten to make assertions pass.

S2b adds MOC placement/map and a mock-model adapter; [S2c](fetch-recall.md) adds
bounded fetch/recall. MCP integration and real-model evaluation remain separate.
This does not certify the draft
engine's unrelated-query recall behavior. Hosted migration and Moss remain out
of scope; the end goal is one public core consumed by all host adapters.
