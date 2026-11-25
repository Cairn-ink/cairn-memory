import assert from "node:assert/strict";
import test from "node:test";
import {
  coreDigest, fingerprintLegacyCapture, hostedV1Digest, legacyExactMac, PRIVACY_REDACTION_VERSIONS, userFingerprintKey,
} from "../../core/src/index.mjs";
import {
  createPostgresDigestGate, createPostgresFingerprintKeyProvider, createPostgresUnitOfWork, HOSTED_FINGERPRINT_LABELS,
} from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const owner = "publication-owner";
const suppressedText = "Keep the archive folder on the top shelf";
const vector = JSON.stringify([1, ...Array(1535).fill(0)]);
const green = { incompleteRows: 0, missingPairs: 0 };
const mismatch = { code: "fingerprint_key_mismatch" };
const labels = HOSTED_FINGERPRINT_LABELS;
const redactionVersion = PRIVACY_REDACTION_VERSIONS.v1;

async function fixture(t, { ownerState = true } = {}) {
  const { pool, source } = await migrationDatabase(t);
  await pool.query("INSERT INTO users (id) VALUES ($1)", [owner]);
  if (ownerState) await pool.query("INSERT INTO core_owner_state (user_id, legacy_facts_ready) VALUES ($1, false)", [owner]);
  const uow = createPostgresUnitOfWork(source);
  const secret = "publication-secret";
  const otherSecret = "other-secret";
  const key = await userFingerprintKey(secret, owner, labels);
  const otherKey = await userFingerprintKey(otherSecret, owner, labels);
  const provider = createPostgresFingerprintKeyProvider(secret, { uow, stagedSecrets: [otherSecret] });
  const coverage = createPostgresDigestGate(uow, () => [key.id]);

  async function memory(id, { keys = [key], hosted = false } = {}) {
    const text = `visible memory ${id}`;
    const { value } = await hostedV1Digest(text);
    const digests = await Promise.all(keys.map(digestKey => coreDigest(text, digestKey)));
    if (hosted) digests.push({ alg: "hmac", label: "hosted-v1", pipeline: "hosted-v1", keyId: key.id,
      redactionVersion, value: await legacyExactMac(text, key, labels) });
    await pool.query(`INSERT INTO memories (id, user_id, text, text_hash, kind, embedding, embedding_model, source_kind, core_digests)
      VALUES ($1, $2, $3, $4, 'fact', $5, 'test', 'mcp', $6::jsonb)`, [id, owner, text, value, vector, JSON.stringify(digests)]);
  }

  async function suppression({ evidenceKey, mac = null, shingles = null, sha = true } = {}) {
    const hash = sha ? (await hostedV1Digest(suppressedText)).value : `hmac:${mac}`;
    await pool.query(`INSERT INTO suppressions
      (id, user_id, kind, text_hash, text_hmac, key_id, shingles, embedding, redaction_version)
      VALUES ('pending-text', $1, 'text', $2, $3, $4, $5, $6, $7)`,
    [owner, hash, mac, evidenceKey?.id ?? null, shingles, vector, redactionVersion]);
  }

  async function pointer() {
    const { rows } = await pool.query("SELECT fingerprint_key_id FROM core_owner_state WHERE user_id = $1", [owner]);
    return rows.map(row => row.fingerprint_key_id);
  }

  return { key, otherKey, provider, memory, suppression, pointer, coverage: () => coverage(owner) };
}

for (const ownerState of [true, false]) {
  const initialState = ownerState ? "a null pointer" : "no owner state row";
  const initialPointer = ownerState ? [null] : [];

  test(`Postgres first publication accepts a pending MAC alongside SHA with ${initialState}`, migrationDbTest, async (t) => {
    const { key, provider, memory, suppression, pointer, coverage } = await fixture(t, { ownerState });
    await memory("covered");
    await suppression({ evidenceKey: key, mac: await legacyExactMac(suppressedText, key, labels) });
    assert.deepEqual(await coverage(), green);
    assert.deepEqual(await pointer(), initialPointer);
    await provider.publish(owner, key.id);
    assert.deepEqual(await pointer(), [key.id]);
  });

  test(`Postgres first publication rejects a pending MAC under another key with ${initialState}`, migrationDbTest, async (t) => {
    const { key, otherKey, provider, memory, suppression, pointer, coverage } = await fixture(t, { ownerState });
    await memory("covered");
    await suppression({ evidenceKey: otherKey, mac: await legacyExactMac(suppressedText, otherKey, labels) });
    assert.deepEqual(await coverage(), green);
    assert.deepEqual(await pointer(), initialPointer);
    await assert.rejects(provider.publish(owner, key.id), mismatch);
    assert.deepEqual(await pointer(), initialPointer);
  });
}

test("Postgres first publication accepts pending keyed shingles alongside SHA", migrationDbTest, async (t) => {
  const { key, provider, memory, suppression, pointer, coverage } = await fixture(t);
  const { shingles } = await fingerprintLegacyCapture(suppressedText, key, labels);
  assert.ok(shingles.length > 0);
  await memory("covered");
  await suppression({ evidenceKey: key, shingles });
  assert.deepEqual(await coverage(), green);
  assert.deepEqual(await pointer(), [null]);
  await provider.publish(owner, key.id);
  assert.deepEqual(await pointer(), [key.id]);
});

for (const complete of [true, false]) {
  const outcome = complete ? "accepts complete" : "rejects incomplete";
  test(`Postgres first publication ${outcome} coverage for a pending HMAC-only fact`, migrationDbTest, async (t) => {
    const { key, provider, memory, suppression, pointer, coverage } = await fixture(t);
    await memory("first", { hosted: true });
    await memory("second", { hosted: complete });
    await suppression({ evidenceKey: key, mac: await legacyExactMac(suppressedText, key, labels), sha: false });
    assert.deepEqual(await pointer(), [null]);
    if (complete) {
      assert.deepEqual(await coverage(), green);
      await provider.publish(owner, key.id);
      assert.deepEqual(await pointer(), [key.id]);
    } else {
      assert.deepEqual(await coverage(), { incompleteRows: 1, missingPairs: 1 });
      await assert.rejects(provider.publish(owner, key.id), mismatch);
      assert.deepEqual(await pointer(), [null]);
    }
  });
}

test("Postgres rotation rejects pending evidence keyed to the incoming key", migrationDbTest, async (t) => {
  const { key, otherKey, provider, memory, suppression, pointer, coverage } = await fixture(t);
  await memory("covered", { keys: [key, otherKey] });
  await provider.publish(owner, otherKey.id);
  await suppression({ evidenceKey: key, mac: await legacyExactMac(suppressedText, key, labels) });
  assert.deepEqual(await coverage(), green);
  assert.deepEqual(await pointer(), [otherKey.id]);
  await assert.rejects(provider.publish(owner, key.id), mismatch);
  assert.deepEqual(await pointer(), [otherKey.id]);
});

test("Postgres first publication accepts a pending SHA-only fact with core coverage", migrationDbTest, async (t) => {
  const { key, provider, memory, suppression, pointer, coverage } = await fixture(t);
  await memory("covered");
  await suppression();
  assert.deepEqual(await coverage(), green);
  assert.deepEqual(await pointer(), [null]);
  await provider.publish(owner, key.id);
  assert.deepEqual(await pointer(), [key.id]);
});
