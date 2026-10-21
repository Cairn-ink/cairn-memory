import assert from 'node:assert/strict';
import test from 'node:test';
import { openMemoryReader } from '../index.mjs';
import { topicOverviewFixture, overviewNamespace as namespace, unwrapOverview as ok,
  collectOverview } from '../testing/topic-overview-fixture.mjs';

test('public owner-bound reader returns exact deduplicated metadata without bodies or default refs', async t => {
  const f = topicOverviewFixture(t), reader = openMemoryReader({ path: f.path, ownerId: namespace.ownerId });
  f.workspace.defer(() => reader.close());
  const { items, totals, pages } = await collectOverview(reader, { namespace });
  assert.equal(totals.unique.total, 4); assert.equal(totals.unfiled.total, 1);
  assert.equal(totals.unique.byKind.fact, 2); assert.equal(totals.unique.byKind.decision, 1);
  const root = items.find(item => item.id === f.root.id);
  const a = items.find(item => item.id === f.topicA.id), b = items.find(item => item.id === f.topicB.id);
  assert.equal(root.directCounts.total, 0); assert.equal(root.descendantCounts.total, 3);
  assert.equal(root.descendantCounts.byKind.fact, 2);
  assert.equal(a.directCounts.total, 2); assert.deepEqual(a.directCounts, a.descendantCounts);
  assert.equal(b.descendantCounts.total, 2); assert.deepEqual(a.parentIds, [root.id]);
  assert.equal(items[0].level, 'L2');
  for (const item of items) {
    assert.equal(Object.hasOwn(item, 'memberRefs'), false);
    assert.equal(item.lastMemberAddedAt, null); assert.equal(item.addedAtCoverage, 'not_recorded');
    assert.match(item.latestMemberCreatedAt, /^\d{4}-/);
  }
  assert.equal(pages.at(-1).coverage.complete, true);
  assert.doesNotMatch(JSON.stringify(pages), /PRIVATE_BODY_SENTINEL/);
  const withRefs = await collectOverview(reader, { namespace, memberLimit: 2 });
  const refs = withRefs.items.find(item => item.id === root.id).memberRefs;
  assert.deepEqual(refs.map(ref => ref.memoryId), [f.a.id, f.b.id, f.c.id].sort().slice(0, 2));
});

test('bounded work returns unknown counts then exact pages with replay and stale refusal', async t => {
  const f = topicOverviewFixture(t), reader = openMemoryReader({ path: f.path, ownerId: namespace.ownerId });
  f.workspace.defer(() => reader.close());
  const input = { namespace, workLimit: 16, nodeLimit: 1 };
  const first = ok(await reader.readTopicOverview(input));
  assert.deepEqual(first.items, []); assert.equal(first.totals, null);
  assert.equal(first.coverage.countsComplete, false); assert.ok(first.nextCursor);
  const second = await reader.readTopicOverview({ ...input, cursor: first.nextCursor });
  assert.deepEqual(await reader.readTopicOverview({ ...input, cursor: first.nextCursor }), second);
  assert.deepEqual(await reader.readTopicOverview({ ...input, namespace: {
    projectId: null, scope: namespace.scope, ownerId: namespace.ownerId,
  }, cursor: first.nextCursor }), second, 'namespace key insertion order does not change cursor binding');
  const all = await collectOverview(reader, input);
  assert.equal(all.items.length, 3); assert.equal(all.totals.unique.total, 4);
  assert.equal((await reader.readTopicOverview({ ...input, cursor: first.nextCursor })).error.code, 'cursor_stale');
  const next = ok(await reader.readTopicOverview(input));
  f.admit('epoch-change');
  assert.equal((await reader.readTopicOverview({ ...input, cursor: next.nextCursor })).error.code, 'cursor_stale');
});

test('accessors, symbols, cross-owner requests, concurrent reads and close are safe', async t => {
  const f = topicOverviewFixture(t);
  let getters = 0;
  assert.throws(() => openMemoryReader({ get path() { getters++; return f.path; }, ownerId: namespace.ownerId }));
  assert.equal(getters, 0);
  const reader = openMemoryReader({ path: f.path, ownerId: namespace.ownerId });
  f.workspace.defer(() => reader.close());
  assert.equal((await reader.readTopicOverview({ namespace: { ...namespace, ownerId: 'foreign' } })).error.code, 'invalid_input');
  assert.equal((await reader.readTopicOverview({ namespace, [Symbol('unknown')]: true })).error.code, 'invalid_input');
  const inFlight = reader.readTopicOverview({ namespace });
  assert.equal((await reader.readTopicOverview({ namespace })).error.code, 'read_in_progress');
  assert.equal((await inFlight).ok, true);
  await reader.close();
  assert.equal((await reader.readTopicOverview({ namespace })).error.code, 'store_closed');
});

test('byte-limited exact pages fit the complete envelope and the last page replays', async t => {
  const f = topicOverviewFixture(t), reader = openMemoryReader({ path: f.path, ownerId: namespace.ownerId });
  f.workspace.defer(() => reader.close());
  for (let i = 0; i < 9; i++) {
    const memory = f.admit(`extra-${i}`);
    f.place([{ memoryId: memory.id, parentIds: [], newL1: { title: `Extra topic ${i}`, parentL2Ids: [] } }]);
  }
  const input = { namespace, maxBytes: 4096, memberLimit: 10 };
  let cursor, lastCursor, final, count = 0, byteLimited = false;
  do {
    lastCursor = cursor;
    const result = await reader.readTopicOverview({ ...input, ...(cursor ? { cursor } : {}) });
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= input.maxBytes);
    const page = ok(result); count += page.items.length;
    byteLimited ||= page.coverage.reason === 'byte_limit';
    cursor = page.nextCursor; final = result;
  } while (cursor);
  assert.equal(count, 12); assert.equal(byteLimited, true); assert.ok(lastCursor);
  assert.deepEqual(await reader.readTopicOverview({ ...input, cursor: lastCursor }), final);
  assert.equal((await reader.readTopicOverview({ ...input, nodeLimit: 1, cursor: lastCursor })).error.code, 'invalid_cursor');
});
