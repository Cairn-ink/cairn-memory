import { AsyncLocalStorage } from "node:async_hooks";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { test } from "node:test";
import {
  HOST_WRITE_HOOK_CASES, captureIdentity, capturedText, messages, receipt, requested, syntheticHooks,
} from "@cairn-ink/conformance/host-write-hooks";
import { capabilities, CoreError } from "../../core/src/index.mjs";
import { createMemoryService } from "../../core/src/service/index.mjs";
import {
  createPostgresCapturePorts, createPostgresHostWriteHookPort, createPostgresMemoryCandidates,
  createPostgresMemoryReads, createPostgresMemoryStore, createPostgresPauseStore, createPostgresRawPorts,
  createPostgresRawReads, createPostgresSuppressionStore, createPostgresUnitOfWork, query,
} from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const owner = "hook-owner";
const scope = { owner, namespace: null };
const explicit = { kind: "mcp", client: null, sessionId: null };
const now = 12_345;
const vector = [1, ...Array(1535).fill(0)];

async function fixture(t, { failModel = false, fallback = false, intercept } = {}) {
  const { pool, source } = await migrationDatabase(t);
  await pool.query("INSERT INTO users (id) VALUES ($1)", [owner]);
  for (const messageId of [receipt.eventId, "correct-event"]) {
    await pool.query(`INSERT INTO raw_messages (id, user_id, client, session_id, message_id, role, content, occurred_at)
      VALUES ($1, $2, $3, $4, $1, 'user', 'Synthetic source turn.', to_timestamp($5::double precision / 1000))`,
    [messageId, owner, receipt.client, receipt.sessionId, receipt.occurredAtMs]);
  }
  await pool.query(`CREATE TABLE test_host_hook_effects (
    owner text NOT NULL, namespace text NOT NULL, key text NOT NULL, payload jsonb NOT NULL,
    UNIQUE (owner, namespace, key))`);
  await pool.query(`CREATE FUNCTION test_host_sql_failure(code text) RETURNS text LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION USING ERRCODE = code; END $$`);
  const uow = createPostgresUnitOfWork(intercept ? { async connect() {
    const client = await pool.connect();
    const onDisconnect = () => {};
    client.on("error", onDisconnect);
    const connection = { query: (sql, values) => client.query(sql, values) };
    return {
      query: (sql, values) => intercept(connection, sql, values),
      release(destroy) {
        client.release(destroy);
        if (!destroy) client.off("error", onDisconnect);
      },
    };
  } } : source);
  const lineage = { lineageSecret: "synthetic-hook-capture-fixture" };
  const nearDuplicate = false;
  const allowNonNullNamespace = true;
  const context = { ...lineage, nearDuplicate, allowNonNullNamespace };
  const hostWriteHookPort = createPostgresHostWriteHookPort({ context: new AsyncLocalStorage(), rawVisibility: lineage, operations: {
    get: { mode: "read", sql: "SELECT payload FROM test_host_hook_effects WHERE owner = $1 AND namespace = COALESCE($2, '') AND key = $3" },
    put: { mode: "write", sql: "INSERT INTO test_host_hook_effects VALUES ($1, COALESCE($2, ''), $3, $4::jsonb)" },
    indexed: { mode: "indexed", sql: "INSERT INTO test_host_hook_effects VALUES ($1, COALESCE($2, ''), $3, $4::jsonb)" },
    stage: { mode: "finalizeSave", sql: `INSERT INTO test_host_hook_effects
      VALUES ($1, COALESCE($2, ''), $4, jsonb_build_object('indexRevision', $3::bigint, 'value', $5::jsonb))` },
    failure: { mode: "read", sql: "SELECT test_host_sql_failure($3) WHERE $1::text <> COALESCE($2::text, '')" },
    rowEffects: { mode: "read", sql: `SELECT
      (SELECT revision FROM memories WHERE user_id = $1 AND core_namespace IS NOT DISTINCT FROM $2 AND id = $3) AS revision,
      (SELECT count(*)::int FROM core_memory_receipts WHERE user_id = $1 AND memory_id = $3 AND forgotten_at IS NULL) AS receipts,
      (SELECT count(*)::int FROM core_suppression_facts WHERE user_id = $1) AS facts` },
    legacy: { mode: "read", sql: "SELECT 1 FROM suppressions WHERE user_id = $1 AND $2::text IS NULL AND text_hash = $3" },
    live: { mode: "read", sql: `SELECT pg_backend_pid() AS pid,
      (SELECT count(*)::int FROM memories WHERE user_id = $1 AND core_namespace IS NOT DISTINCT FROM $2) AS memories,
      (SELECT count(*)::int FROM capture_events WHERE user_id = $1 AND core_namespace IS NOT DISTINCT FROM $2 AND status = 'completed') AS completed,
      (SELECT count(*)::int FROM raw_messages WHERE user_id = $1 AND $2::text IS NULL AND session_id = 'capture') AS raw` },
  } });
  const storage = {
    name: "postgres", uow, hostWriteHookPort,
    capabilities: capabilities({ hostWriteHooks: true, rawArchive: true, embeddingRequiredOnInsert: true, nearDuplicate }),
    keys: { async userKey() { return null; } },
    memories: createPostgresMemoryStore(context),
    capture: createPostgresCapturePorts({ ...context, now: () => now }),
    pause: createPostgresPauseStore(),
    suppressions: createPostgresSuppressionStore(context),
    ...createPostgresMemoryReads(context),
    ...createPostgresMemoryCandidates(context),
    ...createPostgresRawPorts(lineage),
  };
  Object.assign(storage.raw, createPostgresRawReads(lineage));
  const deps = {
    storage, config: fallback ? { rawCapture: { onModelFailure: true } } : {},
    clock: { nowMs: () => now, monotonicMs: () => now,
      sha256Hex: value => createHash("sha256").update(value).digest("hex"),
      hmacHex: (key, value) => createHmac("sha256", key).update(value).digest("hex") },
    gate: { assertOpen() {} }, tokens: { countTokens: () => 1 },
    embedder: { model: "fixture", dimensions: 1536, async embed(texts) { return texts.map(() => Float32Array.from(vector)); } },
    model: { model: "fixture", contextWindow: 32_768, countTokens: () => 1, async call() {
      if (failModel) throw new CoreError("model_timeout");
      return { items: [{ content: capturedText, kind: "fact", confidence: 0.9, sourceIndices: [0] }] };
    } },
  };
  const table = {
    async get(tx, target, key) {
      return (await hostWriteHookPort.execute(tx, target, "get", [key])).rows[0]?.payload;
    },
    put(tx, target, key, value, indexed = false) {
      return hostWriteHookPort.execute(tx, target, indexed ? "indexed" : "put", [key, JSON.stringify(value)]);
    },
    stageSave(tx, target, key, value) {
      return hostWriteHookPort.stageSave(tx, target, "stage", [key, JSON.stringify(value)]);
    },
    async inspect(target, key) {
      return (await pool.query("SELECT payload FROM test_host_hook_effects WHERE owner = $1 AND namespace = COALESCE($2, '') AND key = $3",
        [target.owner, target.namespace, key])).rows[0]?.payload;
    },
  };
  const snapshot = async () => (await pool.query(`SELECT
    COALESCE((SELECT index_revision::int FROM core_owner_state WHERE user_id = $1), 0) AS "indexRevision",
    (SELECT count(*)::int FROM memories WHERE user_id = $1) AS "memoryCount",
    (SELECT count(*)::int FROM core_memory_receipts WHERE user_id = $1 AND forgotten_at IS NULL) AS "receiptCount",
    (SELECT count(*)::int FROM core_suppression_facts WHERE user_id = $1) AS "factCount",
    (SELECT count(*)::int FROM raw_messages WHERE user_id = $1) AS "rawCount"`, [owner])).rows[0];
  return { createService: createMemoryService, pool, deps, scope, table, snapshot, port: hostWriteHookPort };
}

for (const { id, title, run } of HOST_WRITE_HOOK_CASES) {
  test(`postgres ${id} ${title}`, migrationDbTest, async t => run(await fixture(t)));
}

test("Postgres hook reads the completed ledger and archived Raw on the pinned READ COMMITTED writer", migrationDbTest, async t => {
  const { deps, port } = await fixture(t);
  const coreBackend = new WeakMap();
  const { finish } = deps.storage.capture;
  deps.storage.capture.finish = async (tx, ...args) => {
    coreBackend.set(tx, (await query(tx, "SELECT pg_backend_pid() AS pid")).rows[0].pid);
    return finish(tx, ...args);
  };
  let calls = 0;
  const api = createMemoryService({ ...deps, hostWriteHooks: syntheticHooks({
    async onCaptureFinish(tx, { scope }) {
      calls++;
      assert.equal(await port.transactionIsolation(tx, scope), "read committed");
      assert.deepEqual((await port.execute(tx, scope, "live")).rows, [
        { pid: coreBackend.get(tx), memories: 1, completed: 1, raw: messages.length },
      ]);
      assert.throws(() => query(tx, "SELECT 1"), { code: "storage_transaction_active" });
    },
  }) });
  await api.enqueueCapture(scope, { ...captureIdentity, messages });
  assert.equal((await api.runCapture(scope, captureIdentity)).status, "done");
  assert.equal(calls, 1);
});

for (const [native, code] of [["40001", "storage_busy"], ["40P01", "storage_busy"],
  ["55P03", "lock_timeout"], ["57014", "statement_timeout"]]) {
  test(`Postgres capture rolls back a latched hook SQLSTATE ${native} and retries`, migrationDbTest, async t => {
    const fallback = native === "40001";
    const { deps, port, table, snapshot, pool } = await fixture(t, { failModel: fallback, fallback });
    const failures = [];
    const { abandon } = deps.storage.capture;
    deps.storage.capture.abandon = (tx, token, failure) => {
      failures.push(failure);
      return abandon(tx, token, failure);
    };
    let fail = true;
    const api = createMemoryService({ ...deps, hostWriteHooks: syntheticHooks({
      async onCaptureFinish(tx, ctx) {
        await table.put(tx, ctx.scope, "ledger", ctx.eventId);
        if (fail) {
          // Catch the mapped error and throw a different one. The first failed SQL statement wins.
          await assert.rejects(port.execute(tx, ctx.scope, "failure", [native]), { code, retryable: true });
          throw new Error("synthetic replacement error");
        }
      },
    }) });
    await api.enqueueCapture(scope, { ...captureIdentity, messages });
    const start = await snapshot();
    assert.deepEqual(await api.runCapture(scope, captureIdentity), { status: "failed", code });
    assert.deepEqual(failures, [{ code, retryable: true }]);
    assert.deepEqual(await snapshot(), start);
    assert.equal(await table.inspect(scope, "ledger"), undefined);
    assert.deepEqual((await pool.query("SELECT status, core_failure_code, core_lease_token FROM capture_events WHERE user_id = $1", [owner])).rows,
      [{ status: "pending", core_failure_code: null, core_lease_token: null }]);
    fail = false;
    assert.equal((await api.runCapture(scope, captureIdentity)).status, "done");
    assert.equal(await table.inspect(scope, "ledger"), captureIdentity.eventId);
  });
}

test("Postgres aborts both effects when the pinned connection dies after the hook write", migrationDbTest, async t => {
  let pool;
  let kill = false;
  const f = await fixture(t, { async intercept(connection, sql, values) {
    if (kill && sql.startsWith("SELECT index_revision::text")) {
      kill = false;
      const { rows: [{ pid }] } = await connection.query("SELECT pg_backend_pid() AS pid");
      assert.equal((await pool.query("SELECT pg_terminate_backend($1) AS killed", [pid])).rows[0].killed, true);
    }
    return connection.query(sql, values);
  } });
  pool = f.pool;
  const start = await f.snapshot();
  const api = createMemoryService({ ...f.deps, hostWriteHooks: syntheticHooks({
    async onSave(tx, ctx) {
      await f.table.put(tx, ctx.scope, "interrupted", ctx.memory);
      kill = true;
    },
  }) });
  await assert.rejects(api.save(scope, "The flagpole is striped.", explicit, "fact", { receipt }),
    error => ["storage_error", "internal_error"].includes(error.code));
  assert.equal(kill, false);
  assert.deepEqual(await f.snapshot(), start);
  assert.equal(await f.table.inspect(scope, "interrupted"), undefined);
});

test("Postgres concurrent keyed saves repeat admission under the lock and reconcile a lost commit reply", migrationDbTest, async t => {
  let loseCommit = false;
  const f = await fixture(t, { async intercept(connection, sql, values) {
    const result = await connection.query(sql, values);
    if (loseCommit && sql === "COMMIT") {
      loseCommit = false;
      throw new Error("synthetic lost acknowledgement");
    }
    return result;
  } });
  const { promise: ready, resolve: release } = Promise.withResolvers();
  let embeddings = 0;
  f.deps.embedder.embed = async texts => {
    if (++embeddings === 2) release();
    await ready;
    return texts.map(() => Float32Array.from(vector));
  };
  const effects = [];
  const api = createMemoryService({ ...f.deps, hostWriteHooks: syntheticHooks({
    async beforeSave(tx, ctx) {
      const entry = await f.table.get(tx, ctx.scope, ctx.request.key);
      if (!entry) return { status: "proceed" };
      if (entry.value.request.fingerprint !== ctx.request.fingerprint) return { status: "conflict" };
      return { status: "replay", result: { status: entry.value.status, memory: entry.value.memory, indexRevision: entry.indexRevision } };
    },
    async onSave(tx, ctx) {
      effects.push(ctx.memory);
      await f.table.stageSave(tx, ctx.scope, ctx.request.key, ctx);
      loseCommit = true;
    },
  }) });
  const save = (hostRequest = requested) => api.save(scope, "A painted sign faces east.", explicit, "fact", { hostRequest, receipt });
  const pair = await Promise.allSettled([save(), save()]);
  assert.equal(pair.filter(result => result.status === "rejected" && result.reason.code === "commit_outcome_unknown").length, 1);
  const [winner] = pair.filter(result => result.status === "fulfilled");
  assert.equal(winner.value.status, "saved");
  assert.deepEqual(await save(), winner.value);
  await assert.rejects(save({ ...requested, fingerprint: "other" }), { code: "event_payload_conflict" });
  assert.equal(effects.length, 1);
  assert.equal((await f.snapshot()).receiptCount, 1);
});

test("Postgres refusal preserves a correction predecessor when a legacy HMAC spelling misses Core", migrationDbTest, async t => {
  const { deps, port, pool, snapshot } = await fixture(t);
  const replacement = "A Legacy Turn With Mixed Case.";
  const legacyMac = text => createHmac("sha256", "synthetic legacy fixture").update(text).digest("hex");
  const keyId = "fixture-legacy-domain";
  deps.storage.keys.retainedDigesters = async () => [{ alg: "hmac", keyId, label: "hosted-v1", mac: legacyMac }];
  const baseline = createMemoryService(deps);
  const saved = await baseline.save(scope, "A tiller leans by the door.", explicit, "fact", { receipt });
  assert.equal(saved.status, "saved");
  await pool.query("UPDATE core_owner_state SET legacy_facts_ready = true WHERE user_id = $1", [owner]);
  const tagged = `hmac:${legacyMac(replacement)}`;
  const distant = [0, 1, ...Array(1534).fill(0)];
  await pool.query(`INSERT INTO suppressions (id, user_id, kind, origin, text_hash, key_id, embedding)
    VALUES ('historical', $1, 'text', 'forget', $2, $3, $4)`, [owner, tagged, keyId, JSON.stringify(distant)]);

  const start = await snapshot();
  let coreAdmits = false;
  const proof = createMemoryService({ ...deps, storage: { ...deps.storage, memories: { ...deps.storage.memories,
    async replaceContent() {
      coreAdmits = true;
      throw new CoreError("internal_error");
    },
  } } });
  const correct = api => api.correct(scope, saved.item.id, saved.item.revision, replacement, explicit);
  await assert.rejects(correct(proof), { code: "internal_error" });
  assert.equal(coreAdmits, true);
  assert.deepEqual(await snapshot(), start);

  const hosted = createMemoryService({ ...deps, hostWriteHooks: syntheticHooks({
    async beforeCorrect(tx, ctx) {
      assert.deepEqual(ctx.predecessor,
        { id: saved.item.id, revision: saved.item.revision, source: explicit, createdAtMs: saved.item.createdAtMs });
      const { rows } = await port.execute(tx, ctx.scope, "legacy", [`hmac:${legacyMac(replacement)}`]);
      return { status: rows.length ? "refuse" : "proceed" };
    },
    async onCorrect() { assert.fail("A refused correction reached its write hook"); },
  }) });
  assert.deepEqual(await correct(hosted), { status: "suppressed", indexRevision: start.indexRevision });
  assert.deepEqual(await snapshot(), start);
  assert.deepEqual((await pool.query("SELECT text, revision FROM memories WHERE user_id = $1", [owner])).rows,
    [{ text: saved.item.text, revision: saved.item.revision }]);
});


test("Postgres privacy hooks see facts, replacements, and erasures on the same transaction", migrationDbTest, async t => {
  const { deps, port } = await fixture(t);
  const effects = (tx, target, id) => port.execute(tx, target, "rowEffects", [id]).then(result => result.rows[0]);
  const order = [];
  const api = createMemoryService({ ...deps, hostWriteHooks: syntheticHooks({
    async onSave(tx, ctx) {
      order.push("save");
      assert.deepEqual(await effects(tx, ctx.scope, ctx.memory.id), { revision: 1, receipts: 1, facts: 0 });
    },
    async beforeCorrect(tx, ctx) {
      order.push("admit correction");
      assert.deepEqual(await effects(tx, ctx.scope, ctx.predecessor.id), { revision: 1, receipts: 1, facts: 0 });
      return { status: "proceed" };
    },
    async onCorrect(tx, ctx) {
      order.push("correct");
      assert.deepEqual(await effects(tx, ctx.scope, ctx.predecessor.id), { revision: 2, receipts: 1, facts: 1 });
    },
    async onForget(tx, ctx) {
      order.push("forget");
      assert.deepEqual(await effects(tx, ctx.scope, ctx.predecessor.id), { revision: null, receipts: 0, facts: 2 });
    },
  }) });
  const saved = await api.save(scope, "A canvas bag holds the mallets.", explicit, "fact", { receipt });
  assert.equal(saved.status, "saved");
  const corrected = await api.correct(scope, saved.item.id, saved.item.revision, "A wooden crate holds the hammers.", explicit);
  assert.equal(corrected.status, "saved");
  assert.equal((await api.forget(scope, saved.item.id, explicit)).status, "forgotten");
  assert.deepEqual(order, ["save", "admit correction", "correct", "forget"]);
});
