import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { contextBudget, contextReadBudgetDiagnostic, withContextReadBudgetScope } from '../context-read-budget.mjs';
import { contextOptions } from '../context-read-input.mjs';
import { rawSearchOptions } from '../raw-search-input.mjs';
import { createContextEmbedding } from '../../adapters/mcp/context-read-provider.mjs';
import { localPolicy } from '../../adapters/local-embedder/index.mjs';

// Construct the production policy with an inert credential, then replace the
// entire embedding port. No request reaches the OpenAI adapter or the network.
const hostedPolicy = () => createContextEmbedding(undefined, { OPENAI_API_KEY: 'synthetic-unused' }).policy;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function input(policy, embed = async () => [[1]]) {
  return { version: 'context-read-v1', authority: { authorize() {}, isCurrent() {} }, policy,
    embedder: { id: 'synthetic-concurrency-' + randomUUID(), revision: '1', dimensions: 1, normalization: 'none', embed },
    ...(policy.maxBatchDocuments ? { localStatus: () => ({ state: 'ready', reason: null }) } : {}) };
}
function rawInput(policy) {
  const { embedder, authority } = input(policy);
  return { version: 'raw-search-v1', backend: 'local', ownerId: 'synthetic', path: '/synthetic/store.sqlite',
    directory: '/synthetic/raw', readSet: [{ ownerId: 'synthetic', scope: 'personal', projectId: null }],
    authority, crypto: { version: 'raw-seal-v1', openRaw() {} }, embedder,
    policy: { ...policy, ...(policy.family === 'local' ? { maxUsd: 0 } : {}) } };
}
function fixture(policy, hold) {
  let calls = 0;
  const options = contextOptions(input(policy, async () => { calls++; await hold.promise; return [[1]]; }));
  const dispatch = contextBudget(options);
  return { get calls() { return calls; }, status: () => contextReadBudgetDiagnostic(options.embedder),
    run(scope, budgetClass = 'query') {
      const work = () => dispatch(options.embedder, ['synthetic'], { budgetClass, guard() {},
        signal: new AbortController().signal, deadlineAt: performance.now() + 5000 });
      return scope ? withContextReadBudgetScope(scope, work) : work();
    } };
}
async function busy(f, operation, budgetClass = 'query') {
  await assert.rejects(operation, { code: 'budget_denied' });
  assert.deepEqual(f.status().lastDenial, { class: budgetClass, reason: 'slot_busy' });
}

test('default hosted policy embeds four held connections plus maintenance; fifth query is slot_busy', async t => {
  const hold = deferred(); t.after(() => hold.resolve());
  const f = fixture(hostedPolicy(), hold), scopes = Array.from({ length: 4 }, () => ({}));
  const operations = scopes.map(scope => f.run(scope));
  operations.push(f.run({}, 'maintenance'));
  const settled = Promise.allSettled(operations);
  let results;
  try {
    assert.equal(f.calls, 5, 'all four queries and maintenance reached the fake embedding port');
    assert.equal(f.status().query.active, 4);
    assert.equal(f.status().maintenance.active, 1);
    await busy(f, f.run({}));
    await busy(f, f.run(scopes[0]));
    await busy(f, f.run({}, 'maintenance'), 'maintenance');
    assert.equal(f.calls, 5, 'busy attempts never invoke the embedder');
  } finally { hold.resolve(); results = await settled; }
  assert.ok(results.every(result => result.status === 'fulfilled'));
});

test('default local CPU policy embeds one held query; second connection is slot_busy', async t => {
  const hold = deferred(); t.after(() => hold.resolve());
  const f = fixture(localPolicy(100), hold), pending = f.run({});
  try {
    await busy(f, f.run({}));
    assert.equal(f.calls, 1);
    assert.equal(f.status().query.active, 1);
  } finally { hold.resolve(); await pending; }
});

test('maxConcurrentQueries controls scoped queries independently of legacy maxConcurrent; unbound keeps one', async t => {
  const hold = deferred(); t.after(() => hold.resolve());
  const f = fixture({ ...hostedPolicy(), maxConcurrent: 1, maxConcurrentQueries: 2 }, hold);
  const settled = Promise.allSettled([f.run({}), f.run({})]);
  try { assert.equal(f.calls, 2); await busy(f, f.run({})); }
  finally { hold.resolve(); await settled; }
  const other = deferred(); t.after(() => other.resolve());
  const single = fixture({ ...hostedPolicy(), maxConcurrent: 16, maxConcurrentQueries: 16 }, other);
  const pending = single.run();
  try { await busy(single, single.run()); assert.equal(single.calls, 1); }
  finally { other.resolve(); await pending; }
});

test('query policy accepts integers 1 through 16 and rejects every invalid supplied value', () => {
  for (const base of [hostedPolicy(), localPolicy(100)]) {
    for (const maxConcurrentQueries of [1, 16]) {
      assert.equal(contextOptions(input({ ...base, maxConcurrentQueries })).policy.maxConcurrentQueries, maxConcurrentQueries);
      assert.equal(rawSearchOptions(rawInput({ ...base, maxConcurrentQueries })).policy.maxConcurrentQueries, maxConcurrentQueries);
    }
    for (const maxConcurrentQueries of [undefined, null, 0, -1, 1.5, 17, Infinity, NaN, '4', true, {}, []]) {
      const value = input({ ...base, maxConcurrentQueries });
      assert.throws(() => contextOptions(value), { code: 'invalid_input' });
      assert.throws(() => contextBudget({ ...value, budgetConfigured: true }), { code: 'invalid_input' });
      assert.throws(() => rawSearchOptions(rawInput(value.policy)), { code: 'invalid_input' });
    }
    const { maxConcurrentQueries, ...legacy } = base;
    assert.equal(contextOptions(input(legacy)).policy.maxConcurrentQueries, base.family === 'hosted' ? 4 : 1);
  }
});

// The hosted product's own policy shape (no maxConcurrentQueries). The product
// hands it to the durable semantic worker, not to this ledger; this pins what
// the same shape would get here: the hosted family default of four queries,
// with the legacy maxConcurrent field accepted.
test('product-shaped hosted policy without maxConcurrentQueries admits four scoped queries; fifth is slot_busy', async t => {
  const hold = deferred(); t.after(() => hold.resolve());
  const policy = { family: 'hosted', maxRequests: 1000000, maxConcurrent: 4, maxUsd: 20, estimateUsd: hostedPolicy().estimateUsd };
  const f = fixture(policy, hold);
  const settled = Promise.allSettled(Array.from({ length: 4 }, () => f.run({})));
  try {
    assert.equal(f.calls, 4, 'four product-shaped queries reached the fake embedding port');
    assert.equal(f.status().query.active, 4);
    await busy(f, f.run({}));
    assert.equal(f.calls, 4, 'the fifth query never invokes the embedder');
  } finally { hold.resolve(); await settled; }
});
