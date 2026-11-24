import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { capabilities, receiptExcerpt } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { createMemoryAdapter } from "../../adapter-memory/src/index.mjs";
import { createContextReadStore } from "../../adapter-memory/src/context-read.mjs";
import { createFactMatcher } from "../../adapter-memory/src/fact-match.mjs";
import { createMemoryStore } from "../../adapter-memory/src/memory-store.mjs";
import { createUnitOfWork } from "../../adapter-memory/src/unit-of-work.mjs";
import { contextReadTestService } from "../../conformance/src/context-read-cases.mjs";
import { fixture, sha256, testAccess } from "./storage-fixtures.mjs";

const scope = { owner: "fixture-owner", namespace: "personal\0" };
const source = { kind: "mcp", client: null, sessionId: null };
const selection = { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [1] };
const clock = {
  nowMs: () => 10,
  monotonicMs: () => 0,
  async sha256Hex(value) { return sha256(value); },
  async hmacHex(key, value) { return createHmac("sha256", key).update(value).digest("hex"); },
};
const inspect = storage => storage.contextRead ? contextReadTestService(storage).inspect :
  createMemoryService({ profile: "keyless-local", storage, clock }).inspect;
const write = (storage, fn, target = scope) => storage.uow.run(target.owner, { pauseLock: true }, fn);
const receipt = (messageId, sessionId, excerpt) => ({
  client: "fixture-source", sessionId, messageId, excerpt, role: "user", occurredAtMs: 7,
  // Pre-existing internal receipt fixtures carry this field.
  eventId: messageId,
});
const row = (text, from = source) => ({
  text, textHash: "sha256:" + sha256(text.toLowerCase()), source: from,
  origin: "explicit", confidence: 1, kind: "fact", embedding: null,
});
async function insert(storage, text, receipts, { time = 10, from = source, target = scope } = {}) {
  const { id, revision } = await write(storage, tx => storage.memories.insert(tx, target, row(text, from), receipts, time), target);
  return { type: "memory", scope: target, id, revision };
}
async function archive(storage, retained, { role = retained.role, content = retained.excerpt, target = scope, record = false } = {}) {
  const { client, sessionId, messageId, occurredAtMs } = retained;
  const key = { scope: target, client, sessionId, eventId: "batch-" + sessionId, payloadDigest: "a".repeat(64) };
  const messages = [{ id: messageId, role, content, occurredAtMs }];
  await write(storage, async tx => {
    if (record) await storage.raw.recordLineage(tx, key, messages);
    assert.equal((await storage.raw.archive(tx, key, messages)).archived, 1);
  }, target);
}
async function finishCapture(storage, retained) {
  const { client, sessionId, messageId, role, occurredAtMs, excerpt } = retained;
  const key = { scope, client, sessionId, eventId: "capture-event", payloadDigest: "b".repeat(64) };
  const messages = [{ id: messageId, role, occurredAtMs, content: excerpt }];
  assert.equal((await write(storage, tx => storage.capture.admit(tx, key, messages))).status, "admitted");
  const claim = await write(storage, tx => storage.capture.claim(tx, key, messages, { leaseMs: 10_000 }));
  assert.equal(claim.status, "claimed");
  await write(storage, tx => storage.capture.beginDispatch(tx, claim.token));
  const content = "Visible Memory with conflicting role";
  const result = await write(storage, tx => storage.capture.finish(tx, claim.token, [{
    content, kind: "fact", confidence: 1, embedding: null, textHash: "sha256:" + sha256(content.toLowerCase()),
    receipts: [{ client, sessionId, messageId, role, occurredAtMs }],
  }]));
  const { id, revision } = result.memories[0];
  return { type: "memory", scope, id, revision };
}
async function noProvenance(service, ref) {
  const set = { ...selection, namespaces: [ref.scope.namespace] };
  const { items: [{ provenance }] } = await service.fetchEvidence(set, { refs: [ref], intent: "current" });
  assert.deepEqual(provenance.sources, []);
  assert.deepEqual(provenance.receiptMetadata, []);
  assert.deepEqual(provenance.coverage, { status: "budget_exhausted", included: 0, omitted: 1 });
}
function memory(flags = {}) {
  return createMemoryAdapter({ capabilities: { inspect: true, contextRead: true, ...flags } });
}

test("F1 receipt read safety applies to identity, lineage, suppression and every delivery route", async t => {
  await t.test("changed memory source and excerpt under the same stored identity", async () => {
    const work = createUnitOfWork({}, Date.now, false);
    const matchFacts = createFactMatcher(false);
    const ringKeys = async () => [];
    const contextRead = createContextReadStore(work, matchFacts, ringKeys);
    const { memories } = createMemoryStore(work.port, capabilities({ contextRead: true }), () => "retained", matchFacts, ringKeys);
    const storage = { uow: work.uow, memories };
    const witnesses = ["sessionId", "messageId", "excerpt", "missingKey"];
    const refs = [];
    for (const field of witnesses) {
      const target = { ...scope, namespace: field };
      const ref = await insert(storage, "Visible Memory", [receipt("turn", "session", "Source excerpt")], { target });
      refs.push(ref);
      const read = () => work.uow.run(scope.owner, { readOnly: true },
        tx => contextRead.evidence(tx, { ...selection, namespaces: [field] }, [ref], "current"));
      assert.equal((await read())[0].receipts.length, 1);
      await write(storage, tx => work.port(tx, target, true, state => {
        const entry = state.rows.get(field).get(ref.id);
        const [retained] = entry.receipts;
        if (field === "missingKey") entry.receiptKeys?.delete(retained);
        else retained[field] = "changed";
      }), target);
    }
    const results = await work.uow.run(scope.owner, { readOnly: true },
      tx => contextRead.evidence(tx, { ...selection, namespaces: witnesses }, refs, "current"));
    assert.deepEqual(results.map(result => [result.receiptCoverage.included, result.receiptCoverage.omitted]),
      witnesses.map(() => [0, 1]));
  });

  await t.test("SQLite session and message changes disagree with the stored key", async t => {
    const opened = await fixture();
    t.after(opened.close);
    const { adapter } = opened;
    const fields = ["sessionId", "messageId", "receiptKey"];
    for (const [index, field] of fields.entries()) {
      const retained = receipt("initial-turn-" + index, "initial-session-" + index, "Visible source");
      const changed = { ...retained, [field]: "mutated-" + index };
      await archive(adapter, retained);
      if (field !== "receiptKey") await archive(adapter, changed);
      const ref = await insert(adapter, "Visible Memory " + index, [retained]);
      assert.equal((await inspect(adapter)(scope, { memoryId: ref.id })).receipts.length, 1);
      await testAccess(opened, scope, { write: true }, db => {
        if (field === "receiptKey") {
          db.prepare("UPDATE cairn_receipts SET body = json_remove(body, '$.receiptKey') WHERE memory_id = ?").run(ref.id);
        } else {
          db.prepare("UPDATE cairn_receipts SET body = json_set(body, ?, ?) WHERE memory_id = ?")
            .run("$." + field, changed[field], ref.id);
        }
      });
    }
    const results = await inspect(adapter)(scope, {});
    assert.deepEqual(results.memories.map(item => item.receiptCount), fields.map(() => 0));
  });

  await t.test("forked receipt becomes unsafe when the original source is forgotten across scopes", async t => {
    const opened = await fixture();
    t.after(opened.close);
    for (const storage of [memory({ rawArchive: true }), opened.adapter]) {
      await t.test(storage.name, async () => {
        const project = { ...scope, namespace: "project\0fork" };
        const original = receipt("forked-turn", "original", "Common source turn");
        const fork = { ...original, sessionId: "forked" };
        await archive(storage, original, { record: true });
        await archive(storage, fork, { target: project, record: true });
        const retired = await insert(storage, "Memory from the original session", [original], {
          from: { kind: "capture", client: original.client, sessionId: original.sessionId },
        });
        const ref = await insert(storage, "Still visible forked Memory", [fork], { target: project });
        const keep = await inspect(storage)(project, { memoryId: ref.id });
        assert.equal(keep.receipts.length, 1);
        // Record a project page while the original namespace is still visible.
        const second = receipt("independent", "other-session", "Independent source");
        await archive(storage, second, { target: project });
        const pageRef = await insert(storage, "Forked Memory for paging", [fork, second], { target: project });
        const page = await storage.uow.run(scope.owner, { readOnly: true }, tx =>
          storage.inspect.item(tx, project, pageRef.id, { limit: 1, includeQualification: false }));
        assert.ok(page.nextAnchor);

        const service = storage.contextRead ? contextReadTestService(storage) :
          createMemoryService({ storage, clock, config: {},
            model: { model: "unused", contextWindow: 1, call() {}, countTokens: () => 0 },
            embedder: { model: "unused", dimensions: 1, embed() {} },
            gate: { assertOpen() {} }, tokens: { countTokens: () => 0 },
          });
        assert.equal((await service.forget(scope, retired.id, source)).status, "forgotten");
        const item = await inspect(storage)(project, { memoryId: ref.id });
        assert.equal(item.memory.receiptCount, 0);
        assert.deepEqual(item.receipts, []);
        await assert.rejects(storage.uow.run(scope.owner, { readOnly: true }, tx =>
          storage.inspect.item(tx, project, pageRef.id, {
            limit: 1, includeQualification: false, expectedEpoch: page.epoch, after: page.nextAnchor,
          })), { code: "cursor_stale" });
        if (storage.contextRead) await noProvenance(service, ref);
      });
    }
  });

  await t.test("full-turn forget suppresses a truncated receipt by address without Raw", async () => {
    const storage = memory();
    const service = contextReadTestService(storage);
    const full = "A synthetic full turn " + "x".repeat(900);
    const retained = receipt("long-turn", "source-session", receiptExcerpt(full));
    const retired = await insert(storage, full, [retained]);
    // Use a different excerpt so only the stable source address associates it with the forgotten Memory.
    const ref = await insert(storage, "Visible summary about the source", [{ ...retained, excerpt: retained.excerpt.slice(0, -1) }]);
    assert.equal((await inspect(storage)(scope, { memoryId: ref.id })).receipts.length, 1);
    assert.equal((await service.forget(scope, retired.id, source)).status, "forgotten");
    const item = await inspect(storage)(scope, { memoryId: ref.id });
    const list = await inspect(storage)(scope, {});
    assert.deepEqual([item.memory.receiptCount, item.receipts.length, list.memories[0].receiptCount], [0, 0, 0]);
    await noProvenance(service, ref);

    const unlinked = "A separate full source " + "y".repeat(900);
    const explicit = await insert(storage, unlinked, []);
    const ref2 = await insert(storage, "Visible summary of a separately saved turn", [
      receipt("separate-turn", "source-session", receiptExcerpt(unlinked)),
    ]);
    assert.equal((await inspect(storage)(scope, { memoryId: ref2.id })).memory.receiptCount, 1);
    assert.equal((await service.forget(scope, explicit.id, source)).status, "forgotten");
    await noProvenance(service, ref2);
  });

  await t.test("same-address archive must exist and agree with the receipt role", async t => {
    const opened = await fixture();
    t.after(opened.close);
    for (const storage of [memory({ rawArchive: true }), opened.adapter]) {
      await t.test(storage.name, async () => {
        const retained = receipt("role-turn", "source-session", "Role-bound excerpt");
        await archive(storage, retained, { role: "assistant" });
        const ref = storage.contextRead ? await finishCapture(storage, retained) :
          await insert(storage, "Visible Memory with conflicting role", [retained]);
        assert.deepEqual((await inspect(storage)(scope, { memoryId: ref.id })).receipts, []);
        if (storage.contextRead) await noProvenance(contextReadTestService(storage), ref);
        const missing = await insert(storage, "Visible Memory with unavailable Raw", [
          receipt("absent-turn", "source-session", "Unavailable source"),
        ]);
        assert.equal((await inspect(storage)(scope, { memoryId: missing.id })).memory.receiptCount, 0);
      });
    }
  });
});
