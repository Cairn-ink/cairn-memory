import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CoreError, factBody, validateSuppressionFact } from "../../core/src/index.mjs";
import { assertStorableFact, slotHash } from "../src/facts.mjs";
import { applyMigrations, factSlot } from "../src/index.mjs";
import { migrationDatabase, migrationDbTest, readCatalog } from "./migration-database.mjs";

const factsTables = ["core_owner_state", "core_suppression_facts", "core_fact_digests"];
const readFactsCatalog = (connection) => readCatalog(connection, factsTables, { includeDefaults: true });
const ledger = "SELECT id, applied_at::text FROM core_schema_migrations ORDER BY id";
const digest = { alg: "sha256", value: "f".repeat(64), pipeline: "core", keyId: null, redactionVersion: 1 };
const exact = {
  owner: "owner", actionId: "action", origin: "edit", kind: "text", mode: "exact",
  text: { digests: [digest], embedding: [1, 2], shingles: ["abcd"], keyId: "shingle-key" },
  sourceMemory: { id: "memory", createdAtMs: 0 },
};

async function insertFact(pool, candidate, { id, epoch, legacyRef = null }) {
  const fact = validateSuppressionFact(candidate);
  assertStorableFact(fact);
  const slot = factSlot(fact);
  const mode = fact.kind === "text" ? fact.mode : null;
  const lookup = fact.kind === "text" && fact.mode === "full" ? fact.text : null;
  return pool.query(`
    INSERT INTO core_suppression_facts (
      user_id, fact_id, slot, slot_hash, incarnation, action_id, epoch, origin, kind,
      mode, body, embedding, shingles, key_id, legacy_ref
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    RETURNING body, embedding, shingles, key_id, created_at
  `, [
    fact.owner, id, slot, await slotHash(slot), "0".repeat(64), fact.actionId, epoch, fact.origin, fact.kind,
    mode, factBody(fact), lookup?.embedding == null ? null : JSON.stringify(lookup.embedding),
    lookup?.shingles?.length ? lookup.shingles : null, lookup?.keyId ?? null, legacyRef,
  ]);
}

function insertDigest(pool, owner, factId, candidate) {
  return pool.query(`
    INSERT INTO core_fact_digests (user_id, fact_id, alg, value, pipeline, redaction_version, key_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [
    owner, factId, candidate.alg, candidate.value, candidate.pipeline, candidate.redactionVersion, candidate.keyId,
  ]);
}

test("suppression migrations upgrade the existing prefix and match the structural snapshot", migrationDbTest, async (t) => {
  const { pool, source, migrations } = await migrationDatabase(t, { migrate: false });
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
  const { pool } = await migrationDatabase(t);
  const before = await readFactsCatalog(pool);
  await pool.query("ALTER TABLE core_suppression_facts ALTER COLUMN created_at SET DEFAULT now()");
  assert.notDeepEqual(await readFactsCatalog(pool), before);
});

test("fact storage enforces owner, slot, epoch, legacy reference, and digest constraints", migrationDbTest, async (t) => {
  const { pool } = await migrationDatabase(t);
  await pool.query("INSERT INTO users (id) VALUES ('owner'), ('other-owner')");
  const { rows: [state] } = await pool.query("INSERT INTO core_owner_state (user_id) VALUES ('owner') RETURNING *");
  assert.deepEqual(state, { user_id: "owner", fact_epoch: "0", index_revision: "0", legacy_facts_ready: false });
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
  await insertDigest(pool, "owner", "fact", digest);
  await insertDigest(pool, "owner", "fact", { ...digest, alg: "hmac", keyId: "digest-key" });
  await insertDigest(pool, "other-owner", "other-fact", digest);

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
  const { pool } = await migrationDatabase(t);
  await pool.query("INSERT INTO users (id) VALUES ('owner')");
  const full = { ...exact, mode: "full", text: { ...exact.text, embedding: null } };
  await insertFact(pool, full, { id: "fact", epoch: 1 });
  await assert.rejects(pool.query("UPDATE core_suppression_facts SET key_id = NULL WHERE fact_id = 'fact'"), {
    code: "23514", constraint: "core_suppression_facts_shingle_key_check",
  });
});

test("legacy references accept 256 UTF-8 bytes and reject 257", migrationDbTest, async (t) => {
  const { pool } = await migrationDatabase(t);
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
  const { pool } = await migrationDatabase(t);
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
  const slot = factSlot(validateSuppressionFact(fact));
  assert.ok(Buffer.byteLength(owner) + Buffer.byteLength(slot) > 2704);
  assert.deepEqual((await pool.query("SELECT slot, slot_hash FROM core_suppression_facts")).rows, [
    { slot, slot_hash: await slotHash(slot) },
  ]);
  await assert.rejects(insertFact(pool, fact, { id: "repeat-slot", epoch: 2 }), {
    code: "23505", constraint: "core_suppression_facts_user_id_slot_hash_key",
  });
});
