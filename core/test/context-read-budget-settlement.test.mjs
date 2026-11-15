import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { contextBudget, contextReadBudgetDiagnostic, withContextReadBudgetScope } from '../context-read-budget.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture({ maxUsd = 1, estimateUsd = () => .4, embed, now } = {}) {
  const embedder = { id: 'synthetic-settlement-' + randomUUID(), revision: '1', embed };
  const dispatch = contextBudget({ budgetConfigured: true, embedder,
    policy: { family: 'hosted', maxRequests: 100, maxUsd, maxConcurrentQueries: 4, estimateUsd } }, { now });
  return { status: () => contextReadBudgetDiagnostic(embedder),
    run: (budgetClass = 'query', text = 'synthetic') => withContextReadBudgetScope({}, () => dispatch(embedder, [text], {
      budgetClass, guard() {}, signal: new AbortController().signal, deadlineAt: performance.now() + 5000 })) };
}
async function denied(f, budgetClass) {
  await assert.rejects(f.run(budgetClass, 'zero'), { code: 'budget_denied' });
  assert.deepEqual(f.status().lastDenial, { class: budgetClass, reason: budgetClass + '_cap' });
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

test('UTC day never rolls backwards to a fresh allowance', async () => {
  let now = Date.parse('2026-01-01T23:59:59Z');
  const f = fixture({ now: () => now, estimateUsd: () => 1, embed: async () => [[1]] });
  await f.run(); await denied(f, 'query');
  now += 1000; await f.run();
  now -= 1000; await denied(f, 'query');
  assert.equal(f.status().day, '2026-01-02'); assert.equal(f.status().query.requests, 1);
  now += 86401000; await f.run(); assert.equal(f.status().day, '2026-01-03');
});

test('upward query settlement delivers both scoped results, records actual 1.20 and denies even zero estimates', async t => {
  const hold = deferred(); t.after(() => hold.resolve());
  const f = fixture({ estimateUsd: ([text]) => text === 'zero' ? 0 : .4,
    embed: async (texts, controls) => { await hold.promise; controls.settleUsd(.6); return [[1]]; } });
  const calls = [f.run(), f.run()]; near(f.status().query.usd, .8);
  hold.resolve(); assert.deepEqual(await Promise.all(calls), [[[1]], [[1]]]);
  near(f.status().query.usd, 1.2); assert.equal(f.status().query.requests, 2);
  await denied(f, 'query'); await denied(f, 'maintenance');
});

test('upward maintenance settlement records actual 1.20 across its 90% line and preserves both results', async () => {
  // Maintenance has one slot: after the first .60 settlement the next .30
  // estimate fits exactly beneath .90, and its .60 actual crosses the line.
  let calls = 0;
  const f = fixture({ estimateUsd: ([text]) => text === 'zero' ? 0 : calls ? .3 : .4,
    embed: async (texts, controls) => { calls++; controls.settleUsd(.6); return [[1]]; } });
  assert.deepEqual(await f.run('maintenance'), [[1]]);
  assert.deepEqual(await f.run('maintenance'), [[1]]);
  near(f.status().maintenance.usd, 1.2); assert.equal(calls, 2);
  await denied(f, 'maintenance'); await denied(f, 'query');
});

test('two scoped maintenance .40 estimates settle at .60 each across a 1.00 maintenance ceiling', async () => {
  // One maintenance slot serializes the calls. Set its 90% line to 1.00 so
  // the second .40 reservation still fits after the first .60 settlement.
  const f = fixture({ maxUsd: 10 / 9, estimateUsd: ([text]) => text === 'zero' ? 0 : .4,
    embed: async (texts, controls) => { controls.settleUsd(.6); return [[1]]; } });
  assert.deepEqual(await f.run('maintenance'), [[1]]);
  assert.deepEqual(await f.run('maintenance'), [[1]]);
  assert.equal(f.status().maintenance.maxUsd, 1);
  near(f.status().maintenance.usd, 1.2); assert.equal(f.status().maintenance.requests, 2);
  await denied(f, 'maintenance');
});

for (const actual of [.9, .95]) test(`maintenance settling at ${actual} blocks its class and leaves query headroom`, async () => {
  const f = fixture({ estimateUsd: ([text]) => text === 'zero' ? 0 : .4,
    embed: async ([text], controls) => { controls.settleUsd(text === 'zero' ? 0 : actual); return [[1]]; } });
  assert.deepEqual(await f.run('maintenance'), [[1]]);
  near(f.status().maintenance.usd, actual);
  await denied(f, 'maintenance');
  assert.deepEqual(await f.run('query', 'zero'), [[1]]);
});

for (const budgetClass of ['query', 'maintenance']) test(`${budgetClass} reached cap stays reached after a later refund, then resets next UTC day`, async t => {
  const hold = deferred(); t.after(() => hold.resolve());
  let now = Date.parse('2026-01-01T12:00:00Z');
  const cap = budgetClass === 'maintenance' ? .9 : 1;
  const f = fixture({ now: () => now, estimateUsd: ([text]) => text === 'zero' ? 0 : .4,
    embed: async ([text], controls) => {
      if (text === 'refund') { await hold.promise; controls.settleUsd(0); }
      else controls.settleUsd(cap);
      return [[1]];
    } });
  // The other class holds a conservative charge while this class reaches its
  // own ceiling. The subsequent refund cannot reopen either reached ceiling.
  const pending = f.run(budgetClass === 'query' ? 'maintenance' : 'query', 'refund');
  assert.deepEqual(await f.run(budgetClass), [[1]]);
  await denied(f, budgetClass);
  hold.resolve(); await pending;
  near(f.status()[budgetClass].usd, cap);
  await denied(f, budgetClass);
  now += 86400000; assert.deepEqual(await f.run(budgetClass), [[1]]);
});

test('combined cap stays reached after other in-flight usage refunds below the cap', async t => {
  const hold = deferred(); t.after(() => hold.resolve());
  const f = fixture({ estimateUsd: ([text]) => text === 'zero' ? 0 : .4,
    embed: async ([text], controls) => {
      if (text === 'refund') { await hold.promise; controls.settleUsd(0); }
      else controls.settleUsd(.7);
      return [[1]];
    } });
  const pending = f.run('query', 'refund'); await f.run('query');
  hold.resolve(); await pending; near(f.status().query.usd, .7);
  await denied(f, 'query'); await denied(f, 'maintenance');
});

for (const budgetClass of ['query', 'maintenance']) test(`honest ${budgetClass} estimates never exceed the cap`, async t => {
  const hold = deferred(); t.after(() => hold.resolve());
  const f = fixture({ embed: async (texts, controls) => { await hold.promise; controls.settleUsd(.3); return [[1]]; } });
  const calls = [f.run(budgetClass)];
  if (budgetClass === 'query') calls.push(f.run(budgetClass));
  hold.resolve(); await Promise.all(calls);
  for (let n = 0; n < 4; n++) {
    try { await f.run(budgetClass); } catch (error) { assert.equal(error.code, 'budget_denied'); }
    assert.ok(f.status().query.usd + f.status().maintenance.usd <= 1);
    assert.ok(f.status().maintenance.usd <= .9);
  }
});
