import assert from "node:assert/strict";
import test from "node:test";
import { applyMigrations } from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const readLedger = 'SELECT id, applied_at::text FROM core_schema_migrations ORDER BY id COLLATE "C"';

test("Postgres adds the forgotten receipt column and partial index and can reapply all migrations", migrationDbTest, async (t) => {
  const { pool, source, migrations } = await migrationDatabase(t, { migrate: false });
  const first = await source.connect();
  try {
    // pg.Pool can return from release(true) before the server closes the session.
    // Keep that session alive to exercise the reapply in that window every time.
    await applyMigrations({ connect: async () => ({
      query: first.query,
      release: (destroy) => assert.equal(destroy, true),
    }) }, migrations);
    const { rows: applied } = await pool.query(readLedger);
    assert.deepEqual(applied.map(({ id }) => id), migrations.map(({ id }) => id));

    await applyMigrations(source, migrations);
    assert.deepEqual((await pool.query(readLedger)).rows, applied);
  } finally {
    await first.release(true);
  }

  const { rows: columns } = await pool.query(`
    SELECT data_type, is_nullable, column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'core_memory_receipts' AND column_name = 'forgotten_at'
  `);
  assert.deepEqual(columns, [{ data_type: "timestamp with time zone", is_nullable: "YES", column_default: null }]);

  const { rows: indexes } = await pool.query(`
    SELECT indisvalid, pg_get_indexdef(indexrelid) AS definition FROM pg_index
    WHERE indexrelid = to_regclass('public.core_memory_receipts_forgotten_idx')
      AND indrelid = 'public.core_memory_receipts'::regclass
  `);
  assert.deepEqual(indexes, [{
    indisvalid: true,
    definition: "CREATE INDEX core_memory_receipts_forgotten_idx ON public.core_memory_receipts"
      + " USING btree (user_id, client, session_id, message_id) WHERE (forgotten_at IS NOT NULL)",
  }]);
});
