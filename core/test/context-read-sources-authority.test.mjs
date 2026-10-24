import { sourceBudget, sourceReader, sourcePrivateBudget, SourceStop } from '../context-read-relations.mjs';
import { readTransaction } from '../database.mjs';
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
  const entityTables = ['memories', 'private_cards', 'mocs', 'card_mocs'];
  const authorizedIds = new Set(), foreignIds = new Set();
  for (const table of entityTables) for (const row of f.db.prepare(`SELECT id,owner_id,scope,project_id FROM ${table}`).all()) {
    (row.owner_id === ns.ownerId && row.scope === ns.scope && row.project_id === ns.projectId ? authorizedIds : foreignIds).add(row.id);
  }
  for (const row of f.db.prepare('SELECT id,memory_id FROM receipts').all())
    (authorizedIds.has(row.memory_id) ? authorizedIds : foreignIds).add(row.id);
  let iteratorRows = 0, identityRows = 0;
  const native = DatabaseSync.prototype.prepare;
  t.mock.method(DatabaseSync.prototype, 'prepare', function (sql) {
    const statement = native.call(this, sql);
    const inspect = value => {
      if (value === undefined) return;
      const serialized = JSON.stringify(value);
      assert.equal(serialized.includes('FOREIGN_UNIQUE'), false, 'foreign prose reached reader');
      for (const id of foreignIds) assert.equal(serialized.includes(id), false, 'foreign metadata identity reached reader');
      if (value && typeof value === 'object') {
        if (value.owner_id !== undefined) assert.equal(value.owner_id, ns.ownerId, 'returned namespace must be authorized');
        if (value.id && /FROM (?:memories|private_cards|mocs|card_mocs|receipts)\b/.test(sql)) {
          assert.ok(authorizedIds.has(value.id), 'returned entity identity must be authorized'); identityRows++;
        }
      }
    };
    for (const name of ['get', 'all']) {
      const original = statement[name]; statement[name] = function (...args) {
        for (const arg of args) inspect(arg);
        const result = original.apply(this, args);
        if (Array.isArray(result)) result.forEach(inspect); else inspect(result);
        return result;
      };
    }
    const iterate = statement.iterate;
    statement.iterate = function* (...args) {
      for (const arg of args) inspect(arg);
      for (const row of iterate.apply(this, args)) { inspect(row); iteratorRows++; yield row; }
    };
    return statement;
  });
  const after = stable(ok(await f.find({ types: ['memory', 'card'] }))); assert.deepEqual(after, before);
  const assembled = ok(await f.assemble({ types: ['memory', 'card'] })); assert.equal(JSON.stringify(assembled).includes('FOREIGN_UNIQUE'), false);
  assert.ok(iteratorRows > 0, 'charged support iterators observed'); assert.ok(identityRows > 0, 'authorized metadata identities observed');
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

test('C08 foreign existing endpoint IDs are rejected before public checks; private work and state bounds are enforced', t => {
  const f = sourcesFixture(t, { cards: true }), foreign = { ...ns, ownerId: 'foreign-existing-data' };
  const memory = f.admit('Foreign endpoint', foreign), card = f.card('Foreign Card', { namespace: foreign });
  const budget = sourceBudget(Infinity), reader = sourceReader(f.db, {}, { cards: true }, { readSet: [ns], types: ['memory', 'card'] }, budget);
  const before = JSON.stringify(budget.stats());
  readTransaction(f.db, () => {
    for (const ref of [{ type: 'memory', namespace: ns, memoryId: memory.id, revision: 1 }, { ...card, namespace: ns }])
      assert.equal(reader.endpoint(ref).reason, 'unavailable');
    assert.equal(reader.endpoints([{ type: 'memory', namespace: ns, memoryId: memory.id, revision: 1 }])[0].reason, 'unavailable');
  });
  assert.equal(JSON.stringify(budget.stats()), before);
  const privateBudget = sourcePrivateBudget(() => {});
  for (let i = 0; i < 50000; i++) privateBudget.charge('lookups');
  assert.throws(() => privateBudget.charge('lookups'), error => error instanceof SourceStop && error.reason === 'work_limit');
  assert.throws(() => sourcePrivateBudget(() => {}).hold(1024 * 1024), error => error instanceof SourceStop && error.reason === 'state_limit');
  assert.equal(JSON.stringify(budget.stats()), before, 'private failures expose no public counter');
});
