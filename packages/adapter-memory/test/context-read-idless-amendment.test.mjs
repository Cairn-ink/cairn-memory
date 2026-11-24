import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { assemblyClock, fixtureCount, formatAssembly } from "@cairn-ink/conformance/context-assembly";
import { createMemoryService } from "@cairn-ink/core/service";

async function legacyCaptureAdapter() {
  const entry = new URL("../src/index.mjs?idlessFixture", import.meta.url).href;
  const capture = new URL("../src/capture.mjs", import.meta.url).href;
  const unitOfWork = new URL("../src/unit-of-work.mjs", import.meta.url).href;
  const modules = new Map([
    // Exercise the original ID-less capture writer with the current read ports.
    ["./capture.mjs", [capture, `
      import { createCapturePorts as create } from ${JSON.stringify(capture)};
      export function createCapturePorts(port, store, now, facts, embeddingRequired, archive, flags) {
        return create(port, store, now, facts, embeddingRequired, archive, { ...flags, contextRead: false });
      }
    `]],
    ["./unit-of-work.mjs", [unitOfWork, `
      export * from ${JSON.stringify(unitOfWork)};
      import { createUnitOfWork as create } from ${JSON.stringify(unitOfWork)};
      export let work;
      export function createUnitOfWork(...args) { return work = create(...args); }
    `]],
  ]);
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      const module = context.parentURL === entry && modules.get(specifier);
      return nextResolve(module ? module[0] + "?idlessFixture" : specifier, context);
    },
    load(url, context, nextLoad) {
      for (const [original, source] of modules.values()) {
        if (url === original + "?idlessFixture") return { format: "module", source, shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  });
  try {
    const { createMemoryAdapter } = await import(entry);
    const control = await import(unitOfWork + "?idlessFixture");
    const storage = createMemoryAdapter({ capabilities: { contextRead: true, documentCards: true, rawArchive: true } });
    return { storage, port: control.work.port };
  } finally {
    hook.deregister();
  }
}

test("Context Read keeps a captured router card when its ID-less amendment loses the finished claim", async () => {
  const { storage, port } = await legacyCaptureAdapter();
  const scope = { owner: "owner", namespace: null };
  const readSet = { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [1] };
  const body = "Remember this cabinet inventory.\n" +
    "Each drawer contains a labeled set of brass hinges. ".repeat(5).trimEnd();
  const quote = "The upper drawer is now empty.";
  const countTokens = () => 1;
  const service = createMemoryService({
    storage, config: { documentCards: { enabled: true } }, clock: assemblyClock(),
    contextReadCounter: { count: fixtureCount }, contextReadFormat: formatAssembly,
    model: { model: "test", contextWindow: 32_768, countTokens, async call(_stage, { input }) {
      const content = input.messages[0].content === quote ? quote : "The cabinet holds brass hinges.";
      return { items: [{ content, kind: "fact", confidence: 1, sourceIndices: [0] }] };
    } },
    embedder: { model: "test", dimensions: 1, async embed(inputs) { return inputs.map(() => Float32Array.of(1)); } },
    tokens: { countTokens }, gate: { async assertOpen() {} },
  });
  const read = fn => storage.uow.run(scope.owner, { readOnly: true }, fn);
  const write = fn => storage.uow.run(scope.owner, { pauseLock: true }, fn);
  async function capture(eventId, content) {
    const selection = { client: "fixture", sessionId: eventId, eventId };
    const message = { id: "turn", role: "user", content, occurredAtMs: Date.UTC(2025, 4, 1) };
    assert.equal((await service.enqueueCapture(scope, { ...selection, messages: [message] })).status, "accepted");
    const done = await service.runCapture(scope, selection);
    assert.equal(done.status, "done", done.code);
    assert.equal(done.result.memories.length, 1);
    return { ...selection, messageId: message.id };
  }
  const original = await capture("inventory", body);
  const [card] = await read(tx => storage.documentCards.list(tx, scope));
  assert.equal(card.origin, "router");
  const update = await capture("update", quote);
  const [{ rows }] = await storage.harness.dump();
  for (const address of [original, update]) {
    const receipts = rows.flatMap(row => row.receipts).filter(receipt => receipt.sessionId === address.sessionId);
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].id, undefined);
  }
  const { client, sessionId, messageId, eventId } = update;
  await write(tx => storage.documentCards.amend(tx, scope, card.id, {
    amendmentId: "upper-drawer", date: "2025-05-01", sentence: quote, quote,
    sourceMessage: { client, sessionId, messageId },
  }));

  const assemble = async () => (await service.readContext(readSet,
    { query: "cabinet", types: ["card"], intent: "current", raw: false })).assembly.items;
  const before = await assemble();
  assert.deepEqual(before.map(({ ref }) => ref.id), [card.id]);
  assert.ok(before[0].body.includes(quote));
  assert.deepEqual(before[0].sources.map(({ excerpt }) => excerpt), [quote]);

  await write(tx => port.write(tx, scope, "conditional", () => (getState, _markDirty, run) => {
    const { claims } = getState();
    const key = JSON.stringify([client, eventId]);
    assert.equal(claims.get(key)?.status, "finished");
    claims.delete(key);
    run.stateWritten = true;
  }));
  const after = await assemble();
  assert.deepEqual(after.map(({ ref }) => ref.id), [card.id]);
  assert.equal(after[0].body, `${card.title}\n${card.body}`);
  assert.deepEqual(after[0].sources, []);
});
