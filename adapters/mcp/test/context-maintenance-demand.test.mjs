import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { join } from 'node:path';
import { renameSync, statSync } from 'node:fs';
import { safetyFixture } from '../../../core/testing/content-safety-s2h-fixture.mjs';
import { fixture as dependencyFixture, host as dependencyHost, ns as dependencyNamespace } from '../../../core/test/card-current-fixture.mjs';
import { writeContentSuppressionInside } from '../../../core/content-suppression-storage.mjs';
import { transaction } from '../../../core/database.mjs';
import { DatabaseSync } from 'node:sqlite';
import { Client } from '@modelcontextprotocol/client';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { openMemoryCore } from '../../../core/contract.mjs';
import { createFakeEmbedder } from '../../../core/context-read-embedder.mjs';
import { createCommitDispatcher } from '../../../core/commit-dispatch.mjs';
import { observeContextMaintenance } from '../../../core/context-read-facade.mjs';
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

test('a: no recent reads selects the combined view on every turn', async t => {
  const f = selectionFixture(t);
  for (let i = 0; i < 12; i++) await f.loop.tick();
  assert.deepEqual(f.selected, Array.from({ length: 12 }, () => combined), 'R2J_COMBINED_ONLY');
  assert.deepEqual(f.demand.inspect(), []);
});

test('combined-only demand keeps every turn combined and is retained', async t => {
  const f = selectionFixture(t);
  f.demand.note(combined);
  for (let i = 0; i < 12; i++) await f.loop.tick();
  assert.deepEqual(f.selected, Array.from({ length: 12 }, () => combined), 'R2J_COMBINED_ONLY');
  assert.deepEqual(f.demand.inspect(), [['combined', 100]], 'R2K_COMBINED_RECORDED');
});

test('pending demanded views retain a full round-robin turn sequence', async t => {
  const f = selectionFixture(t);
  for (const types of [combined, ['memory'], ['card']]) f.demand.note(types);
  for (let i = 0; i < 15; i++) await f.loop.tick();
  assert.deepEqual(f.selected, Array.from({ length: 15 }, (_, i) => [combined, ['memory'], ['card']][i % 3]),
    'R2K_ACTIVE_VIEWS_ROUND_ROBIN');
});

test('d: every demanded view expires at 30 minutes and resumes combined-only turns', async t => {
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

test('f: retained demand contains only three enum/timestamp pairs, copied on inspection', () => {
  let now = 10;
  const demand = createContextMaintenanceDemand(() => now);
  for (const types of [[], ['raw'], ['memory', 'memory'], ['memory', 'raw'], ['memory','card','raw']]) demand.note(types);
  assert.deepEqual(demand.inspect(), []);
  const types = ['memory']; demand.note(types); types[0] = 'synthetic request text';
  now = 20; demand.note(['card']); now = 30; demand.note(['memory']);
  now = 40; demand.note(['card', 'memory']);
  assert.deepEqual(demand.inspect(), [['memory', 30], ['card', 20], ['combined', 40]]);
  const inspected = demand.inspect(); inspected[0][0] = 'changed'; inspected.push(['extra', 0]);
  assert.deepEqual(demand.inspect(), [['memory', 30], ['card', 20], ['combined', 40]], 'R2J_DEMAND_PRIMITIVES');
  assert.deepEqual(createContextMaintenanceDemand().inspect(), [], 'hosts do not share demand');
});

async function realFixture(t, { path: sourcePath, cards = cardHost(), shared = false } = {}) {
  const w = createTestWorkspace(t), path = sourcePath ?? join(w.path, 'synthetic-demand.sqlite');
  const access = createContextReadAccess(ns, false, { maintenance: true });
  const host = shared ? createCommitDispatcher({ strict: true }) : null;
  const open = () => openMemoryCore({ path, raw: true, privateCards: cards.options,
    contextRead: { ...access.configuration, embedder: createFakeEmbedder(), counter,
      policy: { family: 'local', maxRequests: 10000, maxUsd: 1, estimateUsd: () => 0 } } });
  const core = host ? host.open(open) : open();
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
  return { core, access, client, demand, path, cards, card: draft };
}

for (const wanted of [[combined], [['memory']], [['card']], [combined, ['memory']], [['memory'], ['card']], [combined, ['memory'], ['card']]]) {
  test(`b/c: successful reads schedule only ${JSON.stringify(wanted)} round-robin and reach semantic ready`, { timeout: 15000 }, async t => {
    const f = await realFixture(t), selected = [];
    for (const types of wanted) await context(f.client, input(types));
    const loop = drivenLoop(t, f.core, { ...f.access, call(core, method, args) {
      selected.push(args.types); return f.access.call(core, method, args);
    } }, { demand: f.demand });
    for (let i = 0; i < 16; i++) await loop.tick();
    assert.deepEqual(selected.slice(0, wanted.length), wanted, 'R2K_ACTIVE_VIEWS_ROUND_ROBIN');
    assert.ok(selected.every(types => wanted.some(view => JSON.stringify(view) === JSON.stringify(types)) ||
      JSON.stringify(types) === JSON.stringify(combined)), 'only demanded views or the idle combined fallback');
    if (wanted.length === 1 && wanted[0].length === 2) {
      assert.deepEqual(selected, Array.from({ length: 16 }, () => combined), 'R2M_REAL_COMBINED_EVERY_TURN');
    }
    for (const types of wanted) {
      const result = await context(f.client, input(types));
      assert.equal(result.diagnostics.candidates.channels.semantic.state, 'ready', 'R2J_FILTERED_READY');
    }
  });
}

test('e: invalid and refused MCP reads record no demand', { timeout: 15000 }, async t => {
  const f = await realFixture(t);
  assert.deepEqual(f.demand.inspect(), []);
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

test('idle Card views skip turns, external writes re-enable them, and all-idle turns refresh only combined', { timeout: 15000 }, async t => {
  const f = await realFixture(t), selected = [];
  // Keep Memory pending after the one-Card projection has finished.
  for (let i = 0; i < 24; i++) ok(await f.core.admit({ namespace: ns,
    memory: { content: 'Synthetic idle-view backlog ' + i, kind: 'fact' },
    receipts: [{ client: 'synthetic', sessionId: 'idle', eventId: String(i), role: 'user', excerpt: 'Synthetic backlog receipt' }] }));
  f.demand.note(['memory']); f.demand.note(['card']);
  const loop = drivenLoop(t, f.core, { ...f.access, async call(core, method, args) {
    const result = await f.access.call(core, method, args);
    selected.push({ types: args.types, result }); return result;
  } }, { demand: f.demand });
  await loop.tick(); await loop.tick();
  assert.deepEqual(selected.map(call => call.types), [['memory'], ['card']], 'pending views retain round-robin order');
  assert.notEqual(selected[0].result.value.status, 'complete', 'control: Memory is still pending when Card finishes');
  assert.equal(selected[1].result.value.status, 'complete', 'control: Card refresh has no remaining work');
  const cardTurns = () => selected.filter(call => call.types.length === 1 && call.types[0] === 'card').length;
  for (let i = 0; i < 6; i++) await loop.tick();
  assert.equal(cardTurns(), 1, 'R2M_IDLE_CARD_SKIPPED');
  // Drain the bounded Memory/combined work, then measure only idle turns.
  for (let i = 0; i < 16; i++) await loop.tick();
  selected.length = 0;
  for (let i = 0; i < 4; i++) await loop.tick();
  assert.deepEqual(selected.map(call => call.types), Array.from({ length: 4 }, () => combined), 'R2M_NO_IDLE_EXTRA_WORK');
  assert.ok(selected.every(call => call.result.value.status === 'complete'), 'control: all demanded/combined views have drained');
  const writer = openMemoryCore({ path: f.path, raw: false });
  try { ok(writer.admit({ namespace: ns, memory: { content: 'Synthetic external write after ready', kind: 'fact' },
    receipts: [{ client: 'synthetic', sessionId: 'idle', eventId: 'external', role: 'user', excerpt: 'Synthetic external receipt' }] })); }
  finally { writer.close(); }
  // A new read after the change must not inherit an indefinitely skipped view.
  await context(f.client, input(['card']));
  selected.length = 0;
  for (let i = 0; i < 3; i++) await loop.tick();
  assert.ok(cardTurns() >= 1, 'R2M_IDLE_WRITE_REENABLES_CARD');
});

for (const locked of ['canonical', 'sidecar']) test(`idle fence probe retries ${locked} BUSY outside transactions`, { timeout: 10000 }, async t => {
  const w = createTestWorkspace(t), path = join(w.path, 'idle-fence.sqlite');
  const access = createContextReadAccess(ns, false, { maintenance: true });
  let holder, backoffs = 0;
  const host = createCommitDispatcher({ strict: true, onBackoff() {
    backoffs++;
    assert.ok(host.inspectTransactions().every(state => state.isTransaction === false));
    assert.ok(host.inspectBusyTimeouts().every(value => value === 5000), 'R2M_IDLE_FENCE_TIMEOUT_RESTORE');
    holder.exec('ROLLBACK');
  } });
  const core = host.open(() => openMemoryCore({ path, raw: false,
    contextRead: { ...access.configuration, embedder: createFakeEmbedder(), counter,
      policy: { family: 'local', maxRequests: 10000, maxUsd: 1, estimateUsd: () => 0 } } }));
  w.defer(() => core.close());
  ok(await core.admit({ namespace: ns, memory: { content: 'Synthetic fence probe source', kind: 'fact' },
    receipts: [{ client: 'synthetic', sessionId: 'fence', eventId: 'source', role: 'user', excerpt: 'Synthetic fence probe source' }] }));
  const observation = await observeContextMaintenance(() => access.call(core, 'refreshContextIndex', {
    readSet: [ns], types: ['memory'], intent: 'current', budget: { maxItems: 16, maxMs: 1000 },
  }));
  assert.equal(ok(observation.result).status, 'complete');
  assert.equal(typeof observation.current, 'function');
  holder = new DatabaseSync(locked === 'canonical' ? path : path + '.context-read-v1.sqlite');
  try {
    holder.exec('BEGIN EXCLUSIVE');
    assert.equal(await observation.current(), true, 'R2M_IDLE_FENCE_RETRY');
    assert.ok(backoffs >= 1, 'R2M_IDLE_FENCE_BUSY_OBSERVED');
    assert.ok(host.inspectBusyTimeouts().every(value => value === 5000), 'R2M_IDLE_FENCE_TIMEOUT_RESTORE');
    assert.equal(host.inspectSynchronousWrites().count, 0);
  } finally {
    if (holder.isTransaction) holder.exec('ROLLBACK');
    holder.close();
  }
});

async function idleFixture(t, fixture) {
  const f = fixture ?? await realFixture(t, { shared: true }), selected = [];
  f.demand.note(['memory']); f.demand.note(['card']);
  let refuseCard = false, currentCard, refusedFence;
  const set = Map.prototype.set;
  t.mock.method(Map.prototype, 'set', function(key, value) {
    // Wrap only the real maintenance idle predicate. A one-turn probe refusal
    // leaves its durable fence intact and makes entry removal observable.
    if (key === 'card' && typeof value === 'function' &&
        Function.prototype.toString.call(value).includes('storage.assertState(projection, expected')) {
      currentCard = value;
      const current = value;
      value = () => refuseCard ? false : current();
    }
    return Reflect.apply(set, this, [key, value]);
  });
  const loop = drivenLoop(t, f.core, { ...f.access, async call(core, method, args) {
    const result = refuseCard && args.types.length === 1 && args.types[0] === 'card'
      ? (refuseCard = false, { ok: false, error: { code: 'index_unavailable', retryable: false } })
      : await f.access.call(core, method, args);
    selected.push({ types: args.types, result }); return result;
  } }, { demand: f.demand });
  for (let i = 0; i < 16; i++) await loop.tick();
  selected.length = 0;
  for (let i = 0; i < 3; i++) await loop.tick();
  assert.deepEqual(selected.map(call => call.types), Array.from({ length: 3 }, () => combined),
    'control: both views are complete and skipped before invalidation ' + JSON.stringify(selected));
  selected.length = 0;
  return { ...f, selected, loop, refuseNextCard() { assert.ok(currentCard, 'a real Card idle predicate was installed'); refusedFence = currentCard; refuseCard = true; }, refusedFenceCurrent() { return refusedFence(); } };
}
const cardTurns = f => f.selected.filter(call => call.types.length === 1 && call.types[0] === 'card');
async function resumesReady(f, marker) {
  for (let i = 0; i < 6; i++) await f.loop.tick();
  assert.ok(cardTurns(f).some(call => call.result.ok && call.result.value.status === 'complete'), marker + ' ' + JSON.stringify(f.selected));
  const result = await context(f.client, input(['card']));
  assert.equal(result.diagnostics.candidates.channels.semantic.state, 'ready', marker + '_READY');
}

test('an owner suppression epoch change re-enables an idle Card view and reaches ready', { timeout: 15000 }, async t => {
  const safety = safetyFixture(t, 23); await safety.migrate();
  const base = await realFixture(t, { path: safety.path, shared: true });
  const otherNamespace = { ownerId: ns.ownerId, scope: 'project', projectId: 'synthetic-other-project' };
  const victim = ok(await base.core.admit({ namespace: otherNamespace,
    memory: { content: 'Synthetic other-project source to forget', kind: 'fact' },
    receipts: [{ client: 'synthetic', sessionId: 'owner-epoch', eventId: 'other', role: 'user', excerpt: 'Synthetic other source' }] })).memory;
  const f = await idleFixture(t, base), db = safety.connect();
  try {
    const epoch = () => db.prepare("SELECT epoch FROM namespace_epochs WHERE owner_id=? AND scope='personal'").get(ns.ownerId).epoch;
    const before = epoch();
    // The same owner's other namespace advances the owner suppression epoch.
    // The demanded namespace stays readable and may legitimately reach ready.
    transaction(db, () => writeContentSuppressionInside(db, { namespace: otherNamespace, kind: 'memory', key: victim.id,
      reason: 'user_forget', actionId: 'synthetic-idle-owner-epoch' }));
    assert.equal(epoch(), before, 'control: the demanded Memory namespace epoch is unchanged');
  } finally { db.close(); }
  await resumesReady(f, 'R2N_IDLE_SUPPRESSION_REENABLES_CARD');
});

test('a Card dependency change re-enables an idle view and reaches ready', { timeout: 15000 }, async t => {
  const h = dependencyHost(), fixture = dependencyFixture(t, { h, contextRead: { ...h.context,
    embedder: createFakeEmbedder(), policy: { family: 'local', maxRequests: 10000, maxUsd: 1, estimateUsd: () => 0 } } });
  const ref = fixture.card(), selected = [], demand = createContextMaintenanceDemand();
  demand.note(['memory']); demand.note(['card']);
  const loop = drivenLoop(t, fixture.core, { readSet: [dependencyNamespace], async call(core, method, args) {
    const result = await fixture.call(method, args); selected.push({ types: args.types, result }); return result;
  } }, { demand });
  for (let i = 0; i < 16; i++) await loop.tick();
  selected.length = 0;
  for (let i = 0; i < 3; i++) await loop.tick();
  assert.deepEqual(selected.map(call => call.types), Array.from({ length: 3 }, () => combined), 'control: dependency view is skipped');
  const epochs = () => [fixture.db.prepare('SELECT epoch FROM namespace_epochs LIMIT 1').get()?.epoch,
    fixture.db.prepare('SELECT generation FROM card_epochs LIMIT 1').get().generation];
  const before = epochs();
  fixture.change();
  assert.deepEqual(epochs(), before, 'dependency adoption changes neither Memory nor Card epochs');
  assert.equal(ok(fixture.call('getCard', { namespace: dependencyNamespace, cardId: ref.cardId })).card.support.currentDependency.status, 'needs-review');
  selected.length = 0;
  for (let i = 0; i < 6; i++) await loop.tick();
  const turns = selected.filter(call => call.types.length === 1 && call.types[0] === 'card');
  assert.ok(turns.some(call => call.result.ok && call.result.value.status === 'complete' &&
    call.result.value.channels.semantic.state === 'ready'), 'R2N_IDLE_DEPENDENCY_REENABLES_CARD');
});

test('sidecar replacement and reopen re-enable an idle Card view and reach ready', { timeout: 15000 }, async t => {
  const f = await idleFixture(t), path = f.path + '.context-read-v1.sqlite';
  const previous = statSync(path).ino;
  // Metadata rename only. The reader detects the missing incarnation, closes
  // its old SQLite handle and opens/rebuilds a new sidecar from canonical data.
  renameSync(path, path + '.retired');
  await resumesReady(f, 'R2N_IDLE_REOPEN_REENABLES_CARD');
  assert.notEqual(statSync(path).ino, previous, 'a genuinely new sidecar incarnation is open');
});

test('a refused refresh removes idle state and the view recovers to ready', { timeout: 15000 }, async t => {
  const f = await idleFixture(t);
  // No durable invalidation: after the one refused refresh, a stale cached
  // entry would say current forever unless the refusal branch removes it.
  f.refuseNextCard();
  for (let i = 0; i < 3; i++) await f.loop.tick();
  assert.ok(cardTurns(f).some(call => !call.result.ok), 'R2N_IDLE_REFRESH_REFUSED');
  assert.equal(await f.refusedFenceCurrent(), true, 'R2O_IDLE_REFUSAL_ENTRY: the prior durable fence remains current');
  await resumesReady(f, 'R2N_IDLE_REFUSAL_RECOVERS R2O_IDLE_REFUSAL_ENTRY');
});

for (const shared of [false, true]) for (const operation of ['forget', 'correct']) test(`same-namespace ${operation} keeps taking refused maintenance turns shared=${shared}`, { timeout: 15000 }, async t => {
  const safety = safetyFixture(t, 23); await safety.migrate();
  const base = await realFixture(t, { path: safety.path, shared });
  const victim = ok(await base.core.admit({ namespace: ns,
    memory: { content: 'Synthetic same-namespace idle victim', kind: 'fact' },
    receipts: [{ client: 'synthetic', sessionId: 'same-namespace', eventId: 'victim', role: 'user', excerpt: 'Synthetic idle victim' }] })).memory;
  const f = await idleFixture(t, base);
  ok(await f.core[operation]({ namespace: ns, memoryId: victim.id, expectedRevision: victim.revision,
    ...(operation === 'correct' ? { content: 'Synthetic revised idle source', kind: 'fact',
      receipt: { client: 'synthetic', sessionId: 'same-namespace', eventId: 'correction', role: 'user', excerpt: 'Synthetic revised idle source' } } : {}) }));
  // Coordinator 11-14, D2: main refuses the public acknowledgement while this
  // namespace has a suppression fact. Refusal must never make the view idle.
  for (let cycle = 0; cycle < 3; cycle++) {
    const before = f.selected.length;
    await f.loop.tick(); await f.loop.tick();
    assert.deepEqual(f.selected.slice(before).map(call => call.types[0]).sort(), ['card', 'memory'],
      'R2O3_SAME_NAMESPACE_TURNS ' + operation + ' shared=' + shared);
  }
  assert.equal(cardTurns(f).length, 3, 'R2O3_SAME_NAMESPACE_TURNS: the Card view is never skipped');
  for (const turn of cardTurns(f)) assert.deepEqual(turn.result,
    { ok: false, error: { code: 'index_unavailable', retryable: false } }, 'same-namespace public refusal is preserved');
  const acknowledgement = await f.access.call(f.core, 'refreshContextIndex', { readSet: [ns], types: ['card'],
    intent: 'current', budget: { maxItems: 16, maxMs: 1000 } });
  assert.deepEqual(acknowledgement, { ok: false, error: { code: 'index_unavailable', retryable: false } });
});
