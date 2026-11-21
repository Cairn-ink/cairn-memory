import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../index.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const namespace = { ownerId: 'synthetic-owner', scope: 'project', projectId: 'probe' };
const ref = memory => ({ memoryId: memory.id, revision: memory.revision });
const ok = result => {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
};
const source = index => ({ client: 'synthetic', sessionId: 'session', eventId: 'event-' + index,
  role: 'user', excerpt: 'Proof ' + index });

function observe(t) {
  const lookups = [];
  const exec = DatabaseSync.prototype.exec, all = StatementSync.prototype.all;
  const transactions = new WeakMap();
  t.mock.method(DatabaseSync.prototype, 'exec', function (sql) {
    if (/^BEGIN\b/.test(sql)) transactions.set(this, lookups.push(0) - 1);
    if (/^(COMMIT|ROLLBACK)\b/.test(sql)) transactions.delete(this);
    return exec.call(this, sql);
  });
  const current = [];
  t.mock.method(DatabaseSync.prototype, 'prepare', function (sql) {
    const statement = prepare.call(this, sql);
    if (transactions.has(this) && sql.includes('suppressed s') && sql.includes('s.fingerprint=')) {
      current.push([statement, transactions.get(this)]);
    }
    return statement;
  });
  t.mock.method(StatementSync.prototype, 'all', function (...bindings) {
    const entry = current.find(([statement]) => statement === this);
    if (entry) lookups[entry[1]]++;
    return all.apply(this, bindings);
  });
  return lookups;
}
const prepare = DatabaseSync.prototype.prepare;

test('ordinary recall batches two selected memories in its final snapshot', async t => {
  const refs = [];
  const reply = () => ({ refs: refs.map(value => ({ namespaceIndex: 0, ...value })) });
  const core = openMemoryCore({ path: ':memory:', model: {
    contextWindow: 8192, countTokens: () => 1, select: reply, rank: reply,
  } });
  t.after(() => core.close());
  for (let index = 0; index < 2; index++) refs.push(ref(ok(core.admit({ namespace,
    memory: { kind: 'fact', content: 'Synthetic Memory ' + index }, receipts: [source(index)] })).memory));
  const lookups = observe(t);
  const recall = ok(await core.recall({ readSet: [namespace], query: 'Synthetic' }));
  assert.deepEqual(recall.memories.map(item => [item.memory.id, item.receipts.length]), refs.map(value => [value.memoryId, 1]));
  assert.equal(lookups.at(-1), 1, 'one final-snapshot lookup across both selected memories');
});

test('a legacy fetch refills a marked receipt page using one lookup per transaction', t => {
  const workspace = createTestWorkspace(t);
  const path = join(workspace.path, 'store.sqlite');
  const core = openMemoryCore({ path, model: { contextWindow: 8192, countTokens: () => 1 } });
  const db = new DatabaseSync(path);
  workspace.defer(() => { db.close(); core.close(); });
  const memory = ok(core.admit({ namespace, memory: { kind: 'fact', content: 'Synthetic Memory' },
    receipts: [source(0)] })).memory;
  const date = index => new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
  db.prepare('UPDATE receipts SET created_at=? WHERE memory_id=?').run(date(0), memory.id);
  const insert = db.prepare(`INSERT INTO receipts(id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`);
  for (let index = 1; index <= 102; index++) {
    const row = source(index);
    const key = createHash('sha256').update(JSON.stringify(row)).digest('hex');
    insert.run('receipt-' + index, memory.id, key, row.client, row.sessionId, row.eventId, row.role, row.excerpt, date(index));
  }
  const marker = db.prepare('INSERT INTO suppressed VALUES(?,?,?,?)');
  const key = db.prepare('SELECT receipt_key FROM receipts WHERE memory_id=? AND event_id=?');
  for (const index of [0, 101]) marker.run(namespace.ownerId, namespace.scope, namespace.projectId,
    'rs1:i:' + key.get(memory.id, source(index).eventId).receipt_key);
  const lookups = observe(t);
  const request = { namespace, refs: [ref(memory)] };
  const first = ok(core.fetch(request));
  assert.ok(first.nextCursor);
  const next = ok(core.fetch({ ...request, cursor: first.nextCursor }));
  const receipts = [...first.items[0].receipts, ...next.items[0].receipts];
  assert.deepEqual(receipts.map(receipt => receipt.eventId),
    Array.from({ length: 102 }, (_, index) => index + 1).filter(index => index !== 101).map(index => source(index).eventId));
  assert.equal(next.exhausted, true);
  assert.ok(lookups.includes(1));
  assert.deepEqual(lookups.filter(count => count > 1), [], 'the refill shares its original transaction lookup');
});
