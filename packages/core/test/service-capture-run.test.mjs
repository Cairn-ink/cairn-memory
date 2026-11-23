import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { CoreError } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { allDigests, coreFingerprintLabels, fingerprintLegacyCapture } from "../src/privacy/fingerprint.mjs";
import { hostedScope as scope, serviceFake } from "./helpers/service-fake.mjs";

const selection = Object.freeze({ client: "client", sessionId: "session", eventId: "event" });
const messages = [
  { id: "one", role: "user", content: "I prefer  black tea.", occurredAtMs: 1234 },
  { id: "excluded", role: "user", content: "Exclude this evidence.", occurredAtMs: 2345 },
  { id: "three", role: "assistant", content: "Black tea it is.", occurredAtMs: null },
];
const candidate = (content = "I prefer black tea.", sourceIndices = [0], confidence = 0.8) =>
  ({ content, kind: "preference", confidence, sourceIndices });
const validCode = expected => error => error instanceof CoreError && error.code === expected && error.message === expected;
const sha = text => createHash("sha256").update(text).digest("hex");

function setup({ required = false, config = {}, ...fakeOptions } = {}) {
  const fake = serviceFake({ writes: true, capture: true, ...fakeOptions });
  const diagnostics = [];
  fake.deps.config = config;
  fake.deps.diagnostics = event => diagnostics.push(event);
  fake.storage.capabilities.embeddingRequiredOnInsert = required;
  fake.hooks.model = () => ({ items: [candidate()] });
  const service = createMemoryService(fake.deps);
  async function admit(target = scope) {
    assert.deepEqual(await service.enqueueCapture(target, { ...selection, messages }), { status: "accepted" });
    fake.calls.length = 0;
    fake.mutations.length = 0;
  }
  return { ...fake, service, diagnostics, admit, run: options => service.runCapture(scope, selection, options) };
}

const methods = f => f.calls.map(([method]) => method);
const sends = f => methods(f).filter(method => method === "model.call" || method === "embed");
const mutation = (f, name) => f.mutations.find(({ method }) => method === name);
const locked = ["run", "lock", "lock", "pause.get"];

function assertAbandoned(f, code, retryable) {
  const abandoned = f.mutations.filter(({ method }) => method === "capture.abandon");
  assert.equal(abandoned.length, 1);
  const [, token] = mutation(f, "capture.claim").args;
  assert.deepEqual(abandoned[0].args, [
    mutation(f, "capture.beginDispatch") ? "dispatch-2" : token,
    { code, retryable },
  ]);
  assert.deepEqual(f.committed(scope.owner).rows, []);
}

test("capture runs the leased plain extraction outside transactions and binds trusted receipts", async () => {
  const f = setup();
  const key = await f.storage.keys.userKey(scope.owner);
  await f.admit();
  f.hooks.eligible = () => [0, 2];
  f.hooks.model = () => ({ items: [candidate("  Ｉ prefer BLACK  tea. ", [1, 0], 0.5), candidate("Discard this.", [0], 0.49)] });
  const done = await f.run();
  assert.deepEqual(done, { status: "done", result: {
    indexRevision: 1, memories: [{ id: "captured-1", revision: 1, outcome: "inserted" }],
    suppressedCount: 0, duplicateCount: 0, counters: {},
  } });
  assert.deepEqual(methods(f), [
    ...locked,
    ...locked, "capture.load", "capture.claim", "capture.eligible",
    ...locked, "capture.beginDispatch",
    "gate", "gate", "model.call", "gate", "keys.userKey", "gate", "embed", "keys.userKey",
    ...locked, "capture.assertEligible", "suppressions.snapshot", "capture.finish",
  ]);
  assert.ok(f.calls.filter(([method]) => method === "run")
    .every(([, owner, options]) => owner === scope.owner && options.pauseLock && !options.readOnly));
  assert.deepEqual(f.calls.filter(([method]) => method === "gate").map(([, , phase]) => phase),
    ["pre-send", "dispatch", "post-send", "dispatch"]);
  const [, stage, request] = f.calls.find(([method]) => method === "model.call");
  assert.equal(stage, "extract");
  assert.equal(request.schemaName, "cairn_extract");
  assert.deepEqual(request.input, { messages: [
    { index: 0, role: "user", content: "I prefer black tea." },
    { index: 1, role: "assistant", content: messages[2].content },
  ] });
  assert.deepEqual(f.calls.find(([method]) => method === "capture.claim")[3], { leaseMs: 125_000 });
  assert.deepEqual(f.calls.find(([method]) => method === "capture.assertEligible")[2], [0, 2]);
  const [token, items] = mutation(f, "capture.finish").args;
  assert.equal(token, "dispatch-2");
  assert.deepEqual(items, [{
    content: "I prefer BLACK tea.", kind: "preference", confidence: 0.5,
    textHash: "sha256:" + sha("i prefer black tea."),
    digests: await allDigests("I prefer BLACK tea.", key),
    embedding: { model: "embedder", vector: Float32Array.of(1) },
    receipts: [messages[2], messages[0]].map(({ id, role, occurredAtMs }) => ({
      client: selection.client, sessionId: selection.sessionId, messageId: id, role, occurredAtMs,
    })),
  }]);
});

test("replay returns exactly the stored result without model sends or another finish", async () => {
  const f = setup({ config: { leaseMs: 43 } });
  await f.admit();
  const completed = await f.run();
  assert.equal(completed.status, "done");
  assert.deepEqual(f.calls.find(([method]) => method === "capture.claim")[3], { leaseMs: 43 });
  f.calls.length = 0;
  f.mutations.length = 0;
  assert.deepEqual(await f.run(), completed);
  assert.deepEqual(methods(f), [...locked, ...locked, "capture.load", "capture.claim"]);
  assert.deepEqual(f.mutations, []);
});

test("processing and terminal duplicate pass through without another claim or send", async () => {
  const f = setup();
  await f.admit();
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  f.hooks.model = async () => {
    entered.resolve();
    await release.promise;
    throw new CoreError("extraction_failed");
  };
  const pending = f.run();
  await entered.promise;
  try {
    assert.deepEqual(await f.run(), { status: "processing" });
    assert.deepEqual(sends(f), ["model.call"]);
  } finally { release.resolve(); }
  assert.deepEqual(await pending, { status: "failed", code: "extraction_failed" });
  f.calls.length = 0;
  assert.deepEqual(await f.run(), { status: "duplicate" });
  assert.deepEqual(sends(f), []);
});

test("unknown events return not_found before any claim", async () => {
  const f = setup();
  assert.deepEqual(await f.run(), { status: "failed", code: "not_found" });
  assert.deepEqual(methods(f), [...locked, ...locked, "capture.load"]);
});

test("selection and options are validated before ports and the selection is snapshotted once", async () => {
  const f = setup();
  for (const [invalidSelection, options] of [
    [{ ...selection, client: " spaced" }, undefined],
    [{ ...selection, sessionId: null }, undefined],
    [{ ...selection, eventId: undefined }, undefined],
    [{ ...selection, extra: true }, undefined],
    [selection, null], [selection, { extra: true }], [selection, { signal: {} }],
    [selection, { signal: Object.create(AbortSignal.prototype) }],
  ]) await assert.rejects(() => f.service.runCapture(scope, invalidSelection, options), validCode("invalid_input"));
  assert.deepEqual(f.calls, []);

  await f.admit();
  const input = { ...selection };
  let reads = 0;
  Object.defineProperty(input, "sessionId", { get: () => { reads++; return selection.sessionId; }, enumerable: true });
  f.hooks.beforeRun = () => { input.eventId = "changed"; };
  assert.equal((await f.service.runCapture(scope, input)).status, "done");
  assert.equal(reads, 1);
});

test("missing runner methods reject before any port call", async () => {
  for (const method of ["load", "claim", "beginDispatch", "finish", "abandon", "eligible", "assertEligible", "status"]) {
    const f = setup();
    delete f.storage.capture[method];
    await assert.rejects(f.run, validCode("capability_unavailable"), method);
    assert.deepEqual(f.calls, []);
  }
  const raw = setup({ rawArchive: true });
  delete raw.storage.raw.archive;
  await assert.rejects(raw.run, validCode("capability_unavailable"));
  assert.deepEqual(raw.calls, []);
});

test("paused preflight and a pause before the claim both stop before loading", async () => {
  const f = setup();
  await f.admit();
  await f.service.setPause(scope.owner, true);
  f.calls.length = 0;
  assert.deepEqual(await f.run(), { status: "paused" });
  assert.deepEqual(methods(f), locked);

  await f.service.setPause(scope.owner, false);
  f.calls.length = 0;
  let runs = 0;
  f.hooks.beforeRun = async () => {
    if (++runs !== 2) return;
    f.hooks.beforeRun = undefined;
    await f.service.setPause(scope.owner, true);
  };
  assert.deepEqual(await f.run(), { status: "paused" });
  assert.equal(methods(f).includes("capture.load"), false);
  assert.deepEqual(f.mutations, []);
});

test("pause and resume between claim and dispatch abandon the original token", async () => {
  const f = setup();
  await f.admit();
  let runs = 0;
  f.hooks.beforeRun = async () => {
    if (++runs !== 3) return;
    f.hooks.beforeRun = undefined;
    await f.service.setPause(scope.owner, true);
    await f.service.setPause(scope.owner, false);
  };
  assert.deepEqual(await f.run(), { status: "paused" });
  assert.deepEqual(sends(f), []);
  assert.equal(mutation(f, "capture.beginDispatch"), undefined);
  assert.equal(mutation(f, "capture.finish"), undefined);
  assertAbandoned(f, "capture_paused", false);
});

test("a pause and resume during extraction make finish abandon the dispatched token", async () => {
  const f = setup({ rawArchive: true });
  await f.admit();
  f.hooks.model = async () => {
    await f.service.setPause(scope.owner, true);
    await f.service.setPause(scope.owner, false);
    return { items: [candidate()] };
  };
  assert.deepEqual(await f.run(), { status: "paused" });
  assert.equal(mutation(f, "capture.finish"), undefined);
  assert.equal(mutation(f, "raw.archive"), undefined);
  assertAbandoned(f, "capture_paused", false);
});

test("a closed transport gate prevents provider and embedding sends", async () => {
  for (const stopAt of [1, 2]) {
    const f = setup();
    await f.admit();
    let dispatches = 0;
    f.hooks.gate = phase => {
      if (phase === "dispatch" && ++dispatches === stopAt) throw new CoreError("capture_paused");
    };
    assert.deepEqual(await f.run(), { status: "paused" });
    assert.deepEqual(sends(f), stopAt === 1 ? [] : ["model.call"]);
    assertAbandoned(f, "capture_paused", false);
  }
});

test("no eligible messages finishes an empty batch without dispatch or archive", async () => {
  const f = setup({ rawArchive: true });
  await f.admit();
  f.hooks.eligible = () => [];
  assert.deepEqual(await f.run(), { status: "done", result: {
    indexRevision: 0, memories: [], suppressedCount: 0, duplicateCount: 0, counters: {},
  } });
  assert.deepEqual(methods(f), [
    ...locked, ...locked, "capture.load", "capture.claim", "capture.eligible", ...locked, "capture.finish",
  ]);
  assert.deepEqual(mutation(f, "capture.finish").args, ["lease-1", []]);
});

test("an eligible scrubbed slot never reaches extraction, evidence, or Raw", async () => {
  const f = setup({ rawArchive: true });
  f.seedFact({ ...scope, kind: "window", origin: "forget", actionId: "forget-window",
    client: selection.client, window: { startMs: 1000, endMs: 3000 } });
  const [withheld, , normal] = messages;
  assert.deepEqual(await f.service.enqueueCapture(scope, { ...selection, messages: [withheld, normal] }),
    { status: "accepted" });
  f.hooks.eligible = () => [0, 1];

  assert.equal((await f.run()).status, "done");
  assert.deepEqual(f.calls.find(([method]) => method === "capture.claim")[2], [{ ...withheld, content: "" }, normal]);
  assert.deepEqual(f.calls.find(([method]) => method === "model.call")[2].input.messages,
    [{ index: 0, role: normal.role, content: normal.content }]);
  assert.deepEqual(f.calls.find(([method]) => method === "capture.assertEligible")[2], [1]);
  assert.deepEqual(mutation(f, "capture.finish").args[1][0].receipts, [{
    client: selection.client, sessionId: selection.sessionId, messageId: normal.id,
    role: normal.role, occurredAtMs: normal.occurredAtMs,
  }]);
  assert.deepEqual(mutation(f, "raw.archive").args[1], [normal]);
  assert.deepEqual(f.archived(scope.owner), [normal]);
});

test("an all-withheld admission finishes empty and marks the event done", async () => {
  const f = setup({ rawArchive: true });
  f.seedFact({ ...scope, kind: "window", origin: "forget", actionId: "forget-window",
    client: selection.client, window: { startMs: 1000, endMs: 3000 } });
  const incoming = messages.slice(0, 2);
  assert.deepEqual(await f.service.enqueueCapture(scope, { ...selection, messages: incoming }), { status: "accepted" });
  f.hooks.eligible = () => [0, 1];

  assert.deepEqual(await f.run(), { status: "done", result: {
    indexRevision: 0, memories: [], suppressedCount: 0, duplicateCount: 0, counters: {},
  } });
  assert.deepEqual(f.calls.find(([method]) => method === "capture.claim")[2],
    incoming.map(message => ({ ...message, content: "" })));
  assert.deepEqual(mutation(f, "capture.finish").args, ["lease-1", []]);
  assert.deepEqual(sends(f), []);
  assert.equal(mutation(f, "capture.beginDispatch"), undefined);
  assert.equal(mutation(f, "raw.archive"), undefined);
  assert.deepEqual(await f.service.captureStatus(scope, selection.eventId), { status: "done" });
});

test("the empty finish still abandons on a generation change", async () => {
  const f = setup();
  await f.admit();
  f.hooks.eligible = () => [];
  let runs = 0;
  f.hooks.beforeRun = async () => {
    if (++runs !== 3) return;
    f.hooks.beforeRun = undefined;
    await f.service.setPause(scope.owner, true);
    await f.service.setPause(scope.owner, false);
  };
  assert.deepEqual(await f.run(), { status: "paused" });
  assert.equal(mutation(f, "capture.finish"), undefined);
  assertAbandoned(f, "capture_paused", false);
});

test("eligibility lost at finish abandons and returns the code only", async () => {
  const f = setup();
  await f.admit();
  f.hooks.assertEligible = () => { throw new CoreError("lineage_fenced"); };
  assert.deepEqual(await f.run(), { status: "failed", code: "lineage_fenced" });
  assert.equal(mutation(f, "capture.finish"), undefined);
  assertAbandoned(f, "lineage_fenced", false);
});

test("capture withholds forgotten wording, a prefixed copy, and a hosted spelling with one diagnostic each", async () => {
  const f = setup();
  const key = await f.storage.keys.userKey(scope.owner);
  const text = "The lantern is stored in the cellar.";
  const { shingles } = await fingerprintLegacyCapture(text, key, coreFingerprintLabels);
  assert.ok(shingles.length > 4);
  const base = { ...scope, actionId: "forget-fixture", kind: "text", origin: "forget" };
  f.seedFact({ ...base, mode: "full", text: { digests: await allDigests(text, key), shingles, keyId: key.id } });
  // Frozen hosted v1 masked before NFKC, so the fullwidth prefix escaped the old redactor.
  const hostedVariant = "Label Ｂｅａｒｅｒ abcdefghijklmnopqrst";
  f.seedFact({ ...base, mode: "exact", text: { digests: [{
    alg: "sha256", value: sha("label bearer abcdefghijklmnopqrst"),
    pipeline: "hosted-v1", redactionVersion: 1, keyId: null,
  }] } });
  await f.admit();
  const unrelated = "Log small purchases in the blue notebook.";
  f.hooks.model = () => ({ items: [
    candidate(text), candidate("Remember this practical detail. " + text),
    candidate(hostedVariant), candidate(unrelated),
  ] });
  const done = await f.run();
  assert.equal(done.status, "done");
  assert.equal(done.result.suppressedCount, 0);
  assert.deepEqual(mutation(f, "capture.finish").args[1].map(item => item.content), [unrelated]);
  assert.deepEqual(f.committed(scope.owner).rows.map(row => row.text), [unrelated]);
  assert.deepEqual(f.diagnostics, Array.from({ length: 3 }, () => ({
    version: 1, stage: "extract", layer: "core_finish", reason: "candidate_withheld",
  })));
  assert.deepEqual(f.calls.find(([method]) => method === "embed")[1].slice(2), ["label [redacted]", unrelated.toLowerCase()]);
  assert.deepEqual(await f.run(), done);
  assert.equal(f.diagnostics.length, 3);
});

test("required embeddings fail retryably while a nullable store finishes with null and a keyless hash", async () => {
  const required = setup({ required: true });
  await required.admit();
  required.hooks.embed = () => [];
  assert.deepEqual(await required.run(), { status: "failed", code: "embedding_failed" });
  assertAbandoned(required, "embedding_failed", true);
  required.hooks.embed = undefined;
  assert.equal((await required.run()).status, "done");

  const nullable = setup({ hasKey: false });
  await nullable.admit();
  nullable.hooks.embed = () => [Float32Array.of(NaN)];
  assert.equal((await nullable.run()).status, "done");
  const [item] = mutation(nullable, "capture.finish").args[1];
  assert.equal(item.embedding, null);
  assert.equal(item.textHash, "sha256:" + sha("i prefer black tea."));
  assert.equal(Object.hasOwn(item, "digests"), false);
});

test("abort reaches the live model signal and abandons with model_cancelled", async () => {
  const f = setup();
  await f.admit();
  const controller = new AbortController();
  f.hooks.model = (_stage, _request, { signal }) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    controller.abort(new Error("private cancellation reason"));
  });
  assert.deepEqual(await f.run({ signal: controller.signal }), { status: "failed", code: "model_cancelled" });
  assert.deepEqual(sends(f), ["model.call"]);
  assertAbandoned(f, "model_cancelled", false);
});

test("the configured extract deadline maps an expired model call to model_timeout", async () => {
  const f = setup({ config: { deadlines: { extract: 1000 } } });
  await f.admit();
  let now = 0;
  f.hooks.monotonicMs = () => now;
  f.hooks.model = () => {
    now = 1000;
    return { items: [candidate()] };
  };
  assert.deepEqual(await f.run(), { status: "failed", code: "model_timeout" });
  assert.deepEqual(sends(f), ["model.call"]);
  assertAbandoned(f, "model_timeout", false);
});

test("invalid model source indices fail the batch before embedding", async () => {
  for (const indices of [[], [3], [0, 0]]) {
    const f = setup();
    await f.admit();
    f.hooks.model = () => ({ items: [candidate("Some claim.", indices)] });
    assert.deepEqual(await f.run(), { status: "failed", code: "invalid_model_output" });
    assert.deepEqual(sends(f), ["model.call"]);
    assertAbandoned(f, "invalid_model_output", false);
  }
});

test("foreign errors after claim abandon with a sanitized CoreError code", async () => {
  const f = setup();
  await f.admit();
  const foreign = Object.assign(new Error("private storage message"), { code: "storage_busy" });
  f.hooks.assertEligible = () => { throw foreign; };
  assert.deepEqual(await f.run(), { status: "failed", code: "internal_error" });
  assertAbandoned(f, "internal_error", false);

  f.hooks.beforeRun = () => { throw foreign; };
  await assert.rejects(f.run, validCode("internal_error"));
});

test("an ambiguous finish commit reads status, skips abandon, and replays on the next run", async () => {
  const f = setup();
  await f.admit();
  f.hooks.afterCommit = () => {
    if (!mutation(f, "capture.finish")) return;
    f.hooks.afterCommit = undefined;
    throw new CoreError("commit_outcome_unknown");
  };
  assert.deepEqual(await f.run(), { status: "failed", code: "commit_outcome_unknown" });
  assert.equal(mutation(f, "capture.abandon"), undefined);
  assert.deepEqual(f.calls.slice(-2), [
    ["run", scope.owner, { readOnly: true }], ["capture.status", scope, selection.eventId, selection.client],
  ]);
  assert.equal(f.committed(scope.owner).rows.length, 1);
  f.calls.length = 0;
  assert.equal((await f.run()).status, "done");
  assert.deepEqual(sends(f), []);
});

test("an ambiguous dispatch commit leaves the leased event for adapter recovery", async () => {
  const f = setup();
  await f.admit();
  f.hooks.afterCommit = () => {
    if (!mutation(f, "capture.beginDispatch")) return;
    f.hooks.afterCommit = undefined;
    throw new CoreError("commit_outcome_unknown");
  };
  assert.deepEqual(await f.run(), { status: "failed", code: "commit_outcome_unknown" });
  assert.equal(mutation(f, "capture.abandon"), undefined);
  assert.deepEqual(f.calls.slice(-2), [
    ["run", scope.owner, { readOnly: true }], ["capture.status", scope, selection.eventId, selection.client],
  ]);
  assert.deepEqual(sends(f), []);
  assert.deepEqual(await f.run(), { status: "processing" });
});

test("the same event ID runs independently for two owners", async () => {
  const f = setup();
  const other = { ...scope, owner: "other" };
  await f.admit();
  await f.admit(other);
  assert.equal((await f.run()).status, "done");
  assert.equal((await f.service.runCapture(other, selection)).status, "done");
  assert.equal(f.committed(scope.owner).rows.length, 1);
  assert.equal(f.committed(other.owner).rows.length, 1);
  assert.deepEqual(sends(f), ["model.call", "embed", "model.call", "embed"]);
});

test("Raw archives only eligible messages after permission and in the finish transaction", async () => {
  for (const allowed of [true, false]) {
    const f = setup({ rawArchive: true });
    await f.admit();
    f.hooks.eligible = () => [2];
    f.hooks.archiveAllowed = () => allowed;
    assert.equal((await f.run()).status, "done");
    const finish = mutation(f, "capture.finish");
    const archive = mutation(f, "raw.archive");
    if (allowed) {
      assert.deepEqual(methods(f).slice(-3), ["capture.finish", "raw.archiveAllowed", "raw.archive"]);
      assert.equal(archive.run, finish.run);
      assert.deepEqual(archive.args[1], [messages[2]]);
      assert.deepEqual(f.archived(scope.owner), [messages[2]]);
    } else {
      assert.deepEqual(methods(f).slice(-2), ["capture.finish", "raw.archiveAllowed"]);
      assert.equal(archive, undefined);
      assert.deepEqual(f.archived(scope.owner), []);
    }
  }
});

test("a Raw archive failure rolls back finish before retryable abandon", async () => {
  const f = setup({ rawArchive: true });
  await f.admit();
  f.hooks.archive = () => { throw new CoreError("storage_busy"); };
  assert.deepEqual(await f.run(), { status: "failed", code: "storage_busy" });
  assert.deepEqual(f.archived(scope.owner), []);
  assertAbandoned(f, "storage_busy", true);
  assert.notEqual(mutation(f, "capture.finish").run, mutation(f, "capture.abandon").run);
});
