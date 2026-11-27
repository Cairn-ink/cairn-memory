import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../index.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const namespace = { ownerId: 'test-owner', scope: 'project', projectId: 'test-project' };
const hiddenField = 'receiptsWithheld';
const ok = result => {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
};
const ref = memory => ({ memoryId: memory.id, revision: memory.revision });

function checkNoState(value) {
  if (!value || typeof value !== 'object') return;
  assert.equal(Object.hasOwn(value, hiddenField), false);
  for (const key of Reflect.ownKeys(value)) checkNoState(value[key]);
}

for (const withVisibleReceipt of [false, true]) {
  test(`receipt withholding stays internal with ${withVisibleReceipt ? 'some' : 'no'} visible receipts`, async t => {
    const workspace = createTestWorkspace(t, { prefix: 'withheld-receipt-test-' });
    const path = join(workspace.path, 'store.sqlite');
    const serialized = [], ranking = [];
    let memory;
    const model = {
      contextWindow: 8192,
      countTokens(text) { serialized.push(text); return 1; },
      select: () => ({ refs: [{ namespaceIndex: 0, ...ref(memory) }] }),
      rank({ input }) {
        ranking.push(input);
        return { refs: [{ namespaceIndex: 0, ...ref(memory) }] };
      },
    };
    const core = openMemoryCore({ path, model });
    const db = new DatabaseSync(path);
    const runtime = createMemoryRuntime({ path });
    workspace.defer(() => { runtime.close(); db.close(); core.close(); });
    const missing = { client: 'synthetic', sessionId: 'session', eventId: 'event', role: 'user', excerpt: 'private receipt' };
    const visible = { ...missing, eventId: 'other-event', excerpt: 'visible receipt' };
    const content = 'Synthetic Memory for recall';
    memory = ok(core.admit({ namespace, memory: { content, kind: 'fact' },
      receipts: withVisibleReceipt ? [missing, visible] : [missing] })).memory;
    const dateReceipt = db.prepare('UPDATE receipts SET created_at=? WHERE memory_id=? AND event_id=?');
    dateReceipt.run('2026-01-01T00:00:01.000Z', memory.id, missing.eventId);
    if (withVisibleReceipt) dateReceipt.run('2026-01-01T00:00:00.000Z', memory.id, visible.eventId);
    const request = { namespace, refs: [ref(memory)] };
    assert.equal(ok(core.fetch(request)).items[0].receipts.length, withVisibleReceipt ? 2 : 1);
    const stored = db.prepare('SELECT receipt_key FROM receipts WHERE memory_id=? AND event_id=?').get(memory.id, missing.eventId);
    db.prepare('INSERT INTO suppressed VALUES(?,?,?,?)').run(
      namespace.ownerId, namespace.scope, namespace.projectId, 'rs1:i:' + stored.receipt_key);
    const page = runtime.fetchPage(namespace, ref(memory), 0);
    assert.equal(Object.hasOwn(runtime, 'receiptShort'), false);
    assert.equal(page[hiddenField], true);
    assert.equal(Object.keys(page).includes(hiddenField), false);
    const fetched = core.fetch(request);
    assert.ok(serialized.includes(JSON.stringify(fetched)), 'public fetch bytes match the budgeted envelope');
    const recalled = await core.recall({ readSet: [namespace], query: content });
    assert.deepEqual(ok(fetched).items[0].receipts.map(row => row.excerpt), withVisibleReceipt ? [visible.excerpt] : []);
    assert.deepEqual(ok(recalled).memories[0].receipts.map(row => row.excerpt),
      withVisibleReceipt ? [visible.excerpt] : ['[source not available]']);
    assert.ok(ranking.length);
    for (const value of [fetched, recalled, ...ranking]) {
      checkNoState(value);
      assert.ok(!JSON.stringify(value).includes(hiddenField));
    }
    assert.ok(serialized.every(text => !text.includes(hiddenField)));
  });
}
