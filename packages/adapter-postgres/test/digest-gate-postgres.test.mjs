import assert from "node:assert/strict";
import test from "node:test";
import {
  coreDigest, fingerprintLegacyCapture, hostedV1Digest, legacyExactMac, PRIVACY_REDACTION_VERSIONS, userFingerprintKey,
} from "../../core/src/index.mjs";
import {
  createPostgresDigestGate, createPostgresFingerprintKeyProvider, createPostgresMemoryReads,
  createPostgresUnitOfWork, HOSTED_FINGERPRINT_LABELS,
} from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const owner = "pending-owner";
const memoryText = "visible memory";
const suppressedText = "suppressed memory";
const vector = JSON.stringify([1, ...Array(1535).fill(0)]);
const green = { incompleteRows: 0, missingPairs: 0 };
const deriveKey = secret => userFingerprintKey(secret, owner, HOSTED_FINGERPRINT_LABELS);

async function insertLegacyMemory(pool, id, text) {
  const { value } = await hostedV1Digest(text);
  await pool.query(`INSERT INTO memories (id, user_id, text, text_hash, kind, embedding, embedding_model, source_kind)
    VALUES ($1, $2, $3, $4, 'fact', $5, 'test', 'mcp')`, [id, owner, text, value, vector]);
}

async function fixture(t) {
  const { pool, source } = await migrationDatabase(t);
  await pool.query("INSERT INTO users (id) VALUES ($1)", [owner]);
  await pool.query("INSERT INTO core_owner_state (user_id, legacy_facts_ready) VALUES ($1, false)", [owner]);
  await insertLegacyMemory(pool, "visible", memoryText);
  const uow = createPostgresUnitOfWork(source);
  const stage = (digests) => pool.query("UPDATE memories SET core_digests = $2::jsonb WHERE user_id = $1",
    [owner, JSON.stringify(digests)]);
  return { pool, source, uow, stage };
}

async function rotationFixture(t) {
  const db = await fixture(t);
  const secrets = ["first-secret", "second-secret", "third-secret"];
  const keys = await Promise.all(secrets.map(deriveKey));
  const coreDigests = await Promise.all(keys.map(key => coreDigest(memoryText, key)));
  const providerFor = uow => createPostgresFingerprintKeyProvider(secrets[0], { uow, stagedSecrets: secrets.slice(1) });
  return { ...db, keys, coreDigests, provider: providerFor(db.uow), providerFor };
}

test("Postgres publishes the current key with pending legacy facts and K1 coverage", migrationDbTest, async (t) => {
  const { pool, uow, stage } = await fixture(t);
  const secret = "current-secret";
  const key = await deriveKey(secret);
  const provider = createPostgresFingerprintKeyProvider(secret, { uow });
  const { value } = await hostedV1Digest(suppressedText);
  await pool.query(`INSERT INTO suppressions (id, user_id, kind, text_hash, embedding)
    VALUES ('pending-sha', $1, 'text', $2, $3)`, [owner, value, vector]);
  await stage([await coreDigest(memoryText, key)]);

  const coverage = createPostgresDigestGate(uow, () => [key.id]);
  assert.deepEqual(await coverage(owner), green);
  assert.equal(await provider.userKey(owner), null);
  await provider.publish(owner, key.id);
  assert.equal((await provider.userKey(owner)).id, key.id);
  const { rows: [state] } = await pool.query("SELECT legacy_facts_ready FROM core_owner_state WHERE user_id = $1", [owner]);
  assert.equal(state.legacy_facts_ready, false);

  const { recent } = createPostgresMemoryReads();
  const read = () => uow.run(owner, { readOnly: true }, tx =>
    recent.recent(tx, { owner, namespaces: [null] }, { cursor: null, limit: 10 }));
  await assert.rejects(read, { code: "ineligible" });
});

test("Postgres refuses to retire a key needed by a pending HMAC-only legacy fact", migrationDbTest, async (t) => {
  const { pool, uow, stage, keys: [first, second, third], coreDigests, provider } = await rotationFixture(t);
  const domain = { alg: "hmac", label: "hosted-v1", pipeline: "hosted-v1", keyId: first.id,
    redactionVersion: PRIVACY_REDACTION_VERSIONS.v1 };
  const hostedDigest = { ...domain, value: await legacyExactMac(memoryText, first, HOSTED_FINGERPRINT_LABELS) };
  await stage([...coreDigests, hostedDigest]);
  await provider.publish(owner, first.id);

  const mac = await legacyExactMac(suppressedText, first, HOSTED_FINGERPRINT_LABELS);
  await pool.query(`INSERT INTO suppressions (id, user_id, kind, text_hash, text_hmac, key_id, embedding, redaction_version)
    VALUES ('pending-hmac', $1, 'text', $2, $3, $4, $5, $6)`,
  [owner, `hmac:${mac}`, mac, first.id, vector, domain.redactionVersion]);

  // The second key can become current while the first remains available for matching.
  await provider.publish(owner, second.id);
  const coverage = createPostgresDigestGate(uow, () => [third.id]);
  assert.deepEqual(await coverage(owner), green);
  await assert.rejects(provider.publish(owner, third.id), { code: "fingerprint_key_mismatch" });
  assert.equal((await provider.userKey(owner)).id, second.id);

  await pool.query("DELETE FROM suppressions WHERE user_id = $1 AND id = 'pending-hmac'", [owner]);
  await provider.publish(owner, third.id);
  assert.equal((await provider.userKey(owner)).id, third.id);
});

for (const { evidence, ready } of [
  { evidence: "shingles", ready: false },
  { evidence: "shingles", ready: true },
  { evidence: "MAC", ready: false },
]) {
  test(`Postgres retains the key for ${ready ? "live" : "pending"} legacy ${evidence} alongside SHA`, migrationDbTest, async (t) => {
    const { pool, uow, stage, keys: [first, second, third], coreDigests, provider } = await rotationFixture(t);
    await stage(coreDigests);
    await provider.publish(owner, first.id);
    await pool.query("UPDATE core_owner_state SET legacy_facts_ready = $2 WHERE user_id = $1", [owner, ready]);

    const { value } = await hostedV1Digest(suppressedText);
    const { shingles } = evidence === "shingles"
      ? await fingerprintLegacyCapture(suppressedText, first, HOSTED_FINGERPRINT_LABELS) : { shingles: null };
    const mac = evidence === "MAC" ? await legacyExactMac(suppressedText, first, HOSTED_FINGERPRINT_LABELS) : null;
    await pool.query(`INSERT INTO suppressions
      (id, user_id, kind, text_hash, text_hmac, key_id, shingles, embedding, redaction_version)
      VALUES ('legacy-evidence', $1, 'text', $2, $3, $4, $5, $6, $7)`,
    [owner, value, mac, first.id, shingles, vector, PRIVACY_REDACTION_VERSIONS.v1]);

    await provider.publish(owner, second.id);
    await assert.doesNotReject(() => provider.publish(owner, second.id));
    assert.deepEqual(await createPostgresDigestGate(uow, () => [third.id])(owner), green);
    await assert.rejects(provider.publish(owner, third.id), { code: "fingerprint_key_mismatch" });
    assert.equal((await provider.userKey(owner)).id, second.id);
  });
}

test("Postgres rechecks digest coverage on a same-key publication retry", migrationDbTest, async (t) => {
  const { pool, uow, stage } = await fixture(t);
  const secret = "current-secret";
  const key = await deriveKey(secret);
  const provider = createPostgresFingerprintKeyProvider(secret, { uow });
  const coverage = createPostgresDigestGate(uow, () => [key.id]);
  await stage([await coreDigest(memoryText, key)]);
  assert.deepEqual(await coverage(owner), green);
  await provider.publish(owner, key.id);

  await insertLegacyMemory(pool, "unstaged", "legacy writer memory");
  assert.deepEqual(await coverage(owner), { incompleteRows: 1, missingPairs: 1 });
  await assert.rejects(provider.publish(owner, key.id), { code: "fingerprint_key_mismatch" });
  assert.equal((await provider.userKey(owner)).id, key.id);
});

test("Postgres refuses key publication at repeatable read isolation", migrationDbTest, async (t) => {
  const { source, stage, keys: [first, second], coreDigests, provider, providerFor } = await rotationFixture(t);
  await stage(coreDigests);
  await provider.publish(owner, first.id);
  const repeatableRead = createPostgresUnitOfWork({
    async connect() {
      const connection = await source.connect();
      try {
        await connection.query("SET default_transaction_isolation = 'repeatable read'");
        return connection;
      } catch (error) {
        await connection.release(true);
        throw error;
      }
    },
  });

  await assert.rejects(providerFor(repeatableRead).publish(owner, second.id), { code: "storage_error" });
  assert.equal((await provider.userKey(owner)).id, first.id);
  await provider.publish(owner, second.id);
  assert.equal((await provider.userKey(owner)).id, second.id);
});
