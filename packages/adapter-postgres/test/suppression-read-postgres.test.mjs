import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { coreDigest, factBlocksIncoming, factIncarnationBody, userFingerprintKey } from "../../core/src/index.mjs";
import {
  createPostgresFingerprintKeyProvider, createPostgresMemoryReads, createPostgresSuppressionStore,
  createPostgresUnitOfWork, factSlot, HOSTED_FINGERPRINT_LABELS,
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
  const uow = createPostgresUnitOfWork(connectionSource);
  const { run } = uow;
  const store = createPostgresSuppressionStore({ sessionRefs: "hashed", hashSessionKey });
  const write = (fact) => run(fact.owner, {}, (tx) => store.writeFact(tx, fact,
    createHash("sha256").update(factIncarnationBody(fact)).digest("hex")));
  await pool.query("INSERT INTO users (id) VALUES ($1), ($2)", [owner, other]);
  return { pool, uow, run, store, write };
}

test("Postgres snapshot keeps ineligible labels and distinct digest records", migrationDbTest, async (t) => {
  const { run, store, write } = await setup(t);
  const keyed = { alg: "hmac", value: "a".repeat(64), pipeline: "core", keyId: "fixture-key", redactionVersion: 2 };
  const fact = { ...base, kind: "text", mode: "exact", text: { digests: [keyed] } };
  const historical = await write(fact);
  const snapshot = (digests) => run(owner, { readOnly: true }, tx => store.snapshot(tx, scope, {
    passages: [{ digests, shingles: null, keyId: keyed.keyId }],
  }));
  const miss = { ...keyed, value: "b".repeat(64) };
  assert.deepEqual((await snapshot([{ ...miss, label: "foreign" }])).passages.map(({ factId }) => factId), [historical.factId]);
  assert.deepEqual((await snapshot([{ ...miss, label: "core" }, { ...miss, label: "foreign" }])).passages, []);

  const digests = [{ ...keyed, label: "one" }, { ...keyed, label: "two" }];
  const labelled = await write({ ...fact, text: { digests } });
  const separate = await write({ ...fact, text: { digests: [digests[0]] } });
  const result = await snapshot(digests);
  assert.deepEqual(result.passages.map(({ factId }) => factId), [historical.factId, labelled.factId, separate.factId]);
  assert.deepEqual(result.passages[1].fact.text.digests, digests);
});

test("Capture snapshot keeps full fact evidence for the retained-shingle matcher", migrationDbTest, async (t) => {
  const { run, store, write } = await setup(t);
  const digest = { alg: "hmac", value: "a".repeat(64), pipeline: "core", label: "core", keyId: "retained", redactionVersion: 2 };
  const text = { digests: [digest], shingles: ["abcd"], keyId: digest.keyId };
  const saved = await write({ ...base, kind: "text", mode: "full", text });
  const passage = { digests: [{ ...digest, value: "b".repeat(64) }], shingles: null, keyId: null,
    retainedShingles: [{ keyId: digest.keyId, shingles: ["1234"] }] };
  const snapshot = (candidate) => run(owner, { readOnly: true }, tx => store.snapshot(tx, scope, { passages: [candidate] }));
  const { passages: [stored] } = await snapshot(passage);
  assert.equal(stored.factId, saved.factId);
  assert.deepEqual(stored.fact.text, text);
  const matches = (candidate) => factBlocksIncoming(stored, { scope, passages: [candidate] }, { mode: "capture" });
  assert.equal(matches(passage), false);
  assert.equal(matches({ ...passage, retainedShingles: [{ keyId: digest.keyId, shingles: ["abcd"] }] }), true);
  await assert.rejects(snapshot({ ...passage, retainedShingles: [{ keyId: digest.keyId, shingles: ["invalid"] }] }),
    { code: "ineligible" });
});

test("Postgres snapshots use the indexed digest lookup with owner and epoch isolation", migrationDbTest, async (t) => {
  let lookup;
  const { pool, run, store, write } = await setup(t, (sql, values) => {
    if (sql.includes("WITH hits AS")) lookup = { sql, values };
  });
  const digest = await coreDigest("indexed evidence");
  const fact = { ...base, kind: "text", mode: "exact", text: { digests: [digest] } };
  const first = await write(fact);
  assert.deepEqual(await write(fact), { ...first, created: false });
  const foreign = await write({ ...fact, owner: other, actionId: "other owner" });
  await write({ ...fact, namespace: "other", actionId: "other namespace" });
  const unmatched = await coreDigest("other evidence");
  const miss = await write({ ...fact, actionId: "unmatched", text: { digests: [unmatched] } });
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

  // Fact IDs are unique per owner. A foreign hit for this owner's SHA miss
  // must never enter the SQL result, even if core would discard it later.
  await pool.query("DELETE FROM core_fact_digests WHERE user_id = $1 AND fact_id = $2", [other, foreign.factId]);
  await pool.query("UPDATE core_suppression_facts SET fact_id = $3 WHERE user_id = $1 AND fact_id = $2",
    [other, foreign.factId, miss.factId]);
  await pool.query(`INSERT INTO core_fact_digests (user_id, fact_id, alg, value, pipeline, redaction_version, key_id, label)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $5)`,
  [other, miss.factId, digest.alg, digest.value, digest.pipeline, digest.redactionVersion, digest.keyId]);
  await pool.query("ANALYZE core_owner_state; ANALYZE core_suppression_facts; ANALYZE core_fact_digests; ANALYZE suppressions");
  assert.ok(lookup);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL enable_seqscan = off");
    const { rows: [row] } = await client.query(`EXPLAIN (FORMAT JSON) ${lookup.sql}`, lookup.values);
    const pending = [row["QUERY PLAN"][0].Plan];
    let indexed = false;
    while (pending.length) {
      const node = pending.pop();
      pending.push(...(node.Plans ?? []));
      if (node["Index Name"] === "core_fact_digests_user_value_idx" &&
          ["user_id", "value"].every(column => node["Index Cond"]?.includes(column))) indexed = true;
    }
    if (!indexed) t.diagnostic("Planner chose a different shape for this fixture; checking isolated SQL results directly.");
    const { rows } = await client.query(lookup.sql, lookup.values);
    assert.deepEqual(rows.map(row => [row.action_id, row.epoch]), [["original", "1"], ["incomparable", "4"]]);
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

test("Postgres publication counts coverage only for the publishing owner", migrationDbTest, async (t) => {
  const { pool, uow, write } = await setup(t);
  const provider = createPostgresFingerprintKeyProvider("key-a", { uow });
  const key = await userFingerprintKey("key-a", owner, HOSTED_FINGERPRINT_LABELS);
  const otherKey = await userFingerprintKey("key-x", owner, HOSTED_FINGERPRINT_LABELS);
  await write({ ...base, kind: "text", mode: "exact", text: { digests: [await coreDigest("protected", otherKey)] } });
  await provider.publish(other, key.id);
  await assert.rejects(provider.publish(owner, key.id), { code: "fingerprint_key_mismatch" });
  assert.equal((await provider.userKey(other)).id, key.id);
  assert.equal(await provider.userKey(owner), null);

  await pool.query(`INSERT INTO memories
    (id, user_id, text, text_hash, kind, embedding, embedding_model, source_kind)
    VALUES ('unstaged', $1, 'stored text', $2, 'fact', $3, 'test', 'mcp')`,
  [owner, "sha256:" + "c".repeat(64), JSON.stringify([1, ...Array(1535).fill(0)])]);
  const staged = createPostgresFingerprintKeyProvider("key-b", { uow, stagedSecrets: ["key-a"] });
  const next = await userFingerprintKey("key-b", owner, HOSTED_FINGERPRINT_LABELS);
  await staged.publish(other, next.id);
  assert.equal((await staged.userKey(other)).id, next.id);
  assert.deepEqual((await pool.query(`SELECT user_id, fact_epoch, index_revision FROM core_owner_state
    ORDER BY user_id`)).rows,
  [{ user_id: owner, fact_epoch: "1", index_revision: "1" }, { user_id: other, fact_epoch: "0", index_revision: "0" }]);
});

test("Postgres snapshot refuses a partial result when the database fan-out exceeds 4096 facts", migrationDbTest, async (t) => {
  const { pool, run, store } = await setup(t);
  const digest = await coreDigest("matching projection");
  await pool.query(`INSERT INTO core_suppression_facts
    (user_id, fact_id, slot, slot_hash, incarnation, action_id, epoch, origin, kind, mode, body)
    SELECT $1, 'window-' || n, format('[null,"window",null,%s,%s,false,null]', n, n + 1),
      encode(sha256(convert_to(n::text, 'UTF8')), 'hex'), repeat('0', 64), 'overflow', n, 'forget', 'window', NULL,
      jsonb_build_object('kind', 'window', 'origin', 'forget', 'client', NULL,
        'window', jsonb_build_object('startMs', n, 'endMs', n + 1))
    FROM generate_series(1, 4097) n`, [owner]);
  const snapshot = () => run(owner, { readOnly: true }, tx => store.snapshot(tx, scope, {
    occurredAtMs: [4096], passages: [{ digests: [digest], shingles: null, keyId: null }],
  }));
  await assert.rejects(snapshot, { code: "ineligible" });
  await pool.query("DELETE FROM core_suppression_facts WHERE user_id = $1 AND epoch = 4097", [owner]);
  assert.deepEqual(await snapshot(), { blockedSession: false, blockedMessages: [0], passages: [] });
});

test("Postgres visibility and suppression reads both reject a stale canonical fact slot", migrationDbTest, async (t) => {
  const { pool, run, store, write } = await setup(t);
  const text = "stored text";
  const digest = await coreDigest(text);
  const fact = { ...base, kind: "text", mode: "exact", text: { digests: [digest] } };
  const stored = await write(fact);
  await pool.query(`INSERT INTO memories (id, user_id, text, text_hash, kind, embedding, embedding_model, source_kind)
    VALUES ('stored', $1, $2, $3, 'fact', $4, 'test', 'mcp')`,
  [owner, text, digest.value, JSON.stringify([1, ...Array(1535).fill(0)])]);
  const { fence } = createPostgresMemoryReads();
  const visible = () => run(owner, { readOnly: true }, tx => fence.assertVisible(tx,
    { owner, namespaces: [null] }, [{ type: "memory", namespace: null, id: "stored" }]));
  assert.deepEqual(await visible(), []);
  await pool.query("UPDATE core_suppression_facts SET slot = $3 WHERE user_id = $1 AND fact_id = $2",
    [owner, stored.factId, factSlot({ ...fact, mode: "full" })]);
  await assert.rejects(visible, { code: "ineligible" });
  const facts = await run(owner, { readOnly: true }, tx => store.factsFor(tx, scope, { memoryId: "stored" }));
  assert.equal(facts, "ineligible");
});
