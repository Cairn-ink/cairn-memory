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
  // pool.end() resolves before removed clients finish closing; DROP ... WITH (FORCE) would
  // terminate those backends and the pool would rethrow the error as uncaught. Wait for each
  // connected client's own socket to end (bounded, so a stalled socket cannot hang teardown).
  const socketsClosed = [];
  pool.on("connect", (client) => {
    socketsClosed.push(new Promise((resolve) => { client.once("end", resolve); }));
  });
  let created = false;
  t.after(async () => {
    try {
      await pool.end();
      let timer;
      await Promise.race([
        Promise.all(socketsClosed),
        new Promise((resolve) => { timer = setTimeout(resolve, 5_000); }),
      ]);
      clearTimeout(timer);
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
    if (name === "0008_core_memories_oldest_idx.concurrent.sql") {
      return {
        id: name,
        sql,
        concurrent: true,
        index: {
          name: "memories_user_oldest_idx",
          table: "memories",
          definition: "CREATE INDEX memories_user_oldest_idx ON public.memories USING btree (user_id, created_at, id)",
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
