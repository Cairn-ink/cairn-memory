import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { holdWriteLock } from '../../adapters/mcp/test/local-shared-support.mjs';
import { openMemoryCore } from '../contract.mjs';
import { parse } from '../../tools/testing/vendor/acorn/acorn.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { createCommitDispatcher, dispatchCommit } from '../commit-dispatch.mjs';

const busy = () => Object.assign(Error('synthetic busy'), { code: 'ERR_SQLITE_ERROR', errcode: 5 });
const code = expected => error => error.code === expected;
const invoke = work => Promise.resolve().then(work);

for (const outcome of ['success', 'BUSY', 'error', 'deadline', 'abort', 'expired-before-attempt']) {
  test(`per-attempt native timeout restores 5000 after ${outcome}`, async t => {
    const controller = new AbortController(); let clock = 0, calls = 0, backoffs = 0;
    const restored = () => assert.deepEqual(host.inspectBusyTimeouts(), [5000], 'R2G_TIMEOUT_RESTORE');
    const host = createCommitDispatcher({ now: () => clock, random: () => 0,
      onAwait({ point }) { if (point === 'before_timer' || point === 'after_timer') restored(); },
      onBackoff({ waitMs }) {
        backoffs++; restored(); clock += waitMs;
        if (outcome === 'abort') queueMicrotask(() => controller.abort());
      } });
    const runtime = host.open(() => createMemoryRuntime({ path: ':memory:' }));
    t.after(() => runtime.close()); restored();
    const work = () => {
      calls++;
      assert.deepEqual(host.inspectBusyTimeouts(), [5], 'R2G_ATTEMPT_TIMEOUT');
      if (outcome === 'error') throw Object.assign(Error('refused'), { code: 'synthetic_refusal' });
      if (outcome === 'BUSY' && calls === 1 || outcome === 'deadline' || outcome === 'abort') throw busy();
      return 'committed';
    };
    const run = () => host.run(() => dispatchCommit(runtime, work), { signal: controller.signal,
      deadlineAt: outcome === 'expired-before-attempt' ? 4 : outcome === 'deadline' ? 30 : 5000 });
    if (outcome === 'error') await assert.rejects(invoke(run), code('synthetic_refusal'));
    else if (outcome === 'deadline') await assert.rejects(invoke(run), code('storage_busy'));
    else if (outcome === 'abort') await assert.rejects(invoke(run), code('authority_required'));
    else assert.equal(await run(), 'committed');
    restored();
    if (outcome === 'expired-before-attempt') assert.equal(calls, 1);
    if (['BUSY', 'deadline', 'abort'].includes(outcome)) assert.ok(backoffs > 0);
    if (outcome === 'abort') assert.equal(calls, 1, 'abort prevents a second attempt');
  });
}

test('timeout set, closure and restore share one synchronous attempt with no await point', () => {
  const source = readFileSync(new URL('../commit-dispatch.mjs', import.meta.url), 'utf8');
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  let attempt;
  const visit = (node, work) => {
    if (!node || typeof node !== 'object') return;
    if (node.type) work(node);
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(child => visit(child, work));
    else if (value && typeof value === 'object') visit(value, work);
  };
  visit(ast, node => { if (node.type === 'VariableDeclarator' && node.id.name === 'tryCommit') attempt = node.init; });
  assert.ok(attempt && !attempt.async && !attempt.generator, 'R2G_TIMEOUT_AWAIT_POINT');
  visit(attempt, node => assert.notEqual(node.type, 'AwaitExpression', 'R2G_TIMEOUT_AWAIT_POINT'));
  const body = source.slice(attempt.start, attempt.end);
  assert.match(body, /try\s*\{\s*db.exec\('PRAGMA busy_timeout = 5'\)/, 'R2G_TIMEOUT_AWAIT_POINT');
  assert.match(body, /finally\s*\{[\s\S]*if \(db.isOpen\) db.exec/, 'R2G_TIMEOUT_RESTORE');
});

for (const outcome of ['success', 'deadline', 'abort']) test(`real SQLite BUSY restores timeout through ${outcome}`, async t => {
  const w = createTestWorkspace(t), path = join(w.path, 'restore.sqlite');
  const controller = new AbortController(); let backoffs = 0;
  const host = createCommitDispatcher({ onBackoff() {
    backoffs++;
    assert.deepEqual(host.inspectBusyTimeouts(), [5000], 'R2G_TIMEOUT_RESTORE');
    if (outcome === 'abort') queueMicrotask(() => controller.abort());
  } });
  const core = host.open(() => openMemoryCore({ path, raw: false })); w.defer(() => core.close());
  const lock = await holdWriteLock(t, path, 500);
  const result = await host.run(() => core.admit({ namespace: { ownerId: 'synthetic', scope: 'personal', projectId: null },
    memory: { content: 'Synthetic timeout restoration', kind: 'fact' }, receipts: [{ client: 'synthetic', sessionId: 'restore',
      eventId: outcome, role: 'user', excerpt: 'Synthetic timeout restoration' }] }),
    { signal: controller.signal, deadlineAt: performance.now() + (outcome === 'deadline' ? 80 : 5000) });
  assert.ok(backoffs > 0, 'real native BUSY must enter backoff');
  assert.deepEqual(host.inspectBusyTimeouts(), [5000], 'R2G_TIMEOUT_RESTORE');
  if (outcome === 'success') assert.equal(result.ok, true, JSON.stringify(result));
  else assert.equal(result.error.code, outcome === 'abort' ? 'authority_required' : 'storage_busy');
  assert.deepEqual(await lock.exited, [0, null]);
});

test('canonical binding refuses an opener with a non-default restore timeout', () => {
  const host = createCommitDispatcher();
  assert.throws(() => host.open(() => createMemoryRuntime({ path: ':memory:', busyTimeoutMs: 5 })), code('storage_error'));
});
