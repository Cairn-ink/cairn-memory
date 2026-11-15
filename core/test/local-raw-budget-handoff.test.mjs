import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { localEmbeddingFactory } from '../../adapters/local-embedder/index.mjs';
import { openMemoryCore } from '../index.mjs';
import { createLocalRawSearch } from '../local-raw-search.mjs';
import { defaultRawOptions } from '../local-defaults.mjs';
import { contextBudget, contextReadBudgetDiagnostic } from '../context-read-budget.mjs';
import { installRawSearchTestClock, rawSearchTestWait } from '../testing/raw-search-clock.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

test.beforeEach(installRawSearchTestClock);
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
async function provider(t) {
  const metadata = { id: 'synthetic-local-handoff-' + randomUUID(), revision: '1', dimensions: 32, normalization: 'l2' };
  let calls = 0;
  const create = localEmbeddingFactory({ registry: new Map(), verify: async () => ({ metadata }), start: async () => ({
    localStatus: () => ({ state: 'ready', reason: null }), close: async () => {},
    embed: async () => { calls++; return [Float32Array.from({ length: 32 }, (_, i) => i ? 0 : 1)]; }
  }) });
  const handle = await create({ packPath: '/synthetic/pack', maxRequests: 2 }); t.after(() => handle.close());
  return { ...handle, calls: () => calls };
}

test('local Raw maintenance survives broker awaits with exactly one maintenance reservation, leaving a query', async t => {
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'synthetic.sqlite'), p = await provider(t);
  const core = openMemoryCore({ raw: true, rawSearch: false, path,
    model: { contextWindow: 8192, countTokens: () => 1, extract: async () => ({ items: [] }) } });
  const manager = createLocalRawSearch(path, defaultRawOptions().port, p);
  workspace.defer(async () => { await manager.close(); await core.close(); });
  const namespace = { ownerId: 'synthetic-owner', scope: 'personal', projectId: null };
  ok(await core.capture({ namespace, client: 'codex', sessionId: 'synthetic-session', eventId: 'synthetic-event',
    messages: [{ id: 'synthetic-message', role: 'user', content: 'synthetic cobalt telescope' }] }));
  for (let n = 0; n < 10 && p.calls() === 0; n++) {
    await rawSearchTestWait(1010); ok(await manager.methods.maintainRawSearch({ namespace }));
  }
  assert.equal(p.calls(), 1, 'maintenance entered local inference after persisting its broker reservation');
  let status = contextReadBudgetDiagnostic(p.embedder);
  assert.equal(status.maintenance.requests, 1); assert.equal(status.query.requests, 0);
  await rawSearchTestWait(1010); ok(await manager.methods.maintainRawSearch({ namespace }));
  const found = ok(await manager.methods.searchRaw({ namespace, query: 'synthetic telescope' }));
  assert.equal(found.semantic.state, 'ready'); assert.equal(p.calls(), 2);
  status = contextReadBudgetDiagnostic(p.embedder);
  assert.equal(status.maintenance.requests, 1); assert.equal(status.query.requests, 1);
});

for (const missing of ['class', 'token']) test(`local reservation fails closed with a missing ${missing}`, async t => {
  const p = await provider(t), dispatch = contextBudget({ ...p, budgetConfigured: true });
  const port = { ...p.embedder, async embed(texts, controls) {
    await Promise.resolve();
    if (missing === 'class') delete controls.budgetClass;
    else controls.localReservation = {};
    return p.embedder.embed(texts, controls);
  } };
  await assert.rejects(dispatch(port, ['synthetic'], { budgetClass: 'maintenance', guard() {},
    signal: new AbortController().signal, deadlineAt: performance.now() + 5000 }), { code: 'budget_denied' });
  assert.equal(p.calls(), 0); const status = contextReadBudgetDiagnostic(p.embedder);
  assert.equal(status.maintenance.requests, 1); assert.equal(status.query.requests, 0);
});
