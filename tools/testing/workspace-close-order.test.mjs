import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { openMemoryCore } from '../../core/index.mjs';
import { createTestWorkspace } from './workspace.mjs';

const namespace = { ownerId: 'synthetic-close-order', scope: 'personal', projectId: null };

for (const deferred of [false, true]) test(`Raw owner settles ${deferred ? 'before' : 'after'} workspace rm entry with ${deferred ? 'defer' : 'a later after hook'}`, async t => {
  const events = [];
  let settled = false, closing;
  const workspace = createTestWorkspace(t);
  const core = openMemoryCore({ path: join(workspace.path, 'store.sqlite'), raw: true });
  const close = () => closing ??= Promise.resolve(core.close()).then(() => {
    settled = true;
    events.push('close:settled');
  });
  const nativeRm = fs.rm;
  const observation = t.mock.method(fs, 'rm', async (path, options) => {
    if (path === workspace.path) {
      events.push(settled ? 'rm:closed' : 'rm:open');
      // Observe entry deterministically, then join the real owner even in the
      // deliberately wrong pattern so this test never races native removal.
      await close();
    }
    return nativeRm(path, options);
  });
  syncBuiltinESMExports();
  if (deferred) workspace.defer(close);
  else t.after(close);
  t.after(() => {
    observation.mock.restore();
    syncBuiltinESMExports();
    assert.deepEqual(events, deferred ? ['close:settled', 'rm:closed'] : ['rm:open', 'close:settled']);
  });
  const status = await core.getRawSearchStatus({ namespace });
  assert.equal(status.ok, true, JSON.stringify(status));
});

// The pattern tests above cannot detect a registration reverting in another
// file. These current-tree checks pin the two diagnosed regressions explicitly.
for (const [file, start, end, closer] of [
  ['core/test/content-safety-s2h-read-entry.test.mjs',
    "test('R1 v18 receipts upgraded to v48 retain the legacy fallback after unrelated same-session Raw capture'", null,
    /f\.workspace\.defer\(\s*\(\)\s*=>\s*core\.close\(\)\s*\)/],
  ['adapters/mcp/test/defaults.test.mjs',
    "test('keyless server starts with context tools, and explicit off removes them'",
    "test('embedding configuration is automatic with a key and absent without one; semantic false wins'",
    /workspace\.defer\(\s*\(\)\s*=>\s*server\.close\(\)\s*\)/],
]) test(`workspace owner registration: ${file}`, async () => {
  const source = await fs.readFile(new URL('../../' + file, import.meta.url), 'utf8');
  const from = source.indexOf(start), to = end === null ? source.length : source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, 'reviewed test body must exist');
  const body = source.slice(from, to);
  assert.match(body, closer, 'Raw owner must close through workspace.defer before rm');
  assert.doesNotMatch(body, /t\.after\(\s*\(\)\s*=>\s*(?:core|server)\.close\(\)/,
    'Raw owner must not register a later FIFO after hook');
});
