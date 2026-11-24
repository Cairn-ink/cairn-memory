import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryService } from "@cairn-ink/core/service";
import { assemblyClock, fixtureCount, formatAssembly } from "../../conformance/src/context-assembly-cases.mjs";
import { openSqliteAdapter } from "../src/index.mjs";
import { scratch, sha256 } from "./storage-fixtures.mjs";

const scope = { owner: "sqlite-context-owner", namespace: "project\0reopen" };
const readSet = { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [1] };
const search = { query: "albatross", types: ["memory"], intent: "current", semantic: false };
const session = { client: "fixture-client", sessionId: "fixture-session" };
const allReadPorts = { capabilities: { contextRead: true, contextRawRead: true } };

function service(storage) {
  return createMemoryService({ profile: "keyless-local", storage, clock: assemblyClock(),
    contextReadCounter: { count: fixtureCount }, contextReadFormat: formatAssembly });
}

function row(text) {
  return { kind: "fact", origin: "explicit", confidence: 1, text, embedding: null,
    source: { kind: "mcp", client: null, sessionId: null }, textHash: "sha256:" + sha256(text.toLowerCase()) };
}

function read(storage, work) {
  return storage.uow.run(scope.owner, { readOnly: true }, work);
}

test("SQLite persists the signed snapshot and both publications across reopen", async t => {
  const file = scratch();
  t.after(file.remove);
  const first = await openSqliteAdapter(file.path, allReadPorts);
  let fetched, publication, rawBefore, firstIdentity, cursor;
  const rawSearch = storage => read(storage, tx => storage.contextRead.raw.search(tx, readSet, search.query,
    { limit: 24, lexicalOnly: true }));
  try {
    const port = first.contextRead;
    const svc = service(first);
    const { id, revision } = await first.uow.run(scope.owner, { pauseLock: true }, async tx => {
      await first.raw.importArchive(tx, scope, session,
        [{ id: "bare-turn", role: "user", content: "albatross logged in Raw", occurredAtMs: 12345 }]);
      await first.memories.insert(tx, scope, row("albatross second memory"), [], 1);
      return first.memories.insert(tx, scope, row("albatross first memory"), [], 2);
    });
    cursor = (await svc.findCandidates(readSet, { ...search, limit: 1 })).nextCursor;
    assert.ok(cursor);
    fetched = await svc.fetchEvidence(readSet, { refs: [{ type: "memory", scope, id, revision }], intent: "current" });
    const identities = await read(first, tx => Promise.all([port.identity(tx), first.inspect.identity(tx)]));
    firstIdentity = identities[0];
    assert.equal(firstIdentity.storeId, identities[1].storeId);
    assert.ok(Buffer.from(firstIdentity.cursorKey).equals(identities[1].cursorKey), "Inspect and Context share the signing identity");
    publication = await read(first, tx => port.observeIndex(tx, readSet, search));

    const partial = await rawSearch(first);
    assert.equal(partial.coverage, "partial");
    assert.equal(partial.turns.length, 1);
    assert.equal(await first.maintainContextRaw(readSet), true);
    rawBefore = await rawSearch(first);
    assert.equal(rawBefore.coverage, "included");
    assert.deepEqual(rawBefore.turns, partial.turns);
  } finally {
    await first.close();
  }

  const reopened = await openSqliteAdapter(file.path, allReadPorts);
  try {
    const svc = service(reopened);
    const port = reopened.contextRead;
    const identity = await read(reopened, tx => port.identity(tx));
    assert.equal(identity.storeId, firstIdentity.storeId);
    assert.ok(Buffer.from(identity.cursorKey).equals(firstIdentity.cursorKey), "The signing key survives reopen");
    assert.deepEqual(await svc.fetchEvidence(readSet, { snapshot: fetched.snapshot }), fetched);
    assert.deepEqual(await read(reopened, tx => port.observeIndex(tx, readSet, search)), publication);
    assert.deepEqual(await rawSearch(reopened), rawBefore);
    const idle = await port.prepareLexical(readSet, search, {});
    assert.ok(Object.values(idle).every(count => count === 0));
    assert.deepEqual(await read(reopened, tx => port.observeIndex(tx, readSet, search)), publication);
    // Core's ranking cache is process-local, even when the signing identity
    // and the published index binding still match the cursor.
    await assert.rejects(svc.findCandidates(readSet, { ...search, cursor }), { code: "cursor_stale" });

    const check = turns => read(reopened, tx => port.raw.revalidate(tx, readSet, turns));
    assert.equal(await check(rawBefore.turns), true);
    const [turn] = rawBefore.turns;
    assert.equal(await check([{ ...turn, ranges: [{ start: 0, text: "unrelated span" }] }]), false);
    await reopened.uow.run(scope.owner, { pauseLock: true }, tx => reopened.raw.fenceSession(tx, scope, session));
    assert.equal(await check(rawBefore.turns), false);
    assert.deepEqual(await rawSearch(reopened), { turns: [], coverage: "partial" });
    assert.equal(await reopened.maintainContextRaw(readSet), true);
    assert.deepEqual(await rawSearch(reopened), { turns: [], coverage: "included" });
  } finally {
    await reopened.close();
  }
});

async function checkFencedReceipt(t, contextRawRead) {
  const file = scratch();
  t.after(file.remove);
  const sqlite = await openSqliteAdapter(file.path, { capabilities: { contextRead: true, contextRawRead } });
  try {
    const excerpt = "the albatross source must stay behind the fence";
    const message = { id: "turn", role: "user", content: excerpt, occurredAtMs: Date.UTC(2025, 0, 2) };
    const body = row("albatross memory remains visible");
    const ref = await sqlite.uow.run(scope.owner, { pauseLock: true }, async tx => {
      await sqlite.raw.importArchive(tx, scope, session, [message]);
      const { id, revision } = await sqlite.memories.insert(tx, scope, body,
        [{ ...session, messageId: message.id, role: message.role, occurredAtMs: message.occurredAtMs, excerpt }], 1);
      return { type: "memory", scope, id, revision };
    });
    const svc = service(sqlite);
    const fetch = () => svc.fetchEvidence(readSet, { refs: [ref], intent: "current" });
    const before = await fetch();
    assert.equal(before.items[0].provenance.sources.length, 1);
    assert.ok(formatAssembly((await svc.readContext(readSet, search)).assembly).includes(excerpt));
    await sqlite.uow.run(scope.owner, { pauseLock: true }, tx => sqlite.raw.fenceSession(tx, scope, session));

    const result = await fetch();
    const [item] = result.items;
    assert.equal(item.text, body.text);
    assert.deepEqual(item.provenance.sources, []);
    assert.deepEqual(item.provenance.receiptMetadata, []);
    assert.deepEqual(item.provenance.coverage, { status: "budget_exhausted", included: 0, omitted: 1 });
    assert.ok(!JSON.stringify(result).includes(excerpt));
    const assembled = await svc.readContext(readSet, search);
    assert.equal(assembled.assembly.items[0].body, body.text);
    assert.deepEqual(assembled.assembly.items[0].sources, []);
    assert.equal(assembled.assembly.items[0].date, undefined);
    assert.ok(!JSON.stringify(assembled).includes(excerpt));
    await assert.rejects(svc.fetchEvidence(readSet, { snapshot: before.snapshot }), { code: "snapshot_stale" });
  } finally {
    await sqlite.close();
  }
}
for (const contextRawRead of [false, true]) {
  test(`SQLite fences a retained excerpt in fetch and assembly (Raw search ${contextRawRead})`,
    t => checkFencedReceipt(t, contextRawRead));
}

test("SQLite uses admitted Raw ancestry to group a turn with its retained Memory", async t => {
  const file = scratch();
  t.after(file.remove);
  const sqlite = await openSqliteAdapter(file.path, allReadPorts);
  try {
    const body = "An albatross logged its heading.";
    const occurredAtMs = Date.UTC(2025, 0, 2, 3, 4, 50);
    const turn = { id: "admitted-turn", role: "user", content: body, occurredAtMs };
    const key = { scope, ...session, eventId: "admitted-event", payloadDigest: sha256(body) };
    const ref = await sqlite.uow.run(scope.owner, { pauseLock: true }, async tx => {
      assert.equal((await sqlite.capture.admit(tx, key, [turn])).status, "admitted");
      const claim = await sqlite.capture.claim(tx, key, [turn], { leaseMs: 10_000 });
      assert.equal(claim.status, "claimed");
      await sqlite.capture.beginDispatch(tx, claim.token);
      await sqlite.raw.recordLineage(tx, key, [turn]);
      assert.equal((await sqlite.raw.archive(tx, key, [turn])).archived, 1);
      const finished = await sqlite.capture.finish(tx, claim.token, [{
        content: body, kind: "fact", confidence: 0.8, embedding: null, textHash: row(body).textHash,
        receipts: [{ ...session, messageId: turn.id, role: "user", occurredAtMs: null, excerpt: body }],
      }]);
      const { id, revision } = finished.memories[0];
      return { type: "memory", scope, id, revision };
    });
    assert.equal(await sqlite.maintainContextRaw(readSet), true);
    const svc = service(sqlite);
    const { assembly, diagnostics, snapshot } = await svc.readContext(readSet, search);
    assert.equal(diagnostics.coverage.raw, "included");
    assert.equal(assembly.items.length, 1);
    const [item] = assembly.items;
    assert.equal(item.ref.id, ref.id);
    assert.equal(item.body, body);
    assert.deepEqual(item.sources, [{ index: 0, date: "2025-01-02T03:04Z", role: "user", sameAsBody: true }]);
    assert.equal(item.evidence.length, 1);
    assert.equal(item.evidence[0].ref.messageId, turn.id);
    assert.equal(item.evidence[0].sameAsBody, true);
    assert.deepEqual((await svc.fetchEvidence(readSet, { snapshot })).items.map(item => item.ref), [ref]);
  } finally {
    await sqlite.close();
  }
});

test("SQLite resumes bounded reconciliation from a durable unpublished checkpoint", async t => {
  const file = scratch();
  t.after(file.remove);
  const opened = await openSqliteAdapter(file.path, { capabilities: { contextRead: true } });
  try {
    await opened.uow.run(scope.owner, {}, async tx => {
      for (let i = 0; i < 1025; i++) await opened.memories.insert(tx, scope, row("albatross item " + i), [], 1);
    });
    const first = await opened.contextRead.prepareLexical(readSet, search, {});
    assert.equal(first.canonicalRows, 1024);
    assert.equal(first.transformed, 1024);
    const partial = await read(opened, tx => opened.contextRead.observeIndex(tx, readSet, search));
    assert.equal(partial.ready, false);
    assert.deepEqual(partial.maintenance.progress, { phase: 0, checkpoint: 1, sequence: 1, baseSequence: 0 });
  } finally {
    await opened.close();
  }
  const reopened = await openSqliteAdapter(file.path, { capabilities: { contextRead: true } });
  try {
    const ranked = await service(reopened).findCandidates(readSet, search);
    assert.deepEqual(ranked.coverage.maintenance.progress, { phase: 1, checkpoint: 2, sequence: 1, baseSequence: 0 });
    assert.equal(ranked.coverage.byType.memory.indexed, 1025);
    assert.equal(ranked.coverage.omitted.lexical, 1001);
    assert.equal(ranked.trace.maintenance.transformed, 1);
  } finally {
    await reopened.close();
  }
});
