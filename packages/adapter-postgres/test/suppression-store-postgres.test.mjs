import assert from "node:assert/strict";
import test from "node:test";
import { factBody, factIncarnationBody } from "../../core/src/index.mjs";
import { canonicalDigests, createPostgresSuppressionStore, createPostgresUnitOfWork } from "../src/index.mjs";
import { slotHash } from "../src/facts.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const owner = "owner";
const other = "other-owner";
const base = { owner, actionId: "action", origin: "forget" };
const identity = { ...base, kind: "identity", memoryId: "memory" };
const text = { ...base, kind: "text", mode: "full", text: {
  embedding: [1, ...Array(1535).fill(0)], shingles: ["abcd", "1234"], keyId: "key",
  digests: [
    { alg: "sha256", value: "b".repeat(64), pipeline: "core", redactionVersion: 2, keyId: null },
    { alg: "hmac", value: "a".repeat(64), pipeline: "hosted-v1", redactionVersion: 1, keyId: "key" },
  ],
} };
const facts = [identity, text,
  { ...base, kind: "session", session: { client: "client", sessionId: "session" } },
  { ...base, kind: "window", client: null, window: { startMs: 1, endMs: 2 } },
  { ...base, kind: "rawSpan", sessionKeyHash: "c".repeat(64), contentDigest: "d".repeat(64),
    messageKey: "message", startUtf16: 1, endUtf16: 2 },
];

// Return checked-out clients before the test database is dropped.
function keepConnections(pool) {
  return async (sql, values) => {
    const client = await pool.connect();
    try {
      return (await client.query(sql, values)).rows;
    } finally {
      client.release();
    }
  };
}

async function incarnation(fact) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(factIncarnationBody(fact)));
  return Buffer.from(hash).toString("hex");
}

test("Cutover P1 unlabelled writes with equal MACs and distinct redaction versions use separate slots", migrationDbTest, async (t) => {
  const { pool, source } = await migrationDatabase(t);
  await pool.query("INSERT INTO users (id) VALUES ($1)", [owner]);
  const { run } = createPostgresUnitOfWork(source);
  const store = createPostgresSuppressionStore();
  const digest = { alg: "hmac", value: "a".repeat(64), keyId: "key", pipeline: "core", redactionVersion: 2 };
  const exact = { ...base, kind: "text", mode: "exact" };
  const write = async (version) => {
    const fact = { ...exact, text: { digests: [{ ...digest, redactionVersion: version }] } };
    const hash = await incarnation(fact);
    return run(owner, {}, tx => store.writeFact(tx, fact, hash));
  };
  const first = await write(2);
  const second = await write(3);
  assert.notEqual(first.factId, second.factId);
  assert.deepEqual(await write(2), { ...first, created: false });
  const { rows: lookup } = await pool.query("SELECT label, pipeline, redaction_version FROM core_fact_digests ORDER BY redaction_version");
  assert.deepEqual(lookup, [2, 3].map(redaction_version => ({ label: "core", pipeline: "core", redaction_version })));
  assert.deepEqual((await run(owner, { readOnly: true }, tx => store.snapshot(tx, { owner, namespace: null }, {})))
    .passages.map(({ fact }) => fact.text.digests[0]), [digest, { ...digest, redactionVersion: 3 }].map(d => ({ ...d, label: "core" })));

  // Recreate the pre-migration body and slot for the first fact, keeping its incarnation.
  const slot = JSON.stringify([null, "text", "exact", [[digest.alg, digest.value]], null]);
  await pool.query("UPDATE core_suppression_facts SET slot = $2, slot_hash = $3, body = $4 WHERE fact_id = $1",
    [first.factId, slot, await slotHash(slot), factBody({ ...exact, text: { digests: [digest] } })]);
  assert.deepEqual(await write(2), { ...first, created: false });
  assert.equal((await write(4)).created, true);
  const snapshot = await run(owner, { readOnly: true }, tx => store.snapshot(tx, { owner, namespace: null }, {}));
  assert.deepEqual(snapshot.passages[0].fact.text.digests, [digest]);
});

test("Postgres suppression store persists facts and rolls back atomically", migrationDbTest, async (t) => {
  const { pool, source } = await migrationDatabase(t);
  const rows = keepConnections(pool);
  const { run } = createPostgresUnitOfWork(source);
  const store = createPostgresSuppressionStore();
  const epoch = (who) => run(who, { readOnly: true }, (tx) => store.epoch(tx, who));
  const write = async (fact, hash = undefined) => {
    hash ??= await incarnation(fact);
    return run(fact.owner, {}, (tx) => store.writeFact(tx, fact, hash));
  };
  const state = "SELECT user_id, fact_epoch, index_revision FROM core_owner_state";
  const counters = (who) => rows(`${state} WHERE user_id = $1`, [who]);
  const snapshot = () => Promise.all([rows(`${state} ORDER BY user_id`), rows("SELECT * FROM core_suppression_facts ORDER BY user_id, epoch"),
    rows("SELECT * FROM core_fact_digests ORDER BY user_id, fact_id, alg, value")]);
  await rows("INSERT INTO users (id) VALUES ($1), ($2)", [owner, other]);
  await rows("INSERT INTO core_owner_state (user_id, index_revision) VALUES ($1, 7)", [other]);
  assert.equal(await epoch(owner), null);
  assert.equal(await epoch(other), null);

  const originals = [];
  for (const [i, fact] of facts.entries()) {
    const expected = String(i + 1);
    const first = await write(fact);
    originals.push(first);
    assert.equal(first.created, true);
    assert.equal(first.epoch, BigInt(expected));
    assert.equal(await epoch(owner), first.epoch);
    const expectedState = [{ user_id: owner, fact_epoch: expected, index_revision: expected }];
    assert.deepEqual(await counters(owner), expectedState);
    assert.deepEqual(await write(fact), { ...first, created: false });
    assert.deepEqual(await counters(owner), expectedState);
  }

  const hash = await incarnation(text);
  const changed = { ...text, text: { ...text.text, embedding: [...text.text.embedding].reverse() } };
  assert.equal(await incarnation(changed), hash);
  assert.deepEqual(await write(changed, hash), { ...originals[1], created: false });
  const { factId } = originals[1];
  const [stored] = await rows("SELECT body, embedding::text, shingles, key_id FROM core_suppression_facts WHERE user_id = $1 AND fact_id = $2", [owner, factId]);
  const labelled = { ...text, text: { ...text.text, digests: text.text.digests.map(d => d.keyId === null ? d : { ...d, label: d.pipeline }) } };
  assert.deepEqual(stored, { body: JSON.parse(factBody(labelled)), embedding: JSON.stringify(text.text.embedding), shingles: text.text.shingles, key_id: text.text.keyId });
  assert.deepEqual(await rows("SELECT user_id, fact_id, alg, value, pipeline, redaction_version, key_id, label FROM core_fact_digests ORDER BY alg, value"),
    canonicalDigests(text.text.digests).map(({ redactionVersion, keyId, ...digest }) =>
      ({ user_id: owner, fact_id: factId, ...digest, redaction_version: redactionVersion, key_id: keyId, label: digest.pipeline })));

  const fresh = { ...text, namespace: "fresh" };
  const freshHash = await incarnation(fresh);
  const before = await snapshot();
  await assert.rejects(run(owner, {}, async (tx) => {
    assert.equal((await store.writeFact(tx, fresh, freshHash)).epoch, 6n);
    await assert.rejects(store.writeFact(tx, text, "0".repeat(64)), { code: "fact_conflict" });
  }), { code: "fact_conflict" });
  assert.deepEqual(await snapshot(), before);
  const abort = { code: "capture_paused" };
  await assert.rejects(run(owner, {}, async (tx) => {
    assert.equal((await store.writeFact(tx, fresh, freshHash)).epoch, 6n);
    throw abort;
  }), abort);
  assert.deepEqual(await snapshot(), before);

  const attempts = await Promise.all([write(fresh, freshHash), write(fresh, freshHash)]);
  const first = attempts.find((attempt) => attempt.created);
  assert.equal(first?.epoch, 6n);
  assert.deepEqual(attempts.find((attempt) => !attempt.created), { ...first, created: false });
  assert.equal(await epoch(owner), 6n);
  const isolated = await write({ ...identity, owner: other });
  assert.equal(isolated.created, true);
  assert.equal(isolated.epoch, 1n);
  assert.equal(await epoch(other), 1n);
  assert.deepEqual(await counters(other), [{ user_id: other, fact_epoch: "1", index_revision: "8" }]);
  assert.deepEqual(await counters(owner), [{ user_id: owner, fact_epoch: "6", index_revision: "6" }]);
});

for (const sameIncarnation of [true, false]) {
  test(`Postgres parallel writes to a new slot ${sameIncarnation ? "replay" : "conflict"} in the same transaction`, migrationDbTest, async (t) => {
    const { pool, source } = await migrationDatabase(t);
    const rows = keepConnections(pool);
    const { run } = createPostgresUnitOfWork(source);
    const store = createPostgresSuppressionStore();
    const hash = await incarnation(text);
    const writes = (tx) => Promise.all([
      store.writeFact(tx, text, hash),
      store.writeFact(tx, text, sameIncarnation ? hash : "0".repeat(64)),
    ]);
    await rows("INSERT INTO users (id) VALUES ($1)", [owner]);

    if (sameIncarnation) {
      const attempts = await run(owner, {}, writes);
      const first = attempts.find((attempt) => attempt.created);
      assert.equal(first?.epoch, 1n);
      assert.deepEqual(attempts.find((attempt) => !attempt.created), { ...first, created: false });
      assert.deepEqual(await rows("SELECT fact_epoch, index_revision FROM core_owner_state"), [{ fact_epoch: "1", index_revision: "1" }]);
      assert.deepEqual(await rows("SELECT fact_id, epoch FROM core_suppression_facts"), [{ fact_id: first.factId, epoch: "1" }]);
      assert.deepEqual(await rows("SELECT DISTINCT fact_id FROM core_fact_digests"), [{ fact_id: first.factId }]);
    } else {
      await assert.rejects(run(owner, {}, (tx) => assert.rejects(writes(tx), { code: "fact_conflict" })), { code: "fact_conflict" });
      assert.deepEqual(await rows("SELECT * FROM core_owner_state"), []);
      assert.deepEqual(await rows("SELECT * FROM core_suppression_facts"), []);
      assert.deepEqual(await rows("SELECT * FROM core_fact_digests"), []);
    }
  });
}

test("Postgres writes the single digest of an exact text fact", migrationDbTest, async (t) => {
  const { pool, source } = await migrationDatabase(t);
  const rows = keepConnections(pool);
  const { run } = createPostgresUnitOfWork(source);
  const store = createPostgresSuppressionStore();
  const [sha] = text.text.digests;
  const single = { ...base, kind: "text", mode: "exact", text: { digests: [sha] } };
  const hash = await incarnation(single);
  await rows("INSERT INTO users (id) VALUES ($1)", [owner]);

  const { factId } = await run(owner, {}, (tx) => store.writeFact(tx, single, hash));
  assert.deepEqual(await rows("SELECT user_id, fact_id, alg, value, pipeline, redaction_version, key_id FROM core_fact_digests"),
    [{ user_id: owner, fact_id: factId, alg: sha.alg, value: sha.value, pipeline: sha.pipeline,
      redaction_version: sha.redactionVersion, key_id: sha.keyId }]);
});
