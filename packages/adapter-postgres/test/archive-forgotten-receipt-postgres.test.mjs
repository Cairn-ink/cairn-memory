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
const vector = Float32Array.of(1, ...Array(1535).fill(0));
// Distinct texts get distinct unit vectors, so a keyed forget's vector evidence cannot suppress unrelated captures.
const embedding = text => {
  const unit = new Float32Array(vector.length);
  unit[[...text].reduce((hash, char) => (hash * 31 + char.codePointAt(0)) % vector.length, 7)] = 1;
  return unit;
};
const sha256Hex = text => createHash("sha256").update(text).digest("hex");

const primary = { client: "test-client", sessionId: "primary-session", eventId: "primary-capture" };
const secondary = { client: primary.client, sessionId: "secondary-session", eventId: "secondary-capture" };
const replay = { ...secondary, eventId: "replay-capture" };
const separate = { ...replay, sessionId: "separate-session" };
const otherClient = { ...replay, client: "other-client" };
const turn = (id, content) => ({ id, content, role: "user", occurredAtMs: 10_000 });
const primaryTurn = turn("primary-message", "The equipment locker contains a folding ladder.");
const secondaryTurn = turn("secondary-message", "A kestrel flew over the orchard.");
const neighbor = turn("neighbor", "The garden has a rain barrel.");
const memoryText = "The ladder is available for maintenance.";
const neighborText = "The garden collects rainwater in a barrel.";

function receipt({ client, sessionId }, { id, role, occurredAtMs }) {
  return { client, sessionId, messageId: id, role, occurredAtMs };
}

function rawRow({ client, sessionId }, { id, content }, target = scope) {
  return { owner: target.owner, client, sessionId, messageId: id, content };
}

async function fixture(t, keyed) {
  const { pool, source: database } = await migrationDatabase(t);
  await pool.query("INSERT INTO users (id) VALUES ($1), ($2)", [scope.owner, other.owner]);
  await pool.query("INSERT INTO core_owner_state (user_id, legacy_facts_ready) VALUES ($1, true)", [scope.owner]);
  const uow = createPostgresUnitOfWork(database);
  const write = (fn, target = scope) => uow.run(target.owner, { pauseLock: true }, fn);
  const secret = keyed ? "forgotten-archive-key" : null;
  const keys = createPostgresFingerprintKeyProvider(secret, { uow });
  const key = keyed ? await userFingerprintKey(secret, scope.owner, HOSTED_FINGERPRINT_LABELS) : null;
  if (key) await keys.publish(scope.owner, key.id);

  const readOptions = { allowNonNullNamespace: true };
  const rawOptions = {
    lineageSecret: "forgotten-archive-lineage",
    fingerprintKeys: async owner => key && owner === scope.owner ? [key] : [],
  };
  const { raw: archive, sessionLineage } = createPostgresRawPorts({ ...rawOptions,
    fingerprintKeys: async owner => (await rawOptions.fingerprintKeys(owner)).map(key => ({ pipeline: "core", key })) });
  const raw = { ...archive, ...createPostgresRawReads(rawOptions) };
  const reads = createPostgresMemoryReads({ ...readOptions, ...rawOptions });
  const memories = createPostgresMemoryStore({ ...readOptions, nearDuplicate: false });
  const quantityLedger = createPostgresQuantityLedgerStore(readOptions);
  let extraction = [];
  const service = createMemoryService({
    storage: {
      name: "postgres", uow, keys, memories, quantityLedger, raw, sessionLineage,
      ...reads,
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
      async call() { return { items: extraction }; } },
    embedder: { model: "fixture", dimensions: vector.length, async embed(texts) { return texts.map(embedding); } },
  });

  async function capture(event, messages, text, sourceIndices = [0]) {
    assert.equal((await service.enqueueCapture(scope, { ...event, messages })).status, "accepted");
    extraction = text ? [{ content: text, kind: "fact", confidence: 1, sourceIndices }] : [];
    const result = await service.runCapture(scope, event);
    assert.equal(result.status, "done", result.code);
    assert.equal(result.result.memories.length, extraction.length);
    return result.result.memories[0]?.id;
  }

  async function seedReceipt({ archiveSource = false } = {}) {
    const id = await capture(primary, [primaryTurn], memoryText);
    if (archiveSource) await capture(secondary, [secondaryTurn]);
    await write(tx => memories.touchDuplicate(tx, scope, id, [receipt(secondary, secondaryTurn)], { confidence: 1 }, now));
    return id;
  }

  const archiveRaw = (event, messages, target = scope) => write(tx => raw.archive(tx,
    { scope: target, ...event, payloadDigest: sha256Hex(JSON.stringify(messages)) }, messages), target);
  const rawRows = async () => (await pool.query(`SELECT user_id AS owner, client, session_id AS "sessionId",
    message_id AS "messageId", content FROM raw_messages`)).rows;
  const receiptRows = async () => (await pool.query(`SELECT memory_id AS "memoryId", client, session_id AS "sessionId",
    message_id AS "messageId", forgotten_at IS NOT NULL AS marked FROM core_memory_receipts WHERE user_id = $1`,
  [scope.owner])).rows;
  const forget = async id => assert.equal((await service.forget(scope, id, source)).status, "forgotten");
  return { archiveRaw, capture, forget, rawRows, receiptRows, seedReceipt };
}

for (const keyed of [false, true]) {
  const mode = keyed ? "keyed" : "keyless";

  test(`Postgres ${mode} direct archive withholds a forgotten receipt and stores its neighbor`, migrationDbTest, async t => {
    const f = await fixture(t, keyed);
    await f.forget(await f.seedReceipt());

    assert.deepEqual(await f.archiveRaw(replay, [secondaryTurn, neighbor]), { archived: 1, withheld: 1 });
    assert.deepEqual(await f.rawRows(), [rawRow(replay, neighbor)]);
  });

  test(`Postgres ${mode} capture finishes a new event that resends a forgotten receipt`, migrationDbTest, async t => {
    const f = await fixture(t, keyed);
    const originalId = await f.seedReceipt({ archiveSource: true });
    assert.ok((await f.rawRows()).some(row => row.sessionId === secondary.sessionId && row.messageId === secondaryTurn.id));
    await f.forget(originalId);
    assert.deepEqual(await f.rawRows(), []);

    // Admission blanks the forgotten turn, so the model sees only the neighbor, at index 0.
    const id = await f.capture(replay, [secondaryTurn, neighbor], neighborText, [0]);
    assert.deepEqual(await f.rawRows(), [rawRow(replay, neighbor)]);
    assert.deepEqual((await f.receiptRows()).filter(row => row.memoryId !== originalId), [{
      memoryId: id, client: replay.client, sessionId: replay.sessionId, messageId: neighbor.id, marked: false,
    }]);
  });

  test(`Postgres ${mode} archive limits refusal to the exact owner, client and session`, migrationDbTest, async t => {
    const f = await fixture(t, keyed);
    await f.forget(await f.seedReceipt());

    assert.deepEqual(await f.archiveRaw(separate, [secondaryTurn]), { archived: 1 });
    assert.deepEqual(await f.archiveRaw(replay, [secondaryTurn], other), { archived: 1 });
    assert.deepEqual(await f.archiveRaw(otherClient, [secondaryTurn]), { archived: 1 });
    assert.deepEqual(new Set(await f.rawRows()), new Set([
      rawRow(separate, secondaryTurn), rawRow(replay, secondaryTurn, other), rawRow(otherClient, secondaryTurn),
    ]));
  });

  test(`Postgres ${mode} archive stores both messages before a receipt is forgotten`, migrationDbTest, async t => {
    const f = await fixture(t, keyed);
    await f.seedReceipt();

    const messages = [secondaryTurn, neighbor];
    assert.deepEqual(await f.archiveRaw(replay, messages), { archived: 2 });
    await f.capture(separate, messages);
    assert.deepEqual(new Set(await f.rawRows()), new Set([
      rawRow(primary, primaryTurn), ...messages.map(message => rawRow(replay, message)),
      ...messages.map(message => rawRow(separate, message)),
    ]));
  });
}
