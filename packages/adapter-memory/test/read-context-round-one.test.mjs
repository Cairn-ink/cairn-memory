import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryService } from "@cairn-ink/core/service";
import { assemblyClock, fixtureCount, formatAssembly } from "@cairn-ink/conformance/context-assembly";
import { contextReadTestService } from "@cairn-ink/conformance/context-read";
import { createMemoryAdapter } from "../src/index.mjs";

const scope = { owner: "fixture-owner", namespace: "project\0assembly" };
const readSet = ({ owner, namespace }) => ({ owner, namespaces: [namespace], accessGenerations: [1] });
const query = { query: "albatross", types: ["memory"], intent: "current", semantic: false };
const source = { kind: "mcp", client: null, sessionId: null };
const body = "An albatross keeps watch.";
const fact = text => ({ kind: "fact", confidence: 1, embedding: null,
  textHash: "sha256:" + createHash("sha256").update(text.toLowerCase()).digest("hex") });
const captureKey = (sessionId, eventId, target = scope) => ({
  scope: target, client: "fixture-client", sessionId, eventId, payloadDigest: "a".repeat(64),
});
const turn = (id, content, occurredAtMs = null) => ({ id, role: "user", content, occurredAtMs });
const write = (storage, action) => storage.uow.run(scope.owner, { pauseLock: true }, action);
const read = (storage, action) => storage.uow.run(scope.owner, { readOnly: true }, action);

function adapter() {
  return createMemoryAdapter({ capabilities: { contextRead: true, contextRawRead: true,
    rawArchive: true, inspect: true, fingerprintKey: true } });
}

function assemblyService(storage, count = fixtureCount) {
  return createMemoryService({ profile: "keyless-local", storage, clock: assemblyClock(),
    contextReadCounter: { count }, contextReadFormat: formatAssembly });
}

async function archive(storage, key, messages) {
  assert.equal((await write(storage, tx => storage.raw.archive(tx, key, messages))).archived, messages.length);
}

async function capture(storage, key, messages, memories) {
  assert.equal((await write(storage, tx => storage.capture.admit(tx, key, messages))).status, "admitted");
  const claim = await write(storage, tx => storage.capture.claim(tx, key, messages, { leaseMs: 10_000 }));
  assert.equal(claim.status, "claimed");
  await write(storage, tx => storage.capture.beginDispatch(tx, claim.token));
  const finished = await write(storage, tx => storage.capture.finish(tx, claim.token,
    memories.map(({ text, sources }) => ({ ...fact(text), content: text, receipts: sources.map(({ id, role, occurredAtMs }) =>
      ({ client: key.client, sessionId: key.sessionId, messageId: id, role, occurredAtMs })) }))));
  assert.equal(finished.memories.length, memories.length);
  return finished.memories;
}

async function searchRaw(storage, set) {
  return (await read(storage, tx => storage.contextRead.raw.search(tx, set, query.query,
    { limit: 24, lexicalOnly: true }))).turns;
}

test("Raw lineage uses the capture batch while delivered receipts use the message ID", async () => {
  const storage = adapter();
  const key = captureKey("watch", "capture-batch-17");
  const message = turn("watch-turn", body);
  await archive(storage, key, [message]);
  const [memory] = await capture(storage, key, [message], [{ text: body, sources: [message] }]);
  const set = readSet(scope);
  const ref = { scope, type: "memory", id: memory.id, revision: memory.revision };
  const [row] = await read(storage, tx => storage.contextRead.evidence(tx, set, [ref], "current"));
  assert.equal(row.receipts[0].eventId, message.id);
  assert.equal(JSON.stringify(row).includes(key.eventId), false);
  const [stored] = await storage.harness.dump();
  assert.equal(JSON.stringify(stored.rows[0].receipts).includes(key.eventId), false);

  const service = assemblyService(storage);
  const result = await service.readContext(set, query);
  assert.deepEqual(result.assembly.items.map(item => item.ref.id), [memory.id]);
  assert.deepEqual(result.assembly.items[0].evidence?.map(item => item.ref.messageId), [message.id]);
  const fetched = await service.fetchEvidence(set, { snapshot: result.snapshot });
  assert.equal(fetched.items[0].provenance.sources[0].receiptId, row.receipts[0].id);
  assert.equal(JSON.stringify({ result, fetched }).includes(key.eventId), false);
});

test("an omitted stale Raw witness repacks and fences a fresh Memory-only result", async () => {
  const storage = adapter();
  const key = captureKey("standalone", "raw-event");
  const message = turn("omitted", "An albatross flew past the offshore tower yesterday morning.");
  await write(storage, tx => storage.raw.archive(tx, key, [message]));
  const { id, revision } = await write(storage, tx => storage.memories.insert(tx, scope,
    { ...fact(body), text: body, origin: "explicit", source }, [], 1));
  const set = readSet(scope);
  const input = { ...query, budget: { maxItems: 1 } };
  const baseline = await assemblyService(storage).readContext(set, input);
  assert.deepEqual(baseline.assembly.items.map(item => item.ref.id), [id]);
  assert.equal(baseline.diagnostics.omitted.items, 1);
  const withoutRaw = await assemblyService(storage).readContext(set, { ...input, raw: false });

  const { uow, contextRead, fence } = storage;
  const snapshots = [];
  const generations = [];
  const witnessed = [];
  const fenced = [];
  let counted = false;
  const service = assemblyService({ ...storage,
    uow: { async run(owner, options, action) {
      if (counted && !snapshots.length) await write(storage, tx => storage.raw.fenceSession(tx, scope, key));
      return uow.run(owner, options, tx => {
        if (counted) snapshots.push(tx);
        return action(tx);
      });
    } },
    contextRead: { ...contextRead,
      async snapshotState(tx, ...args) {
        if (counted) generations.push(tx);
        return contextRead.snapshotState(tx, ...args);
      },
      raw: { ...contextRead.raw,
        async revalidate(tx, set, turns) {
          witnessed.push({ tx, ids: turns.map(turn => turn.messageId) });
          return contextRead.raw.revalidate(tx, set, turns);
        },
      },
    },
    fence: { async assertVisible(tx, ...args) {
      if (counted) fenced.push({ tx, refs: args[1] });
      return fence.assertVisible(tx, ...args);
    } },
  }, text => { counted = true; return fixtureCount(text); });

  const result = await service.readContext(set, input);
  assert.equal(formatAssembly(result.assembly), formatAssembly(withoutRaw.assembly));
  assert.equal(result.diagnostics.coverage.raw, "partial");
  assert.deepEqual(result.diagnostics.omitted, withoutRaw.diagnostics.omitted);
  assert.deepEqual(result.diagnostics.budget, withoutRaw.diagnostics.budget);
  assert.equal(snapshots.length, 2);
  assert.notEqual(snapshots[0], snapshots[1]);
  assert.deepEqual(generations, snapshots);
  assert.deepEqual(witnessed, [{ tx: snapshots[0], ids: [message.id] }]);
  assert.ok(fenced.some(({ tx, refs }) => tx === snapshots[1] && refs.length === 1 && refs[0].id === id));
  const fetched = await assemblyService(storage).fetchEvidence(set, { snapshot: result.snapshot });
  assert.deepEqual(fetched.items.map(item => item.ref), [{ type: "memory", scope, id, revision }]);
});

test("a secondary Memory date follows Raw evidence in the formatted JSON", async () => {
  const storage = adapter();
  const shared = turn("shared", body);
  const dated = turn("secondary-date", "A separate chronology", Date.UTC(2025, 0, 3, 4, 5));
  const key = captureKey("shared-lineage", shared.id);
  await archive(storage, key, [shared, dated]);
  const set = readSet(scope);
  const [witness] = await searchRaw(storage, set);
  const { scope: rawScope, conversationId, messageId } = witness;
  const rawRef = { scope: rawScope, conversationId, messageId };
  const secondaryBody = "The albatross navigates distant islands using northern currents.";
  const [primary, secondary] = await capture(storage, key, [shared, dated], [
    { text: body, sources: [shared] }, { text: secondaryBody, sources: [shared, dated] },
  ]);
  // Supply qualified lineage at the store boundary to isolate projection from claim lookup.
  const { contextRead } = storage;
  const service = assemblyService({ ...storage, contextRead: { ...contextRead,
    async evidence(...args) {
      const rows = await contextRead.evidence(...args);
      return rows.map(row => row?.type === "memory" ? { ...row, receipts: row.receipts.map(receipt =>
        receipt.messageId === shared.id ? { ...receipt, rawTurns: [rawRef] } : receipt) } : row);
    },
    raw: {
      async search() { return { turns: [witness], coverage: "included" }; },
      async revalidate(_tx, _set, turns) {
        assert.deepEqual(turns, [witness]);
        return true;
      },
    },
  } });
  const plain = await service.readContext(set, { ...query, raw: false });
  assert.deepEqual(plain.assembly.items.map(({ ref, date }) => [ref.id, date]),
    [[secondary.id, "2025-01-03T04:05Z"], [primary.id, undefined]]);
  const result = await service.readContext(set, query);
  const [item] = result.assembly.items;
  assert.equal(result.assembly.items.length, 1);
  const [secondaryRef, primaryRef] = plain.assembly.items.map(item => item.ref);
  const date = "2025-01-03T04:05Z";
  const datedSource = plain.assembly.items[0].sources.find(source => source.date === date);
  assert.equal(formatAssembly(result.assembly), formatAssembly({ framing: result.assembly.framing, items: [{
    ref: primaryRef, rank: 1, body: `${body}\n${secondaryBody}`, metadata: { origin: "inferred" },
    sources: [{ index: 0, role: "user", excerpt: body }, { memory: secondaryRef, index: datedSource.index, date, role: "user" }],
    sourcesComplete: false,
    evidence: [{ ref: { ns: 0, type: "raw", conversationId: JSON.stringify([key.client, key.sessionId]),
      messageId: shared.id }, role: "user", start: 0, end: body.length, body }],
    date,
  }] }));
  assert.equal(item.date, date);
  assert.equal(result.diagnostics.budget.used, fixtureCount(formatAssembly(result.assembly)));
});

test("forget denies linked Raw turns in both capture sessions", async t => {
  const storage = adapter();
  const set = readSet(scope);
  const first = turn("first-turn", "The first albatross sighting was by the bridge.", 1);
  const second = turn("second-turn", "The second albatross sighting was from the pier.", 2);
  const firstKey = captureKey("first-session", first.id);
  const secondKey = captureKey("second-session", second.id);
  await archive(storage, firstKey, [first]);
  await archive(storage, secondKey, [second]);
  const before = await searchRaw(storage, set);
  assert.deepEqual(before.map(turn => turn.messageId).sort(), [first.id, second.id]);
  const [saved] = await capture(storage, firstKey, [first], [{ text: body, sources: [first] }]);
  const [duplicate] = await capture(storage, secondKey, [second], [{ text: body, sources: [second] }]);
  assert.equal(duplicate.id, saved.id);
  assert.equal((await contextReadTestService(storage).forget(scope, saved.id, source)).status, "forgotten");

  await t.test("search and assembly omit both turns", async () => {
    assert.deepEqual(await searchRaw(storage, set), []);
    assert.deepEqual((await assemblyService(storage).readContext(set, query)).assembly.items, []);
  });
  await t.test("the second session's prior witness is stale", async () => {
    assert.equal(await read(storage, tx => storage.contextRead.raw.revalidate(tx, set,
      before.filter(turn => turn.messageId === second.id))), false);
  });
});

test("a receipt-less fork cannot deliver its turn after the source project fences it", async t => {
  const storage = adapter();
  const forkScope = { ...scope, namespace: "project\0fork" };
  const root = captureKey("root-session", "root-event");
  const fork = captureKey("fork-session", "fork-event", forkScope);
  const message = turn("shared-turn", body, Date.UTC(2025, 0, 1));
  await write(storage, async tx => {
    assert.equal((await storage.raw.archive(tx, root, [message])).archived, 1);
    await storage.raw.recordLineage(tx, root, [message]);
    assert.equal((await storage.raw.archive(tx, fork, [message])).archived, 1);
    await storage.raw.recordLineage(tx, fork, [message]);
  });
  const set = readSet(forkScope);
  const service = assemblyService(storage);
  const before = await searchRaw(storage, set);
  assert.deepEqual(before.map(turn => turn.messageId), [message.id]);
  const initial = await service.readContext(set, query);
  assert.deepEqual(initial.assembly.items.map(item => item.body), [body]);

  await write(storage, tx => storage.raw.fenceSession(tx, scope, root));
  assert.deepEqual(await read(storage, tx => storage.capture.eligible(tx, fork, [message])), []);
  await t.test("the fork-only assembly and search omit the turn", async () => {
    assert.deepEqual((await service.readContext(set, query)).assembly.items, []);
    assert.deepEqual(await searchRaw(storage, set), []);
  });
  await t.test("the fork's prior witness is stale", async () => {
    assert.equal(await read(storage, tx => storage.contextRead.raw.revalidate(tx, set, before)), false);
  });
});
