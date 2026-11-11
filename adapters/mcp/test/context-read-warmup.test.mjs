import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { openMemoryCore } from '../../../core/index.mjs';
import { createCairnServer } from '../server.mjs';

const ns = { ownerId: 'synthetic-owner', scope: 'personal', projectId: null };
const counter = { id: 'synthetic', countTokens: () => 1 };
for (const closeImmediately of [false, true]) test(`local lexical warm-up ${closeImmediately ? 'is cancelled by close (unchanged)' : 'publishes without a first read or embedding provider'}`, async t => {
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'memory.sqlite');
  const core = openMemoryCore({ path });
  assert.equal(core.admit({ namespace: ns, memory: { content: 'Synthetic telescope', kind: 'fact' }, receipts: [{
    client: 'synthetic', sessionId: 'synthetic', eventId: 'synthetic', role: 'user', excerpt: 'Synthetic telescope' }] }).ok, true);
  core.close();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const server = createCairnServer({ path, namespace: ns, raw: false, contextSemantic: false, contextCounter: counter });
  assert.equal(existsSync(path + '.context-read-v1.sqlite'), false, 'opening only schedules work');
  if (closeImmediately) await server.close();
  t.mock.timers.tick(0);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  try {
    assert.equal(existsSync(path + '.context-read-v1.sqlite'), !closeImmediately);
    if (!closeImmediately) {
      const side = new DatabaseSync(path + '.context-read-v1.sqlite', { readOnly: true });
      try { assert.equal(side.prepare('SELECT published FROM generations').get().published, 1); }
      finally { side.close(); }
    }
  } finally { await server.close(); t.mock.timers.reset(); }
});
