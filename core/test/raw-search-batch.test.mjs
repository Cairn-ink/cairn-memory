import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { installRawSearchTestClock } from '../testing/raw-search-clock.mjs';
import { sourceFixture, savedSource, ns, ok } from '../testing/raw-source-fixtures.mjs';
import { searchFixture, safetySourceFixture } from '../testing/raw-search-fixtures.mjs';
import { readRawChannel } from '../context-read-three-layer.mjs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { openRawSearch } from '../raw-search-index.mjs';

test.beforeEach(installRawSearchTestClock);
async function fixture(t, texts = ['telescope alpha', 'telescope beta', 'telescope gamma'], safety = false, candidateChecking = false) {
  const f = safety ? safetySourceFixture(t, { model: { extract: ({ input }) => ({ items: input.messages.map(message => ({
    content: 'Synthetic telescope source fact.', kind: 'fact', confidence: 1, sourceIndices: [message.index],
  })) }) } }) : sourceFixture(t), sources = [];
  for (const [index, text] of texts.entries()) sources.push(await savedSource(f, text, { sessionId: 'batch-' + index }));
  const originalOpen = f.port.openRaw; let opener = originalOpen;
  f.port.openRaw = input => opener(input);
  let authorizations = 0, denied = false;
  const s = await searchFixture(f, { setupHost(host) {
    const authorize = host.authority.authorize;
    host.denyPreparation = () => { denied = true; host.revoke(); };
    host.authority.authorize = (request, token) => {
      if (request.method === 'rawSearchSource') {
        authorizations++;
        if (denied) return null;
        if (candidateChecking && (!request.input.candidate ||
            !sources.some(source => source.conversationId === request.input.candidate.conversationId && source.messageId === request.input.candidate.messageId) ||
            JSON.stringify(Object.keys(request.input).sort()) !== JSON.stringify(['candidate', 'intent']))) return null;
      }
      return authorize(request, token);
    };
  } });
  await s.maintain({ maxItems: 128, maxMs: 5000 });
  let coverage;
  for (let index = 0; index < 64; index++) {
    const result = await s.search({ query: 'telescope' });
    coverage = result.coverage;
    if (result.coverage.status === 'complete' && s.indexCount() === f.db.prepare('SELECT count(*) n FROM raw_parts WHERE saved=1').get().n) return { f, s, sources, candidates: result.candidates, authorizations: () => authorizations, setOpen(work) { opener = input => work(input, originalOpen); } };
    await s.tick({ maxItems: 128, maxMs: 5000 });
  }
  assert.fail('synthetic batch index must be ready: ' + JSON.stringify({ coverage, status: await s.service.status() }));
}
const prepare = (s, candidates, settings = {}) => s.service.prepareMany(candidates, settings, s.host.token);

function invalidate(f, s, source, mutation) {
  if (mutation === 'forgotten') {
    const memory = f.db.prepare('SELECT id,revision FROM memories WHERE deleted=0').get();
    assert.ok(memory, 'fixture must retain a linked Memory before forgetting');
    ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
  } else if (mutation === 'suppressed') transaction(f.db, () => writeContentSuppressionInside(f.db,
    { namespace: ns, kind: 'raw', key: source.conversationId, matchMode: 'span', messageId: source.messageId,
      start: 0, end: source.text.length, reason: 'purge', actionId: 'synthetic-batch-suppression' }));
  else if (mutation === 'excluded') f.db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,?)')
    .run(source.conversationId, source.messageId, 0, source.text.length, 1);
  else s.host.denyPreparation();
}

for (const mode of ['batch', 'single']) for (const mutation of ['forgotten', 'suppressed', 'excluded', 'denied']) {
  for (const gap of ['before-snapshot', 'snapshot-release', 'part-open', 'registration']) test(`native ${mode} blocks ${mutation} at ${gap}`, async t => {
    const { f, s, sources: [source], candidates, setOpen } = await fixture(t, ['telescope ' + 'alpha '.repeat(800)], true);
    const exec = DatabaseSync.prototype.exec;
    let changed = false, invalidated = false, mutationError, opens = 0, released = false;
    const mutate = () => {
      assert.equal(changed, false); changed = true;
      try { invalidate(f, s, source, mutation); invalidated = true; }
      catch (error) { mutationError = error; throw error; }
    };
    DatabaseSync.prototype.exec = function(sql) {
      const stack = new Error().stack;
      if (gap === 'registration' && !changed && sql === 'BEGIN' && stack.includes('revalidateInside')) mutate();
      const result = exec.call(this, sql);
      if (sql === 'COMMIT' && (mode === 'batch' ? stack.includes('prepareBatch') : stack.includes('raw-source-reader.mjs'))) {
        assert.equal(this.isTransaction, false); released = true;
        if (gap === 'snapshot-release' && !changed) mutate();
      }
      return result;
    };
    t.after(() => { DatabaseSync.prototype.exec = exec; });
    setOpen((input, open) => {
      assert.equal(released, true, 'mutation hook and crypto run after snapshot release');
      opens++;
      if (gap === 'part-open' && !changed) mutate();
      return open(input);
    });
    if (gap === 'before-snapshot') mutate();
    const progress = [];
    const result = mode === 'batch' ? await prepare(s, candidates, { onPrepared: handle => progress.push(handle) })
      .catch(error => { throw mutationError ?? error; }) : {
        handles: [await s.prepare(candidates[0]).catch(error => { if (mutationError) throw mutationError; return null; })], complete: true,
      };
    if (mode === 'single') progress.push(...result.handles);
    assert.equal(changed, true); assert.ifError(mutationError); assert.equal(invalidated, true); assert.equal(result.complete, true);
    assert.deepEqual(result.handles, candidates.map(() => null));
    assert.deepEqual(progress, result.handles);
    assert.equal(JSON.stringify(result).includes('alpha'), false);
    if (['before-snapshot', 'snapshot-release'].includes(gap)) assert.equal(opens, 0, 'live guard refuses before the first crypto callback');
    if (gap === 'part-open') assert.equal(opens, 1, 'the post-part guard prevents the next callback');
    if (gap === 'registration') assert.ok(opens > 0, 'registration revalidation refuses already-opened text');
  });
}

test('batch and existing single preparation APIs preserve identical source projections', async t => {
  const { s, candidates: [candidate] } = await fixture(t, ['telescope ' + 'alpha '.repeat(800)]);
  const single = await s.prepare(candidate), batch = await prepare(s, [candidate]);
  assert.deepEqual(batch.handles[0].value, single.value);
  for (const range of single.value.ranges) {
    const source = await s.service.prepareSource(range.source, {}, s.host.token);
    assert.deepEqual(source.value.ranges, [range]);
    assert.deepEqual(source.validate(), source.value);
  }
  assert.deepEqual(single.validate(), single.value);
  assert.deepEqual(s.service.revalidate(batch.handles), [single.value]);
});

test('batch shares one initial source snapshot with candidate authorizations, opening outside transactions', async t => {
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
  assert.equal(result.complete, true); assert.equal(snapshots, 1); assert.equal(authorizations(), candidates.length);
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


test('candidate-checking host authorizers accept both single and batch preparation', async t => {
  const { s, candidates } = await fixture(t, undefined, false, true);
  const singles = await Promise.all(candidates.map(candidate => s.prepare(candidate)));
  const batch = await prepare(s, candidates);
  assert.equal(batch.complete, true);
  assert.deepEqual(batch.handles.map(handle => handle?.value), singles.map(handle => handle.value));
});

test('one batch preserves candidates from two live search proofs in input order', async t => {
  const { s, candidates } = await fixture(t);
  const second = await s.search({ query: 'telescope' });
  const selected = [second.candidates[1], candidates[0], second.candidates[2]];
  assert.notEqual(selected[0].proof, selected[1].proof);
  const singles = [];
  for (const candidate of selected) singles.push(await s.prepare(candidate));
  const progress = [], batch = await prepare(s, selected, { onPrepared: (handle, index) => progress.push([handle, index]) });
  assert.equal(batch.complete, true);
  assert.deepEqual(batch.handles.map(handle => handle?.value), singles.map(handle => handle.value));
  assert.deepEqual(progress.map(([, index]) => index), [0, 1, 2]);
});

test('shared-reader validation requires live opaque handles and the exact host and store', async t => {
  const { f, s, candidates } = await fixture(t, ['telescope shared validation']);
  const handle = await s.prepare(candidates[0]);
  const sibling = await openRawSearch(s.options);
  t.after(() => sibling.close());
  assert.deepEqual(sibling.revalidate([handle]), [handle.value]);
  assert.throws(() => sibling.revalidate([handle.ticket]), { code: 'raw_search_unavailable' });
  assert.throws(() => sibling.revalidate([{ ...handle }]), { code: 'raw_search_unavailable' });
  const otherHost = await openRawSearch({ ...s.options, authority: { ...s.options.authority } });
  t.after(() => otherHost.close());
  assert.throws(() => otherHost.revalidate([handle]), { code: 'raw_search_unavailable' });
  const otherStore = await searchFixture(sourceFixture(t), { authority: s.options.authority });
  assert.throws(() => otherStore.service.revalidate([handle]), { code: 'raw_search_unavailable' });
  for (const namespace of [{ ...ns, scope: 'project', projectId: 'other-project' }, { ...ns, ownerId: 'other-owner' }]) {
    const otherScope = await openRawSearch({ ...s.options, directory: f.workspace.path,
      ownerId: namespace.ownerId, readSet: [namespace] });
    t.after(() => otherScope.close());
    assert.throws(() => otherScope.revalidate([handle]), { code: 'raw_search_unavailable' });
  }
  await s.service.close();
  assert.throws(() => sibling.revalidate([handle]), { code: 'raw_search_unavailable' });
});

test('known oversized sources cannot spend deliverable candidates Raw cutoff', async t => {
  const { s, candidates } = await fixture(t, ['telescope deliverable', 'telescope ' + 'x'.repeat(524288)]);
  const small = candidates.find(candidate => candidate.ranges.length === 1);
  const large = candidates.find(candidate => candidate.ranges.length >= 129);
  assert.ok(small); assert.ok(large, 'all oversized parts must be indexed before the cost injection');
  const selected = [small, large], original = DatabaseSync.prototype.prepare;
  const own = Object.getOwnPropertyDescriptor(performance, 'now'); let now = 100, inspected = 0;
  Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
  DatabaseSync.prototype.prepare = function(sql) {
    if (sql.startsWith('SELECT 1 FROM raw_session_fences') && new Error().stack.includes('inspectInside')) {
      now += 5; inspected++;
    }
    return original.call(this, sql);
  };
  t.after(() => { DatabaseSync.prototype.prepare = original; Object.defineProperty(performance, 'now', own); });
  const errors = [];
  const port = { search: async () => ({ candidates: selected, coverage: { status: 'complete' } }),
    prepare: async candidate => { try { return await s.prepare(candidate); } catch (error) { errors.push({ code: error.code, now }); throw error; } }, prepareMany: (values, settings) => prepare(s, values, settings),
    revalidate: handles => s.service.revalidate(handles) };
  const input = { query: 'telescope', readSet: [ns] };
  const { prepareMany, ...serial } = port;
  const base = await readRawChannel(serial, input, {}, now + 1000), baseInspections = inspected;
  now = 100; inspected = 0;
  const batch = await readRawChannel(port, input, {}, now + 1000);
  assert.equal(base.items.length, 1, JSON.stringify({ errors, baseInspections, inspected, now, baseCoverage: base.coverage }));
  assert.ok(batch.items.length >= base.items.length, JSON.stringify({ base: base.items.length, batch: batch.items.length, baseInspections, inspected }));
  assert.deepEqual(batch.items.map(item => item.value), base.items.map(item => item.value));
});

test('a failed under-cap turn stops spending independent candidates Raw cutoff', async t => {
  const { f, s, candidates } = await fixture(t, ['telescope deliverable', 'telescope ' + 'x'.repeat(256000)]);
  const small = candidates.find(candidate => candidate.ranges.length === 1);
  const bad = candidates.find(candidate => candidate.ranges.length === 65);
  assert.ok(small); assert.ok(bad);
  assert.equal(f.db.prepare('SELECT total_bytes FROM raw_messages WHERE conversation_id=? AND message_id=?')
    .get(bad.conversationId, bad.messageId).total_bytes, 256010);
  f.db.prepare('DELETE FROM raw_parts WHERE conversation_id=? AND message_id=? AND part_index=0')
    .run(bad.conversationId, bad.messageId);
  const selected = [small, bad], original = DatabaseSync.prototype.prepare;
  const own = Object.getOwnPropertyDescriptor(performance, 'now'); let now = 100, inspected = 0;
  Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
  DatabaseSync.prototype.prepare = function(sql) {
    if (sql.startsWith('SELECT 1 FROM raw_session_fences') && new Error().stack.includes('inspectInside')) {
      now += 8; inspected++;
    }
    return original.call(this, sql);
  };
  t.after(() => { DatabaseSync.prototype.prepare = original; Object.defineProperty(performance, 'now', own); });
  const port = { search: async () => ({ candidates: selected, coverage: { status: 'complete' } }),
    prepare: candidate => s.prepare(candidate), prepareMany: (values, settings) => prepare(s, values, settings),
    revalidate: handles => s.service.revalidate(handles) };
  const { prepareMany, ...serial } = port, input = { query: 'telescope', readSet: [ns] };
  const base = await readRawChannel(serial, input, {}, now + 1000), baseInspections = inspected;
  now = 100; inspected = 0;
  const batch = await readRawChannel(port, input, {}, now + 1000);
  t.diagnostic(JSON.stringify({ base: base.items.length, batch: batch.items.length, baseInspections, inspected }));
  assert.equal(base.items.length, 1); assert.equal(base.coverage, 'partial');
  assert.ok(batch.items.length >= base.items.length);
  assert.deepEqual(batch.items.map(item => item.value), base.items.map(item => item.value));
  assert.equal(batch.coverage, 'partial');
});
