import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { contextBudget } from '../context-read-budget.mjs';
import { contextOptions } from '../context-read-input.mjs';

function dispatcher(port, overrides = {}) {
  const options = contextOptions({ version: 'context-read-v1', authority: { authorize() {}, isCurrent() {} }, embedder: port,
    policy: { maxRequests: 1, maxUsd: 1, maxConcurrent: 1, estimateUsd: () => 1, ...overrides } });
  const dispatch = contextBudget(options);
  return (guard = () => {}) => dispatch(options.embedder, ['synthetic'], {
    signal: new AbortController().signal, deadlineAt: performance.now() + 5000, guard });
}
const port = embed => ({ id: 'budget-review-' + randomUUID(), revision: '1', dimensions: 1, normalization: 'none', embed });

test('R04/R10 review 1: concurrency, caps and family changes constrain the same cumulative requests and charges', async () => {
  let transmissions = 0;
  const embedder = port(() => { transmissions++; return [[1]]; });
  await dispatcher(embedder)();
  await assert.rejects(dispatcher(embedder, { maxConcurrent: 2 })(), { code: 'budget_denied' });
  await dispatcher(embedder, { family: 'hosted', maxRequests: 2, maxUsd: 2, maxConcurrent: 3 })();
  await assert.rejects(dispatcher(embedder, { maxRequests: 2, maxUsd: 100, maxConcurrent: 4 })(), { code: 'budget_denied' });
  await assert.rejects(dispatcher(embedder, { maxRequests: 100, maxUsd: 2, maxConcurrent: 5 })(), { code: 'budget_denied' });
  assert.equal(transmissions, 2);
});

test('R04/R10 review 1: active operations are shared across policy profiles until actual settlement', async () => {
  let release, calls = 0;
  const embedder = port(() => ++calls === 1 ? new Promise(resolve => { release = () => resolve([[1]]); }) : [[1]]);
  const first = dispatcher(embedder)();
  try {
    await assert.rejects(dispatcher(embedder, { maxRequests: 9, maxUsd: 9 })(), { code: 'budget_denied' });
    await dispatcher(embedder, { maxRequests: 9, maxUsd: 9, maxConcurrent: 2 })();
    await assert.rejects(dispatcher(embedder, { maxRequests: 9, maxUsd: 9 })(), { code: 'budget_denied' });
    assert.equal(calls, 2);
  } finally { release(); await first; }
  await assert.rejects(dispatcher(embedder, { maxRequests: 2, maxUsd: 99, maxConcurrent: 3 })(), { code: 'budget_denied' });
});

test('R06 review 5: revocation after reservation holds capacity before transport, then refunds an uninvoked port', async () => {
  let transmissions = 0, checks = 0, observed;
  const embedder = port(() => { transmissions++; return [[1]]; });
  const probe = dispatcher(embedder, { maxRequests: 9, maxUsd: 9 });
  await assert.rejects(dispatcher(embedder)(() => {
    if (++checks !== 3) return;
    // This reentrant reservation must see the first active slot, proving that
    // revocation happens after reservation rather than in the estimator.
    observed = probe().then(() => 'unexpected dispatch', error => error.code);
    throw Object.assign(Error('scope_changed'), { code: 'scope_changed' });
  }), { code: 'scope_changed' });
  assert.equal(await observed, 'budget_denied'); assert.equal(transmissions, 0);
  await dispatcher(embedder, { maxConcurrent: 2 })();
  assert.equal(transmissions, 1, 'uninvoked reservation released requests, USD and concurrency');
  await assert.rejects(dispatcher(embedder, { maxConcurrent: 3 })(), { code: 'budget_denied' });
});
