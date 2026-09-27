import assert from 'node:assert/strict';
import { existsSync, mkdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createTestWorkspace } from './workspace.mjs';

test('cleanup is immediate, LIFO, awaited and idempotent', async t => {
  let hook;
  const workspace = createTestWorkspace({ after(fn) { hook = fn; } });
  t.after(workspace.cleanup);
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

test('failed close still attempts every close and removes scratch; rejection persists', async t => {
  const workspace = createTestWorkspace(null);
  t.after(() => assert.rejects(workspace.cleanup(), { name: 'AggregateError' }));
  const order = [];
  workspace.defer(() => { order.push(1); });
  workspace.defer(() => { order.push(2); throw new Error('close failed'); });
  await assert.rejects(workspace.cleanup(), { name: 'AggregateError' });
  await assert.rejects(workspace.cleanup(), { name: 'AggregateError' });
  assert.deepEqual(order, [2, 1]);
  assert.equal(existsSync(workspace.path), false);
});

test('cleanup shares its promise before callbacks and rejects late registration', async t => {
  const workspace = createTestWorkspace(t);
  let nested;
  let calls = 0;
  workspace.defer(() => {
    calls++;
    assert.throws(() => workspace.defer(() => {}), /test_workspace_cleanup_started/);
    nested = workspace.cleanup();
  });
  const completion = workspace.cleanup();
  assert.throws(() => workspace.defer(() => {}), /test_workspace_cleanup_started/);
  await completion;
  assert.equal(nested, completion);
  assert.equal(calls, 1);
  assert.equal(existsSync(workspace.path), false);
});

test('replacement directory is retained and nested symlink never follows sibling', async () => {
  const parent = createTestWorkspace(null);
  try {
    const sibling = join(parent.path, 'sibling');
    mkdirSync(sibling);
    writeFileSync(join(sibling, 'keep'), 'synthetic');
    const workspace = createTestWorkspace(null, { parent: parent.path });
    symlinkSync(sibling, join(workspace.path, 'link'), 'dir');
    await workspace.cleanup();
    assert.equal(existsSync(join(sibling, 'keep')), true);
    const replaced = createTestWorkspace(null, { parent: parent.path });
    renameSync(replaced.path, `${replaced.path}-moved`);
    mkdirSync(replaced.path);
    writeFileSync(join(replaced.path, 'keep'), 'synthetic');
    await assert.rejects(replaced.cleanup(), { name: 'AggregateError' });
    assert.equal(existsSync(join(replaced.path, 'keep')), true);
  } finally { await parent.cleanup(); }
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
