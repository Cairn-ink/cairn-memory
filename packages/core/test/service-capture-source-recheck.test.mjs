import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { test } from "node:test";
import { coreDigest, normalizeForHash } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { hostedScope as scope, serviceFake } from "./helpers/service-fake.mjs";

const source = { kind: "mcp", client: null, sessionId: null };
const selection = { client: "client", sessionId: "fresh-session", eventId: "event" };
const forgotten = "The lantern is stored beneath the western staircase.";
const bookkeeping = "Log small purchases in the blue notebook.";
const unrelated = "Water the orchids on Mondays.";
const messages = [
  { id: "lantern", role: "user", content: `${forgotten} ${bookkeeping}`, occurredAtMs: 100 },
  { id: "orchids", role: "user", content: unrelated, occurredAtMs: null },
];

async function setup(incoming = messages) {
  const fake = serviceFake({ writes: true, capture: true, rawArchive: true, forgetting: {} });
  fake.storage.capabilities.fingerprintKey = true;
  // The reference source filter checks windows and fences. Core owns the passage check.
  fake.hooks.eligible = batch => batch.map((_, position) => position);
  const service = createMemoryService(fake.deps);
  const saved = await service.save(scope, forgotten, source);
  assert.equal(saved.status, "saved");
  assert.deepEqual(await service.enqueueCapture(scope, { ...selection, messages: incoming }), { status: "accepted" });
  assert.deepEqual(fake.calls.find(([method]) => method === "capture.admit")[2], incoming);
  fake.calls.length = 0;
  fake.mutations.length = 0;
  const forget = async () => {
    const result = await service.forget(scope, saved.item.id, source);
    assert.equal(result.status, "forgotten");
  };
  const candidate = (content, sourceIndices) => ({ content, kind: "instruction", confidence: 0.9, sourceIndices });
  fake.hooks.model = (_stage, request) => {
    const indices = new Map(request.input.messages.map(({ content, index }) => [content, index]));
    return { items: [
      ...(indices.has(messages[0].content) ? [candidate(bookkeeping, [indices.get(messages[0].content)])] : []),
      ...(indices.has(unrelated) ? [candidate(unrelated, [indices.get(unrelated)])] : []),
    ] };
  };
  return { ...fake, forget, run: () => service.runCapture(scope, selection) };
}

const modelSources = ({ calls }) => calls.filter(([method]) => method === "model.call")
  .flatMap(([, , request]) => request.input.messages.map(({ content }) => content));
const finished = ({ mutations }) => mutations.find(({ method }) => method === "capture.finish")?.args[1];

function assertUnrelatedFinishes(fake) {
  assert.deepEqual(fake.archived(scope.owner), [messages[1]]);
  assert.deepEqual(finished(fake).map(({ content, receipts }) => [content, receipts.map(({ messageId }) => messageId)]),
    [[unrelated, [messages[1].id]]]);
  assert.ok(fake.mutations.filter(({ method }) => method === "raw.recordLineage").every(({ args }) =>
    args[1].every(({ id }) => id !== messages[0].id)));
}

test("a forget committed before the run keeps the source out of extraction and Raw", async () => {
  const fake = await setup();
  const countTokens = fake.deps.model.countTokens;
  const sized = [];
  fake.deps.model.countTokens = text => {
    sized.push(text);
    return countTokens(text);
  };
  await fake.forget();
  assert.equal((await fake.run()).status, "done");
  assert.deepEqual(modelSources(fake), [unrelated]);
  assert.ok(sized.length && sized.every(text => !text.includes(forgotten)));
  assertUnrelatedFinishes(fake);
});

test("a forget committed during embedding keeps the original source out of Raw and finish receipts", async () => {
  const fake = await setup();
  fake.hooks.embed = async texts => {
    assert.deepEqual(texts, [bookkeeping.toLowerCase(), unrelated.toLowerCase()]);
    await fake.forget();
  };
  assert.equal((await fake.run()).status, "done");
  assert.deepEqual(modelSources(fake), messages.map(({ content }) => content));
  assertUnrelatedFinishes(fake);
});

test("without a forget the capture still extracts, finishes and archives both sources", async () => {
  const fake = await setup();
  assert.equal((await fake.run()).status, "done");
  assert.deepEqual(modelSources(fake), messages.map(({ content }) => content));
  assert.deepEqual(fake.archived(scope.owner), messages);
  assert.deepEqual(finished(fake).map(({ content, receipts }) => [content, receipts.map(({ messageId }) => messageId)]),
    [[bookkeeping, [messages[0].id]], [unrelated, [messages[1].id]]]);
});

test("a capture whose only admitted source is forgotten finishes empty without extraction", async () => {
  const fake = await setup([messages[0]]);
  await fake.forget();
  assert.equal((await fake.run()).status, "done");
  assert.deepEqual(modelSources(fake), []);
  assert.deepEqual(finished(fake), []);
  assert.deepEqual(fake.archived(scope.owner), []);
});

test("source re-checks combine retained digests with the transaction-selected key", async () => {
  const currentOnly = { ...messages[0], id: "current", content: "Count the yellow binders before lunch." };
  const fake = await setup([...messages, currentOnly]);
  const { keys, uow } = fake.storage;
  const currentKey = await keys.userKey(scope.owner);
  const retainedKeyId = randomBytes(8).toString("hex");
  const retainedKey = randomBytes(32);
  const mac = text => createHmac("sha256", retainedKey).update(text).digest("hex");
  const run = uow.run;
  let active = 0;
  uow.run = (owner, options, work) => run(owner, options, async tx => {
    active++;
    try { return await work(tx); }
    finally { active--; }
  });
  keys.retainedDigesters = async () => {
    assert.equal(active, 0);
    return [{ alg: "hmac", keyId: retainedKeyId, label: "hosted-v1", async mac(text) {
      assert.equal(active, 0);
      return mac(text);
    } }];
  };
  keys.userKeyForWrite = async tx => {
    assert.equal(active, 1);
    assert.equal(tx.options.pauseLock, true);
    return currentKey;
  };
  const exactForget = digest => ({ ...scope, kind: "text", origin: "forget", mode: "exact",
    actionId: "forget-fixture", text: { digests: [digest] } });
  fake.seedFact(exactForget({ alg: "hmac", keyId: retainedKeyId, pipeline: "hosted-v1", redactionVersion: 1,
    value: mac(normalizeForHash(messages[0].content)) }));
  fake.seedFact(exactForget(await coreDigest(currentOnly.content, currentKey)));
  assert.equal((await fake.run()).status, "done");
  assert.deepEqual(modelSources(fake), [unrelated]);
  assertUnrelatedFinishes(fake);
});
