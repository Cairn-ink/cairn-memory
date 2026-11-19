import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { openMemoryCore } from '../index.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { transaction } from '../database.mjs';
import { safetyFixture, ns, ok } from '../testing/content-safety-s2h-fixture.mjs';
import { eventTimeSafetyFixture } from '../testing/receipt-event-time-fixture.mjs';

const source = eventId => ({ client: 'synthetic', sessionId: 'walk-count', eventId, role: 'user', excerpt: 'Synthetic ' + eventId });

function observeWalks(t) {
  const prepare = DatabaseSync.prototype.prepare, exec = DatabaseSync.prototype.exec;
  const active = new WeakMap(), turns = [];
  const sql = t.mock.method(DatabaseSync.prototype, 'prepare', function (text) {
    const statement = prepare.call(this, text), turn = active.get(this);
    const unionPage = text.includes('CROSS JOIN json_each(?) source CROSS JOIN receipts');
    if (!turn || !text.startsWith('SELECT id,revision,deleted,updated_at') && !unionPage) {
      return statement;
    }
    const all = statement.all.bind(statement);
    statement.all = (...args) => {
      if (unionPage) turn.unionPages++;
      else if (args.length === 5 && args[3] === 0) turn.walks++;
      return all(...args);
    };
    return statement;
  });
  const transactions = t.mock.method(DatabaseSync.prototype, 'exec', function (text) {
    const result = exec.call(this, text);
    if (text === 'BEGIN' || text === 'BEGIN IMMEDIATE') {
      const turn = { begin: text, walks: 0, unionPages: 0, end: null };
      turns.push(turn);
      active.set(this, turn);
    } else if (active.has(this) && (text === 'COMMIT' || text === 'ROLLBACK')) {
      active.get(this).end = text;
      active.delete(this);
    }
    return result;
  });
  return { turns, restore() { transactions.mock.restore(); sql.mock.restore(); } };
}

for (const layout of [48, 53]) test(`capture filter replays overflow with one writer receipt walk at layout ${layout}`, async t => {
  const fixture = (layout === 48 ? safetyFixture : eventTimeSafetyFixture)(t, 33);
  await fixture.migrate();
  const core = openMemoryCore({ path: fixture.path, model: { contextWindow: 8192, countTokens: () => 1,
    extract: async () => ({ items: [{ content: 'Synthetic capture result', kind: 'fact', confidence: .8, sourceIndices: [0, 1] }] }) } });
  const db = fixture.connect();
  const runtime = createMemoryRuntime({ path: fixture.path });
  t.after(() => { runtime.close(); core.close(); db.close(); });
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, layout);
  const seed = ok(core.admit({ namespace: ns, memory: { content: 'Synthetic seed', kind: 'fact' }, receipts: [source('seed')] })).memory;
  transaction(db, () => {
    const insert = db.prepare(`INSERT INTO memories(id,owner_id,scope,project_id,fingerprint,content,kind,origin,confidence,revision,deleted,created_at,updated_at)
      SELECT ?,owner_id,scope,project_id,?,?,'fact',origin,confidence,1,0,created_at,updated_at FROM memories WHERE id=?`);
    for (let index = 0; index < 128; index++) {
      const key = 'synthetic-neighbor-' + index;
      insert.run(key, key, 'Synthetic neighbor ' + index, seed.id);
    }
  });
  assert.equal(db.prepare('SELECT count(*) AS n FROM memories WHERE deleted=0').get().n, 129);
  const batch = [source('a'), source('b')];
  const clock = t.mock.method(performance, 'now', () => 0);
  const observed = observeWalks(t);
  try {
    assert.deepEqual(runtime.filterCaptureSources(ns, batch), [0, 1]);
    assert.deepEqual(observed.turns, [
      { begin: 'BEGIN', walks: 1, unionPages: 0, end: 'ROLLBACK' },
      { begin: 'BEGIN IMMEDIATE', walks: 1, unionPages: 2, end: 'COMMIT' },
    ]);
    observed.turns.length = 0;
    const capture = ok(await core.capture({ namespace: ns, client: batch[0].client, sessionId: batch[0].sessionId,
      eventId: 'whole-capture', messages: batch.map(({ eventId, role, excerpt }) => ({ id: eventId, role, content: excerpt })) }));
    assert.equal(capture.admission.memories.length, 1);
    assert.deepEqual(observed.turns.filter(turn => turn.unionPages), [
      { begin: 'BEGIN IMMEDIATE', walks: 1, unionPages: 2, end: 'COMMIT' },
    ]);
    observed.turns.length = 0;
    ok(core.admit({ namespace: ns, memory: { content: 'Synthetic manual admission', kind: 'fact' }, receipts: batch }));
    assert.deepEqual(observed.turns.filter(turn => turn.walks), [
      { begin: 'BEGIN IMMEDIATE', walks: 2, unionPages: 0, end: 'COMMIT' },
    ]);
  } finally { observed.restore(); clock.mock.restore(); }
});
