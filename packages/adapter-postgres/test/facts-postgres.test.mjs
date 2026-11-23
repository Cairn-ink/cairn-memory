import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CoreError, factBody } from "../../core/src/index.mjs";
import { buildFactStorage, slotHash } from "../src/facts.mjs";
import { applyMigrations, factSlot } from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";
import { readCatalog } from "./catalog.mjs";

const factsTables = ["core_owner_state", "core_suppression_facts", "core_fact_digests"];
const readFactsCatalog = (connection) => readCatalog(connection, factsTables, { includeDefaults: true });
const ledger = "SELECT id, applied_at::text FROM core_schema_migrations ORDER BY id";
const digest = { alg: "sha256", value: "f".repeat(64), pipeline: "core", keyId: null, redactionVersion: 1 };
const exact = {
  owner: "owner", actionId: "action", origin: "edit", kind: "text", mode: "exact",
  text: { digests: [digest], embedding: [1, 2], shingles: ["abcd"], keyId: "shingle-key" },
  sourceMemory: { id: "memory", createdAtMs: 0 },
};

// A failed pool.query destroys its connection, and the closing socket can still be open when
// teardown force-drops the database; the late termination error then has no listener. These
// tests expect SQL errors, so every query runs on a checked-out connection that is returned
// normally (a statement error leaves an autocommit connection usable).
function keepConnections(pool) {
  return {
    async query(sql, values) {
      const client = await pool.connect();
      try {
        return await client.query(sql, values);
      } finally {
        client.release();
      }
    },
    connect: () => pool.connect(),
  };
}

async function insertFact(pool, candidate, { id, epoch, legacyRef = null }) {
  const fact = await buildFactStorage(candidate);
  const inserted = await pool.query(`
    INSERT INTO core_suppression_facts (
      user_id, fact_id, slot, slot_hash, incarnation, action_id, epoch, origin, kind,
      mode, body, embedding, shingles, key_id, legacy_ref
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    RETURNING body, embedding, shingles, key_id, created_at
  `, [
    fact.owner, id, fact.slot, fact.slotHash, "0".repeat(64), fact.actionId, epoch, fact.origin, fact.kind,
    fact.mode, fact.body, fact.embedding, fact.shingles, fact.keyId, legacyRef,
  ]);
  for (const digest of fact.digests) await insertDigest(pool, fact.owner, id, digest);
  return inserted;
}

function insertDigest(pool, owner, factId, candidate) {
  return pool.query(`
    INSERT INTO core_fact_digests (user_id, fact_id, alg, value, pipeline, redaction_version, key_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [
    owner, factId, candidate.alg, candidate.value, candidate.pipeline, candidate.redactionVersion, candidate.keyId,
  ]);
}

async function captureInsert(candidate) {
  const parameters = [];
  const pool = { query: (_sql, values) => parameters.push(values) };
  await insertFact(pool, candidate, { id: "fact", epoch: 1 });
  return parameters;
}

test("fact insert snapshots text before a later read can expose plaintext", async () => {
  let reads = 0;
  const candidate = new Proxy(exact, {
    get(target, key, receiver) {
      if (key === "text" && ++reads > 1) return { ...exact.text, plaintext: "example" };
      return Reflect.get(target, key, receiver);
    },
  });
  const parameters = await captureInsert(candidate);
  assert.doesNotMatch(JSON.stringify(parameters), /plaintext/u);
  assert.deepEqual(parameters, await captureInsert(exact));
});

test("fact insert and slot snapshot a session ID before a later read can expose a lone surrogate", async () => {
  const session = {
    owner: "owner", actionId: "action", origin: "forget", kind: "session",
    session: { client: "client", sessionId: "session" },
  };
  function candidate() {
    let reads = 0;
    return { ...session, session: new Proxy(session.session, {
      get(target, key, receiver) {
        if (key === "sessionId" && ++reads > 1) return "\uD800";
        return Reflect.get(target, key, receiver);
      },
    }) };
  }
  const parameters = await captureInsert(candidate());
  assert.doesNotMatch(JSON.stringify(parameters), /\\ud800/iu);
  assert.deepEqual(parameters, await captureInsert(session));
  assert.equal(factSlot(candidate()), factSlot(session));
});

test("slot and insert read each caller field and array element once", async () => {
  const full = {
    ...exact, mode: "full", namespace: null,
    text: { ...exact.text, embedding: null, digests: [digest, { ...digest, value: "a".repeat(64) }] },
  };
  for (const derive of [factSlot, captureInsert]) {
    const reads = {};
    const expected = {};
    function countReads(value, path) {
      if (value === null || typeof value !== "object") return value;
      const target = Array.isArray(value) ? [] : {};
      for (const key of Object.keys(value)) target[key] = countReads(value[key], `${path}.${key}`);
      for (const key of Object.getOwnPropertyNames(target)) expected[`${path}.${key}`] = 1;
      // A field counts as read by either a get or a property-descriptor lookup.
      const count = (key) => {
        const field = `${path}.${String(key)}`;
        reads[field] = (reads[field] ?? 0) + 1;
      };
      return new Proxy(target, {
        get(object, key, receiver) {
          count(key);
          return Reflect.get(object, key, receiver);
        },
        getOwnPropertyDescriptor(object, key) {
          count(key);
          return Reflect.getOwnPropertyDescriptor(object, key);
        },
      });
    }
    assert.deepEqual(await derive(countReads(full, "fact")), await derive(full));
    assert.deepEqual(reads, expected);
  }
  const [, ...digests] = await captureInsert(full);
  assert.deepEqual(digests, full.text.digests.map(({ alg, value, pipeline, redactionVersion, keyId }) => [
    "owner", "fact", alg, value, pipeline, redactionVersion, keyId,
  ]));
});

test("suppression migrations upgrade the existing prefix and match the structural snapshot", migrationDbTest, async (t) => {
  const { pool: database, source, migrations } = await migrationDatabase(t, { migrate: false });
  const pool = keepConnections(database);
  const expected = (await readFile(new URL("./fixtures/suppression-catalog.tsv", import.meta.url), "utf8"))
    .trimEnd().split("\n");
  const prefix = migrations.slice(0, 4);
  await applyMigrations(source, prefix);
  const previous = (await pool.query(ledger)).rows;
  assert.deepEqual(previous.map(({ id }) => id), prefix.map(({ id }) => id));
  assert.deepEqual(await readFactsCatalog(pool), []);

  await applyMigrations(source, migrations);
  const applied = (await pool.query(ledger)).rows;
  assert.deepEqual(applied.slice(0, prefix.length), previous);
  assert.deepEqual(applied.map(({ id }) => id), migrations.map(({ id }) => id));
  assert.deepEqual(await readFactsCatalog(pool), expected);
  await applyMigrations(source, migrations);
  assert.deepEqual((await pool.query(ledger)).rows, applied);
  assert.deepEqual(await readFactsCatalog(pool), expected);

  const connection = await pool.connect();
  try {
    for (const drop of [
      "DROP INDEX core_fact_digests_user_value_idx",
      "ALTER TABLE core_owner_state DROP COLUMN legacy_facts_ready",
    ]) {
      await connection.query("BEGIN");
      try {
        await connection.query(drop);
        await assert.rejects(async () => assert.deepEqual(await readFactsCatalog(connection), expected), {
          code: "ERR_ASSERTION",
        });
      } finally {
        await connection.query("ROLLBACK");
      }
    }
  } finally {
    connection.release();
  }
});

test("the suppression catalog snapshot detects a change to the created_at default", migrationDbTest, async (t) => {
  const pool = keepConnections((await migrationDatabase(t)).pool);
  const before = await readFactsCatalog(pool);
  await pool.query("ALTER TABLE core_suppression_facts ALTER COLUMN created_at SET DEFAULT now()");
  assert.notDeepEqual(await readFactsCatalog(pool), before);
});

test("fact storage enforces owner, slot, epoch, legacy reference, and digest constraints", migrationDbTest, async (t) => {
  const pool = keepConnections((await migrationDatabase(t)).pool);
  await pool.query("INSERT INTO users (id) VALUES ('owner'), ('other-owner')");
  const { rows: [state] } = await pool.query("INSERT INTO core_owner_state (user_id) VALUES ('owner') RETURNING *");
  assert.deepEqual(state, { user_id: "owner", fact_epoch: "0", index_revision: "0",
    legacy_facts_ready: false, legacy_writes_reconciled: false });
  for (const counter of ["fact_epoch", "index_revision"]) {
    await assert.rejects(pool.query(`UPDATE core_owner_state SET ${counter} = -1`), { code: "23514" });
  }

  const { rows: [stored] } = await insertFact(pool, exact, { id: "fact", epoch: 1, legacyRef: "legacy" });
  assert.deepEqual(stored.body, JSON.parse(factBody(exact)));
  assert.deepEqual(stored.body.text.embedding, [1, 2]);
  assert.deepEqual(stored.body.text.shingles, ["abcd"]);
  assert.equal(stored.embedding, null);
  assert.equal(stored.shingles, null);
  assert.equal(stored.key_id, null);
  assert.ok(Number.isFinite(stored.created_at.getTime()));

  await assert.rejects(insertFact(pool, exact, { id: "repeat-slot", epoch: 2 }), {
    code: "23505", constraint: "core_suppression_facts_user_id_slot_hash_key",
  });
  const identity = { owner: "owner", kind: "identity", origin: "forget", actionId: "another", memoryId: "memory" };
  await assert.rejects(insertFact(pool, identity, { id: "repeat-epoch", epoch: 1 }), {
    code: "23505", constraint: "core_suppression_facts_user_id_epoch_key",
  });
  await assert.rejects(insertFact(pool, identity, { id: "repeat-legacy", epoch: 2, legacyRef: "legacy" }), {
    code: "23505", constraint: "core_suppression_facts_legacy_ref_uidx",
  });
  const other = { ...exact, owner: "other-owner" };
  await insertFact(pool, other, { id: "other-fact", epoch: 1, legacyRef: "legacy" });

  await assert.rejects(insertDigest(pool, "other-owner", "fact", digest), { code: "23503" });
  await assert.rejects(insertDigest(pool, "owner", "fact", { ...digest, alg: "hmac" }), {
    code: "23514", constraint: "core_fact_digests_key_check",
  });
  await assert.rejects(insertDigest(pool, "owner", "fact", { ...digest, keyId: "unexpected" }), {
    code: "23514", constraint: "core_fact_digests_key_check",
  });
  await insertDigest(pool, "owner", "fact", { ...digest, alg: "hmac", keyId: "digest-key" });

  const full = { ...exact, mode: "full", text: { ...exact.text, embedding: [0.123456789, ...Array(1535).fill(0)] } };
  const withoutKey = { ...full, text: { ...full.text, keyId: null } };
  const noSql = { query: () => assert.fail("storage preflight must finish before SQL") };
  await assert.rejects(insertFact(noSql, withoutKey, { id: "full", epoch: 2 }), {
    name: CoreError.name, code: "invalid_input",
  });
  const { rows: [fullRow] } = await insertFact(pool, full, { id: "full", epoch: 2 });
  assert.deepEqual(JSON.parse(fullRow.embedding).map(Math.fround), full.text.embedding.map(Math.fround));
  assert.deepEqual(fullRow.body.text.embedding, full.text.embedding);
  assert.deepEqual(fullRow.shingles, full.text.shingles);
  assert.equal(fullRow.key_id, full.text.keyId);

  await pool.query("DELETE FROM users WHERE id = 'owner'");
  for (const table of factsTables) {
    assert.equal((await pool.query(`SELECT 1 FROM ${table} WHERE user_id = 'owner'`)).rowCount, 0);
  }
  assert.equal((await pool.query("SELECT 1 FROM core_fact_digests WHERE user_id = 'other-owner'")).rowCount, 1);
});

test("the shingle key CHECK rejects a raw SQL write that bypasses storage preflight", migrationDbTest, async (t) => {
  const pool = keepConnections((await migrationDatabase(t)).pool);
  await pool.query("INSERT INTO users (id) VALUES ('owner')");
  const full = { ...exact, mode: "full", text: { ...exact.text, embedding: null } };
  await insertFact(pool, full, { id: "fact", epoch: 1 });
  await assert.rejects(pool.query("UPDATE core_suppression_facts SET key_id = NULL WHERE fact_id = 'fact'"), {
    code: "23514", constraint: "core_suppression_facts_shingle_key_check",
  });
});

test("legacy references accept 256 UTF-8 bytes and reject 257", migrationDbTest, async (t) => {
  const pool = keepConnections((await migrationDatabase(t)).pool);
  await pool.query("INSERT INTO users (id) VALUES ('owner')");
  const atLimit = "界".repeat(85) + "a";
  const overLimit = atLimit + "b";
  assert.equal(Buffer.byteLength(atLimit), 256);
  assert.equal(Buffer.byteLength(overLimit), 257);
  await assert.rejects(insertFact(pool, exact, { id: "fact", epoch: 1, legacyRef: overLimit }), {
    code: "23514", constraint: "core_suppression_facts_legacy_ref_check",
  });
  await insertFact(pool, exact, { id: "fact", epoch: 1, legacyRef: atLimit });
});

test("a slot for maximum multibyte hosted session identifiers inserts and still conflicts on replay", migrationDbTest, async (t) => {
  const pool = keepConnections((await migrationDatabase(t)).pool);
  // Vary the three-byte characters so index compression cannot mask the old size failure.
  const identifier = (first, length) => Array.from({ length }, (_, i) => (
    String.fromCodePoint(first + i * 64 + i % 64)
  )).join("");
  const owner = identifier(0x0800, 512);
  const fact = {
    owner, actionId: "action", origin: "forget", kind: "session",
    session: { client: identifier(0x9000, 128), sessionId: identifier(0x5000, 512) },
  };
  await pool.query("INSERT INTO users (id) VALUES ($1)", [owner]);
  await insertFact(pool, fact, { id: "fact", epoch: 1 });
  const slot = factSlot(fact);
  assert.ok(Buffer.byteLength(owner) + Buffer.byteLength(slot) > 2704);
  assert.deepEqual((await pool.query("SELECT slot, slot_hash FROM core_suppression_facts")).rows, [
    { slot, slot_hash: await slotHash(slot) },
  ]);
  await assert.rejects(insertFact(pool, fact, { id: "repeat-slot", epoch: 2 }), {
    code: "23505", constraint: "core_suppression_facts_user_id_slot_hash_key",
  });
});
