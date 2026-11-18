import test from 'node:test';
import assert from 'node:assert/strict';
import { installedContentLayout } from '../content-safety-schema.mjs';
import { openMemoryCore } from '../index.mjs';
import { createRawLineageStorage } from '../raw-lineage-storage.mjs';
import { eventTimeFixture, ok } from '../testing/receipt-event-time-fixture.mjs';

const ns = { ownerId: 'synthetic-owner', scope: 'project', projectId: 'synthetic-project' };
const source = id => ({
  client: 'claude-code', sessionId: 'session-' + id, eventId: 'event-' + id,
  role: 'user', excerpt: 'Synthetic excerpt ' + id,
});
const accepted = (allowed, excluded) => ({ allowed, excluded, code: null, index: null });

test('union fault fallback excludes forgotten receipts without Raw lineage', async t => {
  const f = await eventTimeFixture(t, 33);
  const core = openMemoryCore({ path: f.path, raw: true });
  f.workspace.defer(() => core.close());
  const db = f.connect();
  f.workspace.defer(() => db.close());

  const noRawForgot = source('no-raw-forgot');
  const clean = source('clean');
  const admitted = ok(core.admit({
    namespace: ns, memory: { content: 'Synthetic forgotten fact', kind: 'fact' }, receipts: [noRawForgot],
  })).memory;
  ok(core.forget({ namespace: ns, memoryId: admitted.id, expectedRevision: admitted.revision }));
  ok(core.admit({
    namespace: ns, memory: { content: 'Synthetic 1', kind: 'fact' }, receipts: [clean],
  }));

  installedContentLayout(db);
  const storage = createRawLineageStorage(db);
  const prepare = db.prepare.bind(db);
  const unionError = Object.assign(Error('Synthetic union failure'), { code: 'ERR_SQLITE_ERROR' });
  let baseWalks = 0;
  let injected = false;
  db.prepare = sql => {
    const statement = prepare(sql);
    const all = statement.all.bind(statement);
    statement.all = (...args) => {
      if (sql.startsWith('SELECT id,revision,deleted,updated_at') && args.length === 5 && args[3] === 0) {
        baseWalks++;
      }
      if (!injected && sql.includes("event_id IN (SELECT json_extract(value,'$[2]')")) {
        injected = true;
        throw unionError;
      }
      return all(...args);
    };
    return statement;
  };

  try {
    db.exec('BEGIN IMMEDIATE');
    const batch = [noRawForgot, clean, noRawForgot];
    const allowed = storage.filter(ns, batch);
    const excluded = batch.map((_, index) => index).filter(index => !allowed.includes(index));
    assert.deepEqual(accepted(allowed, excluded), accepted([1], [0, 2]), 'exact fallback applies the same denial tokens');
    assert.equal(baseWalks, 4, 'union followed by the three exact validations');
  } finally {
    db.prepare = prepare;
    if (db.isTransaction) db.exec('ROLLBACK');
  }
});
