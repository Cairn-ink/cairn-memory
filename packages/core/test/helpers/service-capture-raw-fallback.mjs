import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { allDigests, CoreError, factIncarnationBody } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";

const scope = { owner: "owner", namespace: null };
const selection = { client: "client", sessionId: "session", eventId: "event" };
const lookup = { scope, ...selection };
const messages = [
  { id: "lantern", role: "user", content: "Store the lantern under the stairs.", occurredAtMs: 10 },
  { id: "shelf", role: "assistant", content: "There is space on the bottom shelf.", occurredAtMs: 20 },
  { id: "orchids", role: "user", content: "Water the orchids on Mondays.", occurredAtMs: 30 },
];
const config = { rawCapture: { onModelFailure: true }, deadlines: { extract: 20_000 } };
const sha256Hex = text => createHash("sha256").update(text).digest("hex");

function deps(storage) {
  return {
    storage, config,
    model: { model: "test", contextWindow: 65_536, countTokens: () => 1,
      call: () => assert.fail("Registration called the model") },
    embedder: { model: "test", dimensions: 1, embed: () => assert.fail("Fallback called the embedder") },
    gate: { assertOpen() {} },
    clock: { nowMs: () => 1_000, monotonicMs: () => 1_000, sha256Hex,
      hmacHex: (key, text) => createHmac("sha256", key).update(text).digest("hex") },
    tokens: { countTokens: () => 1 },
  };
}

function fixture(t, storage, { gateCode, extractCode = gateCode ? null : "model_timeout", serviceConfig = config } = {}) {
  const { capture, raw, uow } = storage;
  const archive = raw && t.mock.method(raw, "archive");
  const abandon = t.mock.method(capture, "abandon");
  const finish = t.mock.method(capture, "finish");
  const assertEligible = t.mock.method(capture, "assertEligible");
  const readStatus = t.mock.method(capture, "status");
  const runTransaction = t.mock.method(uow, "run");
  const options = deps(storage);
  let monotonicMs = 1_000;
  let onExtract;
  const requests = [];
  const service = createMemoryService({
    ...options, config: serviceConfig,
    clock: { ...options.clock, monotonicMs: () => monotonicMs },
    gate: { assertOpen(_owner, phase) { if (phase === "post-send" && gateCode) throw new CoreError(gateCode); } },
    model: { ...options.model, async call(stage, request) {
      assert.equal(stage, "extract");
      requests.push(request);
      await onExtract?.();
      if (extractCode) throw new CoreError(extractCode);
      return { items: [] };
    } },
  });
  const read = work => uow.run(scope.owner, { readOnly: true }, work);
  const write = work => uow.run(scope.owner, { pauseLock: true }, work);
  const admission = () => read(tx => capture.load(tx, lookup));
  return {
    service, raw, write, admission, archive, abandon, finish, assertEligible, readStatus, runTransaction, requests,
    run: signal => service.runCapture(scope, selection, { signal }),
    duringExtract(hook) { onExtract = hook; },
    expireDeadline() { monotonicMs += config.deadlines.extract; },
    async admit() {
      assert.deepEqual(await service.enqueueCapture(scope, { ...selection, messages }), { status: "accepted" });
    },
    async forgetFirstText() {
      const key = storage.capabilities.fingerprintKey ? await storage.keys.userKey(scope.owner) : null;
      const digests = await allDigests(messages[0].content, key);
      const fact = { ...scope, origin: "forget", kind: "text", mode: "exact", actionId: "forget-text", text: { digests } };
      // Leave the outbox intact to exercise Core's finish-time text filter.
      const result = await write(tx => storage.suppressions.writeFact(tx, fact, sha256Hex(factIncarnationBody(fact))));
      assert.equal(result.created, true);
    },
    async assertStored(expected) {
      if (raw) {
        const page = await service.listRawMessages(scope, { limit: 10 });
        assert.equal(page.nextCursor, null);
        const actual = page.items.map(({ messageId: id, role, content, occurredAtMs }) => ({ id, role, content, occurredAtMs }));
        assert.deepEqual(actual.sort((a, b) => a.occurredAtMs - b.occurredAtMs), expected);
      } else {
        assert.deepEqual(expected, []);
        await assert.rejects(service.listRawMessages(scope, { limit: 10 }), { code: "capability_unavailable" });
      }
      const memories = await read(tx => storage.memories.exportPage(tx, scope, { cursor: null, limit: 10 }));
      assert.deepEqual(memories.items, []);
    },
  };
}

function assertDone(outcome, code) {
  assert.equal(outcome.status, "done", JSON.stringify(outcome));
  assert.equal(outcome.code, code);
  assert.deepEqual(outcome.result.memories, []);
  assert.ok(Number.isSafeInteger(outcome.result.indexRevision));
}

function assertAbandoned(f, code, retryable = false) {
  assert.deepEqual(f.abandon.mock.calls.map(({ arguments: args }) => args[2]), [{ code, retryable }]);
}

async function assertNoFinish(f, outcome, code, retryable) {
  assert.deepEqual(outcome, code === "capture_paused" ? { status: "paused" } : { status: "failed", code });
  assertAbandoned(f, code, retryable);
  assert.equal(f.finish.mock.callCount(), 0);
  assert.equal(f.archive?.mock.callCount() ?? 0, 0);
  await f.assertStored([]);
}

export async function assertDeleted(t, storage, beforeTransaction) {
  const f = fixture(t, storage);
  await f.admit();
  await f.write(async tx => {
    const { key, messages: admitted } = await storage.capture.load(tx, lookup);
    assert.deepEqual(await storage.raw.archive(tx, key, admitted), { archived: messages.length });
  });
  await f.assertStored(messages);
  f.archive.mock.resetCalls();

  let deleted = false;
  async function deleteConversation() {
    assert.deepEqual(await f.write(tx => f.raw.deleteConversation(tx, scope, selection)), { rawDeleted: messages.length });
    assert.deepEqual((await f.admission()).messages.map(({ content }) => content), ["", "", ""]);
    deleted = true;
  }
  if (beforeTransaction) {
    const { run } = storage.uow;
    f.duringExtract(() => {
      storage.uow.run = async (...args) => {
        storage.uow.run = run;
        assert.deepEqual(args[1], { pauseLock: true });
        await deleteConversation();
        return run(...args);
      };
    });
  } else {
    f.duringExtract(deleteConversation);
  }

  assertDone(await f.run(), "model_timeout");
  assert.equal(deleted, true);
  assert.deepEqual(f.assertEligible.mock.calls.at(-1).arguments[2], [], "Withdraw blank slots before asserting eligibility");
  assert.equal(f.archive.mock.callCount(), 0, "Deleted sources must not reach the archive port");
  await f.assertStored([]);
}

export async function assertTimeout(t, storage) {
  const f = fixture(t, storage);
  await f.admit();
  const admitted = (await f.admission()).messages;
  await f.forgetFirstText();
  f.duringExtract(f.expireDeadline);

  const done = await f.run();
  assertDone(done, "model_timeout");
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.requests[0].input.messages.map(({ content }) => content),
    admitted.slice(1).map(({ content }) => content));
  assert.deepEqual(f.archive.mock.calls.map(({ arguments: args }) => args[2]), [admitted.slice(1)]);
  assert.equal(f.abandon.mock.callCount(), 0);
  const replay = await f.run();
  assert.deepEqual(replay, replay.status === "duplicate" ? { status: "duplicate" } : { status: "done", result: done.result });
  assert.equal(f.archive.mock.callCount(), 1);
  assert.equal(f.requests.length, 1);
  await f.assertStored(admitted.slice(1));
}

export async function assertUnavailableArchive(t, storage) {
  const f = fixture(t, storage);
  await f.admit();
  await assertNoFinish(f, await f.run(), "model_timeout");
  assert.equal(f.requests.length, 1);
}

export const scenarios = {
  "archives only screened admitted messages after an expired extraction deadline and replays once": assertTimeout,
  ...Object.fromEntries([
    ["extraction_failed", { extractCode: "extraction_failed" }, "extraction_failed"],
    ["normalized extract provider_error", { extractCode: "provider_error" }, "extraction_failed"],
    ["invalid_model_output", { extractCode: "invalid_model_output" }, "invalid_model_output"],
    ["token_count_unavailable", { extractCode: "token_count_unavailable" }, "token_count_unavailable"],
    ["context_budget_exceeded", { extractCode: "context_budget_exceeded" }, "context_budget_exceeded"],
    // The post-send gate injects codes that the extract transport would normalize.
    ...["provider_error", "embedding_failed", "qualification_failed", "reconciliation_failed", "classification_failed",
      "rationale_failed"].map(code => [code, { gateCode: code }, code]),
  ].map(([label, script, code]) => [`archives after ${label}`, async (t, storage) => {
    const f = fixture(t, storage, script);
    await f.admit();
    assertDone(await f.run(), code);
    assert.equal(f.requests.length, 1);
    assert.equal(f.abandon.mock.callCount(), 0);
    assert.deepEqual(f.archive.mock.calls.map(({ arguments: args }) => args[2]), [messages]);
    await f.assertStored(messages);
  }])),
  ...Object.fromEntries(["suppressed", "lineage_fenced", "ingest_inputs_changed", "capture_paused",
    "fingerprint_key_mismatch"].map(code => [`keeps the existing outcome for ${code}`, async (t, storage) => {
    const f = fixture(t, storage, { gateCode: code });
    await f.admit();
    if (code === "capture_paused") f.duringExtract(() => f.service.setPause(scope.owner, true));
    await assertNoFinish(f, await f.run(), code, code === "ingest_inputs_changed");
    assert.equal(f.requests.length, 1);
  }])),
  "abandons as paused when the owner pauses during a timed-out extraction": async (t, storage) => {
    const f = fixture(t, storage);
    await f.admit();
    f.duringExtract(() => f.service.setPause(scope.owner, true));
    await assertNoFinish(f, await f.run(), "capture_paused");
  },
  "keeps cancellation when the host aborts during extraction": async (t, storage) => {
    const f = fixture(t, storage);
    const caller = new AbortController();
    await f.admit();
    f.duringExtract(() => caller.abort());
    await assertNoFinish(f, await f.run(caller.signal), "model_cancelled");
    assert.equal(f.requests.length, 1);
  },
  "skips even the fallback transaction when the host aborts as extraction times out": async (t, storage) => {
    const f = fixture(t, storage);
    const caller = new AbortController();
    await f.admit();
    let beforeAbort;
    f.duringExtract(() => {
      beforeAbort = f.runTransaction.mock.callCount();
      f.expireDeadline();
      caller.abort();
    });
    const outcome = await f.run(caller.signal);
    assert.equal(f.runTransaction.mock.callCount() - beforeAbort, 1, "Only the original abandon transaction may run");
    await assertNoFinish(f, outcome, "model_timeout");
  },
  "does not restore a conversation deleted during extraction": (t, storage) => assertDeleted(t, storage, false),
  "does not restore a conversation deleted just before the fallback transaction": (t, storage) => assertDeleted(t, storage, true),
  "filters text forgotten during extraction before calling the archive port": async (t, storage) => {
    const f = fixture(t, storage);
    await f.admit();
    f.duringExtract(f.forgetFirstText);
    assertDone(await f.run(), "model_timeout");
    assert.deepEqual((await f.admission()).messages, messages);
    assert.deepEqual(f.archive.mock.calls.map(({ arguments: args }) => args[2]), [messages.slice(1)]);
    await f.assertStored(messages.slice(1));
  },
  ...Object.fromEntries([["unset", {}], ["false", { rawCapture: { onModelFailure: false } }]]
    .map(([label, serviceConfig]) => [`abandons on timeout with the option ${label}`, async (t, storage) => {
      const f = fixture(t, storage, { serviceConfig });
      await f.admit();
      await assertNoFinish(f, await f.run(), "model_timeout");
      assert.equal(f.requests.length, 1);
      assert.deepEqual(await f.service.captureStatus(scope, selection.eventId, { client: selection.client }),
        { status: "failed", code: "model_timeout" });
    }])),
  "rejects invalid fallback registrations and non-data options": (_t, storage) => {
    const options = deps(storage);
    assert.throws(() => createMemoryService({ ...options, model: null }), { code: "invalid_input" });
    for (const model of [null, options.model]) {
      assert.throws(() => createMemoryService({ ...options, model,
        config: { rawCapture: { enabled: true, onModelFailure: true } } }), { code: "invalid_input" });
    }
    for (const rawCapture of [
      { onModelFailure: undefined }, { onModelFailure: "true" }, { enabled: undefined, onModelFailure: true },
      Object.assign(Object.create({ enabled: false }), { onModelFailure: true }),
      Object.defineProperty({ onModelFailure: true }, "extra", { value: false }),
      { get onModelFailure() { assert.fail("Option validation invoked a getter"); } },
    ]) {
      assert.throws(() => createMemoryService({ ...options, config: { rawCapture } }), { code: "invalid_input" });
    }
  },
  "rolls back an archive failure and abandons with the original model failure": async (t, storage) => {
    const { archive } = storage.raw;
    const f = fixture(t, storage);
    await f.admit();
    f.archive.mock.mockImplementation(async (...args) => {
      await archive(...args);
      throw new CoreError("storage_error");
    });
    assert.deepEqual(await f.run(), { status: "failed", code: "model_timeout" });
    assert.equal(f.finish.mock.callCount(), 1);
    assert.equal(f.archive.mock.callCount(), 1);
    assertAbandoned(f, "model_timeout");
    await f.assertStored([]);
  },
  "resolves an unknown fallback commit through the ledger without abandoning": async (t, storage) => {
    const f = fixture(t, storage);
    await f.admit();
    const { run } = storage.uow;
    f.duringExtract(() => {
      storage.uow.run = async (...args) => {
        storage.uow.run = run;
        await run(...args);
        throw new CoreError("commit_outcome_unknown");
      };
    });
    assert.deepEqual(await f.run(), { status: "failed", code: "commit_outcome_unknown" });
    assert.equal(f.readStatus.mock.callCount(), 1);
    assert.equal(f.abandon.mock.callCount(), 0);
    assert.equal(f.archive.mock.callCount(), 1);
    await f.assertStored(messages);
  },
};
