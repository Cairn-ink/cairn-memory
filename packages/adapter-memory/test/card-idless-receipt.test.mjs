import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { createMemoryService } from "@cairn-ink/core/service";

const scope = { owner: "owner", namespace: "project" };
const message = { id: "turn", role: "user", occurredAtMs: 12,
  content: "Remember this cabinet inventory.\n" + "Each drawer contains a labeled set of brass hinges. ".repeat(5).trimEnd() };

async function captureCard(createAdapter = createMemoryAdapter) {
  const storage = createAdapter({ capabilities: { documentCards: true, documentCardSearch: true, rawArchive: true } });
  const countTokens = () => 1;
  const service = createMemoryService({ storage, config: { documentCards: { enabled: true } },
    model: { model: "test", contextWindow: 32_768, countTokens, async call() {
      return { items: [{ content: "The cabinet holds brass hinges.", kind: "fact", confidence: 1, sourceIndices: [0] }] };
    } },
    embedder: { model: "test", dimensions: 1, async embed(inputs) { return inputs.map(() => Float32Array.of(1)); } },
    tokens: { countTokens }, gate: { async assertOpen() {} },
    clock: { nowMs: Date.now, monotonicMs: () => performance.now(),
      async sha256Hex(text) { return createHash("sha256").update(text).digest("hex"); },
      async hmacHex() { assert.fail("Unexpected HMAC"); },
    },
  });
  const selection = { client: "client", sessionId: crypto.randomUUID(), eventId: "capture" };
  assert.equal((await service.enqueueCapture(scope, { ...selection, messages: [message] })).status, "accepted");
  const done = await service.runCapture(scope, selection);
  assert.equal(done.status, "done");
  assert.equal(done.result.memories.length, 1);
  const [{ rows }] = await storage.harness.dump();
  assert.equal(rows[0].receipts.length, 1);
  assert.equal(rows[0].receipts[0].id, undefined);
  const read = fn => storage.uow.run(scope.owner, { readOnly: true }, fn);
  const [card] = await read(tx => storage.documentCards.list(tx, scope));
  assert.ok(card, "Capture should write a router card");
  assert.equal(card.origin, "router");
  const ref = { type: "card", id: card.id, namespace: scope.namespace };
  return { storage, memoryId: done.result.memories[0].id, selection, async assertDelivery(visible) {
    const permitted = await read(tx => storage.fence.assertVisible(tx,
      { owner: scope.owner, namespaces: [scope.namespace] }, [ref]));
    const found = await service.find(scope, "cabinet", { kinds: ["card"] });
    const cardRead = await service.readCard(scope, card.id);
    assert.equal(found.layers.card.status, "ok");
    assert.deepEqual({ fence: permitted, found: found.cards.map(({ id }) => id), read: cardRead.status },
      { fence: visible ? [ref] : [], found: visible ? [card.id] : [], read: visible ? "found" : "not_found" });
  } };
}

test("an id-less capture receipt qualifies a router card until its memory is forgotten", async () => {
  const { storage, memoryId, assertDelivery } = await captureCard();
  await assertDelivery(true);
  await storage.harness.seedFact(scope.owner, { ...scope, kind: "identity", origin: "forget", actionId: "forget", memoryId });
  await assertDelivery(false);
});

test("an id-less capture receipt cannot qualify a router card without its finished claim", async () => {
  const entry = new URL("../src/index.mjs?claimFixture", import.meta.url).href;
  const original = new URL("../src/unit-of-work.mjs", import.meta.url).href;
  const fixture = `${original}?claimFixture`;
  // Expose the real unit of work so the test can remove only the finished claim.
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      return nextResolve(context.parentURL === entry && specifier === "./unit-of-work.mjs" ? fixture : specifier, context);
    },
    load(url, context, nextLoad) {
      if (url !== fixture) return nextLoad(url, context);
      const source = `import { createUnitOfWork as create } from ${JSON.stringify(original)};
        export * from ${JSON.stringify(original)};
        export let work;
        export function createUnitOfWork(...args) { return work = create(...args); }`;
      return { format: "module", source, shortCircuit: true };
    },
  });
  let adapter, control;
  try {
    adapter = await import(entry);
    control = await import(fixture);
  } finally {
    hooks.deregister();
  }
  const { storage, selection, assertDelivery } = await captureCard(adapter.createMemoryAdapter);
  await assertDelivery(true);
  await storage.uow.run(scope.owner, {}, tx => control.work.port.write(tx, scope, true, () => getState => {
    const { claims } = getState();
    const key = JSON.stringify([selection.client, selection.eventId]);
    assert.equal(claims.get(key)?.status, "finished");
    claims.delete(key);
  }));
  await assertDelivery(false);
});
