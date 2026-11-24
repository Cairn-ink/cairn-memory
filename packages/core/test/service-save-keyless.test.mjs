import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryService } from "@cairn-ink/core/service";
import { hostedScope as scope, serviceFake } from "./helpers/service-fake.mjs";

const source = { kind: "mcp", client: "local-mcp", sessionId: "explicit-tool" };
const receipt = { client: source.client, sessionId: source.sessionId,
  eventId: "insert-event", role: "user", occurredAtMs: 42 };
const text = "Use 🧭 now.";
const span = { receiptIndex: 0, start: 4, end: 6 };
const procedural = { anchors: [span] };
const storedReceipt = id => ({ client: receipt.client, sessionId: receipt.sessionId,
  messageId: id, role: "user", occurredAtMs: 42, excerpt: text });

test("review: an omitted embedder works for optional embedding and still rejects required registration", async () => {
  const { deps, storage, mutations, calls } = serviceFake({ writes: true, hasKey: false });
  delete deps.embedder;
  storage.capabilities.embeddingRequiredOnInsert = false;
  const service = createMemoryService(deps);
  const result = await service.save(scope, text, source);
  assert.equal(result.status, "saved");
  assert.equal(result.item.embedding, null);
  assert.equal(mutations[0].args[0].embedding, null);
  assert.ok(!calls.some(([method]) => method === "embed"));
  assert.doesNotThrow(() => createMemoryService({ ...deps, embedder: undefined }));
  storage.capabilities.embeddingRequiredOnInsert = true;
  assert.throws(() => createMemoryService(deps), { code: "invalid_input" });
});

function fixture({ required = false, tags = false, index = "both" } = {}) {
  const fake = serviceFake({ writes: true, hasKey: false, capture: true, forgetting: tags ? {} : undefined });
  const { deps, storage, mutations } = fake;
  deps.embedder = null;
  storage.capabilities.embeddingRequiredOnInsert = required;
  const reads = [];
  if (index !== "none") {
    storage.memories.indexRevision = async tx => {
      reads.push(["start", tx]);
      return 11;
    };
  }
  if (index === "both") {
    storage.memories.committedIndexRevision = async tx => {
      reads.push(["committed", tx]);
      assert.ok(!tx.options.readOnly);
      assert.equal(mutations.at(-1).run, tx.runId);
      return 19;
    };
  }
  const tagWrites = [];
  if (tags) {
    storage.capabilities.proceduralTags = true;
    storage.proceduralTags = {
      async write(tx, scope, id, tag) {
        tagWrites.push({ tx, scope, id, tag });
        mutations.push({ method: "proceduralTags.write", run: tx.runId });
      },
      async clear(tx, scope, id) {
        tagWrites.push({ tx, scope, id });
        mutations.push({ method: "proceduralTags.clear", run: tx.runId });
      },
      async read() { assert.fail("The write path does not read a tag"); },
    };
    for (const [method, receiptId] of [["insert", "stored-insert"], ["touchDuplicate", "stored-touch"]]) {
      const write = storage.memories[method];
      storage.memories[method] = async (...args) => ({ ...await write(...args), receiptIds: [receiptId] });
    }
  }
  const service = createMemoryService(deps);
  return { ...fake, service, reads, tagWrites };
}

test("keyless provider-free save inserts a null embedding and uses the committed revision", async () => {
  const { service, mutations, calls, reads } = fixture();
  const result = await service.save(scope, text, source);
  assert.equal(result.status, "saved");
  assert.equal(result.item.embedding, null);
  assert.equal(result.indexRevision, 19);
  assert.deepEqual(reads.map(([read]) => read), ["committed"]);
  assert.equal(mutations[0].args[0].embedding, null);
  assert.deepEqual(mutations[0].args[1], []);
  assert.ok(!calls.some(([method, , phase]) => method === "embed" || phase === "dispatch"));
});

test("missing a required embedder fails before any write", async () => {
  const { service, calls, mutations } = fixture({ required: true });
  await assert.rejects(service.save(scope, text, source), { code: "capability_unavailable" });
  assert.deepEqual(mutations, []);
  assert.deepEqual(calls, []);
});

test("save and duplicate attach the explicit receipt with the prepared excerpt", async () => {
  const { service, mutations } = fixture();
  const input = "  Use   🧭 now.  ";
  const saved = await service.save(scope, input, source, "instruction", { receipt: { ...receipt, excerpt: "Ignored" } });
  const { eventId, ...metadata } = receipt;
  const dupe = await service.save(scope, input, source, "instruction", { receipt: { ...metadata, messageId: "second" } });
  assert.equal(dupe.status, "duplicate");
  assert.equal(dupe.item.id, saved.item.id);
  assert.equal(dupe.indexRevision, 19);
  assert.deepEqual(mutations.map(({ method, args }) => [method, args[1]]), [
    ["memories.insert", [storedReceipt(eventId)]], ["memories.touchDuplicate", [storedReceipt("second")]],
  ]);
});

test("invalid procedural kinds, receipts and UTF-16 spans are rejected with zero writes", async () => {
  const { service, mutations, tagWrites } = fixture({ tags: true });
  const cases = [
    ["fact", { receipt, procedural }],
    ["instruction", { procedural }],
    ...[[], Array(5).fill(span), [{ ...span, receiptIndex: 1 }], [{ ...span, start: -1 }],
      [{ ...span, end: text.length + 1 }], [{ ...span, start: span.end }], [{ ...span, start: 4.5 }],
      [{ ...span, start: 5 }], [{ ...span, end: 5 }], Array(1)].map(anchors =>
      ["instruction", { receipt, procedural: { anchors } }]),
  ];
  for (const [kind, options] of cases) {
    assert.deepEqual(await service.save(scope, text, source, kind, options), { status: "invalid" });
  }
  assert.deepEqual(mutations, []);
  assert.deepEqual(tagWrites, []);
});

test("procedural options require the advertised capability before any write", async () => {
  const { service, calls, mutations } = fixture();
  await assert.rejects(service.save(scope, text, source, "instruction", { receipt, procedural }),
    { code: "capability_unavailable" });
  assert.deepEqual(mutations, []);
  assert.deepEqual(calls, []);
});

test("procedural saves and duplicates bind stored receipt IDs in the memory transaction", async () => {
  const { service, tagWrites, mutations, reads } = fixture({ tags: true });
  const digest = createHash("sha256").update(text).digest("hex");
  const options = { receipt, procedural };
  const saved = await service.save(scope, text, source, "preference", options);
  const duplicate = await service.save(scope, text, source, "preference", options);
  assert.equal(saved.status, "saved");
  assert.equal(duplicate.status, "duplicate");
  assert.deepEqual(mutations.map(({ method }) => method),
    ["memories.insert", "proceduralTags.write", "memories.touchDuplicate", "proceduralTags.write"]);
  for (const [i, receiptId] of ["stored-insert", "stored-touch"].entries()) {
    const write = tagWrites[i];
    assert.equal(write.tx.runId, mutations[2 * i].run);
    assert.equal(reads[i][1], write.tx);
    assert.deepEqual({ ...write, tx: undefined }, { tx: undefined, scope, id: saved.item.id, tag: {
      positive: true, origin: "explicit", anchors: [{ receiptId, digest, start: span.start, end: span.end }],
    } });
  }
});

test("correct and forget clear procedural tags inside their write transactions", async () => {
  const { service, tagWrites, mutations } = fixture({ tags: true });
  const saved = await service.save(scope, text, source, "instruction", { receipt, procedural });
  const { id, revision } = saved.item;
  const corrected = await service.correct(scope, id, revision, "Use a different compass.", source);
  assert.equal(corrected.status, "saved");
  assert.equal(corrected.indexRevision, 19);
  const forgotten = await service.forget(scope, id, source);
  assert.equal(forgotten.status, "forgotten");
  const clears = tagWrites.slice(1);
  assert.deepEqual(clears.map(write => [write.scope, write.id]), [[scope, id], [scope, id]]);
  assert.equal(clears[0].tx.runId, mutations.find(({ method }) => method === "memories.replaceContent").run);
  assert.equal(clears[1].tx.runId, mutations.find(({ method }) => method === "memories.erase").run);
});

test("save uses the start revision for an in-transaction refusal and the committed revision after delivery loss", async () => {
  const refused = fixture();
  refused.storage.memories.readWritePolicy = async () => ({ matches: [[]], hiddenIds: [], blockedPositions: [0], blockedSession: false });
  assert.deepEqual(await refused.service.save(scope, text, source), { status: "suppressed", indexRevision: 11 });
  assert.deepEqual(refused.reads.map(([read]) => read), ["start"]);
  assert.deepEqual(refused.mutations, []);

  const lost = fixture();
  lost.hooks.beforeRun = (_, options) => {
    if (options.readOnly) lost.hooks.hideAtFence = () => true;
  };
  assert.deepEqual(await lost.service.save(scope, text, source), { status: "suppressed", indexRevision: 19 });
  assert.deepEqual(lost.reads.map(([read]) => read), ["committed"]);
  assert.equal(lost.mutations.length, 1);
});

test("correct reports the start revision for refusals and unchanged writes", async () => {
  const { service, reads, mutations } = fixture();
  const saved = await service.save(scope, text, source);
  const { id, revision } = saved.item;
  assert.deepEqual(await service.correct(scope, id, revision + 1, "A stale edit.", source),
    { status: "conflict", indexRevision: 11 });
  assert.deepEqual(await service.correct(scope, id, revision, text, source),
    { status: "unchanged", item: saved.item, indexRevision: 11 });
  assert.deepEqual(reads.map(([read]) => read), ["committed", "start", "start"]);
  assert.equal(mutations.length, 1);
});

test("write results omit indexRevision when the committed accessor is missing", async () => {
  for (const index of ["start", "none"]) {
    const { service, storage } = fixture({ index });
    const saved = await service.save(scope, text, source);
    assert.equal(saved.status, "saved");
    assert.ok(!Object.hasOwn(saved, "indexRevision"));
    const corrected = await service.correct(scope, saved.item.id, saved.item.revision, "Use a different compass.", source);
    assert.equal(corrected.status, "saved");
    assert.ok(!Object.hasOwn(corrected, "indexRevision"));
    storage.memories.readWritePolicy = async () => ({ matches: [[]], hiddenIds: [], blockedPositions: [0], blockedSession: false });
    assert.deepEqual(await service.save(scope, text, source),
      index === "start" ? { status: "suppressed", indexRevision: 11 } : { status: "suppressed" });
  }
});
