import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { runInNewContext } from "node:vm";
import { allDigests, CoreError, factIncarnationBody, normalizeForHash } from "@cairn-ink/core";
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

function fixture(t, storage, {
  gateCode, extractCode = gateCode ? null : "model_timeout", extractItems = [], embed, serviceConfig = config,
} = {}) {
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
    embedder: { ...options.embedder, embed: embed ?? options.embedder.embed },
    model: { ...options.model, async call(stage, request) {
      assert.equal(stage, "extract");
      requests.push(request);
      await onExtract?.();
      if (extractCode) throw new CoreError(extractCode);
      return { items: extractItems };
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
    async forgetText(content = messages[0].content) {
      const key = storage.capabilities.fingerprintKey ? await storage.keys.userKey(scope.owner) : null;
      const digests = await allDigests(content, key);
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
  await f.forgetText();
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

const registrationShapes = {
  "cross-realm objects": key => runInNewContext("({ [key]: true })", { key }),
  "class instances": key => new (class { [key] = true; })(),
  "boolean accessors": key => {
    let reads = 0;
    return { get [key]() { assert.equal(++reads, 1); return true; } };
  },
};

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
  "rolls back when the host aborts inside archiveAllowed and no messages are archived": async (t, storage) => {
    const f = fixture(t, storage);
    const caller = new AbortController();
    const archiveAllowed = t.mock.method(storage.raw, "archiveAllowed", async () => {
      caller.abort();
      return false;
    });
    await f.admit();

    const outcome = await f.run(caller.signal);
    assert.equal(archiveAllowed.mock.callCount(), 1);
    assert.equal(f.archive.mock.callCount(), 0);
    assert.deepEqual(outcome, { status: "failed", code: "model_timeout" });
    assertAbandoned(f, "model_timeout");
    await f.assertStored([]);
  },
  "rolls back when the host aborts inside archive after the rows are written": async (t, storage) => {
    const { archive } = storage.raw;
    const f = fixture(t, storage);
    const caller = new AbortController();
    let writeResult;
    f.archive.mock.mockImplementation(async (...args) => {
      writeResult = await archive(...args);
      caller.abort();
      return writeResult;
    });
    await f.admit();

    const outcome = await f.run(caller.signal);
    assert.deepEqual(writeResult, { archived: messages.length });
    assert.deepEqual(outcome, { status: "failed", code: "model_timeout" });
    assertAbandoned(f, "model_timeout");
    await f.assertStored([]);
  },
  "does not restore a conversation deleted during extraction": (t, storage) => assertDeleted(t, storage, false),
  "does not restore a conversation deleted just before the fallback transaction": (t, storage) => assertDeleted(t, storage, true),
  "filters text forgotten during extraction before calling the archive port": async (t, storage) => {
    const f = fixture(t, storage);
    await f.admit();
    f.duringExtract(f.forgetText);
    assertDone(await f.run(), "model_timeout");
    assert.deepEqual((await f.admission()).messages, messages);
    assert.deepEqual(f.archive.mock.calls.map(({ arguments: args }) => args[2]), [messages.slice(1)]);
    await f.assertStored(messages.slice(1));
  },
  "leaves a withheld candidate's admitted source out of Raw after embedding fails": async (t, storage) => {
    const withheld = "The lantern belongs beneath the staircase.";
    const survivor = "Orchids need water at the start of the week.";
    let embeddedTexts;
    const f = fixture(t, storage, {
      extractCode: null,
      extractItems: [
        { content: withheld, kind: "preference", confidence: 0.9, sourceIndices: [0] },
        { content: survivor, kind: "preference", confidence: 0.9, sourceIndices: [2] },
      ],
      embed(texts) {
        embeddedTexts = texts;
        throw new CoreError("embedding_failed");
      },
    });
    await f.admit();
    f.duringExtract(() => f.forgetText(withheld));

    assertDone(await f.run(), "embedding_failed");
    assert.deepEqual(embeddedTexts, [normalizeForHash(survivor)]);
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
  ...Object.fromEntries(Object.entries(registrationShapes).flatMap(([shape, makeFields]) => [
    [`registers Raw-only capture with ${shape}`, (_t, storage) => {
      createMemoryService({ ...deps(storage), model: null, config: { rawCapture: makeFields("enabled") } });
    }],
    [`registers model fallback with ${shape}`, (_t, storage) => {
      createMemoryService({ ...deps(storage), config: { rawCapture: makeFields("onModelFailure") } });
    }],
  ])),
  ...Object.fromEntries([
    ["an inherited option listed by ownKeys", key => new Proxy(Object.create({ [key]: true }), {
      ownKeys: () => [key],
    })],
    ["an accessor that adds an extra own key", key => ({
      get [key]() { this.extra = true; return true; },
    })],
  ].flatMap(([shape, makeFields]) => [
    [`rejects Raw-only capture with ${shape}`, (_t, storage) => {
      assert.throws(() => createMemoryService({ ...deps(storage), model: null,
        config: { rawCapture: makeFields("enabled") } }), { code: "invalid_input" });
    }],
    [`rejects model fallback with ${shape}`, (_t, storage) => {
      assert.throws(() => createMemoryService({ ...deps(storage),
        config: { rawCapture: makeFields("onModelFailure") } }), { code: "invalid_input" });
    }],
  ])),
  "rejects invalid fallback registrations and non-boolean options": (_t, storage) => {
    const options = deps(storage);
    assert.throws(() => createMemoryService({ ...options, model: null }), { code: "invalid_input" });
    for (const model of [null, options.model]) {
      assert.throws(() => createMemoryService({ ...options, model,
        config: { rawCapture: { enabled: true, onModelFailure: true } } }), { code: "invalid_input" });
    }
    for (const rawCapture of [
      { onModelFailure: undefined }, { onModelFailure: "true" }, { enabled: undefined, onModelFailure: true },
      Object.defineProperty({ onModelFailure: true }, "extra", { value: false }),
      { get onModelFailure() { return "true"; } },
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
