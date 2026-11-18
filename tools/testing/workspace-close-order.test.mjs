import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { rm } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { openMemoryCore } from '../../core/index.mjs';
import { createTestWorkspace } from './workspace.mjs';

const namespace = { ownerId: 'synthetic-close-order', scope: 'personal', projectId: null };

for (const [name, deferred, rejectRemoval] of [
  ['Raw owner settles after workspace rm entry with a later after hook', false, false],
  ['Raw owner settles before workspace rm entry with defer', true, false],
  ['Workspace rm rejection restores the named rm export', true, true],
]) test(name, async t => {
  const nativeRm = fs.rm;
  const events = [];
  let workspace, observation, status;
  try {
    await t.test('workspace cleanup hooks', { todo: rejectRemoval && 'workspace removal is forced to reject' }, async child => {
      let settled = false, closing;
      workspace = createTestWorkspace(child);
      const core = openMemoryCore({ path: join(workspace.path, 'store.sqlite'), raw: true });
      const close = () => closing ??= Promise.resolve(core.close()).then(() => {
        settled = true;
        events.push('close:settled');
      });
      observation = child.mock.method(fs, 'rm', async (path, options) => {
        if (path === workspace.path) {
          events.push(settled ? 'rm:closed' : 'rm:open');
          // Observe entry before joining the real owner, so removal cannot race close.
          await close();
          if (rejectRemoval) {
            events.push('rm:rejected');
            throw new Error('forced workspace removal failure');
          }
        }
        return nativeRm(path, options);
      });
      syncBuiltinESMExports();
      if (deferred) workspace.defer(close);
      else child.after(close);
      status = await core.getRawSearchStatus({ namespace });
    });
  } finally {
    observation?.mock.restore();
    syncBuiltinESMExports();
    if (rejectRemoval && workspace) await nativeRm(workspace.path, { recursive: true, force: true });
  }
  assert.equal(rm, nativeRm, 'named rm export must be restored');
  assert.equal(status?.ok, true, JSON.stringify(status));
  const expected = deferred ? ['close:settled', 'rm:closed'] : ['rm:open', 'close:settled'];
  if (rejectRemoval) expected.push('rm:rejected');
  assert.deepEqual(events, expected);
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
