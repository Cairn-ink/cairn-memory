import assert from 'node:assert/strict';
import { existsSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createTestWorkspace } from './workspace.mjs';

test('cleanup is immediate, LIFO, awaited and idempotent', async () => {
  let hook;
  const workspace = createTestWorkspace({ after(fn) { hook = fn; } });
  const order = [];
  workspace.defer(() => { order.push('first'); });
  workspace.defer(async () => { await Promise.resolve(); order.push('second'); });
  assert.equal(hook, workspace.cleanup);
  writeFileSync(join(workspace.path, 'scratch'), 'synthetic');
  const first = hook();
  assert.equal(workspace.cleanup(), first);
  await first;
  assert.deepEqual(order, ['second', 'first']);
  assert.equal(existsSync(workspace.path), false);
});

test('failed close still attempts every close and removes scratch; rejection persists', async () => {
  const workspace = createTestWorkspace(null);
  const order = [];
  workspace.defer(() => { order.push(1); });
  workspace.defer(() => { order.push(2); throw new Error('close failed'); });
  await assert.rejects(workspace.cleanup(), { name: 'AggregateError' });
  await assert.rejects(workspace.cleanup(), { name: 'AggregateError' });
  assert.deepEqual(order, [2, 1]);
  assert.equal(existsSync(workspace.path), false);
});

test('replaced root and external symlink target and sibling are preserved', async () => {
  const parent = createTestWorkspace(null);
  try {
    const workspace = createTestWorkspace(null, { parent: parent.path });
    const sibling = join(parent.path, 'sibling');
    writeFileSync(sibling, 'keep');
    const moved = `${workspace.path}-moved`;
    renameSync(workspace.path, moved);
    symlinkSync(moved, workspace.path, 'dir');
    await assert.rejects(workspace.cleanup(), { name: 'AggregateError' });
    assert.equal(existsSync(join(moved)), true);
    assert.equal(existsSync(sibling), true);
  } finally { await parent.cleanup(); }
});
