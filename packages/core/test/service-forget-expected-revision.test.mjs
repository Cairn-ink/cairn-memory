import assert from "node:assert/strict";
import { test } from "node:test";
import { allDigests, CoreError } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { hostedScope as scope, memory, serviceFake } from "./helpers/service-fake.mjs";

const source = { kind: "mcp", client: null, sessionId: null };
const session = { client: "fixture", sessionId: "root" };
const text = "The spare lens is in the cabinet.";
const receipt = {
  ...session, messageId: "message-one", messageKey: "message-one",
  sessionKeyHash: "a".repeat(64), role: "user", occurredAtMs: 1,
};
const span = {
  ...scope, kind: "rawSpan", origin: "forget", actionId: "fixture-span",
  sessionKeyHash: receipt.sessionKeyHash, messageKey: receipt.messageKey,
  contentDigest: "b".repeat(64), startUtf16: 0, endUtf16: 8,
};

const writePorts = [
  ["suppressions", "writeFact"],
  ["raw", "fenceSession"],
  ["raw", "eraseSessions"],
  ["raw", "purgeWithheld"],
  ["documentCards", "hideWhere"],
  ["conflicts", "invalidate"],
  ["rationale", "invalidate"],
  ["quantityLedger", "dropWhere"],
  ["memories", "erase"],
  ["forgetLog", "record"],
];

async function setup(t, fingerprintKey, { externalKey = false, revision = 3 } = {}) {
  const receipts = [receipt];
  const target = { ...memory("target", { text }), source: { kind: "capture", ...session }, revision, receipts };
  const similar = memory("similar", { text });
  const fake = serviceFake({
    rows: [target, similar], writes: true, capture: true, rawArchive: true, hasKey: fingerprintKey,
    forgetting: {
      capabilities: { fingerprintKey, spanLineage: true, rawSpans: true, sessionLineage: true,
        rawArchive: true, documentCards: true, conflictEdges: true, rationaleEdges: true,
        quantityLedger: true, forgetLog: true },
      receipts, spans: [span], closure: [session],
    },
  });
  const { storage, deps, calls, seedFact } = fake;
  seedFact({ ...scope, namespace: "other", kind: "text", mode: "exact", origin: "forget",
    actionId: "previous-suppression", text: { digests: await allDigests("An unrelated memory.") } });
  const message = { id: receipt.messageId, content: text, role: receipt.role, occurredAtMs: receipt.occurredAtMs };
  await storage.uow.run(scope.owner, { pauseLock: true }, tx =>
    storage.raw.importArchive(tx, scope, session, [message]));
  assert.deepEqual(fake.archived(scope.owner), [message]);

  storage.rationale = {
    async invalidate(tx, _scope, id) {
      (tx.effects.invalidatedRationale ??= []).push(id);
    },
  };
  let keyLookup;
  if (!externalKey) {
    const key = await storage.keys.userKey(scope.owner);
    storage.keys.userKeyForWrite = async () => key;
    keyLookup = t.mock.method(storage.keys, "userKeyForWrite").mock;
  }
  const writes = [];
  for (const [port, method] of writePorts) {
    const original = storage[port][method];
    t.mock.method(storage[port], method, function (...args) {
      writes.push(port + "." + method);
      return original.apply(this, args);
    });
  }
  const writeCalls = () => [...writes];
  const snapshot = () => structuredClone({ ...fake.committed(scope.owner), raw: fake.archived(scope.owner) });
  calls.length = 0;

  return { ...fake, target, similar, service: createMemoryService(deps), keyLookup, writeCalls, snapshot };
}

const invalidOptions = [
  ["non-enumerable revision", expectedRevision => Object.defineProperty({ expectedRevision },
    "expectedRevision", { enumerable: false })],
  ["inherited data revision", expectedRevision => Object.create({ expectedRevision })],
  ["inherited revision getter", (_revision, getter) => Object.create(
    Object.defineProperty({}, "expectedRevision", { get: getter }))],
  ["own revision getter", (_revision, getter) => Object.defineProperty({}, "expectedRevision",
    { enumerable: true, get: getter })],
  ["proxy with a has trap", expectedRevision => new Proxy(Object.defineProperty({ expectedRevision },
    "expectedRevision", { enumerable: false }), { has: () => false })],
  ["array options", () => []],
  ["primitive options", () => 0],
  ["built-in object with a plain prototype", () => Object.setPrototypeOf(new Date(0), Object.prototype)],
];

for (const [label, optionsOf] of invalidOptions) {
  test(`forget rejects ${label} before looking up a key or opening a transaction`, async t => {
    const { service, target, snapshot, calls, writeCalls } = await setup(t, true, { externalKey: true });
    const before = snapshot();
    const getter = t.mock.fn(() => target.revision - 1);

    const result = await service.forget(scope, target.id, source, optionsOf(target.revision - 1, getter))
      .catch(error => error);

    assert.deepEqual({ status: result.status, writes: writeCalls() }, { status: undefined, writes: [] });
    assert.ok(result instanceof CoreError);
    assert.equal(result.code, "invalid_input");
    assert.deepEqual(calls, []);
    assert.deepEqual(snapshot(), before);
    assert.equal(getter.mock.callCount(), 0);
  });
}

test("forget keeps the supplied revision if another argument's getter changes the options", async t => {
  const { service, target, snapshot, writeCalls } = await setup(t, true);
  const before = snapshot();
  const options = { expectedRevision: target.revision - 1 };
  const input = {
    ...scope,
    get namespace() {
      delete options.expectedRevision;
      return scope.namespace;
    },
  };

  assert.deepEqual(await service.forget(input, target.id, source, options), { status: "conflict" });
  assert.deepEqual(writeCalls(), []);
  assert.deepEqual(snapshot(), before);
});

test("forget accepts a null-prototype options record and treats null as omission", async t => {
  const { service, target, snapshot, writeCalls } = await setup(t, true);
  const before = snapshot();
  const options = Object.assign(Object.create(null), { expectedRevision: target.revision - 1 });

  assert.deepEqual(await service.forget(scope, target.id, source, options), { status: "conflict" });
  assert.deepEqual(writeCalls(), []);
  assert.deepEqual(snapshot(), before);
  assert.deepEqual(await service.forget(scope, target.id, source, null), { status: "forgotten", removedSimilar: 1 });
});

for (const fingerprintKey of [true, false]) {
  const mode = fingerprintKey ? "keyed" : "keyless";

  test(`forget with a stale revision makes zero port writes (${mode})`, async t => {
    const { service, target, snapshot, writeCalls, calls, keyLookup } = await setup(t, fingerprintKey);
    const before = snapshot();

    const result = await service.forget(scope, target.id, source, { expectedRevision: target.revision - 1 });

    assert.deepEqual(writeCalls(), [], "a stale forget must make zero port writes");
    assert.deepEqual(snapshot(), before);
    assert.deepEqual(result, { status: "conflict" });
    assert.equal(keyLookup.callCount(), 0);
    assert.deepEqual(calls.map(([method]) => method), ["run", "lock", "lock", "memories.get"]);
  });

  test(`forget with the exact revision has the same effects as unconditional forget (${mode})`, async t => {
    const checked = await setup(t, fingerprintKey);
    const unconditional = await setup(t, fingerprintKey);

    const actual = await checked.service.forget(scope, checked.target.id, source,
      { expectedRevision: checked.target.revision });
    const baseline = await unconditional.service.forget(scope, unconditional.target.id, source);

    assert.deepEqual(actual, { status: "forgotten", removedSimilar: 1 });
    assert.deepEqual(actual, baseline);
    assert.deepEqual(checked.snapshot(), unconditional.snapshot());
    assert.deepEqual(checked.writeCalls(), unconditional.writeCalls());
  });

  test(`forget without an expected revision performs the privacy cascade (${mode})`, async t => {
    const { service, target, similar, snapshot, writeCalls, keyLookup } = await setup(t, fingerprintKey);

    assert.deepEqual(await service.forget(scope, target.id, source), { status: "forgotten", removedSimilar: 1 });
    const { rows, facts, effects } = snapshot();
    assert.deepEqual(rows, [similar]);
    assert.deepEqual(facts.slice(1).map(({ fact }) => [fact.kind, fact.mode]), [
      ["text", fingerprintKey ? "full" : "exact"], ["rawSpan", undefined],
    ]);
    assert.deepEqual(effects, {
      fences: [session], closures: [[session]], purges: [[facts[1]]],
      hiddenCards: [
        { sourceMemoryId: target.id },
        { sourceMessage: { ...session, messageId: receipt.messageId } },
        { session },
      ],
      invalidatedConflicts: [target.id], invalidatedRationale: [target.id],
      quantityDrops: [{ by: "memoryId", id: target.id }], logs: [target.id],
    });
    assert.deepEqual(writeCalls(), [
      "suppressions.writeFact", "raw.fenceSession", "raw.eraseSessions", "raw.purgeWithheld",
      "suppressions.writeFact", ...Array(3).fill("documentCards.hideWhere"),
      "conflicts.invalidate", "rationale.invalidate", "quantityLedger.dropWhere", "memories.erase", "forgetLog.record",
    ]);
    assert.equal(keyLookup.callCount(), Number(fingerprintKey));
  });

  test(`forget reports missing and repeated IDs with and without a revision (${mode})`, async t => {
    const { service, target, snapshot, writeCalls } = await setup(t, fingerprintKey);
    const before = snapshot();
    assert.deepEqual(await service.forget(scope, "missing", source, { expectedRevision: 0 }), { status: "not_found" });
    assert.deepEqual(await service.forget(scope, "missing", source), { status: "not_found" });
    assert.deepEqual(writeCalls(), []);
    assert.deepEqual(snapshot(), before);

    await service.forget(scope, target.id, source, { expectedRevision: target.revision });
    const after = snapshot();
    const writes = writeCalls();
    assert.deepEqual(await service.forget(scope, target.id, source, { expectedRevision: target.revision }),
      { status: "not_found" });
    assert.deepEqual(await service.forget(scope, target.id, source, { expectedRevision: 0 }), { status: "not_found" });
    assert.deepEqual(await service.forget(scope, target.id, source), { status: "not_found" });
    assert.deepEqual(writeCalls(), writes);
    assert.deepEqual(snapshot(), after);
  });

  test(`forget accepts zero as an expected revision (${mode})`, async t => {
    const { service, target } = await setup(t, fingerprintKey, { revision: 0 });
    assert.deepEqual(await service.forget(scope, target.id, source, { expectedRevision: 0 }),
      { status: "forgotten", removedSimilar: 1 });
  });

  test(`forget rejects invalid expected revisions before opening a transaction (${mode})`, async t => {
    const { service, target, snapshot, writeCalls, calls, keyLookup } = await setup(t, fingerprintKey);
    const before = snapshot();
    for (const expectedRevision of [-1, 1.5, "3", null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(service.forget(scope, target.id, source, { expectedRevision }),
        error => error instanceof CoreError && error.code === "invalid_input");
    }
    assert.deepEqual(writeCalls(), []);
    assert.deepEqual(snapshot(), before);
    assert.deepEqual(calls, []);
    assert.equal(keyLookup.callCount(), 0);
  });

  test(`forget checks the transaction row after a concurrent correction (${mode})`, async t => {
    const { service, storage, hooks, calls, target, snapshot, writeCalls } =
      await setup(t, fingerprintKey, { externalKey: true });
    let corrected;
    hooks.beforeRun = async () => {
      hooks.beforeRun = undefined;
      assert.equal(calls.filter(([method]) => method === "keys.userKey").length, Number(fingerprintKey));
      // Commit the correction's storage write before the forget transaction takes its snapshot.
      const changed = await storage.uow.run(scope.owner, { pauseLock: true }, tx =>
        storage.memories.replaceContent(tx, scope, target.id, target.revision,
          { text: "The spare lens is in the drawer." }, null, 200));
      assert.deepEqual(changed, { outcome: "changed", revision: target.revision + 1 });
      corrected = snapshot();
    };

    const result = await service.forget(scope, target.id, source, { expectedRevision: target.revision });

    assert.deepEqual(writeCalls(), []);
    assert.deepEqual(result, { status: "conflict" });
    assert.equal(corrected.rows.find(({ id }) => id === target.id).revision, target.revision + 1);
    assert.deepEqual(snapshot(), corrected);
  });
}
