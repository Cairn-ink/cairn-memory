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

test("capture status exposes the validated failure code and reads failure fields once", async () => {
  const { capture, uow } = createMemoryAdapter();
  const write = (work) => uow.run(scope.owner, { pauseLock: true }, work);
  await write(tx => capture.admit(tx, key, [message]));
  const claim = await write(tx => capture.claim(tx, key, [message], { leaseMs: 60_000 }));
  assert.equal(claim.status, "claimed");

  let codeReads = 0;
  let retryableReads = 0;
  await write(tx => capture.abandon(tx, claim.token, {
    get code() { return ++codeReads === 1 ? "invalid_input" : "Private error detail."; },
    get retryable() { retryableReads++; return false; },
  }));

  const status = await uow.run(scope.owner, { readOnly: true }, tx =>
    capture.status(tx, scope, key.eventId, key.client));
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
    const initial = memories.insert(tx, scope, { ...imported, createdAtMs: 0 }, [], 20);
    const invalid = capture.admit(tx, key, new Array(1));
    const first = capture.admit(tx, mutableKey, batch);
    const duplicate = capture.admit(tx, key, [{ ...message, content: "" }]);
    const invalidTime = memories.insert(tx, scope, { ...imported, createdAtMs: 21 }, [], 20);
    const insert = memories.insert(tx, scope, mutableRow, [], 20);
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
  assert.deepEqual(await read(tx => capture.load(tx, key)), { key, messages: [message] });
  const [stored] = await harness.dump();
  assert.deepEqual(stored.rows.map(({ row }) => row.createdAtMs).sort((a, b) => a - b), [-10, 0]);
});

test("a caught admission conflict remains sticky and rolls back the write run", async () => {
  const { capture, uow, harness } = createMemoryAdapter();
  const before = await harness.dump();
  await assert.rejects(uow.run(scope.owner, { pauseLock: true }, async tx => {
    await capture.admit(tx, key, [message]);
    await assert.rejects(capture.admit(tx, { ...key, payloadDigest: "b".repeat(64) }, [message]),
      { code: "event_payload_conflict" });
  }), { code: "event_payload_conflict" });
  assert.deepEqual(await harness.dump(), before);
});
