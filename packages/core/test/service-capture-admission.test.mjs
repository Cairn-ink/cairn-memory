import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { coreDigest, CoreError } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { hostedScope, serviceFake } from "./helpers/service-fake.mjs";

const scope = hostedScope;
const selection = { client: "client", sessionId: "session", eventId: "event" };
const fixtureMessage = { id: "message", role: "user", content: "Capture this", occurredAtMs: null };
const request = (overrides = {}) => ({ ...selection, messages: [{ ...fixtureMessage }], ...overrides });
const code = expected => error => error instanceof CoreError && error.code === expected && error.message === expected;

function fixture(options) {
  const fake = serviceFake({ writes: true, capture: true, ...options });
  return { ...fake, service: createMemoryService(fake.deps) };
}

test("admission prepares and hashes one snapshot before a single pause-locked write", async t => {
  const { service, calls, storage, hooks, mutations } = fixture();
  const raw = request();
  const secret = "synthetic-secret-123456";
  let reads = 0;
  Object.defineProperty(raw.messages[0], "content", {
    enumerable: true,
    get() { reads++; return "  ＡＰＩ＿ＫＥＹ＝" + secret + "\n  keep this  "; },
  });
  raw.messages[0].occurredAtMs = 1234;
  const prepared = { ...fixtureMessage, content: "API_KEY=[REDACTED] keep this", occurredAtMs: 1234 };
  const payload = JSON.stringify([selection.client, selection.sessionId, selection.eventId,
    [[prepared.id, prepared.role, prepared.content, prepared.occurredAtMs]]]);
  const key = { scope, ...selection, payloadDigest: createHash("sha256").update(payload).digest("hex") };

  const clone = t.mock.method(globalThis, "structuredClone", structuredClone);
  hooks.beforeRun = () => {
    raw.sessionId = "modified";
    raw.messages.length = 0;
  };
  assert.deepEqual(await service.enqueueCapture(scope, raw), { status: "accepted" });
  assert.equal(clone.mock.callCount(), 1);
  assert.equal(reads, 1);
  assert.deepEqual(calls, [
    ["run", scope.owner, { pauseLock: true }],
    ["lock", "pause"],
    ["lock", "owner-write"],
    ["pause.get", scope.owner],
    ["suppressions.snapshot", scope, { client: selection.client, sessionId: selection.sessionId }],
    ["capture.eligible", key, [prepared]],
    ["capture.admit", key, [prepared]],
  ]);
  assert.equal(JSON.stringify(calls).includes(secret), false);
  hooks.beforeRun = undefined;
  assert.deepEqual(await storage.uow.run(scope.owner, { readOnly: true },
    tx => storage.capture.load(tx, { scope, ...selection })), { key, messages: [prepared] });
  assert.deepEqual(await storage.uow.run(scope.owner, { readOnly: true },
    tx => storage.capture.load(tx, { scope, ...selection, sessionId: "other" })), null);
  assert.deepEqual(await service.enqueueCapture(scope, request({ messages: [prepared] })), { status: "duplicate" });
  assert.equal(mutations.length, 1);
});

test("a changed digest under the same event is a conflict with zero writes", async () => {
  const { service, mutations } = fixture({ rawArchive: true });
  await service.enqueueCapture(scope, request());
  mutations.length = 0;
  for (const change of [
    { messages: [{ ...fixtureMessage, content: "Changed content" }] },
    { messages: [{ ...fixtureMessage, occurredAtMs: 1 }] },
    { sessionId: "other" },
  ]) {
    await assert.rejects(() => service.enqueueCapture(scope, request(change)), code("event_payload_conflict"));
  }
  assert.deepEqual(mutations, []);
  assert.deepEqual(await service.enqueueCapture(scope, request()), { status: "duplicate" });
});

test("paused, blocked, and fenced sessions make no admission or lineage writes", async () => {
  const { service, calls, mutations, hooks, seedFact } = fixture({ rawArchive: true, sessionLineage: true });
  await service.setPause(scope.owner, true);
  calls.length = 0;
  assert.deepEqual(await service.enqueueCapture(scope, request()), { status: "paused" });
  assert.deepEqual(calls.map(([method]) => method), ["run", "lock", "lock", "pause.get"]);
  await service.setPause(scope.owner, false);
  seedFact({ ...scope, kind: "session", session: selection });
  calls.length = 0;
  assert.deepEqual(await service.enqueueCapture(scope, request()), { status: "blocked" });
  assert.deepEqual(calls.slice(3).map(([method]) => method), ["pause.get", "suppressions.snapshot"]);
  hooks.isFenced = session => {
    assert.deepEqual(session, { client: selection.client, sessionId: "fenced" });
    return { fenced: true, proof: "unknown" };
  };
  assert.deepEqual(await service.enqueueCapture(scope, request({ sessionId: "fenced" })), { status: "blocked" });
  assert.deepEqual(mutations, []);
});

test("admission stores an empty slot for exact forgotten text in a fresh session", async () => {
  const { service, storage, mutations, seedFact } = fixture({ rawArchive: true });
  const content = "Pasted back forgotten wording";
  seedFact({ ...scope, kind: "text", mode: "exact", origin: "forget", actionId: "forget-text",
    text: { digests: [await coreDigest(content)] } });
  const incoming = { ...fixtureMessage, content, occurredAtMs: 30 };
  const scrubbed = { ...incoming, content: "" };
  const fresh = { ...selection, sessionId: "fresh" };
  assert.deepEqual(await service.enqueueCapture(scope, { ...fresh, messages: [incoming] }), { status: "accepted" });
  assert.deepEqual(mutations.map(({ method, args }) => [method, args[1]]), [
    ["capture.admit", [scrubbed]],
    ["raw.recordLineage", [scrubbed]],
  ]);
  const row = await storage.uow.run(scope.owner, { readOnly: true },
    tx => storage.capture.load(tx, { scope, ...fresh }));
  assert.deepEqual(row.messages, [scrubbed]);
  assert.deepEqual(await service.captureStatus(scope, fresh.eventId), { status: "pending" });
});

test("admission scrubs a message in a suppressed window and preserves the other slots", async () => {
  const { service, mutations, seedFact } = fixture({ rawArchive: true });
  seedFact({ ...scope, kind: "window", origin: "forget", actionId: "forget-window",
    client: selection.client, window: { startMs: 10, endMs: 20 } });
  const before = { ...fixtureMessage, id: "before", occurredAtMs: 9 };
  const within = { ...fixtureMessage, occurredAtMs: 15 };
  const after = { ...fixtureMessage, id: "after", role: "assistant", content: "Unrelated reply.", occurredAtMs: 21 };
  const expected = [before, { ...within, content: "" }, after];
  assert.deepEqual(await service.enqueueCapture(scope, request({ messages: [before, within, after] })),
    { status: "accepted" });
  assert.deepEqual(mutations.map(({ method, args }) => [method, args[1]]), [
    ["capture.admit", expected],
    ["raw.recordLineage", expected],
  ]);
});

test("admission scrubs every slot of a first proven fork from a fenced session",
  { todo: "SourceFilter needs to check incoming ID and content proofs against fenced anchors" }, async () => {
    const { service, mutations, seedFact } = fixture({ rawArchive: true, sessionLineage: true });
    const source = { client: selection.client, sessionId: "source" };
    const anchor = { ...fixtureMessage, id: "anchor", content: "Observatory marker [REDACTED]" };
    await service.enqueueCapture(scope, request({ ...source, messages: [anchor] }));
    seedFact({ ...scope, kind: "session", origin: "forget", actionId: "fence", session: source });
    mutations.length = 0;
    const turn = { ...fixtureMessage, id: "fork-only", content: "The telescope inventory is ready.", occurredAtMs: 15 };
    await service.enqueueCapture(scope, request({ sessionId: "fork", eventId: "fork-first", messages: [anchor, turn] }));
    const expected = [anchor, turn].map(message => ({ ...message, content: "" }));
    assert.deepEqual(mutations.map(({ method, args }) => [method, args[1]]), [
      ["capture.admit", expected],
      ["raw.recordLineage", expected],
    ]);
  });

test("admission masks every hosted secret pattern before payload hashing and storage", async () => {
  const { service, deps, storage, mutations } = fixture({ rawArchive: true });
  const marker = "[REDACTED]";
  const examples = [
    ["-----BEGIN PRIVATE KEY-----\n" + "synthetic".repeat(4) + "\n-----END PRIVATE KEY-----", marker],
    ["sk-" + "synthetic".repeat(4), marker],
    ["crn_pat_" + "Z9_zaYx-".repeat(4), marker],
    ["crn_pat_" + "ab".repeat(32), marker],
    ["ghp_" + "synthetic".repeat(4), marker],
    ["AKIA" + "0Z".repeat(8), marker],
    ["eyJ" + "synthetic".repeat(2) + "." + "payload".repeat(2) + "." + "signature".repeat(2), marker],
    ["Bearer " + "synthetic".repeat(4), marker],
    ["api_key=" + "synthetic".repeat(4), "api_key=" + marker],
    ['"refresh_token": "' + "synthetic".repeat(4) + '"', '"refresh_token": "' + marker + '"'],
  ];
  const message = (content, index) => ({ ...fixtureMessage, id: String(index), content: content + " remains." });
  const messages = examples.map(([raw], index) => message(raw, index));
  const expected = examples.map(([, redacted], index) => message(redacted, index));
  const hash = deps.clock.sha256Hex;
  const hashInputs = [];
  deps.clock.sha256Hex = async value => {
    hashInputs.push(value);
    return hash(value);
  };
  assert.deepEqual(await service.enqueueCapture(scope, request({ messages })), { status: "accepted" });
  assert.deepEqual(hashInputs.map(value => JSON.parse(value)), [[selection.client, selection.sessionId, selection.eventId,
    expected.map(({ id, role, content, occurredAtMs }) => [id, role, content, occurredAtMs])]]);
  assert.deepEqual(mutations.map(({ method, args }) => [method, args[1]]), [
    ["capture.admit", expected],
    ["raw.recordLineage", expected],
  ]);
  const row = await storage.uow.run(scope.owner, { readOnly: true },
    tx => storage.capture.load(tx, { scope, ...selection }));
  assert.deepEqual(row.messages, expected);
});

test("lineage is written with the fresh admission and rolls back with it on failure", async () => {
  const { service, storage, mutations, hooks } = fixture({ rawArchive: true });
  hooks.recordLineage = () => { throw new Error("private storage message"); };
  await assert.rejects(() => service.enqueueCapture(scope, request()), code("internal_error"));
  assert.deepEqual(await service.captureStatus(scope, selection.eventId), { status: "unknown" });
  hooks.recordLineage = undefined;
  mutations.length = 0;
  assert.deepEqual(await service.enqueueCapture(scope, request()), { status: "accepted" });
  assert.deepEqual(mutations.map(({ method }) => method), ["capture.admit", "raw.recordLineage"]);
  assert.equal(mutations[0].run, mutations[1].run);
  assert.deepEqual(mutations[0].args, mutations[1].args);

  const { service: noRaw, storage: noRawStorage, mutations: noRawMutations } = fixture();
  noRawStorage.raw = storage.raw;
  assert.deepEqual(await noRaw.enqueueCapture(scope, request()), { status: "accepted" });
  assert.deepEqual(noRawMutations.map(({ method }) => method), ["capture.admit"]);
});

test("processing and raw replay return duplicate without writes or finish data", async () => {
  const { service, setCaptureResult, mutations } = fixture({ rawArchive: true });
  await service.enqueueCapture(scope, request());
  mutations.length = 0;
  setCaptureResult({ scope, ...selection }, { processing: true });
  assert.deepEqual(await service.enqueueCapture(scope, request()), { status: "duplicate" });
  setCaptureResult({ scope, ...selection }, { status: "done", processing: false, result: {
    indexRevision: 1, memories: [], suppressedCount: 0, duplicateCount: 0, counters: {},
  } });
  assert.deepEqual(await service.enqueueCapture(scope, request()), { status: "duplicate" });
  assert.deepEqual(mutations, []);
});

test("status reads one event in a read-only run and applies the cross-client precedence", async () => {
  const { service, calls, setCaptureResult, mutations } = fixture();
  const first = { scope, ...selection };
  const second = { ...first, client: "another-client" };
  const status = options => service.captureStatus(scope, selection.eventId, options);
  assert.deepEqual(await status(), { status: "unknown" });
  assert.deepEqual(calls, [
    ["run", scope.owner, { readOnly: true }],
    ["capture.status", scope, selection.eventId, undefined],
  ]);
  await service.enqueueCapture(scope, request());
  await service.enqueueCapture(scope, request({ client: second.client }));
  mutations.length = 0;
  setCaptureResult(first, { status: "failed", code: "model_unavailable" });
  assert.deepEqual(await status(), { status: "pending" });
  assert.deepEqual(await status({ client: first.client }), { status: "failed", code: "model_unavailable" });
  assert.deepEqual(await status({ client: second.client }), { status: "pending" });
  assert.deepEqual(await status({ client: "missing" }), { status: "unknown" });
  setCaptureResult(second, { status: "done" });
  assert.deepEqual(await status(), { status: "failed", code: "model_unavailable" });
  assert.deepEqual(await status({ client: second.client }), { status: "done" });
  setCaptureResult(first, { status: "done" });
  assert.deepEqual(await status(), { status: "done" });
  assert.deepEqual(mutations, []);
});

test("status returns only known codes and sanitizes foreign throws", async () => {
  const { service, storage } = fixture();
  const status = () => service.captureStatus(scope, selection.eventId);
  const secret = "private storage message";
  storage.capture.status = async () => ({ status: "failed", code: secret, message: secret });
  assert.deepEqual(await status(), { status: "failed", code: "internal_error" });
  storage.capture.status = async () => ({ status: "unknown", code: "storage_busy", message: secret });
  assert.deepEqual(await status(), { status: "unknown" });
  storage.capture.status = async () => { throw Object.assign(new Error(secret), { code: "storage_busy" }); };
  await assert.rejects(status, code("internal_error"));
  const error = new CoreError("storage_busy");
  error.message = secret;
  storage.capture.status = async () => { throw error; };
  await assert.rejects(status, thrown => thrown !== error && code("storage_busy")(thrown));
});

test("missing optional ports reject without claiming or opening a transaction", async () => {
  const { service, storage, calls } = fixture();
  delete storage.capture.admit;
  delete storage.capture.status;
  let claims = 0;
  storage.capture.claim = () => { claims++; };
  await assert.rejects(() => service.enqueueCapture(scope, request()), code("capability_unavailable"));
  await assert.rejects(() => service.captureStatus(scope, selection.eventId), code("capability_unavailable"));
  assert.equal(claims, 0);
  assert.deepEqual(calls, []);
});

test("admission validates shape, identity, roles, and timestamps before storage", async () => {
  const { service, calls } = fixture();
  for (const input of [
    request({ messages: [] }),
    request({ messages: [{ ...fixtureMessage, role: "system" }] }),
    request({ messages: [{ ...fixtureMessage, content: 123 }] }),
    request({ messages: [{ ...fixtureMessage, occurredAtMs: undefined }] }),
    request({ messages: [{ ...fixtureMessage, occurredAtMs: NaN }] }),
    request({ client: "" }),
    request({ sessionId: "a".repeat(201) }),
    request({ eventId: " event" }),
  ]) await assert.rejects(() => service.enqueueCapture(scope, input), code("invalid_input"));
  await assert.rejects(() => service.captureStatus(scope, selection.eventId, { client: "" }), code("invalid_input"));
  assert.deepEqual(calls, []);
});

test("admission accepts hosted-sized messages, batches, and redacted slots", async () => {
  const { service, mutations } = fixture();
  const message = (content, index = 0) => ({ ...fixtureMessage, id: String(index), content });
  const cases = [
    [message("a".repeat(4_001))],
    Array.from({ length: 6 }, (_, index) => message("a".repeat(index === 5 ? 3_336 : 3_333), index)),
    [message("[REDACTED]"), message("Ordinary text.", 1)],
    [message("[REDACTED] followed by ordinary text.")],
    Array.from({ length: 24 }, (_, index) => index === 0
      ? { ...message("a".repeat(20_000)), id: "a".repeat(200) }
      : message("a", index)),
  ];
  for (const [index, messages] of cases.entries()) {
    assert.deepEqual(await service.enqueueCapture(scope, request({ eventId: String(index), messages })),
      { status: "accepted" });
    assert.deepEqual(mutations.at(-1).args[1], messages);
  }
});

test("admission rejects messages, ids, and batches above hosted limits", async () => {
  const { service, calls } = fixture();
  for (const messages of [
    [{ ...fixtureMessage, content: "a".repeat(20_001) }],
    [{ ...fixtureMessage, id: "a".repeat(201) }],
    Array.from({ length: 25 }, (_, index) => ({ ...fixtureMessage, id: String(index) })),
    [{ ...fixtureMessage, content: "" }],
  ]) await assert.rejects(() => service.enqueueCapture(scope, request({ messages })), code("invalid_input"));
  assert.deepEqual(calls, []);
});

test("admission maps a foreign hash failure before opening a transaction", async () => {
  const { service, deps, calls } = fixture();
  deps.clock.sha256Hex = async () => { throw new Error("private hash failure"); };
  await assert.rejects(() => service.enqueueCapture(scope, request()), code("internal_error"));
  assert.deepEqual(calls, []);
});

test("the same event is independent across owners", async () => {
  const { service } = fixture();
  const otherOwner = { ...scope, owner: "other-owner" };
  await service.enqueueCapture(scope, request());
  assert.deepEqual(await service.captureStatus(otherOwner, selection.eventId), { status: "unknown" });
  assert.deepEqual(await service.enqueueCapture(otherOwner, request({ sessionId: "other" })), { status: "accepted" });
  assert.deepEqual(await service.captureStatus(otherOwner, selection.eventId), { status: "pending" });
  assert.deepEqual(await service.enqueueCapture(scope, request()), { status: "duplicate" });
});

test("admission deduplicates across namespaces and conflicts on a changed digest", async () => {
  const { service, storage, mutations } = fixture({ rawArchive: true });
  const otherNamespace = { ...scope, namespace: "other-namespace" };
  await service.enqueueCapture(scope, request());
  mutations.length = 0;
  await assert.rejects(() => service.enqueueCapture(otherNamespace,
    request({ messages: [{ ...fixtureMessage, content: "Changed content" }] })), code("event_payload_conflict"));
  assert.deepEqual(await service.enqueueCapture(otherNamespace, request()), { status: "duplicate" });
  assert.deepEqual(await service.captureStatus(otherNamespace, selection.eventId), { status: "unknown" });
  assert.deepEqual(await storage.uow.run(scope.owner, { readOnly: true },
    tx => storage.capture.load(tx, { scope: otherNamespace, ...selection })), null);
  assert.deepEqual(mutations, []);
});
