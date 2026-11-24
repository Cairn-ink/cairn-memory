import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { coreDigest, factIncarnationBody } from "@cairn-ink/core";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { createMemoryService } from "@cairn-ink/core/service";
import { hostedScope as scope, serviceFake } from "../../core/test/helpers/service-fake.mjs";

const sha256Hex = text => createHash("sha256").update(text).digest("hex");
const selection = (sessionId, eventId = sessionId) => ({ client: "client", sessionId, eventId });
const message = (id, content, occurredAtMs = Date.UTC(2025, 0, 1)) => ({ id, role: "user", content, occurredAtMs });
const plan = message("plan", "Remember this maintenance plan. " +
  "The hatch opens at 8 each morning. ".repeat(7).trimEnd());
const extract = (content, sourceIndices = [0]) => ({ content, sourceIndices, kind: "fact", confidence: 0.9 });
const documentCards = { enabled: true };

function fixture(storage, { config = { documentCards }, model = {}, embedder = {}, gate } = {}) {
  const { deps } = serviceFake({ writes: true, capture: true, hasKey: false });
  const diagnostics = [];
  const service = createMemoryService({
    ...deps, storage, config, diagnostics: event => diagnostics.push(event),
    clock: { ...deps.clock, sha256Hex },
    model: model === null ? null : { ...deps.model, async call() { return { items: [] }; }, ...model },
    embedder: embedder === null ? null : { ...deps.embedder, ...embedder },
    ...(gate && { gate }),
  });
  const enqueue = (event, messages) => service.enqueueCapture(scope, { ...event, messages });
  const run = event => service.runCapture(scope, event);
  async function capture(event, messages) {
    assert.deepEqual(await enqueue(event, messages), { status: "accepted" });
    return run(event);
  }
  const read = work => storage.uow.run(scope.owner, { readOnly: true }, work);
  const write = work => storage.uow.run(scope.owner, { pauseLock: true }, work);
  return { service, enqueue, run, capture, read, write, diagnostics };
}

test("review probe: a deleted Raw message never reaches card embedding on recapture", async () => {
  const adapter = createMemoryAdapter({ capabilities: { rawArchive: true, documentCards: true } });
  const sends = [];
  const f = fixture(adapter, { model: null, embedder: {
    async embed(texts) {
      sends.push(...texts);
      return texts.map(() => Float32Array.of(1));
    },
  } });
  const initial = selection("initial");
  assert.equal((await f.capture(initial, [plan])).status, "done");
  assert.equal(sends.length, 1);
  assert.deepEqual(await f.write(tx => adapter.raw.deleteConversation(tx, scope, initial)), { rawDeleted: 1 });

  sends.length = 0;
  const replay = await f.capture(selection(initial.sessionId, "replay"), [plan]);
  assert.deepEqual(sends, []);
  assert.equal(replay.status, "done");

  const fresh = message("fresh", plan.content.replaceAll("hatch", "gate"));
  assert.equal((await f.capture(selection("fresh"), [fresh])).status, "done");
  assert.equal(sends.length, 1);
  assert.ok(sends[0].includes(fresh.content));
  const raw = await f.read(tx => adapter.raw.listRaw(tx, { owner: scope.owner, namespaces: [scope.namespace] },
    { cursor: null, limit: 10 }));
  assert.ok(raw.items.some(({ messageId }) => messageId === fresh.id));
});

test("review probe: count-only finish suppression commits the surviving memory without an ambiguous card", async () => {
  const adapter = createMemoryAdapter({ capabilities: { documentCards: true } });
  const withheld = "The spare key is in the locker.";
  const survivor = "The hatch opens at 8 each morning.";
  const fact = { ...scope, kind: "text", mode: "exact", origin: "forget", actionId: "withhold",
    text: { digests: [await coreDigest(withheld)] } };
  let observedCount;
  const f = fixture({ ...adapter, capture: { ...adapter.capture, async finish(tx, token, items) {
    await adapter.suppressions.writeFact(tx, fact, sha256Hex(factIncarnationBody(fact)));
    const { suppressedItems, ...result } = await adapter.capture.finish(tx, token, items);
    observedCount = suppressedItems?.length;
    return result;
  } } }, { model: { async call() { return { items: [extract(withheld), extract(survivor)] }; } } });
  const done = await f.capture(selection("count-only"), [plan]);
  assert.equal(observedCount, 1);
  assert.equal(done.status, "done");
  assert.equal(done.result.memories.length, 1);
  const memory = await f.read(tx => adapter.memories.get(tx, scope, done.result.memories[0].id));
  assert.equal(memory.text, survivor);
  assert.deepEqual(await f.read(tx => adapter.documentCards.list(tx, scope)), []);
  assert.ok(f.diagnostics.some(({ reason }) => reason === "capture_finish_mapping_unavailable"));
});

test("review probe: forgetting the bound memory during detect prevents the verify send", async () => {
  const adapter = createMemoryAdapter({ capabilities: { documentCards: true } });
  const quote = "The hatch now opens at 10.";
  let cardId, memoryId, forgotten;
  let verifies = 0;
  const f = fixture(adapter, { config: { documentCards: { enabled: true, amendments: true } }, model: {
    async call() { return { items: cardId ? [] : [extract("The hatch opens at 8.")] }; },
    async detectChanges() {
      forgotten = await f.service.forget(scope, memoryId, { kind: "web", client: null, sessionId: null });
      return { changes: [{ card_id: cardId, quote, new_value: quote }] };
    },
    async verifyChange() {
      verifies++;
      return { applies: true, line: quote };
    },
  } });
  const first = await f.capture(selection("plan"), [plan]);
  assert.equal(first.status, "done");
  memoryId = first.result.memories[0].id;
  const [card] = await f.read(tx => adapter.documentCards.list(tx, scope));
  cardId = card.id;
  assert.deepEqual(card.sourceMemories, [{ id: memoryId, revision: 1 }]);
  const next = await f.capture(selection("update"), [message("update", quote, Date.UTC(2025, 0, 2))]);
  assert.equal(forgotten?.status, "forgotten");
  assert.equal(next.status, "done");
  assert.equal(verifies, 0);
  assert.ok(f.diagnostics.some(({ reason }) => reason === "verify_skipped_ineligible"));
});

test("review probe: capture resolves a canonical retained receipt with inspect disabled", async () => {
  const adapter = createMemoryAdapter({ capabilities: { contextRead: true, inspect: false } });
  assert.equal(adapter.inspect, undefined);
  const rows = [];
  const quantityLedger = {
    async listForMemory() { return []; },
    async put(_tx, _scope, inserted) { rows.push(...inserted); return { inserted: inserted.length }; },
  };
  const purchase = message("purchase", "Tea cost 6 USD.");
  const storage = { ...adapter, capabilities: { ...adapter.capabilities, quantityLedger: true }, quantityLedger };
  const options = {
    config: { quantityLedger: { enabled: true } }, model: { async call() {
      return { items: [extract(purchase.content)], quantities: [{ item: 0, kind: "record", measure: "spend",
        category: "tea", value: 6, unit: "USD", group: "food", period: "none", comparator: "none" }] };
    } },
  };
  const f = fixture(storage, options);
  const done = await f.capture(selection("purchase"), [purchase]);
  assert.equal(done.status, "done");
  assert.equal(rows.length, 1);
  const [{ receiptId, memoryId, value, date }] = rows;
  const [{ rows: [{ receipts: [retained] }] }] = await adapter.harness.dump();
  assert.ok(retained.id);
  assert.equal(receiptId, retained.id);
  assert.deepEqual([memoryId, value, date], [done.result.memories[0].id, 6, purchase.occurredAtMs]);

  const missing = fixture({ ...storage,
    capture: { ...adapter.capture, async retainedReceiptIds() { return [null]; } },
  }, options);
  assert.equal((await missing.capture(selection("other"), [purchase])).status, "done");
  assert.equal(rows.length, 1);
  assert.deepEqual(missing.diagnostics, [
    { version: 1, stage: "extract", layer: "core_finish", reason: "ledger_receipt_unresolved" },
  ]);
});

test("a model with no embedder cannot capture with or without documents", async () => {
  for (const config of [{}, { documentCards }]) {
    for (const embeddingRequiredOnInsert of [false, true]) {
      const adapter = createMemoryAdapter({ capabilities: { documentCards: true, embeddingRequiredOnInsert } });
      const f = fixture(adapter, { config, embedder: null });
      await assert.rejects(f.enqueue(selection("plan"), [plan]), { code: "capability_unavailable" });
      await assert.rejects(f.run(selection("plan")), { code: "capability_unavailable" });
    }
  }
});

test("the model-less card-only keyless exception writes a lexical card with no embedder", async () => {
  const adapter = createMemoryAdapter({ capabilities: { documentCards: true, embeddingRequiredOnInsert: true } });
  const f = fixture(adapter, { model: null, embedder: null });
  const done = await f.capture(selection("plan"), [plan]);
  assert.equal(done.status, "done");
  assert.deepEqual(done.result.memories, []);
  const [card] = await f.read(tx => adapter.documentCards.list(tx, scope));
  assert.equal(card.body, plan.content);
});

test("card embedding gates bracket the send and check the pause generation after pre-send", async () => {
  for (const pauseBeforeDispatch of [false, true]) {
    const adapter = createMemoryAdapter({ capabilities: { documentCards: true } });
    const trace = [];
    const f = fixture(adapter, { model: null, embedder: {
      async embed() { trace.push("embed"); return [Float32Array.of(1)]; },
    }, gate: { async assertOpen(_, phase) {
      trace.push(phase);
      if (phase === "pre-send" && pauseBeforeDispatch) {
        await f.service.setPause(scope.owner, true);
        await f.service.setPause(scope.owner, false);
      }
    } } });
    const result = await f.capture(selection("plan"), [plan]);
    assert.equal(result.status, pauseBeforeDispatch ? "paused" : "done");
    assert.deepEqual(trace, pauseBeforeDispatch ? ["pre-send"] : ["pre-send", "dispatch", "embed", "post-send"]);
  }
});
