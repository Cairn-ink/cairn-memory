import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createMemoryService } from "@cairn-ink/core/service";
import { INITIALIZE_STORE, STORAGE_SCHEMA } from "../src/schema/layout.mjs";
import { readReceipts } from "../src/memory-rows.mjs";
import { openSqliteAdapter } from "../src/index.mjs";
import { editFixture } from "./legacy/fixtures.mjs";
import { captureFixture } from "./capture-fixtures.mjs";
import { scratch, seedFact, sha256, testAccess } from "./storage-fixtures.mjs";

const scope = { owner: "owner", namespace: null };
const key = (eventId, selection = scope) =>
  ({ scope: selection, client: "client", sessionId: "session", eventId, payloadDigest: "a".repeat(64) });
const batch = [{ id: "message", role: "user", content: "A quiet library has oak shelves.", occurredAtMs: 25 }];
const receipt = { client: "client", sessionId: "session", messageId: "message", role: "user", occurredAtMs: 25 };
const item = content => ({
  content, kind: "fact", confidence: 0.4, textHash: "sha256:" + sha256(content), embedding: null, receipts: [receipt],
});
const write = (adapter, key, work) => adapter.uow.run(key.scope.owner, { pauseLock: true }, work);
const claim = (adapter, key, messages = batch, leaseMs = 100) =>
  write(adapter, key, tx => adapter.capture.claim(tx, key, messages, { leaseMs }));
const admit = (adapter, key, messages = batch) => write(adapter, key, tx => adapter.capture.admit(tx, key, messages));
const finish = (adapter, key, token, items) => write(adapter, key, tx => adapter.capture.finish(tx, token, items));
const status = (adapter, { scope, eventId, client }) =>
  adapter.uow.run(scope.owner, { readOnly: true }, tx => adapter.capture.status(tx, scope, eventId, client));

async function opened(t) {
  const fixture = await captureFixture();
  t.after(fixture.close);
  return fixture;
}

function durableRows(fixture) {
  return testAccess(fixture, scope, {}, db =>
    ["cairn_capture_claims", "cairn_capture_outbox", "cairn_capture_abandoned_tokens",
      "cairn_index_revisions", "cairn_memories", "cairn_receipts"]
      .map(table => db.prepare(`SELECT * FROM ${table}`).all()));
}

test("namespaces share one capture identity and retain the original work scope", async t => {
  const fixture = await opened(t);
  let { adapter } = fixture;
  // Core namespaces can contain a NUL-delimited tuple.
  const first = key("same-event", { ...scope, namespace: "project\0notes" });
  const second = { ...first, scope: { ...scope, namespace: "project\0other" } };
  const third = { ...first, client: "another-client" };
  assert.deepEqual(await admit(adapter, first), { status: "admitted" });
  assert.deepEqual(await admit(adapter, second, []), { status: "duplicate" });
  const load = selection => adapter.uow.run(scope.owner, { readOnly: true }, tx => adapter.capture.load(tx, selection));
  assert.deepEqual(await load(first), { key: first, messages: batch });
  assert.equal(await load(second), null);

  const [a, b, c] = await Promise.all([claim(adapter, first, []), claim(adapter, second, []), claim(adapter, third)]);
  assert.deepEqual([a.status, b.status].sort(), ["claimed", "processing"]);
  const original = a.token ?? b.token;
  assert.equal(c.status, "claimed");
  assert.notEqual(c.token, original);
  await write(adapter, first, tx => adapter.capture.assertEligible(tx, first, [0]));
  assert.deepEqual(await admit(adapter, second), { status: "processing" });
  await assert.rejects(claim(adapter, { ...second, payloadDigest: "b".repeat(64) }), { code: "event_payload_conflict" });
  await assert.rejects(admit(adapter, { ...second, sessionId: "other-session" }), { code: "event_payload_conflict" });

  fixture.advanceClock(100);
  adapter = await fixture.reopen();
  const replacement = await claim(adapter, second);
  assert.equal(replacement.status, "claimed");
  assert.notEqual(replacement.token, original);
  await assert.rejects(finish(adapter, first, original, []), { code: "stale_admission" });
  assert.deepEqual(await claim(adapter, first), { status: "processing" });
  assert.deepEqual(await status(adapter, first), { status: "pending" });
  assert.deepEqual(await status(adapter, second), { status: "unknown" });
  const result = await finish(adapter, second, replacement.token, [item("Original namespace memory")]);
  assert.deepEqual(await status(adapter, first), { status: "done" });
  assert.deepEqual(await status(adapter, second), { status: "unknown" });
  const exportPage = selection => adapter.uow.run(scope.owner, { readOnly: true }, tx =>
    adapter.memories.exportPage(tx, selection.scope, { cursor: null, limit: 10 }));
  assert.deepEqual((await exportPage(first)).items.map(({ id }) => id), [result.memories[0].id]);
  assert.deepEqual((await exportPage(second)).items, []);
  adapter = await fixture.reopen();
  assert.deepEqual(await load(first), { key: first, messages: batch });
  assert.equal(await load(second), null);
  const replay = await claim(adapter, second);
  assert.deepEqual(replay, { status: "rawReplay", result });
  replay.result.memories[0].id = "changed";
  replay.result.memories.length = 0;
  replay.result.indexRevision = 999;
  assert.deepEqual(await claim(adapter, first), { status: "rawReplay", result });
  assert.deepEqual(await admit(adapter, second), { status: "rawReplay", result });
});

test("a standalone lease shares terminal abandonment and rechecks sources in its original namespace", async t => {
  const { adapter } = await opened(t);
  const first = key("standalone");
  const second = key(first.eventId, { ...scope, namespace: "another" });
  const a = await claim(adapter, first);
  const b = await claim(adapter, second, [...batch, { ...batch[0], id: "second" }]);
  assert.equal(a.status, "claimed");
  assert.deepEqual(b, { status: "processing" });
  await write(adapter, first, tx => adapter.capture.assertEligible(tx, first, [0]));
  await assert.rejects(write(adapter, first, tx => adapter.capture.assertEligible(tx, first, [1])), { code: "invalid_input" });
  for (const input of [second, { ...second, payloadDigest: "b".repeat(64) }]) {
    await assert.rejects(write(adapter, input, tx => adapter.capture.assertEligible(tx, input, [0])), { code: "stale_admission" });
  }
  await write(adapter, first, tx => adapter.capture.abandon(tx, a.token, { code: "invalid_input", retryable: false }));
  assert.deepEqual(await admit(adapter, first), { status: "duplicate" });
  assert.deepEqual(await admit(adapter, second), { status: "duplicate" });
  assert.deepEqual(await claim(adapter, second), { status: "duplicate" });
  await assert.rejects(admit(adapter, { ...second, payloadDigest: "b".repeat(64) }), { code: "event_payload_conflict" });
  await assert.rejects(finish(adapter, first, a.token, []), { code: "stale_admission" });
  assert.deepEqual(await status(adapter, first), { status: "unknown" });
  assert.deepEqual(await status(adapter, second), { status: "unknown" });
});

test("clientless status uses the first terminal failure in the selected namespace", async t => {
  const { adapter } = await opened(t);
  const first = { ...key("same-event"), client: "z-client" };
  const second = { ...first, client: "a-client" };
  const other = { ...first, client: "pending-client", scope: { ...scope, namespace: "other" } };
  await admit(adapter, first);
  await admit(adapter, second);
  await admit(adapter, other);
  for (const [input, code] of [[second, "storage_error"], [first, "invalid_input"]]) {
    const { token } = await claim(adapter, input);
    await write(adapter, input, tx => adapter.capture.abandon(tx, token, { code, retryable: false }));
  }
  assert.deepEqual(await status(adapter, { ...first, client: undefined }), { status: "failed", code: "invalid_input" });
  assert.deepEqual(await status(adapter, second), { status: "failed", code: "storage_error" });
  assert.deepEqual(await status(adapter, { ...other, client: undefined }), { status: "pending" });
});

test("another owner cannot use a lease or see a replay for the same event", async t => {
  const { adapter } = await opened(t);
  const a = key("shared-event");
  const b = key(a.eventId, { ...scope, owner: "owner\0suffix" });
  const left = await claim(adapter, a);
  const right = await claim(adapter, b);
  assert.equal(right.status, "claimed");
  assert.notEqual(left.token, right.token);
  for (const action of [
    tx => adapter.capture.beginDispatch(tx, left.token),
    tx => adapter.capture.abandon(tx, left.token, { code: "invalid_input", retryable: false }),
    tx => adapter.capture.finish(tx, left.token, []),
  ]) await assert.rejects(write(adapter, b, action), { code: "stale_admission" });
  const aResult = await finish(adapter, a, left.token, [item("Same text")]);
  assert.deepEqual(await claim(adapter, b), { status: "processing" });
  const bResult = await finish(adapter, b, right.token, [item("Same text")]);
  assert.equal(aResult.indexRevision, 1);
  assert.equal(bResult.indexRevision, 1);
  assert.notEqual(aResult.memories[0].id, bResult.memories[0].id);
  assert.deepEqual(await claim(adapter, a), { status: "rawReplay", result: aResult });
  assert.deepEqual(await claim(adapter, b), { status: "rawReplay", result: bResult });
});

test("capture uses the transaction owner throughout a scoped operation", async t => {
  const { adapter } = await opened(t);
  const foreign = key("foreign-event", { ...scope, owner: "other-owner" });
  await admit(adapter, foreign);
  const { token } = await claim(adapter, foreign);
  const foreignResult = await finish(adapter, foreign, token, [item("Other owner's memory")]);

  function unstableScope() {
    let reads = 0;
    return { namespace: null, get owner() { return ++reads === 1 ? scope.owner : foreign.scope.owner; } };
  }
  const attempt = () => ({ ...foreign, scope: unstableScope() });
  assert.equal(await adapter.uow.run(scope.owner, { readOnly: true }, tx => adapter.capture.load(tx, attempt())), null);
  const statusScope = unstableScope();
  assert.deepEqual(await adapter.uow.run(scope.owner, { readOnly: true }, tx =>
    adapter.capture.status(tx, statusScope, foreign.eventId)), { status: "unknown" });
  const ownClaim = await write(adapter, key("own"), tx => adapter.capture.claim(tx, attempt(), batch, { leaseMs: 100 }));
  assert.equal(ownClaim.status, "claimed");
  assert.deepEqual(await claim(adapter, foreign), { status: "rawReplay", result: foreignResult });
});

test("finish during pause rolls back even when caught and leaves the outbox untouched", async t => {
  const fixture = await opened(t);
  const { adapter } = fixture;
  const event = key("paused");
  await admit(adapter, event);
  const { token } = await claim(adapter, event);
  await write(adapter, event, tx => adapter.pause.set(tx, scope.owner, true));
  const before = await durableRows(fixture);
  await assert.rejects(write(adapter, event, async tx => {
    await assert.rejects(adapter.capture.finish(tx, token, [item("No paused write")]), { code: "capture_paused" });
  }), { code: "capture_paused" });
  await assert.rejects(admit(adapter, key("while-paused")), { code: "capture_paused" });
  assert.deepEqual(await durableRows(fixture), before);
  assert.deepEqual(await status(adapter, event), { status: "pending" });
  await write(adapter, event, tx => adapter.pause.set(tx, scope.owner, false));
  assert.equal((await finish(adapter, event, token, [item("After resume")])).indexRevision, 1);
});

test("a failing outbox write rolls back memory, receipts, lease and index revision", async t => {
  const fixture = await opened(t);
  const { adapter } = fixture;
  const event = key("outbox-failure");
  await admit(adapter, event);
  const { token } = await claim(adapter, event);
  const before = await durableRows(fixture);
  await testAccess(fixture, scope, { write: true }, db => db.exec(`
    CREATE TRIGGER reject_finish BEFORE UPDATE OF result ON cairn_capture_outbox
      BEGIN SELECT RAISE(ABORT, 'outbox failure'); END;`));
  await assert.rejects(finish(adapter, event, token, [item("Rolled back with its receipt")]), { code: "internal_error" });
  assert.deepEqual(await durableRows(fixture), before);
  assert.deepEqual(await claim(adapter, event), { status: "processing" });
  await testAccess(fixture, scope, { write: true }, db => db.exec("DROP TRIGGER reject_finish"));
  const result = await finish(adapter, event, token, [item("Retried with its receipt")]);
  assert.equal(result.indexRevision, 1);
  assert.deepEqual(await testAccess(fixture, scope, {}, db => readReceipts(db, scope, result.memories[0].id)), [receipt]);
});

test("all finishes in one write report the committed owner revision on replay", async t => {
  const fixture = await opened(t);
  let { adapter } = fixture;
  const emptyKey = key("empty");
  const writtenKey = key("written");
  const { token: empty } = await claim(adapter, emptyKey);
  const { token: written } = await claim(adapter, writtenKey);
  const [first, replay, second] = await write(adapter, emptyKey, async tx => {
    const first = Object.freeze(await adapter.capture.finish(tx, empty, []));
    const replay = await adapter.capture.claim(tx, emptyKey, batch, { leaseMs: 100 });
    const second = await adapter.capture.finish(tx, written, [item("New memory")]);
    const { content: text, receipts, ...row } = item("Separate store write");
    await adapter.memories.insert(tx, scope, { ...row, text, origin: "explicit",
      source: { kind: "mcp", client: null, sessionId: null } }, receipts, 1000);
    return [first, replay, second];
  });
  assert.equal(first.indexRevision, 2);
  assert.deepEqual(replay, { status: "rawReplay", result: first });
  assert.equal(second.indexRevision, 2);
  adapter = await fixture.reopen();
  assert.deepEqual(await claim(adapter, emptyKey), { status: "rawReplay", result: first });
  assert.deepEqual(await claim(adapter, writtenKey), { status: "rawReplay", result: second });
});

test("finish suppresses hidden duplicates, erased text and a newly blocked session", async t => {
  const fixture = await opened(t);
  const { adapter } = fixture;
  const hidden = item("Hidden memory");
  const forgotten = item("Forgotten memory");
  const prior = key("prior");
  const { token } = await claim(adapter, prior);
  const { memories: [a, b] } = await finish(adapter, prior, token, [hidden, forgotten]);
  const retry = key("retry-withheld");
  const pending = await claim(adapter, retry);
  await seedFact(adapter, { ...scope, actionId: "hide", origin: "forget", kind: "identity", memoryId: a.id });
  await write(adapter, retry, async tx => {
    const fact = { ...scope, actionId: "erase", origin: "forget", kind: "text", mode: "exact",
      text: { digests: [{ alg: "sha256", value: forgotten.textHash.slice(7), pipeline: "core", keyId: null, redactionVersion: 1 }] } };
    await adapter.suppressions.writeFact(tx, fact, "c".repeat(64));
    assert.equal(await adapter.memories.erase(tx, scope, b.id), true);
  });
  const result = await finish(adapter, retry, pending.token, [hidden, forgotten]);
  assert.equal(result.suppressedCount, 2);
  assert.deepEqual(result.memories, []);
  const late = key("late-session-fact");
  const sessionClaim = await claim(adapter, late);
  await seedFact(adapter, { ...scope, actionId: "block-session", origin: "forget", kind: "session",
    session: { client: late.client, sessionKeyHash: adapter.hashSessionKey(scope, late.client, late.sessionId) } });
  const denied = await finish(adapter, late, sessionClaim.token, [item("This session is blocked")]);
  assert.equal(denied.suppressedCount, 1);
  assert.deepEqual(denied.memories, []);
  const visible = await adapter.uow.run(scope.owner, { readOnly: true }, tx =>
    adapter.memories.exportPage(tx, scope, { cursor: null, limit: 10 }));
  assert.deepEqual(visible.items, []);
  const [, , , , rows] = await durableRows(fixture);
  assert.equal(rows.length, 2);
  assert.equal(rows.find(({ id }) => id === a.id).revision, a.revision);
  assert.equal(rows.find(({ id }) => id === b.id).body, null);
});

test("the core runner prepares, extracts and embeds outside the SQLite transaction", async t => {
  const { adapter } = await opened(t);
  const event = key("runner");
  const checkOutside = () => adapter.uow.run(scope.owner, { readOnly: true }, async () => {});
  let calls = 0;
  let embeddings = 0;
  const unused = () => { throw new Error("unexpected retrieval call"); };
  const service = createMemoryService({
    storage: { ...adapter, snapshot: { stateToken: unused, assertUnchanged: unused },
      fence: { assertVisible: unused }, recent: { recent: unused } },
    model: { model: "test", contextWindow: 16_384, countTokens: () => 1,
      async call(stage) {
        assert.equal(stage, "extract");
        await checkOutside();
        calls++;
        return { items: [{ content: batch[0].content, kind: "fact", confidence: 0.9, sourceIndices: [0] }] };
      } },
    embedder: { model: "test", dimensions: 2, async embed() {
      await checkOutside();
      embeddings++;
      return [new Float32Array([1, 0])];
    } },
    gate: { async assertOpen() { await checkOutside(); } },
    clock: { nowMs: () => 1_000, monotonicMs: () => 1_000,
      async sha256Hex(text) { await checkOutside(); return sha256(text); }, hmacHex: unused },
    tokens: { countTokens: () => 1 },
    config: {},
  });
  assert.deepEqual(await service.enqueueCapture(scope, { client: event.client, sessionId: event.sessionId,
    eventId: event.eventId, messages: batch }), { status: "accepted" });
  const selection = { client: event.client, sessionId: event.sessionId, eventId: event.eventId };
  const done = await service.runCapture(scope, selection);
  assert.equal(done.status, "done");
  assert.equal(done.result.memories.length, 1);
  assert.deepEqual(await service.runCapture(scope, selection), done);
  assert.deepEqual([calls, embeddings], [1, 1]);
});

test("preflight refuses a version-one store without changing its bytes", async t => {
  const { path, remove } = scratch();
  t.after(remove);
  editFixture(path, db => db.exec(STORAGE_SCHEMA + INITIALIZE_STORE + `
    DROP TABLE cairn_capture_abandoned_tokens;
    DROP TABLE cairn_capture_outbox;
    DROP TABLE cairn_capture_claims;
    DROP TABLE cairn_index_revisions;
    PRAGMA user_version = 1;`));
  const before = readFileSync(path);
  await assert.rejects(openSqliteAdapter(path), { code: "storage_error" });
  assert.deepEqual(readFileSync(path), before);
});
