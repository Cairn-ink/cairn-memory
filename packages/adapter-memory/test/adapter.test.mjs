import assert from "node:assert/strict";
import { test } from "node:test";
import { CAPABILITIES, CoreError, NEAR_DUPLICATE_DISTANCE, OPTIONAL_PORTS } from "@cairn-ink/core";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";

const scope = { owner: "owner", namespace: null };
const textHash = "sha256:" + "a".repeat(64);
const otherHash = "sha256:" + "b".repeat(64);
const near = { nearDistance: NEAR_DUPLICATE_DISTANCE };

function content() {
  return {
    text: "a memory",
    textHash,
    kind: "fact",
    origin: "inferred",
    confidence: 0.4,
    source: { kind: "capture", client: "test-client", sessionId: null },
    embedding: { model: "embed", vector: new Float32Array([1, 0]) },
  };
}

function receipt() {
  return { client: "test-client", sessionId: "conversation", messageId: "message", role: "user", occurredAtMs: null };
}

const coreError = (code) => (error) => error instanceof CoreError && error.code === code && error.message === code;

test("refuses capabilities with unimplemented ports and accepts the remaining flags", () => {
  const unavailable = new Set(Object.values(OPTIONAL_PORTS));
  unavailable.delete("semanticRetrieval");
  unavailable.delete("placement");
  unavailable.delete("rawArchive");
  unavailable.delete("supersession");
  unavailable.delete("conflictEdges");
  for (const flag of unavailable) {
    assert.throws(() => createMemoryAdapter({ capabilities: { [flag]: true } }), coreError("capability_unavailable"), flag);
  }
  const accepted = CAPABILITIES.filter((flag) => !unavailable.has(flag));
  const adapter = createMemoryAdapter({ capabilities: Object.fromEntries(accepted.map((flag) => [flag, true])) });
  assert.deepEqual(Object.keys(adapter.capabilities).filter((flag) => adapter.capabilities[flag]), accepted);
  assert.deepEqual(adapter.nativeErrorMap, {});
  assert.ok(Object.isFrozen(adapter.nativeErrorMap));
  assert.throws(() => createMemoryAdapter({ capabilities: { unknownFlag: true } }), coreError("invalid_input"));
});

const invalidRows = [
  ["kind", { kind: "unknown" }],
  ["origin", { origin: "unknown" }],
  ["empty text", { text: "" }],
  ["non-string text", { text: 1 }],
  ["hash prefix", { textHash: "a".repeat(64) }],
  ["hash uppercase", { textHash: "sha256:" + "A".repeat(64) }],
  ["hash length", { textHash: "sha256:" + "a".repeat(63) }],
  ["hash newline", { textHash: textHash + "\n" }],
  ["non-finite confidence", { confidence: Infinity }],
  ["non-number confidence", { confidence: "0.4" }],
  ["confidence below range", { confidence: -0.1 }],
  ["confidence above range", { confidence: 1.1 }],
  ["source kind", { source: { ...content().source, kind: "unknown" } }],
  ["source client", { source: { ...content().source, client: 1 } }],
  ["source sessionId", { source: { ...content().source, sessionId: 1 } }],
  ["absent embedding", { embedding: undefined }],
  ["embedding model", { embedding: { model: "", vector: [1] } }],
  ["embedding length", { embedding: { model: "embed", vector: [] } }],
  ["embedding type", { embedding: { model: "embed", vector: new Float64Array([1]) } }],
  ["embedding finite components", { embedding: { model: "embed", vector: [1, NaN] } }],
  ["embedding sparse components", { embedding: { model: "embed", vector: Array(2) } }],
];
for (const [name, fields] of invalidRows) {
  test(`rejects invalid insert content with ${name}`, async () => {
    const { uow, memories, harness } = createMemoryAdapter();
    await assert.rejects(uow.run(scope.owner, {}, (tx) => memories.insert(tx, scope, { ...content(), ...fields }, [], 0)),
      coreError("invalid_input"));
    assert.deepEqual(await harness.dump(), []);
  });
}

const invalidReceipts = [
  ["client", { client: "" }],
  ["sessionId", { sessionId: "" }],
  ["message id", { messageId: "" }],
  ["role", { role: "system" }],
  ["time", { occurredAtMs: NaN }],
];
for (const [name, fields] of invalidReceipts) {
  test(`rejects an invalid receipt ${name}`, async () => {
    const { uow, memories } = createMemoryAdapter();
    await assert.rejects(uow.run(scope.owner, {}, (tx) => memories.insert(tx, scope, content(), [{ ...receipt(), ...fields }], 0)),
      coreError("invalid_input"));
  });
}

test("validates clocks on all writes", async () => {
  const { uow, memories } = createMemoryAdapter();
  await uow.run(scope.owner, {}, async (tx) => {
    for (const time of [-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, "1"]) {
      await assert.rejects(memories.insert(tx, scope, content(), [], time), coreError("invalid_input"));
    }
    const { id, updatedAtUs } = await memories.insert(tx, scope, content(), [], Number.MAX_SAFE_INTEGER);
    assert.equal(updatedAtUs, BigInt(Number.MAX_SAFE_INTEGER) * 1000n);
    await assert.rejects(memories.touchDuplicate(tx, scope, id, [], { confidence: 0.8 }, -1), coreError("invalid_input"));
    await assert.rejects(memories.replaceContent(tx, scope, id, 1, { ...content(), textHash: otherHash }, null, 0.5),
      coreError("invalid_input"));
    assert.equal((await memories.get(tx, scope, id)).updatedAtUs, updatedAtUs);
  });
});

test("forces a committed row's microsecond write time without changing other state", async () => {
  const { uow, memories, harness } = createMemoryAdapter();
  const { id } = await uow.run(scope.owner, {}, (tx) => memories.insert(tx, scope, content(), [receipt()], 1));
  const expected = await harness.dump();
  Object.assign(expected[0].rows[0].row, { updatedAtUs: "2345", updatedAtMs: 2 });
  await harness.setWriteTime(scope, id, 2345n);
  assert.deepEqual(await harness.dump(), expected);
  await uow.run(scope.owner, { readOnly: true }, async (tx) => {
    assert.equal((await memories.get(tx, scope, id)).updatedAtUs, 2345n);
    assert.equal((await memories.findDuplicates(tx, scope, [{ textHash }], near))[0][0].writeTimeUs, 2345n);
  });
});

test("rejects forced times during a run, for invalid times, and outside the row's scope", async () => {
  const { uow, memories, harness } = createMemoryAdapter();
  const { id } = await uow.run(scope.owner, {}, (tx) => memories.insert(tx, scope, content(), [], 1));
  const before = await harness.dump();
  for (const options of [{}, { readOnly: true }]) {
    await uow.run(scope.owner, options, () => assert.rejects(harness.setWriteTime(scope, id, 0n), coreError("invalid_input")));
  }
  for (const value of [-1n, 0, "0", null]) {
    await assert.rejects(harness.setWriteTime(scope, id, value), coreError("invalid_input"));
  }
  await assert.rejects(harness.setWriteTime(scope, "missing", 0n), coreError("memory_not_found"));
  for (const wrongScope of [{ ...scope, namespace: "other" }, { ...scope, owner: "other" }]) {
    await assert.rejects(harness.setWriteTime(wrongScope, id, 0n), coreError("memory_not_found"));
  }
  assert.deepEqual(await harness.dump(), before);
});

const invalidBatches = [
  ["a non-array batch", [null, undefined, { 0: { textHash }, length: 1 }]],
  ["an invalid textHash", [[null], Array(1), [{}], [{ textHash: 1 }], [{ textHash: textHash + "\n" }]]],
  ["an invalid legacyHash", [[{ textHash, legacyHash: null }], [{ textHash, legacyHash: "sha256:" + "A".repeat(64) }]]],
  ["an invalid embedding type", [[{ textHash, embedding: "1" }], [{ textHash, embedding: new Float64Array([1]) }]]],
  ["an empty embedding", [[{ textHash, embedding: [] }], [{ textHash, embedding: new Float32Array() }]]],
  ["a non-finite embedding component", [[{ textHash, embedding: [1, NaN] }], [{ textHash, embedding: Array(1) }],
    [{ textHash, embedding: new Float32Array([Infinity]) }]]],
];
for (const [name, batches] of invalidBatches) {
  test(`duplicate and policy reads reject ${name}`, async () => {
    const { uow, memories } = createMemoryAdapter();
    await uow.run(scope.owner, { readOnly: true }, async (tx) => {
      for (const batch of batches) {
        await assert.rejects(memories.findDuplicates(tx, scope, batch, near), coreError("invalid_input"));
        await assert.rejects(memories.readWritePolicy(tx, scope, batch, content().source, "hash"), coreError("invalid_input"));
      }
    });
  });
}

test("duplicate reads reject an invalid nearDistance", async () => {
  const { uow, memories } = createMemoryAdapter();
  await uow.run(scope.owner, { readOnly: true }, async (tx) => {
    for (const options of [null, undefined, ...[-1, NaN, Infinity, "0", undefined].map((nearDistance) => ({ nearDistance }))]) {
      await assert.rejects(memories.findDuplicates(tx, scope, [], options), coreError("invalid_input"));
    }
  });
});

test("duplicate reads reject a non-string excludeId", async () => {
  const { uow, memories } = createMemoryAdapter();
  await uow.run(scope.owner, { readOnly: true }, async (tx) => {
    await assert.rejects(memories.findDuplicates(tx, scope, [], { ...near, excludeId: 1 }), coreError("invalid_input"));
  });
});

test("policy reads reject an invalid mode", async () => {
  const { uow, memories } = createMemoryAdapter();
  await uow.run(scope.owner, { readOnly: true }, async (tx) => {
    await assert.rejects(memories.readWritePolicy(tx, scope, [], content().source, "other"), coreError("invalid_input"));
  });
});

test("policy reads reject a non-string editId", async () => {
  const { uow, memories } = createMemoryAdapter();
  await uow.run(scope.owner, { readOnly: true }, async (tx) => {
    await assert.rejects(memories.readWritePolicy(tx, scope, [], content().source, "full", 1), coreError("invalid_input"));
  });
});

test("normalizes unexpected errors from port bodies", async () => {
  const { uow, memories } = createMemoryAdapter({ newId() { throw new Error("generator failure"); } });
  await uow.run(scope.owner, {}, async (tx) => {
    await assert.rejects(memories.insert(tx, scope, content(), [], 1), coreError("internal_error"));
  });
});

test("validates run inputs before invoking callbacks", async () => {
  const { uow } = createMemoryAdapter();
  const fn = async () => assert.fail("invalid run invoked a callback");
  for (const [owner, options, callback] of [
    ["", {}, fn], [1, {}, fn], [null, {}, fn],
    [scope.owner, null, fn], [scope.owner, true, fn], [scope.owner, undefined, fn],
    [scope.owner, {}, null], [scope.owner, {}, {}],
  ]) {
    await assert.rejects(uow.run(owner, options, callback), coreError("invalid_input"));
  }
});

test("allows a nested run on another owner", async () => {
  const { uow, memories } = createMemoryAdapter();
  const other = { owner: "other", namespace: null };
  await uow.run(scope.owner, { pauseLock: true }, async (tx) => {
    assert.ok(Object.isFrozen(tx));
    const { id } = await memories.insert(tx, scope, content(), [], 1);
    await uow.run(other.owner, { pauseLock: true }, async (inner) => {
      assert.equal(await memories.get(inner, other, id), null);
      await memories.insert(inner, other, content(), [], 1);
    });
    assert.equal((await memories.get(tx, scope, id)).id, id);
  });
});

test("copies inputs, returned rows, exported rows and committed snapshots", async () => {
  const { uow, memories, harness } = createMemoryAdapter();
  const input = content();
  const evidence = receipt();
  const namespace = { ...scope };
  const id = await uow.run(scope.owner, {}, async (tx) => {
    const created = await memories.insert(tx, namespace, input, [evidence], 1);
    input.source.kind = "web";
    input.embedding.vector[0] = 99;
    evidence.messageId = "updated";
    namespace.namespace = "other";
    const saved = await memories.get(tx, scope, created.id);
    saved.scope.namespace = "other";
    saved.source.kind = "web";
    saved.embedding.vector[0] = 99;
    const page = await memories.exportPage(tx, scope, { cursor: null, limit: 1 });
    page.items[0].text = "updated";
    return created.id;
  });
  const snapshot = await harness.dump();
  snapshot[0].rows[0].row.text = "updated";
  const [{ rows: [{ receipts, row }] }] = await harness.dump();
  assert.equal(receipts[0].messageId, "message");
  assert.equal(row.updatedAtUs, "1000");
  await uow.run(scope.owner, { readOnly: true }, async (tx) => {
    assert.deepEqual(await memories.get(tx, scope, id), {
      ...content(), id, scope, revision: 1, historical: false, createdAtMs: 1, updatedAtMs: 1, updatedAtUs: 1000n,
      embedding: { model: "embed", vector: [1, 0] },
    });
  });
});

test("dedupes receipt tuples, preserves on null and replaces on an array", async () => {
  const { uow, memories, harness } = createMemoryAdapter();
  const evidence = receipt();
  const distinct = { ...evidence, sessionId: "other" };
  const id = await uow.run(scope.owner, {}, async (tx) => {
    const { id } = await memories.insert(tx, scope, content(), [evidence, { ...evidence, role: "assistant" }], 1);
    assert.deepEqual(await memories.touchDuplicate(tx, scope, id, [evidence, distinct], { confidence: 0.4 }, 1),
      { outcome: "touched", revision: 1 });
    await memories.replaceContent(tx, scope, id, 1, { ...content(), textHash: otherHash }, null, 2);
    return id;
  });
  assert.deepEqual((await harness.dump())[0].rows[0].receipts, [evidence, distinct]);
  await uow.run(scope.owner, {}, (tx) => memories.replaceContent(tx, scope, id, 2, content(), [distinct, distinct], 3));
  assert.deepEqual((await harness.dump())[0].rows[0].receipts, [distinct]);
  await uow.run(scope.owner, {}, (tx) => memories.erase(tx, scope, id));
  assert.deepEqual(await harness.dump(), []);
});

test("counts dimensional mismatches and matches exact hashes anyway", async () => {
  const { uow, memories, harness } = createMemoryAdapter({ capabilities: { nearDuplicate: true } });
  await uow.run(scope.owner, {}, async (tx) => {
    const { id } = await memories.insert(tx, scope, content(), [], 1);
    const [exact, other] = await memories.findDuplicates(tx, scope, [
      { textHash: otherHash, legacyHash: textHash, embedding: new Float32Array([1, 0, 0]) },
      { textHash: "sha256:" + "c".repeat(64), embedding: [0, 1, 0] },
    ], near);
    assert.deepEqual(exact.map((match) => match.id), [id]);
    assert.deepEqual(other, []);
  });
  assert.equal((await harness.counters()).nearSkippedUnembedded, 1);
});

test("a pause-lock reader holds only the pause lock", { timeout: 5000 }, async () => {
  const { uow } = createMemoryAdapter();
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const reader = uow.run(scope.owner, { pauseLock: true, readOnly: true }, async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  let tookPause = false;
  const paused = uow.run(scope.owner, { pauseLock: true }, async () => { tookPause = true; });
  try {
    await uow.run(scope.owner, {}, async () => {});
    assert.equal(tookPause, false);
  } finally {
    release.resolve();
  }
  await Promise.all([reader, paused]);
  assert.equal(tookPause, true);
});

test("validates facts, isolates namespace and revision, and excludes hidden rows from export", async () => {
  const { uow, memories, harness } = createMemoryAdapter();
  const id = await uow.run(scope.owner, {}, async (tx) => {
    const { id } = await memories.insert(tx, scope, content(), [], 1);
    return id;
  });
  const fact = { owner: scope.owner, kind: "identity", actionId: "withhold", origin: "forget", memoryId: id };
  await assert.rejects(harness.seedFact(scope.owner, { ...fact, throughRevision: -1 }), coreError("invalid_input"));
  await assert.rejects(harness.seedFact("other", fact), coreError("invalid_input"));
  await harness.seedFact(scope.owner, { ...fact, namespace: "other" });
  await uow.run(scope.owner, { readOnly: true }, async (tx) => {
    await assert.rejects(harness.seedFact(scope.owner, fact), coreError("invalid_input"));
    assert.equal((await memories.exportPage(tx, scope, { cursor: null, limit: 1 })).items.length, 1);
  });
  await harness.seedFact(scope.owner, { ...fact, namespace: null, throughRevision: 1 });
  await uow.run(scope.owner, {}, async (tx) => {
    assert.equal((await memories.exportPage(tx, scope, { cursor: null, limit: 1 })).items.length, 0);
    assert.deepEqual(await memories.readRevision(tx, scope, id), { revision: 1, textHash });
    assert.equal((await memories.get(tx, scope, id)).id, id);
    await memories.touchDuplicate(tx, scope, id, [], { confidence: 1 }, 2);
    assert.equal((await memories.exportPage(tx, scope, { cursor: null, limit: 1 })).items.length, 1);
  });
});

test("uses legacy digests and fails closed on hashed session facts without a hasher", async () => {
  const { uow, memories, harness } = createMemoryAdapter();
  const base = { owner: scope.owner, origin: "forget" };
  await harness.seedFact(scope.owner, {
    ...base, actionId: "digest", kind: "text", mode: "exact",
    text: { digests: [{ alg: "sha256", value: textHash.slice(7), pipeline: "engine-legacy", redactionVersion: 1, keyId: null }] },
  });
  await harness.seedFact(scope.owner, {
    ...base, actionId: "source", kind: "session",
    session: { client: "test-client", sessionKeyHash: "1".repeat(64) },
  });
  await uow.run(scope.owner, { readOnly: true }, async (tx) => {
    const source = { ...content().source, sessionId: "1".repeat(64) };
    const batch = [{ textHash: otherHash, legacyHash: textHash }];
    const policy = await memories.readWritePolicy(tx, scope, batch, source, "full");
    assert.deepEqual(policy.blockedPositions, [0]);
    assert.equal(policy.blockedSession, true);
  });
});

test("vector facts hide matching rows and permit replacement into a hidden hash", async () => {
  const { uow, memories, harness } = createMemoryAdapter({ capabilities: { vectorSuppression: true } });
  const first = content();
  const next = { ...content(), textHash: otherHash, embedding: { model: "other", vector: [0, 1] } };
  const [hidden, visible] = await uow.run(scope.owner, {}, async (tx) => [
    await memories.insert(tx, scope, first, [], 1),
    await memories.insert(tx, scope, next, [], 2),
  ]);
  const fact = {
    owner: scope.owner, namespace: null, origin: "forget", actionId: "vector", kind: "text", mode: "full",
    text: {
      digests: [{ alg: "sha256", value: "c".repeat(64), pipeline: "core", redactionVersion: 1, keyId: null }],
      embedding: [0.85, Math.sqrt(1 - 0.85 ** 2)],
    },
  };
  await harness.seedFact(scope.owner, fact);
  fact.text.embedding[0] = 0;
  await uow.run(scope.owner, {}, async (tx) => {
    const list = await memories.exportPage(tx, scope, { cursor: null, limit: 2 });
    assert.deepEqual(list.items.map(({ id }) => id), [visible.id]);
    assert.equal((await memories.get(tx, scope, hidden.id)).textHash, textHash);
    const policy = await memories.readWritePolicy(tx, scope, [{ textHash }], first.source, "hash");
    assert.deepEqual(policy.hiddenIds, [hidden.id]);
    const changed = await memories.replaceContent(tx, scope, visible.id, 1, { ...next, textHash }, null, 3);
    assert.deepEqual(changed, { outcome: "changed", revision: 2 });
  });
});
