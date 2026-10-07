# Local memory store — developer preview (2A)

The additive [S2a model-free core contract](storage-contract.md) provides explicit
admission and bounded metadata/source inspection over this same store. Existing
methods and result shapes below are retained; their mutations also invalidate
the new inspection cursors and [S2b MOC memberships](moc-placement.md). Opening
v1/v3/v4/v5/v6/v7/v8/v9/v10/v11/v12/v13/v14/v15/v16/v17 data now upgrades it to v18 for
[opt-in decision confirmation](plans/confirmation-state.md),
[episode storage and explicit procedural tags](#episode-storage-foundation-se-1),
[opt-in staged capture evidence](staged-capture-evidence.md),
[source-backed proposed rationale](source-backed-rationale.md),
[trusted-manual qualified transitions](qualified-transition.md),
[manual claim qualification](claim-qualification.md),
[ordered capture](capture.md#opt-in-source-ordered-reconciliation) and
[historical currentness](supersession.md), preserving index generations,
[conflict hints](conflicts.md), [admission claims](admission-claims.md) and
the bounded [initial capture classification journal](capture.md).
Draft-v2 and unknown formats are rejected; older binaries cannot open v18.
Stop all older-runtime processes/connections, including idle readers, before
the upgrade. Previously opened old runtimes are not retroactively fenced;
mixed-version coexistence is unsupported.

This is a real SQLite persistence library runnable from public source. It is
**not itself a standalone memory service**. The shared core now supplies capture
and recall, and the optional [local MCP adapter](standalone-mcp.md) exposes
explicit operations; none of these alone adds passive host capture. The released Claude
plugin still uses its configured service. No Cairn account is needed for this
library; no telemetry, network client, or cloud fallback exists in its runtime.

The embedded [bounded source snapshot](bounded-source-snapshot.md) explicitly
returns every current admitted memory's complete retained sources when the whole
authorized read set fits its limits: default 6/max 12 memories total, 4,000 tokens,
and 24,000 UTF-8 bytes for the entire success response. A local exact token counter
is required; no provider key or generation calls are needed. It includes potentially
unrelated sources, excludes staged/history/deleted data and interpretations, and
fails without partial evidence or fallback. Storage-current does not mean true or
still applicable today. Existing recall and MCP defaults are unchanged.

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
`confidence`, `revision`, timestamps, and Source Receipts. Legacy records never
include `reviewEffects`, including when remember promotes an awaiting item.
This is an internal
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

The optional embedded [capture invocation deadline](capture.md) checks the
same capture-owned transaction immediately before commit, so work that
overruns the budget rolls back rather than leaving partial receipts, filing or
rationale. It does not interrupt an individual SQLite instruction or apply to
standalone manual mutations. The existing 125-second admission lease remains a
separate ownership fence.

## Correction, forgetting, and retention

When [staged capture evidence](staged-capture-evidence.md) exists, successful
correction or forgetting also clears every staged source payload in that exact
namespace and fences those old events, including pending capture. This applies
through both facades, even after reopening without the staging option. It does
not delete other admitted memories. The breadth is a conservative first-version
trade-off, not precise source-lineage deletion or semantic blocking of new events.

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

An experimental embedded opt-in is available only with bounded source candidates:

```js
openMemoryCore({
  path, model,
  sourceCandidatePolicy: 'bounded-keyset-v1',
  navigationLabelPolicy: 'rare-query-window-v1',
});
```

It changes only previews for explicit `source-evidence`/`rationale-evidence`
query navigation. It preserves candidate score and ID order, reads no additional
receipts, and selects one contiguous original substring of at most 120 Unicode
codepoints from the body or first four validated receipts. Literal query terms
less common across the authorized top candidates receive more integer weight;
there is no stopword list, translation, stemming or language-specific segmentation.
The option is validated as own data and rejected without bounded-keyset mode.
No source is persisted by preview generation and no model call is made by it;
normal selection may legitimately reach an existing rank call previously skipped.
Public maps, default recall, rank packing, final source output and privacy
boundaries are unchanged. Text pools are temporary, not an archive or a new
capture capability. A single window cannot cover separated or cross-receipt
evidence, and a better-looking label does not establish relevance or semantic
quality. See [the diagnostic limits](limitations.md#experimental-rare-query-navigation-preview).

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

## Episode storage foundation (SE-1)

`sessionEpisodes: {mode:'episode-v1', draftEveryBatches:8}` enables episode storage;
`openMemoryCore` also requires `captureQualification:'source-bound-v2'` and
`captureEvidence:'staged-v1'`. N means `draftEveryBatches`, the draft interval in
accepted batches; it is snapshotted per session, integer 2–16.
Episode mode now enables debounced capture through an injected interpretation port,
quick handling, explicit keep and automatic source-bound procedural tags.
Mode-off capture remains unchanged. See [capture](capture.md#opt-in-session-episodes).

Every open atomically upgrades an older committed format to v18, including with
episodes off. Explicit procedural tags are available immediately in both modes;
no request triggers a lazy upgrade. Inspection and memory correction/forgetting
still enforce episode dependencies with the feature off. The host must stop/drain
**all** older-runtime processes and connections, including idle readers, before
opening the store for upgrade. Older binaries reject v18 on subsequent opens;
an already-open old process is not retroactively fenced. There is no downgrade.

The upgrade runs within the existing immediate transaction with foreign keys on.
It snapshots and drops the two admission children (staging and the v14 initial
classification journal) before rebuilding the admission parent, then restores
both children. Reserved parents have no token, lease, or result. Released staging
retains event ownership, reason and source disposition, with no payload charge.
Foreign-key checking precedes commit; any failure restores the prior schema/data.

Episode identity uses a dedicated 256-bit store HMAC key and a versioned tuple of
exact namespace, client and host session. New episode rows retain only the derived
`s1:` identity. Missing or corrupt keys fail closed. Retained passages have no age
TTL; conversation deletion and source invalidation remove them logically. Old
receipts are unchanged; backups and SQLite free pages remain outside erasure claims.

The v15-to-v16 step adds empty STRICT message-ledger and keep-action tables,
plus bounded message membership and omission columns on the batch journal and a
draft-attempt start flag, atomically with the version update and foreign-key
check. The v14 upgrade runs both migrations in the same transaction. Existing
episodes are not backfilled: overlap detection covers only post-upgrade
registrations. The ledger retains message ID, first and coverage event IDs and a
keyed digest of canonical role/text/event time, never plaintext text or role. It
survives staging release and conversation deletion as content-free replay
metadata. Episode-off capture never writes it. Older binaries refuse v16 with
`unsupported_database`; stop and drain older connections before upgrading.


The v16-to-v17 step adds only four read indexes: episode event end, first receipt
time, open-step creation ordinal, and receipt time across memories. JSON keys
use expression indexes; no columns, tables or source contents change. Every open,
including episode-off opens, completes all required migrations in one transaction
with foreign keys enabled and checked before recording version 17. A failed index
creation rolls back the schema, rows and version together. Older v16 openers
refuse v17; hosts must stop/drain older processes before upgrading.

### Decision confirmation (CF-1)

`openMemoryCore({path, decisionReview: 'required-v1'})` holds automatically
admitted inferred decisions in an independent review state. Ordinary reads exclude awaiting items even when
this option is absent. Person-facing hosts may use `list({reviewState:'awaiting'})`
and `get({includeAwaiting:true})`; model tools must not expose these switches.
`confirm` and `reject` require an expected revision and durable action ID.
`openMemoryStore` does not accept this option. Schema v18 eagerly adds
`memories.review_state`, `confirmation_actions`, `confirmation_supersessions`,
`confirmation_conflicts` (with durable statuses/results and dropped-hint reasons),
bound predecessor fingerprints and receipt IDs for held work, and the
`review_hidden_episodes` view, and updates index eligibility/readers. See the
[contract appendix](plans/confirmation-state.md) for replay, episode visibility,
and the direct-statement provenance limitation.
