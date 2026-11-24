import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createMemoryService } from "@cairn-ink/core/service";
import { admission, captureTrace, selection } from "./helpers/service-capture-trace.mjs";
import { hostedScope as scope, serviceFake } from "./helpers/service-fake.mjs";

// The core job installs the sibling adapter after it runs these tests.
const adapterImports = new Map([
  ["@cairn-ink/core", new URL("../src/index.mjs", import.meta.url).href],
  ["@cairn-ink/core/routing", new URL("../src/routing/index.mjs", import.meta.url).href],
]);
const resolver = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(adapterImports.get(specifier) ?? specifier, context);
  },
});
let createMemoryAdapter;
try {
  ({ createMemoryAdapter } = await import("../../adapter-memory/src/index.mjs"));
} finally {
  resolver.deregister();
}

test("keyless registration accepts a model that is omitted, undefined, or null", () => {
  const { deps: { model: _model, ...deps }, storage } = serviceFake();
  for (const capabilities of [{}, { fingerprintKey: false }]) {
    const keyless = { ...deps, storage: { ...storage, capabilities } };
    for (const input of [keyless, { ...keyless, model: undefined }, { ...keyless, model: null }]) {
      assert.equal(typeof createMemoryService(input).runCapture, "function");
    }
  }
});

test("registration requires a model when the fingerprint key capability is on", () => {
  const { deps: { model: _model, ...deps }, storage } = serviceFake({ writes: true });
  assert.equal(storage.capabilities.fingerprintKey, true);
  for (const input of [deps, { ...deps, model: undefined }, { ...deps, model: null }]) {
    assert.throws(() => createMemoryService(input), { code: "invalid_input" });
  }
});

test("registration still validates every supplied model field", () => {
  const { deps, storage } = serviceFake();
  storage.capabilities.fingerprintKey = false;
  const { model } = deps;
  for (const invalid of [false, {}, { ...model, call: null }, { ...model, countTokens: null },
    { ...model, model: "" }, { ...model, contextWindow: 0 }, { ...model, fits: false }]) {
    assert.throws(() => createMemoryService({ ...deps, model: invalid }), { code: "invalid_input" });
  }
});

test("model-free capture admission refuses before touching any port", async () => {
  const { deps, calls, mutations, hooks, storage } = serviceFake({ writes: true, capture: true, rawArchive: true, hasKey: false });
  storage.capabilities.fingerprintKey = false;
  hooks.fault = method => assert.fail(`unexpected port call: ${method}`);
  const service = createMemoryService({ ...deps, model: null });
  await assert.rejects(service.enqueueCapture(scope, admission), { code: "capability_unavailable" });
  assert.deepEqual(calls, []);
  assert.deepEqual(mutations, []);
  assert.deepEqual(await service.captureStatus(scope, selection.eventId), { status: "unknown" });
});

test("model-free capture run refuses before claiming a pending admission", async () => {
  const { deps, calls, mutations, hooks, storage } = serviceFake({ writes: true, capture: true, rawArchive: true, hasKey: false });
  storage.capabilities.fingerprintKey = false;
  const withModel = createMemoryService(deps);
  assert.deepEqual(await withModel.enqueueCapture(scope, admission), { status: "accepted" });
  calls.length = 0;
  mutations.length = 0;
  hooks.fault = method => assert.fail(`unexpected port call: ${method}`);

  const service = createMemoryService({ ...deps, model: null });
  await assert.rejects(service.runCapture(scope, selection), { code: "capability_unavailable" });
  assert.deepEqual(calls, []);
  assert.deepEqual(mutations, []);
  assert.deepEqual(await service.captureStatus(scope, selection.eventId), { status: "pending" });
});

test("the keyless reference adapter saves, recalls, reads, finds, inspects, exports, corrects and forgets", async () => {
  const { deps, calls } = serviceFake({ writes: true });
  const storage = createMemoryAdapter({ capabilities: { inspect: true } });
  assert.equal(storage.capabilities.fingerprintKey, false);
  const service = createMemoryService({ ...deps, storage, model: null, embedder: null });
  const source = { kind: "mcp", client: null, sessionId: null };
  const original = "The spare lens is in the cabinet.";
  const updated = "The spare lens is in the drawer.";
  const page = { limit: 10, cursor: null };
  const search = { ...page, mode: "search" };

  const saved = await service.save(scope, original, source);
  assert.equal(saved.status, "saved");
  assert.equal(saved.item.embedding, null);
  const { id, revision } = saved.item;
  assert.deepEqual((await service.recall(scope, "lens", search)).items.map(item => item.id), [id]);
  assert.deepEqual((await service.find(scope, "lens", { kinds: ["memory"] })).memories.map(item => item.id), [id]);
  assert.equal((await service.inspect(scope, { memoryId: id })).memory.text, original);
  assert.deepEqual((await service.exportMemories(scope, page)).items.map(item => item.id), [id]);

  const corrected = await service.correct(scope, id, revision, updated, source);
  assert.equal(corrected.status, "saved");
  assert.equal(corrected.item.embedding, null);
  assert.equal((await service.read(scope, { type: "memory", id })).item.text, updated);
  assert.equal((await service.forget(scope, id, source)).status, "forgotten");
  assert.deepEqual((await service.recall(scope, "lens", search)).items, []);
  assert.deepEqual((await service.exportMemories(scope, page)).items, []);
  assert.ok(calls.every(([port, , phase]) => port === "gate" && phase !== "dispatch"));
});

test("a supplied model keeps the qualified capture trace", async () => {
  const trace = await captureTrace(createMemoryService);
  // Captured from the core-next base with tools/testing/service-optional-model.qualification.mjs.
  const digest = createHash("sha256").update(JSON.stringify(trace)).digest("hex");
  assert.equal(digest, "d4b377c09a680444af51a7650c0507425151b2f69573a9a88f4cebcaaf8bc6b9");
});
