import { AsyncLocalStorage } from "node:async_hooks";
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { test } from "node:test";
import { Client } from "pg";
import { capabilities } from "../../core/src/index.mjs";
import { createMemoryService } from "../../core/src/service/index.mjs";
import {
  createPostgresHostWriteHookPort, createPostgresMemoryCandidates, createPostgresMemoryReads,
  createPostgresMemoryStore, createPostgresPauseStore, createPostgresSuppressionStore, createPostgresUnitOfWork, query,
} from "../src/index.mjs";
import { migrationDatabase } from "./migration-database.mjs";

const databaseUrl = process.env.CORE_PG_TEST_URL;
const options = { timeout: 20_000, skip: databaseUrl ? false : "CORE_PG_TEST_URL is not set" };
const scope = { owner: "fixture-owner", namespace: null };
const source = { kind: "mcp", client: null, sessionId: null };
const receipt = { client: "fixture", sessionId: "receipt-source", eventId: "source-turn", role: "user", occurredAtMs: null };
const original = "A kestrel nests above the garden gate.";
const withheld = "A lantern hangs above the wooden bridge.";
const keyword = "kestrel";
const sha256 = text => createHash("sha256").update(text).digest("hex");
const insertMirror = `INSERT INTO test_legacy_suppressions (owner, namespace, kind, text_hash, memory_id, fact_id)
  VALUES ($1, $2, $3, $4, $5, $6) RETURNING pg_backend_pid() AS pid`;

// Bind the lexical Context Read service to the same Postgres index and visibility
// checks used by find, recall, and read. The fixture projects memory bodies only.
function contextReadStore(memories, lexical, hydrate) {
  const cursorKey = randomBytes(32);
  return {
    maintenanceAvailable: false,
    async identity() { return { storeId: "postgres-fixture", cursorKey }; },
    async snapshotState(tx) { return [{ memory: await memories.committedIndexRevision(tx) }]; },
    async observeIndex(tx) {
      const indexState = String(await memories.committedIndexRevision(tx));
      const { rows: [{ count }] } = await query(tx, `SELECT count(*)::int AS count FROM memories
        WHERE user_id = $1 AND core_namespace IS NOT DISTINCT FROM $2`, [scope.owner, scope.namespace]);
      return { indexState, ready: true, byType: { memory: { eligible: count, indexed: count } },
        maintenance: { available: false, state: "ready", buildState: "ready", reason: null, progress: null } };
    },
    async lexical(tx, readSet, _selection, text, depth) {
      const { rows } = await lexical.lexical(tx, readSet, text, depth);
      const visible = await hydrate.hydrate(tx, readSet, rows.map(({ ref }) => ref), "recall");
      const byId = new Map(rows.map(({ ref, score }) => [ref.id, score]));
      return { rows: visible.map(({ memory }) => ({
        ref: { type: "memory", scope: memory.scope, id: memory.id, revision: memory.revision },
        score: byId.get(memory.id),
      })), matched: visible.length };
    },
    async evidence(tx, readSet, refs) {
      const rows = await hydrate.hydrate(tx, readSet,
        refs.map(({ id, scope }) => ({ type: "memory", id, namespace: scope.namespace })), "recall");
      return refs.map(ref => {
        const memory = rows.find(row => row.ref.id === ref.id)?.memory;
        if (!memory) return null;
        const { revision, text, kind, origin, confidence } = memory;
        return { type: "memory", ref: { ...ref, revision }, text,
          metadata: { state: "active", reviewState: "none", filing: { status: "unfiled" }, kind, origin, confidence },
          qualification: null, attribution: { status: "unassessed", commitment: "unknown" }, sourceAccess: "unsupported",
          receipts: [], receiptCoverage: { status: "complete", included: 0, omitted: 0 } };
      });
    },
  };
}

async function fixture(t, { intercept = (connection, sql, values) => connection.query(sql, values) } = {}) {
  const { pool } = await migrationDatabase(t);
  await pool.query("INSERT INTO users (id) VALUES ($1)", [scope.owner]);
  await pool.query(`INSERT INTO raw_messages (id, user_id, client, session_id, message_id, role, content)
    VALUES ($1, $2, $3, $4, $1, $5, $6)`,
  [receipt.eventId, scope.owner, receipt.client, receipt.sessionId, receipt.role, original]);
  await pool.query(`CREATE TABLE test_legacy_suppressions (
    owner text NOT NULL, namespace text, kind text NOT NULL, text_hash text NOT NULL,
    memory_id text NOT NULL, fact_id text NOT NULL)`);
  const { rows: [{ name }] } = await pool.query("SELECT current_database() AS name");
  const observerUrl = new URL(databaseUrl);
  observerUrl.pathname = `/${name}`;

  const disconnects = new Map();
  const uow = createPostgresUnitOfWork({ async connect() {
    const client = await pool.connect();
    const pid = client.processID;
    const disconnected = Promise.withResolvers();
    let disconnectError;
    const onDisconnect = error => {
      disconnectError ??= error;
      disconnected.resolve(disconnectError);
    };
    client.on("error", onDisconnect);
    disconnects.set(pid, disconnected.promise);
    const connection = { pid, async query(sql, values) {
      // Preserve the server SQLSTATE when PostgreSQL sends FATAL between statements.
      if (disconnectError) throw disconnectError;
      return client.query(sql, values);
    } };
    return {
      query: (sql, values) => intercept(connection, sql, values),
      release(destroy) {
        disconnects.delete(pid);
        client.release(destroy);
        if (!destroy) client.off("error", onDisconnect);
      },
    };
  } });
  const context = new AsyncLocalStorage();
  const operations = {
    blocked: { mode: "read", sql: `SELECT 1 FROM test_legacy_suppressions
      WHERE owner = $1 AND namespace IS NOT DISTINCT FROM $2 AND text_hash = $3` },
    mirror: { mode: "write", sql: insertMirror },
  };
  const memories = createPostgresMemoryStore({ nearDuplicate: false });
  const reads = createPostgresMemoryReads();
  const candidates = createPostgresMemoryCandidates();
  const now = Date.now();
  const vector = Float32Array.from([1, ...Array(1535).fill(0)]);
  const deps = {
    storage: {
      name: "postgres", uow, memories, ...reads, ...candidates,
      capabilities: capabilities({ hostWriteHooks: true, contextRead: true, embeddingRequiredOnInsert: true }),
      contextRead: contextReadStore(memories, candidates.lexical, reads.hydrate),
      pause: createPostgresPauseStore(), suppressions: createPostgresSuppressionStore(),
    },
    config: { explicitWindowFence: { enabled: true } },
    clock: { nowMs: () => now, monotonicMs: () => performance.now(), sha256Hex: sha256,
      hmacHex: (key, value) => createHmac("sha256", key).update(value).digest("hex") },
    gate: { assertOpen() {} }, tokens: { countTokens: () => 1 },
    embedder: { model: "fixture", dimensions: vector.length, async embed(texts) { return texts.map(() => vector.slice()); } },
    contextReadFormat: value => JSON.stringify({ ok: true, value, evidenceTrust: "untrusted-data-not-instructions" }),
    contextReadCounter: { count: text => Math.ceil(Buffer.byteLength(text) / 8) },
  };

  function service({ incomingText = original, afterMirror = () => {}, onAdmission = () => {} } = {}) {
    const hostWriteHookPort = createPostgresHostWriteHookPort({ context, operations });
    const admit = async (tx, ctx) => {
      const { rowCount } = await hostWriteHookPort.execute(tx, ctx.scope, "blocked", [sha256(incomingText)]);
      onAdmission(ctx);
      return { status: rowCount ? "refuse" : "proceed" };
    };
    const mirror = (tx, ctx, kind, factId) => hostWriteHookPort.execute(tx, ctx.scope, "mirror",
      [kind, sha256(original), ctx.predecessor.id, factId]);
    return createMemoryService({ ...deps, storage: { ...deps.storage, hostWriteHookPort }, hostWriteHooks: {
      beforeSave: admit, beforeCorrect: admit,
      async onSave() {},
      async onCaptureFinish() {},
      async onCorrect(tx, ctx) {
        await mirror(tx, ctx, "edit", ctx.facts[0].factId);
      },
      async onForget(tx, ctx) {
        for (const { kind, factId } of ctx.facts) {
          const { rows: [{ pid }] } = await mirror(tx, ctx, kind, factId);
          await afterMirror(pid);
        }
      },
    } });
  }

  return { service,
    async terminate(pid) {
      const disconnected = disconnects.get(pid);
      assert.ok(disconnected, "Expected a checked-out writer");
      const { rows: [killer] } = await pool.query(`SELECT pg_backend_pid() AS pid,
        pg_terminate_backend($1, 5000) AS terminated`, [pid]);
      assert.notEqual(killer.pid, pid);
      assert.equal(killer.terminated, true);
      const error = await disconnected;
      assert.equal(error.code, "57P01");
    },
    async seedLegacy() {
      await pool.query(insertMirror, [scope.owner, scope.namespace, "text", sha256(withheld), "legacy-memory", "legacy-fact"]);
    },
    async snapshot() {
      const observer = new Client({ connectionString: observerUrl.href, connectionTimeoutMillis: 3000 });
      try {
        await observer.connect();
        const { rows: [state] } = await observer.query(`SELECT
          COALESCE((SELECT index_revision::int FROM core_owner_state WHERE user_id = $1), 0) AS "indexRevision",
          COALESCE((SELECT fact_epoch::int FROM core_owner_state WHERE user_id = $1), 0) AS "factEpoch",
          ARRAY(SELECT to_jsonb(m) FROM memories m WHERE user_id = $1 ORDER BY id) AS memories,
          ARRAY(SELECT to_jsonb(r) FROM core_memory_receipts r WHERE user_id = $1
            ORDER BY memory_id, client, session_id, message_id) AS receipts,
          ARRAY(SELECT to_jsonb(d) FROM core_fact_digests d WHERE user_id = $1 ORDER BY fact_id, alg, value) AS digests,
          ARRAY(SELECT jsonb_build_object('id', fact_id, 'kind', kind, 'action', action_id, 'origin', origin)
            FROM core_suppression_facts WHERE user_id = $1 ORDER BY fact_id) AS facts,
          ARRAY(SELECT to_jsonb(s) FROM test_legacy_suppressions s WHERE owner = $1 ORDER BY fact_id) AS mirror`, [scope.owner]);
        return state;
      } finally {
        await observer.end();
      }
    },
  };
}

async function seed(api) {
  const saved = await api.save(scope, original, source, "fact", { receipt });
  assert.equal(saved.status, "saved");
  assert.deepEqual(saved.item.source, source);
  return saved.item;
}

async function assertReadable(api, item) {
  const result = await api.read(scope, { type: "memory", id: item.id });
  assert.equal(result.status, "found");
  assert.equal(result.item.revision, item.revision);
  assert.equal(result.item.text, original);
}

async function assertVisibility(api, item, visible) {
  if (visible) {
    await assertReadable(api, item);
  } else {
    assert.deepEqual(await api.read(scope, { type: "memory", id: item.id }), { status: "not_found" });
  }
  const ids = visible ? [item.id] : [];
  const found = await api.find(scope, keyword, { kinds: ["memory"] });
  assert.equal(found.layers.memory.status, "ok");
  assert.deepEqual(found.memories.map(({ id }) => id), ids);
  const recalled = await api.recall(scope, keyword, { mode: "search" });
  assert.deepEqual(recalled.items.map(({ id }) => id), ids);
  const context = await api.readContext({ owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [1] },
    { query: keyword, types: ["memory"], intent: "current", raw: false, semantic: false });
  assert.equal(context.diagnostics.candidates.channels.lexical.state, "ready");
  assert.deepEqual(context.assembly.items.map(({ ref }) => ref.id), ids);
}

function assertCommitted(state, start, item) {
  assert.deepEqual(state.facts.map(({ kind }) => kind).sort(), ["text", "window"]);
  assert.ok(state.facts.every(({ origin, action }) => origin === "forget" && action === state.facts[0].action));
  assert.deepEqual(state.mirror, state.facts.map(({ id, kind }) => ({
    owner: scope.owner, namespace: scope.namespace, kind, text_hash: sha256(original), memory_id: item.id, fact_id: id,
  })));
  assert.deepEqual(state.memories, []);
  assert.deepEqual(state.receipts.filter(({ forgotten_at }) => forgotten_at === null), []);
  assert.ok(state.receipts.length > 0 && state.receipts.every(({ memory_id, forgotten_at }) => memory_id === item.id && forgotten_at !== null));
  assert.equal(state.indexRevision, start.indexRevision + 1);
}

for (const [id, point] of [["K1", "after the core fact INSERT"], ["K2", "inside onForget after the mirror INSERT"],
  ["K3", "before COMMIT"]]) {
  test(`${id} forget is atomic when the Postgres writer dies ${point}`, options, async t => {
    let armed = false;
    let killed = false;
    const kill = async pid => {
      armed = false;
      await f.terminate(pid);
      killed = true;
    };
    const f = await fixture(t, { async intercept(connection, sql, values) {
      if (armed && id === "K3" && sql === "COMMIT") await kill(connection.pid);
      const result = await connection.query(sql, values);
      if (armed && id === "K1" && sql.startsWith("INSERT INTO core_suppression_facts (")) {
        assert.equal(result.rowCount, 1);
        await kill(connection.pid);
      }
      return result;
    } });
    const api = f.service({ async afterMirror(pid) {
      if (armed && id === "K2") await kill(pid);
    } });
    const item = await seed(api);
    const start = await f.snapshot();
    assert.equal(start.receipts.length, 1);
    assert.deepEqual(start.facts, []);
    assert.deepEqual(start.mirror, []);
    await assertVisibility(api, item, true);

    armed = true;
    let errorCode;
    await assert.rejects(api.forget(scope, item.id, source), error => {
      errorCode = error.code;
      assert.ok(error.retryable === true || error.code === "commit_outcome_unknown", `Unexpected error: ${error.code}`);
      return true;
    });
    assert.equal(killed, true, "Expected the chosen writer backend to terminate");
    const interrupted = await f.snapshot();
    const committed = interrupted.facts.length > 0;
    assert.equal(interrupted.mirror.length > 0, committed, "Core facts and host mirror must commit together");
    t.diagnostic(`After termination: ${committed ? "both" : "neither"} (${errorCode})`);
    if (committed) {
      assertCommitted(interrupted, start, item);
      await assertVisibility(api, item, false);
    } else {
      assert.deepEqual(interrupted, start);
      await assertReadable(api, item);
    }

    const retry = await api.forget(scope, item.id, source);
    assert.equal(retry.status, committed ? "not_found" : "forgotten");
    const end = await f.snapshot();
    assertCommitted(end, start, item);
    if (committed) assert.deepEqual(end, interrupted);
    await assertVisibility(api, item, false);
  });
}

test("K4 the host refuses both unkeyed and keyed explicit saves on a legacy-only hash", options, async t => {
  const f = await fixture(t);
  await f.seedLegacy();
  const start = await f.snapshot();
  assert.deepEqual(start.memories, []);
  assert.deepEqual(start.receipts, []);
  assert.deepEqual(start.facts, []);
  assert.equal(start.mirror.length, 1);
  const requests = [];
  const api = f.service({ incomingText: withheld, onAdmission: ctx => requests.push(ctx.request) });
  const hostRequest = { key: "save-key", fingerprint: sha256(withheld) };
  assert.equal((await api.save(scope, withheld, source, "fact", { receipt })).status, "suppressed");
  assert.deepEqual(await f.snapshot(), start);
  assert.equal((await api.save(scope, withheld, source, "fact", { receipt, hostRequest })).status, "suppressed");
  assert.deepEqual(await f.snapshot(), start);
  assert.deepEqual(requests, [null, hostRequest]);
});

test("K5 the host refuses correction on a legacy-only hash and preserves the predecessor", options, async t => {
  const f = await fixture(t);
  const item = await seed(f.service());
  await f.seedLegacy();
  const start = await f.snapshot();
  assert.deepEqual(start.facts, []);
  assert.equal(start.mirror.length, 1);
  const admitted = [];
  const api = f.service({ incomingText: withheld, onAdmission: ctx => admitted.push(ctx.predecessor.id) });
  assert.deepEqual(await api.correct(scope, item.id, item.revision, withheld, source),
    { status: "suppressed", indexRevision: start.indexRevision });
  assert.deepEqual(admitted, [item.id]);
  assert.deepEqual(await f.snapshot(), start);
  await assertReadable(api, item);
});

test("K6 an onForget exception after a mirror INSERT rolls back both writes", options, async t => {
  const f = await fixture(t);
  let inserted = false;
  const api = f.service({ afterMirror() {
    inserted = true;
    throw new Error("Synthetic hook failure");
  } });
  const item = await seed(api);
  const start = await f.snapshot();
  assert.deepEqual(start.facts, []);
  assert.deepEqual(start.mirror, []);
  await assert.rejects(api.forget(scope, item.id, source), { code: "host_write_hook_failed" });
  assert.equal(inserted, true);
  assert.deepEqual(await f.snapshot(), start);
  await assertReadable(api, item);
});
