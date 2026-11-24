import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { openMemoryCore } from '../index.mjs';
import { ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

function fixture(t) {
  const workspace = createTestWorkspace(t, { prefix: 'session-shared-source-' });
  const core = openMemoryCore({ path: join(workspace.path, 'store.sqlite'), contentSafety: 's2h-v1',
    model: { contextWindow: 8192, countTokens: () => 1, extract: () => ({ items: [] }) } });
  workspace.defer(() => core.close());
  return {
    admit: (content, receipts) => ok(core.admit({ namespace: ns, memory: { content, kind: 'fact' }, receipts })).memory,
    forget: memory => ok(core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision })),
    receipts: memory => ok(core.get({ namespace: ns, memoryId: memory.id })).receipts,
    receiptPage: input => ok(core.listMemoriesByTime({ namespace: ns, ...input })),
    context: () => ok(core.sessionStartContext({ namespace: ns,
      groups: { nextSteps: false, procedural: false, background: true },
      maxChars: 8000, backgroundBudget: { maxChars: 8000 } })),
  };
}

const evidence = ({ id, role, excerpt }) => ({ id, role, excerpt });

test('session start withholds a shared receipt after another memory is forgotten', t => {
  const f = fixture(t);
  const shared = receipt('shared'), independent = receipt('independent');
  const donor = f.admit('Synthetic donor memory', [shared]);
  const survivor = f.admit('Synthetic surviving memory', [shared, independent]);
  const [hidden, visible] = [shared, independent].map(source =>
    evidence(f.receipts(survivor).find(row => row.eventId === source.eventId)));
  const read = () => f.context().groups.background.items.find(item => item.memory.id === survivor.id);

  assert.ok(read().receipts.some(row => row.id === hidden.id));
  f.forget(donor);
  assert.deepEqual(read()?.receipts, [visible]);
});

test('withheld receipts do not count toward the session start evidence cap', t => {
  const f = fixture(t);
  const since = new Date(Date.now() - 60_000).toISOString();
  const receipts = Array.from({ length: 101 }, (_, index) => ({ ...receipt('receipt-' + index), excerpt: 'Short evidence' }));
  let survivor;
  for (let index = 0; index < receipts.length; index += 4) {
    survivor = f.admit('Synthetic surviving memory', receipts.slice(index, index + 4));
  }
  const withheld = receipts.slice(0, 41);
  for (let index = 0; index < withheld.length; index += 4) {
    f.forget(f.admit('Synthetic donor ' + index, withheld.slice(index, index + 4)));
  }

  const until = new Date(Date.now() + 60_000).toISOString();
  const visible = [];
  let cursor;
  do {
    const page = f.receiptPage({ since, until, limit: 13, ...(cursor ? { cursor } : {}) });
    visible.push(...page.items.map(item => item.receipt.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(visible.length, 60);
  const item = f.context().groups.background?.items.find(item => item.memory.id === survivor.id);
  assert.ok(item, 'the memory with 60 visible receipts fits the session start cap');
  assert.deepEqual(item.receipts.map(receipt => receipt.id).sort(), visible.toSorted());
});
