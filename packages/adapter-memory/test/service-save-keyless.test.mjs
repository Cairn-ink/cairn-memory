import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { CAPABILITIES, CoreError } from "@cairn-ink/core";
import { forgetMethod } from "../../core/src/service/forget.mjs";
import { createMemoryService } from "../../core/src/service/index.mjs";
import { writeMethods } from "../../core/src/service/writes.mjs";

const scope = { owner: "synthetic-owner", namespace: "synthetic-project" };
const source = { kind: "mcp", client: "cairn-local-mcp", sessionId: "explicit-tool" };
const factText = "The synthetic albatross wears a teal scarf.";
const correctedText = "The synthetic albatross wears an amber scarf.";
const instruction = "Use the synthetic brass latch.";
const procedural = { anchors: [{ receiptIndex: 0, start: 0, end: 13 }] };
const receipt = eventId => ({ client: source.client, sessionId: source.sessionId,
  eventId, role: "user", occurredAtMs: null });
const sha256Hex = text => createHash("sha256").update(text).digest("hex");

function fixture(options) {
  const storage = createMemoryAdapter(options);
  function service(adapter = storage) {
    const deps = {
      storage: adapter,
      model: { model: "test", contextWindow: 100, countTokens: () => 1,
        async call() { assert.fail("Explicit writes do not call the model"); } },
      embedder: null,
      gate: { async assertOpen() {} },
      clock: { nowMs: () => 100, monotonicMs: () => 100, sha256Hex,
        async hmacHex() { assert.fail("These writes are keyless"); } },
      tokens: { countTokens: () => 1 },
      config: {},
    };
    // The current facade rejects the two optional flags until their runtime registry lands.
    // Use the registered facade for reads and the same production write methods for these flags.
    const registeredCaps = Object.fromEntries(Object.entries(adapter.capabilities).filter(([key]) => CAPABILITIES.includes(key)));
    const facade = createMemoryService({ ...deps, storage: { ...adapter, capabilities: registeredCaps } });
    return Object.keys(registeredCaps).length === Object.keys(adapter.capabilities).length
      ? facade : { ...facade, ...writeMethods(deps), forget: forgetMethod(deps) };
  }
  const readTx = fn => storage.uow.run(scope.owner, { readOnly: true }, fn);
  const index = () => readTx(tx => storage.memories.indexRevision(tx));
  const tag = id => readTx(tx => storage.proceduralTags.read(tx, scope, id));
  const inspect = id => service().read(scope, { type: "memory", id });
  return { storage, service, readTx, index, tag, inspect };
}

test("remember, remember duplicate and inspect item retain two receipts at stored revision 2", async () => {
  const { storage, service, readTx, index, inspect } = fixture({ receiptAttachAdvancesRevision: true });
  const { save } = service();
  const start = await index();
  const first = await save(scope, factText, source, "fact", { receipt: receipt("first") });
  assert.equal(first.status, "saved");
  assert.equal(first.item.revision, 1);
  assert.equal(first.indexRevision, start + 1);
  const id = first.item.id;
  const firstReceiptId = (await inspect(id)).receipts[0].id;
  assert.ok(firstReceiptId);

  const second = await save(scope, factText, source, "fact", { receipt: receipt("second") });
  assert.equal(second.status, "duplicate");
  assert.equal(second.item.id, id);
  assert.equal(second.item.revision, 2);
  assert.equal(second.indexRevision, first.indexRevision + 1);
  assert.equal(second.indexRevision, await index());
  assert.equal((await readTx(tx => storage.memories.readRevision(tx, scope, id))).revision, 2);
  const read = await inspect(id);
  assert.equal(read.status, "found");
  assert.equal(read.item.revision, 2);
  assert.equal(read.receipts.length, 2);
  assert.equal(read.receipts[0].id, firstReceiptId);
  assert.ok(read.receipts[1].id && read.receipts[1].id !== firstReceiptId);
  assert.deepEqual(read.receipts.map(({ id: _id, ...evidence }) => evidence), ["first", "second"].map(messageId => ({
    client: source.client, sessionId: source.sessionId, role: "user", occurredAtMs: null, messageId, excerpt: factText,
  })));

  const replay = await save(scope, factText, source, "fact", { receipt: receipt("second") });
  assert.equal(replay.item.revision, 2);
  assert.deepEqual((await inspect(id)).receipts, read.receipts);
});

test("a receipt-only duplicate keeps the memory revision when the flag is absent or false", async () => {
  for (const options of [{}, { receiptAttachAdvancesRevision: false }]) {
    const { storage, service, index, inspect } = fixture(options);
    const { save } = service();
    assert.notEqual(storage.capabilities.receiptAttachAdvancesRevision, true);
    const first = await save(scope, factText, source, "fact", { receipt: receipt("first") });
    const second = await save(scope, factText, source, "fact", { receipt: receipt("second") });
    assert.equal(second.status, "duplicate");
    assert.equal(second.item.revision, 1);
    assert.equal(second.indexRevision, first.indexRevision + 1);
    assert.equal(second.indexRevision, await index());
    assert.equal((await inspect(first.item.id)).receipts.length, 2);
  }
});

test("insert and touch return stable stored receipt IDs in input order and bump once per change", async () => {
  const { storage, service, inspect } = fixture({ receiptAttachAdvancesRevision: true });
  const { memories, uow } = storage;
  const row = { kind: "fact", origin: "explicit", confidence: 1, source, text: factText, embedding: null,
    textHash: "sha256:" + sha256Hex(factText.toLowerCase()) };
  const evidence = id => ({ ...receipt(id), messageId: id, excerpt: factText });
  const [a, b, c, d] = ["a", "b", "c", "d"].map(evidence);
  const write = body => uow.run(scope.owner, {}, body);
  const { id, receiptIds: [aId, bId, repeatId] } = await write(tx => memories.insert(tx, scope, row, [a, b, a], 100));
  assert.equal(aId, repeatId);
  const touch = async (receipts, merge) => write(tx => memories.touchDuplicate(tx, scope, id, receipts, merge, 101));
  const changed = await touch([b, d, a, c], { confidence: 0.9 });
  const read = await inspect(id);
  assert.deepEqual(read.receipts.map(item => item.messageId), ["a", "b", "d", "c"]);
  const [, , dId, cId] = read.receipts.map(item => item.id);
  assert.equal(new Set([aId, bId, cId, dId]).size, 4);
  assert.deepEqual(changed, { outcome: "changed", revision: 2, receiptIds: [bId, dId, aId, cId] });
  assert.deepEqual(await touch([c, a], { confidence: 0.9 }), { outcome: "touched", revision: 2, receiptIds: [cId, aId] });
  assert.equal((await service().read(scope, { type: "memory", id })).item.revision, 2);
});

test("remember invalid anchors, remember procedural and inspect procedural follow the golden", async () => {
  const { storage, service, index, inspect, tag } = fixture({ proceduralTags: true, receiptAttachAdvancesRevision: true });
  const { save } = service();
  const start = await index();
  const invalid = await save(scope, factText, source, "fact", { receipt: receipt("invalid"), procedural });
  assert.deepEqual(invalid, { status: "invalid" });
  assert.equal(await index(), start);
  assert.deepEqual(await storage.harness.dump(), []);

  const first = await save(scope, instruction, source, "instruction", { receipt: receipt("tagged"), procedural });
  assert.equal(first.status, "saved");
  assert.equal(first.item.revision, 1);
  assert.equal(first.indexRevision, start + 1);
  const id = first.item.id;
  const read = await inspect(id);
  assert.equal(read.receipts.length, 1);
  const expected = { tagRevision: 1, positive: true, origin: "explicit", anchors: [{
    receiptId: read.receipts[0].id, digest: "23270da8bfe17862cb0bd9230a6b1e569f3224a482912f1aafb2e0216a081df9", start: 0, end: 13,
  }] };
  assert.deepEqual(await tag(id), expected);
  for (const other of [{ ...scope, namespace: "other" }, { ...scope, owner: "other" }]) {
    assert.equal(await storage.uow.run(other.owner, { readOnly: true }, tx => storage.proceduralTags.read(tx, other, id)), null);
  }

  const second = await save(scope, instruction, source, "instruction", { receipt: receipt("second"), procedural });
  assert.equal(second.status, "duplicate");
  assert.equal(second.indexRevision, first.indexRevision + 1);
  const secondReceiptId = (await inspect(id)).receipts[1].id;
  assert.deepEqual(await tag(id), { ...expected, tagRevision: 2, anchors: [{ ...expected.anchors[0], receiptId: secondReceiptId }] });
});

test("correct clears the tag, forget clears another active tag, and resave forgotten is suppressed", async () => {
  const { storage, service, index, inspect, tag } = fixture({ proceduralTags: true });
  const { save, correct, forget } = service();
  const first = await save(scope, factText, source, "instruction", { receipt: receipt("tagged"), procedural });
  const { id, revision } = first.item;
  const corrected = await correct(scope, id, revision, correctedText, source, { receipt: receipt("corrected") });
  assert.equal(corrected.status, "saved");
  assert.deepEqual(await tag(id), { tagRevision: 2, positive: false, origin: null, anchors: [] });
  const retagged = await save(scope, correctedText, source, "instruction", { receipt: receipt("retagged"), procedural });
  assert.equal(retagged.status, "duplicate");
  assert.equal((await tag(id)).tagRevision, 3);
  let clearedInTx = false;
  const { forget: auditedForget } = service({ ...storage, proceduralTags: { ...storage.proceduralTags,
    async clear(tx, target, memoryId) {
      await storage.proceduralTags.clear(tx, target, memoryId);
      clearedInTx = true;
    },
  } });
  const forgotten = await auditedForget(scope, id, source, { expectedRevision: corrected.item.revision });
  assert.equal(forgotten.status, "forgotten");
  assert.equal(clearedInTx, true);
  assert.equal(await tag(id), null);
  assert.deepEqual(await inspect(id), { status: "not_found" });
  assert.deepEqual(await save(scope, correctedText, source, "fact", { receipt: receipt("resave") }),
    { status: "suppressed", indexRevision: forgotten.indexRevision });
  assert.equal(await index(), forgotten.indexRevision);
  assert.equal((await forget(scope, id, source)).status, "not_found");
});

test("failure after a procedural tag write rolls back the row, receipt, tag and index", async () => {
  const { storage, service, index, inspect, tag } = fixture({ proceduralTags: true });
  const start = await index();
  let writtenId;
  const { save } = service({ ...storage, proceduralTags: { ...storage.proceduralTags,
    async write(tx, target, id, value) {
      await storage.proceduralTags.write(tx, target, id, value);
      assert.equal((await storage.proceduralTags.read(tx, target, id)).positive, true);
      writtenId = id;
      throw new CoreError("internal_error");
    },
  } });
  await assert.rejects(save(scope, instruction, source, "instruction", { receipt: receipt("rollback"), procedural }),
    { code: "internal_error" });
  assert.ok(writtenId);
  assert.deepEqual(await inspect(writtenId), { status: "not_found" });
  assert.equal(await tag(writtenId), null);
  assert.deepEqual(await storage.harness.dump(), []);
  assert.equal(await index(), start);
});

test("save and correct report the committed revision after a Raw advance in the same run", async () => {
  const { storage, service, index } = fixture({ capabilities: { rawArchive: true } });
  const { memories, raw } = storage;
  const { save, correct } = service({ ...storage, memories: { ...memories,
    async insert(tx, target, ...args) {
      const result = await memories.insert(tx, target, ...args);
      await raw.fenceSession(tx, target, { client: "fixture", sessionId: "same-save-run" });
      return result;
    },
    async replaceContent(tx, target, ...args) {
      const result = await memories.replaceContent(tx, target, ...args);
      await raw.fenceSession(tx, target, { client: "fixture", sessionId: "same-correct-run" });
      return result;
    },
  } });
  const start = await index();
  const saved = await save(scope, factText, source);
  assert.equal(saved.status, "saved");
  assert.equal(saved.indexRevision, start + 2);
  assert.equal(saved.indexRevision, await index());
  const corrected = await correct(scope, saved.item.id, saved.item.revision, correctedText, source);
  assert.equal(corrected.status, "saved");
  assert.equal(corrected.indexRevision, saved.indexRevision + 2);
  assert.equal(corrected.indexRevision, await index());
});
