import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { QUARANTINED } from '../common.mjs';
import { localEmbeddingFactory } from '../index.mjs';
import { contextOptions } from '../../../core/context-read-input.mjs';
import { contextBudget } from '../../../core/context-read-budget.mjs';
const authority = { authorize() {}, isCurrent() {} };
const status = () => Object.freeze({ state: 'ready', reason: null });
function setup() {
  const metadata = { id: 'local-test-' + randomUUID(), revision: 'sha256:fixture', dimensions: 1024, normalization: 'l2' };
  let starts = 0, closes = 0, calls = 0, behavior = () => [Float32Array.from({ length: 1024 }, (_, i) => i ? 0 : 1)];
  const factory = localEmbeddingFactory({ registry: new Map(), verify: async () => ({ metadata }), start: async () => { starts++; return { localStatus: status, async embed(...args) { calls++; return behavior(...args); }, async close() { closes++; } }; } });
  return { factory, get starts() { return starts; }, get closes() { return closes; }, get calls() { return calls; }, set behavior(v) { behavior = v; } };
}
test('L09 explicit policy refuses fictitious USD and requires only synchronous local observer', () => {
  const embedder = { id: 'x', revision: '1', dimensions: 1, normalization: 'none', embed() {} }, policy = { family: 'local', maxRequests: 3, maxConcurrent: 1, maxBatchDocuments: 1 };
  const input = { version: 'context-read-v1', authority, embedder, policy, localStatus: status };
  assert.equal(contextOptions(input).budgetConfigured, true);
  for (const bad of [{ maxUsd: 0 }, { estimateUsd: () => 0 }, { settleUsd: () => {} }, { maxConcurrent: 2 }, { maxBatchDocuments: 2 }]) assert.throws(() => contextOptions({ ...input, policy: { ...policy, ...bad } }), { code: 'invalid_input' });
  for (const localStatus of [undefined, null, async () => status()]) assert.throws(() => contextOptions({ ...input, localStatus }), { code: 'invalid_input' });
  assert.throws(() => contextOptions({ ...input, policy: { family: 'hosted', maxRequests: 1, maxUsd: 1, estimateUsd: () => 0 } }), { code: 'invalid_input' });
});
test('L09 shared child ownership, conflicting threads, identity/path independence and cumulative reopening allowance', async () => {
  const f = setup(), args = { packPath: '/synthetic/one', maxRequests: 2 };
  const [a, b] = await Promise.all([f.factory(args), f.factory({ ...args, packPath: '/synthetic/two' })]);
  assert.equal(f.starts, 1); assert.equal(a.embedder.revision, b.embedder.revision);
  await assert.rejects(f.factory({ ...args, threads: 3 }), { code: 'invalid_input' });
  await a.embedder.embed(['one']); await a.close(); assert.equal(f.closes, 0);
  await b.embedder.embed(['two']); await b.close(); assert.equal(f.closes, 1);
  const c = await f.factory(args); assert.equal(f.starts, 2);
  await assert.rejects(c.embedder.embed(['third']), { code: 'budget_denied' }); assert.equal(f.calls, 2); await c.close(); await c.close();
});
test('L09 core dispatch and direct port share a single reservation with no USD callback', async () => {
  const f = setup(), a = await f.factory({ packPath: '/synthetic/one', maxRequests: 1 });
  const options = contextOptions({ version: 'context-read-v1', authority, ...{ embedder: a.embedder, policy: a.policy, localStatus: a.localStatus } });
  await contextBudget(options)(options.embedder, ['synthetic'], { signal: new AbortController().signal, deadlineAt: performance.now() + 5000, guard() {} });
  assert.equal(f.calls, 1); await assert.rejects(a.embedder.embed(['two']), { code: 'budget_denied' }); await a.close();
});
test('L09 active slot survives a core timeout until actual settlement; invoked refusals consume attempts', async () => {
  const f = setup(), a = await f.factory({ packPath: '/synthetic/one', maxRequests: 3 }); let release, settled;
  const completed = new Promise(resolve => { settled = resolve; });
  f.behavior = () => new Promise(resolve => { release = () => { resolve([[1]]); }; }).finally(settled);
  const controller = new AbortController(), first = a.embedder.embed(['one'], { signal: controller.signal });
  controller.abort(); await assert.rejects(first, { code: 'timeout' });
  await assert.rejects(a.embedder.embed(['two']), { code: 'budget_denied' }); release(); await completed; await new Promise(resolve => setImmediate(resolve));
  f.behavior = () => { throw Object.assign(Error('token refusal'), { code: 'context_item_too_large' }); };
  await assert.rejects(a.embedder.embed(['two']), { code: 'context_item_too_large' });
  await assert.rejects(a.embedder.embed(['three']), { code: 'context_item_too_large' });
  await assert.rejects(a.embedder.embed(['four']), { code: 'budget_denied' }); await a.close();
});
test('L02 factory rejects malformed paths, unknown fields and request/thread ranges before verification', async () => {
  let inspections = 0;
  const create = localEmbeddingFactory({ verify: async () => { inspections++; throw Error('unexpected verification'); } });
  const valid = { packPath: '/synthetic/pack', maxRequests: 1 };
  for (const value of [null, {}, { ...valid, extra: true }, { ...valid, packPath: 'relative' }, { ...valid, packPath: '/synthetic/../pack' }, { ...valid, packPath: '/pack\0' }, ...[0, 65, 1.5, null].map(threads => ({ ...valid, threads })), ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, undefined].map(maxRequests => ({ ...valid, maxRequests }))]) await assert.rejects(create(value), { code: 'invalid_input' });
  assert.equal(inspections, 0);
});

test('L08 initialization termination failure quarantines identity across later factory calls', async () => {
  let starts = 0;
  const metadata = { id: 'quarantine-' + randomUUID(), revision: '1', dimensions: 1024, normalization: 'l2' };
  const factory = localEmbeddingFactory({ registry: new Map(), verify: async () => ({ metadata }), start: async () => {
    starts++; const e = Object.assign(Error('child_crash'), { code: 'child_crash' }); Object.defineProperty(e, QUARANTINED, { value: true }); throw e;
  } });
  for (let i = 0; i < 2; i++) await assert.rejects(factory({ packPath: '/synthetic/pack', maxRequests: 5 }), { code: 'child_crash' });
  assert.equal(starts, 1);
});
