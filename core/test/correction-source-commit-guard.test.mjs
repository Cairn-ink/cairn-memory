import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../index.mjs';
import { receiptDenialTokens } from '../raw-source-roots.mjs';
import { commitPhaseGate } from '../runtime.mjs';
import { ns, ok, safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';

const source = { client: 'synthetic', sessionId: 'synthetic-session', eventId: 'synthetic-message',
  role: 'user', excerpt: 'Synthetic evidence.' };
const error = code => ({ ok: false, error: { code, retryable: false } });

async function fixture(t) {
  const f = safetyFixture(t, 33);
  await f.migrate();
  const core = openMemoryCore({ path: f.path }), db = f.connect();
  f.workspace.defer(() => { core.close(); db.close(); });
  const admit = content => ok(core.admit({ namespace: ns, memory: { content, kind: 'fact' }, receipts: [source] })).memory;
  const original = admit('Synthetic initial finding');
  const correct = receipt => core.correct({ namespace: ns, memoryId: original.id, expectedRevision: original.revision,
    content: 'Synthetic updated finding', kind: 'fact', receipt });
  const state = () => ['memories', 'receipts', 'suppressed', 'content_suppressions', 'owner_suppression_epochs', 'namespace_epochs']
    .map(table => db.prepare(`SELECT * FROM ${table}`).all());
  return { core, db, admit, original, correct, state };
}

for (const [kind, tokenIndex, replacement] of [
  ['receipt identity', 0, source],
  ['address with identical excerpt', 1, source],
  ['address with changed excerpt', 1, { ...source, excerpt: 'Synthetic changed excerpt.' }],
]) {
  test(`the write guard rejects an in-transaction ${kind} marker`, async t => {
    const f = await fixture(t);
    const originalReceipt = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(f.original.id);
    const marker = receiptDenialTokens([originalReceipt])[tokenIndex];
    const before = f.state();
    let wroteMarker = false;
    const prepare = DatabaseSync.prototype.prepare;
    const injection = t.mock.method(DatabaseSync.prototype, 'prepare', function (sql) {
      const statement = prepare.call(this, sql);
      if (!sql.startsWith('UPDATE memories SET content')) return statement;
      const update = statement.run.bind(statement);
      statement.run = (...args) => {
        const result = update(...args);
        if (args.at(-1) === f.original.id) {
          prepare.call(this, 'INSERT INTO suppressed VALUES(?,?,?,?)').run(ns.ownerId, ns.scope, ns.projectId ?? '', marker);
          wroteMarker = true;
        }
        return result;
      };
      return statement;
    });
    let result;
    try { result = f.correct(replacement); } finally { injection.mock.restore(); }
    assert.equal(wroteMarker, true);
    assert.deepEqual(result, error('evidence_unavailable'));
    assert.deepEqual(f.state(), before);
    assert.equal(f.correct(replacement).ok, true, 'a clean retry can still re-cite the source');
  });
}

test('a committed forget marker refuses correction and preserves every affected table', async t => {
  const f = await fixture(t), forgotten = f.admit('Synthetic forgotten sibling');
  ok(f.core.forget({ namespace: ns, memoryId: forgotten.id, expectedRevision: forgotten.revision }));
  const before = f.state();
  assert.deepEqual(f.correct({ ...source, excerpt: 'Synthetic changed excerpt.' }), error('source_excluded'));
  assert.deepEqual(f.state(), before);
});

test('the phase gate runs once inside the transaction', () => {
  const db = { isTransaction: false };
  let calls = 0;
  const check = commitPhaseGate(db, () => { calls++; });
  check();
  assert.equal(calls, 0);
  db.isTransaction = true;
  check();
  assert.equal(calls, 1);
});

for (const [name, precedingPhases, rejectedPhase, calls] of [
  ['the first check is inside a transaction', [], true, 0],
  ['the second check is outside a transaction', [false], false, 0],
  ['the third check is outside a transaction', [false, true], false, 1],
  ['the third check is inside a transaction', [false, true], true, 1],
]) {
  test(`the phase gate fails closed when ${name}`, () => {
    const db = { isTransaction: false };
    let gateCalls = 0;
    const check = commitPhaseGate(db, () => { gateCalls++; });
    for (const phase of precedingPhases) {
      db.isTransaction = phase;
      check();
    }
    db.isTransaction = rejectedPhase;
    assert.throws(check, { code: 'storage_error' });
    assert.equal(gateCalls, calls);
  });
}

test('a correction with the same receipt rolls back after an earlier forget', async t => {
  const f = await fixture(t), forgotten = f.admit('Synthetic forgotten sibling');
  ok(f.core.forget({ namespace: ns, memoryId: forgotten.id, expectedRevision: forgotten.revision }));
  const before = f.state();
  const boundaries = [];
  const exec = DatabaseSync.prototype.exec;
  const trace = t.mock.method(DatabaseSync.prototype, 'exec', function (sql) {
    if (sql === 'BEGIN IMMEDIATE' || sql === 'COMMIT' || sql === 'ROLLBACK') boundaries.push(sql);
    return exec.call(this, sql);
  });
  let result;
  try { result = f.correct(source); } finally { trace.mock.restore(); }
  assert.deepEqual(result, error('source_excluded'));
  assert.deepEqual(boundaries, ['BEGIN IMMEDIATE', 'ROLLBACK']);
  assert.deepEqual(f.state(), before);
});
