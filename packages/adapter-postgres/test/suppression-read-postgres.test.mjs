import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { coreDigest, factIncarnationBody } from "../../core/src/index.mjs";
import {
  assertPostgresFingerprintRotation, createPostgresFingerprintKeyProvider, createPostgresSuppressionStore,
  createPostgresUnitOfWork,
} from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const owner = "first-owner";
const other = "second-owner";
const scope = { owner, namespace: null };
const base = { owner, actionId: "original", origin: "forget" };
const hashSessionKey = (client, sessionId) =>
  createHash("sha256").update(JSON.stringify([client, sessionId])).digest("hex");

async function setup(t, observe) {
  const { pool, source } = await migrationDatabase(t);
  const connectionSource = observe ? {
    async connect() {
      const connection = await source.connect();
      return {
        ...connection,
        query(sql, values) {
          observe(sql, values);
          return connection.query(sql, values);
        },
      };
    },
  } : source;
  const { run } = createPostgresUnitOfWork(connectionSource);
  const store = createPostgresSuppressionStore({ sessionRefs: "hashed", hashSessionKey });
  const write = (fact) => run(fact.owner, {}, (tx) => store.writeFact(tx, fact,
    createHash("sha256").update(factIncarnationBody(fact)).digest("hex")));
  await pool.query("INSERT INTO users (id) VALUES ($1), ($2)", [owner, other]);
  return { pool, run, store, write };
}

test("Postgres snapshots use the indexed digest lookup with owner and epoch isolation", migrationDbTest, async (t) => {
  let lookup;
  const { pool, run, store, write } = await setup(t, (sql, values) => {
    if (sql.includes("WITH hits AS")) lookup = { sql, values };
  });
  const digest = await coreDigest("indexed evidence");
  const fact = { ...base, kind: "text", mode: "exact", text: { digests: [digest] } };
  const first = await write(fact);
  assert.deepEqual(await write(fact), { ...first, created: false });
  await write({ ...fact, owner: other, actionId: "other owner" });
  await write({ ...fact, namespace: "other", actionId: "other namespace" });
  const unmatched = await coreDigest("other evidence");
  await write({ ...fact, actionId: "unmatched", text: { digests: [unmatched] } });
  await write({ ...fact, actionId: "incomparable", text: {
    digests: [{ ...unmatched, alg: "hmac", keyId: "old-key" }],
  } });

  await run(owner, { readOnly: true }, async (tx) => {
    assert.equal(await store.epoch(tx, owner), 4n);
    const actual = await store.snapshot(tx, scope, { passages: [{ digests: [digest], shingles: null, keyId: null }] });
    assert.deepEqual(actual.passages.map(({ fact }) => fact.actionId), ["original", "incomparable"]);
    assert.deepEqual(
      actual.passages[0],
      { fact: JSON.parse(JSON.stringify(fact)), factId: first.factId, epoch: first.epoch,
        incarnation: createHash("sha256").update(factIncarnationBody(fact)).digest("hex"), createdAtMs: first.createdAtMs },
    );
    await assert.rejects(store.snapshot(tx, { ...scope, owner: other }, {}), { code: "internal_error" });
  });
  assert.equal(await run(other, { readOnly: true }, (tx) => store.epoch(tx, other)), 1n);
  assert.deepEqual((await pool.query("SELECT user_id, fact_epoch, index_revision FROM core_owner_state ORDER BY user_id")).rows, [
    { user_id: owner, fact_epoch: "4", index_revision: "4" },
    { user_id: other, fact_epoch: "1", index_revision: "1" },
  ]);

  assert.ok(lookup);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL enable_seqscan = off");
    const { rows: [row] } = await client.query(`EXPLAIN (FORMAT JSON) ${lookup.sql}`, lookup.values);
    assert.match(JSON.stringify(row["QUERY PLAN"]),
      /"Index Name":"core_fact_digests_user_value_idx"[^}]*"Index Cond":"[^"]*user_id[^"]*value/u);
  } finally {
    try {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }

  // Removing the lookup row cannot make its matching body disappear.
  await pool.query("DELETE FROM core_fact_digests WHERE user_id = $1 AND fact_id = $2", [owner, first.factId]);
  const projected = await run(owner, { readOnly: true }, (tx) =>
    store.snapshot(tx, scope, { passages: [{ digests: [digest], shingles: null, keyId: null }] }));
  assert.deepEqual(projected.passages.map(({ fact }) => fact.actionId), ["original", "incomparable"]);
});

test("Postgres factsFor compares hashed facts with owner-scoped receipts and fails closed on missing evidence", migrationDbTest, async (t) => {
  const { pool, run, store, write } = await setup(t);
  const client = "capture-client";
  const sessionId = "forgotten-session";
  const session = { ...base, kind: "session", session: { client, sessionKeyHash: hashSessionKey(client, sessionId) } };
  await assert.rejects(write({ ...session, session: { client, sessionId } }), { code: "invalid_input" });
  await write(session);
  const digest = await coreDigest("stored text");
  const embedding = JSON.stringify([1, ...Array(1535).fill(0)]);
  for (const id of ["matches", "misses"]) {
    await pool.query(`INSERT INTO memories
      (id, user_id, text, text_hash, kind, embedding, embedding_model, source_kind)
      VALUES ($1, $2, 'stored text', $3, 'fact', $4, 'test', 'mcp')`,
    [id, owner, id === "matches" ? digest.value : "b".repeat(64), embedding]);
  }
  await pool.query(`INSERT INTO core_memory_receipts (user_id, memory_id, client, session_id, message_id, role)
    VALUES ($1, 'matches', $3, $4, 'a', 'user'),
      ($1, 'misses', $3, 'different-session', 'a', 'user'),
      ($2, 'misses', $3, $4, 'a', 'user')`, [owner, other, client, sessionId]);
  const read = (selected, memoryId) => run(owner, { readOnly: true }, (tx) => selected.factsFor(tx, scope, { memoryId }));
  assert.deepEqual((await read(store, "matches")).map(({ fact }) => fact), [session]);
  assert.deepEqual(await read(store, "misses"), []);
  const withoutHasher = createPostgresSuppressionStore({ sessionRefs: "hashed" });
  assert.deepEqual((await read(withoutHasher, "misses")).map(({ fact }) => fact), [session]);
  await pool.query("UPDATE core_memory_receipts SET forgotten_at = now() WHERE user_id = $1 AND memory_id = 'matches'", [owner]);
  assert.deepEqual(await read(store, "matches"), []);
  await assert.rejects(run(owner, { readOnly: true }, (tx) =>
    store.factsFor(tx, { ...scope, owner: other }, { memoryId: "matches" })), { code: "internal_error" });
  await pool.query(`INSERT INTO suppressions (id, user_id, kind, client, session_id)
    VALUES ('legacy', $1, 'session', $2, 'different-session')`, [owner, client]);
  assert.equal(await read(store, "matches"), "ineligible");
  const snapshot = () => run(owner, { readOnly: true }, (tx) =>
    store.snapshot(tx, scope, { client, sessionId: "different-session" }));
  await assert.rejects(snapshot, { code: "ineligible" });
  await pool.query("UPDATE core_owner_state SET legacy_facts_ready = true WHERE user_id = $1", [owner]);
  assert.deepEqual((await read(store, "misses")).map(({ factId }) => factId), ["legacy"]);
  assert.equal((await snapshot()).blockedSession, true);
  await pool.query("UPDATE core_owner_state SET legacy_writes_reconciled = true WHERE user_id = $1", [owner]);
  assert.deepEqual(await read(store, "misses"), []);
  assert.equal((await snapshot()).blockedSession, false);
});

test("Postgres rotation gate rejects older live HMAC-only facts and unstaged rows", migrationDbTest, async (t) => {
  const { pool, run, write } = await setup(t);
  const [older, current, next] = await Promise.all(["key-a", "key-b", "key-c"].map((secret) =>
    createPostgresFingerprintKeyProvider(secret).userKey(owner)));
  await write({ ...base, kind: "text", mode: "exact", text: { digests: [await coreDigest("protected", older)] } });
  const gate = (who, before, after) => run(who, {}, (tx) => assertPostgresFingerprintRotation(tx, before.id, after.id));
  await gate(owner, older, current);
  await assert.rejects(gate(owner, current, next), { code: "fingerprint_key_mismatch" });
  await gate(other, current, next);

  await pool.query(`INSERT INTO memories
    (id, user_id, text, text_hash, kind, embedding, embedding_model, source_kind)
    VALUES ('unstaged', $1, 'stored text', $2, 'fact', $3, 'test', 'mcp')`,
  [other, "sha256:" + "c".repeat(64), JSON.stringify([1, ...Array(1535).fill(0)])]);
  await assert.rejects(gate(other, current, next), { code: "fingerprint_key_mismatch" });
  assert.deepEqual((await pool.query("SELECT user_id, fact_epoch, index_revision FROM core_owner_state")).rows,
    [{ user_id: owner, fact_epoch: "1", index_revision: "1" }]);
});
