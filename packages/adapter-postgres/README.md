# Postgres adapter

The hosted service embeds memory text before writing it. The Postgres adapter
requires an embedding for inserts and replacements. `requireEmbedding(row)`
returns the embedding or throws `CoreError("invalid_input")` when it is null.
The local store supports unembedded rows.

Rows from before the metadata migration have revision and confidence set to 1.
Captures are stored as `plugin` until the hosted service reads `capture`.
Use `storedSourceKind(kind)` on writes and `readSourceKind(kind)` on reads.
A stored `plugin` reads as `plugin` for both captures and legacy plugin rows.
When reading a null `origin`, derive `inferred` for `plugin` and `explicit` for
`mcp`, `web`, or `import`.

`schema/baseline.sql` initializes a disposable database with the hosted
service's memory-pipeline schema. For an existing installation, apply the
forward migrations in `migrations/`. The metadata change commits with its
check marked `NOT VALID`. The next migration validates the check in a separate
transaction while ordinary reads and writes continue.

Migration 0010 adds memory relations. The hosted service ships a byte-identical copy as a drizzle migration until it applies the engine SQL directly.

Load the SQL in the host and pass the full ordered list to
`applyMigrations(source, migrations, options?)`. Use immutable IDs, append new entries,
and set `concurrent: true` for `.concurrent.sql` files. A concurrent file
contains one `CREATE [UNIQUE] INDEX CONCURRENTLY IF NOT EXISTS` statement.
Each concurrent entry supplies `index: { name, table, definition }`. Use the
identifier spellings from the SQL for `name` and `table`, including any schema
or identifier quotes. Set `definition` to PostgreSQL's canonical
`pg_get_indexdef` output for the intended index under the migration session's
search path.

Use a dedicated direct or session-mode PostgreSQL connection. The advisory lock,
DDL, and ledger must stay on one server session. Transaction-pooling proxies
cannot guarantee that. The driver must support querying a transactional SQL
file as a batch and close the session on `release(true)`. Transactional files
and their ledger entries commit together.

For a database whose schema the host already created with the same SQL, a
transactional migration can supply an `async adopt(query)` callback. Use
`await query(text, params)` for a single read-only `SELECT` or `WITH` statement
with an optional trailing semicolon. Use `E'...'` for strings containing
backslashes and a single plain character literal for a custom identifier
`UESCAPE`. The helper returns rows from the runner's connection inside the
migration transaction. Returning `true` records the migration ID without
executing its SQL. Returning `false` runs the SQL.

The helper rejects calls to `pg_advisory_lock*`, `pg_advisory_unlock*`, and
`pg_try_advisory*` functions. A session-level advisory lock acquired indirectly
by a probe lasts until the run ends unless explicitly released. A prohibited
probe, a probe that assigns a transaction ID or loses its savepoint, or a
non-boolean result fails with `invalid_input`. The migration still fails with
`invalid_input` if the hook catches an error from a prohibited probe or an error
that invalidates the transaction or savepoint. A client-side serialization
error before the probe is sent leaves the transaction and savepoint intact, so
the hook can catch it and continue. A failed hook rolls back the migration and
stops the run. Earlier committed entries remain recorded.

After each successful adoption hook, the runner checks that its session still
holds the migration lock before executing the migration SQL or recording its
ID. If the lock is missing, the runner rolls back the migration and returns
`storage_busy` with its `migrationId`. Host hook code runs only on the adoption
path. Between hooks, losing the session would already fail the run, so the
check after the most recent hook also covers the intervening migrations.

The session defaults are a 5-second lock timeout and a 30-second statement
timeout. A transactional migration's own `SET LOCAL` takes precedence. Pass
`concurrentStatementTimeoutMs` in `options` to set the statement timeout for
each concurrent index build and its inspection. It defaults to 30000 and
accepts integer milliseconds from 1 through 2147483647. The runner restores the
session statement timeout after inspection or failure when an override is used.

The runner records a concurrent file after PostgreSQL reports a valid index
with the expected definition. It drops an invalid index with a matching
definition so a subsequent run can retry. The runner attempts the drop even if
restoring the statement timeout fails. An invalid index or a definition mismatch
returns `index_unavailable`. A mismatched index is left in place.
The runner returns `storage_busy` if another runner holds the migration lock or
`invalid_input` if the manifest omits an applied migration or has a gap in the
applied prefix.
When an individual migration fails, the thrown `CoreError` also carries its
`migrationId`.

The migration runner sets `search_path = public, pg_catalog` and turns off
identifier quoting before it compares index definitions. These session settings
keep the runner's target objects and comparisons independent of caller settings.

## Suppression fact storage

Migrations 0005 and 0006 add owner state, suppression facts, and their digest
rows. Each new fact advances its owner's `fact_epoch` by one. The owner's
`index_revision` advances once per committed run that changes visible rows,
receipts, raw data, lineage, or facts. This is the value returned as
`FinishResult.indexRevision` and used to bind retrieval state tokens.
`legacy_facts_ready` defaults to false for the later legacy copy. The backfill
must keep each non-null `legacy_ref` within 256 UTF-8 bytes so the owner and
reference can be indexed together.

Use `legacySuppressionsToFacts(rows, owner)` to convert an owner's legacy rows
before writing them into `core_suppression_facts`. The batch helper calls
`legacySuppressionToFact(row, owner)`, which the live read union also uses.
It returns `{ facts, uncopyable }`. Include all rows sharing a slot in the same
batch. Rows with identical matching evidence in one slot merge at the latest
cutoff. If a slot has conflicting matching evidence such as different embeddings,
the helper omits that slot from `facts` and returns every legacy row ID for the
slot in `uncopyable`. This query projects the expected row shape.

```sql
SELECT id, kind, origin, client, session_id, text_hash, text_hmac, key_id,
  redaction_version, embedding::text AS embedding, shingles,
  floor(EXTRACT(EPOCH FROM window_start) * 1000) AS start_ms,
  ceil(EXTRACT(EPOCH FROM window_end) * 1000) AS end_ms,
  trunc(EXTRACT(EPOCH FROM created_at) * 1000000)::text AS created_at_us
FROM suppressions WHERE user_id = $1
```

The helper returns validated facts with the supplied owner and `actionId: "legacy"`.
The copy supplies storage IDs and epochs. A read matches a legacy edit by
physical `text_hash` equality alone. Full legacy facts also use digest and
vector matching on reads. For `forget`, `correct`, and `backfill`, physical
`mcp` and `web` rows with a server creation time strictly after the cutoff skip
vector matching. A cutoff of `-infinity` exempts later timestamps, while
`infinity` keeps vector matching enabled at every timestamp. Null-origin text
suppressions use `infinity`.

On writes, legacy cutoff facts apply the full policy. Write-side parity with
the hosted explicit-save exemption is deferred.

The slot helper and insert builder in `src/facts.mjs` snapshot the fact before
running core validation and the adapter's storage checks. They derive all
stored values from that snapshot. The adapter requires plain records with only
declared fields, the declared JavaScript types, and dense arrays. It rejects
U+0000 and unpaired UTF-16 surrogates anywhere in the fact, digest redaction
versions above 2147483647, and slots over 8192 UTF-8 bytes with
`CoreError("invalid_input")`.
For full-mode text facts, a non-null embedding must contain exactly 1536 finite
numbers in the float4 range, and non-empty shingles require a non-empty key ID.

`factSlot(fact)` uses `JSON.stringify` on the following target tuples.

The slot is the canonical JSON array `[namespace ?? null, ...target]`. Each
digest contributes `[alg, value, keyId, label ?? pipeline, pipeline, redactionVersion]`.
New keyed fact bodies include the signing label, defaulting to the pipeline
when the caller omits it. Unkeyed SHA evidence follows Core's label-free format.
Historical fact bodies and their shorter `[alg, value]` slot entries remain
readable. A retry checks the historical body's full domain before reusing its slot.

| Kind | Target |
| --- | --- |
| Identity | `["identity", memoryId, throughRevision ?? null]` |
| Text | `["text", mode, [digest, …], sourceMemory?.id ?? null]` using every digest tuple in canonical order |
| Session | `["session", client, "id", sessionId]` or `["session", client, "hash", sessionKeyHash]` |
| Window | `["window", client, startMs, endMs, unknownTime === true, anchor ?? null]` |
| Raw span | `["rawSpan", sessionKeyHash, messageKey, startUtf16, endUtf16]` |

A null window client selects all clients. `canonicalDigests(digests)` sorts a
copy by algorithm, then value, then the encoded target tuple, in UTF-8 byte
order. Reordering the same digests preserves the slot.
Store the JSON slot for diagnostics and use
`slotHash(slot)` for the lowercase SHA-256 of its UTF-8 bytes. The owner and
hash form the unique key.

The first hosted rollout applies the full engine migration chain to a fresh
database, with `core_fact_digests` empty when 0024 runs. Use a populated-table
variant before applying 0024 to any database with existing facts. Migration
0024 rewrites the digest table under an exclusive lock and refuses to proceed
if it has more than 10,000 rows.

Store core's canonical `factBody(snapshot)` in `body`. Migration 0024 adds the
effective label and a bounded lookup key over the complete digest tuple to
`core_fact_digests`. New text facts write lookup rows for every distinct digest,
including labelled digests. Existing lookup rows use their pipeline as the
effective label. Populate the embedding and shingle lookup columns
only for full-mode text facts. The `vector(1536)` column is a float4 projection
used only for neighbour search, and `body` stays authoritative. In exact mode,
the embedding and shingles stay in `body` for raw checks, with no vector
dimension or float4 range check. Leave the shingle lookup column null for
absent or empty shingles. A populated shingles column requires `key_id`.

## Topics and document cards

Migration 0007 defines the topic store, 0008 adds the concurrent oldest-first
index on `memories`, and 0009 defines `document_cards`. Migration 0011 adds
`card_placements` and `card_topics`. These migrations skip objects already
created by the hosted service. The hosted service applies a byte-identical
copy of `0011_core_topic_cards.sql` as a Drizzle migration. Make subsequent
changes to these tables through adapter-postgres migrations.

Register `createPostgresTopicStore()` as the `placement` port with
`capabilities({ placement: true })` when composing the adapter. The topic store
supports single-memory and batch annotations. Its cursors incorporate both the
hosted topic revision and the core owner index revision.

The Postgres TopicStore uses the hosted topic schema and supports personal scope
(`namespace: null`). Every method throws `capability_unavailable` for a non-null
namespace. Hosted scope mapping is deferred to scopes step 2.

As a P2 difference, Postgres returns L1 `parentIds` in UTF-8 parent ID order.
The in-memory store preserves placement order.

## Memory ports

Migration 0013 adds memory namespaces, digest evidence, and the creation-time
sidecar. Migration 0014 adds the receipt-time sidecar in a separate transaction.
Receipt times that PostgreSQL represents exactly stay in `occurred_at`.

`core_namespace` stays null on hosted until the product's scopes step 2 defines
the mapping. The adapter rejects non-null namespace writes on hosted unless
`allowNonNullNamespace` is enabled on the respective memory, supersession, and
conflict ports. Supersession and conflict reads and counts also require the opt-in
for named namespaces. The hosted unique key applies across the owner. All writers
store bare SHA-256 hex in `memories.text_hash`, and core ports return `sha256:<hex>`.
An exact hash held by a hidden row suppresses the incoming save. An exact hash in a different namespace
is also withheld without exposing the existing row. Near duplicate queries use
pgvector to fetch at most 32 candidates per vector. Imports request exact-only
dedupe and still supply their embeddings for suppression.

`createPostgresMemoryStore` and `createPostgresMemoryReads` use the same
visibility checks for duplicates, export, recent, hydration, and the memory
fence. A pending legacy suppression copy closes those reads and write policy
for owners with legacy suppression rows. Once the copy is ready, both fact stores
remain authoritative until the final per-owner reconciliation. Set migration
0015's `legacy_writes_reconciled` only after stopping legacy suppression writes,
copying all remaining facts for that owner, and confirming `uncopyable` is empty
across the owner's copy. Until then, the live union continues to apply every
legacy row. Receipt-less rows use their stored source and creation/write times
for session and window checks.

State tokens assume all writers advance `core_owner_state` in the same
transaction as retrieval-affecting changes. Legacy hosted writers must do so
before this adapter serves reads, including shadow reads.

Raw search, export, and delivery compute withheld sessions from stored lineage
before reading candidates. Hosted writers need to backfill lineage for legacy
sessions that could replay fenced content. An unrecorded session with no
stored link to a fence cannot be found from the fence's MACs. For a session
that shares a recorded message ID with a fenced component, the legacy
fallback checks at most 1,000 raw message IDs and signs content only for a
potential match without a stored proof. Larger sessions are withheld. A host
can pass `onLineageOverflow(sessions)` to count overflow per visibility check.

Vector recall applies full visibility checks to bounded candidate pages. The
cosine page includes the full boundary distance group, ranked by update time
and ID. Coverage stays incomplete when the page budget ends before the
requested visible depth or when an unchecked model gap remains.

`createPostgresDigestGate(uow, keyIdsForOwner)` returns
`digestCoverage(owner)`. Supply an array with the owner's current key ID for
cutover, or an empty array if keyed Core writes are disabled. Coverage reports
`incompleteRows` and `missingPairs`. Each pair consists of one row and one
required signing domain. Require `missingPairs === 0` before enabling the
adapter. Required domains include the current Core domain used at publication
and every domain on a live keyed-only fact from the Core or hosted store.
The algorithm, key ID, label, pipeline, and redaction version must all match.
Historical unlabelled MACs use their pipeline as the default signing label.
For each fact, admission and visibility use Core's comparability rules.

Configure the fingerprint provider with the unit of work and the secrets
available for staging. Call `publish(owner, keyId)` to activate a configured key
for one owner. Publication verifies stored digest coverage and updates the
owner's key ID under the same lock that Core writers use to select their key.
K2 also refuses publication while a live HMAC-only fact references a
non-current key. Keep the active secret available on every writer.

With the owner's memory writers paused, the host's cutover script can call
`backfillPostgresHostedDigests(uow, owner, { keyId, redactionVersion, macForText })`
for each required hosted key. The callback receives stored text and returns the
legacy exact MAC as 64 lowercase hex characters. The host keeps the signing key.
The backfill appends digests for the `hosted-v1` signing domain at the requested
redaction version in one transaction per call and returns the number of rows
updated. Recheck the digest gate before cutover.

A receipt with `forgotten_at` set is a replay tombstone. Its original memory ID
serves as part of the storage key. Replacement and erasure delete active receipts
only, and receipt hydration omits tombstones. Admission still resolves them by
owner, client, session, and message.

The direct MemoryStore lookup is available inside transactions for revision
checks and forget operations.
`createPostgresPauseStore` requires a run opened with `pauseLock`.
`createPostgresSupersessionStore` records edges and marks historical rows.
Historical rows remain available for direct reads and export after the other
visibility checks pass.

## Raw writes and lineage

Create the capture and Raw ports with the same stable `lineageSecret` and
optional `hashSessionKey`. `createPostgresRawPorts` returns `raw` for archive and
privacy writes and `sessionLineage` for proof resolution. Wire Raw search and
listing before enabling `rawArchive`. The optional `importArchive` method is a
separate integration.

Run Raw mutations with `pauseLock: true`. Resolve a proven closure and pass it
to `eraseSessions` inside that same transaction. Erasure fences the proven
sessions, deletes their Raw rows, and blanks their ledger messages. An
ID-only match withholds admission without joining the erase closure.
`deleteConversation` fences the conversation, deletes its Raw rows, blanks its
ledger messages, and retires its direct claims in one transaction. A legacy MCP
explicit save with proven provenance covers both the reported and physical
addresses. The fence refuses late text admissions and withholds later turns
and receipts. An already admitted outbox with every slot blank can take a
cleanup lease and finish with zero items.

Receipt checks use the archived message time and any supplied admitted evidence.
Give `createPostgresSuppressionStore` the same `lineageSecret` to resolve older
ledger proofs and sign source evidence that has yet to be anchored.

Supply `fingerprintKeys(owner)` with the current and retained keys and their
respective fingerprint pipelines to enable keyed Raw purge. Exact evidence
and keyed containment can prove a match. Inconclusive evidence preserves the
stored row. A scrub keeps the hosted ledger's object or encoded-string
representation and retains the message positions and their IDs.

Hosted Raw writes require the personal (null) namespace. Suppression facts
can still apply to ancestors in project namespaces. Migrations 0022 and 0023
add concurrent Raw purge and capture ledger scan indexes. Archive withholds
messages with timestamps outside the hosted wire range and reports their
count as `withheld` when it is positive. Messages with a genuinely unknown
timestamp are eligible to be archived with a null `occurred_at`.
