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
`legacy_facts_ready` defaults to false for the later legacy copy. The backfill
must keep each non-null `legacy_ref` within 256 UTF-8 bytes so the owner and
reference can be indexed together.

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

The slot is the canonical JSON array `[namespace ?? null, ...target]`. Every
store uses the same target per kind; only its encoding is store-specific.

| Kind | Target |
| --- | --- |
| Identity | `["identity", memoryId, throughRevision ?? null]` |
| Text | `["text", mode, [[alg, value], …], sourceMemory?.id ?? null]` using every digest in canonical order |
| Session | `["session", client, "id", sessionId]` or `["session", client, "hash", sessionKeyHash]` |
| Window | `["window", client, startMs, endMs, unknownTime === true, anchor ?? null]` |
| Raw span | `["rawSpan", sessionKeyHash, messageKey, startUtf16, endUtf16]` |

A null window client selects all clients. `canonicalDigests(digests)` sorts a
copy by algorithm, then value, in UTF-8 byte order. Each digest contributes
only its algorithm and value to the target: the pipeline, redaction version and
key id are not part of it, so the same digest set under a different pipeline
label is the same target. Reordering the same digests preserves the slot.
Store the JSON slot for diagnostics and use
`slotHash(slot)` for the lowercase SHA-256 of its UTF-8 bytes. The owner and
hash form the unique key.

Store core's canonical `factBody(snapshot)` in `body` and index every text digest
in `core_fact_digests`. Populate the embedding and shingle lookup columns
only for full-mode text facts. The `vector(1536)` column is a float4 projection
used only for neighbour search, and `body` stays authoritative. In exact mode,
the embedding and shingles stay in `body` for raw checks, with no vector
dimension or float4 range check. Leave the shingle lookup column null for
absent or empty shingles. A populated shingles column requires `key_id`.

## Topics and document cards

Migration 0007 defines the topic store, 0008 adds the concurrent oldest-first
index on `memories`, and 0009 defines `document_cards`. These migrations skip
objects already created by the hosted service. Make subsequent changes to
these tables through adapter-postgres migrations.

## Database tests

Database tests use `CORE_PG_TEST_URL` to reach a PostgreSQL instance with
pgvector and PGroonga. The test role needs permission to create and drop the
disposable databases and install the extensions.
