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

Database tests use `CORE_PG_TEST_URL` to reach a PostgreSQL instance with
pgvector and PGroonga. The test role needs permission to create and drop the
disposable databases and install the extensions.

The migration runner owns its session settings: it sets `search_path = public, pg_catalog` (the
hosted tables live in `public`) and turns off identifier quoting before it compares index
definitions, so the caller's session settings cannot change what a migration touches.
