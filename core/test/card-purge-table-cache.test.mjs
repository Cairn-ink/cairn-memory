import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { purgeEngineCardsInside } from '../private-card-storage.mjs';
import { purgeEngineCardOperationsInside } from '../private-card-schema.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { transaction } from '../database.mjs';

const ns = { ownerId: 'synthetic-owner', scope: 'personal', projectId: '' };
const probe = table => `SELECT 1 FROM sqlite_master WHERE type='table' AND name='${table}'`;
const tables = ['card_memory_bindings', 'card_operations'];
function connection(t) {
  const db = new DatabaseSync(':memory:'), statements = [], prepare = db.prepare;
  t.after(() => db.close());
  db.prepare = function(sql) {
    const statement = prepare.call(this, sql);
    for (const method of ['get', 'all', 'run']) {
      const invoke = statement[method];
      statement[method] = function(...args) {
        statements.push([sql, method, args]);
        return Reflect.apply(invoke, this, args);
      };
    }
    return statement;
  };
  return { db, statements, probes: table => statements.filter(([sql]) => sql === probe(table)).length };
}
function install(db) {
  // Only the columns read by the two source functions; no engine installer.
  db.exec(`CREATE TABLE card_memory_bindings(card_id TEXT,memory_id TEXT);
    CREATE TABLE private_cards(id TEXT,owner_id TEXT,scope TEXT,project_id TEXT,title TEXT,body TEXT);
    CREATE TABLE card_operations(owner_id TEXT,scope TEXT,project_id TEXT,action_id TEXT,target_id TEXT,method TEXT,result TEXT);`);
}
function forget(db, memoryId = 'synthetic-memory') {
  db.exec('BEGIN');
  try {
    purgeEngineCardsInside(db, ns, 'synthetic-forget', memoryId);
    purgeEngineCardOperationsInside(db, ns, memoryId);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

test('purge table presence is probed once per connection and content queries still run', t => {
  const f = connection(t); install(f.db);
  forget(f.db); assert.equal(f.statements.length, 4);
  forget(f.db); assert.equal(f.statements.length, 6);
  for (const table of tables) assert.equal(f.probes(table), 1, table);
  assert.equal(f.statements.filter(([sql, method]) => sql.startsWith('SELECT c.*') && method === 'all').length, 2);
  assert.equal(f.statements.filter(([sql, method]) => sql.startsWith('DELETE FROM card_operations') && method === 'run').length, 2);
  f.db.prepare('INSERT INTO card_operations VALUES(?,?,?,?,?,?,?)').run(ns.ownerId, ns.scope, ns.projectId,
    'synthetic-action', 'synthetic-later-memory', 'consolidateAttempt', '{}');
  forget(f.db, 'synthetic-later-memory');
  assert.equal(f.db.prepare('SELECT count(*) n FROM card_operations').get().n, 0, 'no empty-content memo survives a later insert');
});

test('purge table absence is not cached: later creation on the same connection is discovered', t => {
  const f = connection(t);
  forget(f.db); forget(f.db);
  for (const table of tables) assert.equal(f.probes(table), 2, table);
  install(f.db); forget(f.db); forget(f.db);
  for (const table of tables) assert.equal(f.probes(table), 3, table);
  assert.equal(f.statements.filter(([sql]) => sql.startsWith('DELETE FROM card_operations')).length, 2);
  assert.equal(f.statements.filter(([sql]) => sql.startsWith('SELECT c.*')).length, 2);
});

test('purge table presence is not process-wide: a second connection probes independently', t => {
  const first = connection(t); install(first.db); forget(first.db); forget(first.db);
  const second = connection(t); install(second.db); forget(second.db); forget(second.db);
  for (const table of tables) {
    assert.equal(first.probes(table), 1, table + ' first handle');
    assert.equal(second.probes(table), 1, table + ' second handle');
  }
});

// A separate module instance starts with no registered writer. Do not unregister
// the live engine's hook or change its dependency graph to simulate this case.
const unregistered = await import('../content-suppression-storage.mjs?unregistered-card-purge');
for (const mode of ['owner', 'namespace']) test(`unregistered ${mode} erasure fails closed when Card tables exist`, t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec('CREATE TABLE private_cards(id TEXT PRIMARY KEY)');
  db.exec('BEGIN');
  try {
    assert.throws(() => unregistered.writeContentSuppressionInside(db, {
      namespace: mode === 'owner' ? { ...ns, scope: 'owner' } : ns, kind: mode, matchMode: mode,
      reason: 'purge', actionId: 'synthetic-erasure',
    }, true), error => error.code === 'evidence_unavailable');
  } finally { db.exec('ROLLBACK'); }
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name), ['private_cards']);
});

test('unregistered erasure on a store without Card tables writes its fact without installing a layout', async t => {
  const f = safetyFixture(t, 18); await f.migrate(); const db = f.connect(); t.after(() => db.close());
  const schema = db.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name').all();
  transaction(db, () => unregistered.writeContentSuppressionInside(db, { namespace: ns, kind: 'namespace', matchMode: 'namespace',
    reason: 'purge', actionId: 'synthetic-erasure' }));
  assert.equal(db.prepare('SELECT count(*) n FROM content_suppressions').get().n, 1);
  assert.deepEqual(db.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name').all(), schema);
});
