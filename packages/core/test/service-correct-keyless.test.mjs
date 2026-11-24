import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { CoreError } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { hostedScope as scope, memory, serviceFake } from "./helpers/service-fake.mjs";

const source = { kind: "mcp", client: "original-client", sessionId: "original-session" };
const editor = { kind: "web", client: "editor-client", sessionId: "editor-session" };
const oldText = "The albatross wears a teal scarf.";
const newText = "The albatross wears an amber scarf.";
const oldHash = createHash("sha256").update(oldText.toLowerCase()).digest("hex");
const original = { ...memory("target", { text: oldText }), source, textHash: `sha256:${oldHash}` };
const receipt = { client: "editor-client", sessionId: "editor-session", eventId: "correction-event",
  role: "user", occurredAtMs: 42 };

function setup({ fingerprintKey = false, withProvider = true, withEmbedder = true,
  embeddingRequiredOnInsert = false, withIndex = true } = {}) {
  const fake = serviceFake({ rows: [original], writes: true, capture: true, hasKey: false });
  const { deps, storage } = fake;
  Object.assign(storage.capabilities, { fingerprintKey, embeddingRequiredOnInsert });
  if (!withProvider) delete storage.keys;
  if (!withEmbedder) deps.embedder = null;
  const indexReads = [];
  if (withIndex) storage.memories.indexRevision = async tx => {
    indexReads.push(tx);
    return 12;
  };
  const service = createMemoryService(deps);
  return { ...fake, service, indexReads,
    correct: (text, options) => service.correct(scope, original.id, original.revision, text, editor, options) };
}

function rejectsWith(code) {
  return error => error instanceof CoreError && error.code === code;
}

test("correction with fingerprintKey off records exact keyless suppression and predecessor lineage", async () => {
  const { correct, committed, mutations, indexReads } = setup();
  const result = await correct(newText);
  assert.equal(result.status, "saved");
  assert.equal(result.indexRevision, 13);
  assert.equal(indexReads.length, 1);
  assert.equal(result.item.text, newText);
  assert.equal(result.item.revision, original.revision + 1);
  assert.deepEqual(result.item.source, source);
  assert.equal(result.item.origin, "explicit");
  assert.deepEqual(mutations.map(({ method }) => method), ["suppressions.writeFact", "memories.replaceContent"]);
  assert.equal(mutations[1].args[3], null);
  const [{ fact }] = committed(scope.owner).facts;
  assert.equal(fact.origin, "edit");
  assert.equal(fact.kind, "text");
  assert.equal(fact.mode, "exact");
  assert.deepEqual(fact.sourceMemory, { id: original.id, createdAtMs: original.createdAtMs });
  assert.equal(fact.text.keyId, null);
  assert.deepEqual(new Set(fact.text.digests.map(({ alg, keyId }) => `${alg}:${keyId}`)), new Set(["sha256:null"]));
  assert.ok(fact.text.digests.some(({ value }) => value === oldHash));
  assert.ok(!Object.hasOwn(fact.text, "shingles"));
  assert.ok(!Object.hasOwn(fact.text, "embedding"));
});

test("correction with fingerprintKey on and a null provider lookup refuses before any write", async () => {
  const { correct, calls, mutations } = setup({ fingerprintKey: true });
  await assert.rejects(correct(newText), rejectsWith("fingerprint_unavailable"));
  assert.deepEqual(mutations, []);
  assert.ok(!calls.some(([method]) => method === "embed"));
});

test("correction can proceed when no fingerprint provider is configured", async () => {
  const { correct, committed } = setup({ fingerprintKey: true, withProvider: false });
  assert.equal((await correct(newText)).status, "saved");
  assert.equal(committed(scope.owner).facts[0].fact.mode, "exact");
});

test("changing the text applies the requested kind", async () => {
  const { correct } = setup();
  const result = await correct(newText, { kind: "instruction" });
  assert.equal(result.status, "saved");
  assert.equal(result.item.kind, "instruction");
});

test("identical text returns the starting index revision without a kind or receipt write", async () => {
  const { correct, mutations, indexReads, calls } = setup();
  assert.deepEqual(await correct(oldText, { kind: "instruction", receipt }),
    { status: "unchanged", item: original, indexRevision: 12 });
  assert.deepEqual(mutations, []);
  assert.equal(indexReads.length, 1);
  assert.ok(!calls.some(([method]) => method === "embed"));
});

test("correction passes exactly one replacement receipt with the prepared text", async () => {
  const { eventId, ...metadata } = receipt;
  for (const identity of [{ eventId }, { messageId: eventId }]) {
    const { correct, mutations } = setup();
    const input = "  The albatross   wears an amber scarf.  ";
    const result = await correct(input, { receipt: { ...metadata, ...identity, excerpt: "Host input" } });
    assert.equal(result.status, "saved");
    assert.equal(result.item.text, newText);
    const replacement = mutations.find(({ method }) => method === "memories.replaceContent");
    assert.deepEqual(replacement.args[3], [{ ...metadata, messageId: eventId, excerpt: newText }]);
  }
});

test("correction writes a null embedding when no embedder is configured and embeddings are optional", async () => {
  const { correct, mutations, calls } = setup({ withEmbedder: false });
  const result = await correct(newText);
  assert.equal(result.status, "saved");
  assert.equal(result.item.embedding, null);
  const replacement = mutations.find(({ method }) => method === "memories.replaceContent");
  assert.equal(replacement.args[2].embedding, null);
  assert.ok(!calls.some(([method, , phase]) => method === "gate" && phase === "dispatch"));
});

test("correction with a required embedding and no embedder fails before any write", async () => {
  const { correct, mutations, calls } = setup({ withEmbedder: false, embeddingRequiredOnInsert: true });
  await assert.rejects(correct(newText), rejectsWith("embedding_failed"));
  assert.deepEqual(mutations, []);
  assert.ok(!calls.some(([method, , phase]) => method === "gate" && phase === "dispatch"));
});

test("a configured embedder failure still aborts the correction when embeddings are optional or required", async () => {
  for (const [embeddingRequiredOnInsert, code] of [[false, "provider_error"], [true, "embedding_failed"]]) {
    const { correct, hooks, mutations } = setup({ embeddingRequiredOnInsert });
    hooks.embed = () => { throw new CoreError("provider_error"); };
    await assert.rejects(correct(newText), rejectsWith(code));
    assert.deepEqual(mutations, []);
  }
});

test("save, capture admission and processing, and import refuse a null embedder before sending or writing", async () => {
  const { service, calls, mutations } = setup({ withEmbedder: false });
  const event = { client: "capture-client", sessionId: "capture-session", eventId: "capture-event" };
  const message = { id: "message", role: "user", content: newText, occurredAtMs: 42 };
  const unavailable = rejectsWith("capability_unavailable");
  await assert.rejects(service.save(scope, newText, editor), unavailable);
  await assert.rejects(service.enqueueCapture(scope, { ...event, messages: [message] }), unavailable);
  await assert.rejects(service.runCapture(scope, event), unavailable);
  await assert.rejects(service.importMemories(scope, [{ text: newText, kind: "fact" }], editor), unavailable);
  assert.deepEqual(mutations, []);
  assert.deepEqual(calls, []);
});

test("correction omits the index revision when the store has no accessor", async () => {
  const { correct } = setup({ withIndex: false });
  for (const [text, status] of [[oldText, "unchanged"], [newText, "saved"]]) {
    const result = await correct(text);
    assert.equal(result.status, status);
    assert.ok(!Object.hasOwn(result, "indexRevision"));
  }
});

test("stale and missing corrections return the starting index revision without writes", async () => {
  const { service, mutations, indexReads } = setup();
  assert.deepEqual(await service.correct(scope, original.id, original.revision + 1, newText, editor),
    { status: "conflict", indexRevision: 12 });
  assert.deepEqual(await service.correct(scope, "missing", original.revision, newText, editor),
    { status: "not_found", indexRevision: 12 });
  assert.deepEqual(mutations, []);
  assert.equal(indexReads.length, 2);
});

test("a row lost before the write transaction returns not_found at its starting index revision", async () => {
  const { correct, hooks, forget, mutations, indexReads } = setup();
  hooks.embed = () => forget(original);
  assert.deepEqual(await correct(newText), { status: "not_found", indexRevision: 12 });
  assert.deepEqual(mutations, []);
  assert.equal(indexReads.length, 1);
});

test("a row revised during embedding returns conflict at the write transaction's starting index revision", async () => {
  const { correct, hooks, storage, mutations, indexReads } = setup();
  const get = storage.memories.get;
  hooks.embed = () => {
    storage.memories.get = async (...args) => ({ ...await get(...args), revision: original.revision + 1 });
  };
  assert.deepEqual(await correct(newText), { status: "conflict", indexRevision: 12 });
  assert.deepEqual(mutations, []);
  assert.equal(indexReads.length, 1);
});

test("a row lost at post-commit delivery returns not_found with the advanced index revision", async () => {
  const { correct, hooks, forget, mutations, indexReads } = setup();
  hooks.beforeRun = (_, options) => { if (options.readOnly) forget(original); };
  assert.deepEqual(await correct(newText), { status: "not_found", indexRevision: 13 });
  assert.deepEqual(mutations.map(({ method }) => method), ["suppressions.writeFact", "memories.replaceContent"]);
  assert.equal(indexReads.length, 1);
});
