import { AsyncLocalStorage } from "node:async_hooks";
import assert from "node:assert/strict";
import { test } from "node:test";
import { capabilities, coreFingerprintLabels, userFingerprintKey } from "../../core/src/index.mjs";
import { archive, clock, fork, makeRow, rawForgetCases, root, scope, service, sessionless, text, unrelated }
  from "@cairn-ink/conformance/host-forget-raw";
import {
  createPostgresCapturePorts, createPostgresHostWriteHookPort, createPostgresMemoryCandidates,
  createPostgresMemoryReads, createPostgresMemoryStore, createPostgresPauseStore, createPostgresRawPorts,
  createPostgresRawReads, createPostgresSuppressionStore, createPostgresUnitOfWork,
} from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

async function fixture(t, hostWriteHooks = true) {
  const { pool, source } = await migrationDatabase(t);
  await pool.query("INSERT INTO users (id) VALUES ($1)", [scope.owner]);
  await pool.query("CREATE TABLE fixture_tombstones (owner text, namespace text, address text, state jsonb)");
  const trace = [];
  const uow = createPostgresUnitOfWork({ async connect() {
    const connection = await source.connect();
    return { ...connection, query(sql, values) {
      trace.push(sql);
      return connection.query(sql, values);
    } };
  } });
  const lineageSecret = "synthetic-forget-fixture";
  const key = await userFingerprintKey(lineageSecret, scope.owner, coreFingerprintLabels);
  const options = { lineageSecret, nearDuplicate: false, fingerprintKeys: async () => [{ pipeline: "core", key }] };
  const hostWriteHookPort = hostWriteHooks ? createPostgresHostWriteHookPort({ context: new AsyncLocalStorage(),
    rawVisibility: options, operations: {
      tombstone: { mode: "write", sql: "INSERT INTO fixture_tombstones VALUES ($1, $2, $3, $4::jsonb)" },
    } }) : undefined;
  const storage = {
    name: "postgres", uow, hostWriteHookPort,
    capabilities: capabilities({ hostWriteHooks, rawArchive: true, sessionLineage: true, fingerprintKey: true,
      documentCards: false, embeddingRequiredOnInsert: true }),
    keys: { async userKey() { return key; } },
    memories: createPostgresMemoryStore(options),
    capture: createPostgresCapturePorts({ ...options, now: clock.nowMs }),
    pause: createPostgresPauseStore(),
    suppressions: createPostgresSuppressionStore(options),
    ...createPostgresMemoryReads(options),
    ...createPostgresMemoryCandidates(options),
    ...createPostgresRawPorts(options),
  };
  Object.assign(storage.raw, createPostgresRawReads(options));
  const embedder = { model: "fixture", dimensions: 1536, async embed(texts) {
    return texts.map(() => Float32Array.of(1, ...Array(1535).fill(0)));
  } };
  return {
    storage, trace, containingText: `Earlier notes. ${text}`,
    createService: hooks => service(storage, embedder, hooks),
    table: {
      put: (tx, target, address, state) => hostWriteHookPort.execute(tx, target, "tombstone", [address, JSON.stringify(state)]),
      async inspect(target, address) {
        const { rows } = await pool.query(`SELECT state FROM fixture_tombstones
          WHERE owner = $1 AND namespace IS NOT DISTINCT FROM $2 AND address = $3`, [target.owner, target.namespace, address]);
        return rows[0]?.state;
      },
    },
    async rawRows() {
      const { rows } = await pool.query(`SELECT client, session_id AS "sessionId", message_id AS "messageId", role,
        (EXTRACT(EPOCH FROM occurred_at) * 1000)::double precision AS "occurredAtMs"
        FROM raw_messages WHERE user_id = $1 ORDER BY client, session_id, message_id`, [scope.owner]);
      return rows;
    },
    async proveFork() {
      await uow.run(scope.owner, { pauseLock: true }, async tx => {
        const anchor = { messageMac: "1".repeat(64), contentMac: "2".repeat(64) };
        for (const session of [root, fork]) await storage.sessionLineage.recordAnchors(tx, scope, session, [anchor]);
      });
    },
  };
}

rawForgetCases((name, run) => test(name, migrationDbTest, run), fixture);

test("omitting Postgres hooks preserves forget bytes and the Raw deletion query trace", migrationDbTest, async t => {
  async function run(capability) {
    const f = await fixture(t, capability);
    const api = f.createService();
    await archive(f.storage, makeRow(root.sessionId, "root-turn", null, unrelated));
    await archive(f.storage, makeRow("other", "outside-turn", 1234, `Earlier notes. ${text}`));
    const source = { kind: "web", ...root };
    const saved = await api.save(scope, text, source);
    assert.equal(saved.status, "saved");
    f.trace.length = 0;
    const result = await api.forget(scope, saved.item.id, source);
    assert.equal(result.status, "forgotten");
    assert.deepEqual(await f.rawRows(), []);
    const deletes = f.trace.filter(sql => /^DELETE FROM raw_messages/u.test(sql));
    assert.equal(deletes.length, 2);
    assert.match(deletes[0], /RETURNING 1$/u);
    assert.match(deletes[1], /RETURNING client, session_id AS "sessionId", message_id AS "messageId"$/u);
    return JSON.stringify({ result, trace: f.trace });
  }
  assert.equal(await run(true), await run(false));
});
