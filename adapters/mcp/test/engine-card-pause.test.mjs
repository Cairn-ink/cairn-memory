import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createCairnServer } from '../server.mjs';
import { engineCardFixture, ns } from '../../../core/testing/engine-card-fixture.mjs';
import { control } from '../../../core/testing/context-semantic-pause-fixture.mjs';

for (const disabled of [false, true]) test(`MCP maintenance continues after ${disabled ? 'disabled' : 'paused'} first namespace`, { timeout: 15000 }, async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('recording model is offline'));
  const f = engineCardFixture(t); f.seed(8);
  const personal = { ...ns, scope: 'personal', projectId: null };
  for (let i = 0; i < 8; i++) f.add(`Paused milestone ${i} records synthetic evidence.`, i * 9, i % 6, personal);
  control(f.db, personal, disabled ? { enabled: 0 } : { paused: 1 });
  // The real access seam orders personal before project in this read set.
  const server = createCairnServer({ path: f.path, namespace: ns, model: f.model,
    raw: false, contextReadPersonal: true });
  f.workspace.defer(() => server.close());
  assert.equal(await server.contextCounterReady, true);
  const until = Date.now() + 10000;
  while (!f.model.calls.length && Date.now() < until) await delay(50);
  assert.equal(f.model.calls.length, 1, 'next namespace must be processed in the same timer pass');
  assert.ok(f.model.calls[0].memories.every(memory => memory.content.startsWith('Orion')));
});
