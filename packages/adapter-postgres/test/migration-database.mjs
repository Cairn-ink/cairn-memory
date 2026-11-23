import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";
import { applyMigrations } from "../src/index.mjs";

const url = process.env.CORE_PG_TEST_URL;
export const migrationDbTest = { skip: !url, timeout: 20_000 };

export async function readCatalog(connection, tables = null) {
  const { rows } = await connection.query(`
    WITH tables AS (
      SELECT c.oid, c.relname FROM pg_class c
      WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
        AND ($1::text[] IS NULL OR c.relname::text = ANY ($1))
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend WHERE classid = 'pg_class'::regclass AND objid = c.oid AND deptype = 'e'
        )
    ), catalog AS (
      SELECT t.relname AS table_name, 'column' AS item, a.attname AS name,
        format_type(a.atttypid, a.atttypmod)
          || COALESCE(' COLLATE ' || quote_ident(coll.collname), '')
          || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE ' NULL' END AS definition
      FROM tables t JOIN pg_attribute a ON a.attrelid = t.oid
      JOIN pg_type ty ON ty.oid = a.atttypid
      LEFT JOIN pg_collation coll ON coll.oid = a.attcollation AND a.attcollation <> ty.typcollation
      WHERE a.attnum > 0 AND NOT a.attisdropped
      UNION ALL
      SELECT t.relname, 'constraint', c.conname, pg_get_constraintdef(c.oid)
      FROM tables t JOIN pg_constraint c ON c.conrelid = t.oid
      UNION ALL
      SELECT t.relname, 'index', c.relname, pg_get_indexdef(i.indexrelid)
      FROM tables t JOIN pg_index i ON i.indrelid = t.oid
      JOIN pg_class c ON c.oid = i.indexrelid
    )
    SELECT concat_ws(chr(9), table_name, item, name, definition) AS entry
    FROM catalog ORDER BY table_name::text COLLATE "C", item COLLATE "C", name::text COLLATE "C"
  `, [tables]);
  return rows.map(({ entry }) => entry);
}

export async function migrationDatabase(t, { migrate = true } = {}) {
  const name = `core_migration_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: url, connectionTimeoutMillis: 3_000 });
  const databaseUrl = new URL(url);
  databaseUrl.pathname = `/${name}`;
  const pool = new Pool({ connectionString: databaseUrl.href, connectionTimeoutMillis: 3_000 });
  let created = false;
  t.after(async () => {
    try {
      await pool.end();
    } finally {
      try {
        if (created) await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
      } finally {
        await admin.end();
      }
    }
  });
  await admin.query(`CREATE DATABASE ${name} TEMPLATE template0`);
  created = true;

  const source = {
    async connect() {
      const client = await pool.connect();
      return {
        query: (sql, values) => client.query(sql, values),
        release: (destroy) => client.release(destroy),
      };
    },
  };
  const baseline = await readFile(new URL("../schema/baseline.sql", import.meta.url), "utf8");
  const directory = new URL("../migrations/", import.meta.url);
  const names = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  const migrations = await Promise.all(names.map(async (name) => {
    const sql = await readFile(new URL(name, directory), "utf8");
    if (name === "0004_core_recent_index.concurrent.sql") {
      return {
        id: name,
        sql,
        concurrent: true,
        index: {
          name: "memories_user_recent_c",
          table: "memories",
          definition: 'CREATE INDEX memories_user_recent_c ON public.memories USING btree (user_id, updated_at DESC, id COLLATE "C" DESC)',
        },
      };
    }
    if (name.endsWith(".concurrent.sql")) throw new Error(`Missing index definition for ${name}`);
    return { id: name, sql, concurrent: false };
  }));
  await pool.query(baseline);
  if (migrate) await applyMigrations(source, migrations);
  return { pool, source, baseline, migrations };
}
