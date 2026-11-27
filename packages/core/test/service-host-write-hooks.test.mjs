import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { test } from "node:test";
import { assertAdapterCapabilities, CAPABILITIES, capabilities, CoreError, ERROR_CODES } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { hostedScope as scope, serviceFake } from "./helpers/service-fake.mjs";

const source = { kind: "mcp", client: "fixture", sessionId: null };

function hooks() {
  return {
    async beforeSave() { return { status: "proceed" }; },
    async beforeCorrect() { return { status: "proceed" }; },
    async onSave() {},
    async onCorrect() {},
    async onForget() {},
    async onCaptureFinish() {},
  };
}

function port() {
  return {
    context: new AsyncLocalStorage(),
    bindHookAuthority() {},
    async priorReceipts() { return []; },
    async predecessorEvidence() { return { priorReceipts: [], affectedMessages: [] }; },
    async beginCapture() {},
    async captureWrites() { return []; },
    async captureSources() { return []; },
    async finalizeCapture() {},
    async finalizeSave() {},
    statementFailure() {},
  };
}

test("hostWriteHooks is an optional runtime flag with a matching transaction and effects port", () => {
  assert.equal(CAPABILITIES.includes("hostWriteHooks"), false);
  assert.equal(capabilities({}).hostWriteHooks ?? false, false);
  assert.equal(capabilities({ hostWriteHooks: true }).hostWriteHooks, true);
  assert.throws(() => capabilities({ hostWriteHooks: "true" }), { code: "invalid_input" });
  assert.throws(() => assertAdapterCapabilities({ capabilities: capabilities({ hostWriteHooks: true }) }),
    { code: "capability_unavailable" });
  assert.throws(() => assertAdapterCapabilities({ capabilities: capabilities({}), hostWriteHookPort: port() }),
    { code: "capability_unavailable" });
  assert.throws(() => assertAdapterCapabilities({ capabilities: capabilities({ hostWriteHooks: true }), hostWriteHookPort: {} }),
    { code: "invalid_input" });
  assert.doesNotThrow(() => assertAdapterCapabilities({ capabilities: capabilities({ hostWriteHooks: true }), hostWriteHookPort: port() }));
});

test("full registration accepts omission, refuses incomplete sets and binds all six methods once", async () => {
  const { deps, storage } = serviceFake({ writes: true });
  assert.throws(() => createMemoryService({ ...deps, hostWriteHooks: hooks() }), { code: "capability_unavailable" });
  assert.throws(() => createMemoryService({ ...deps, hostWriteHooks: null }), { code: "invalid_input" });
  storage.capabilities.hostWriteHooks = true;
  assert.throws(() => createMemoryService(deps), { code: "capability_unavailable" });
  storage.hostWriteHookPort = port();
  storage.memories.committedIndexRevision = async () => 0;
  storage.memories.readRevision = async () => null;
  assert.doesNotThrow(() => createMemoryService(deps));
  for (const member of Object.keys(hooks())) {
    const partial = hooks();
    delete partial[member];
    assert.throws(() => createMemoryService({ ...deps, hostWriteHooks: partial }), { code: "invalid_input" });
  }

  const original = hooks();
  original.beforeSave = async function (tx, ctx) {
    assert.equal(this, original);
    assert.equal(tx.options.readOnly === true, false);
    assert.equal(tx.options.pauseLock, true);
    assert.deepEqual(ctx, { scope, source, request: null });
    return { status: "refuse" };
  };
  const service = createMemoryService({ ...deps, hostWriteHooks: original });
  original.beforeSave = async () => { throw new Error("registration should have bound the initial method"); };
  assert.equal((await service.save(scope, "Keep the green umbrella nearby.", source)).status, "suppressed");
});

test("the public hook failure is an unavailable, nonretryable code-only error", () => {
  assert.equal(ERROR_CODES.host_write_hook_failed, "unavailable");
  assert.deepEqual(Object.assign({}, new CoreError("host_write_hook_failed")),
    { name: "CoreError", code: "host_write_hook_failed", kind: "unavailable", retryable: false });
});
