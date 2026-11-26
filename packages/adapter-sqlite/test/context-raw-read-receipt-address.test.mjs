import assert from "node:assert/strict";
import { test } from "node:test";
import { allDigests, factIncarnationBody } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { assemblyClock, fixtureCount, formatAssembly } from "@cairn-ink/conformance/context-assembly";
import { createMemoryAdapter } from "../../adapter-memory/src/index.mjs";
import { openSqliteAdapter } from "../src/index.mjs";
import { scratch, seedFact, sha256 } from "./storage-fixtures.mjs";

const scope = { owner: "owner", namespace: null };
const session = { client: "client", sessionId: "session" };
const event = { ...session, eventId: "capture" };
const conversationId = JSON.stringify([session.client, session.sessionId]);
const message = { id: "message", role: "user", content: "The bronze compass sits beside the trail map.",
  occurredAtMs: Date.UTC(2025, 0, 2, 3, 4, 50) };
const sourceDate = "2025-01-02T03:04Z";
const body = "The compass is next to the map.";
const source = { kind: "mcp", client: null, sessionId: null };
const query = { query: "compass", types: ["memory"], intent: "current", raw: true, semantic: false };
const readSet = ({ owner, namespace } = scope) => ({ owner, namespaces: [namespace], accessGenerations: [1] });
const write = (adapter, work, target = scope) => adapter.uow.run(target.owner, { pauseLock: true }, work);

async function open(t) {
  const file = scratch();
  let adapter;
  t.after(async () => {
    try { await adapter?.close(); }
    finally { file.remove(); }
  });
  adapter = await openSqliteAdapter(file.path, { capabilities: { contextRead: true, contextRawRead: true } });
  return adapter;
}

function service(storage, options) {
  return createMemoryService({
    storage, clock: assemblyClock(), contextReadCounter: { count: fixtureCount }, contextReadFormat: formatAssembly,
    ...options,
  });
}

async function capture(adapter, { target = scope, turn = message } = {}) {
  const api = service(adapter, {
    config: {},
    model: { model: "fixture", contextWindow: 16_384, countTokens: () => 1,
      async call(stage, { input }) {
        assert.equal(stage, "extract");
        assert.deepEqual(input.messages.map(({ index }) => index), [0]);
        return { items: [{ content: body, kind: "fact", confidence: 0.9, sourceIndices: [0] }] };
      } },
    gate: { async assertOpen() {} }, tokens: { countTokens: () => 1 },
    embedder: { model: "fixture", dimensions: 1, async embed(inputs) { return inputs.map(() => Float32Array.of(1)); } },
  });
  assert.deepEqual(await api.enqueueCapture(target, { ...event, messages: [turn] }), { status: "accepted" });
  const finished = await api.runCapture(target, event);
  assert.equal(finished.status, "done", JSON.stringify(finished));
  assert.equal(finished.result.memories.length, 1);
  const [memory] = finished.result.memories;
  const archived = await api.listRawMessages(target, { limit: 10 });
  assert.deepEqual(archived.items.map(({ messageId }) => messageId), [turn.id]);
  return { api, memory };
}

async function searchRaw(adapter, target) {
  const projection = readSet(target);
  return adapter.uow.run(projection.owner, { readOnly: true }, tx =>
    adapter.contextRead.raw.search(tx, projection, query.query, { limit: 10, lexicalOnly: true }));
}

async function assertAttached(adapter, api, target = scope, turn = message) {
  const raw = await searchRaw(adapter, target);
  assert.deepEqual(raw.turns.map(({ witness, ...result }) => result), [
    { scope: target, conversationId, messageId: turn.id, role: turn.role, occurredAtMs: turn.occurredAtMs,
      ranges: [{ start: 0, text: turn.content }] },
  ]);
  const { assembly } = await api.readContext(readSet(target), query);
  const item = assembly.items.find(candidate => candidate.ref.type === "memory" && candidate.body === body);
  assert.ok(item);
  assert.equal(item.date, sourceDate);
  assert.equal(item.evidence?.length, 1);
  const [evidence] = item.evidence;
  assert.deepEqual(evidence.ref, { ns: 0, type: "raw", conversationId, messageId: turn.id });
  assert.equal(evidence.date, sourceDate);
  assert.equal(evidence.occurredAt, new Date(turn.occurredAtMs).toISOString());
  assert.ok(turn.content.includes(evidence.body) && evidence.body.includes("compass"));
  return evidence;
}

async function assertWithheld(adapter, api, target = scope) {
  const raw = await searchRaw(adapter, target);
  assert.deepEqual(raw.turns, []);
  const result = await api.readContext(readSet(target), query);
  const { assembly } = result;
  for (const item of assembly.items) {
    assert.equal(item.ref.type, "memory");
    assert.deepEqual(item.evidence ?? [], []);
    assert.deepEqual(item.sources, []);
    assert.equal(item.date, undefined);
  }
  const wire = JSON.stringify(result);
  assert.ok(!wire.includes("bronze"));
  assert.ok(!wire.includes(sourceDate));
  assert.ok(!wire.includes(new Date(message.occurredAtMs).toISOString()));
  return assembly;
}

test("Core capture attaches a proved address-only Raw turn and date on both adapters", async t => {
  const memory = createMemoryAdapter({ capabilities: { contextRead: true, contextRawRead: true, rawArchive: true } });
  const sqlite = await open(t);
  const { api: memoryApi } = await capture(memory);
  const { api: sqliteApi } = await capture(sqlite);
  const expected = await assertAttached(memory, memoryApi);
  assert.deepEqual(await assertAttached(sqlite, sqliteApi), expected);
});

const privacyCases = [
  ["forgetting the citing memory", async (_adapter, { api, memory }) => {
    assert.equal((await api.forget(scope, memory.id, source)).status, "forgotten");
  }],
  ["forgetting the Raw passage", async adapter => {
    const fact = { ...scope, kind: "rawSpan", origin: "forget", actionId: "forget-passage",
      sessionKeyHash: adapter.hashSessionKey(scope, session.client, session.sessionId), messageKey: message.id,
      startUtf16: 0, endUtf16: message.content.length, contentDigest: sha256(message.content) };
    const incarnation = sha256(factIncarnationBody(fact));
    await write(adapter, async tx => {
      const result = await adapter.suppressions.writeFact(tx, fact, incarnation);
      assert.equal(result.created, true);
      const purged = await adapter.raw.purgeWithheld(tx, scope, [{ ...result, fact, incarnation }]);
      assert.equal(purged.rawDeleted, 1);
    });
  }],
  ["fencing the Raw session", adapter => write(adapter, tx => adapter.raw.fenceSession(tx, scope, session))],
  ["a matching text fact", async adapter => {
    const result = await seedFact(adapter, { ...scope, kind: "text", mode: "exact", origin: "forget",
      actionId: "forget-text", text: { digests: await allDigests(message.content, null) } });
    assert.equal(result.created, true);
  }],
  ["an owner-wide time-window fact", async adapter => {
    const { occurredAtMs } = message;
    const result = await seedFact(adapter, { owner: scope.owner, kind: "window", client: null, origin: "forget",
      actionId: "forget-window", window: { startMs: occurredAtMs, endMs: occurredAtMs + 1 } });
    assert.equal(result.created, true);
  }],
];

for (const [name, withdraw] of privacyCases) {
  test(`Address-only Raw search and evidence withhold the turn after ${name}`, async t => {
    const adapter = await open(t);
    const captured = await capture(adapter);
    await assertAttached(adapter, captured.api);
    await withdraw(adapter, captured);
    await assertWithheld(adapter, captured.api);
  });
}

test("Forgetting a separate memory with the exact 800-character prefix hides the long Raw turn", async t => {
  const adapter = await open(t);
  const content = (message.content + " ").repeat(18).trimEnd();
  const turn = { ...message, content };
  const prefix = content.slice(0, 800);
  assert.ok(content.length > 800);
  const { api } = await capture(adapter, { turn });
  await assertAttached(adapter, api, scope, turn);
  const { assembly: before } = await api.readContext(readSet(), query);
  assert.equal(before.items.find(item => item.body === body).sources[0].excerpt, prefix);
  const saved = await api.save(scope, prefix, source);
  assert.equal(saved.status, "saved");
  assert.equal((await api.forget(scope, saved.item.id, source)).status, "forgotten");

  const assembly = await assertWithheld(adapter, api);
  assert.deepEqual(assembly.items.map(item => item.body), [body]);
});

test("A cited Raw turn in another owner's namespace stays private", async t => {
  const adapter = await open(t);
  const localScope = { ...scope, namespace: "project\0shared" };
  const otherScope = { ...localScope, owner: "other-owner" };
  const { api } = await capture(adapter, { target: otherScope });
  await assertAttached(adapter, api, otherScope);
  const assembly = await assertWithheld(adapter, api, localScope);
  assert.deepEqual(assembly.items, []);
});

test("A Raw turn cited only by a stored excerpt still attaches to the memory", async t => {
  const adapter = await open(t);
  const api = service(adapter, { profile: "keyless-local" });
  const key = { scope, ...event, payloadDigest: sha256(message.content) };
  const memoryId = await write(adapter, async tx => {
    assert.equal((await adapter.capture.admit(tx, key, [message])).status, "admitted");
    const claim = await adapter.capture.claim(tx, key, [message], { leaseMs: 10_000 });
    assert.equal(claim.status, "claimed");
    await adapter.capture.beginDispatch(tx, claim.token);
    await adapter.raw.recordLineage(tx, key, [message]);
    assert.equal((await adapter.raw.archive(tx, key, [message])).archived, 1);
    await adapter.capture.assertEligible(tx, key, [0]);
    const result = await adapter.capture.finish(tx, claim.token, [{
      content: body, kind: "fact", confidence: 0.9, embedding: null, textHash: "sha256:" + sha256(body.toLowerCase()),
      receipts: [{ ...session, messageId: message.id, role: message.role, occurredAtMs: message.occurredAtMs,
        excerpt: message.content }],
    }]);
    assert.equal(result.memories.length, 1);
    return result.memories[0].id;
  });
  const inspected = await api.inspect(scope, { memoryId });
  assert.deepEqual(inspected.receipts.map(({ excerpt }) => excerpt), [message.content]);
  await assertAttached(adapter, api);

  const uncited = { ...message, id: "uncited", content: "The compass points north.", occurredAtMs: null };
  assert.equal((await write(adapter, tx => adapter.raw.importArchive(tx, scope, session, [uncited]))).archived, 1);
  assert.deepEqual((await searchRaw(adapter)).turns.map(turn => turn.messageId).sort(), [message.id, uncited.id]);
  const { assembly } = await api.readContext(readSet(), query);
  assert.deepEqual(assembly.items.filter(item => item.ref.type === "raw").map(item => item.ref.messageId), [uncited.id]);
});

test("A keyless store with no memory receipts still surfaces Raw turns", async t => {
  const adapter = await open(t);
  const api = service(adapter, { profile: "keyless-local" });
  await write(adapter, async tx => {
    await adapter.memories.insert(tx, scope, { text: body, kind: "fact", origin: "explicit", source, confidence: 1,
      embedding: null, textHash: "sha256:" + sha256(body.toLowerCase()) }, [], 1);
    assert.equal((await adapter.raw.importArchive(tx, scope, session, [message])).archived, 1);
  });
  assert.deepEqual((await searchRaw(adapter)).turns.map(turn => turn.messageId), [message.id]);
  const { assembly } = await api.readContext(readSet(), query);
  const item = assembly.items.find(candidate => candidate.ref.type === "memory");
  assert.equal(item.body, body);
  assert.deepEqual(item.sources, []);
  assert.equal(item.evidence, undefined);
  assert.deepEqual(assembly.items.filter(candidate => candidate.ref.type === "raw")
    .map(({ ref, date }) => [ref.messageId, date]), [[message.id, sourceDate]]);
});
