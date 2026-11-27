import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, createHmac } from "node:crypto";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { CoreError as SeparateCoreError } from "../src/errors.mjs?adapter-copy";
import { createMemoryService } from "../src/service/index.mjs";
import { createHookAuthorizer, guardHostWriteContext, registerHostWriteContext } from "../src/service/entry.mjs";

// The core suite can run before the sibling adapter's dependencies are installed.
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

test("the authorizer refuses a second reader and keeps the first", () => {
  const authorizer = createHookAuthorizer();
  const tx = {};
  const record = { tx };
  const reader = candidate => candidate === tx ? record : undefined;
  assert.equal(authorizer.authorize(tx), undefined);
  authorizer.bind(reader);
  assert.throws(() => authorizer.bind(reader), { code: "invalid_input" });
  assert.throws(() => authorizer.bind(() => ({})), { code: "invalid_input" });
  assert.equal(authorizer.authorize(tx), record);
  assert.equal(authorizer.authorize({}), undefined);
});

test("an invalid reader leaves the authority slot available", () => {
  const authorizer = createHookAuthorizer();
  const tx = {};
  const record = { tx };
  assert.throws(() => authorizer.bind(null), { code: "invalid_input" });
  assert.equal(authorizer.authorize(tx), undefined);
  authorizer.bind(() => record);
  assert.equal(authorizer.authorize(tx), record);
});

test("binding authority inside a hook refuses before checking the reader or slot", () => {
  const context = guardHostWriteContext(new AsyncLocalStorage());
  registerHostWriteContext(context);
  const authorizer = createHookAuthorizer();
  const tx = {};
  const record = { tx };
  const reader = () => record;
  context.run(record, () => {
    assert.throws(() => authorizer.bind(reader), { code: "storage_transaction_active" });
    assert.throws(() => authorizer.bind(null), { code: "storage_transaction_active" });
  });
  authorizer.bind(reader);
  context.run(record, () => {
    assert.throws(() => authorizer.bind(reader), { code: "storage_transaction_active" });
  });
  assert.equal(authorizer.authorize(tx), record);
});

for (const store of [undefined, null]) {
  test(`the guarded context rejects ${store} without calling the callback inside a hook`, () => {
    const context = guardHostWriteContext(new AsyncLocalStorage());
    let called = false;
    context.run({}, () => {
      assert.throws(() => context.run(store, () => { called = true; }),
        { code: "host_write_hook_failed" });
      assert.equal(called, false);
    });
  });
}

test("the guarded context validates its delegate and preserves allowed calls", () => {
  for (const invalid of [null, {}, { getStore() {} }, { run() {} }]) {
    assert.throws(() => guardHostWriteContext(invalid), { code: "invalid_input" });
  }
  const delegate = new AsyncLocalStorage();
  const context = guardHostWriteContext(delegate);
  assert.ok(Object.isFrozen(context));
  const result = {};
  assert.equal(context.run(undefined, () => {
    assert.equal(context.getStore(), undefined);
    return result;
  }), result);
  const outer = {};
  const inner = {};
  context.run(outer, () => {
    assert.equal(context.getStore(), outer);
    assert.equal(context.run(inner, () => delegate.getStore()), inner);
    assert.equal(context.getStore(), outer);
  });
  assert.equal(context.getStore(), undefined);
});

function memoryFixture(overrides = {}) {
  const now = () => 12_345;
  return {
    storage: createMemoryAdapter({ hostWriteHooks: true, now }),
    config: {},
    clock: {
      nowMs: now, monotonicMs: now,
      sha256Hex: value => createHash("sha256").update(value).digest("hex"),
      hmacHex: (key, value) => createHmac("sha256", key).update(value).digest("hex"),
    },
    embedder: null, gate: { assertOpen() {} }, tokens: { countTokens: () => 1 },
    hostWriteHooks: {
      async beforeSave() { return { status: "proceed" }; },
      async beforeCorrect() { return { status: "proceed" }; },
      async onSave() {},
      async onCorrect() {},
      async onForget() {},
      async onCaptureFinish() {},
      ...overrides,
    },
  };
}

test("escaping the memory hook context rolls back the save and its host write", async () => {
  let calls = 0;
  let escaped = false;
  const deps = memoryFixture({ async onSave(tx, ctx) {
    calls++;
    await table.put(tx, ctx.scope, "effect", true);
    port.context.run(undefined, () => { escaped = true; });
  } });
  const { storage } = deps;
  const port = storage.hostWriteHookPort;
  const table = storage.harness.createHostHookTable();
  const service = createMemoryService(deps);
  const before = await storage.harness.dump();
  const scope = { owner: "hook-owner", namespace: null };
  const source = { kind: "mcp", client: null, sessionId: null };
  await assert.rejects(service.save(scope, "The trail ends at a stone bench.", source),
    { code: "host_write_hook_failed" });
  assert.equal(calls, 1);
  assert.equal(escaped, false);
  assert.deepEqual(await storage.harness.dump(), before);
  assert.equal(await table.inspect(scope, "effect"), undefined);
});

test("creating a second service on the same memory hook port fails at registration", () => {
  const deps = memoryFixture();
  createMemoryService(deps);
  assert.throws(() => createMemoryService(deps), { code: "invalid_input" });
});

test("service creation preserves the registration error from a separate core module", () => {
  const deps = memoryFixture();
  const port = deps.storage.hostWriteHookPort;
  deps.storage = { ...deps.storage, hostWriteHookPort: {
    ...port,
    bindHookAuthority() { throw new SeparateCoreError("invalid_input"); },
  } };
  assert.throws(() => createMemoryService(deps), { code: "invalid_input" });
});
