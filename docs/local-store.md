# Local memory store — developer preview (2A)

The additive [S2a model-free core contract](storage-contract.md) provides explicit
admission and bounded metadata/source inspection over this same store. Existing
methods and result shapes below are retained; their mutations also invalidate
the new inspection cursors and [S2b MOC memberships](moc-placement.md). Opening
v1/v3/v4/v5/v6/v7 data now upgrades it to v8 for
[historical currentness](supersession.md), preserving index generations,
[conflict hints](conflicts.md) and [admission claims](admission-claims.md).
Draft-v2 and unknown formats are rejected; older binaries cannot open v8.
Stop all older-runtime processes/connections, including idle readers, before
the upgrade. Previously opened old runtimes are not retroactively fenced;
mixed-version coexistence is unsupported.

This is a real SQLite persistence library runnable from public source. It is
**not yet a standalone memory service**: no model extraction, semantic recall,
local MCP/HTTP server, or host adapter is wired to it. The released Claude
plugin still uses its configured service. No Cairn account is needed for this
library; no telemetry, network client, or cloud fallback exists in its runtime.

## Run the synthetic example

Use Node >=22.16 (tested in CI on 22.16 and 24). The existing plugin still
supports Node 20. The store uses Node's built-in SQLite, which emits an
experimental warning on 22.16; no npm install or database server is required.

```bash
git clone https://github.com/Cairn-ink/cairn-memory.git
cd cairn-memory
npm run test:core
npm run demo:store
```

The example creates a new private temporary database, writes synthetic memory,
reopens it, checks lexical lookup and receipts, tests isolation, corrects the
memory, forgets it, and rejects replay. It prints the retained temporary file
path for inspection. Tests also verify restart in separate Node processes.
This is storage evidence, not an extraction or retrieval-quality benchmark.

## Embedded API

Import from a checkout (the repository is not an npm-published package):

```js
import { openMemoryStore } from './core/index.mjs';

const store = openMemoryStore({ path: '/your/private/directory/memory.sqlite' });
try {
  const memory = store.scope({ ownerId: 'local-user', projectId: 'project-a' });
  const saved = memory.remember({
    content: 'Use SQLite for local persistence',
    kind: 'decision',
    receipt: {
      client: 'my-app', sessionId: 'session-1', eventId: 'message-1',
      role: 'user', excerpt: 'We decided to use SQLite for local persistence.',
    },
  });
  const results = memory.search('SQLite');
  const current = memory.get(saved.id);
  const corrected = memory.correct(saved.id, {
    content: 'Use SQLite for the prototype only',
    kind: 'decision',
    receipt: {
      client: 'my-app', sessionId: 'session-2', eventId: 'correction-1',
      role: 'user', excerpt: 'Correction: SQLite is for the prototype only.',
    },
  }, current.revision);
  memory.forget(corrected.id, corrected.revision);
} finally {
  store.close();
}
```

Use a private directory controlled by the application. The store creates new
directories with mode 0700 and new database files with mode 0600. On POSIX it
rejects existing group/world-accessible database files; it does not silently
change their permissions. On Windows, restrict access using filesystem ACLs.
`:memory:` is available for ephemeral use. Close connections when finished.

| API | Behavior |
| --- | --- |
| `store.scope({ownerId, projectId?})` | Explicit owner; omitted project means personal, supplied nonempty project means that exact project |
| `remember(input)` | Validates and atomically stores memory + required receipt; merges exact duplicates within that namespace |
| `get(id)` | Active memory or `null`; other namespaces are indistinguishable from missing IDs |
| `list({limit?})` | Active memories, newest first; default 20, maximum 100 |
| `search(query, {limit?})` | Active lexical matches within this namespace; same limit bounds |
| `correct(id, input, expectedRevision)` | Explicit correction, same memory ID, new revision and active receipt; conflict if stale |
| `forget(id, expectedRevision)` | Removes active text/receipts; `false` if missing, deleted, or outside the namespace |
| `store.close()` | Idempotent; subsequent scope operations fail |

Returned records contain `id`, `content`, `kind`, `scope`, `projectId`, `origin`,
`confidence`, `revision`, timestamps, and Source Receipts. This is an internal
JavaScript contract, **not an extension to the v0.1 HTTP schema**; adapters must
map fields and enforce their own protocol.

Inputs reject unknown fields. Text is normalized (NFKC), redacted, whitespace
collapsed, and validated. Content is at most 4,000 UTF-16 units; source input is
at most 20,000 units and stored excerpts are bounded to 800 without splitting
code points. Redaction runs before excerpt truncation and is best-effort.
Identifiers are opaque caller-provided strings, not text to redact: never use
credentials, raw paths, or private prose as owner/project/client/session/event
IDs. They are stored locally as supplied.

Kinds are `fact`, `preference`, `decision`, `instruction`, and `context`.
Origin defaults to `explicit` with confidence 1. To store model output, supply
`origin: 'agent-inferred'` and confidence in [0, 1], plus an actual source
receipt. Accepting inferred input does **not** mean the store performs inference.

## Boundaries and concurrency

All methods are scoped to one owner and **one exact namespace**. Project lookup
does not automatically include personal memory. A future HTTP adapter can merge
personal and matching-project results to implement the published recall protocol;
it must not broaden mutation permissions. There is no shared/team namespace.

The caller authenticates and chooses the owner. Anyone who can call `scope()`
with arbitrary owners, or read the database, can access their data. This is not
a network authorization layer or encrypted vault. Recalled text and receipts
remain untrusted user data, never privileged instructions.

SQLite transactions serialize mutations across processes (five-second busy
timeout); read transactions keep memory and receipt revisions consistent.
Replaying the same normalized, case-insensitive content and same receipt is a
no-op. Distinct receipts are merged. Explicit confirmation can upgrade an
inference, but inference never downgrades explicit metadata. Actual changes
increment the revision, so callers must re-read after a conflict rather than
blindly retry a stale correction/deletion. Storage deduplication is not an
extraction-job lease or a promise of exactly-once model calls.

## Correction, forgetting, and retention

The shared core's explicit [supersession operation](supersession.md) can retain
an earlier assertion as historical. Legacy `get`, `list` and `search` return
current memories only; use `openMemoryCore().get/list` for labeled historical
inspection. Historical records reject correction but permit revision-guarded
forgetting. Retired fingerprints remain suppressed and are not reactivated by
remembering the same text or by forgetting the replacement.

Correction replaces active text and receipts; old text is no longer returned
through any store API. Correction to another active memory's content fails
with `memory_conflict`, without merging or deleting either record.

Forget clears the memory's text and removes its active receipts in the same
transaction. Both correction and forgetting retain namespace-scoped SHA-256
fingerprint suppression records so old input cannot silently resurrect the
content. Forget also retains ID, namespace, revision, and non-content metadata.
Suppression is conservative: even an explicit re-remember of identical old
content raises `memory_suppressed`. Restore/unsuppress and export/import are
not implemented in 2A. Suppression prevents exact normalized replay, **not a
paraphrase of the same fact**; semantic conflict handling belongs to later stages.

Hashes are not encryption and may reveal guessable content through dictionary
attacks. Deleted or corrected bytes may remain in SQLite free pages, journals,
OS snapshots, or backups. No secure-erasure claim is made. The library has no
content logging or automatic backups; applications remain responsible for
their own logging, retention, filesystem security, and backup deletion.

## Limits and next stages

Search counts literal, normalized query-token substrings in active content;
ties use update time and ID. It is not embedding similarity, performs no
stemming/translation, and can match substrings such as `or` in `storage`.
Empty/punctuation-only and nonmatching queries return no results. Search scans
the namespace in memory; receipts are uncapped in count. This synchronous
implementation targets small local datasets, not high-throughput deployments.

Use a local filesystem, trusted database path/parent directories, and one
application-controlled database. Do not open untrusted SQLite files or share a
file across machines/network filesystems. Unknown database/schema versions are
rejected, never reset. Supported schema upgrades are automatic; there is no
general import/export or downgrade tool yet.

The S2b preview adds guarded classification through an injected adapter, not a
bundled model. [S2c](fetch-recall.md) adds bounded fetch/recall orchestration.
Local MCP, real-model evaluation and export/restore remain separate work.
Hosted migration remains a separate, behavior-tested change.
The existing released plugin's default-on telemetry is unchanged; this store
has no telemetry at all. See [acceptance and dependency provenance](plans/local-memory-store.md).
