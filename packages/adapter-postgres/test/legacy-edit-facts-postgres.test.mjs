import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  capabilities, coreDigest, coreFingerprintLabels, factHidesRow, factIncarnationBody, hostedV1Digest,
  passageShingles, userFingerprintKey, validateSuppressionFact,
} from "../../core/src/index.mjs";
import { createMemoryService } from "../../core/src/service/index.mjs";
import {
  createPostgresCapturePorts, createPostgresPauseStore,
  createPostgresMemoryCandidates, createPostgresMemoryReads, createPostgresMemoryStore,
  createPostgresSuppressionStore, createPostgresUnitOfWork, legacySuppressionToFact,
} from "../src/index.mjs";
import { readVisibilityFacts } from "../src/memory-visibility.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const owner = "legacy-test-owner";
const scope = { owner, namespace: null };
const readSet = { owner, namespaces: [null] };
const ref = (id) => ({ type: "memory", id, namespace: null });
const model = "test";
const original = "Notebook goes on the top shelf";
const embedding = [1, 0, ...Array(1534).fill(0)];
const close = [1, 0.08, ...Array(1534).fill(0)];
const cutoff = "2025-01-01 00:00:00.000400+00";
const cutoffUs = "1735689600000400";
const later = "2025-01-01 00:00:00.000500+00";
const earlier = "2025-01-01 00:00:00.000300+00";
const keyId = "a".repeat(16);
const mac = { alg: "hmac", label: "hosted-v1", pipeline: "hosted-v1", redactionVersion: 1, keyId, value: "b".repeat(64) };

async function fixture(t) {
  const { pool, source } = await migrationDatabase(t);
  const uow = createPostgresUnitOfWork(source);
  const { fence, hydrate, recent } = createPostgresMemoryReads();
  const { lexical, vector } = createPostgresMemoryCandidates();
  const memoryStore = createPostgresMemoryStore();
  const suppressions = createPostgresSuppressionStore();
  const runRead = (body) => uow.run(owner, { readOnly: true }, body);
  await pool.query("INSERT INTO users (id) VALUES ($1)", [owner]);
  await pool.query("INSERT INTO core_owner_state (user_id, legacy_facts_ready) VALUES ($1, true)", [owner]);

  async function memory(id, text, { kind = "web", created = later, digests = [], vector = close, logicalMs = null } = {}) {
    const { value } = await hostedV1Digest(text);
    await pool.query(`INSERT INTO memories (id, user_id, text, text_hash, kind, embedding, embedding_model,
      source_kind, created_at, updated_at, core_digests, core_created_at_ms)
      VALUES ($1, $2, $3, $4, 'fact', $5, $6, $7, $8, $9, $10, $11)`,
    [id, owner, text, value, JSON.stringify(vector), model, kind, created, later, JSON.stringify(digests), logicalMs]);
  }

  async function legacyText(origin, text = original, {
    textHash, textHmac = null, key = null, shingles = null, id = "legacy-text", created = cutoff,
  } = {}) {
    const { value } = await hostedV1Digest(text);
    await pool.query(`INSERT INTO suppressions (id, user_id, kind, origin, text_hash, embedding, created_at, text_hmac, key_id, shingles)
      VALUES ($1, $2, 'text', $3, $4, $5, $6, $7, $8, $9)`,
    [id, owner, origin, textHash ?? value, JSON.stringify(embedding), created, textHmac, key, shingles]);
  }

  async function visible(ids, wanted) {
    const expected = wanted.slice().sort();
    const refs = ids.map(ref);
    await runRead(async tx => {
      for (const id of ids) {
        assert.deepEqual(await fence.assertVisible(tx, readSet, [ref(id)]), wanted.includes(id) ? [ref(id)] : [], `point read for ${id}`);
      }
      assert.deepEqual((await hydrate.hydrate(tx, readSet, refs, "read")).map(item => item.ref.id).sort(), expected, "hydrate");
      assert.deepEqual((await recent.recent(tx, readSet, { cursor: null, limit: 20 })).items.map(row => row.id).sort(), expected, "recent");
      assert.deepEqual((await lexical.lexical(tx, readSet, "notebook", 20)).rows.map(row => row.ref.id).sort(), expected, "lexical candidates");
      const semantic = await vector.vector(tx, readSet, new Float32Array(embedding), model, 20);
      assert.deepEqual(semantic.rows.map(row => row.ref.id).sort(), expected, "vector candidates");
      assert.deepEqual(semantic.coverage, { eligible: expected.length, embedded: expected.length, complete: true });
    });
  }

  async function exactResaveIsBlocked(text, digests = []) {
    const digest = await hostedV1Digest(text);
    const incoming = [{ textHash: `sha256:${digest.value}`, embedding: close, digests: [digest, ...digests] }];
    const policy = await runRead(tx => memoryStore.readWritePolicy(tx, scope, incoming,
      { kind: "web", client: null, sessionId: null }, "hash", undefined,
      { explicitSaveCreatedAtUs: BigInt(cutoffUs) + 100n }));
    assert.deepEqual(policy.blockedPositions, [0], "the fact itself blocks an exact admission");
  }

  async function legacyRows() {
    const { rows } = await pool.query(`SELECT id, kind, origin, client, session_id, text_hash, text_hmac, key_id,
      redaction_version, embedding::text AS embedding, shingles,
      floor(EXTRACT(EPOCH FROM window_start) * 1000) AS start_ms,
      ceil(EXTRACT(EPOCH FROM window_end) * 1000) AS end_ms,
      trunc(EXTRACT(EPOCH FROM created_at) * 1000000)::text AS created_at_us
      FROM suppressions WHERE user_id = $1`, [owner]);
    return rows;
  }

  async function copyFacts() {
    for (const row of await legacyRows()) {
      const fact = legacySuppressionToFact(row, owner);
      const incarnation = createHash("sha256").update(factIncarnationBody(fact)).digest("hex");
      await uow.run(owner, {}, tx => suppressions.writeFact(tx, fact, incarnation));
    }
    await pool.query("UPDATE core_owner_state SET legacy_writes_reconciled = true WHERE user_id = $1", [owner]);
  }

  return { pool, uow, memory, memoryStore, suppressions, legacyText, visible, exactResaveIsBlocked, legacyRows, copyFacts };
}

test("legacy edit facts hide exact SHA and HMAC aliases and leave a captured edit replacement visible", migrationDbTest, async t => {
  const f = await fixture(t);
  await f.legacyText("edit", original, { textHmac: mac.value, key: keyId, shingles: ["ab"] });
  await f.memory("replacement", "Notebook goes on the middle shelf", { kind: "plugin" });
  await f.exactResaveIsBlocked(original);
  await f.exactResaveIsBlocked("Notebook keyed alias", [mac]);
  await f.memory("sha-hit", original);
  await f.memory("mac-hit", "Notebook keyed alias", { digests: [mac] });
  const ids = ["replacement", "sha-hit", "mac-hit"];
  await f.visible(ids, ["replacement"]);
  await f.copyFacts();
  await f.visible(ids, ["replacement"]);
});

for (const origin of ["forget", "correct", "backfill", null]) {
  test(`legacy ${origin ?? "null-origin"} full facts enforce the physical source and microsecond cutoff`, migrationDbTest, async t => {
    const f = await fixture(t);
    await f.legacyText(origin);
    await f.exactResaveIsBlocked(original);
    await f.memory("web-after", "Notebook is on the middle shelf", { logicalMs: 1 });
    await f.memory("mcp-after", "Notebook is on the lower shelf", { kind: "mcp" });
    await f.memory("capture-after", "Notebook is on the small shelf", { kind: "plugin" });
    await f.memory("import-after", "Notebook is on the large shelf", { kind: "import" });
    await f.memory("web-at", "Notebook is on the high shelf", { created: cutoff });
    await f.memory("web-before", "Notebook is on the short shelf", { created: earlier, logicalMs: 1735689601000 });
    await f.memory("web-negative-infinity", "Notebook is on the wide shelf", { created: "-infinity", logicalMs: Number.MIN_SAFE_INTEGER });
    await f.memory("web-positive-infinity", "Notebook is on the narrow shelf", { created: "infinity", logicalMs: Number.MAX_SAFE_INTEGER });
    await f.memory("sha-hit", original);
    const ids = ["web-after", "mcp-after", "capture-after", "import-after", "web-at", "web-before",
      "web-negative-infinity", "web-positive-infinity", "sha-hit"];
    const wanted = origin === null ? [] : ["web-after", "mcp-after", "web-positive-infinity"];
    await f.visible(ids, wanted);
    await f.copyFacts();
    await f.visible(ids, wanted);
  });
}

test("public converter agrees with the read union for every legacy kind and preserves timestamp precision", migrationDbTest, async t => {
  const f = await fixture(t);
  await f.legacyText("edit", original, { id: "edit", textHash: `hmac:${mac.value}`, textHmac: mac.value, key: keyId });
  await f.legacyText("forget", original, { id: "forget" });
  await f.legacyText(null, original, { id: "null-origin" });
  await f.pool.query(`INSERT INTO suppressions (id, user_id, kind, client, session_id, created_at)
    VALUES ('source', $1, 'session', 'example-client', 'example-source', $2)`, [owner, cutoff]);
  await f.pool.query(`INSERT INTO suppressions (id, user_id, kind, window_start, window_end, created_at)
    VALUES ('range', $1, 'window', $2, $3, $2)`, [owner, cutoff, later]);

  const stored = await readVisibilityFacts(f.pool.query.bind(f.pool), owner, { legacyOnly: true });
  const byId = new Map(stored.map(entry => [entry.factId, entry]));
  for (const row of await f.legacyRows()) {
    const entry = byId.get(row.id);
    assert.deepEqual(legacySuppressionToFact(row, owner), entry.fact);
    assert.equal(entry.createdAtMs, 1735689600000);
  }
  assert.equal(byId.size, 5);
  assert.deepEqual(byId.get("edit").fact.text, { digests: [mac] });
  assert.equal(byId.get("forget").fact.explicitSaveExemptAfterUs, cutoffUs);
  assert.equal(byId.get("null-origin").fact.explicitSaveExemptAfterUs, undefined);
  assert.deepEqual(byId.get("source").fact.session, { client: "example-client", sessionId: "example-source" });
  assert.deepEqual(byId.get("range").fact.window, { startMs: 1735689600000, endMs: 1735689600001 });
});

test("the core exemption has a strict format and preserves shingle matching for later physical explicit memories", async () => {
  const digests = [await hostedV1Digest(original)];
  const fact = { ...scope, actionId: "test", kind: "text", mode: "full", origin: "forget",
    explicitSaveExemptAfterUs: cutoffUs, text: { digests, keyId, shingles: ["ab"] } };
  assert.equal(validateSuppressionFact(fact), fact);
  for (const invalid of [1, null, "", "-0", "+1", "01", "1.0", "1e3", "1\n"]) {
    assert.throws(() => validateSuppressionFact({ ...fact, explicitSaveExemptAfterUs: invalid }), { code: "invalid_input" });
  }
  assert.throws(() => validateSuppressionFact({ ...fact, mode: "exact" }), { code: "invalid_input" });
  const base = { ...scope, actionId: "test", origin: "forget", explicitSaveExemptAfterUs: cutoffUs };
  for (const other of [
    { kind: "identity", memoryId: "memory" },
    { kind: "session", session: { client: "example", sessionId: "source" } },
    { kind: "window", client: null, window: { startMs: 0, endMs: 1 } },
    { kind: "rawSpan", sessionKeyHash: mac.value, messageKey: "message", startUtf16: 0, endUtf16: 1, contentDigest: mac.value },
  ]) {
    assert.throws(() => validateSuppressionFact({ ...base, ...other }), { code: "invalid_input" });
  }
  const row = { scope, memoryId: "memory", sourceKind: "web", createdAtUs: BigInt(cutoffUs) + 100n,
    digests: [await hostedV1Digest("Notebook moved")], keyId, shingles: ["ab"] };
  const stored = { fact };
  assert.equal(factHidesRow(stored, row), true);
  assert.equal(factHidesRow(stored, { ...row, digests }), true);
  assert.equal(factHidesRow(stored, { ...row, createdAtUs: BigInt(cutoffUs) }), true);
  assert.equal(factHidesRow(stored, { ...row, sourceKind: "plugin" }), true);
  assert.equal(factHidesRow(stored, { ...row, type: "raw" }), true);
});

const web = { kind: "web", client: null, sessionId: null };
const mcp = { ...web, kind: "mcp" };
const forgottenSentence = "The lantern is stored in the cellar.";
const nearSentence = "A light fixture rests downstairs.";
const unrelatedSentence = "A bicycle needs new tires.";
const cutoffMs = Number(BigInt(cutoffUs) / 1000n);
const far = [0, 1, ...Array(1534).fill(0)];

async function writeFixture(t) {
  const f = await fixture(t);
  const key = await userFingerprintKey("fixture secret", owner, coreFingerprintLabels);
  const reads = createPostgresMemoryReads();
  let now = cutoffMs + 1;
  const unused = () => assert.fail("unexpected dependency call");
  const service = createMemoryService({
    storage: {
      name: "postgres", uow: f.uow, memories: f.memoryStore, ...reads,
      pause: createPostgresPauseStore(), suppressions: f.suppressions,
      keys: { userKey: async () => key }, capabilities: capabilities({ embeddingRequiredOnInsert: true }),
    },
    config: {}, model: null,
    embedder: { model, dimensions: 1536, async embed(inputs) {
      return inputs.map(text => new Float32Array(text === unrelatedSentence.toLowerCase() ? far : close));
    } },
    gate: { async assertOpen() {} }, tokens: { countTokens: unused },
    clock: { nowMs: () => now, monotonicMs: unused, sha256Hex: input => createHash("sha256").update(input).digest("hex"), hmacHex: unused },
  });
  const shingles = await passageShingles(forgottenSentence, key, coreFingerprintLabels);
  return { ...f, service, setClock: ms => { now = ms; },
    forget: (origin = "forget", created) => f.legacyText(origin, forgottenSentence, { key: key.id, shingles, created }),
    fence: id => f.uow.run(owner, { readOnly: true }, tx => reads.fence.assertVisible(tx, readSet, [ref(id)])),
  };
}

test("a pre-forget memory stays hidden while a later vector-close explicit save is visible", migrationDbTest, async t => {
  const f = await writeFixture(t);
  f.setClock(cutoffMs);
  const before = await f.service.save(scope, nearSentence, web);
  assert.equal(before.status, "saved");
  await f.forget();
  assert.deepEqual(await f.fence(before.item.id), []);

  f.setClock(cutoffMs + 1);
  const after = await f.service.save(scope, "The light fixture rests downstairs.", mcp);
  assert.equal(after.status, "saved");
  assert.equal(after.item.createdAtMs, cutoffMs + 1);
  assert.deepEqual(await f.fence(after.item.id), [ref(after.item.id)]);
});

test("later explicit saves still withhold an exact re-save and multi-sentence containment", migrationDbTest, async t => {
  const f = await writeFixture(t);
  await f.forget();
  const cases = [
    ["exact re-save", forgottenSentence],
    ["exact sentence", `A journal entry follows. ${forgottenSentence}`],
    ["multi-sentence shingle containment", `A journal entry follows. The note reads: ${forgottenSentence}`],
  ];
  for (const [label, text] of cases) {
    assert.equal((await f.service.save(scope, text, web)).status, "suppressed", label);
  }
  assert.equal((await f.pool.query("SELECT count(*)::int AS count FROM memories")).rows[0].count, 0);
});

test("a capture finishing after the forget still withholds vector-close text", migrationDbTest, async t => {
  const f = await writeFixture(t);
  await f.forget();
  const capture = createPostgresCapturePorts({ lineageSecret: "fixture", now: () => cutoffMs + 1 });
  const key = { scope, client: "fixture", sessionId: "source", eventId: "capture", payloadDigest: "a".repeat(64) };
  const message = { id: "message", role: "user", content: nearSentence, occurredAtMs: cutoffMs + 1 };
  const run = body => f.uow.run(owner, { pauseLock: true }, body);
  assert.deepEqual(await run(tx => capture.admit(tx, key, [message])), { status: "admitted" });
  const claim = await run(tx => capture.claim(tx, key, [message], { leaseMs: 60_000 }));
  assert.equal(claim.status, "claimed");
  const digest = await coreDigest(nearSentence);
  const item = { content: nearSentence, kind: "fact", confidence: 1, textHash: `sha256:${digest.value}`,
    embedding: { model, vector: close }, receipts: [{ client: key.client, sessionId: key.sessionId,
      messageId: message.id, role: message.role, occurredAtMs: message.occurredAtMs }] };
  const result = await run(tx => capture.finish(tx, claim.token, [item]));
  assert.deepEqual(result.suppressedItems, [0]);
  assert.deepEqual(result.memories, []);
});

for (const source of [mcp, web]) {
  test(`a correction of a later ${source.kind} memory still withholds vector-close text`, migrationDbTest, async t => {
    const f = await writeFixture(t);
    await f.forget();
    const saved = await f.service.save(scope, unrelatedSentence, source);
    assert.equal(saved.status, "saved");
    const { id, revision } = saved.item;
    assert.equal((await f.service.correct(scope, id, revision, nearSentence, web)).status, "suppressed");
    const row = await f.uow.run(owner, { readOnly: true }, tx => f.memoryStore.get(tx, scope, id));
    assert.equal(row.text, unrelatedSentence);
    assert.equal(row.revision, revision);
  });
}

test("an explicit save at the suppression timestamp has no vector exemption", migrationDbTest, async t => {
  const f = await writeFixture(t);
  await f.forget("forget", new Date(cutoffMs).toISOString());
  f.setClock(cutoffMs);
  const receipt = { client: "fixture", sessionId: "source", messageId: "message", role: "user", occurredAtMs: cutoffMs + 1 };
  assert.equal((await f.service.save(scope, nearSentence, web, "fact", { receipt })).status, "suppressed");
  assert.equal((await f.pool.query("SELECT count(*)::int AS count FROM memories")).rows[0].count, 0);
});
