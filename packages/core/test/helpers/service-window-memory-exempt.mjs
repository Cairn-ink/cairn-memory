import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createMemoryService } from "@cairn-ink/core/service";

export const windowMemoryScope = { owner: "fixture-owner", namespace: null };
const scope = windowMemoryScope;
const readSet = { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [1] };
const page = { cursor: null, limit: 10 };
const minute = 60_000;
const anchor = Date.UTC(2025, 0, 1);
const original = "A cedar sample belongs on the lower shelf.";
const replacement = "A birch sample belongs in the locked cupboard.";
const neighbor = "The observatory opens before sunrise.";
const web = { kind: "web", client: null, sessionId: null };
const mcp = { kind: "mcp", client: null, sessionId: null };
const receipt = eventId => ({ client: "cairn-local-mcp", sessionId: "explicit-tool", role: "user", eventId, occurredAtMs: null });
const inside = { id: "inside", role: "user", occurredAtMs: anchor + 10 * minute,
  content: "Remember this inventory procedure. " +
    "Count the brass latches in each drawer before opening the cabinet. ".repeat(6).trimEnd() };
const outside = { id: "outside", role: "user", occurredAtMs: anchor - 40 * minute,
  content: "The inventory includes a stack of folded maps." };

function fixture(t, { seedReceipt, ...storage }, enabled = true) {
  let now = anchor;
  const { fingerprintKey, embeddingRequiredOnInsert, documentCards } = storage.capabilities;
  const model = fingerprintKey ? { model: "fixture", contextWindow: 32_768, countTokens: () => 1,
    async call() { return { items: [] }; } } : null;
  // Distinct embeddings keep text suppression independent of the window.
  const dimensions = embeddingRequiredOnInsert ? 1536 : 3;
  const embedder = model || embeddingRequiredOnInsert ? { model: "fixture", dimensions,
    async embed(texts) {
      return texts.map(text => {
        const vector = new Float32Array(dimensions);
        vector[text.includes("birch") ? 1 : text.includes("observatory") ? 2 : 0] = 1;
        return vector;
      });
    } } : null;
  const service = createMemoryService({
    storage, model, embedder, gate: { assertOpen() {} }, tokens: { countTokens: () => 1 },
    clock: { nowMs: () => now, monotonicMs: () => performance.now(),
      sha256Hex: text => createHash("sha256").update(text).digest("hex"),
      async hmacHex(key, text) {
        return Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text))).toString("hex");
      } },
    config: { explicitWindowFence: { enabled }, ...(documentCards ? { documentCards: { enabled: true } }
      : model ? {} : { rawCapture: { enabled: true } }) },
    contextReadCounter: { count: text => Math.ceil(text.length / 4) }, contextReadFormat: JSON.stringify,
  });
  return {
    service, storage, seedReceipt,
    time: minutes => { now = anchor + minutes * minute; },
    read: fn => storage.uow.run(scope.owner, { readOnly: true }, fn),
    write: fn => storage.uow.run(scope.owner, { pauseLock: true }, fn),
    facts: t.mock.method(storage.suppressions, "writeFact"),
  };
}

async function save({ service, seedReceipt }, text, evidence) {
  if (evidence) await seedReceipt?.(evidence, text);
  const result = await service.save(scope, text, evidence ? mcp : web, "fact", evidence && { receipt: evidence });
  assert.equal(result.status, "saved");
  return result.item;
}

async function archive(f) {
  const event = { client: "fixture-client", sessionId: "fixture-capture", eventId: "fixture-event" };
  assert.equal((await f.service.enqueueCapture(scope, { ...event, messages: [inside, outside] })).status, "accepted");
  const result = await f.service.runCapture(scope, event);
  assert.equal(result.status, "done", result.code);
  await assertRaw(f, [inside, outside]);
}

async function assertRaw({ service }, messages) {
  const ids = messages.map(({ id }) => id).sort();
  const listed = await service.listRawMessages(scope, page);
  assert.deepEqual(listed.items.filter(({ occurredAtMs }) => occurredAtMs !== null)
    .map(({ messageId }) => messageId).sort(), ids, "Raw list");
  const found = await service.find(scope, "inventory", { kinds: ["raw"] });
  assert.equal(found.layers.raw.status, "ok", "Raw search ran");
  assert.deepEqual(found.raw.map(({ messageId }) => messageId).sort(), ids, "Raw search");
}

async function place({ storage: { placement }, write }, memory) {
  if (!placement) return null;
  return write(async tx => {
    const { indexRevision } = await placement.catalog(tx, scope, page);
    const { createdTopics: [topic] } = await placement.applyPlacement(tx, scope,
      { indexRevision, memoryRevisions: [{ memoryId: memory.id, revision: memory.revision }] },
      { items: [{ memoryId: memory.id, parentIds: [], newL1: { title: "Fixture topic", parentL2Ids: [] } }] });
    return topic.id;
  });
}

async function assertMemory(t, { service, storage, read }, memory, query, topic, evidence) {
  const { id, revision, text } = memory;
  const ref = { type: "memory", id };
  const project = item => [item.id, item.revision, item.text];
  const expected = [id, revision, text];
  await t.test("read", async () => {
    const result = await service.read(scope, ref);
    assert.equal(result.status, "found");
    assert.deepEqual(project(result.item), expected);
    assert.deepEqual(result.receipts.map(({ client, sessionId, messageId, occurredAtMs }) =>
      [client, sessionId, messageId, occurredAtMs]), evidence ? [[evidence.client, evidence.sessionId, evidence.eventId, null]] : []);
  });
  await t.test("recall", async () => {
    const { items } = await service.recall(scope, query, { ...page, mode: "search" });
    assert.deepEqual(items.map(project), [expected]);
  });
  await t.test("find", async () => {
    const { layers, memories } = await service.find(scope, query, { kinds: ["memory"] });
    assert.equal(layers.memory.status, "ok");
    assert.deepEqual(memories.map(project), [expected]);
  });
  await t.test("recent and export", async () => {
    for (const result of [await service.recent(scope, page), await service.exportMemories(scope, page)]) {
      assert.deepEqual(result.items.map(project), [expected]);
    }
  });
  if (storage.capabilities.contextRead) await t.test("Context Read", async () => {
    const result = await service.readContext(readSet,
      { query, types: ["memory"], intent: "current", semantic: false, raw: false, deadlineMs: 5_000 });
    assert.deepEqual(result.assembly.items.map(({ body }) => body), [text]);
    assert.deepEqual(result.diagnostics.items.map(({ ref }) => [ref.id, ref.revision]), [[id, revision]]);
  });
  if (storage.capabilities.inspect) await t.test("inspect", async () => {
    const inspected = await service.inspect(scope, { memoryId: id });
    assert.deepEqual(project(inspected.memory), expected);
    assert.deepEqual(inspected.receipts.map(({ excerpt }) => excerpt), evidence ? [text] : []);
  });
  if (topic !== null) await t.test("topics", () => read(async tx => {
    const { placement } = storage;
    assert.deepEqual(await placement.forMemory(tx, scope, id), [topic], "membership by memory");
    const annotations = await placement.forMemories?.(tx, scope, [id]);
    if (annotations !== undefined) {
      assert.deepEqual(annotations.map(item => [item.memoryId, item.topics.map(({ id }) => id)]), [[id, [topic]]]);
    }
    const { items } = await placement.list(tx, scope, page);
    assert.deepEqual(items.map(item => [item.id, item.memberCount, item.newestMemberIds]), [[topic, 1, [id]]]);
    const members = await placement.members(tx, scope, topic, page);
    assert.deepEqual(members.items.map(item => [item.kind, item.id]), [["memory", id]]);
  }));
}

function assertWindows({ facts }, expected) {
  assert.deepEqual(facts.mock.calls.map(call => call.arguments[1]).filter(fact => fact.kind === "window")
    .map(({ anchor: type, client, window: { startMs, endMs } }) => [type, client, startMs, endMs]),
  expected ? [["pm30min", null, anchor - 30 * minute, anchor + 30 * minute]] : []);
}

async function corrected(t, storage, { explicitReceipt = false, enabled = true } = {}) {
  const f = fixture(t, storage, enabled);
  const saved = await save(f, original, explicitReceipt ? receipt("save") : undefined);
  await archive(f);
  f.time(60);
  const evidence = explicitReceipt ? receipt("correct") : undefined;
  if (evidence) await f.seedReceipt?.(evidence, replacement);
  const result = await f.service.correct(scope, saved.id, saved.revision, replacement, explicitReceipt ? mcp : web,
    evidence && { receipt: evidence });
  assertWindows(f, enabled);
  await assertRaw(f, enabled ? [outside] : [inside, outside]);
  const expected = { id: saved.id, revision: saved.revision + 1, text: replacement };
  assert.equal(await f.read(async tx => (await f.storage.memories.get(tx, scope, saved.id))?.revision), expected.revision);
  assert.equal(result.status, "saved", "correct delivered the replacement");
  assert.deepEqual([result.item.id, result.item.revision, result.item.text, result.item.createdAtMs, result.item.updatedAtMs],
    [expected.id, expected.revision, expected.text, anchor, anchor + 60 * minute]);
  await assertMemory(t, f, expected, "birch", await place(f, expected), evidence);
}

async function forgotten(t, storage, enabled = true) {
  const f = fixture(t, storage, enabled);
  const saved = await save(f, original);
  await archive(f);
  const card = storage.capabilities.documentCards ? await f.read(async tx => {
    const cards = await storage.documentCards.list(tx, scope);
    const routed = cards.find(({ sourceMessage }) => sourceMessage?.messageId === inside.id);
    assert.equal(routed?.origin, "router");
    return routed.id;
  }) : null;
  if (card !== null) assert.equal((await f.service.readCard(scope, card)).status, "found");
  f.time(60);
  assert.equal((await f.service.forget(scope, saved.id, web)).status, "forgotten");
  assertWindows(f, enabled);
  assert.deepEqual(await f.service.read(scope, { type: "memory", id: saved.id }), { status: "not_found" });
  if (storage.capabilities.inspect) {
    await assert.rejects(f.service.inspect(scope, { memoryId: saved.id }), { code: "memory_not_found" });
  }
  await assertRaw(f, enabled ? [outside] : [inside, outside]);
  if (card !== null) {
    assert.equal((await f.service.readCard(scope, card)).status, enabled ? "not_found" : "found");
    const found = await f.service.find(scope, "inventory", { kinds: ["card"] });
    assert.equal(found.layers.card.status, "ok");
    assert.equal(found.cards.some(({ id }) => id === card), !enabled);
  }
}

async function nearby(t, storage, evidence) {
  const f = fixture(t, storage);
  const saved = await save(f, original);
  f.time(10);
  const kept = await save(f, neighbor, evidence);
  assert.equal(kept.createdAtMs, anchor + 10 * minute);
  const topic = await place(f, kept);
  f.time(60);
  assert.equal((await f.service.forget(scope, saved.id, web)).status, "forgotten");
  assertWindows(f, true);
  await assertMemory(t, f, kept, "observatory", topic, evidence);
}

export const windowMemoryScenarios = {
  "(a) a session-less web correction stays visible": corrected,
  "(b) an MCP correction with a placeholder receipt stays visible": (t, storage) =>
    corrected(t, storage, { explicitReceipt: true }),
  "(c) forget removes the memory and withholds Raw and router cards in the window": forgotten,
  "(d) forget leaves a nearby receipt-free memory visible": nearby,
  "(d) forget leaves a nearby memory with a placeholder receipt visible": (t, storage) =>
    nearby(t, storage, receipt("neighbor")),
  "(e) fence off preserves correction and Raw visibility": (t, storage) => corrected(t, storage, { enabled: false }),
  "(e) fence off preserves forget behavior and Raw and card visibility": (t, storage) => forgotten(t, storage, false),
};
