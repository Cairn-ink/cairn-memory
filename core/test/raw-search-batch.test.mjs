import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { installRawSearchTestClock } from '../testing/raw-search-clock.mjs';
import { sourceFixture, savedSource } from '../testing/raw-source-fixtures.mjs';
import { searchFixture } from '../testing/raw-search-fixtures.mjs';

test.beforeEach(installRawSearchTestClock);
async function fixture(t, texts = ['telescope alpha', 'telescope beta', 'telescope gamma']) {
  const f = sourceFixture(t), sources = [];
  for (const [index, text] of texts.entries()) sources.push(await savedSource(f, text, { sessionId: 'batch-' + index }));
  const originalOpen = f.port.openRaw; let opener = originalOpen;
  f.port.openRaw = input => opener(input);
  let authorizations = 0;
  const s = await searchFixture(f, { setupHost(host) {
    const authorize = host.authority.authorize;
    host.authority.authorize = (request, token) => { if (request.method === 'rawSearchSource') authorizations++; return authorize(request, token); };
  } });
  await s.maintain({ maxItems: 128, maxMs: 5000 });
  let coverage;
  for (let index = 0; index < 64; index++) {
    const result = await s.search({ query: 'telescope' });
    coverage = result.coverage;
    if (result.coverage.status === 'complete') return { f, s, sources, candidates: result.candidates, authorizations: () => authorizations, setOpen(work) { opener = input => work(input, originalOpen); } };
    await s.tick({ maxItems: 128, maxMs: 5000 });
  }
  assert.fail('synthetic batch index must be ready: ' + JSON.stringify({ coverage, status: await s.service.status() }));
}
const prepare = (s, candidates, settings = {}) => s.service.prepareMany(candidates, settings, s.host.token);

test('batch uses one canonical read snapshot and one authorization, opening outside the snapshot', async t => {
  const { s, candidates, authorizations, setOpen } = await fixture(t);
  assert.equal(candidates.length, 3);
  const exec = DatabaseSync.prototype.exec, active = new Set(); let snapshots = 0, opening = false;
  DatabaseSync.prototype.exec = function(sql) {
    if (sql === 'BEGIN' && new Error().stack.includes('prepareBatch')) { snapshots++; active.add(this); }
    assert.equal(opening, false, 'crypto callbacks must not retain a canonical read transaction');
    const result = exec.call(this, sql);
    if (sql === 'COMMIT' || sql === 'ROLLBACK') active.delete(this);
    return result;
  };
  t.after(() => { DatabaseSync.prototype.exec = exec; });
  setOpen(async (input, open) => {
    assert.equal(active.size, 0, 'the batch snapshot is released before opening text');
    opening = true; try { await new Promise(resolve => setImmediate(resolve)); return await open(input); } finally { opening = false; }
  });
  const progress = [], result = await prepare(s, candidates, { onPrepared: (handle, index) => progress.push([handle, index]) });
  assert.equal(result.complete, true); assert.equal(snapshots, 1); assert.equal(authorizations(), 1);
  assert.deepEqual(progress.map(([handle]) => handle), result.handles);
  assert.deepEqual(progress.map(([, index]) => index), [0, 1, 2]);
  assert.deepEqual(s.service.revalidate(result.handles).map(value => value.messageId), candidates.map(candidate => candidate.messageId));
  for (const [index, handle] of result.handles.entries()) assert.equal(handle.value.conversationId, candidates[index].conversationId);
});

for (const failure of ['identity', 'foreign-owner', 'foreign-namespace', 'missing-source', 'open-failure']) test(`batch retains independent outcomes after ${failure}`, async t => {
  const { f, s, candidates, setOpen } = await fixture(t), bad = candidates[1];
  const selected = [...candidates];
  if (failure === 'identity') selected[1] = { ...bad, messageId: 'forged-turn' };
  else if (failure === 'foreign-owner') selected[1] = { ...bad, namespace: { ...bad.namespace, ownerId: 'foreign-owner' } };
  else if (failure === 'foreign-namespace') selected[1] = { ...bad, namespace: { ...bad.namespace, scope: 'project', projectId: 'foreign-project' } };
  else if (failure === 'missing-source') f.db.prepare('DELETE FROM raw_parts WHERE conversation_id=? AND message_id=?').run(bad.conversationId, bad.messageId);
  else {
    setOpen((input, open) => { if (input.context.conversationId === bad.conversationId) throw Error('synthetic opener failed'); return open(input); });
  }
  const result = await prepare(s, selected);
  assert.equal(result.complete, true); assert.ok(result.handles[0]); assert.equal(result.handles[1], null); assert.ok(result.handles[2]);
  assert.equal(s.service.revalidate(result.handles.filter(Boolean)).length, 2);
});

test('a turn over the preparation byte budget skips only that candidate', async t => {
  const { s, candidates } = await fixture(t, ['telescope alpha', 'telescope ' + 'x'.repeat(270000), 'telescope gamma']);
  const bad = candidates.findIndex(candidate => candidate.ranges.length > 64); assert.ok(bad >= 0);
  const result = await prepare(s, candidates);
  assert.equal(result.complete, true); assert.equal(result.handles[bad], null);
  assert.equal(result.handles.filter(Boolean).length, candidates.length - 1);
});

test('native batch cutoff preserves completed handles and permits the next operation', async t => {
  const { s, candidates, setOpen } = await fixture(t);
  let now = 100, opens = 0;
  const own = Object.getOwnPropertyDescriptor(performance, 'now');
  Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
  t.after(() => Object.defineProperty(performance, 'now', own));
  setOpen(async (input, open) => { if (++opens === 2) now = 500; return open(input); });
  const progress = [], result = await prepare(s, candidates, { deadlineAt: 500, onPrepared: handle => progress.push(handle) });
  assert.equal(result.complete, false); assert.equal(result.handles.length, 1); assert.deepEqual(progress, result.handles);
  assert.equal(opens, 2);
  assert.equal((await prepare(s, candidates)).handles.filter(Boolean).length, 3);
});
