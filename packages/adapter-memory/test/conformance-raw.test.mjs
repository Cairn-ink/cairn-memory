import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { RAW_CASES, runCase } from "@cairn-ink/conformance";
import { CoreError } from "@cairn-ink/core";
import { hashSessionKey, rawFactory } from "./fixtures/raw.mjs";

for (const sessionRefs of ["plain", "hashed"]) {
  for (const required of [false, true]) {
    const factory = rawFactory({ sessionRefs, required });
    for (const testCase of RAW_CASES) {
      test(`${factory.name} ${testCase.id} ${testCase.title}`, async () => {
        assert.equal(await runCase(factory, testCase), null);
      });
    }
  }
}

for (const flag of ["rawArchive", "rawWindowHide", "rawSpans"]) {
  test(`Raw cases record a skip when ${flag} is off`, async () => {
    const factory = rawFactory({ flags: { [flag]: false } });
    for (const testCase of RAW_CASES.filter(({ needs }) => needs.includes(flag))) {
      assert.equal(await runCase(factory, testCase), `needs ${flag}`);
    }
  });
}

const scope = { owner: "test-owner", namespace: null };
const readScope = { owner: scope.owner, namespaces: [null] };
const key = { scope, client: "test-client", sessionId: "test-conversation", eventId: "test-event", payloadDigest: "a".repeat(64) };
const message = { id: "test-message", role: "user", content: "cedar garden", occurredAtMs: 1 };
const errorCode = (code) => (error) => error instanceof CoreError && error.code === code;

test("Raw archive capability is off by default", () => {
  const adapter = createMemoryAdapter();
  assert.equal(adapter.capabilities.rawArchive, false);
  assert.equal(adapter.raw, undefined);
});

test("Raw archive guards transactions and validates lineage before state access", async () => {
  const { raw, uow, harness } = createMemoryAdapter({ capabilities: { rawArchive: true } });
  const before = await harness.dump();
  const forged = { owner: scope.owner, readOnly: false, __adapter: {} };
  for (const invoke of [
    (tx) => raw.recordLineage(tx, key, []),
    (tx) => raw.archive(tx, key, [message]),
    (tx) => raw.fenceSession(tx, scope, key),
    (tx) => raw.deleteConversation(tx, scope, key),
    (tx) => raw.eraseSessions(tx, scope, [key]),
    (tx) => raw.purgeWithheld(tx, scope, []),
  ]) {
    await assert.rejects(invoke(forged), errorCode("internal_error"));
    await assert.rejects(uow.run("other-owner", {}, invoke), errorCode("internal_error"));
    await assert.rejects(uow.run(scope.owner, { readOnly: true }, invoke), errorCode("internal_error"));
  }
  for (const invoke of [
    (tx) => raw.archiveAllowed(tx, key),
    (tx) => raw.raw(tx, readScope, "cedar", "context", { limit: 1 }),
    (tx) => raw.listRaw(tx, readScope, { limit: 1, cursor: null }),
  ]) {
    await assert.rejects(invoke(forged), errorCode("internal_error"));
    await assert.rejects(uow.run("other-owner", {}, invoke), errorCode("internal_error"));
  }

  const messages = Object.defineProperty([message], "0", { get() { assert.fail("message accessor called"); } });
  await uow.run(scope.owner, {}, async (tx) => {
    await assert.rejects(raw.recordLineage(tx, key, messages), errorCode("invalid_input"));
    await assert.rejects(raw.archive(tx, key, messages), errorCode("invalid_input"));
    await assert.rejects(raw.purgeWithheld(tx, scope, new Array(1)), errorCode("invalid_input"));
    await assert.rejects(raw.eraseSessions(tx, scope, new Array(1)), errorCode("invalid_input"));
    await assert.rejects(raw.raw(tx, { ...readScope, namespaces: new Array(1) }, "cedar", "search", { limit: 1 }),
      errorCode("invalid_input"));
  });
  assert.equal(JSON.stringify(await harness.dump()), JSON.stringify(before));
  await uow.run(scope.owner, {}, (tx) => raw.recordLineage(tx, key, [message]));
  const after = await harness.dump();
  const digest = after[0]?.rawAnchors?.[0]?.messages?.[0]?.digests?.[0];
  assert.match(digest, /^[a-f0-9]{64}$/u);
  assert.deepEqual(after, [...before, {
    owner: scope.owner, rows: [], facts: [], pause: { paused: false, generation: 0 },
    rawRows: [], rawFences: [], rawAnchors: [{
      client: key.client, namespace: scope.namespace, sessionId: key.sessionId,
      messages: [{ id: message.id, digests: [digest] }],
    }], indexRevision: 0,
  }]);
});

test("Raw writes copy their inputs at entry and execute in FIFO order", async () => {
  const { raw, uow, harness, snapshot } = createMemoryAdapter({ capabilities: { rawArchive: true } });
  const mutableKey = { ...key, scope: { ...scope } };
  const messages = [{ ...message }];
  messages[Symbol.iterator] = function* () { yield { ...message, id: "wrong-message" }; };
  const session = { client: key.client, sessionId: key.sessionId };
  const read = (fn) => uow.run(scope.owner, { readOnly: true }, fn);
  const before = await read((tx) => snapshot.stateToken(tx, readScope));
  await uow.run(scope.owner, {}, async (tx) => {
    const archive = raw.archive(tx, mutableKey, messages);
    const fence = raw.fenceSession(tx, scope, session);
    const refused = raw.archive(tx, mutableKey, [{ ...message, id: "late" }]);
    const remove = raw.deleteConversation(tx, scope, session);
    mutableKey.scope.namespace = "other";
    mutableKey.sessionId = "other-conversation";
    messages[0].id = "changed-message";
    session.sessionId = "other-conversation";
    assert.deepEqual(await archive, { archived: 1 });
    await fence;
    assert.deepEqual(await refused, { archived: 0 });
    assert.deepEqual(await remove, { rawDeleted: 1 });
  });
  const after = await read((tx) => snapshot.stateToken(tx, readScope));
  assert.notEqual(after, before);
  assert.equal((await harness.counters()).rawArchiveRefused, 1);
  assert.equal(await read((tx) => raw.archiveAllowed(tx, key)), false);
});

test("Raw write failures after state access poison the run", async (t) => {
  const { raw, uow, harness } = createMemoryAdapter({ capabilities: { rawArchive: true, rawSpans: true } });
  const fact = {
    owner: scope.owner, actionId: "test-forget", origin: "forget", kind: "rawSpan",
    sessionKeyHash: hashSessionKey(key.client, key.sessionId), messageKey: message.id,
    startUtf16: 0, endUtf16: 1, contentDigest: "a".repeat(64),
  };
  await harness.seedFact(scope.owner, fact);
  const before = await harness.dump();
  t.mock.method(crypto.subtle, "digest", () => Promise.reject(new CoreError("fingerprint_unavailable")));
  await assert.rejects(uow.run(scope.owner, {}, async (tx) => {
    await raw.fenceSession(tx, scope, { client: key.client, sessionId: "other-conversation" });
    await assert.rejects(raw.archive(tx, key, [message]), errorCode("fingerprint_unavailable"));
  }), errorCode("fingerprint_unavailable"));
  assert.deepEqual(await harness.dump(), before);
});

test("Raw archive admission fails closed on an unresolved hashed session", async () => {
  const { raw, uow, harness } = createMemoryAdapter({
    capabilities: { rawArchive: true }, sessionRefs: "hashed", hashSessionKey: () => null,
  });
  await uow.run(scope.owner, {}, (tx) => raw.archive(tx, key, [message]));
  await harness.seedFact(scope.owner, { owner: scope.owner, actionId: "test-forget", origin: "forget",
    kind: "session", session: { client: key.client, sessionKeyHash: "a".repeat(64) } });
  await uow.run(scope.owner, {}, async (tx) => {
    assert.equal(await raw.archiveAllowed(tx, key), false);
    assert.deepEqual(await raw.archive(tx, key, [{ ...message, id: "late" }]), { archived: 0 });
    const page = await raw.listRaw(tx, readScope, { cursor: null, limit: 10 });
    assert.deepEqual(page.items, []);
    assert.deepEqual(await raw.deleteConversation(tx, scope, key), { rawDeleted: 1 });
  });
});
