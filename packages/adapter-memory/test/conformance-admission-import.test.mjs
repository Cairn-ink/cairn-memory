import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { ADMISSION_CASES, IMPORT_TIME_CASES, runCase } from "@cairn-ink/conformance";

const factory = {
  name: "memory",
  async open({ capabilities }) {
    const adapter = createMemoryAdapter({ capabilities, now: () => 0 });
    return {
      adapter, harness: adapter.harness, nativeErrorMap: adapter.nativeErrorMap,
      sessionRefs: "plain", busyNativeCodes: [], embeddingDimensions: null,
      async close() {},
    };
  },
};

for (const testCase of [...ADMISSION_CASES, ...IMPORT_TIME_CASES]) {
  test(`${factory.name} ${testCase.id} ${testCase.title}`, async (t) => {
    const reason = await runCase(factory, testCase);
    if (reason !== null) t.skip(reason);
  });
}

for (const [method, ids] of [
  ["admit", ADMISSION_CASES.map(({ id }) => id)],
  ["load", ["K-ADM-1", "K-ADM-8", "K-ADM-9"]],
  ["status", ["K-ADM-6", "K-ADM-7"]],
]) {
  test(`admission conformance reports missing capture.${method}`, async () => {
    const partial = {
      async open(options) {
        const opened = await factory.open(options);
        const adapter = { ...opened.adapter, capture: { ...opened.adapter.capture } };
        delete adapter.capture[method];
        return { ...opened, adapter };
      },
    };
    for (const id of ids) {
      const testCase = ADMISSION_CASES.find(candidate => candidate.id === id);
      assert.ok(testCase);
      assert.equal(await runCase(partial, testCase), `needs capture.${method}`);
    }
  });
}

const scope = { owner: "owner", namespace: null };
const key = { scope, client: "client", sessionId: "session", eventId: "event", payloadDigest: "a".repeat(64) };
const message = { id: "message", role: "user", content: "Notebook entry.", occurredAtMs: null };
const imported = {
  kind: "fact", origin: "explicit", text: "Notebook entry.", textHash: `sha256:${"a".repeat(64)}`,
  confidence: 1, source: { kind: "import", client: null, sessionId: null }, embedding: null, createdAtMs: -10,
};

test("cross-namespace admission and claim share one finished record and memory", async () => {
  const { capture, harness, uow } = createMemoryAdapter({ now: () => 0 });
  const write = work => uow.run(scope.owner, { pauseLock: true }, work);
  const alternate = () => ({ ...key, scope: { ...scope, namespace: "other" } });
  const claim = input => write(tx => capture.claim(tx, input, [{ ...message }], { leaseMs: 60_000 }));
  const { token } = await claim(structuredClone(key));
  assert.equal(typeof token, "string");
  assert.deepEqual(await write(tx => capture.admit(tx, alternate(), [{ ...message }])), { status: "processing" });
  assert.deepEqual(await claim(alternate()), { status: "processing" });
  const dispatch = await write(tx => capture.beginDispatch(tx, token));
  const result = await write(tx => capture.finish(tx, dispatch.token, [{
    content: imported.text, kind: imported.kind, confidence: imported.confidence,
    textHash: imported.textHash, embedding: null, receipts: [],
  }]));
  assert.deepEqual(await write(tx => capture.admit(tx, alternate(), [{ ...message }])), { status: "rawReplay", result });
  assert.deepEqual(await claim(alternate()), { status: "rawReplay", result });

  const [stored] = await harness.dump();
  assert.deepEqual(stored.claims.map(({ key, status }) => ({ key, status })), [{ key, status: "finished" }]);
  assert.deepEqual(stored.rows.map(({ row }) => ({ id: row.id, scope: row.scope })), [
    { id: result.memories[0].id, scope },
  ]);
});

test("expired and retryably abandoned leases are replaced in the original scope", async () => {
  let now = 0;
  const { capture, harness, uow } = createMemoryAdapter({ now: () => now });
  const write = work => uow.run(scope.owner, { pauseLock: true }, work);
  const read = work => uow.run(scope.owner, { readOnly: true }, work);
  const alternate = () => ({ ...key, scope: { ...scope, namespace: "other" } });
  const claim = input => write(tx => capture.claim(tx, input, [{ ...message }], { leaseMs: 1 }));
  await write(tx => capture.admit(tx, structuredClone(key), [{ ...message }]));
  const initial = await claim(structuredClone(key));
  assert.equal(initial.status, "claimed");
  now++;
  const renewed = await claim(alternate());
  assert.equal(renewed.status, "claimed");
  assert.notEqual(renewed.token, initial.token);
  await assert.rejects(write(tx => capture.beginDispatch(tx, initial.token)), { code: "stale_admission" });
  await write(tx => capture.assertEligible(tx, structuredClone(key), [0]));
  await assert.rejects(write(tx => capture.assertEligible(tx, alternate(), [0])), { code: "stale_admission" });
  // A different digest or session from another namespace must not reveal the live lease as a conflict.
  await assert.rejects(write(tx => capture.assertEligible(tx, { ...alternate(), payloadDigest: "b".repeat(64) }, [0])),
    { code: "stale_admission" });
  await assert.rejects(write(tx => capture.assertEligible(tx, { ...alternate(), sessionId: "other-session" }, [0])),
    { code: "stale_admission" });
  assert.deepEqual(await read(tx => capture.load(tx, structuredClone(key))), { key, messages: [message] });
  assert.equal(await read(tx => capture.load(tx, alternate())), null);
  await write(tx => capture.abandon(tx, renewed.token, { code: "storage_error", retryable: true }));
  const retried = await claim(alternate());
  assert.equal(retried.status, "claimed");
  assert.notEqual(retried.token, renewed.token);
  await write(tx => capture.abandon(tx, retried.token, { code: "invalid_input", retryable: false }));
  assert.deepEqual(await claim(structuredClone(key)), { status: "duplicate" });
  assert.deepEqual(await claim(alternate()), { status: "duplicate" });

  assert.deepEqual(await read(tx => capture.load(tx, structuredClone(key))), { key, messages: [message] });
  assert.equal(await read(tx => capture.load(tx, alternate())), null);
  assert.deepEqual(await read(tx => capture.status(tx, { ...scope }, key.eventId, key.client)),
    { status: "failed", code: "invalid_input" });
  assert.deepEqual(await read(tx => capture.status(tx, alternate().scope, key.eventId, key.client)), { status: "unknown" });
  const [stored] = await harness.dump();
  assert.deepEqual(stored.claims.map(({ key, status }) => ({ key, status })), [{ key, status: "abandoned" }]);
});

test("capture status exposes the validated failure code and reads failure fields once", async () => {
  const { capture, uow } = createMemoryAdapter();
  const write = (work) => uow.run(scope.owner, { pauseLock: true }, work);
  await write(tx => capture.admit(tx, structuredClone(key), [{ ...message }]));
  const claim = await write(tx => capture.claim(tx, structuredClone(key), [{ ...message }], { leaseMs: 60_000 }));
  assert.equal(claim.status, "claimed");

  let codeReads = 0;
  let retryableReads = 0;
  await write(tx => capture.abandon(tx, claim.token, {
    get code() { return ++codeReads === 1 ? "invalid_input" : "Private error detail."; },
    get retryable() { retryableReads++; return false; },
  }));

  const status = await uow.run(scope.owner, { readOnly: true }, tx =>
    capture.status(tx, { ...scope }, key.eventId, key.client));
  assert.deepEqual({ status, codeReads, retryableReads }, {
    status: { status: "failed", code: "invalid_input" }, codeReads: 1, retryableReads: 1,
  });
});

test("queued admission and import writes validate and copy their inputs at entry", async () => {
  const { capture, uow, memories, harness } = createMemoryAdapter();
  const mutableKey = structuredClone(key);
  const batch = [{ ...message }];
  const mutableRow = { ...imported };
  const read = (work) => uow.run(scope.owner, { readOnly: true }, work);
  await uow.run(scope.owner, { pauseLock: true }, async (tx) => {
    const initial = memories.insert(tx, { ...scope }, { ...structuredClone(imported), createdAtMs: 0 }, [], 20);
    const invalid = capture.admit(tx, structuredClone(key), new Array(1));
    const first = capture.admit(tx, mutableKey, batch);
    const duplicate = capture.admit(tx, structuredClone(key), [{ ...message, content: "" }]);
    const invalidTime = memories.insert(tx, { ...scope }, { ...structuredClone(imported), createdAtMs: 21 }, [], 20);
    const insert = memories.insert(tx, { ...scope }, mutableRow, [], 20);
    mutableKey.scope.namespace = "changed";
    mutableKey.sessionId = "changed";
    batch[0].content = "changed";
    mutableRow.createdAtMs = 30;

    await initial;
    await assert.rejects(invalid, { code: "invalid_input" });
    assert.deepEqual(await first, { status: "admitted" });
    assert.deepEqual(await duplicate, { status: "duplicate" });
    await assert.rejects(invalidTime, { code: "invalid_input" });
    assert.equal((await insert).createdAtMs, -10);
  });
  assert.deepEqual(await read(tx => capture.load(tx, structuredClone(key))), { key, messages: [message] });
  const [stored] = await harness.dump();
  assert.deepEqual(stored.rows.map(({ row }) => row.createdAtMs).sort((a, b) => a - b), [-10, 0]);
});

test("a caught admission conflict remains sticky and rolls back the write run", async () => {
  const { capture, uow, harness } = createMemoryAdapter();
  const before = await harness.dump();
  await assert.rejects(uow.run(scope.owner, { pauseLock: true }, async tx => {
    await capture.admit(tx, structuredClone(key), [{ ...message }]);
    await assert.rejects(capture.admit(tx, { ...structuredClone(key), payloadDigest: "b".repeat(64) }, [{ ...message }]),
      { code: "event_payload_conflict" });
  }), { code: "event_payload_conflict" });
  assert.deepEqual(await harness.dump(), before);
});
