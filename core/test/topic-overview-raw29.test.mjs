import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openMemoryReader } from '../index.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { topicOverviewFixture, overviewNamespace } from '../testing/topic-overview-fixture.mjs';
import { rawOverviewFixture, installOverviewLayout, fileBytes, collectOverview, namespace, ok } from '../testing/topic-overview-raw29-fixture.mjs';

for (const version of [18, 20, 21, 22, 23]) test(`R29 legacy physical schema ${version} remains readable without migration`, async t => {
  const f = topicOverviewFixture(t); f.core.close();
  const tables = installOverviewLayout(f.path, version);
  assert.equal(tables.includes('card_notes'), version >= 20);
  assert.equal(tables.includes('card_memory_bindings'), version >= 21);
  assert.equal(tables.includes('card_applicability_reviews'), version >= 22);
  assert.equal(tables.includes('card_mocs'), version >= 23);
  assert.equal(tables.includes('raw_conversations'), false);
  const before = fileBytes(f.path), reader = openMemoryReader({ path: f.path, ownerId: overviewNamespace.ownerId });
  f.workspace.defer(() => reader.close());
  const result = await collectOverview(reader, { namespace: overviewNamespace });
  assert.equal(result.totals.unique.total, 4); assert.equal(result.items.length, 3);
  await reader.close(); assert.deepEqual(fileBytes(f.path), before);
});

for (const version of [24, 25, 26, 27, 28]) test(`R29 actual physical schema ${version} is not implicitly accepted`, async t => {
  const ws = createTestWorkspace(t, { prefix: 'overview-unsupported-layout-' }), path = join(ws.path, 'memory.sqlite');
  const tables = installOverviewLayout(path, version);
  assert.ok(tables.includes('raw_conversations')); assert.equal(tables.includes('raw_capture_events'), version >= 25);
  assert.equal(tables.includes('raw_source_maps'), version >= 26); assert.equal(tables.includes('raw_deletion_actions'), version >= 27);
  assert.equal(tables.includes('card_raw_bindings'), version >= 28); assert.equal(tables.includes('local_capture_controls'), false);
  const before = fileBytes(path), reader = openMemoryReader({ path, ownerId: namespace.ownerId }); ws.defer(() => reader.close());
  assert.deepEqual(await reader.readTopicOverview({ namespace }), { ok: false, error: { code: 'unsupported_database' } });
  await reader.close(); assert.deepEqual(fileBytes(path), before);
});
test('R29 unknown future schema refuses unchanged', async t => {
  const f = rawOverviewFixture(t); f.db.exec('PRAGMA user_version=99');
  const before = fileBytes(f.path), reader = f.reader();
  assert.equal((await reader.readTopicOverview({ namespace })).error.code, 'unsupported_database');
  await reader.close(); assert.deepEqual(fileBytes(f.path), before);
});
for (const [label, sql] of [['required index', 'DROP INDEX index_moc_keyset'], ['store identity', 'DELETE FROM store_metadata']]) {
  test(`R29 malformed consumed ${label} refuses unchanged without Raw attestation`, async t => {
    const f = rawOverviewFixture(t); await f.capture('a'); f.db.exec(sql);
    const before = fileBytes(f.path), reader = f.reader();
    assert.equal((await reader.readTopicOverview({ namespace })).error.code, 'unsupported_database');
    await reader.close(); assert.deepEqual(fileBytes(f.path), before);
  });
}
for (const client of ['claude-code', 'codex']) test(`R29 ${client}: public capture/receipt lineage supplies exact hand-counted Memory hierarchy`, async t => {
  const f = rawOverviewFixture(t, { client }), h = await f.hierarchy(); f.authoredSentinel();
  const calls = f.state.calls, reader = f.reader(), result = await collectOverview(reader, { namespace, memberLimit: 10 });
  assert.equal(result.totals.unique.total, 4); assert.equal(result.totals.unfiled.total, 1);
  assert.equal(result.totals.unique.byKind.fact, 2); assert.equal(result.totals.unique.byKind.decision, 1);
  const root = result.items.find(item => item.id === h.root.id), a = result.items.find(item => item.id === h.topicA.id);
  const b = result.items.find(item => item.id === h.topicB.id);
  assert.deepEqual(result.items.map(item => item.level), ['L2', 'L1', 'L1']);
  assert.deepEqual(result.items.slice(1).map(item => item.id), [h.topicA.id, h.topicB.id].sort());
  assert.equal(root.directCounts.total, 0); assert.equal(root.descendantCounts.total, 3);
  assert.equal(a.directCounts.total, 2); assert.equal(b.directCounts.total, 2); assert.equal(a.title, 'Raw topic A');
  assert.deepEqual(root.memberRefs, [h.a.id, h.b.id, h.c.id].sort().map(id => ({ memoryId: id, revision: f.memory(id).revision })));
  assert.doesNotMatch(JSON.stringify(result), /MEMORY_BODY_SENTINEL|RAW_BODY_SENTINEL|RECEIPT_BODY_SENTINEL|CARD_BODY_SENTINEL/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM receipts').get().n, 4);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_receipt_lineage').get().n, 4);
  assert.equal(f.state.calls, calls, 'metadata reads dispatch no model work');
});
test('R29 correction and then forget invalidate continuation and stale title bindings', async t => {
  const f = rawOverviewFixture(t), h = await f.hierarchy(), reader = f.reader(), input = { namespace, workLimit: 16 };
  const cursor = ok(await reader.readTopicOverview(input)).nextCursor; assert.ok(cursor);
  const corrected = ok(f.core.correct({ namespace, memoryId: h.a.id, expectedRevision: f.memory(h.a.id).revision,
    content: 'Explicit synthetic correction.', kind: 'fact', receipt: { client: 'manual', sessionId: 'correction', eventId: 'correction', role: 'user', excerpt: 'Synthetic correction source.' } })).memory;
  assert.equal((await reader.readTopicOverview({ ...input, cursor })).error.code, 'cursor_stale');
  let current = await collectOverview(reader, { namespace });
  assert.equal(current.totals.unique.total, 4); assert.equal(current.items.find(item => item.id === h.topicA.id).title, null);
  ok(f.core.forget({ namespace, memoryId: corrected.id, expectedRevision: corrected.revision }));
  current = await collectOverview(reader, { namespace }); assert.equal(current.totals.unique.total, 3);
  assert.ok(f.db.prepare('SELECT count(*) n FROM raw_source_exclusions').get().n > 0);
});
for (const client of ['claude-code', 'codex']) test(`R29 ${client}: real source deletion preserves independently supported Memory but invalidates refs`, async t => {
  const f = rawOverviewFixture(t, { client, matching: true }), a = await f.capture('a', 'first'), b = await f.capture('a', 'second');
  assert.equal(a.id, b.id); assert.notEqual(a.conversationId, b.conversationId);
  const topic = f.place([{ memoryId: a.id, parentIds: [], newL1: { title: 'Supported topic', parentL2Ids: [], newL2Title: 'Supported root' } }])
    .createdMocs.find(moc => moc.level === 'L1');
  const reader = f.reader(), input = { namespace, nodeLimit: 1, workLimit: 16 }, first = ok(await reader.readTopicOverview(input));
  assert.ok(first.nextCursor); assert.equal((await collectOverview(reader, { namespace })).totals.unique.total, 1);
  const cursor = ok(await reader.readTopicOverview(input)).nextCursor;
  const deleted = await f.remove(a.conversationId); assert.equal(deleted.retainedMemories, 1);
  assert.equal((await reader.readTopicOverview({ ...input, cursor })).error.code, 'cursor_stale');
  const after = await collectOverview(reader, { namespace, memberLimit: 10 });
  assert.equal(after.totals.unique.total, 1); assert.equal(after.totals.unfiled.total, 1);
  assert.equal(after.items.find(item => item.id === topic.id).title, null);
  assert.equal(ok(f.core.get({ namespace, memoryId: a.id })).receipts.length, 1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_parts WHERE conversation_id=?').get(a.conversationId).n, 0);
  assert.equal(ok(await f.core.getConversation({ namespace, conversationId: b.conversationId })).messages.length, 1);
  const calls = f.state.calls; await f.remove(b.conversationId, 'delete-last-source');
  assert.equal((await collectOverview(reader, { namespace })).totals.unique.total, 0); assert.equal(f.state.calls, calls);
});
test('R29 staging refuses until published generation and stale projected membership is excluded', async t => {
  const f = rawOverviewFixture(t), h = await f.hierarchy(), reader = f.reader();
  const epoch = f.db.prepare('SELECT epoch FROM namespace_epochs WHERE owner_id=?').get(namespace.ownerId).epoch;
  let result = ok(f.core.rebuildIndex({ namespace, expectedIndexRevision: epoch, limit: 1 })); assert.equal(result.exhausted, false);
  assert.equal((await reader.readTopicOverview({ namespace })).error.code, 'index_unavailable');
  while (!result.exhausted) result = ok(f.core.rebuildIndex({ namespace, expectedIndexRevision: epoch, limit: 1, cursor: result.nextCursor }));
  const published = await collectOverview(reader, { namespace }); assert.equal(published.totals.unique.total, 4);
  const generation = published.pages[0].snapshot.generation; assert.equal(typeof generation, 'string');
  f.db.prepare('DELETE FROM index_memories WHERE generation=? AND id=?').run(generation, h.a.id);
  const projected = await collectOverview(reader, { namespace }); assert.equal(projected.totals.unique.total, 3);
  assert.equal(projected.items.find(item => item.id === h.topicA.id).title, null);
});
test('R29 cold native and reader WAL reads change only read marks; warm all-file hashes remain exact', async t => {
  for (const mode of ['native', 'reader']) {
    const f = rawOverviewFixture(t); f.db.exec('PRAGMA journal_mode=WAL'); await f.hierarchy();
    const before = fileBytes(f.path), initialShm = readFileSync(f.path + '-shm'); assert.ok(before['-wal']); assert.ok(before['-shm']);
    if (mode === 'native') {
      const db = new DatabaseSync(f.path, { readOnly: true });
      try { db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF'); db.prepare('SELECT id FROM memories').all(); }
      finally { db.close(); }
    } else {
      const reader = f.reader(); assert.equal((await collectOverview(reader, { namespace })).totals.unique.total, 4); await reader.close();
    }
    const cold = fileBytes(f.path), coldShm = readFileSync(f.path + '-shm');
    assert.equal(cold[''], before[''], mode + ' main database'); assert.equal(cold['-wal'], before['-wal'], mode + ' WAL');
    assert.equal(coldShm.length, initialShm.length);
    const offsets = [...initialShm.keys()].filter(index => initialShm[index] !== coldShm[index]);
    assert.ok(offsets.every(index => index >= 100 && index < 120), 'only SQLite WAL read marks may differ: ' + offsets.join(','));
    const warm = f.reader(); assert.equal((await collectOverview(warm, { namespace })).totals.unique.total, 4); await warm.close();
    assert.deepEqual(fileBytes(f.path), cold, mode + ' warmed whole-file equality');
    t.diagnostic(JSON.stringify({ mode, changedShmOffsets: offsets, databaseAndWalUnchanged: true, warmedAllFilesUnchanged: true }));
  }
});
test('R29 reader permits a reserved writer, refuses exclusive contention and leaves actual capture responsive', async t => {
  const f = rawOverviewFixture(t); await f.hierarchy(); const reader = f.reader();
  f.db.exec('BEGIN IMMEDIATE');
  try { assert.equal((await reader.readTopicOverview({ namespace })).ok, true); } finally { f.db.exec('ROLLBACK'); }
  f.db.exec('BEGIN EXCLUSIVE'); const start = performance.now();
  try { assert.equal((await reader.readTopicOverview({ namespace })).error.code, 'storage_busy'); } finally { f.db.exec('ROLLBACK'); }
  assert.ok(performance.now() - start < 1000);
  const pending = reader.readTopicOverview({ namespace, workLimit: 16 }); await f.capture('later');
  const observed = await pending; assert.ok(observed.ok || observed.error.code === 'cursor_stale');
  assert.equal((await collectOverview(reader, { namespace })).totals.unique.total, 5);
});
test('R29 missing reader path is never created', async t => {
  const f = rawOverviewFixture(t), missing = join(f.workspace.path, 'not-created.sqlite'), reader = f.reader(missing);
  assert.equal((await reader.readTopicOverview({ namespace })).error.code, 'database_not_found'); assert.equal(existsSync(missing), false);
});
