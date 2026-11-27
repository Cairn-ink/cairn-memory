import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryService } from "@cairn-ink/core/service";
import { assemblyClock, fixtureCount, formatAssembly } from "@cairn-ink/conformance/context-assembly";
import { contextReadTestService } from "@cairn-ink/conformance/context-read";
import { createSqliteAdapter } from "../src/adapter.mjs";
import { openSqliteAdapter } from "../src/index.mjs";
import { openStorage } from "../src/schema/open.mjs";
import { scratch, seedFact, sha256 } from "./storage-fixtures.mjs";

const scope = { owner: "fixture-owner", namespace: "project\0notes" };
const rootScope = { ...scope, namespace: "project\0root" };
const selection = { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [1] };
const source = { kind: "mcp", client: null, sessionId: null };
const text = "Synthetic receipt evidence";
const capturedBody = "The receipt documents a capture";
const search = { query: "receipt", types: ["memory"], intent: "current", semantic: false };
const placeholder = {
  client: "codex", sessionId: "explicit-tool", messageId: "fixture-message",
  role: "user", occurredAtMs: null,
};

async function fixture(t, { legacyRawHashing = false } = {}) {
  const { path, remove } = scratch();
  let adapter;
  t.after(async () => {
    try { await adapter?.close(); }
    finally { remove(); }
  });
  const options = { capabilities: { contextRead: true, contextRawRead: true } };
  adapter = legacyRawHashing
    ? createSqliteAdapter({ ...await openStorage(path), legacyRawHashing }, options)
    : await openSqliteAdapter(path, options);
  return { adapter, api: contextReadTestService(adapter) };
}

function seedWindow(adapter, options = {}) {
  return seedFact(adapter, {
    ...scope, kind: "window", actionId: "fixture-window", origin: "forget", client: placeholder.client,
    window: { startMs: 10, endMs: 20 }, unknownTime: true, ...options,
  });
}

async function archive(adapter, receipt, { target = scope, occurredAtMs = receipt.occurredAtMs, content = text } = {}) {
  const { client, sessionId, messageId: id, role } = receipt;
  const key = { scope: target, client, sessionId, eventId: "fixture-event", payloadDigest: sha256(content) };
  const messages = [{ id, role, occurredAtMs, content }];
  await adapter.uow.run(target.owner, { pauseLock: true }, async tx => {
    await adapter.raw.recordLineage(tx, key, messages);
    assert.equal((await adapter.raw.archive(tx, key, messages)).archived, 1);
  });
}

async function retain(adapter, receipt) {
  const body = "Synthetic memory with a retained receipt";
  const { id, revision } = await adapter.uow.run(scope.owner, {}, tx =>
    adapter.memories.insert(tx, scope, {
      kind: "fact", text: body, textHash: "sha256:" + sha256(body.toLowerCase()),
      source, origin: "explicit", confidence: 1, embedding: null,
    }, [{ ...receipt, excerpt: text }], 1));
  return { scope, type: "memory", id, revision };
}

function assemblyService(storage) {
  return createMemoryService({
    storage, clock: assemblyClock(), config: {},
    model: { model: "fixture", contextWindow: 16_384, countTokens: () => 1,
      async call(stage) {
        assert.equal(stage, "extract");
        return { items: [{ content: capturedBody, kind: "fact", confidence: 0.9, sourceIndices: [0] }] };
      } },
    gate: { async assertOpen() {} }, tokens: { countTokens: () => 1 },
    embedder: { model: "fixture", dimensions: 1, async embed(inputs) { return inputs.map(() => Float32Array.of(1)); } },
    contextReadCounter: { count: fixtureCount }, contextReadFormat: formatAssembly,
  });
}

async function captureAddress(api, { client, sessionId, messageId, role }) {
  const event = { client, sessionId, eventId: "fixture-capture" };
  const messages = [{ id: messageId, role, occurredAtMs: 25, content: text }];
  assert.deepEqual(await api.enqueueCapture(scope, { ...event, messages }), { status: "accepted" });
  const finished = await api.runCapture(scope, event);
  assert.equal(finished.status, "done", JSON.stringify(finished));
  assert.equal(finished.result.memories.length, 1);
  const [{ id, revision }] = finished.result.memories;
  assert.deepEqual((await api.inspect(scope, { memoryId: id })).receipts, []);
  return { scope, type: "memory", id, revision };
}

function withholds(adapter, receipt, excerpt = text) {
  return adapter.uow.run(scope.owner, { readOnly: true }, tx =>
    adapter.suppressions.receiptWithheld(tx, scope, { ...receipt, excerpt }));
}

async function delivery(api, ref) {
  const inspected = await api.inspect(scope, { memoryId: ref.id });
  const { items: [{ provenance }] } = await api.fetchEvidence(selection, { refs: [ref], intent: "current" });
  return {
    inspectCount: inspected.memory.receiptCount,
    inspectExcerpts: inspected.receipts.map(receipt => receipt.excerpt),
    contextSources: provenance.sources.length,
    contextReceipts: provenance.receiptMetadata.length,
  };
}

const visible = { inspectCount: 1, inspectExcerpts: [text], contextSources: 1, contextReceipts: 1 };
const hidden = { inspectCount: 0, inspectExcerpts: [], contextSources: 0, contextReceipts: 0 };

async function paths({ adapter, api }, receipt, ref) {
  return {
    receiptWithheld: await withholds(adapter, receipt),
    ...await delivery(api, ref),
    save: (await api.save(scope, text, source, "fact", { receipt })).status,
    correct: (await api.correct(scope, ref.id, ref.revision, text, source, { receipt })).status,
  };
}

test("an unarchived placeholder remains visible under an unknown-time window", async t => {
  const opened = await fixture(t);
  const ref = await retain(opened.adapter, placeholder);
  await seedWindow(opened.adapter);
  assert.deepEqual(await delivery(opened.api, ref), visible);
  assert.equal(await withholds(opened.adapter, placeholder), false);
  assert.equal((await opened.api.save(scope, text, source, "fact", { receipt: placeholder })).status, "saved");

  const replacement = "Revised synthetic receipt evidence";
  assert.equal((await opened.api.correct(scope, ref.id, ref.revision, replacement, source, { receipt: placeholder })).status, "saved");
});

test("an unrelated archived turn in the placeholder session does not block explicit writes", async t => {
  const { adapter, api } = await fixture(t);
  await archive(adapter, { ...placeholder, messageId: "other-message", occurredAtMs: 25 },
    { content: "An unrelated archived turn" });
  const ref = await retain(adapter, placeholder);
  const result = {
    ...await delivery(api, ref),
    receiptWithheld: await withholds(adapter, placeholder),
    save: (await api.save(scope, text, source, "fact", { receipt: placeholder })).status,
    correct: (await api.correct(scope, ref.id, ref.revision, "An independent correction", source,
      { receipt: placeholder })).status,
  };
  assert.deepEqual(result, { receiptWithheld: false, save: "saved", correct: "saved", ...hidden });
});

test("a visible cited turn under a migrated Raw alias does not block explicit writes", async t => {
  const { adapter, api } = await fixture(t, { legacyRawHashing: true });
  const sessionId = "legacy-raw:" + adapter.hashSessionKey(scope, placeholder.client, placeholder.sessionId);
  await archive(adapter, { ...placeholder, sessionId, occurredAtMs: 25 });
  const ref = await retain(adapter, placeholder);
  const result = {
    ...await delivery(api, ref),
    receiptWithheld: await withholds(adapter, placeholder),
    save: (await api.save(scope, text, source, "fact", { receipt: placeholder })).status,
    correct: (await api.correct(scope, ref.id, ref.revision, "An independent correction", source,
      { receipt: placeholder })).status,
  };
  assert.deepEqual(result, { receiptWithheld: false, save: "saved", correct: "saved", ...hidden });
});

test("an archived timeless turn cited by a placeholder stays withheld", async t => {
  const opened = await fixture(t);
  const { adapter, api } = opened;
  await archive(adapter, placeholder);
  const ref = await retain(adapter, placeholder);
  assert.deepEqual(await delivery(api, ref), visible);
  await seedWindow(adapter);
  assert.deepEqual(await paths(opened, placeholder, ref), {
    receiptWithheld: true, ...hidden, save: "suppressed", correct: "suppressed",
  });
});

const lineageCases = [
  ["a timeless root in another session", scope, true],
  ["a timeless root in another namespace", rootScope, true],
  ["a timeless root without a direct archive row", scope, false],
];

for (const [name, target, direct] of lineageCases) {
  test(`placeholder admission with ${name}`, async t => {
    for (const operation of ["save", "correct"]) {
      await t.test(operation, async t => {
        const { adapter, api } = await fixture(t);
        const context = assemblyService(adapter);
        if (direct) await archive(adapter, placeholder, { occurredAtMs: 25 });
        await archive(adapter, { ...placeholder, sessionId: "fixture-root" }, { target });
        const ref = await retain(adapter, placeholder);
        if (direct) assert.deepEqual(await delivery(api, ref), visible);

        await seedWindow(adapter, target);
        assert.deepEqual(await delivery(api, ref), hidden);

        const result = operation === "save"
          ? await api.save(scope, text, source, "fact", { receipt: placeholder })
          : await api.correct(scope, ref.id, ref.revision, text, source, { receipt: placeholder });
        const inspected = await api.inspect(scope, { memoryId: result.item?.id ?? ref.id });
        const read = await context.readContext(selection, { ...search, raw: target !== scope });
        assert.deepEqual({
          receiptWithheld: await withholds(adapter, placeholder),
          status: result.status,
          inspectReturnedText: JSON.stringify(inspected).includes(text),
          contextReturnedText: JSON.stringify(read).includes(text),
        }, { receiptWithheld: true, status: "suppressed", inspectReturnedText: false, contextReturnedText: false });
      });
    }
  });
}

test("address-only Raw evidence is withheld by an unknown-time window in the root namespace", async t => {
  const { adapter } = await fixture(t);
  const api = assemblyService(adapter);
  const ref = await captureAddress(api, placeholder);
  await archive(adapter, { ...placeholder, sessionId: "fixture-root" }, { target: rootScope });
  const fetch = () => api.fetchEvidence(selection, { refs: [ref], intent: "current" });
  const read = () => api.readContext(selection, { ...search, raw: true });
  const before = await read();
  assert.ok((await fetch()).items[0].provenance.sources.length > 0);
  const item = before.assembly.items.find(item => item.body === capturedBody);
  assert.ok(item?.evidence?.some(evidence => evidence.body === text));

  await seedWindow(adapter, rootScope);
  const after = await read();
  assert.deepEqual((await fetch()).items[0].provenance.sources, []);
  const retained = after.assembly.items.find(item => item.body === capturedBody);
  assert.ok(retained);
  assert.deepEqual(retained.evidence ?? [], []);
  assert.equal(JSON.stringify(after).includes(text), false);
});

test("an ordinary null-time receipt stays withheld", async t => {
  const opened = await fixture(t);
  const receipt = { ...placeholder, sessionId: "unknown" };
  const ref = await retain(opened.adapter, receipt);
  assert.deepEqual(await delivery(opened.api, ref), visible);
  await seedWindow(opened.adapter);
  assert.deepEqual(await paths(opened, receipt, ref), { receiptWithheld: true, ...hidden, save: "suppressed", correct: "suppressed" });
});

test("a finite window still withholds a placeholder that cites an in-window turn", async t => {
  const opened = await fixture(t);
  await archive(opened.adapter, placeholder, { occurredAtMs: 15 });
  const ref = await retain(opened.adapter, placeholder);
  assert.deepEqual(await delivery(opened.api, ref), visible);
  await seedWindow(opened.adapter, { unknownTime: undefined });
  assert.deepEqual(await paths(opened, placeholder, ref), {
    receiptWithheld: true, ...hidden, save: "suppressed", correct: "suppressed",
  });
});

test("forget-origin source and passage withholds still apply to placeholders", async t => {
  const opened = await fixture(t);
  const { adapter, api } = opened;
  const ref = await retain(adapter, placeholder);
  await seedWindow(adapter);
  const saved = await api.save(scope, text, source, "fact", { receipt: placeholder });
  assert.equal(saved.status, "saved");
  assert.equal((await api.forget(scope, saved.item.id, source)).status, "forgotten");
  assert.deepEqual(await paths(opened, placeholder, ref), {
    receiptWithheld: true, ...hidden, save: "suppressed", correct: "suppressed",
  });

  const fresh = { ...placeholder, messageId: "fresh-message" };
  assert.equal(await withholds(adapter, fresh), false);
  const passageApi = contextReadTestService({
    ...adapter, memories: {
      ...adapter.memories,
      readWritePolicy() { assert.fail("The passage snapshot should suppress before the Memory write policy"); },
    },
  });
  assert.equal((await passageApi.save(scope, text, source, "fact", { receipt: fresh })).status, "suppressed");
});
