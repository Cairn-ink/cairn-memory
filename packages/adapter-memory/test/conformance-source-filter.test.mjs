import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { runCase, SOURCE_FILTER_CASES } from "@cairn-ink/conformance";
import { CoreError } from "@cairn-ink/core";

function hashSessionKey(client, sessionId) {
  return createHash("sha256").update(JSON.stringify([client, sessionId])).digest("hex");
}

function memoryFactory(sessionRefs) {
  return {
    name: `memory source filter (${sessionRefs})`,
    async open({ capabilities }) {
      const hash = sessionRefs === "hashed" ? hashSessionKey : undefined;
      const adapter = createMemoryAdapter({ capabilities, sessionRefs, hashSessionKey: hash });
      return {
        adapter, sessionRefs,
        harness: { ...adapter.harness, hashSessionKey: hash },
        nativeErrorMap: adapter.nativeErrorMap, busyNativeCodes: [], embeddingDimensions: null,
        async close() {},
      };
    },
  };
}

for (const sessionRefs of ["plain", "hashed"]) {
  const factory = memoryFactory(sessionRefs);
  for (const testCase of SOURCE_FILTER_CASES) {
    test(`${factory.name} ${testCase.id} ${testCase.title}`, async () => {
      assert.equal(await runCase(factory, testCase), null);
    });
  }
}

test("the keyed text check reports a missing fingerprint capability", async () => {
  const factory = memoryFactory("plain");
  const limited = { ...factory, open: ({ capabilities }) =>
    factory.open({ capabilities: { ...capabilities, fingerprintKey: false } }) };
  const textCase = SOURCE_FILTER_CASES.find(({ id }) => id === "K-SRC-4");
  assert.equal(await runCase(limited, textCase), "needs fingerprintKey");
});

const owner = "test-owner";
const key = {
  scope: { owner, namespace: null }, client: "test-client", sessionId: "test-session",
  eventId: "test-event", payloadDigest: "a".repeat(64),
};
const message = { id: "test-message", role: "user", content: "Test message", occurredAtMs: 10 };
const errorCode = (code) => (error) => error instanceof CoreError && error.code === code;

test("assertEligible uses the claim identity and requires a live lease", async () => {
  const { capture, harness, uow } = createMemoryAdapter({ now: () => 0 });
  const write = (fn) => uow.run(owner, { pauseLock: true }, fn);
  const claim = (admission) => write((tx) => capture.claim(tx, admission, [message], { leaseMs: 10 }));
  const assertPositions = (admission) => write((tx) => capture.assertEligible(tx, admission, [0]));

  const first = await claim(key);
  for (const changed of [{ ...key, sessionId: "other-session" }, { ...key, payloadDigest: "b".repeat(64) }]) {
    await assert.rejects(assertPositions(changed), errorCode("event_payload_conflict"));
  }
  await assert.rejects(assertPositions({ ...key, scope: { owner, namespace: "other" } }), errorCode("stale_admission"));
  await harness.advanceClock(10);
  await assert.rejects(assertPositions(key), errorCode("stale_admission"));
  const second = await claim(key);
  assert.notEqual(first.token, second.token);
  await assertPositions(key);
  await write((tx) => capture.finish(tx, second.token, []));
  await assert.rejects(assertPositions(key), errorCode("stale_admission"));

  const abandoned = { ...key, eventId: "abandoned-event" };
  const { token } = await claim(abandoned);
  await write((tx) => capture.abandon(tx, token, { code: "storage_error", retryable: true }));
  await assert.rejects(assertPositions(abandoned), errorCode("stale_admission"));
});

test("position shape errors allow commit and bounds errors poison the run", async () => {
  const { capture, harness, pause, uow } = createMemoryAdapter({ now: () => 0 });
  const write = (fn) => uow.run(owner, { pauseLock: true }, fn);
  const input = { ...message };
  await write(async (tx) => {
    await rejectsPositions(tx, [0, 0]);
    await capture.claim(tx, key, [input], { leaseMs: 10 });
    await pause.set(tx, owner, true);
    await capture.assertEligible(tx, key, [0]);
  });
  input.occurredAtMs = 20;
  await harness.seedFact(owner, {
    owner, kind: "window", origin: "forget", actionId: "test-window",
    client: key.client, window: { startMs: 20, endMs: 21 },
  });
  await write((tx) => capture.assertEligible(tx, key, [0]));
  const before = await harness.dump();
  await assert.rejects(write(async (tx) => {
    await pause.set(tx, owner, false);
    await rejectsPositions(tx, [1]);
  }), errorCode("invalid_input"));
  assert.deepEqual(await harness.dump(), before);

  function rejectsPositions(tx, positions) {
    return assert.rejects(capture.assertEligible(tx, key, positions), errorCode("invalid_input"));
  }
});
