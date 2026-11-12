import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { withContextReadRankingPartition } from '../context-read-facade.mjs';
import { contextBudget, withContextReadBudgetScope } from '../context-read-budget.mjs';
import { createFakeEmbedder } from '../context-read-embedder.mjs';
import { coreFixture, query, refresh, policy, ok, denied } from '../testing/context-read-core-fixture.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('partition A pages while partition B creates 200 rankings; default capacity remains 128', async t => {
  const f = coreFixture(t); for (let i = 0; i < 3; i++) f.admit('apple synthetic partition ' + i);
  const a = {}, b = {}, input = query({ limit: 1 });
  const first = ok(await withContextReadRankingPartition(a, () => f.call('findCandidates', input)));
  assert.ok(first.nextCursor);
  for (let i = 0; i < 200; i++) ok(await withContextReadRankingPartition(b, () => f.call('findCandidates', input)));
  const page = ok(await withContextReadRankingPartition(a, () => f.call('findCandidates', { ...input, cursor: first.nextCursor })));
  assert.notEqual(page.items[0].ref.memoryId, first.items[0].ref.memoryId);
  denied(await withContextReadRankingPartition(b, () => f.call('findCandidates', { ...input, cursor: first.nextCursor })), 'cursor_stale');
  const defaultFirst = ok(await f.call('findCandidates', input));
  for (let i = 0; i < 127; i++) ok(await f.call('findCandidates', input));
  ok(await f.call('findCandidates', { ...input, cursor: defaultFirst.nextCursor }));
  ok(await f.call('findCandidates', input));
  denied(await f.call('findCandidates', { ...input, cursor: defaultFirst.nextCursor }), 'cursor_stale');
});

test('eight concurrent scoped semantic queries stay ready during a separate maintenance embed', { timeout: 15000 }, async t => {
  let blocking = false;
  const gate = deferred(), maintenanceEntered = deferred(), queryEntered = deferred(); let queryCalls = 0;
  const base = createFakeEmbedder(), embedder = { ...base, id: 'sharing-' + randomUUID(), async embed(texts, controls) {
    if (blocking) {
      if (texts.some(text => text.includes('maintenance-document'))) maintenanceEntered.resolve();
      else if (++queryCalls === 8) queryEntered.resolve();
      await gate.promise;
    }
    return base.embed(texts, controls);
  } };
  t.after(() => gate.resolve());
  const f = coreFixture(t, { embedder, selectedPolicy: policy({ family: 'hosted', maxConcurrent: 1 }) }); f.admit('apple');
  const maintenance = {};
  ok(await withContextReadBudgetScope(maintenance, () => f.call('refreshContextIndex', refresh())));
  // This is the same ledger/port seam used by Raw and Memory maintenance;
  // leave the existing index fully published while the provider is in flight.
  const dispatch = contextBudget({ budgetConfigured: true, embedder, policy: policy({ family: 'hosted', maxConcurrent: 1 }) });
  blocking = true;
  const operation = withContextReadBudgetScope(maintenance, () => dispatch(embedder, ['maintenance-document'], {
    guard() {}, signal: new AbortController().signal, deadlineAt: performance.now() + 10000 }));
  await maintenanceEntered.promise;
  const scopes = Array.from({ length: 8 }, () => ({}));
  const reads = scopes.map(scope => withContextReadBudgetScope(scope, () => f.call('findCandidates', query({ semantic: true, deadlineMs: 5000 }))));
  // The first call of each connection has its own active slot. A second call
  // on the same connection must still be refused while that slot is reserved.
  const same = ok(await withContextReadBudgetScope(scopes[0], () => f.call('findCandidates', query({ semantic: true }))));
  assert.equal(same.channels.semantic.state, 'budget_denied');
  await Promise.race([queryEntered.promise, Promise.all(reads).then(() => { throw Error('scoped_queries_did_not_enter'); })]);
  gate.resolve(); await operation;
  for (const result of await Promise.all(reads)) assert.equal(ok(result).channels.semantic.state, 'ready');
});

test('scoped USD and request caps last across invocations; unscoped concurrency and settlement stay shared', async () => {
  const gate = deferred(); let block = false, calls = 0;
  const embedder = { id: 'sharing-ledger-' + randomUUID(), revision: '1', embed: async () => {
    calls++; if (block) await gate.promise; return [[1]];
  } };
  const dispatch = contextBudget({ budgetConfigured: true, embedder,
    policy: { family: 'hosted', maxConcurrent: 1, maxRequests: 100, maxUsd: 1, estimateUsd: () => .6 } });
  const run = () => dispatch(embedder, ['synthetic'], { guard() {}, signal: new AbortController().signal, deadlineAt: performance.now() + 5000 });
  const a = {}, b = {};
  await withContextReadBudgetScope(a, run);
  await assert.rejects(withContextReadBudgetScope(a, run), { code: 'budget_denied' });
  await withContextReadBudgetScope(b, run);
  block = true;
  const pending = run();
  try { await assert.rejects(run(), { code: 'budget_denied' }); }
  finally { gate.resolve(); await pending; }
  await assert.rejects(run(), { code: 'budget_denied' });
  assert.equal(calls, 3);
});
