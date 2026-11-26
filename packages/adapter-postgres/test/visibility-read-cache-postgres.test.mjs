import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { coreDigest, factIncarnationBody } from "../../core/src/index.mjs";
import {
  createPostgresMemoryCandidates, createPostgresMemoryReads, createPostgresMemoryStore,
  createPostgresSuppressionStore, createPostgresUnitOfWork, query,
} from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const owner = "owner";
const other = "other-owner";
const scope = { owner, namespace: null };
const selection = { owner, namespaces: [null] };
const page = { cursor: null, limit: 10 };
const content = "orchard evidence";
const ref = { type: "memory", id: "personal", namespace: null };

async function setup(t) {
  const { pool, source } = await migrationDatabase(t);
  const visibilityReads = [];
  const { run } = createPostgresUnitOfWork({
    async connect() {
      const connection = await source.connect();
      return {
        ...connection,
        query(sql, values) {
          if (sql.startsWith("WITH owner_state AS") && sql.includes(" AS needs_digests")) {
            visibilityReads.push(values[0]);
          }
          return connection.query(sql, values);
        },
      };
    },
  });
  const digest = await coreDigest(content);
  await pool.query("INSERT INTO users (id) VALUES ($1), ($2)", [owner, other]);
  for (const [id, user, namespace] of [[ref.id, owner, null], ["shared", owner, '"room"'], ["other", other, null]]) {
    await pool.query(`INSERT INTO memories
      (id, user_id, core_namespace, text, text_hash, kind, source_kind, source_client, source_session_id,
        embedding, embedding_model)
      VALUES ($1, $2, $3, $4, $5, 'fact', 'mcp', 'client', 'session', $6, 'test')`,
    [id, user, namespace, content, namespace === null ? digest.value : "b".repeat(64),
      JSON.stringify([1, ...Array(1535).fill(0)])]);
  }
  return { run, digest, visibilityReads };
}

function forgetText(tx, digest) {
  const fact = { ...scope, kind: "text", origin: "forget", actionId: "forget", mode: "exact", text: { digests: [digest] } };
  const incarnation = createHash("sha256").update(factIncarnationBody(fact)).digest("hex");
  return createPostgresSuppressionStore().writeFact(tx, fact, incarnation);
}

test("Postgres read ports share facts in a transaction and the fence reads again", migrationDbTest, async (t) => {
  const { run, digest, visibilityReads } = await setup(t);
  const { lexical } = createPostgresMemoryCandidates();
  const { hydrate, fence } = createPostgresMemoryReads();
  await run(owner, { readOnly: true }, async (tx) => {
    assert.equal((await lexical.lexical(tx, selection, "orchard", 10)).matched, true);
    assert.equal((await hydrate.hydrate(tx, selection, [ref], "recall")).length, 1);
    assert.deepEqual(visibilityReads, [owner]);
    assert.deepEqual(await fence.assertVisible(tx, selection, [ref]), [ref]);
    assert.deepEqual(visibilityReads, [owner, owner]);
  });
  await run(owner, {}, tx => forgetText(tx, digest));
  assert.deepEqual(await run(owner, { readOnly: true }, tx => hydrate.hydrate(tx, selection, [ref], "recall")), []);
  assert.deepEqual(visibilityReads, [owner, owner, owner]);
});

test("Postgres write transactions see newly written core and legacy suppressions", migrationDbTest, async (t) => {
  const { run, digest, visibilityReads } = await setup(t);
  const { recent } = createPostgresMemoryReads();
  const store = createPostgresMemoryStore();
  await run(owner, {}, async (tx) => {
    const writePolicy = () => store.readWritePolicy(tx, scope, [{ textHash: `sha256:${digest.value}`, digests: [digest] }],
      { kind: "mcp", client: "client", sessionId: "session" }, "hash");
    assert.deepEqual((await writePolicy()).blockedPositions, []);
    assert.equal((await recent.recent(tx, selection, page)).items.length, 1);
    await forgetText(tx, digest);
    assert.deepEqual((await writePolicy()).blockedPositions, [0]);
    assert.deepEqual((await recent.recent(tx, selection, page)).items, []);
    assert.deepEqual(visibilityReads, [owner, owner, owner, owner]);
  });
  await run(other, {}, async (tx) => {
    const read = () => recent.recent(tx, { owner: other, namespaces: [null] }, page);
    assert.equal((await read()).items.length, 1);
    await query(tx, "INSERT INTO core_owner_state (user_id, legacy_facts_ready) VALUES ($1, true)", [other]);
    await query(tx, `INSERT INTO suppressions (id, user_id, kind, client, session_id)
      VALUES ('legacy', $1, 'session', 'client', 'session')`, [other]);
    assert.deepEqual((await read()).items, []);
  });
});

test("Postgres visibility stays isolated across namespaces and owners", migrationDbTest, async (t) => {
  const { run, digest, visibilityReads } = await setup(t);
  const { recent, hydrate } = createPostgresMemoryReads({ allowNonNullNamespace: true });
  await run(owner, {}, tx => forgetText(tx, digest));
  await run(owner, { readOnly: true }, async (tx) => {
    assert.deepEqual((await recent.recent(tx, selection, page)).items, []);
    const shared = { type: "memory", id: "shared", namespace: "room" };
    const items = await hydrate.hydrate(tx, { owner, namespaces: ["room"] }, [shared], "recall");
    assert.deepEqual(items.map(item => item.ref), [shared]);
  });
  await run(other, { readOnly: true }, async (tx) => {
    const { items } = await recent.recent(tx, { owner: other, namespaces: [null] }, page);
    assert.deepEqual(items.map(item => item.id), ["other"]);
  });
  assert.deepEqual(visibilityReads, [owner, other]);
});
