import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createLocalSharedRuntime } from '../local-shared-runtime.mjs';
import { call, connect, context, counter, deferred, holdWriteLock, ns, ok } from './local-shared-support.mjs';

const p95 = rows => [...rows].sort((a,b) => a-b)[Math.ceil(rows.length * .95)-1];
test('A4 eight connections: a capture retry keeps B-H reads within twice baseline without provider replay', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'shared-commit-eight-' });
  const path = join(workspace.path, 'store.sqlite'), locked = deferred();
  let extract = 0, classify = 0, lock;
  const model = { contextWindow: 8192, countTokens: () => 1,
    async extract() {
      extract++; lock = await holdWriteLock(t, path, 3000); locked.resolve();
      return { items: [{ content: 'Synthetic cobalt telescope capture', kind: 'fact', confidence: .8, sourceIndices: [0] }] };
    },
    async classify({ input }) { classify++; return { items: input.memories.map(memory => ({ memoryId: memory.id,
      parentIds: [], newL1: { title: 'Synthetic telescope', parentL2Ids: [] } })) }; } };
  const host = createLocalSharedRuntime({ path, namespace: ns, raw: false, model, contextCounter: counter });
  workspace.defer(() => host.close());
  const clients = [];
  for (let index = 0; index < 8; index++) clients.push((await connect(t, host)).client);
  ok(await call(clients[0], 'remember_memory', { content: 'Synthetic cobalt telescope baseline', kind: 'fact' }));
  for (const client of clients) await context(client);
  const measure = start => Promise.all(clients.slice(1).map(async client => {
    await context(client); return performance.now() - start;
  }));
  const baseline = [];
  for (let turn = 0; turn < 3; turn++) baseline.push(...await measure(performance.now()));
  const capture = call(clients[0], 'capture_memory', { batchId: 'synthetic-commit-batch',
    messages: [{ role: 'user', content: 'Synthetic cobalt telescope capture source' }] });
  await locked.promise;
  const held = await measure(performance.now()), result = await capture;
  assert.equal(extract, 1, 'eight-connection capture must dispatch extraction exactly once');
  assert.equal(classify, 1, 'eight-connection capture must dispatch classification exactly once');
  assert.equal(ok(result).classification.status, 'applied');
  const [code, signal] = await lock.exited; assert.equal(code, 0); assert.equal(signal, null);
  t.diagnostic('A4 capture ' + JSON.stringify({ connections: 8, baselineP95: p95(baseline), lockedP95: p95(held), extract, classify }));
  assert.ok(p95(held) <= p95(baseline) * 2, 'A4 capture B-H read p95 must stay within 2x baseline');
  assert.ok(host.inspectTransactions().every(state => state.isOpen && !state.isTransaction));
});
