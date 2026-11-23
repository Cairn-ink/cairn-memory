import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { CoreError } from "@cairn-ink/core";
import { decodePayload } from "../src/cursor.mjs";

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
const insertRow = ({ content, kind, confidence, textHash, embedding }) => ({
  text: content, kind, confidence, textHash, embedding, origin: "explicit",
  source: { kind: "mcp", client: null, sessionId: null },
});
const exactFact = ({ textHash }) => ({
  owner, actionId: "forget-item", origin: "forget", kind: "text", mode: "exact",
  text: { digests: [{ alg: "sha256", value: textHash.slice(7), pipeline: "core",
    redactionVersion: 1, keyId: null }] },
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

test("capture source filtering admits messages for an owner without facts", async () => {
  const adapter = createMemoryAdapter();
  const { capture } = adapter;
  const captureKey = key("filter");
  const messages = [null, 10].map((occurredAtMs, index) =>
    ({ id: String(index), role: "user", content: "Test message", occurredAtMs }));
  assert.deepEqual(await read(adapter, (tx) => capture.eligible(tx, captureKey, messages)), [0, 1]);
  await write(adapter, async (tx) => {
    assert.equal((await capture.claim(tx, captureKey, messages, options)).status, "claimed");
    await capture.assertEligible(tx, captureKey, [0, 1]);
  });
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

test("overlapping finishes make the same decisions as sequential finishes", async () => {
  async function complete(overlap) {
    const adapter = createMemoryAdapter({ now: () => 0 });
    const { capture, memories } = adapter;
    const first = await claim(adapter, "first");
    const second = await claim(adapter, "second");
    const results = await write(adapter, async (tx) => overlap
      ? Promise.all([capture.finish(tx, first.token, [item()]), capture.finish(tx, second.token, [item()])])
      : [await capture.finish(tx, first.token, [item()]), await capture.finish(tx, second.token, [item()])]);
    const page = await read(adapter, (tx) => memories.exportPage(tx, scope, { cursor: null, limit: 10 }));
    return {
      outcomes: results.map(({ memories: [entry] }) => entry.outcome),
      duplicateCounts: results.map(({ duplicateCount }) => duplicateCount),
      sameId: results[0].memories[0].id === results[1].memories[0].id,
      rows: page.items.length,
    };
  }
  const sequential = await complete(false);
  assert.deepEqual(sequential, { outcomes: ["inserted", "touched"], duplicateCounts: [0, 1], sameId: true, rows: 1 });
  assert.deepEqual(await complete(true), sequential);
});

test("an ordinary write begun during a finish runs after the whole finish", async () => {
  const id = "test-row";
  const adapter = createMemoryAdapter({ now: () => 0, newId: () => id });
  const { capture, memories } = adapter;
  const { token } = await claim(adapter, "finish");
  const [result, erased, duringFinish] = await write(adapter, (tx) =>
    Promise.all([capture.finish(tx, token, [item()]), memories.erase(tx, scope, id), memories.get(tx, scope, id)]));
  assert.equal(result.memories[0].id, id);
  assert.equal(erased, true);
  assert.equal(duringFinish, null);
  assert.equal(await read(adapter, (tx) => memories.get(tx, scope, id)), null);
});

test("queued inserts copy a reused row when submitted", async () => {
  const adapter = createMemoryAdapter({ now: () => 0 });
  const { capture, memories } = adapter;
  const { token } = await claim(adapter, "queue");
  const row = insertRow(item("a"));
  const [, first, second] = await write(adapter, (tx) => {
    const active = capture.finish(tx, token, []);
    const first = memories.insert(tx, scope, row, [], 1);
    Object.assign(row, insertRow(item("b")));
    const second = memories.insert(tx, scope, row, [], 2);
    return Promise.all([active, first, second]);
  });
  const rows = await read(adapter, (tx) => Promise.all([first, second].map(({ id }) => memories.get(tx, scope, id))));
  assert.deepEqual(rows.map(({ text }) => text), [item("a").content, item("b").content]);
});

test("a queued fact suppresses the digest submitted by the caller", async () => {
  const adapter = createMemoryAdapter({ now: () => 0 });
  const { capture, suppressions } = adapter;
  const { token } = await claim(adapter, "queue");
  const next = await claim(adapter, "blocked");
  const blocked = item("a");
  const fact = exactFact(blocked);
  const [, , result] = await write(adapter, (tx) => {
    const active = capture.finish(tx, token, []);
    const written = suppressions.writeFact(tx, fact, "a".repeat(64));
    fact.text.digests[0].value = "b".repeat(64);
    return Promise.all([active, written, capture.finish(tx, next.token, [blocked])]);
  });
  assert.equal(result.suppressedCount, 1);
  assert.deepEqual(result.memories, []);
});

test("queued edits retain their scope, merge, and replacement values", async () => {
  const adapter = createMemoryAdapter({ now: () => 0 });
  const { capture, memories } = adapter;
  const { token } = await claim(adapter, "queue");
  const [row, removed] = await write(adapter, (tx) => Promise.all([
    memories.insert(tx, scope, insertRow(item("a")), [], 0),
    memories.insert(tx, scope, insertRow(item("b")), [], 0),
  ]));
  const target = { ...scope };
  const merge = { confidence: 0.8 };
  const next = insertRow({ ...item("c"), embedding: { model: "test", vector: new Float32Array([1, 0]) } });
  const [, touched, replaced, erased] = await write(adapter, (tx) => {
    const active = capture.finish(tx, token, []);
    const touch = memories.touchDuplicate(tx, target, row.id, [], merge, 1);
    const replace = memories.replaceContent(tx, target, row.id, 2, next, null, 2);
    const erase = memories.erase(tx, target, removed.id);
    target.namespace = "changed";
    merge.confidence = 0.4;
    next.embedding.vector[0] = 0;
    return Promise.all([active, touch, replace, erase]);
  });
  assert.deepEqual([touched, replaced, erased], [
    { outcome: "changed", revision: 2 }, { outcome: "changed", revision: 3 }, true,
  ]);
  const saved = await read(adapter, (tx) => memories.get(tx, scope, row.id));
  assert.deepEqual([saved.text, saved.embedding.vector], [item("c").content, [1, 0]]);
});

test("queued capture calls validate and copy their arguments on entry", async () => {
  const adapter = createMemoryAdapter({ now: () => 0 });
  const { capture, memories } = adapter;
  const active = await claim(adapter, "queue");
  const next = await claim(adapter, "finish");
  const retry = await claim(adapter, "retry");
  const admissionKey = { ...key("submitted"), scope: { ...scope } };
  const lease = { leaseMs: 100 };
  const invalid = item("a");
  invalid.content = "";
  const valid = item("b");
  const release = { ...failure };
  const [, , , , result] = await write(adapter, (tx) => {
    const pending = capture.finish(tx, active.token, []);
    const admission = capture.claim(tx, admissionKey, [], lease);
    const abandon = capture.abandon(tx, retry.token, release);
    const invalidFinish = assert.rejects(capture.finish(tx, next.token, [invalid]), errorCode("invalid_input"));
    const finish = capture.finish(tx, next.token, [valid]);
    admissionKey.scope.namespace = "changed";
    lease.leaseMs = 1;
    release.retryable = false;
    invalid.content = "Repaired after submission";
    valid.content = "Changed after submission";
    return Promise.all([pending, admission, abandon, invalidFinish, finish]);
  });
  await adapter.harness.advanceClock(2);
  assert.equal((await claim(adapter, "submitted")).status, "processing");
  assert.equal((await claim(adapter, "retry")).status, "claimed");
  const row = await read(adapter, (tx) => memories.get(tx, scope, result.memories[0].id));
  assert.equal(row.text, item("b").content);
});

test("finish started by an insert ID callback sees the inserted row", async () => {
  let nextId = 0;
  let onId;
  const adapter = createMemoryAdapter({ now: () => 9, newId() {
    const id = `row-${++nextId}`;
    onId?.();
    return id;
  } });
  const { capture, memories } = adapter;
  const { token } = await claim(adapter, "reentrant");
  let finishing;
  const inserted = await write(adapter, (tx) => {
    onId = () => {
      onId = undefined;
      finishing = capture.finish(tx, token, [item()]);
    };
    return memories.insert(tx, scope, insertRow(item()), [], 0);
  });
  const page = await read(adapter, (tx) => memories.exportPage(tx, scope, { cursor: null, limit: 10 }));
  const finished = await finishing;
  assert.deepEqual(finished.memories, [{ id: inserted.id, revision: 1, outcome: "touched" }]);
  assert.deepEqual(page.items.map(({ id, updatedAtMs }) => [id, updatedAtMs]), [[inserted.id, 9]]);
});

test("interleaved insert, finish, and fact writes match FIFO sequential execution", async () => {
  async function complete(interleave) {
    let onId;
    let nextId = 0;
    const adapter = createMemoryAdapter({ now: () => 0, newId() {
      const id = `row-${++nextId}`;
      onId?.();
      return id;
    } });
    const { capture, memories, suppressions } = adapter;
    const { token } = await claim(adapter, "finish");
    const second = item("b");
    const results = await write(adapter, async (tx) => {
      const insert = () => memories.insert(tx, scope, insertRow(item()), [], 0);
      const finish = () => capture.finish(tx, token, [item(), second]);
      const block = () => suppressions.writeFact(tx, exactFact(second), "a".repeat(64));
      if (!interleave) return [await insert(), await finish(), await block()];

      let finishing;
      let blocking;
      onId = () => {
        onId = undefined;
        finishing = finish();
        blocking = block();
      };
      const inserting = insert();
      return Promise.all([inserting, finishing, blocking]);
    });
    const page = await read(adapter, (tx) => memories.exportPage(tx, scope, { cursor: null, limit: 10 }));
    return { results, visibleIds: page.items.map(({ id }) => id) };
  }
  const sequential = await complete(false);
  assert.deepEqual(sequential.results[1].memories.map(({ outcome }) => outcome), ["touched", "inserted"]);
  assert.deepEqual(sequential.visibleIds, [sequential.results[0].id]);
  assert.deepEqual(await complete(true), sequential);
});

test("ordinary writes and writing finishes each contribute to the committed revision", async (t) => {
  for (const [label, ordinary, secondItem, delta] of [
    ["ordinary insert and writing finish", true, null, 2],
    ["two writing finishes", false, item("b"), 2],
    ["writing finish and suppressed-only finish", false, item("c"), 1],
  ]) {
    await t.test(label, async () => {
      const adapter = createMemoryAdapter({ now: () => 0 });
      const { capture, memories, harness } = adapter;
      await harness.seedFact(owner, {
        owner, actionId: "blocked", origin: "forget", kind: "text", mode: "exact",
        text: { digests: [{ alg: "sha256", value: item("c").textHash.slice(7), pipeline: "core",
          redactionVersion: 1, keyId: null }] },
      });
      const first = await claim(adapter, "first");
      const second = secondItem && await claim(adapter, "second");
      const [, before] = decodePayload(await stateToken(adapter));
      const results = await write(adapter, async (tx) => {
        if (ordinary) {
          const { content, kind, confidence, textHash, embedding } = item("d");
          await memories.insert(tx, scope, { text: content, kind, confidence, textHash, embedding,
            origin: "explicit", source: { kind: "mcp", client: null, sessionId: null } }, [], 0);
        }
        const results = [await capture.finish(tx, first.token, [item()])];
        if (second) results.push(await capture.finish(tx, second.token, [secondItem]));
        return results;
      });
      if (secondItem) assert.equal(results[1].suppressedCount, Number(delta === 1));
      const [, after] = decodePayload(await stateToken(adapter));
      assert.equal(after, before + delta);
      for (const result of results) assert.equal(result.indexRevision, after);
    });
  }
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
