import assert from "node:assert/strict";
import test from "node:test";
import { CoreError } from "../../core/src/index.mjs";
import { buildFactStorage } from "../src/facts.mjs";
import { createPostgresSuppressionStore, createPostgresUnitOfWork } from "../src/index.mjs";

const owner = "owner";
const incarnation = "a".repeat(64);
const identity = { owner, actionId: "action", origin: "forget", kind: "identity", memoryId: "memory" };
const sha = { alg: "sha256", value: "b".repeat(64), pipeline: "core", redactionVersion: 2, keyId: null };
const hmac = { alg: "hmac", value: "c".repeat(64), pipeline: "hosted-v1", redactionVersion: 1, keyId: "key" };
const text = { owner, actionId: "action", origin: "edit", kind: "text", mode: "exact", text: { digests: [sha, hmac] } };
const store = createPostgresSuppressionStore();
const timeUs = "trunc(EXTRACT(EPOCH FROM created_at) * 1000000)::text AS created_at_us";
const selectSlot = `SELECT fact_id, slot, incarnation, epoch::text, ${timeUs} FROM core_suppression_facts WHERE user_id = $1 AND slot_hash = $2`;
const advance = "INSERT INTO core_owner_state (user_id, fact_epoch, index_revision) VALUES ($1, 1, 1) ON CONFLICT (user_id) DO UPDATE SET fact_epoch = core_owner_state.fact_epoch + 1, index_revision = core_owner_state.index_revision + 1 RETURNING fact_epoch::text, index_revision::text";
const insert = `INSERT INTO core_suppression_facts ( user_id, fact_id, slot, slot_hash, incarnation, action_id, epoch, origin, kind, mode, body, embedding, shingles, key_id ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING ${timeUs}`;
const digests = "INSERT INTO core_fact_digests (user_id, fact_id, alg, value, pipeline, redaction_version, key_id) SELECT $1, $2, * FROM unnest($3::text[], $4::text[], $5::text[], $6::integer[], $7::text[])";
const selectEpoch = "SELECT fact_epoch::text FROM core_owner_state WHERE user_id = $1";
const code = (code) => ({ name: "CoreError", message: code, code });

function stub(...replies) {
  return controlledStub(() => replies.shift());
}

function controlledStub(reply) {
  const calls = [];
  const lifecycle = [];
  const uow = createPostgresUnitOfWork({ async connect() {
    return { async query(sql, values) {
      const command = sql.split(" ", 1)[0];
      if (values && !sql.startsWith("SELECT pg_advisory_")) {
        const statement = sql.replace(/\s+/gu, " ");
        calls.push([statement, values]);
        const rows = await reply(statement, values);
        if (rows instanceof Error) throw rows;
        return { command, rows: rows ?? [] };
      }
      lifecycle.push(sql);
      return { command, rows: [] };
    }, release() {} };
  } });
  return { run: uow.run, calls, lifecycle };
}

for (const fact of [identity, text]) {
  test(`new ${fact.kind} binds the storage snapshot and runs the exact statement sequence`, async () => {
    const db = stub([], [{ fact_epoch: "9007199254740993", index_revision: "9007199254740993" }], [{ created_at_us: "1234999" }]);
    let ownerReads = 0;
    const candidate = new Proxy(fact, { get(target, key) {
      assert.equal(key, "owner");
      return ++ownerReads === 1 ? target.owner : "other";
    } });
    const result = await db.run(owner, {}, (tx) => store.writeFact(tx, candidate, incarnation));
    const { factId } = result;
    assert.match(factId, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u);
    assert.deepEqual(result, { factId, epoch: 9007199254740993n, createdAtMs: 1234, created: true });
    const s = await buildFactStorage(fact);
    const expected = [[selectSlot, [owner, s.slotHash]], [advance, [owner]], [insert, [owner, factId,
      s.slot, s.slotHash, incarnation, s.actionId, "9007199254740993", s.origin, s.kind, s.mode, s.body, null, null, null]]];
    if (fact.kind === "text") expected.push([digests, [owner, factId, [hmac.alg, sha.alg], [hmac.value, sha.value],
      [hmac.pipeline, sha.pipeline], [1, 2], ["key", null]]]);
    assert.deepEqual(db.calls, expected);
    assert.equal(ownerReads, 1);
    assert.ok(db.lifecycle.includes("COMMIT"));
  });
}

const storage = await buildFactStorage(identity);
const existing = { fact_id: "original", slot: storage.slot, incarnation, epoch: "4", created_at_us: "-1001" };

for (const insertFails of [false, true]) {
  test(`drains an in-flight fact write after a caught validation error (insert ${insertFails ? "fails" : "succeeds"})`, async () => {
    const advanceStarted = Promise.withResolvers();
    const finishAdvance = Promise.withResolvers();
    const db = controlledStub((sql) => {
      if (sql === selectSlot) return [];
      if (sql === advance) {
        advanceStarted.resolve();
        return finishAdvance.promise;
      }
      assert.equal(sql, insert);
      return insertFails ? Object.assign(new Error(), { code: "40001" }) : [{ created_at_us: "1234999" }];
    });

    let write;
    const run = db.run(owner, {}, async (tx) => {
      write = store.writeFact(tx, identity, incarnation);
      void write.catch(() => {});
      await advanceStarted.promise;
      await assert.rejects(store.writeFact(tx, identity, "bad"), code("invalid_input"));
    });
    const outcome = insertFails ? assert.rejects(run, code("storage_busy")) : run;
    try {
      await advanceStarted.promise;
      await new Promise(setImmediate);
      assert.deepEqual(db.calls.map(([sql]) => sql), [selectSlot, advance]);
      assert.ok(!db.lifecycle.includes("COMMIT"));
    } finally {
      finishAdvance.resolve([{ fact_epoch: "1", index_revision: "1" }]);
      await outcome;
    }

    assert.deepEqual(db.calls.map(([sql]) => sql), [selectSlot, advance, insert]);
    if (insertFails) {
      await assert.rejects(write, code("storage_busy"));
      assert.equal(db.lifecycle.at(-1), "ROLLBACK");
      assert.ok(!db.lifecycle.includes("COMMIT"));
    } else {
      assert.equal((await write).epoch, 1n);
      assert.ok(db.lifecycle.includes("COMMIT"));
    }
  });
}

for (const sameIncarnation of [true, false]) {
  test(`parallel writes to a new slot ${sameIncarnation ? "replay" : "conflict"} in the same transaction`, async (t) => {
    // Complete both slot hashes in the same turn so the race has a deterministic starting point.
    t.mock.method(crypto.subtle, "digest", async () => new ArrayBuffer(32));
    let row;
    let epoch = 0n;
    const db = controlledStub((sql, values) => {
      if (sql === selectSlot) return row ? [row] : [];
      if (sql === advance) return [{ fact_epoch: String(++epoch), index_revision: "1" }];
      assert.equal(sql, insert);
      if (row) return Object.assign(new Error(), { code: "23505" });
      row = { fact_id: values[1], slot: values[2], incarnation: values[4], epoch: values[6], created_at_us: "1234999" };
      return [row];
    });

    const writes = (tx) => Promise.all([
      store.writeFact(tx, identity, incarnation),
      store.writeFact(tx, identity, sameIncarnation ? incarnation : "b".repeat(64)),
    ]);
    if (sameIncarnation) {
      const attempts = await db.run(owner, {}, writes);
      const first = attempts.find((attempt) => attempt.created);
      assert.deepEqual(first, { factId: row.fact_id, epoch: 1n, createdAtMs: 1234, created: true });
      assert.deepEqual(attempts.find((attempt) => !attempt.created), { ...first, created: false });
      assert.ok(db.lifecycle.includes("COMMIT"));
    } else {
      await assert.rejects(db.run(owner, {}, (tx) => assert.rejects(writes(tx), code("fact_conflict"))), code("fact_conflict"));
      assert.equal(db.lifecycle.at(-1), "ROLLBACK");
      assert.ok(!db.lifecycle.includes("COMMIT"));
    }
    assert.equal(epoch, 1n);
    assert.deepEqual(db.calls.map(([sql]) => sql), [selectSlot, advance, insert, selectSlot]);
  });
}

test("replay only reads the slot and floors timestamps before the Unix epoch", async () => {
  const db = stub([existing]);
  assert.deepEqual(await db.run(owner, {}, (tx) => store.writeFact(tx, identity, incarnation)),
    { factId: "original", epoch: 4n, createdAtMs: -2, created: false });
  assert.deepEqual(db.calls, [[selectSlot, [owner, storage.slotHash]]]);
});

for (const [changes, error] of [
  [{ incarnation: "b".repeat(64) }, "fact_conflict"], [{ slot: "collision" }, "internal_error"],
  [{ incarnation: "bad" }, "internal_error"], [{ fact_id: null }, "internal_error"],
  [{ epoch: "0x4" }, "internal_error"], [{ created_at_us: "1.5" }, "internal_error"],
  [{ created_at_us: "9007199254740992000" }, "internal_error"],
]) {
  test(`caught slot error ${error} (${Object.keys(changes)}) prevents COMMIT`, async () => {
    const db = stub([{ ...existing, ...changes }]);
    await assert.rejects(db.run(owner, {}, (tx) => assert.rejects(store.writeFact(tx, identity, incarnation), code(error))), code(error));
    assert.deepEqual(db.calls, [[selectSlot, [owner, storage.slotHash]]]);
    assert.equal(db.lifecycle.at(-1), "ROLLBACK");
    assert.ok(!db.lifecycle.includes("COMMIT"));
  });
}

test("transaction guards precede SQL and validation, and caught input errors leave the run committable", async () => {
  const db = stub();
  const other = { ...identity, owner: "other" };
  const spoof = new Proxy(other, { get: (target, key) => key === "owner" ? owner : Reflect.get(target, key) });
  const dead = await db.run(owner, {}, async (tx) => tx);
  for (const readOnly of [false, true]) await db.run(owner, { readOnly }, async (tx) => {
    for (const invalid of [dead, { ...tx }]) {
      await assert.rejects(store.writeFact(invalid, identity, "bad"), code("internal_error"));
      await assert.rejects(store.epoch(invalid, owner), code("internal_error"));
    }
    await assert.rejects(store.writeFact(tx, other, "bad"), code("internal_error"));
    await assert.rejects(store.epoch(tx, other.owner), code("internal_error"));
    if (readOnly) await assert.rejects(store.writeFact(tx, identity, incarnation), code("internal_error"));
    else {
      await assert.rejects(store.writeFact(tx, spoof, incarnation), code("internal_error"));
      for (const hash of ["a".repeat(63), "A".repeat(64), `${incarnation}\n`, 1]) {
        await assert.rejects(store.writeFact(tx, identity, hash), code("invalid_input"));
      }
      await assert.rejects(store.writeFact(tx, { ...identity, memoryId: "" }, incarnation), code("invalid_input"));
      const badWindow = { owner, actionId: "a", origin: "forget", kind: "window", client: null, window: { startMs: 2, endMs: 1 } };
      await assert.rejects(store.writeFact(tx, badWindow, incarnation), code("invalid_input"));
    }
  }).finally(() => assert.deepEqual(db.calls, []));
  assert.equal(db.lifecycle.filter((sql) => sql === "COMMIT").length, 3);
});

test("epoch reads in a read-only run and maps absent, zero and int8 text", async () => {
  const db = stub([], [{ fact_epoch: "0" }], [{ fact_epoch: "9223372036854775807" }], [{ fact_epoch: 1 }]);
  for (const value of [null, null, 9223372036854775807n]) {
    assert.equal(await db.run(owner, { readOnly: true }, (tx) => store.epoch(tx, owner)), value);
  }
  await assert.rejects(db.run(owner, { readOnly: true }, async (tx) => {
    await assert.rejects(store.epoch(tx, owner), code("internal_error"));
  }), code("internal_error"));
  assert.deepEqual(db.calls, Array.from({ length: 4 }, () => [selectEpoch, [owner]]));
  assert.equal(db.lifecycle.at(-1), "ROLLBACK");
});

test("a native unique violation is mapped and remains sticky when caught", async () => {
  const db = stub([], [{ fact_epoch: "1", index_revision: "1" }], Object.assign(new Error(), { code: "23505" }));
  await assert.rejects(db.run(owner, {}, async (tx) => {
    await assert.rejects(store.writeFact(tx, identity, incarnation), CoreError);
  }), code("internal_error"));
  assert.equal(db.lifecycle.at(-1), "ROLLBACK");
});

for (const replies of [[[], [{ fact_epoch: "-1", index_revision: "1" }]], [[], [{ fact_epoch: "1", index_revision: "1" }], [{ created_at_us: null }]]]) {
  test(`malformed new fact output at statement ${replies.length} aborts the run`, async () => {
    const db = stub(...replies);
    await assert.rejects(db.run(owner, {}, (tx) => assert.rejects(store.writeFact(tx, identity, incarnation), code("internal_error"))),
      code("internal_error"));
    assert.equal(db.lifecycle.at(-1), "ROLLBACK");
  });
}
