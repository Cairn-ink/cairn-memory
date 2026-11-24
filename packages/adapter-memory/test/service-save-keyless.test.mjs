import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { CoreError } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";

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
  const storage = createMemoryAdapter({ ...options, capabilities: { ...options?.capabilities, inspect: true } });
  function service(adapter = storage, overrides = {}) {
    return createMemoryService({
      storage: adapter,
      model: { model: "test", contextWindow: 100, countTokens: () => 1,
        async call() { assert.fail("Explicit writes do not call the model"); } },
      embedder: null,
      gate: { async assertOpen() {} },
      clock: { nowMs: () => 100, monotonicMs: () => 100, sha256Hex,
        async hmacHex() { assert.fail("These writes are keyless"); } },
      tokens: { countTokens: () => 1 },
      config: {},
      ...overrides,
    });
  }
  const readTx = fn => storage.uow.run(scope.owner, { readOnly: true }, fn);
  const index = () => readTx(tx => storage.memories.indexRevision(tx));
  const tag = id => readTx(tx => storage.proceduralTags.read(tx, scope, id));
  const inspect = id => service().inspect(scope, { memoryId: id });
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
  const [firstReceipt] = (await inspect(id)).receipts;
  assert.equal(firstReceipt.messageId, "first");

  const second = await save(scope, factText, source, "fact", { receipt: receipt("second") });
  assert.equal(second.status, "duplicate");
  assert.equal(second.item.id, id);
  assert.equal(second.item.revision, 2);
  assert.equal(second.indexRevision, first.indexRevision + 1);
  assert.equal(second.indexRevision, await index());
  assert.equal((await readTx(tx => storage.memories.readRevision(tx, scope, id))).revision, 2);
  const read = await inspect(id);
  assert.equal(read.mode, "item");
  assert.equal(read.memory.revision, 2);
  const sortedReceipts = [...read.receipts].sort((a, b) => a.messageId.localeCompare(b.messageId));
  assert.equal(sortedReceipts[0].id, firstReceipt.id);
  assert.ok(sortedReceipts[1].id && sortedReceipts[1].id !== firstReceipt.id);
  assert.deepEqual(sortedReceipts.map(({ id: _id, ...retained }) => retained), ["first", "second"].map(messageId => ({
    client: source.client, sessionId: source.sessionId, role: "user", occurredAtMs: null, messageId, excerpt: factText,
    eventId: messageId, createdAtMs: 100,
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

test("with procedural tags enabled, insert and touch return stable receipt IDs in input order", async () => {
  const { storage, service, inspect } = fixture({ proceduralTags: true, receiptAttachAdvancesRevision: true });
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
  const { receipts } = await inspect(id);
  const ids = new Map(receipts.map(item => [item.messageId, item.id]));
  assert.equal(ids.size, 4);
  assert.equal(ids.get("a"), aId);
  assert.equal(ids.get("b"), bId);
  const cId = ids.get("c");
  const dId = ids.get("d");
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
  const secondReceiptId = (await inspect(id)).receipts.find(item => item.messageId === "second").id;
  assert.deepEqual(await tag(id), { ...expected, tagRevision: 2, anchors: [{ ...expected.anchors[0], receiptId: secondReceiptId }] });
});

test("procedural offsets and digest use the bounded receipt excerpt", async () => {
  const { service, inspect, tag } = fixture({ proceduralTags: true });
  const { save } = service();
  const excerpt = "x".repeat(799);
  const text = excerpt + "🧭";
  const options = { receipt: receipt("bounded"), procedural: { anchors: [{ receiptIndex: 0, start: 798, end: 801 }] } };
  assert.deepEqual(await save(scope, text, source, "instruction", options), { status: "invalid" });
  options.procedural.anchors[0].end = 799;
  const result = await save(scope, text, source, "instruction", options);
  assert.equal(result.item.text, text);
  const [stored] = (await inspect(result.item.id)).receipts;
  assert.equal(stored.excerpt, excerpt);
  assert.deepEqual((await tag(result.item.id)).anchors,
    [{ receiptId: stored.id, digest: sha256Hex(excerpt), start: 798, end: 799 }]);
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
  await assert.rejects(inspect(id), { code: "memory_not_found" });
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
  await assert.rejects(inspect(writtenId), { code: "memory_not_found" });
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

for (const denial of ["deleted", "fenced", "window"]) {
  for (const operation of ["save", "duplicate", "correct"]) {
    test(`review: ${operation} refuses a receipt from a ${denial} conversation`, async () => {
      const { storage, service, index } = fixture({ capabilities: { rawArchive: true } });
      const { save, correct } = service();
      const text = "Text from the deleted conversation.";
      const session = { client: "conversation-client", sessionId: "deleted-conversation" };
      const options = { receipt: { ...session, messageId: "deleted-turn", role: "user", occurredAtMs: 10 } };
      const write = action => storage.uow.run(scope.owner, {}, action);
      const { raw, harness } = storage;
      const key = { scope, ...session, eventId: "archive-event", payloadDigest: "a".repeat(64) };
      await write(async tx => {
        const { messageId: id, role, occurredAtMs } = options.receipt;
        assert.deepEqual(await raw.archive(tx, key, [{ id, role, occurredAtMs, content: text }]), { archived: 1 });
      });
      const previous = operation === "save" ? null : await save(scope, operation === "duplicate" ? text : factText, source);
      if (denial === "deleted") {
        assert.deepEqual(await write(tx => raw.deleteConversation(tx, scope, session)), { rawDeleted: 1 });
      } else if (denial === "fenced") {
        await write(tx => raw.fenceSession(tx, scope, session));
      } else {
        await harness.seedFact(scope.owner, { ...scope, actionId: "withhold-turn", origin: "forget", kind: "window",
          client: session.client, window: { startMs: 5, endMs: 15 } });
      }
      const start = await index();
      const before = await harness.dump();
      const result = operation === "correct"
        ? await correct(scope, previous.item.id, previous.item.revision, text, source, options)
        : await save(scope, text, source, "fact", options);
      assert.deepEqual(result, { status: "suppressed", indexRevision: start });
      assert.deepEqual(await harness.dump(), before);
      assert.equal(await index(), start);
    });
  }
}

test("review: public Inspect projects the stored procedural tag in the golden shape", async () => {
  const { service, inspect, tag } = fixture({ proceduralTags: true });
  const saved = await service().save(scope, instruction, source, "instruction", { receipt: receipt("golden"), procedural });
  const { id } = saved.item;
  const read = await inspect(id);
  const anchors = [{ receiptId: read.receipts[0].id,
    digest: "23270da8bfe17862cb0bd9230a6b1e569f3224a482912f1aafb2e0216a081df9", start: 0, end: 13 }];
  assert.deepEqual(await tag(id), { tagRevision: 1, positive: true, origin: "explicit", anchors });
  assert.deepEqual(read.procedural, { tagRevision: 1, procedural: true, origin: "explicit", anchors });
});

test("review: a receipt window hides the whole tag through the store and Inspect", async () => {
  const { storage, service, inspect, tag } = fixture({ proceduralTags: true });
  const evidence = { ...receipt("withheld-anchor"), client: "receipt-client", occurredAtMs: 10 };
  const { item: { id } } = await service().save(scope, instruction, source, "instruction", { receipt: evidence, procedural });
  assert.equal((await inspect(id)).receipts.length, 1);
  assert.equal((await tag(id)).positive, true);
  await storage.harness.seedFact(scope.owner, { ...scope, actionId: "withhold-anchor", origin: "forget", kind: "window",
    client: evidence.client, window: { startMs: 5, endMs: 15 } });
  assert.equal(await tag(id), null);
  const read = await inspect(id);
  assert.equal(read.memory.text, instruction);
  assert.deepEqual(read.receipts, []);
  assert.equal(Object.hasOwn(read, "procedural"), false);
});

test("review: a procedural duplicate changes a fact's kind and revision before the tag write", async () => {
  const { storage, service, inspect } = fixture({ proceduralTags: true });
  const { save } = service({ ...storage, proceduralTags: { ...storage.proceduralTags,
    async write(tx, target, id, tag) {
      const row = await storage.memories.get(tx, target, id);
      assert.equal(row.kind, "instruction");
      assert.equal(row.revision, 2);
      await storage.proceduralTags.write(tx, target, id, tag);
    },
  } });
  const first = await save(scope, instruction, source, "fact", { receipt: receipt("fact") });
  const untouched = await save(scope, instruction, source, "instruction", { receipt: receipt("plain-duplicate") });
  assert.equal(untouched.item.kind, "fact");
  assert.equal(untouched.item.revision, 1);
  const tagged = await save(scope, instruction, source, "instruction", { receipt: receipt("kind-change"), procedural });
  assert.equal(tagged.status, "duplicate");
  assert.equal(tagged.item.id, first.item.id);
  assert.equal(tagged.item.kind, "instruction");
  assert.equal(tagged.item.revision, 2);
  assert.equal((await inspect(first.item.id)).procedural.procedural, true);
});

test("review: paused save at preflight reports the start index revision", async () => {
  const { service, index } = fixture();
  const { save, setPause } = service();
  await save(scope, factText, source);
  await setPause(scope.owner, true);
  const start = await index();
  assert.equal(start, 2);
  assert.deepEqual(await save(scope, correctedText, source), { status: "paused", indexRevision: start });
  assert.equal(await index(), start);
});

test("review: a save generation mismatch reports the write transaction's start index revision", async () => {
  const { storage, service, index } = fixture();
  const regular = service();
  await regular.save(scope, factText, source);
  const before = await index();
  const { save } = service(storage, { gate: { async assertOpen(owner, phase) {
    if (phase === "post-send") {
      await regular.setPause(owner, true);
      await regular.setPause(owner, false);
    }
  } } });
  const result = await save(scope, correctedText, source);
  const start = await index();
  assert.ok(start > before);
  assert.deepEqual(result, { status: "paused", indexRevision: start });
  assert.equal((await storage.harness.dump())[0].rows.length, 1);
});

test("review: attaching a receipt to a historical row advances the revision", async () => {
  const { storage, service, inspect } = fixture({ receiptAttachAdvancesRevision: true, capabilities: { supersession: true } });
  const { memories, supersession, uow } = storage;
  const { item: { id } } = await service().save(scope, factText, source);
  const write = action => uow.run(scope.owner, {}, action);
  await write(tx => supersession.markHistorical(tx, scope, id, 100));
  assert.equal((await inspect(id)).memory.revision, 2);
  const { eventId: messageId, ...metadata } = receipt("historical-turn");
  const evidence = [{ ...metadata, messageId, excerpt: factText }];
  const touch = () => write(tx => memories.touchDuplicate(tx, scope, id, evidence, { confidence: 1 }, 101));
  assert.deepEqual(await touch(), { outcome: "changed", revision: 3 });
  const { memory, receipts } = await inspect(id);
  assert.equal(memory.revision, 3);
  assert.equal(memory.state, "historical");
  assert.equal(receipts[0].messageId, messageId);
  assert.deepEqual(await touch(), { outcome: "touched", revision: 3 });
});

for (const tagging of [true, false]) {
  test(`review: replaying a duplicate receipt with a different excerpt returns invalid with tagging ${tagging}`, async () => {
    const { storage, service, inspect, index } = fixture({ proceduralTags: tagging });
    const { save } = service();
    const options = { receipt: receipt("replayed-receipt"), ...(tagging && { procedural }) };
    const { item: { id } } = await save(scope, instruction, source, "instruction", options);
    const start = await index();
    const before = await inspect(id);
    assert.deepEqual(await save(scope, instruction.toUpperCase(), source, "instruction", options), { status: "invalid" });
    assert.equal(await index(), start);
    assert.deepEqual(await inspect(id), before);
    assert.equal((await storage.harness.dump())[0].rows.length, 1);
  });
}

test("review: correct rejects an assistant receipt before writing", async () => {
  const { storage, service, index } = fixture();
  const { save, correct } = service();
  const { item } = await save(scope, factText, source);
  const start = await index();
  const before = await storage.harness.dump();
  assert.deepEqual(await correct(scope, item.id, item.revision, correctedText, source,
    { receipt: { ...receipt("assistant-turn"), role: "assistant" } }), { status: "invalid" });
  assert.deepEqual(await storage.harness.dump(), before);
  assert.equal(await index(), start);
});

test("review: a keyless correction into forgotten text is suppressed without writes", async () => {
  const { storage, service, index, inspect } = fixture();
  const { save, correct, forget } = service();
  const { item: forgotten } = await save(scope, correctedText, source);
  const { item: target } = await save(scope, factText, source);
  assert.equal((await forget(scope, forgotten.id, source, { expectedRevision: forgotten.revision })).status, "forgotten");
  const start = await index();
  const before = await storage.harness.dump();
  assert.deepEqual(await correct(scope, target.id, target.revision, correctedText, source),
    { status: "suppressed", indexRevision: start });
  assert.deepEqual(await storage.harness.dump(), before);
  assert.equal(await index(), start);
  assert.equal((await inspect(target.id)).memory.text, factText);
});
