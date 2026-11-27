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
const source = { kind: "mcp", client: null, sessionId: null };
const now = 50_000;
const dimensions = 1536;
const embedding = text => {
  const unit = new Float32Array(dimensions);
  unit[[...text].reduce((hash, char) => (hash * 31 + char.codePointAt(0)) % dimensions, 7)] = 1;
  return unit;
};
const sha256Hex = text => createHash("sha256").update(text).digest("hex");
const hmacHex = (key, text) => createHmac("sha256", key).update(text).digest("hex");
const lineageSecret = "fixture-stored-lineage";
const mac = text => hmacHex(lineageSecret, text);
const stamp = "content:" + mac("\0cairn:w1a:raw-lineage");

const initial = { client: "test-client", sessionId: "initial-session", eventId: "initial-capture" };
const replay = { ...initial, sessionId: "replay-session", eventId: "replay-capture" };
const turn = (id, content) => ({ id, content, role: "user", occurredAtMs: 10_000 });
const initialTurn = turn("initial-message", "The equipment locker contains a folding ladder.");
const resent = turn("resent-message", "A kestrel flew over the orchard.");
const control = turn("control-message", "The garden has a rain barrel.");
const memoryText = "The ladder is available for maintenance.";

function proof(event, { id, content }) {
  return {
    message_mac: mac(id),
    content_mac: content === "" ? null :
      mac("\0cairn:raw-lineage-content:" + JSON.stringify([scope.owner, event.client, id, content])),
  };
}

function eventParams({ client, sessionId, eventId }) {
  return [scope.owner, client, sessionId, eventId];
}

async function fixture(t, keyed) {
  const { pool, source: database } = await migrationDatabase(t);
  await pool.query("INSERT INTO users (id) VALUES ($1)", [scope.owner]);
  await pool.query("INSERT INTO core_owner_state (user_id, legacy_facts_ready) VALUES ($1, true)", [scope.owner]);
  const uow = createPostgresUnitOfWork(database);
  const write = fn => uow.run(scope.owner, { pauseLock: true }, fn);
  const secret = keyed ? "fixture-fingerprint-key" : null;
  const keys = createPostgresFingerprintKeyProvider(secret, { uow });
  const key = keyed ? await userFingerprintKey(secret, scope.owner, HOSTED_FINGERPRINT_LABELS) : null;
  if (key) await keys.publish(scope.owner, key.id);

  const readOptions = { allowNonNullNamespace: true };
  const rawOptions = { lineageSecret, fingerprintKeys: async owner => key && owner === scope.owner ? [key] : [] };
  const { raw: archive, sessionLineage } = createPostgresRawPorts({ ...rawOptions,
    fingerprintKeys: async owner => (await rawOptions.fingerprintKeys(owner)).map(key => ({ pipeline: "core", key })) });
  const raw = { ...archive, ...createPostgresRawReads(rawOptions) };
  const reads = createPostgresMemoryReads({ ...readOptions, ...rawOptions });
  const memories = createPostgresMemoryStore({ ...readOptions, nearDuplicate: false });
  const capture = createPostgresCapturePorts({ ...readOptions, lineageSecret, nearDuplicate: false, now: () => now });
  const service = createMemoryService({
    storage: {
      name: "postgres", uow, keys, memories, raw, sessionLineage, capture, ...reads,
      quantityLedger: createPostgresQuantityLedgerStore(readOptions),
      pause: createPostgresPauseStore(),
      suppressions: createPostgresSuppressionStore({ ...readOptions, lineageSecret }),
      ...createPostgresMemoryCandidates(readOptions),
      capabilities: capabilities({ fingerprintKey: keyed, embeddingRequiredOnInsert: true, nearDuplicate: false,
        rawArchive: true, sessionLineage: true, quantityLedger: true }),
    },
    config: {},
    clock: { nowMs: () => now, monotonicMs: () => performance.now(), sha256Hex, hmacHex },
    gate: { assertOpen() {} }, tokens: { countTokens: () => 1 },
    model: { model: "fixture", contextWindow: 32_768, countTokens: () => 1,
      async call(stage, { input }) {
        assert.equal(stage, "extract");
        const items = input.messages.flatMap(({ content, index }) => content === initialTurn.content
          ? [{ content: memoryText, kind: "fact", confidence: 1, sourceIndices: [index] }] : []);
        return { items };
      } },
    embedder: { model: "fixture", dimensions, async embed(texts) { return texts.map(embedding); } },
  });

  const enqueue = (event, messages) => service.enqueueCapture(scope, { ...event, messages });
  async function forgetReceipt() {
    assert.deepEqual(await enqueue(initial, [initialTurn]), { status: "accepted" });
    const result = await service.runCapture(scope, initial);
    assert.equal(result.status, "done", result.code);
    const { memories: [{ id }] } = result.result;
    // Keep the receipt outside the fenced session and seed no earlier content proof for it.
    await write(tx => memories.touchDuplicate(tx, scope, id, [{
      client: replay.client, sessionId: replay.sessionId, messageId: resent.id,
      role: resent.role, occurredAtMs: resent.occurredAtMs,
    }], { confidence: 1 }, now));
    assert.equal((await service.forget(scope, id, source)).status, "forgotten");
  }

  const outbox = async event => (await pool.query(`SELECT raw_request, raw_lineage_key_id FROM capture_events
    WHERE user_id = $1 AND client = $2 AND session_id = $3 AND event_id = $4`, eventParams(event))).rows[0];
  const proofs = async ({ client, sessionId }) => (await pool.query(`
    SELECT message_mac, content_mac FROM capture_raw_lineage WHERE user_id = $1 AND client = $2 AND session_id = $3`,
  [scope.owner, client, sessionId])).rows;
  return { pool, write, capture, raw, enqueue, forgetReceipt, outbox, proofs };
}

for (const keyed of [false, true]) {
  const mode = keyed ? "keyed" : "keyless";

  test(`Postgres ${mode} stamps a blanked outbox without signing forgotten content`, migrationDbTest, async t => {
    const f = await fixture(t, keyed);
    await f.forgetReceipt();
    assert.deepEqual(await f.enqueue(replay, [resent, control]), { status: "accepted" });
    const stored = await f.outbox(replay);
    assert.deepEqual(stored.raw_request.messages.map(({ id, content }) => ({ id, content })), [
      { id: resent.id, content: "" }, { id: control.id, content: control.content },
    ]);
    assert.equal(stored.raw_lineage_key_id, stamp, "the blanked outbox must be stamped");
    const proofs = await f.proofs(replay);
    const forgottenMac = proof(replay, resent).content_mac;
    assert.ok(proofs.every(({ content_mac }) => content_mac !== forgottenMac), "forgotten content must have no MAC");
    assert.deepEqual(new Set(proofs), new Set([proof(replay, { ...resent, content: "" }), proof(replay, control)]));

    // A legacy ancestor match on the control ID would withhold this edit even though its content differs.
    await f.write(tx => f.raw.fenceSession(tx, scope, replay));
    const editedControl = { ...control, content: "The garden has a water tank." };
    assert.deepEqual(await f.write(tx => f.raw.importArchive(tx, scope,
      { client: replay.client, sessionId: "import-session" }, [editedControl])),
    { archived: 1, existing: 0, withheld: 0 });
  });

  test(`Postgres ${mode} stamps an unchanged outbox and signs both turns`, migrationDbTest, async t => {
    const f = await fixture(t, keyed);
    assert.deepEqual(await f.enqueue(replay, [resent, control]), { status: "accepted" });
    assert.equal((await f.outbox(replay)).raw_lineage_key_id, stamp);
    assert.deepEqual(new Set(await f.proofs(replay)), new Set([proof(replay, resent), proof(replay, control)]));
  });

  test(`Postgres ${mode} leaves a different non-empty outbox unstamped`, migrationDbTest, async t => {
    const f = await fixture(t, keyed);
    const messages = [resent, control];
    const key = { scope, ...replay, payloadDigest: sha256Hex(JSON.stringify(messages)) };
    assert.deepEqual(await f.write(tx => f.capture.admit(tx, key, messages)), { status: "admitted" });

    const replacement = "An otter swam past the bridge.";
    const { rows: [edited] } = await f.pool.query(`UPDATE capture_events
      SET raw_request = jsonb_set(raw_request, '{messages,0,content}', to_jsonb($5::text))
      WHERE user_id = $1 AND client = $2 AND session_id = $3 AND event_id = $4 RETURNING raw_request`,
    [...eventParams(replay), replacement]);
    assert.equal(edited.raw_request.messages[0].content, replacement);
    await f.write(tx => f.raw.recordLineage(tx, key, messages));

    assert.equal((await f.outbox(replay)).raw_lineage_key_id, null);
    assert.deepEqual(new Set(await f.proofs(replay)), new Set([proof(replay, resent), proof(replay, control)]));
  });
}
