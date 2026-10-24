import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryReader } from '../index.mjs';
import { topicOverviewFixture, overviewNamespace as namespace, unwrapOverview as ok,
  collectOverview } from '../testing/topic-overview-fixture.mjs';

function setup(t) {
  const f = topicOverviewFixture(t), reader = openMemoryReader({ path: f.path, ownerId: namespace.ownerId });
  f.workspace.defer(() => reader.close());
  const db = new DatabaseSync(f.path); f.workspace.defer(() => db.close());
  return { ...f, reader, db };
}
test('forgotten, awaiting and stale revisions never contribute counts or expose source titles', async t => {
  const f = setup(t);
  const current = ok(f.core.get({ namespace, memoryId: f.a.id })).memory;
  ok(f.core.forget({ namespace, memoryId: f.a.id, expectedRevision: current.revision }));
  f.db.prepare("UPDATE memories SET review_state='awaiting' WHERE id=?").run(f.b.id);
  let result = await collectOverview(f.reader, { namespace });
  assert.equal(result.totals.unique.total, 2);
  assert.equal(result.items.find(item => item.id === f.root.id).descendantCounts.total, 1);
  for (const item of result.items) assert.equal(item.title, null);
  f.db.prepare('UPDATE memories SET revision=revision+1 WHERE id=?').run(f.c.id);
  result = await collectOverview(f.reader, { namespace });
  assert.equal(result.totals.unfiled.total, 2);
  for (const item of result.items) {
    assert.equal(item.descendantCounts.total, 0); assert.equal(item.latestMemberCreatedAt, null);
  }
});

test('foreign original title binding suppresses the title and foreign refs do not count', async t => {
  const f = setup(t);
  const foreign = f.admit('foreign', 'fact', { ...namespace, ownerId: 'another-owner' });
  f.db.prepare('INSERT INTO moc_title_sources(moc_id,memory_id,memory_revision) VALUES(?,?,?)')
    .run(f.topicA.id, foreign.id, foreign.revision);
  const revision = f.db.prepare('SELECT revision FROM mocs WHERE id=?').get(f.topicA.id).revision;
  f.db.prepare('INSERT INTO moc_memory_refs(moc_id,moc_revision,memory_id,memory_revision) VALUES(?,?,?,?)')
    .run(f.topicA.id, revision, foreign.id, foreign.revision);
  const result = await collectOverview(f.reader, { namespace });
  assert.equal(result.totals.unique.total, 4);
  assert.equal(result.items.find(item => item.id === f.topicA.id).title, null);
  assert.equal(result.items.find(item => item.id === f.topicA.id).descendantCounts.total, 2);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(foreign.id));
});

test('staged and published index authority differs from live raw declarations', async t => {
  const f = setup(t);
  const revision = f.db.prepare('SELECT epoch FROM namespace_epochs WHERE owner_id=?').get(namespace.ownerId).epoch;
  let rebuilt = ok(f.core.rebuildIndex({ namespace, expectedIndexRevision: revision, limit: 1 }));
  assert.equal(rebuilt.exhausted, false);
  assert.equal((await f.reader.readTopicOverview({ namespace })).error.code, 'index_unavailable');
  while (!rebuilt.exhausted) rebuilt = ok(f.core.rebuildIndex({ namespace, expectedIndexRevision: revision,
    limit: 1, cursor: rebuilt.nextCursor }));
  let result = await collectOverview(f.reader, { namespace });
  assert.equal(result.totals.unique.total, 4);
  const generation = result.pages[0].snapshot.generation;
  assert.equal(typeof generation, 'string');
  f.db.prepare('DELETE FROM index_memories WHERE generation=? AND id=?').run(generation, f.a.id);
  result = await collectOverview(f.reader, { namespace });
  assert.equal(result.totals.unique.total, 3);
  assert.equal(result.items.find(item => item.id === f.topicA.id).title, null);
  assert.equal(result.items.find(item => item.id === f.root.id).title, null);
  assert.equal(result.items.find(item => item.id === f.root.id).descendantCounts.total, 2);
});

test('empty namespaces have exact zero totals while no existing namespace leaks into them', async t => {
  const f = setup(t);
  const result = await collectOverview(f.reader, { namespace: { ...namespace, scope: 'project', projectId: 'empty' } });
  assert.deepEqual(result.items, []);
  assert.equal(result.totals.unique.total, 0); assert.equal(result.totals.unfiled.total, 0);
  assert.equal(result.pages[0].coverage.complete, true);
});

test('public supersession excludes historical members and their bound titles', async t => {
  const f = setup(t);
  const previous = ok(f.core.get({ namespace, memoryId: f.a.id })).memory;
  ok(f.core.supersede({ namespace, memoryId: f.a.id, expectedRevision: previous.revision,
    replacement: { content: 'PRIVATE_BODY_SENTINEL synthetic replacement', kind: 'fact' },
    receipts: [{ client: 'synthetic-overview', sessionId: 'fixture', eventId: 'replacement',
      role: 'user', excerpt: 'Explicit synthetic replacement.' }] }));
  const result = await collectOverview(f.reader, { namespace, memberLimit: 10 });
  assert.equal(result.totals.unique.total, 4); assert.equal(result.totals.unfiled.total, 2);
  assert.equal(result.items.find(item => item.id === f.root.id).descendantCounts.total, 2);
  assert.equal(result.items.find(item => item.id === f.root.id).title, null);
  assert.equal(result.items.some(item => item.memberRefs.some(ref => ref.memoryId === f.a.id)), false);
});

for (const variant of ['missing', 'foreign', 'unpublished']) {
  test(`declared ${variant} generation returns unavailable instead of exact zero`, async t => {
    const f = setup(t), generation = `synthetic-${variant}`;
    if (variant !== 'missing') {
      f.db.prepare(`INSERT INTO index_generations(id,owner_id,scope,project_id,captured_epoch,
        page_limit,phase,last_key,sequence,published) VALUES(?,?,'personal','',1,16,5,'null',1,?)`)
        .run(generation, variant === 'foreign' ? 'foreign-owner' : namespace.ownerId, variant === 'unpublished' ? 0 : 1);
    }
    f.db.prepare(`INSERT INTO namespace_index_state(owner_id,scope,project_id,active_generation)
      VALUES(?,'personal','',?)`).run(namespace.ownerId, generation);
    assert.deepEqual(await f.reader.readTopicOverview({ namespace }), { ok: false, error: { code: 'index_unavailable' } });
  });
}
