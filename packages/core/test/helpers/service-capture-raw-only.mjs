import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { allDigests, factIncarnationBody } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";

const scope = { owner: "owner", namespace: null };
const selection = { client: "client", sessionId: "session", eventId: "event" };
const lookup = { scope, ...selection };
const messages = [
  { id: "lantern", role: "user", content: "Store the lantern under the stairs.", occurredAtMs: 10 },
  { id: "shelf", role: "assistant", content: "There is space on the bottom shelf.", occurredAtMs: 20 },
  { id: "orchids", role: "user", content: "Water the orchids on Mondays.", occurredAtMs: 30 },
];
const config = { rawCapture: { enabled: true } };
const sha256Hex = text => createHash("sha256").update(text).digest("hex");

function deps(storage) {
  return {
    storage, embedder: null, config,
    gate: { assertOpen: () => assert.fail("Raw-only capture reached the model gate") },
    clock: { nowMs: () => 1_000, monotonicMs: () => 1_000, sha256Hex: async text => sha256Hex(text),
      hmacHex: () => assert.fail("Keyless capture reached HMAC") },
    tokens: { countTokens: () => assert.fail("Raw-only capture counted model tokens") },
  };
}

function fixture(t, storage) {
  const { raw, capture, uow } = storage;
  const archive = t.mock.method(raw, "archive");
  const beginDispatch = t.mock.method(capture, "beginDispatch");
  const service = createMemoryService(deps(storage));
  const read = work => uow.run(scope.owner, { readOnly: true }, work);
  const write = work => uow.run(scope.owner, { pauseLock: true }, work);
  const admission = () => read(tx => capture.load(tx, lookup));
  return {
    service, write, admission, archive, beginDispatch,
    enqueue: () => service.enqueueCapture(scope, { ...selection, messages }),
    run: () => service.runCapture(scope, selection),
    async admit() { assert.deepEqual(await this.enqueue(), { status: "accepted" }); },
    async storeFact(input) {
      const fact = { ...scope, origin: "forget", ...input };
      const result = await write(tx => storage.suppressions.writeFact(tx, fact, sha256Hex(factIncarnationBody(fact))));
      assert.equal(result.created, true);
    },
    async assertStored(expected) {
      const page = await service.listRawMessages(scope, { limit: 10 });
      assert.equal(page.nextCursor, null);
      const actual = page.items.map(({ messageId: id, role, content, occurredAtMs }) => ({ id, role, content, occurredAtMs }));
      assert.deepEqual(actual.sort((a, b) => a.occurredAtMs - b.occurredAtMs), expected);
      const memories = await read(tx => storage.memories.exportPage(tx, scope, { cursor: null, limit: 10 }));
      assert.deepEqual(memories.items, []);
    },
  };
}

function afterScreening(storage, change) {
  const { assertEligible } = storage.capture;
  const { run } = storage.uow;
  let screening;
  let changed = false;
  storage.capture.assertEligible = async (tx, key, positions) => {
    await assertEligible(tx, key, positions);
    if (!changed) {
      assert.deepEqual(positions, [0, 1, 2]);
      screening = tx;
    }
  };
  storage.uow.run = async (owner, options, work) => {
    let tx;
    const result = await run(owner, options, current => {
      tx = current;
      return work(tx);
    });
    if (!changed && tx === screening) {
      changed = true;
      await change();
    }
    return result;
  };
  return () => assert.equal(changed, true, "The change must commit after screening");
}

function assertDone(result) {
  assert.equal(result.status, "done", JSON.stringify(result));
  assert.deepEqual(result.result.memories, []);
  assert.ok(Number.isSafeInteger(result.result.indexRevision));
}

export async function assertUnavailable(storage, serviceConfig = config) {
  const service = createMemoryService({ ...deps(storage), config: serviceConfig });
  await assert.rejects(service.enqueueCapture(scope, { ...selection, messages }), { code: "capability_unavailable" });
  await assert.rejects(service.runCapture(scope, selection), { code: "capability_unavailable" });
}

async function assertForgotten(t, storage, late) {
  const f = fixture(t, storage);
  await f.admit();
  const digests = await allDigests(messages[0].content, null);
  // Persist the forget fact without purging the outbox, so Core must apply the text filter.
  const forget = () => f.storeFact({ kind: "text", mode: "exact", actionId: "forget-text", text: { digests } });
  let assertChanged;
  if (late) assertChanged = afterScreening(storage, forget);
  else await forget();

  assertDone(await f.run());
  assertChanged?.();
  assert.deepEqual(f.archive.mock.calls.map(({ arguments: args }) => args[2]), [messages.slice(1)],
    "Only allowed sources reach the archive port");
  await f.assertStored(messages.slice(1));
}

export async function assertDeleted(t, storage, late) {
  const f = fixture(t, storage);
  await f.admit();
  await f.write(async tx => {
    const admitted = await storage.capture.load(tx, lookup);
    assert.deepEqual(await storage.raw.archive(tx, admitted.key, admitted.messages), { archived: messages.length });
  });
  await f.assertStored(messages);
  f.archive.mock.resetCalls();
  async function deleteConversation() {
    assert.deepEqual(await f.write(tx => storage.raw.deleteConversation(tx, scope, selection)), { rawDeleted: messages.length });
    assert.deepEqual((await f.admission()).messages.map(({ content }) => content), messages.map(() => ""));
  }
  let assertChanged;
  if (late) assertChanged = afterScreening(storage, deleteConversation);
  else await deleteConversation();

  assertDone(await f.run());
  assertChanged?.();
  assert.equal(f.archive.mock.callCount(), 0, "Deleted sources must not reach the archive port");
  await f.assertStored([]);
}

export const scenarios = {
  "archives three admitted messages without dispatch or memories": async (t, storage) => {
    const f = fixture(t, storage);
    await f.admit();
    const admitted = await f.admission();
    assert.deepEqual(admitted.messages, messages);
    assertDone(await f.run());
    assert.equal(f.beginDispatch.mock.callCount(), 0, "Raw-only capture must not begin dispatch");
    await f.assertStored(admitted.messages);
  },
  "is unavailable with the option omitted or disabled": async (_t, storage) => {
    await assertUnavailable(storage, {});
    await assertUnavailable(storage, { rawCapture: { enabled: false } });
  },
  "rejects a model with Raw-only enabled and rejects malformed options": (_t, storage) => {
    const options = deps(storage);
    const model = { model: "test", contextWindow: 16_384, countTokens: () => 1,
      call: () => assert.fail("Registration reached the model") };
    assert.throws(() => createMemoryService({ ...options, model }), { code: "invalid_input" });
    for (const rawCapture of [{ enabled: true, extra: true }, { enabled: "true" }, {}, null, [],
      Object.create({ enabled: true }), { enabled: true, [Symbol()]: true }]) {
      assert.throws(() => createMemoryService({ ...options, config: { rawCapture } }), { code: "invalid_input" });
    }
  },
  "is unavailable without the archive or admission method": async (_t, storage) => {
    await assertUnavailable({ ...storage, raw: { ...storage.raw, archive: undefined } });
    await assertUnavailable({ ...storage, capture: { ...storage.capture, admit: undefined } });
  },
  "returns paused when paused before run or enqueue": async (t, storage) => {
    const f = fixture(t, storage);
    await f.admit();
    await f.service.setPause(scope.owner, true);
    assert.deepEqual(await f.run(), { status: "paused" });
    assert.deepEqual(await f.enqueue(), { status: "paused" });
    await f.assertStored([]);
  },
  "returns paused when the generation changes after screening": async (t, storage) => {
    const f = fixture(t, storage);
    await f.admit();
    const assertChanged = afterScreening(storage, async () => {
      await f.service.setPause(scope.owner, true);
      await f.service.setPause(scope.owner, false);
    });
    assert.deepEqual(await f.run(), { status: "paused" });
    assertChanged();
    await f.assertStored([]);
  },
  "blocks enqueue for a blocked session": async (t, storage) => {
    const f = fixture(t, storage);
    const { client, sessionId } = selection;
    const session = storage.hashSessionKey
      ? { client, sessionKeyHash: storage.hashSessionKey(scope, client, sessionId) }
      : { client, sessionId };
    await f.storeFact({ kind: "session", actionId: "block-session", session });
    assert.deepEqual(await f.enqueue(), { status: "blocked" });
    assert.equal(await f.admission(), null);
  },
  "withholds text forgotten before run": (t, storage) => assertForgotten(t, storage, false),
  "withholds text forgotten after screening": (t, storage) => assertForgotten(t, storage, true),
  "does not restore a conversation deleted before run": (t, storage) => assertDeleted(t, storage, false),
  "does not restore a conversation deleted after screening": (t, storage) => assertDeleted(t, storage, true),
  "replays a completed capture without archiving again": async (t, storage) => {
    const f = fixture(t, storage);
    await f.admit();
    const done = await f.run();
    assertDone(done);
    const replay = await f.run();
    assert.deepEqual(replay, replay.status === "duplicate" ? { status: "duplicate" } : done);
    assert.equal(f.archive.mock.callCount(), 1);
    await f.assertStored(messages);
  },
};
