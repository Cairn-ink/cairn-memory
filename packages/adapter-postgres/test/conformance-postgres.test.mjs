import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Socket } from "node:net";
import test from "node:test";
import { Pool } from "pg";
import * as kit from "@cairn-ink/conformance";
import { capabilities, factIncarnationBody } from "@cairn-ink/core";
import { toPostgresError } from "../src/errors.mjs";
import { applyMigrations, createPostgresSuppressionStore, createPostgresUnitOfWork } from "../src/index.mjs";

/** @import { AdapterFactory, ConformanceCase, TestHarness } from "@cairn-ink/conformance" */

const databaseUrl = process.env.CORE_PG_TEST_URL;
const options = { timeout: 120_000, skip: databaseUrl ? false : "CORE_PG_TEST_URL is not set" };
const busyNativeCodes = ["55P03", "40001", "40P01"];
const nativeCodes = [...busyNativeCodes, "57014", "08000", "57P01", "57P02", "57P03"];
const nativeErrorMap = Object.fromEntries(nativeCodes.map((code) => [code, toPostgresError({ code }).code]));

// Cast bigint counters and the vector projection to text before JSON decoding.
// One statement reads the three tables from the same committed snapshot.
const dumpSql = `SELECT jsonb_build_object(
  'facts', ARRAY(
    SELECT to_jsonb(f) || jsonb_build_object('epoch', f.epoch::text, 'embedding', f.embedding::text)
    FROM core_suppression_facts f ORDER BY f.user_id, f.epoch
  ),
  'factDigests', ARRAY(
    SELECT to_jsonb(d) FROM core_fact_digests d ORDER BY d.user_id, d.fact_id, d.alg, d.value
  ),
  'ownerState', ARRAY(
    SELECT to_jsonb(s) || jsonb_build_object('fact_epoch', s.fact_epoch::text, 'index_revision', s.index_revision::text)
    FROM core_owner_state s ORDER BY s.user_id
  )
) AS snapshot`;

async function beforeDeadline(label, ms, work) {
  let timer;
  try {
    return await Promise.race([work(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms} ms`)), ms);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

function trackedPool(connectionString, timeouts) {
  const sockets = new Map();
  let closing = false;
  let connectionError;
  const recordError = (error) => {
    if (!closing) connectionError ??= error;
  };
  const pool = new Pool({
    connectionString,
    ...timeouts,
    stream() {
      const socket = new Socket();
      sockets.set(socket, new Promise((resolve) => {
        socket.once("close", () => {
          sockets.delete(socket);
          resolve();
        });
      }));
      return socket;
    },
  });
  pool.on("error", recordError);
  pool.on("connect", (client) => client.on("error", recordError));

  return {
    pool,
    async close(label) {
      closing = true;
      try {
        await beforeDeadline(label, 750, async () => {
          await pool.end();
          await Promise.all(sockets.values());
        });
      } finally {
        // A checked-out client can keep pool.end() pending even after its socket is destroyed.
        // Closing the socket itself prevents a stalled client from keeping the process alive.
        for (const socket of sockets.keys()) socket.destroy();
      }
      if (connectionError) throw connectionError;
    },
  };
}

const concurrentIndexes = {
  "0004_core_recent_index.concurrent.sql": {
    name: "memories_user_recent_c",
    table: "memories",
    definition: 'CREATE INDEX memories_user_recent_c ON public.memories USING btree (user_id, updated_at DESC, id COLLATE "C" DESC)',
  },
  "0008_core_memories_oldest_idx.concurrent.sql": {
    name: "memories_user_oldest_idx",
    table: "memories",
    definition: "CREATE INDEX memories_user_oldest_idx ON public.memories USING btree (user_id, created_at, id)",
  },
};

async function readMigrations() {
  const directory = new URL("../migrations/", import.meta.url);
  const names = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  return Promise.all(names.map(async (id) => {
    const sql = await readFile(new URL(id, directory), "utf8");
    if (!id.endsWith(".concurrent.sql")) return { id, sql, concurrent: false };
    const index = concurrentIndexes[id];
    assert.ok(index, `Missing index definition for ${id}`);
    return { id, sql, concurrent: true, index };
  }));
}

function adminQuery(admin, label, sql, params) {
  return beforeDeadline(label, 4_000, () => admin.pool.query(sql, params));
}

async function closeDatabase(database, admin, name) {
  const cleanupSteps = [
    () => database.close("Case pool close"),
    () => adminQuery(admin, "Terminate case backends",
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1", [name]),
    () => adminQuery(admin, "Drop case database", `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`),
    () => admin.close("Admin pool close"),
  ];
  const errors = [];
  for (const step of cleanupSteps) {
    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Database teardown failed");
}

async function openDatabase() {
  const name = `core_conformance_test_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(databaseUrl);
  url.pathname = `/${name}`;
  const admin = trackedPool(databaseUrl, {
    connectionTimeoutMillis: 1_000,
    statement_timeout: 2_500,
    query_timeout: 2_750,
  });
  const database = trackedPool(url.href, {
    connectionTimeoutMillis: 3_000,
    statement_timeout: 35_000,
    idle_in_transaction_session_timeout: 15_000,
    query_timeout: 38_000,
  });
  const { pool } = database;
  const source = {
    async connect() {
      const client = await pool.connect();
      return {
        query: (sql, values) => client.query(sql, values),
        release: (destroy) => client.release(destroy),
      };
    },
  };
  const close = () => closeDatabase(database, admin, name);

  try {
    await beforeDeadline("Database setup", 45_000, async () => {
      const [baseline, migrations] = await Promise.all([
        readFile(new URL("../schema/baseline.sql", import.meta.url), "utf8"),
        readMigrations(),
      ]);
      await adminQuery(admin, "Create case database", `CREATE DATABASE ${name} TEMPLATE template0`);
      await pool.query(baseline);
      await applyMigrations(source, migrations);
    });
    return { pool, source, close };
  } catch (error) {
    try {
      await close();
    } catch (closeError) {
      throw new AggregateError([error, closeError], "Database setup and teardown both failed");
    }
    throw error;
  }
}

function postgresFactory(wrapSuppressions = (store) => store) {
  return {
    name: "Postgres",
    async open() {
      const suppressions = wrapSuppressions(createPostgresSuppressionStore());
      const { pool, source, close } = await openDatabase();
      const uow = createPostgresUnitOfWork(source);
      /** @type {Pick<TestHarness, "dump" | "seedFact"> & {seedOwners(owner: string, otherOwner: string): Promise<void>}} */
      const harness = {
        async seedOwners(owner, otherOwner) {
          await beforeDeadline("Owner fixture setup", 4_000,
            () => pool.query("INSERT INTO users (id) VALUES ($1), ($2)", [owner, otherOwner]));
        },
        async dump() {
          const { rows } = await pool.query(dumpSql);
          return rows[0].snapshot;
        },
        async seedFact(owner, fact) {
          const incarnation = createHash("sha256").update(factIncarnationBody(fact)).digest("hex");
          await uow.run(owner, {}, (tx) => suppressions.writeFact(tx, fact, incarnation));
        },
      };
      return {
        adapter: { capabilities: capabilities({ embeddingRequiredOnInsert: true }), uow, suppressions },
        sessionRefs: /** @type {const} */ ("plain"),
        harness,
        nativeErrorMap,
        busyNativeCodes,
        embeddingDimensions: 1536,
        timeoutMs: 10_000,
        settleMs: 100,
        close,
      };
    },
  };
}

// Read each case body, its helpers and any follow-up against the implemented
// ports, hooks and profile. Check needs and needsOff as requirements and
// requests as preferences. K-CAP-2 exercises the semantic-retrieval-off profile.
const selected = new Set([
  "K-UOW-3", "K-UOW-3r", "K-ERR-1", "K-CAP-0", "K-CAP-2",
  "K-FACT-1", "K-FACT-2", "K-UOW-8a", "K-FACT-3", "K-FACT-4",
  "K-FACT-5", "K-FACT-6", "K-FACT-7", "K-SESS-1",
]);

// Each entry names a missing port, method, or capability.
const notApplicable = {
  memories: [
    "K-UOW-1", "K-UOW-2", "K-UOW-4", "K-UOW-7", "K-UOW-8b",
    "K-MEM-1", "K-MEM-3", "K-CAP-1", "K-MEM-4", "K-MEM-4r", "K-MEM-5",
    "K-MEM-10", "K-MEM-11", "K-MEM-12", "K-MEM-13",
    "K-HIDE-1", "K-HIDE-2", "K-HIDE-3", "K-HIDE-4", "K-WRITE-1", "K-WRITE-2",
  ],
  lexical: ["K-RET-1", "K-RET-2"],
  vector: ["K-RET-3"],
  recent: ["K-RET-9"],
  snapshot: ["K-SNAP-1"],
  hydrate: ["K-HYD-1"],
  supersession: ["K-MEM-5h", "K-HYD-2"],
  fence: ["K-FEN-1", "K-FEN-I1", "K-FEN-I2", "K-FEN-I3"],
  "retrieval window": ["K-RET-W1", "K-RET-W2", "K-SNAP-W1", "K-RAW-W1"],
  supersessionEdges: ["K-REL-1", "K-REL-2", "K-REL-3", "K-REL-6", "K-REL-7", "K-REL-9", "K-REL-10", "K-REL-11", "K-REL-12"],
  conflictEdges: ["K-REL-4", "K-REL-5", "K-REL-8"],
  pause: ["K-PAUSE-1"],
  keys: ["K-KEY-1", "K-KD-1", "K-KD-2", "K-KD-3", "K-KD-4", "K-KD-5", "K-KD-6"],
  "suppressions.snapshot": ["K-SNAP-F1", "K-SNAP-F3", "K-SNAP-F4", "K-SNAP-F5", "K-SNAP-F6", "K-SNAP-F7"],
  "suppressions.factsFor": ["K-FACTSFOR-1"],
  capture: ["K-CLM-1", "K-CLM-2", "K-CLM-3", "K-CLM-4", "K-CLM-5",
    "K-SRC-1", "K-SRC-2", "K-SRC-3", "K-SRC-4", "K-SRC-5"],
  "capture.admit": ["K-ADM-1", "K-ADM-2", "K-ADM-3", "K-ADM-4", "K-ADM-5", "K-ADM-6", "K-ADM-7", "K-ADM-8", "K-ADM-9"],
  "memories.insert": ["K-IMP-T1", "K-IMP-T2", "K-IMP-T3"],
  raw: ["K-RAW-1", "K-RAW-2", "K-RAW-2s", "K-RAW-3", "K-RAW-3w", "K-RAW-3c", "K-RAW-3s",
    "K-RAW-4", "K-RAW-5", "K-RAW-6", "K-RAW-7", "K-RAW-8", "K-RAW-8w", "K-RAW-8s"],
  "rawSpans not declared": ["K-FACT-3r"],
  "hashed session refs required": ["K-HASH-1"],
  placement: ["T-TOP-1", "T-TOP-2", "T-TOP-3", "T-TOP-4", "T-TOP-5", "T-TOP-6", "T-TOP-7", "T-TOP-8",
    "T-TOP-9", "T-TOP-10", "T-TOP-11", "T-TOP-12", "T-TOP-13", "T-TOP-14", "T-TOP-15"],
};

const { PRIVACY_CASES, runCase } = kit;
// Every exported case list, so a new kit export cannot escape the inventory below.
/** @type {ConformanceCase[]} */
const allCases = Object.values(kit).filter((value) => Array.isArray(value) && value.length > 0 &&
  value.every((entry) => typeof entry?.id === "string" && typeof entry?.run === "function")).flat();
assert.deepEqual(
  [...selected, ...Object.values(notApplicable).flat()].sort(),
  allCases.map(({ id }) => id).sort(),
  "Every conformance case must be selected or have a reason it is not applicable",
);

/** @param {ConformanceCase} testCase */
async function runPreparedCase(factory, testCase, t, execute = runCase) {
  const prepare = (run) => async (ctx) => {
    // runCase generates these IDs after open(), so seed both together at the case entry point.
    await ctx.harness.seedOwners(ctx.owner, ctx.otherOwner);
    return beforeDeadline("Conformance case", 40_000, () => run(ctx));
  };
  const prepared = { ...testCase, run: prepare(testCase.run) };
  if (testCase.followUp) prepared.followUp = { ...testCase.followUp, run: prepare(testCase.followUp.run) };
  // The factory type describes the full kit. The selected cases define this driver's subset.
  const reason = await execute(/** @type {AdapterFactory} */ (/** @type {unknown} */ (factory)), prepared);
  if (reason !== null) t.skip(reason);
  return reason;
}

const factory = postgresFactory();
for (const testCase of allCases.filter(({ id }) => selected.has(id))) {
  const name = `${factory.name} conformance ${testCase.id} ${testCase.title}`;
  test(name, options, (t) => runPreparedCase(factory, testCase, t));
}

test("Postgres conformance K-FACT-6 detects a bypassed foreign-owner guard", options, async (t) => {
  const testCase = PRIVACY_CASES.find(({ id }) => id === "K-FACT-6");
  assert.ok(testCase);
  let wroteFact = false;
  const mutant = postgresFactory((store) => ({
    ...store,
    async writeFact(tx, fact, incarnation) {
      if (tx.owner === fact.owner) return store.writeFact(tx, fact, incarnation);
      const result = await store.writeFact(tx, { ...fact, owner: tx.owner }, incarnation);
      wroteFact = result.created;
      return result;
    },
  }));
  await assert.rejects(runPreparedCase(mutant, testCase, t), { message: "Expected operation to reject" });
  assert.equal(wroteFact, true);
});

test("Postgres conformance tears down the database after a stalled pool drain", { timeout: 5_000 }, async (t) => {
  const database = trackedPool(undefined, {});
  const socket = database.pool.options.stream();
  t.mock.method(database.pool, "end", () => new Promise(() => {}));
  const calls = [];
  const admin = {
    pool: {
      async query(sql) {
        assert.equal(socket.destroyed, true);
        calls.push(sql);
      },
    },
    async close() {
      calls.push("admin closed");
    },
  };
  await assert.rejects(closeDatabase(database, admin, "case_database"), { message: "Case pool close exceeded 750 ms" });
  assert.deepEqual(calls, [
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1",
    "DROP DATABASE IF EXISTS case_database WITH (FORCE)",
    "admin closed",
  ]);
});
