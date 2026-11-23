import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { CoreError } from "@cairn-ink/core";

const owner = "test-owner";
const scope = { owner, namespace: null };
const readSet = { owner, namespaces: [null] };
const key = (eventId) => ({
  scope, client: "test-client", sessionId: "test-session", eventId, payloadDigest: "a".repeat(64),
});
const item = (digest = "a") => ({
  content: `Memory ${digest}`, kind: "fact", confidence: 0.4,
  textHash: `sha256:${digest.repeat(64)}`, embedding: null, receipts: [],
});
const options = { leaseMs: 100 };
const failure = { code: "storage_error", retryable: true };
const errorCode = (code) => (error) => error instanceof CoreError && error.code === code;

function write({ uow }, fn) {
  return uow.run(owner, { pauseLock: true }, fn);
}

function read({ uow }, fn) {
  return uow.run(owner, { readOnly: true }, fn);
}

function claim(adapter, eventId, lease = options) {
  return write(adapter, (tx) => adapter.capture.claim(tx, key(eventId), [], lease));
}

function stateToken(adapter) {
  return read(adapter, (tx) => adapter.snapshot.stateToken(tx, readSet));
}

test("capture source filtering fails closed", async () => {
  const adapter = createMemoryAdapter();
  const { capture } = adapter;
  await assert.rejects(write(adapter, (tx) => capture.eligible(tx, key("filter"), [])),
    errorCode("capability_unavailable"));
  await assert.rejects(write(adapter, (tx) => capture.assertEligible(tx, key("filter"), [0])),
    errorCode("capability_unavailable"));
});

test("capture rejects forged and ended transactions", async () => {
  const adapter = createMemoryAdapter({ now: () => 0 });
  const { capture } = adapter;
  const { token } = await claim(adapter, "guards");
  await write(adapter, async (tx) => {
    await assert.rejects(capture.claim({ ...tx }, key("forged"), [], options), errorCode("internal_error"));
  });
  const ended = await write(adapter, async (tx) => tx);
  for (const command of [
    () => capture.claim(ended, key("ended"), [], options),
    () => capture.beginDispatch(ended, token),
    () => capture.abandon(ended, token, failure),
    () => capture.finish(ended, token, []),
  ]) {
    await assert.rejects(command(), errorCode("internal_error"));
  }
  await assert.rejects(adapter.uow.run("other-owner", { pauseLock: true },
    (tx) => capture.finish(tx, token, [])), errorCode("stale_admission"));
  assert.equal((await claim(adapter, "guards")).status, "processing");
});

test("capture validates every batch position before token lookup or writes", async () => {
  const adapter = createMemoryAdapter({ now: () => 0 });
  const { capture, harness } = adapter;
  const { token } = await claim(adapter, "valid");
  const unknown = crypto.randomUUID();
  const message = { id: "", role: "assistant", content: "", occurredAtMs: -1 };
  const invalidMessageFields = [
    { id: 1 }, { id: "x".repeat(513) }, { role: "system" }, { content: null },
    { occurredAtMs: 1.5 }, { occurredAtMs: Number.MAX_SAFE_INTEGER + 1 },
  ];
  const invalidKeyFields = [
    { scope: null }, { scope: { owner, namespace: 1 } }, { client: "" }, { sessionId: null },
    { eventId: 1 }, { payloadDigest: "a".repeat(64) + "\n" },
  ];
  const invalidItemFields = [
    { kind: "unknown" }, { content: "" }, { confidence: Infinity }, { textHash: "invalid" },
    { embedding: undefined }, { embedding: { model: "test", vector: new Float32Array([NaN]) } },
    { receipts: [null] },
  ];
  const before = await harness.dump();
  await write(adapter, async (tx) => {
    for (const fields of invalidMessageFields) {
      await assert.rejects(capture.claim(tx, key("valid"), [{ ...message, ...fields }], options), errorCode("invalid_input"));
    }
    for (const fields of invalidKeyFields) {
      await assert.rejects(capture.claim(tx, { ...key("valid"), ...fields }, [], options), errorCode("invalid_input"));
    }
    for (const leaseMs of [-1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(capture.claim(tx, key("valid"), [], { leaseMs }), errorCode("invalid_input"));
    }
    for (const fields of invalidItemFields) {
      const invalidBatch = [item(), { ...item("b"), ...fields }];
      await assert.rejects(capture.finish(tx, unknown, invalidBatch), errorCode("invalid_input"));
      await assert.rejects(capture.finish(tx, token, invalidBatch), errorCode("invalid_input"));
    }
    await assert.rejects(capture.abandon(tx, unknown, { ...failure, code: "unknown" }), errorCode("invalid_input"));
    await assert.rejects(capture.abandon(tx, unknown, { ...failure, retryable: 1 }), errorCode("invalid_input"));
  });
  assert.deepEqual(await harness.dump(), before);
  const missingNamespace = { ...key("valid"), scope: { owner } };
  assert.equal((await write(adapter, (tx) => capture.claim(tx, missingNamespace, [message], options))).status, "processing");
});

test("claim bookkeeping preserves the state token and rolls back in the owner run", async () => {
  const adapter = createMemoryAdapter({ now: () => 0 });
  const { capture, harness } = adapter;
  const initialStateToken = await stateToken(adapter);
  const abort = new Error("abort");
  let abortedToken;
  await assert.rejects(write(adapter, async (tx) => {
    ({ token: abortedToken } = await capture.claim(tx, key("event"), [], options));
    throw abort;
  }), (error) => error === abort);
  await assert.rejects(write(adapter, (tx) => capture.beginDispatch(tx, abortedToken)), errorCode("stale_admission"));
  const { token } = await claim(adapter, "event");
  assert.notEqual(token, abortedToken);
  const committed = await harness.dump();
  await assert.rejects(write(adapter, async (tx) => {
    await capture.beginDispatch(tx, token);
    await capture.abandon(tx, token, failure);
    throw abort;
  }), (error) => error === abort);
  assert.deepEqual(await harness.dump(), committed);
  assert.deepEqual(await write(adapter, (tx) => capture.beginDispatch(tx, token)), { token });
  await write(adapter, (tx) => capture.abandon(tx, token, failure));
  assert.equal(await stateToken(adapter), initialStateToken);
});

test("the adapter clock sets the expiry boundary and both fact and memory write times", async () => {
  let allocated = 0;
  const adapter = createMemoryAdapter({ now: () => 1000, newId: () => `test-id-${++allocated}` });
  const { capture, harness, memories, suppressions, uow } = adapter;
  const first = await claim(adapter, "lease", { leaseMs: 10 });
  assert.equal(allocated, 0);
  await harness.advanceClock(9);
  assert.equal((await claim(adapter, "lease")).status, "processing");
  await harness.advanceClock(1);
  const { token } = await claim(adapter, "lease");
  assert.notEqual(token, first.token);
  assert.equal(allocated, 0);
  const fact = { owner, actionId: "test-action", kind: "identity", memoryId: "absent", origin: "forget" };
  const stored = await uow.run(owner, {}, (tx) => suppressions.writeFact(tx, fact, "b".repeat(64)));
  assert.equal(stored.createdAtMs, 1010);
  await harness.advanceClock(5);
  const result = await write(adapter, (tx) => capture.finish(tx, token, [item()]));
  const row = await read(adapter, (tx) => memories.get(tx, scope, result.memories[0].id));
  assert.deepEqual([row.id, row.createdAtMs, row.updatedAtMs, row.updatedAtUs], ["test-id-2", 1015, 1015, 1015000n]);
  assert.deepEqual([row.origin, row.source], ["inferred", {
    kind: "capture", client: key("lease").client, sessionId: key("lease").sessionId,
  }]);
});

test("finish reports each in-batch position and replay is isolated from both result objects", async () => {
  let allocated = 0;
  const adapter = createMemoryAdapter({
    now: () => 0, capabilities: { nearDuplicate: true }, newId: () => `test-memory-${++allocated}`,
  });
  const { capture, harness, memories } = adapter;
  const event = "repeat";
  const { token } = await claim(adapter, event);
  const first = item();
  const receipt = { client: "test-client", sessionId: "test-session", messageId: "message", role: "user", occurredAtMs: null };
  const batch = [first, { ...first, kind: "context", confidence: 0.8, receipts: [receipt] }, first];
  const result = await write(adapter, (tx) => capture.finish(tx, token, batch));
  assert.deepEqual(result, {
    indexRevision: 1, memories: [
      { id: "test-memory-1", revision: 1, outcome: "inserted" },
      { id: "test-memory-1", revision: 2, outcome: "changed" },
      { id: "test-memory-1", revision: 2, outcome: "touched" },
    ], suppressedCount: 0, duplicateCount: 2, counters: await harness.counters(),
  });
  assert.deepEqual(result.counters, { nearSkippedUnembedded: 0 });
  const row = await read(adapter, (tx) => memories.get(tx, scope, "test-memory-1"));
  assert.deepEqual([row.kind, row.confidence], ["fact", 0.8]);
  const expected = structuredClone(result);
  result.memories[0].id = "caller-change";
  result.counters.nearSkippedUnembedded = 99;
  const replay = await claim(adapter, event);
  assert.deepEqual(replay, { status: "rawReplay", result: expected });
  replay.result.memories.pop();
  replay.result.indexRevision = 99;
  const later = await claim(adapter, "another");
  const laterResult = await write(adapter, (tx) => capture.finish(tx, later.token, [item("b")]));
  assert.deepEqual(laterResult.counters, { nearSkippedUnembedded: 1 });
  assert.deepEqual(await claim(adapter, event), { status: "rawReplay", result: expected });
});

test("finish uses full suppression and the inferred duplicate merge rules", async () => {
  const adapter = createMemoryAdapter({ now: () => 0, capabilities: { vectorSuppression: true } });
  const { memories, harness, capture } = adapter;
  const embedding = { model: "test", vector: new Float32Array([1, 0]) };
  const existing = item("a");
  const { id } = await write(adapter, (tx) => memories.insert(tx, scope, {
    ...existing, text: existing.content, confidence: 0.2, origin: "explicit",
    source: { kind: "mcp", client: null, sessionId: null },
  }, [], 0));
  await harness.seedFact(owner, {
    owner, actionId: "block", origin: "forget", kind: "text", mode: "full",
    text: { digests: [{ alg: "sha256", value: "d".repeat(64), pipeline: "core", redactionVersion: 1, keyId: null }],
      embedding: [1, 0] },
  });
  const { token } = await claim(adapter, "full");
  const result = await write(adapter, (tx) => capture.finish(tx, token, [
    { ...existing, kind: "decision", confidence: 1 },
    { ...item("b"), embedding },
  ]));
  assert.deepEqual(result.memories, [{ id, revision: 1, outcome: "touched" }]);
  assert.deepEqual([result.duplicateCount, result.suppressedCount], [1, 1]);
  const row = await read(adapter, (tx) => memories.get(tx, scope, id));
  assert.deepEqual([row.kind, row.origin, row.confidence], ["fact", "explicit", 0.2]);
});

test("all finishes in one run report its committed index revision", async () => {
  const adapter = createMemoryAdapter({ now: () => 0 });
  const { capture } = adapter;
  const empty = await claim(adapter, "empty");
  const written = await claim(adapter, "write");
  const another = await claim(adapter, "another-write");
  const before = await stateToken(adapter);
  const [first, replay, second, third] = await write(adapter, async (tx) => {
    const result = Object.freeze(await capture.finish(tx, empty.token, []));
    const replay = await capture.claim(tx, key("empty"), [], options);
    return [result, replay, await capture.finish(tx, written.token, [item()]),
      await capture.finish(tx, another.token, [item("b"), item("c")])];
  });
  assert.equal(first.indexRevision, 2);
  assert.equal(second.indexRevision, 2);
  assert.equal(third.indexRevision, 2);
  assert.notEqual(await stateToken(adapter), before);
  assert.deepEqual(replay, { status: "rawReplay", result: first });
  assert.deepEqual(await claim(adapter, "empty"), { status: "rawReplay", result: first });
});

test("a caught finish failure after reading state rolls back earlier writes and the claim", async () => {
  let collide = true;
  let next = 0;
  const adapter = createMemoryAdapter({ now: () => 0, newId: () => collide ? "same-id" : `test-id-${++next}` });
  const { capture, harness } = adapter;
  const { token } = await claim(adapter, "sticky");
  const before = await harness.dump();
  const beforeToken = await stateToken(adapter);
  const items = [item(), item("b")];
  await assert.rejects(write(adapter, async (tx) => {
    await assert.rejects(capture.finish(tx, token, items), errorCode("internal_error"));
    await assert.rejects(capture.beginDispatch(tx, crypto.randomUUID()), errorCode("stale_admission"));
  }), errorCode("internal_error"));
  assert.deepEqual(await harness.dump(), before);
  assert.equal(await stateToken(adapter), beforeToken);
  assert.equal((await claim(adapter, "sticky")).status, "processing");
  collide = false;
  assert.equal((await write(adapter, (tx) => capture.finish(tx, token, items))).memories.length, 2);
});
