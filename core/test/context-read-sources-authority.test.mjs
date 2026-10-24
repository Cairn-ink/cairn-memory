import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { sourcesFixture, ns, ok, sourceQuery } from '../testing/context-read-sources-fixture.mjs';
import { denied } from '../testing/context-read-core-fixture.mjs';

function stable(value) {
  const clone = structuredClone(value); delete clone.nextCursor;
  delete clone.trace.timings; delete clone.trace.maintenance;
  return clone;
}
test('C08 foreign public relations/topics change no names, counters, work, scores or ranks; no foreign reads', async t => {
  const f = sourcesFixture(t, { cards: true }), seed = f.admit('needle direct'), endpoint = f.admit('Other endpoint'); await f.relate(endpoint, seed);
  f.topic(f.admit('Authorized member'), 'needle authorized topic');
  ok(await f.find({ types: ['memory', 'card'] })); const before = stable(ok(await f.find({ types: ['memory', 'card'] })));
  const foreign = { ...ns, ownerId: 'foreign-owner' };
  const foreignSeed = f.admit('FOREIGN_UNIQUE needle direct', foreign), foreignEndpoint = f.admit('FOREIGN_UNIQUE endpoint', foreign);
  await f.relate(foreignEndpoint, foreignSeed, 'supports-decision', foreign);
  f.topic(foreignSeed, 'FOREIGN_UNIQUE needle title', 'FOREIGN_UNIQUE root', foreign);
  const foreignCard = f.card('FOREIGN_UNIQUE card body', { namespace: foreign }); f.cardTopic(foreignCard, 'FOREIGN_UNIQUE needle cardtopic');
  const native = DatabaseSync.prototype.prepare;
  t.mock.method(DatabaseSync.prototype, 'prepare', function (sql) {
    const statement = native.call(this, sql);
    for (const name of ['get', 'all']) {
      const original = statement[name]; statement[name] = function (...args) {
        const result = original.apply(this, args);
        assert.equal(JSON.stringify(result)?.includes('FOREIGN_UNIQUE') ?? false, false, 'foreign data reached source/scoring/evidence reader'); return result;
      };
    }
    return statement;
  });
  const after = stable(ok(await f.find({ types: ['memory', 'card'] }))); assert.deepEqual(after, before);
  const assembled = ok(await f.assemble({ types: ['memory', 'card'] })); assert.equal(JSON.stringify(assembled).includes('FOREIGN_UNIQUE'), false);
});
for (const phase of ['query-await', 'before-transmission', 'search-await']) test(`C08 revocation at ${phase} refuses scope_changed`, async t => {
  let f, armed = false, calls = 0, queued = false, sourceRead = false;
  const embedder = { id: 'synthetic-revoke-' + phase, revision: '1', dimensions: 2, normalization: 'l2', async embed(texts, options) {
    calls++;
    assert.ok(texts.every(text => !text.includes('MOC_SECRET_TITLE')), 'MOC titles never enter embedding input');
    if (armed && phase !== 'search-await') {
      assert.deepEqual(texts, ['needle']); await Promise.resolve(); f.trusted.state.enabled = false;
      if (phase === 'before-transmission') options.beforeDispatch();
    }
    return texts.map(() => [1, 0]);
  } };
  f = sourcesFixture(t, { embedder, selectedPolicy: { family: 'local', maxRequests: 100, maxUsd: 1, estimateUsd: () => 0 } });
  f.topic(f.admit('needle canonical body'), 'MOC_SECRET_TITLE needle');
  ok(await f.call('refreshContextIndex', { readSet: [ns], types: ['memory'], intent: 'current', budget: { maxItems: 1024, maxMs: 5000 } }));
  const before = calls;
  if (phase === 'search-await') {
    const native = DatabaseSync.prototype.prepare;
    t.mock.method(DatabaseSync.prototype, 'prepare', function (sql) {
      if (/FROM moc_title_sources/.test(sql)) sourceRead = true;
      return native.call(this, sql);
    });
    f.trusted.state.hook = () => {
      if (sourceRead && !queued) { queued = true; queueMicrotask(() => { f.trusted.state.enabled = false; }); }
    };
  }
  armed = true;
  const result = phase === 'search-await' ? await f.assemble() : await f.find({ semantic: true });
  denied(result, 'scope_changed'); assert.equal(calls - before, phase === 'search-await' ? 0 : 1);
});
test('C08 every namespace is authorized before any source lookup and capture consent is insufficient', async t => {
  const f = sourcesFixture(t); f.admit('needle');
  let looked = false; const native = DatabaseSync.prototype.prepare;
  t.mock.method(DatabaseSync.prototype, 'prepare', function (sql) {
    if (/FROM (?:mocs|moc_title_sources|rationale_edges)/.test(sql)) looked = true;
    return native.call(this, sql);
  });
  denied(await f.context.findCandidates(sourceQuery(), {}), 'authority_required'); assert.equal(looked, false);
  f.trusted.state.allowed = [];
  denied(await f.find(), 'authority_required'); assert.equal(looked, false);
});
