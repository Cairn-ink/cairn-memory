import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { contextBudget, contextReadBudgetDiagnostic, withContextReadBudgetScope } from '../context-read-budget.mjs';
import { createFakeEmbedder } from '../context-read-embedder.mjs';
import { coreFixture, query, refresh, policy, ok, ns } from '../testing/context-read-core-fixture.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function budget({ embed = async texts => texts.map(() => [1]), selectedPolicy = {}, now } = {}) {
  const embedder = { id: 'synthetic-budget-' + randomUUID(), revision: '1', embed };
  const dispatch = contextBudget({ budgetConfigured: true, embedder,
    policy: { family: 'hosted', maxUsd: 10, maxRequests: 100, estimateUsd: () => 1, ...selectedPolicy } }, { now });
  return { embedder, dispatch, status: () => contextReadBudgetDiagnostic(embedder),
    run(budgetClass = 'query', scope, extra = {}) {
      const work = () => dispatch(embedder, ['synthetic'], { budgetClass, guard() {},
        signal: new AbortController().signal, deadlineAt: performance.now() + 5000, ...extra });
      return scope ? withContextReadBudgetScope(scope, work) : work();
    } };
}
const denied = (operation, f, reason, budgetClass) => assert.rejects(operation, error => {
  assert.equal(error.code, 'budget_denied');
  assert.deepEqual(Object.keys(error), ['code'], 'sub-reasons never escape in provider/read errors');
  assert.deepEqual(f.status().lastDenial, { class: budgetClass, reason }); return true;
});

for (const scoped of [false, true]) test(`R3 held maintenance permits a query (${scoped ? 'two host scopes' : 'single connection'})`, async t => {
  const hold = deferred(), entered = deferred(); let calls = 0;
  t.after(() => hold.resolve());
  const f = budget({ embed: async () => { if (++calls === 1) { entered.resolve(); await hold.promise; } return [[1]]; } });
  const pending = f.run('maintenance', scoped ? {} : undefined);
  await entered.promise;
  try {
    await f.run('query', scoped ? {} : undefined);
    assert.equal(calls, 2, 'query reached the embedding port during maintenance');
    assert.equal(f.status().maintenance.active, 1);
    assert.equal(f.status().query.active, 0);
  } finally { hold.resolve(); await pending; }
});

test('slots refuse immediately: one per connection, two queries server-wide by default, one maintenance', async t => {
  const hold = deferred(); t.after(() => hold.resolve());
  const f = budget({ embed: async () => { await hold.promise; return [[1]]; } });
  const a = {}, b = {}, c = {};
  const first = f.run('query', a), second = f.run('query', b), upkeep = f.run('maintenance', {});
  try {
    await denied(f.run('query', a), f, 'slot_busy', 'query');
    await denied(f.run('query', c), f, 'slot_busy', 'query');
    await denied(f.run('maintenance', {}), f, 'slot_busy', 'maintenance');
    assert.equal(f.status().query.active, 2);
    assert.equal(f.status().maintenance.active, 1);
  } finally { hold.resolve(); await Promise.all([first, second, upkeep]); }
  await f.run('query', c);
});

test('policy alone changes the hosted query concurrency ceiling; unbound still has one query slot', async t => {
  const hold = deferred(); t.after(() => hold.resolve());
  const f = budget({ selectedPolicy: { maxConcurrent: 3 }, embed: async () => { await hold.promise; return [[1]]; } });
  const operations = [f.run('query', {}), f.run('query', {}), f.run('query', {})];
  try { await denied(f.run('query', {}), f, 'slot_busy', 'query'); }
  finally { hold.resolve(); await Promise.all(operations); }
  const other = deferred(); t.after(() => other.resolve());
  const single = budget({ selectedPolicy: { maxConcurrent: 100 }, embed: async () => { await other.promise; return [[1]]; } });
  const pending = single.run();
  try { await denied(single.run(), single, 'slot_busy', 'query'); }
  finally { other.resolve(); await pending; }
});

for (const cap of ['usd', 'requests']) test(`server-wide ${cap} cap and shared reserve survive connection replacement`, async () => {
  let calls = 0;
  const f = budget({ selectedPolicy: cap === 'usd' ? { maxUsd: 10, maxRequests: 1000 } :
    { maxUsd: 1000, maxRequests: 10, estimateUsd: () => 0 }, embed: async () => { calls++; return [[1]]; } });
  // Nine different connections consume the one server maintenance allowance.
  for (let i = 0; i < 9; i++) await f.run('maintenance', {});
  await denied(f.run('maintenance', {}), f, 'maintenance_cap', 'maintenance');
  await f.run('query', {});
  await denied(f.run('query', {}), f, 'query_cap', 'query');
  await denied(f.run('maintenance', {}), f, 'maintenance_cap', 'maintenance');
  const status = f.status();
  assert.equal(calls, 10);
  assert.equal(status.maintenance.requests, 9);
  assert.equal(status.query.requests, 1);
  assert.equal(cap === 'usd' ? status.maintenance.usd + status.query.usd : status.maintenance.requests + status.query.requests, 10);
});

for (const cap of ['usd', 'requests']) test(`queries from many connections share the server ${cap} ceiling`, async () => {
  let calls = 0;
  const f = budget({ selectedPolicy: cap === 'usd' ? { maxUsd: 10, maxRequests: 1000 } :
    { maxUsd: 1000, maxRequests: 10, estimateUsd: () => 0 }, embed: async () => { calls++; return [[1]]; } });
  for (let i = 0; i < 10; i++) await f.run('query', {});
  await denied(f.run('query', {}), f, 'query_cap', 'query');
  await denied(f.run('maintenance', {}), f, 'maintenance_cap', 'maintenance');
  assert.equal(calls, 10);
  assert.equal(f.status().query.requests, 10);
  assert.equal(f.status().maintenance.requests, 0);
});

for (const maximum of [10, 20]) test(`reserve scales at 90/10 for a configured cap of ${maximum}`, async () => {
  const f = budget({ selectedPolicy: { maxUsd: maximum, maxRequests: maximum } });
  for (let i = 0; i < maximum * .9; i++) await f.run('maintenance');
  await denied(f.run('maintenance'), f, 'maintenance_cap', 'maintenance');
  for (let i = 0; i < maximum * .1; i++) await f.run('query', {});
  await denied(f.run('query', {}), f, 'query_cap', 'query');
});

test('large finite request ceilings keep an exact 90% maintenance limit', async () => {
  const f = budget({ selectedPolicy: { maxRequests: Number.MAX_SAFE_INTEGER } });
  await f.run('maintenance');
  assert.equal(f.status().maintenance.maxRequests, 8106479329266891);
  assert.equal(f.status().query.maxRequests, Number.MAX_SAFE_INTEGER);
});

test('queries spent first reduce maintenance headroom; finite request reserves round down', async () => {
  const f = budget({ selectedPolicy: { maxUsd: 10, maxRequests: 10 } });
  await f.run(); await f.run();
  for (let i = 0; i < 8; i++) await f.run('maintenance', {});
  await denied(f.run('maintenance', {}), f, 'maintenance_cap', 'maintenance');
  const tiny = budget({ selectedPolicy: { maxRequests: 1 } });
  await denied(tiny.run('maintenance'), tiny, 'maintenance_cap', 'maintenance');
  await tiny.run();
});

test('UTC rollover resumes maintenance and resets reused scoped slots; late settlement stays on its reservation day', async t => {
  let now = Date.parse('2026-01-01T23:59:59.000Z'), calls = 0;
  const hold = deferred(); t.after(() => hold.resolve());
  const f = budget({ now: () => now, selectedPolicy: { maxRequests: 10, maxUsd: 10, estimateUsd: () => 9 },
    embed: async (texts, controls) => { if (++calls === 1) { controls.settleUsd(1); await hold.promise; } return [[1]]; } });
  const scope = {}, pending = f.run('maintenance', scope);
  await denied(f.run('maintenance', scope), f, 'maintenance_cap', 'maintenance');
  assert.equal(f.status().day, '2026-01-01');
  now += 1000;
  await f.run('maintenance', scope);
  assert.equal(f.status().day, '2026-01-02');
  assert.equal(f.status().maintenance.usd, 9);
  hold.resolve(); await pending;
  assert.equal(f.status().maintenance.usd, 9, 'old-day refund does not lower today\'s charge');
  assert.equal(f.status().maintenance.active, 0, 'old-day release does not decrement today\'s slot');
  await denied(f.run('maintenance', scope), f, 'maintenance_cap', 'maintenance');
  now += 86400000;
  await f.run('maintenance', scope);
});

test('UTC rollover resets a connection query slot without a late release corrupting it', async t => {
  let now = Date.parse('2026-02-01T23:59:59Z'); const holds = [deferred(), deferred()]; let calls = 0;
  t.after(() => holds.forEach(h => h.resolve()));
  const f = budget({ now: () => now, embed: async () => { await holds[calls++].promise; return [[1]]; } });
  const scope = {}, old = f.run('query', scope); now += 1000;
  const current = f.run('query', scope);
  holds[0].resolve(); await old;
  assert.equal(f.status().query.active, 1);
  await denied(f.run('query', scope), f, 'slot_busy', 'query');
  holds[1].resolve(); await current;
  assert.equal(f.status().query.active, 0);
});

for (const scoped of [false, true]) test(`R3 real vector refresh and read use separate classes (${scoped ? 'host' : 'unbound'})`, async t => {
  const hold = deferred(), entered = deferred(), base = createFakeEmbedder(); let blocking = false, queries = 0;
  t.after(() => hold.resolve());
  const embedder = { ...base, async embed(texts, controls) {
    if (blocking && texts.some(text => text.includes('pending-document'))) { entered.resolve(); await hold.promise; }
    else if (blocking) queries++;
    return base.embed(texts, controls);
  } };
  const f = coreFixture(t, { cards: true, embedder, selectedPolicy: policy({ family: 'hosted' }) });
  f.admit('apple ready-document'); ok(await f.call('refreshContextIndex', refresh()));
  const card = ok(await f.host.call(f.context, 'createCardDraft', { namespace: ns, actionId: 'synthetic-draft', drafting: 'authored',
    input: { title: 'Synthetic pending-document', body: 'Synthetic upkeep', authoredInput: { text: 'Synthetic source', occurredAt: null } } }));
  ok(await f.host.call(f.context, 'confirmCardDraft', { namespace: ns, actionId: 'synthetic-confirm', cardId: card.id,
    expectedRevision: 1, applicability: 'current' }));
  blocking = true;
  const run = (scope, method, input) => scoped ? withContextReadBudgetScope(scope, () => f.call(method, input)) : f.call(method, input);
  const upkeep = run({}, 'refreshContextIndex', refresh({ types: ['card'] }));
  await Promise.race([entered.promise, upkeep.then(result => { throw Error('refresh did not enter: ' + JSON.stringify(result)); })]);
  try {
    const result = ok(await run({}, 'findCandidates', query({ semantic: true })));
    assert.ok(!result.channels.semantic.causes.includes('budget_denied'));
    assert.equal(queries, 1, 'user query embedded during a real refresh');
  } finally { hold.resolve(); ok(await upkeep); }
});
