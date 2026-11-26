import assert from "node:assert/strict";
import { test } from "node:test";
import { contextReadTestService } from "@cairn-ink/conformance/context-read";
import { openSqliteAdapter } from "../src/index.mjs";
import { scratch, seedFact, sha256 } from "./storage-fixtures.mjs";

const scope = { owner: "fixture-owner", namespace: "project\0notes" };
const selection = { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [1] };
const source = { kind: "mcp", client: null, sessionId: null };
const text = "Synthetic receipt evidence";
const placeholder = {
  client: "codex", sessionId: "explicit-tool", messageId: "fixture-message",
  role: "user", occurredAtMs: null,
};

async function fixture(t) {
  const { path, remove } = scratch();
  let adapter;
  t.after(async () => {
    try { await adapter?.close(); }
    finally { remove(); }
  });
  adapter = await openSqliteAdapter(path, { capabilities: { contextRead: true, contextRawRead: true } });
  return { adapter, api: contextReadTestService(adapter) };
}

function seedWindow(adapter, options = {}) {
  return seedFact(adapter, {
    ...scope, kind: "window", actionId: "fixture-window", origin: "forget", client: placeholder.client,
    window: { startMs: 10, endMs: 20 }, unknownTime: true, ...options,
  });
}

async function archive(adapter, receipt, { target = scope, occurredAtMs = receipt.occurredAtMs } = {}) {
  const { client, sessionId, messageId: id, role } = receipt;
  const key = { scope: target, client, sessionId, eventId: "fixture-event", payloadDigest: sha256(text) };
  const messages = [{ id, role, occurredAtMs, content: text }];
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
  };
}

test("an unarchived placeholder remains visible under an unknown-time window", async t => {
  const opened = await fixture(t);
  const ref = await retain(opened.adapter, placeholder);
  await seedWindow(opened.adapter);
  assert.deepEqual(await paths(opened, placeholder, ref), { receiptWithheld: false, ...visible, save: "saved" });
});

test("an archived timeless turn cited by a placeholder stays withheld", async t => {
  const opened = await fixture(t);
  const { adapter, api } = opened;
  await archive(adapter, placeholder);
  const ref = await retain(adapter, placeholder);
  assert.deepEqual(await delivery(api, ref), visible);
  await seedWindow(adapter);
  assert.deepEqual(await paths(opened, placeholder, ref), { receiptWithheld: true, ...hidden, save: "suppressed" });

  const fork = { ...placeholder, messageId: "forked-message" };
  const rootScope = { ...scope, namespace: "project\0root" };
  await archive(adapter, fork, { occurredAtMs: 25 });
  await archive(adapter, fork, { target: rootScope });
  const forkRef = await retain(adapter, fork);
  assert.deepEqual(await delivery(api, forkRef), visible);
  await seedWindow(adapter, rootScope);
  assert.deepEqual(await delivery(api, forkRef), hidden);
});

test("an ordinary null-time receipt stays withheld", async t => {
  const opened = await fixture(t);
  const receipt = { ...placeholder, sessionId: "unknown" };
  const ref = await retain(opened.adapter, receipt);
  assert.deepEqual(await delivery(opened.api, ref), visible);
  await seedWindow(opened.adapter);
  assert.deepEqual(await paths(opened, receipt, ref), { receiptWithheld: true, ...hidden, save: "suppressed" });
});

test("a finite window still withholds a placeholder that cites an in-window turn", async t => {
  const opened = await fixture(t);
  await archive(opened.adapter, placeholder, { occurredAtMs: 15 });
  const ref = await retain(opened.adapter, placeholder);
  assert.deepEqual(await delivery(opened.api, ref), visible);
  await seedWindow(opened.adapter, { unknownTime: undefined });
  assert.deepEqual(await paths(opened, placeholder, ref), { receiptWithheld: true, ...hidden, save: "suppressed" });
});

test("forget-origin source and passage withholds still apply to placeholders", async t => {
  const opened = await fixture(t);
  const { adapter, api } = opened;
  const ref = await retain(adapter, placeholder);
  await seedWindow(adapter);
  const saved = await api.save(scope, text, source, "fact", { receipt: placeholder });
  assert.equal(saved.status, "saved");
  assert.equal((await api.forget(scope, saved.item.id, source)).status, "forgotten");
  assert.deepEqual(await paths(opened, placeholder, ref), { receiptWithheld: true, ...hidden, save: "suppressed" });

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
