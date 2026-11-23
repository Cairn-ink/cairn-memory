import assert from "node:assert/strict";
import { test } from "node:test";
import { CoreError } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { hostedScope, memory, serviceFake } from "./helpers/service-fake.mjs";

const code = expected => error => error instanceof CoreError && error.code === expected && error.message === expected;

test("construction validates dependencies and freezes its own dependency and config records", t => {
  const { deps } = serviceFake();
  const originalFreeze = Object.freeze;
  const frozen = t.mock.method(Object, "freeze", originalFreeze);
  const deadlines = { extract: 20 };
  const config = { leaseMs: 90, deadlines };
  const input = { ...deps, config };

  const service = createMemoryService(input);
  assert.equal(typeof service.runCapture, "function");
  const captured = frozen.mock.calls.map(call => call.arguments[0]).find(value => value?.storage === deps.storage);
  assert.ok(Object.isFrozen(captured));
  assert.ok(Object.isFrozen(captured.config));
  assert.ok(Object.isFrozen(captured.config.deadlines));
  deadlines.extract = 30;
  config.leaseMs = 5;
  input.storage = serviceFake().storage;
  assert.equal(captured.config.deadlines.extract, 20);
  assert.equal(captured.config.leaseMs, 90);
  assert.equal(captured.storage, deps.storage);
  assert.equal(captured.config.nearDuplicateDistance, 0.08);
  assert.equal(captured.config.lexicalWeight, 0.5);
  assert.equal(captured.config.vectorWeight, 1);

  for (const field of ["storage", "model", "embedder", "gate", "clock", "tokens", "config"]) {
    assert.throws(() => createMemoryService({ ...deps, [field]: undefined }), code("invalid_input"), field);
  }
  assert.throws(() => createMemoryService({ ...deps, storage: { ...deps.storage, fence: {} } }), code("invalid_input"));
  assert.throws(() => createMemoryService({ ...deps, embedQuery: {} }), code("invalid_input"));
  assert.throws(() => createMemoryService({ ...deps, diagnostics: true }), code("invalid_input"));
  for (const invalid of [
    { nearDuplicateDistance: 3 }, { lexicalWeight: NaN }, { vectorWeight: -1 }, { rowShingles: "on" },
    { leaseMs: 0 }, { deadlines: { extract: 0 } }, { deadlines: { arbitrary: 1 } }, { unknown: false },
  ]) {
    assert.throws(() => createMemoryService({ ...deps, config: invalid }), code("invalid_input"));
  }
});

test("services over different adapters keep independent state without optional capabilities", async () => {
  const first = serviceFake({ rows: [memory("first")] });
  const second = serviceFake({ rows: [memory("second")] });
  const a = createMemoryService(first.deps);
  const b = createMemoryService(second.deps);
  first.deps.storage = second.storage;
  await a.setPause(hostedScope.owner, true);
  assert.deepEqual(await b.pauseState(hostedScope.owner), { paused: false, generation: 0 });
  assert.deepEqual(await a.pauseState(hostedScope.owner), { paused: true, generation: 1 });
  assert.deepEqual((await a.recent(hostedScope, { limit: 10, cursor: null })).items.map(row => row.id), ["first"]);
  assert.deepEqual((await b.recent(hostedScope, { limit: 10, cursor: null })).items.map(row => row.id), ["second"]);
});

test("remaining placeholders reject with capability_unavailable before any port call", async () => {
  const { deps, calls } = serviceFake();
  const service = createMemoryService(deps);
  const source = { kind: "mcp", client: null, sessionId: null };
  const key = { client: "client", sessionId: "session", eventId: "event" };
  const page = { limit: 10, cursor: null };
  const entries = [
    () => service.forget(hostedScope, "id", source),
    () => service.recall(hostedScope, "query", { ...page, mode: "search" }),
    () => service.captureStatus(hostedScope, "event"),
    () => service.listRawMessages(hostedScope, page),
    () => service.importMemories(hostedScope, [], source),
    () => service.importRawMessages(hostedScope, []),
    () => service.enqueueCapture(hostedScope, { ...key, messages: [] }),
    () => service.runCapture(hostedScope, key, { signal: new AbortController().signal }),
  ];
  for (const invoke of entries) await assert.rejects(invoke, code("capability_unavailable"));
  assert.deepEqual(calls, []);
});

test("port failures crossing an entry map to internal_error or a fresh CoreError", async () => {
  const { deps, hooks, storage } = serviceFake();
  const service = createMemoryService(deps);
  const native = Object.assign(new Error("private port error"), { code: "storage_busy" });
  const badPrototype = new Proxy({}, { getPrototypeOf() { throw new Error("private inspection error"); } });
  for (const foreign of [native, badPrototype, "private string"]) {
    hooks.beforeRun = () => { throw foreign; };
    await assert.rejects(() => service.pauseState(hostedScope.owner), code("internal_error"));
  }

  hooks.beforeRun = undefined;
  const mapped = new CoreError("storage_busy");
  mapped.message = "private port error";
  storage.pause.get = async () => { throw mapped; };
  await assert.rejects(() => service.pauseState(hostedScope.owner), error => error !== mapped && code("storage_busy")(error));

  hooks.countTokens = () => { throw native; };
  await assert.rejects(() => service.sessionStart(hostedScope, { maxChars: 8000, maxTokens: 2000 }), code("internal_error"));
});

test("entry rejects prototype-only and invalid codes and reads a code getter once", async () => {
  const { deps, hooks } = serviceFake();
  const service = createMemoryService(deps);
  const pauseState = () => service.pauseState(hostedScope.owner);
  const prototypeOnly = Object.create(CoreError.prototype);
  const invalidCode = Object.assign(new CoreError("storage_busy"), { code: "foreign_code" });
  const throwingGetter = Object.defineProperty(new CoreError("storage_busy"), "code", {
    get() { throw new Error("private inspection error"); },
  });
  for (const foreign of [prototypeOnly, invalidCode, throwingGetter]) {
    hooks.beforeRun = () => { throw foreign; };
    await assert.rejects(pauseState, error => error !== foreign && code("internal_error")(error));
  }

  let reads = 0;
  const changingGetter = Object.defineProperty(new CoreError("storage_busy"), "code", {
    get: () => ++reads === 1 ? "storage_busy" : "foreign_code",
  });
  hooks.beforeRun = () => { throw changingGetter; };
  await assert.rejects(pauseState, error => error !== changingGetter && code("storage_busy")(error));
  assert.equal(reads, 1);
});

test("invalid input and failed snapshots are refused before storage access", async () => {
  const { deps, calls } = serviceFake();
  const service = createMemoryService(deps);
  const page = { limit: 10, cursor: null };
  for (const scope of [null, { owner: " bad ", namespace: null }, { owner: "ok" }, { owner: "ok", namespace: 9 }]) {
    await assert.rejects(() => service.recent(scope, page), code("invalid_input"));
  }
  await assert.rejects(() => service.pauseState(""), code("invalid_input"));
  await assert.rejects(() => service.setPause(hostedScope.owner, "true"), code("invalid_input"));
  await assert.rejects(() => service.recent(hostedScope, { ...page, limit() {} }), code("invalid_input"));
  assert.deepEqual(await service.save(hostedScope, "text", { kind: "mcp", unusable() {} }), { status: "invalid" });
  assert.deepEqual(calls, []);
});

test("entry takes one input snapshot before awaiting and isolates caller mutations", async t => {
  const row = memory("original", { scope: { owner: "owner", namespace: "project\u0000example" } });
  const { deps, hooks, calls } = serviceFake({ rows: [row] });
  const service = createMemoryService(deps);
  const scope = { ...row.scope };
  const page = { limit: 1, cursor: null };
  const clone = t.mock.method(globalThis, "structuredClone", structuredClone);
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  hooks.beforeRun = () => {
    entered.resolve();
    return release.promise;
  };

  const pending = service.recent(scope, page);
  await entered.promise;
  scope.owner = "changed";
  scope.namespace = null;
  page.limit = 50;
  page.cursor = "invalid";
  release.resolve();

  assert.deepEqual((await pending).items, [row]);
  assert.deepEqual(calls.find(call => call[0] === "recent.recent"),
    ["recent.recent", { owner: "owner", namespaces: ["project\u0000example"] }, { limit: 1, cursor: null }]);
  assert.equal(clone.mock.callCount(), 1);
  const [input] = clone.mock.calls[0].arguments;
  assert.deepEqual(input, [scope, page]);
});
