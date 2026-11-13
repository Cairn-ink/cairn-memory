import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { openMemoryCore } from '../../../core/contract.mjs';
import { createFakeEmbedder } from '../../../core/context-read-embedder.mjs';
import { cardHost } from '../../../core/testing/raw-source-fixtures.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createContextReadAccess } from '../context-read-access.mjs';
import { buildCairnServer, createContextMaintenanceDemand, startContextMaintenance } from '../server.mjs';
import { ns, counter, ok, streams, context } from './local-shared-support.mjs';

const combined = ['memory', 'card'];
const input = types => ({ query: 'synthetic cobalt telescope', types, intent: 'current', semantic: true, deadlineMs: 5000 });

// Only the upkeep timer is replaced. Core deadlines and provider controls keep
// real clocks. Await rearming, which happens after the whole pass settles.
function drivenLoop(t, core, access, options = {}) {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  let pending, arms = 0, armExpected = true;
  const timers = new WeakSet();
  globalThis.setTimeout = (callback, ms, ...args) => {
    if (!armExpected || ms !== 1000) return originalSet(callback, ms, ...args);
    armExpected = false;
    const token = { unref() {} }; timers.add(token); pending = callback; arms++; return token;
  };
  globalThis.clearTimeout = token => { if (!timers.has(token)) originalClear(token); };
  t.after(() => { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; });
  const loop = startContextMaintenance(core, { ...access, async call(...args) {
    try { return await access.call(...args); }
    finally { armExpected = true; }
  } }, options);
  t.after(() => loop.close());
  return { async tick() {
    const before = arms, callback = pending; pending = undefined;
    assert.ok(callback, 'one armed upkeep timer'); callback();
    for (let i = 0; arms === before && i < 1000; i++) await turn();
    assert.equal(arms, before + 1, 'one non-overlapping pass rearms once');
  }, close: () => loop.close() };
}

function selectionFixture(t) {
  let now = 100;
  const demand = createContextMaintenanceDemand(() => now), selected = [];
  const core = { getContextReadCapabilities: () => ({ ok: true, value: { types: combined } }) };
  const loop = drivenLoop(t, core, { readSet: [ns], call(core, method, args) {
    assert.equal(method, 'refreshContextIndex');
    assert.deepEqual(args.budget, { maxItems: 16, maxMs: 1000 });
    selected.push(args.types);
  } }, { demand });
  return { demand, selected, loop, advance(ms) { now += ms; } };
}

test('a: no filtered reads selects the combined view on every turn', async t => {
  const f = selectionFixture(t);
  for (let i = 0; i < 12; i++) await f.loop.tick();
  assert.deepEqual(f.selected, Array.from({ length: 12 }, () => combined), 'R2J_COMBINED_ONLY');
  assert.deepEqual(f.demand.inspect(), []);
});

test('d: filtered demand expires at 30 minutes and resumes combined-only turns', async t => {
  const f = selectionFixture(t);
  f.demand.note(['memory']);
  for (let i = 0; i < 4; i++) await f.loop.tick();
  assert.deepEqual(f.selected.at(-1), ['memory']);
  f.advance(30 * 60 * 1000 - 1);
  assert.deepEqual(f.demand.inspect(), [['memory', 100]]);
  f.advance(1);
  f.selected.length = 0;
  for (let i = 0; i < 8; i++) await f.loop.tick();
  assert.deepEqual(f.selected, Array.from({ length: 8 }, () => combined), 'R2J_DEMAND_EXPIRY');
  assert.deepEqual(f.demand.inspect(), []);
});

test('f: retained demand contains only bounded enum/timestamp pairs, copied on inspection', () => {
  let now = 10;
  const demand = createContextMaintenanceDemand(() => now);
  for (const types of [combined, [], ['raw'], ['memory', 'memory']]) demand.note(types);
  assert.deepEqual(demand.inspect(), []);
  const types = ['memory']; demand.note(types); types[0] = 'synthetic request text';
  now = 20; demand.note(['card']); now = 30; demand.note(['memory']);
  assert.deepEqual(demand.inspect(), [['memory', 30], ['card', 20]]);
  const inspected = demand.inspect(); inspected[0][0] = 'changed'; inspected.push(['extra', 0]);
  assert.deepEqual(demand.inspect(), [['memory', 30], ['card', 20]], 'R2J_DEMAND_PRIMITIVES');
  assert.deepEqual(createContextMaintenanceDemand().inspect(), [], 'hosts do not share demand');
});

async function realFixture(t) {
  const w = createTestWorkspace(t), path = join(w.path, 'synthetic-demand.sqlite');
  const cards = cardHost(), access = createContextReadAccess(ns, false, { maintenance: true });
  const core = openMemoryCore({ path, raw: true, privateCards: cards.options,
    contextRead: { ...access.configuration, embedder: createFakeEmbedder(), counter,
      policy: { family: 'local', maxRequests: 10000, maxUsd: 1, estimateUsd: () => 0 } } });
  w.defer(() => core.close());
  for (let i = 0; i < 3; i++) ok(await core.admit({ namespace: ns,
    memory: { content: 'Synthetic cobalt telescope memory ' + i, kind: 'fact' },
    receipts: [{ client: 'synthetic', sessionId: 'demand', eventId: String(i), role: 'user', excerpt: 'Synthetic receipt ' + i }] }));
  const draft = ok(await cards.call(core, 'createCardDraft', { namespace: ns, actionId: 'draft', drafting: 'authored',
    input: { title: 'Synthetic cobalt telescope', body: 'Synthetic cobalt telescope card',
      authoredInput: { text: 'Synthetic source for demand test', occurredAt: null } } }));
  ok(await cards.call(core, 'confirmCardDraft', { namespace: ns, actionId: 'confirm', cardId: draft.id,
    expectedRevision: 1, applicability: 'current' }));
  const demand = createContextMaintenanceDemand();
  const server = buildCairnServer({ path, binding: ns, core, context: access, contextSemantic: true,
    contextDemand: demand, maintenance: false, ownsCore: false });
  const [serverSide, clientSide] = streams(), client = new Client({ name: 'synthetic-demand', version: '1' });
  t.after(async () => { await client.close(); await server.close(); serverSide.destroy(); clientSide.destroy(); });
  await server.connect(new StdioServerTransport(serverSide, serverSide));
  await client.connect(new StdioServerTransport(clientSide, clientSide));
  return { core, access, client, demand };
}

for (const wanted of [[['memory']], [['card']], [['memory'], ['card']]]) {
  test(`b/c: successful reads activate ${JSON.stringify(wanted)} with a 3-of-4 combined floor and semantic readiness`, { timeout: 15000 }, async t => {
    const f = await realFixture(t), selected = [];
    for (const types of wanted) await context(f.client, input(types));
    const loop = drivenLoop(t, f.core, { ...f.access, call(core, method, args) {
      selected.push(args.types); return f.access.call(core, method, args);
    } }, { demand: f.demand });
    for (let i = 0; i < 16; i++) await loop.tick();
    for (let i = 0; i <= selected.length - 4; i++) assert.ok(
      selected.slice(i, i + 4).filter(types => types.length === 2).length >= 3, 'R2J_COMBINED_FLOOR');
    assert.deepEqual(selected.filter(types => types.length === 1),
      Array.from({ length: 4 }, (_, i) => wanted[i % wanted.length]), 'R2J_FILTERED_SCHEDULE');
    for (const types of [combined, ...wanted]) {
      const result = await context(f.client, input(types));
      assert.equal(result.diagnostics.candidates.channels.semantic.state, 'ready', 'R2J_FILTERED_READY');
    }
  });
}

test('e: invalid and refused MCP reads record no demand', { timeout: 15000 }, async t => {
  const f = await realFixture(t);
  await context(f.client, input(combined));
  assert.deepEqual(f.demand.inspect(), [], 'combined reads do not activate a filter');
  for (const patch of [{ query: '' }, { types: ['memory', 'memory'] }, { types: ['raw'] }, { deadlineMs: 0 }]) {
    const result = await f.client.callTool({ name: 'read_memory_context', arguments: { ...input(['memory']), ...patch } });
    assert.equal(result.isError, true);
    assert.deepEqual(f.demand.inspect(), [], 'R2J_INVALID_DEMAND');
  }
  const candidates = await f.client.callTool({ name: 'find_memory_candidates', arguments: input(['memory']) });
  assert.equal(candidates.isError, false);
  assert.deepEqual(f.demand.inspect(), [], 'only read_memory_context records demand');
  f.access.revoke();
  const result = await f.client.callTool({ name: 'read_memory_context', arguments: input(['card']) });
  assert.equal(result.isError, true);
  assert.deepEqual(f.demand.inspect(), [], 'R2J_REFUSED_DEMAND');
});
