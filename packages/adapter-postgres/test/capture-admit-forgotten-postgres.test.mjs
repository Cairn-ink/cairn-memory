import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { test } from "node:test";
import { capabilities, userFingerprintKey } from "../../core/src/index.mjs";
import { createMemoryService } from "../../core/src/service/index.mjs";
import {
  createPostgresCapturePorts, createPostgresFingerprintKeyProvider, createPostgresMemoryCandidates,
  createPostgresMemoryReads, createPostgresMemoryStore, createPostgresPauseStore, createPostgresQuantityLedgerStore,
  createPostgresRawPorts, createPostgresRawReads, createPostgresSuppressionStore, createPostgresUnitOfWork,
  HOSTED_FINGERPRINT_LABELS,
} from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const scope = { owner: "fixture-owner", namespace: null };
const other = { owner: "fixture-other", namespace: null };
const source = { kind: "mcp", client: null, sessionId: null };
const now = 50_000;
const dimensions = 1536;
const embedding = text => {
  const unit = new Float32Array(dimensions);
  unit[[...text].reduce((hash, char) => (hash * 31 + char.codePointAt(0)) % dimensions, 7)] = 1;
  return unit;
};
const sha256Hex = text => createHash("sha256").update(text).digest("hex");

const primary = { client: "test-client", sessionId: "primary-session", eventId: "primary-capture" };
const secondary = { ...primary, sessionId: "secondary-session", eventId: "secondary-capture" };
const replay = { ...secondary, eventId: "replay-capture" };
const turn = (id, content) => ({ id, content, role: "user", occurredAtMs: 10_000 });
const primaryTurn = turn("primary-message", "The equipment locker contains a folding ladder.");
const forgottenTurn = turn("secondary-message", "A kestrel flew over the orchard.");
const control = turn("control-message", "The garden has a rain barrel.");
const memoryText = "The ladder is available for maintenance.";
const controlText = "The garden collects rainwater in a barrel.";
const forgottenText = "The orchard had a kestrel sighting.";

function storedMessage({ id, content, role, occurredAtMs }) {
  return { id, content, role, occurred_at: new Date(occurredAtMs).toISOString() };
}

async function fixture(t, keyed) {
  const { pool, source: database } = await migrationDatabase(t);
  await pool.query("INSERT INTO users (id) VALUES ($1), ($2)", [scope.owner, other.owner]);
  await pool.query("INSERT INTO core_owner_state (user_id, legacy_facts_ready) VALUES ($1, true), ($2, true)",
    [scope.owner, other.owner]);
  const uow = createPostgresUnitOfWork(database);
  const write = fn => uow.run(scope.owner, { pauseLock: true }, fn);
  const secret = keyed ? "fixture-admission-key" : null;
  const keys = createPostgresFingerprintKeyProvider(secret, { uow });
  const key = keyed ? await userFingerprintKey(secret, scope.owner, HOSTED_FINGERPRINT_LABELS) : null;
  if (key) await keys.publish(scope.owner, key.id);

  const readOptions = { allowNonNullNamespace: true };
  const rawOptions = {
    lineageSecret: "fixture-admission-lineage",
    fingerprintKeys: async owner => key && owner === scope.owner ? [key] : [],
  };
  const { raw: archive, sessionLineage } = createPostgresRawPorts({ ...rawOptions,
    fingerprintKeys: async owner => (await rawOptions.fingerprintKeys(owner)).map(key => ({ pipeline: "core", key })) });
  const archiveCalls = [];
  const raw = { ...archive, ...createPostgresRawReads(rawOptions),
    async archive(tx, key, messages) {
      const result = await archive.archive(tx, key, messages);
      archiveCalls.push({ messages, result });
      return result;
    } };
  const reads = createPostgresMemoryReads({ ...readOptions, ...rawOptions });
  const memories = createPostgresMemoryStore({ ...readOptions, nearDuplicate: false });
  let outputByContent = new Map();
  const extractionInputs = [];
  const service = createMemoryService({
    storage: {
      name: "postgres", uow, keys, memories, raw, sessionLineage, ...reads,
      quantityLedger: createPostgresQuantityLedgerStore(readOptions),
      capture: createPostgresCapturePorts({ ...readOptions, lineageSecret: rawOptions.lineageSecret,
        nearDuplicate: false, now: () => now }),
      pause: createPostgresPauseStore(),
      suppressions: createPostgresSuppressionStore({ ...readOptions, lineageSecret: rawOptions.lineageSecret }),
      ...createPostgresMemoryCandidates(readOptions),
      capabilities: capabilities({ fingerprintKey: keyed, embeddingRequiredOnInsert: true, nearDuplicate: false,
        rawArchive: true, sessionLineage: true, quantityLedger: true }),
    },
    config: {},
    clock: { nowMs: () => now, monotonicMs: () => performance.now(), sha256Hex,
      hmacHex: (key, text) => createHmac("sha256", key).update(text).digest("hex") },
    gate: { assertOpen() {} }, tokens: { countTokens: () => 1 },
    model: { model: "fixture", contextWindow: 32_768, countTokens: () => 1,
      async call(stage, { input }) {
        assert.equal(stage, "extract");
        extractionInputs.push(input.messages);
        const items = input.messages.flatMap(({ content, index }) => outputByContent.has(content)
          ? [{ content: outputByContent.get(content), kind: "fact", confidence: 1, sourceIndices: [index] }] : []);
        return { items };
      } },
    embedder: { model: "fixture", dimensions, async embed(texts) { return texts.map(embedding); } },
  });

  const enqueue = (event, messages, target = scope) => service.enqueueCapture(target, { ...event, messages });
  const storedRequest = async (event, target = scope) => (await pool.query(`SELECT raw_request FROM capture_events
    WHERE user_id = $1 AND client = $2 AND session_id = $3 AND event_id = $4`,
  [target.owner, event.client, event.sessionId, event.eventId])).rows[0].raw_request;

  async function run(event, outputs = []) {
    outputByContent = new Map(outputs);
    const result = await service.runCapture(scope, event);
    assert.equal(result.status, "done", result.code);
    return result.result;
  }

  async function seedReceipt() {
    assert.deepEqual(await enqueue(primary, [primaryTurn]), { status: "accepted" });
    const { memories: [{ id }] } = await run(primary, [[primaryTurn.content, memoryText]]);
    // The primary session is fenced on forget. Use a receipt in a second session to isolate tombstone admission.
    assert.deepEqual(await enqueue(secondary, [forgottenTurn]), { status: "accepted" });
    await run(secondary);
    await write(tx => memories.touchDuplicate(tx, scope, id, [{
      client: secondary.client, sessionId: secondary.sessionId, messageId: forgottenTurn.id,
      role: forgottenTurn.role, occurredAtMs: forgottenTurn.occurredAtMs,
    }], { confidence: 1 }, now));
    return id;
  }

  const forget = async id => assert.equal((await service.forget(scope, id, source)).status, "forgotten");
  const rawRows = async () => (await pool.query("SELECT message_id AS id, content FROM raw_messages")).rows;
  const memoryRows = async () => (await pool.query("SELECT id, text FROM memories")).rows;
  const activeReceiptIds = async () => (await pool.query(`SELECT message_id AS id FROM core_memory_receipts
    WHERE user_id = $1 AND forgotten_at IS NULL`, [scope.owner])).rows.map(({ id }) => id);
  const archiveTurn = (event, message) => write(tx => archive.archive(tx,
    { scope, ...event, payloadDigest: sha256Hex(JSON.stringify([message])) }, [message]));
  const importTurn = (event, message) => write(tx => archive.importArchive(tx, scope, event, [message]));
  return { enqueue, storedRequest, run, seedReceipt, forget, rawRows, memoryRows, activeReceiptIds,
    archiveTurn, importTurn, archiveCalls, extractionInputs };
}

for (const keyed of [false, true]) {
  const mode = keyed ? "keyed" : "keyless";

  test(`Postgres ${mode} admission blanks a resent forgotten turn before writing the outbox`, migrationDbTest, async t => {
    const f = await fixture(t, keyed);
    const id = await f.seedReceipt();
    assert.ok((await f.rawRows()).some(({ id }) => id === forgottenTurn.id));
    await f.forget(id);
    assert.deepEqual(await f.rawRows(), []);
    f.extractionInputs.length = 0;
    f.archiveCalls.length = 0;

    const messages = [forgottenTurn, control];
    assert.deepEqual(await f.enqueue(replay, messages), { status: "accepted" });
    const stored = await f.storedRequest(replay);
    const scrubbed = await f.storedRequest(secondary);
    assert.deepEqual(stored.messages, [
      { ...storedMessage(forgottenTurn), content: "" }, storedMessage(control),
    ], "the stored request must already be blank before the runner loads it");
    assert.deepEqual(stored.messages[0], scrubbed.messages[0]);
    assert.deepEqual(await f.enqueue(replay, messages), { status: "duplicate" });

    const result = await f.run(replay, [[forgottenTurn.content, forgottenText], [control.content, controlText]]);
    assert.deepEqual(f.extractionInputs, [[{ index: 0, role: control.role, content: control.content }]]);
    assert.equal(result.memories.length, 1);
    assert.equal(result.memories[0].outcome, "inserted");
    assert.equal(result.suppressedCount, 0);
    assert.deepEqual(await f.memoryRows(), [{ id: result.memories[0].id, text: controlText }]);
    assert.deepEqual(await f.activeReceiptIds(), [control.id]);
    assert.deepEqual(await f.rawRows(), [{ id: control.id, content: control.content }]);
    assert.deepEqual(f.archiveCalls, [{ messages: [control], result: { archived: 1 } }]);
    assert.deepEqual(await f.archiveTurn(replay, forgottenTurn), { archived: 0, withheld: 1 });
    assert.deepEqual(await f.importTurn(replay, forgottenTurn), { archived: 0, existing: 0, withheld: 1 });

    assert.deepEqual(await f.enqueue(replay, messages), { status: "duplicate" });
    assert.deepEqual(await f.run(replay), result, "a completed claim replays the stored finish");
    assert.equal(f.extractionInputs.length, 1, "a replay must skip extraction");
    await assert.rejects(f.enqueue(replay, [{ ...forgottenTurn, content: "Different text." }, control]),
      { code: "event_payload_conflict" });
    assert.deepEqual(await f.storedRequest(replay), stored);
  });

  test(`Postgres ${mode} admission limits blanking to an exact forgotten receipt`, migrationDbTest, async t => {
    const f = await fixture(t, keyed);
    const id = await f.seedReceipt();
    assert.deepEqual((await f.storedRequest(secondary)).messages, [storedMessage(forgottenTurn)]);
    await f.forget(id);

    for (const [event, target] of [
      [{ ...replay, client: "other-client" }, scope],
      [{ ...replay, sessionId: "other-session" }, scope],
      [replay, other],
    ]) {
      assert.deepEqual(await f.enqueue(event, [forgottenTurn], target), { status: "accepted" });
      assert.deepEqual((await f.storedRequest(event, target)).messages, [storedMessage(forgottenTurn)]);
    }
  });
}
