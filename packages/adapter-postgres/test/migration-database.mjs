import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";
import { applyMigrations } from "../src/index.mjs";

const url = process.env.CORE_PG_TEST_URL;
export const migrationDbTest = { skip: !url, timeout: 20_000 };

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
  const migrations = await Promise.all(names.map(async (name) => ({
    id: name,
    sql: await readFile(new URL(name, directory), "utf8"),
    concurrent: name.endsWith(".concurrent.sql"),
  })));
  await pool.query(baseline);
  if (migrate) await applyMigrations(source, migrations);
  return { pool, source, baseline, migrations };
}
