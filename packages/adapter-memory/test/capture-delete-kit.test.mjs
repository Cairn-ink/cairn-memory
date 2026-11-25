import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { CAPTURE_DELETE_CASES, runCase } from "@cairn-ink/conformance";
import { rawFactory } from "./fixtures/raw.mjs";

for (const sessionRefs of ["plain", "hashed"]) {
  for (const required of [false, true]) {
    const factory = rawFactory({ sessionRefs, required });
    for (const testCase of CAPTURE_DELETE_CASES) {
      test(`${factory.name} ${testCase.id} ${testCase.title}`, async () => {
        assert.equal(await runCase(factory, testCase), null);
      });
    }
  }
}

const [beforeCapture] = CAPTURE_DELETE_CASES;

test("K-CAP-DEL-1 rejects a delete that removes Raw rows and retains ledger text", async () => {
  const adapter = new URL("../src/index.mjs?variant=retain-delete-ledger", import.meta.url);
  const raw = new URL("./raw.mjs?variant=retain-delete-ledger", adapter);
  const original = readFileSync(raw, "utf8");
  const matcher = "(key) => slots.has(sessionSlot(namespace, key))";
  assert.equal(original.split(matcher).length - 1, 1, "Expected one ledger blanking matcher for conversation deletion");
  const source = original.replace(matcher, "() => false");
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL === adapter.href && specifier === "./raw.mjs") return nextResolve(raw.href, context);
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url === raw.href) return { format: "module", shortCircuit: true, source };
      return nextLoad(url, context);
    },
  });
  let create;
  try {
    ({ createMemoryAdapter: create } = await import(adapter.href));
  } finally {
    hooks.deregister();
  }
  await assert.rejects(runCase(rawFactory({ create }), beforeCapture),
    { message: "Deleted message text must be absent from the store (before capture, previously archived)" });
});

test("K-CAP-DEL-1 rejects a delete that does nothing", async () => {
  const factory = rawFactory({
    create(options) {
      const adapter = createMemoryAdapter(options);
      adapter.raw.deleteConversation = async () => ({ rawDeleted: 0 });
      return adapter;
    },
  });
  await assert.rejects(runCase(factory, beforeCapture),
    { message: "Conversation deletion must remove its Raw rows (before capture, previously archived)" });
});

test("K-CAP-DEL cases still pass with an always-allowing assertEligible", async () => {
  const factory = rawFactory({
    create(options) {
      const adapter = createMemoryAdapter(options);
      adapter.capture.assertEligible = async () => {};
      return adapter;
    },
  });
  for (const testCase of CAPTURE_DELETE_CASES) {
    assert.equal(await runCase(factory, testCase), null, testCase.id);
  }
});
