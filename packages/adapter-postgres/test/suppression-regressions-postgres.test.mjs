import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  coreDigest, factIncarnationBody, fingerprintLegacyCapture, hostedV1Digest, userFingerprintKey,
} from "../../core/src/index.mjs";
import { captureMethods } from "../../core/src/service/capture.mjs";
import {
  createPostgresCapturePorts, createPostgresFingerprintKeyProvider, createPostgresMemoryReads,
  createPostgresPauseStore, createPostgresSuppressionStore, createPostgresUnitOfWork, HOSTED_FINGERPRINT_LABELS, query,
} from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const scope = { owner: "review-owner", namespace: null };
const { owner } = scope;
const base = { owner, actionId: "review", origin: "forget" };
const readSet = { owner, namespaces: [null] };
const vector = [1, ...Array(1535).fill(0)];
const ref = (id, namespace = null) => ({ type: "memory", id, namespace });
const deriveKey = (secret) => userFingerprintKey(secret, owner, HOSTED_FINGERPRINT_LABELS);

async function fixture(t) {
  const { pool, source } = await migrationDatabase(t);
  const uow = createPostgresUnitOfWork(source);
  const run = (body) => uow.run(owner, {}, body);
  const read = (body) => uow.run(owner, { readOnly: true }, body);
  const store = createPostgresSuppressionStore();
  const write = (fact) => run(tx => store.writeFact(tx, fact,
    createHash("sha256").update(factIncarnationBody(fact)).digest("hex")));
  await pool.query("INSERT INTO users (id) VALUES ($1)", [owner]);
  return { pool, uow, run, read, store, write };
}

async function memory(pool, id, {
  text = id, digests = [], namespace = null, client = "stored-client", sessionId = null, time = 15,
} = {}) {
  const digest = digests[0] ?? await coreDigest(text);
  await pool.query(`INSERT INTO memories
    (id, user_id, text, text_hash, kind, embedding, embedding_model, source_kind, core_digests,
      core_namespace, source_client, source_session_id, created_at, updated_at)
    VALUES ($1, $2, $3, $4, 'fact', $5, 'test', 'mcp', $6,
      $7, $8, $9, to_timestamp($10::double precision / 1000), to_timestamp($10::double precision / 1000))`,
  [id, owner, text, digest.value, JSON.stringify(vector), JSON.stringify(digests),
    namespace === null ? null : JSON.stringify(namespace), client, sessionId, time]);
}

async function legacyWindow(pool, client = "stored-client") {
  await pool.query(`INSERT INTO core_owner_state (user_id, legacy_facts_ready) VALUES ($1, true)
    ON CONFLICT (user_id) DO UPDATE SET legacy_facts_ready = true`, [owner]);
  await pool.query(`INSERT INTO suppressions (id, user_id, kind, client, window_start, window_end)
    VALUES ('legacy-window', $1, 'window', $2, to_timestamp(0.010), to_timestamp(0.020))`, [owner, client]);
}

test("review P1-1: configured fingerprint keys stay staged until owner-locked publication", migrationDbTest, async (t) => {
  const { pool, uow, run, write } = await fixture(t);
  const provider = createPostgresFingerprintKeyProvider("key-a", { uow, stagedSecrets: ["key-b", "key-c"] });
  assert.equal(await provider.userKey(owner), null, "configuration alone must not activate a key");

  const [a, b, c] = await Promise.all(["key-a", "key-b", "key-c"].map(deriveKey));
  await provider.publish(owner, a.id);
  assert.equal((await provider.userKey(owner)).id, a.id);
  const restarted = createPostgresFingerprintKeyProvider("key-b", { uow, stagedSecrets: ["key-a", "key-c"] });
  assert.equal((await restarted.userKey(owner)).id, a.id);
  await assert.rejects(createPostgresFingerprintKeyProvider("key-b", { uow }).userKey(owner),
    { code: "fingerprint_key_mismatch" });

  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const writer = run(async (tx) => {
    const current = await restarted.userKeyForWrite(tx);
    assert.equal(current.id, a.id);
    entered.resolve();
    await release.promise;
    const digest = await coreDigest("writer content", current);
    await query(tx, `INSERT INTO memories (id, user_id, text, text_hash, kind, embedding, embedding_model,
      source_kind, core_digests) VALUES ('writer', $1, 'writer content', $2, 'fact', $3, 'test', 'mcp', $4)`,
    [owner, digest.value, JSON.stringify(vector), JSON.stringify([digest])]);
  });
  let publishing;
  try {
    await Promise.race([entered.promise, writer]);
    publishing = assert.rejects(restarted.publish(owner, b.id), { code: "fingerprint_key_mismatch" });
    const deadline = performance.now() + 3_000;
    let waiting = false;
    while (!waiting && performance.now() < deadline) {
      const { rows: [row] } = await pool.query(`SELECT EXISTS (SELECT 1 FROM pg_locks
        WHERE locktype = 'advisory' AND NOT granted AND database = (SELECT oid FROM pg_database
        WHERE datname = current_database())) AS waiting`);
      waiting = row.waiting;
      if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(waiting, "publication must wait for the active writer's owner lock");
  } finally {
    release.resolve();
    await writer;
    await publishing;
  }
  assert.equal((await restarted.userKey(owner)).id, a.id);

  await write({ ...base, kind: "text", mode: "exact", text: { digests: [await coreDigest("withheld", a)] } });
  await pool.query("UPDATE memories SET core_digests = core_digests || $2::jsonb WHERE user_id = $1", [
    owner, JSON.stringify(await Promise.all([b, c].map(key => coreDigest("writer content", key)))),
  ]);
  await restarted.publish(owner, b.id);
  assert.equal((await restarted.userKey(owner)).id, b.id);
  await assert.rejects(restarted.publish(owner, c.id), { code: "fingerprint_key_mismatch" });
  assert.equal((await restarted.userKey(owner)).id, b.id);
});

test("review P1-2: staging a MAC preserves a legacy row's text-derived SHA alias", migrationDbTest, async (t) => {
  const { pool, read, store, write } = await fixture(t);
  const text = "api_Key=synthetic-value for the kelvin assignment";
  const physical = await coreDigest(text);
  const alias = await hostedV1Digest(text);
  assert.notEqual(physical.value, alias.value);
  await memory(pool, "kelvin", { text });
  await write({ ...base, kind: "text", mode: "exact", text: { digests: [alias] } });
  const { fence } = createPostgresMemoryReads();
  const visible = () => read(tx => fence.assertVisible(tx, readSet, [ref("kelvin")]));
  const facts = () => read(tx => store.factsFor(tx, scope, { memoryId: "kelvin" }));
  assert.deepEqual(await visible(), []);
  assert.equal((await facts()).length, 1);
  const staged = await coreDigest(text, await deriveKey("key-b"));
  await pool.query("UPDATE memories SET core_digests = core_digests || $2::jsonb WHERE user_id = $1",
    [owner, JSON.stringify([staged])]);
  assert.deepEqual(await visible(), [], "staging must preserve the SHA fence");
  assert.equal((await facts()).length, 1);
});

test("review P1-3: capture source eligibility enforces a legacy-only half-open window", migrationDbTest, async (t) => {
  const { pool, uow, read, run, store } = await fixture(t);
  await legacyWindow(pool);
  const capture = createPostgresCapturePorts({ lineageSecret: "test-secret" });
  const key = { scope, client: "stored-client", sessionId: "session", eventId: "event", payloadDigest: "a".repeat(64) };
  const times = [9, 10, 15, 20];
  const messages = times.map(time => ({ id: String(time), role: "user", content: String(time), occurredAtMs: time }));
  const snapshot = await read(tx => store.snapshot(tx, scope, { client: key.client, occurredAtMs: times }));
  assert.deepEqual(snapshot.blockedMessages, [1, 2]);
  assert.deepEqual(await run(tx => capture.eligible(tx, key, messages)), [0, 3]);
  const service = captureMethods({
    storage: { uow, capture, suppressions: store, pause: createPostgresPauseStore(), capabilities: {} },
    clock: { sha256Hex: text => createHash("sha256").update(text).digest("hex") },
  });
  const { client, sessionId, eventId } = key;
  assert.deepEqual(await service.enqueueCapture(scope, { client, sessionId, eventId, messages }), { status: "accepted" });
  const admission = await read(tx => capture.load(tx, { scope, client, sessionId, eventId }));
  assert.deepEqual(admission.messages.map(message => message.content), ["9", "", "", "20"]);
  await uow.run(owner, { pauseLock: true }, tx =>
    capture.claim(tx, admission.key, admission.messages, { leaseMs: 60_000 }));
  const { key: admitted } = admission;
  await assert.rejects(run(tx => capture.assertEligible(tx, admitted, [2])), { code: "suppressed" });
  await run(tx => capture.assertEligible(tx, admitted, [0, 3]));
});

test("review P1-4: factsFor matches the fence on stored sessions, legacy windows, and vectors", migrationDbTest, async (t) => {
  const { pool, read, store, write } = await fixture(t);
  const { fence } = createPostgresMemoryReads();
  await legacyWindow(pool);
  await memory(pool, "window");
  await memory(pool, "session", { time: 20, sessionId: "stored-session" });
  await memory(pool, "vector", { time: 20 });
  const session = await write({ ...base, kind: "session", session: { client: "stored-client", sessionId: "stored-session" } });
  for (const [id, factId] of [["session", session.factId], ["window", "legacy-window"]]) {
    assert.deepEqual(await read(tx => fence.assertVisible(tx, readSet, [ref(id)])), []);
    const facts = await read(tx => store.factsFor(tx, scope, { memoryId: id }));
    assert.deepEqual(facts.map(fact => fact.factId), [factId], id);
  }
  const full = await write({ ...base, kind: "text", mode: "full",
    text: { digests: [await coreDigest("different exact digest")], embedding: vector } });
  assert.deepEqual(await read(tx => fence.assertVisible(tx, readSet, [ref("vector")])), []);
  const facts = await read(tx => store.factsFor(tx, scope, { memoryId: "vector" }));
  assert.deepEqual(facts.map(fact => fact.factId), [full.factId]);
  await pool.query(`INSERT INTO core_memory_receipts (user_id, memory_id, client, session_id, message_id, role)
    VALUES ($1, 'window', 'stored-client', 'other-session', 'message', 'user')`, [owner]);
  const receiptBacked = await read(tx => store.factsFor(tx, scope, { memoryId: "window" }));
  assert.deepEqual(receiptBacked.map(fact => fact.factId), [full.factId]);
});

test("review P1-5: legacy shingle evidence lets a comparable unrelated capture passage through", migrationDbTest, async (t) => {
  const { pool, read, store } = await fixture(t);
  await legacyWindow(pool);
  const key = await deriveKey("legacy-key");
  const original = "The garden path is lined with cedar and rosemary.";
  const unrelated = "Copper conducts electricity.";
  const legacy = await fingerprintLegacyCapture(original, key, HOSTED_FINGERPRINT_LABELS);
  const candidate = await fingerprintLegacyCapture(unrelated, key, HOSTED_FINGERPRINT_LABELS);
  await pool.query(`INSERT INTO suppressions (id, user_id, kind, text_hash, key_id, shingles, embedding)
    VALUES ('legacy-text', $1, 'text', $2, $3, $4, $5)`,
  [owner, (await hostedV1Digest(original)).value, key.id, legacy.shingles, JSON.stringify(vector)]);
  const snapshot = (passages) => read(tx => store.snapshot(tx, scope, { passages }));
  assert.deepEqual((await snapshot([{ digests: [await hostedV1Digest(unrelated)],
    shingles: candidate.shingles, keyId: key.id }])).passages, []);
  const { passages } = await snapshot();
  assert.deepEqual(passages[0].fact.text.shingles, legacy.shingles);
  assert.equal(passages[0].fact.text.keyId, key.id);
});

test("review P1-6: hosted read sets and suppression scopes default to personal only", migrationDbTest, async (t) => {
  const { pool, read, store, write } = await fixture(t);
  const named = { owner, namespace: "project" };
  await memory(pool, "named", { namespace: named.namespace });
  const namedRef = ref("named", named.namespace);
  const reads = createPostgresMemoryReads();
  const project = { owner, namespaces: ["project"] };
  const mixed = { owner, namespaces: [null, "project"] };
  await assert.rejects(read(tx => reads.fence.assertVisible(tx, project, [namedRef])), { code: "invalid_input" });
  await assert.rejects(read(tx => reads.hydrate.hydrate(tx, project, [namedRef], "read")), { code: "invalid_input" });
  await assert.rejects(read(tx => reads.recent.recent(tx, project, { limit: 5 })), { code: "invalid_input" });
  await assert.rejects(read(tx => reads.snapshot.stateToken(tx, mixed)), { code: "invalid_input" });
  assert.deepEqual(await read(tx => reads.fence.assertVisible(tx, readSet, [namedRef])), []);

  const fact = { ...base, namespace: named.namespace, kind: "identity", memoryId: "named", throughRevision: 1 };
  await write(fact);
  await assert.rejects(read(tx => store.snapshot(tx, named, {})), { code: "ineligible" });
  assert.equal(await read(tx => store.factsFor(tx, named, { memoryId: "named" })), "ineligible");
  const optedIn = createPostgresSuppressionStore({ allowNonNullNamespace: true });
  assert.deepEqual((await read(tx => optedIn.factsFor(tx, named, { memoryId: "named" }))).map(({ fact }) => fact), [fact]);
});
