import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import { withheldReceiptPageInside } from '../content-safety.mjs';
import { openMemoryCore } from '../index.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const scope = { ownerId: 'synthetic-owner', scope: 'project', projectId: 'marked' };
const otherScope = { ...scope, projectId: 'unmarked' };

for (const count of [256, 257]) {
  test(`scoped batches deduplicate ${count} receipt proofs`, t => {
    const workspace = createTestWorkspace(t);
    const path = join(workspace.path, 'store.sqlite');
    const core = openMemoryCore({ path });
    workspace.defer(() => core.close());
    const seed = namespace => {
      const admitted = core.admit({ namespace, memory: { kind: 'fact', content: 'Synthetic Memory' },
        receipts: [{ client: 'synthetic', sessionId: 'session', eventId: 'event', role: 'user', excerpt: 'Proof' }] });
      assert.equal(admitted.ok, true, JSON.stringify(admitted));
      return admitted.value.memory.id;
    };
    const first = seed(scope), second = seed(otherScope);
    const db = new DatabaseSync(path);
    workspace.defer(() => db.close());
    const receipt = db.prepare('SELECT id,receipt_key FROM receipts WHERE memory_id=?');
    const marked = receipt.get(first), kept = receipt.get(second);
    assert.notEqual(marked.id, kept.id);
    assert.equal(marked.receipt_key, kept.receipt_key);
    db.prepare('INSERT INTO suppressed VALUES(?,?,?,?)').run(scope.ownerId, scope.scope, scope.projectId, 'rs1:i:' + marked.receipt_key);
    const insert = db.prepare(`INSERT INTO receipts(id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
      SELECT ?,memory_id,?,client,session_id,?,role,excerpt,created_at FROM receipts WHERE id=?`);
    const unmarkedIds = Array.from({ length: count - 1 }, (_, index) => 'receipt-' + index);
    for (const id of unmarkedIds) insert.run(id, id, id, marked.id);

    const calls = [], all = StatementSync.prototype.all;
    t.mock.method(StatementSync.prototype, 'all', function (...bindings) {
      if (this.sourceSQL.includes('CROSS JOIN suppressed s')) calls.push(JSON.parse(bindings[0]));
      return all.apply(this, bindings);
    });
    db.exec('BEGIN');
    try {
      const withheld = withheldReceiptPageInside(db, [[scope, [...unmarkedIds, marked.id, marked.id]], [otherScope, [kept.id]]]);
      assert.deepEqual(withheld, new Set([marked.id]));
      assert.equal(withheld.has(kept.id), false);
      assert.equal(calls.length, 1);
      const chunks = calls[0].filter(chunk => chunk[2] === scope.projectId).map(chunk => chunk[3]);
      assert.deepEqual(chunks.map(chunk => chunk.length), count === 256 ? [256] : [256, 1]);
      assert.deepEqual(chunks.flat(), [...unmarkedIds, marked.id]);
    } finally { db.exec('ROLLBACK'); }
  });
}
