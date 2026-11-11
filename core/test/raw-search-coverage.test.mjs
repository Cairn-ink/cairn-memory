import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { join } from 'node:path';
import { openMemoryCore } from '../index.mjs';
import { defaultRawOptions } from '../local-defaults.mjs';
import { sourceFixture, savedSource, ns, ok, request, splitRaw } from '../testing/raw-source-fixtures.mjs';
import { searchFixture } from '../testing/raw-search-fixtures.mjs';
import { installRawSearchTestClock, rawSearchTestWait } from '../testing/raw-search-clock.mjs';
import { rawSessionKeys } from '../raw-source-roots.mjs';
import { readRawChannel, assembleThreeLayerContext } from '../context-read-three-layer.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

test.beforeEach(installRawSearchTestClock);
const incomplete = result => {
  assert.equal(result.coverage.status, 'partial');
  assert.ok(result.coverage.causes.includes('index_incomplete'));
  assert.equal(result.coverage.scanned, null);
  assert.equal(result.coverage.expanded, null);
};
async function finish(s, query = 'cedar canal') {
  for (let i = 0; i < 12; i++) {
    await s.tick({ maxMs: 5000 });
    const result = await s.search({ query });
    if (result.coverage.status === 'complete') return result;
  }
  assert.fail('stable synthetic inventory did not complete within twelve quanta');
}
function seedConversation(f, id, sessionId) {
  const secret = f.db.prepare('SELECT secret FROM episode_identity WHERE singleton=1').get().secret;
  const session = rawSessionKeys(ns, 'codex', sessionId, secret)[1];
  f.db.prepare('INSERT INTO raw_conversations VALUES(?,?,?,?,?,?,1,?,?)')
    .run(id, ns.ownerId, ns.scope, ns.projectId ?? '', 'codex', session, 'synthetic', 'synthetic');
}
async function prefixFixture(t) {
  const f = sourceFixture(t);
  seedConversation(f, 'a-prefix', 'prefix');
  seedConversation(f, 'z-target', 'target');
  for (let i = 0; i < 4; i++) ok(await f.core.captureRaw(request(
    splitRaw('cedar canal prefix ' + i, { id: 'prefix-' + i, ordinal: i + 1 })[0],
    { client: 'codex', sessionId: 'prefix', eventId: 'prefix-' + i })));
  const target = await savedSource(f, 'copper telescope target', { sessionId: 'target', eventId: 'target' });
  assert.equal(target.conversationId, 'z-target');
  const s = await searchFixture(f);
  await s.maintain({ maxMs: 5000 });
  assert.equal(s.indexCount(), 4);
  return { f, s, target };
}

test('public cold search never concludes a saved matching message is absent', async t => {
  // Explicit maintenance owns progress; elapsed wall time cannot run a timer
  // between opening the reader and observing its cold index.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const workspace = createTestWorkspace(t, { prefix: 'raw-coverage-' }), path = join(workspace.path, 'store.sqlite');
  const writer = openMemoryCore({ path, rawSearch: false, rawConversations: { ...defaultRawOptions(), interpretation: 'host' } });
  try { ok(await writer.captureRaw(request(splitRaw('cedar canal sentinel')[0]))); }
  finally { await writer.close(); }
  const core = openMemoryCore({ path, raw: true });
  workspace.defer(() => core.close());
  const cold = ok(await core.searchRaw({ namespace: ns, query: 'cedar canal', semantic: false }));
  incomplete(cold);
  let result;
  for (let i = 0; i < 12; i++) {
    await rawSearchTestWait(1010);
    ok(await core.maintainRawSearch({ namespace: ns }));
    result = ok(await core.searchRaw({ namespace: ns, query: 'cedar canal', semantic: false }));
    if (result.coverage.status === 'complete') break;
  }
  assert.equal(result.coverage.status, 'complete');
  assert.equal(result.candidates.length, 1);
});

test('an indexed prefix cannot certify a later deterministic conversation', async t => {
  const { s } = await prefixFixture(t);
  const result = await s.search({ query: 'copper telescope' });
  assert.equal(result.candidates.length, 0);
  incomplete(result);
  assert.equal((await finish(s, 'copper telescope')).candidates.length, 1);
});

for (const sameConversation of [true, false]) test(`capture invalidates completed coverage: same conversation ${sameConversation}`, async t => {
  const f = sourceFixture(t);
  await savedSource(f, 'cedar canal sentinel', { sessionId: 'first' });
  const s = await searchFixture(f);
  assert.equal((await finish(s)).candidates.length, 1);
  ok(await f.core.captureRaw(request(splitRaw('unrelated appended text', { id: 'appended', ordinal: sameConversation ? 2 : 1 })[0],
    { client: 'codex', sessionId: sameConversation ? 'first' : 'other', eventId: 'appended' })));
  // Observe only search, after the capture. A fence rebuild would enumerate
  // canonical tables; the cached version proof uses just two constant probes.
  const statements = [], prepare = DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare = function(sql) { statements.push(sql); return prepare.call(this, sql); };
  let result;
  try { result = await s.search({ query: 'cedar canal' }); }
  finally { DatabaseSync.prototype.prepare = prepare; }
  incomplete(result);
  assert.equal(result.candidates.length, 1, 'validated hits survive incomplete inventory');
  assert.ok(statements.length > 0, 'the observer must see native search statements');
  assert.ok(!statements.some(sql => /json_group_array|raw_search_sealed_digest|coalesce\(max\(rowid\)/.test(sql)), 'search must not build an inventory fence');
  assert.ok((await finish(s)).candidates.length >= 1);
});

test('three-layer assembly retains validated prefix evidence with incomplete index coverage', async t => {
  const { s } = await prefixFixture(t);
  const rawSearch = { search: input => s.search(input), prepare: candidate => s.prepare(candidate),
    revalidate: handles => s.service.revalidate(handles) };
  const query = 'cedar canal', raw = await readRawChannel(rawSearch, { query, readSet: [ns] }, {}, performance.now() + 1000);
  assert.equal(raw.coverage, 'partial');
  assert.equal(raw.items.length, 4);
  const result = assembleThreeLayerContext({ prepared: [], counter: { id: 'synthetic-bytes', countTokens: text => Buffer.byteLength(text) },
    policy: { id: 'rank-first-whole-v1' }, budget: { maxTokens: 6000, maxItems: 24 }, query, readSet: [ns],
    representation: 'representation-v2-dated', deadlineAt: Infinity, snapshotOf: items => JSON.stringify(items.map(item => item.ref)) }, raw);
  assert.equal(result.diagnostics.coverage.raw, 'partial');
  assert.equal(result.metered.items.filter(item => item.layer === 'Raw').length, 4);
  assert.ok(result.metered.items.every(item => item.body.includes('cedar canal prefix')));
  assert.equal(result.validateRaw(), true);
});

test('a canonical change in the final authority callback invalidates completed coverage', async t => {
  const f = sourceFixture(t);
  await savedSource(f, 'cedar canal sentinel');
  let tracking = false, callbacks = 0, changed = false;
  const s = await searchFixture(f, { setupHost(host) {
    const current = host.authority.isCurrent;
    host.authority.isCurrent = grant => {
      if (tracking && ++callbacks === 4) { changed = true; f.db.prepare('UPDATE raw_conversations SET revision=revision+1').run(); }
      return current(grant);
    };
  } });
  await finish(s);
  // The fourth freshness callback follows authorization and the payload read.
  tracking = true;
  const result = await s.search({ query: 'cedar canal' });
  assert.equal(changed, true);
  incomplete(result);
  assert.equal(result.candidates.length, 1);
});
