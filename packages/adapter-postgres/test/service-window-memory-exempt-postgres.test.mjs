import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { capabilities, userFingerprintKey } from "../../core/src/index.mjs";
import { windowMemoryScenarios, windowMemoryScope } from "../../core/test/helpers/service-window-memory-exempt.mjs";
import {
  createPostgresCapturePorts, createPostgresFingerprintKeyProvider, createPostgresMemoryCandidates,
  createPostgresMemoryReads, createPostgresMemoryStore, createPostgresPauseStore, createPostgresRawPorts,
  createPostgresRawReads, createPostgresSuppressionStore, createPostgresTopicStore, createPostgresUnitOfWork,
  HOSTED_FINGERPRINT_LABELS,
} from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

async function fixture(t, fingerprintKey) {
  const { pool, source } = await migrationDatabase(t);
  const { owner } = windowMemoryScope;
  await pool.query("INSERT INTO users (id) VALUES ($1)", [owner]);
  await pool.query("INSERT INTO core_owner_state (user_id, legacy_facts_ready) VALUES ($1, true)", [owner]);
  const uow = createPostgresUnitOfWork(source);
  const secret = fingerprintKey ? "fixture-key" : null;
  const keys = createPostgresFingerprintKeyProvider(secret, { uow });
  if (fingerprintKey) {
    const key = await userFingerprintKey(secret, owner, HOSTED_FINGERPRINT_LABELS);
    await keys.publish(owner, key.id);
  }
  const options = { lineageSecret: "fixture-lineage" };
  const activeKeys = async owner => {
    const key = await keys.userKey(owner);
    return key ? [key] : [];
  };
  const reads = { ...options, fingerprintKeys: activeKeys };
  const capture = createPostgresCapturePorts(options);
  const archive = createPostgresRawPorts({ ...options,
    fingerprintKeys: async owner => (await activeKeys(owner)).map(key => ({ key, pipeline: "core" })) });
  return {
    name: "postgres", uow, keys,
    capabilities: capabilities({ fingerprintKey, embeddingRequiredOnInsert: true, rawArchive: true,
      rawWindowHide: true, sessionLineage: true, placement: true }),
    memories: createPostgresMemoryStore(), pause: createPostgresPauseStore(),
    suppressions: createPostgresSuppressionStore(options), capture,
    ...createPostgresMemoryCandidates(), ...createPostgresMemoryReads(reads), ...archive,
    raw: { ...archive.raw, ...createPostgresRawReads(reads) }, placement: createPostgresTopicStore(),
    async seedReceipt({ client, sessionId, eventId, role, occurredAtMs }, content) {
      // Postgres requires Raw source evidence to admit a receipt.
      const source = { scope: windowMemoryScope, client, sessionId, eventId,
        payloadDigest: createHash("sha256").update(content).digest("hex") };
      const messages = [{ id: eventId, role, occurredAtMs, content }];
      await uow.run(owner, { pauseLock: true }, async tx => {
        assert.deepEqual(await capture.admit(tx, source, messages), { status: "admitted" });
        await archive.raw.recordLineage(tx, source, messages);
        assert.equal((await archive.raw.archive(tx, source, messages)).archived, 1);
      });
    },
  };
}

for (const fingerprintKey of [false, true]) {
  const mode = fingerprintKey ? "keyed" : "keyless";
  for (const [name, scenario] of Object.entries(windowMemoryScenarios)) {
    test(`Postgres ${mode} ${name}`, migrationDbTest, async t => scenario(t, await fixture(t, fingerprintKey)));
  }
}
