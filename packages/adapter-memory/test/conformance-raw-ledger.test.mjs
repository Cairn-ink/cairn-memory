import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { RAW_LEDGER_CASES, runCase } from "@cairn-ink/conformance";
import { rawFactory } from "./fixtures/raw.mjs";

for (const sessionRefs of ["plain", "hashed"]) {
  const factory = rawFactory({ sessionRefs });
  for (const testCase of RAW_LEDGER_CASES) {
    test(`${factory.name} ${testCase.id} ${testCase.title}`, async (t) => {
      const expected = testCase.id === "K-RAW-LEDGER-2" ? "needs sessionLineage" : null;
      const reason = await runCase(factory, testCase);
      assert.equal(reason, expected);
      if (reason !== null) t.skip(reason);
    });
  }
}

for (const method of ["admit", "load"]) {
  test(`Ledger cases require capture.${method}`, async () => {
    const factory = rawFactory({ create(options) {
      const adapter = createMemoryAdapter(options);
      delete adapter.capture[method];
      return adapter;
    } });
    assert.equal(await runCase(factory, RAW_LEDGER_CASES[0]), `needs capture.${method}`);
  });
}

test("Ledger purge requires rawArchive", async () => {
  const factory = rawFactory({ flags: { rawArchive: false } });
  for (const testCase of RAW_LEDGER_CASES) {
    assert.equal(await runCase(factory, testCase), "needs rawArchive");
  }
});

test("Memory erases the ledger for the supplied proven session members only", async () => {
  const { raw, capture, uow } = createMemoryAdapter({ capabilities: { rawArchive: true } });
  const scope = { owner: "owner", namespace: null };
  const root = { scope, client: "client", sessionId: "root", eventId: "first-event", payloadDigest: "a".repeat(64) };
  const related = { ...root, sessionId: "related", eventId: "second-event" };
  const foreignClient = { ...root, client: "other-client" };
  const foreignNamespace = { ...root, scope: { ...scope, namespace: "project" }, eventId: "third-event" };
  const first = { id: "first", role: "user", content: "cedar drawer", occurredAtMs: 10 };
  const second = { id: "second", role: "assistant", content: "maple shelf", occurredAtMs: null };
  const alreadyBlank = { ...second, content: "" };
  const write = (fn) => uow.run(scope.owner, { pauseLock: true }, fn);
  const load = (target) => uow.run(scope.owner, { readOnly: true }, (tx) => capture.load(tx, target));
  await write(async (tx) => {
    await capture.admit(tx, root, [first, alreadyBlank]);
    await capture.admit(tx, related, [second]);
    await capture.admit(tx, foreignClient, [first]);
    await capture.admit(tx, foreignNamespace, [first]);
  });
  // This adapter consumes closure members but does not implement the lineage resolver.
  const closure = [root, related].map(({ client, sessionId }) => ({ client, sessionId }));
  const erase = () => write((tx) => raw.eraseSessions(tx, scope, closure));
  assert.deepEqual(await erase(), { rawDeleted: 0, ledgerBlanked: 2 });
  assert.deepEqual(await load(root), { key: root, messages: [{ ...first, content: "" }, alreadyBlank] });
  assert.deepEqual(await load(related), { key: related, messages: [alreadyBlank] });
  assert.deepEqual(await load(foreignClient), { key: foreignClient, messages: [first] });
  assert.deepEqual(await load(foreignNamespace), { key: foreignNamespace, messages: [first] });
  assert.deepEqual(await erase(), { rawDeleted: 0, ledgerBlanked: 0 });
});
