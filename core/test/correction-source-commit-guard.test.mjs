import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../index.mjs';
import { receiptDenialTokens } from '../raw-source-roots.mjs';
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
