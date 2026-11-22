# Postgres adapter

The hosted service embeds memory text before writing it. The Postgres adapter
requires an embedding for inserts and replacements. `requireEmbedding(row)`
returns the embedding or throws `CoreError("invalid_input")` when it is null.
The local store supports unembedded rows.

Rows from before the metadata migration have revision and confidence set to 1.
When reading a null `origin`, derive `inferred` for `plugin` or `capture`, and
`explicit` for `mcp`, `web`, or `import`.

`schema/baseline.sql` initializes a disposable database with the hosted
service's memory-pipeline schema. For an existing installation, apply the
forward migrations in `migrations/`.

Load the SQL in the host and pass the full ordered list to
`applyMigrations(source, migrations)`. Use immutable IDs, append new entries,
and set `concurrent: true` for `.concurrent.sql` files. A concurrent file
contains one `CREATE [UNIQUE] INDEX CONCURRENTLY IF NOT EXISTS` statement with
an optional schema on the table name.

The driver must provide a dedicated session, support querying a transactional
SQL file as a batch, and close the session on `release(true)`. Transactional
files and their ledger entries commit together. The runner records a concurrent
file after PostgreSQL reports a valid index. It returns `index_unavailable`
after removing an invalid index so a subsequent run can retry, `storage_busy`
if another runner holds the migration lock, or `invalid_input` if the manifest
omits an applied migration or has a gap in the applied prefix.

Database tests use `CORE_PG_TEST_URL` to reach a PostgreSQL instance with
pgvector and PGroonga. The test role needs permission to create and drop the
disposable databases and install the extensions.
