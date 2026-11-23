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

Load the SQL in the host and pass the full ordered list to
`applyMigrations(source, migrations)`. Use immutable IDs, append new entries,
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

The runner records a concurrent file after PostgreSQL reports a valid index
with the expected definition. It drops an invalid index with a matching
definition so a subsequent run can retry. An invalid index or a definition
mismatch returns `index_unavailable`. A mismatched index is left in place.
The runner returns `storage_busy` if another runner holds the migration lock or
`invalid_input` if the manifest omits an applied migration or has a gap in the
applied prefix.

The migration runner sets `search_path = public, pg_catalog` and turns off
identifier quoting before it compares index definitions. These session settings
keep the runner's target objects and comparisons independent of caller settings.

## Suppression fact storage

Migrations 0005 and 0006 add owner state, suppression facts, and their digest
rows. Each new fact advances its owner's `fact_epoch` by one. The owner's
`index_revision` advances on every committed change to visible rows, receipts,
raw data, lineage, or facts. This is the value returned as
`FinishResult.indexRevision` and used to bind retrieval state tokens.
`legacy_facts_ready` defaults to false for the later legacy copy.

Validate the fact with core's `validateSuppressionFact`, then call
`assertRepresentable` from `src/facts.mjs` before writing. The adapter rejects
U+0000 in string fields, digest redaction versions above 2147483647, and slots
over 8192 UTF-8 bytes with `CoreError("invalid_input")`.

`factSlot(fact)` uses `JSON.stringify` on the following target tuples.

| Kind | Tuple |
| --- | --- |
| Identity | `["identity", memoryId, throughRevision ?? null]` |
| Text | `["text", mode, alg, value]` using the first canonical digest |
| Session | `["session", client, "id", sessionId]` or `["session", client, "hash", sessionKeyHash]` |
| Window | `["window", client, startMs, endMs, unknownTime === true, anchor ?? null]` |
| Raw span | `["rawSpan", sessionKeyHash, messageKey, startUtf16, endUtf16]` |

A null window client selects all clients. `canonicalDigests(digests)` sorts a
copy by pipeline, algorithm, and value in UTF-8 byte order. Store the JSON
slot for diagnostics and use `slotHash(slot)` for the lowercase SHA-256 of
its UTF-8 bytes. The owner and hash form the unique key.

Store core's canonical `factBody(fact)` in `body` and index every text digest
in `core_fact_digests`. Populate the embedding and shingle lookup columns
only for full-mode text facts. In exact mode, the embedding and shingles
stay in `body` for raw checks and the lookup columns stay null. A populated
shingles column requires `key_id`.

## Database tests

Database tests use `CORE_PG_TEST_URL` to reach a PostgreSQL instance with
pgvector and PGroonga. The test role needs permission to create and drop the
disposable databases and install the extensions.
