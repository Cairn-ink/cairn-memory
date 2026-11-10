import test from 'node:test';
import assert from 'node:assert/strict';
import { cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { observeStandalone } from '../testing/main-golden.mjs';

test('twelve concurrent hooks each send exactly once; paused hooks send nothing', async t => {
  const workspace = createTestWorkspace(t);
  const plugin = fileURLToPath(new URL('../../../plugins/cairn-memory/', import.meta.url));
  for (const name of ['lib', 'scripts'])
    await cp(join(plugin, name), join(workspace.path, name), { recursive: true });
  const results = await observeStandalone(workspace.path, {
    modes: ['concurrent-linux', 'concurrent-darwin', 'paused-standalone'],
  });
  assert.equal(results.length, 6);
  for (const result of results) {
    const requests = result.requestBytes.trim().split('\n').filter(Boolean).map(JSON.parse);
    const concurrent = result.mode.startsWith('concurrent-');
    assert.equal(requests.length, concurrent ? 12 : 0, `${result.mode}:${result.entry}`);
    if (concurrent && result.entry === 'hook') {
      const sessions = requests.map(request => JSON.parse(request.body).session_id).sort();
      assert.deepEqual(sessions, Array.from({ length: 12 }, (_, i) => `synthetic-session-${i}`).sort());
    }
    assert.ok(result.outcomes.every(outcome => outcome.code === 0 && !outcome.stderr));
    t.diagnostic(JSON.stringify({ mode: result.mode, entry: result.entry, requests: requests.length }));
  }
});
