import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { sourceFixture, savedSource } from '../testing/raw-source-fixtures.mjs';
import { searchFixture } from '../testing/raw-search-fixtures.mjs';
import { installRawSearchTestClock, rawSearchTestWait } from '../testing/raw-search-clock.mjs';
import { coreFixture, query, ok } from '../testing/context-read-core-fixture.mjs';
import { contextBudget } from '../context-read-budget.mjs';

// Exercise the approved, immutable engine base as an independent implementation.
// All files and stores are temporary synthetic test workspaces; no installation.
const base = '405893c957ee582fecd1a48265351a73be6bb190';
let workspace, original;
test.before(async () => {
  workspace = createTestWorkspace(null, { prefix: 'r1-base-parity-' });
  execFileSync('tar', ['-x', '-C', workspace.path], { input: execFileSync('git', ['archive', base, 'core', 'tools/testing']) });
  const load = path => import(pathToFileURL(join(workspace.path, path)).href);
  original = { ...await load('core/raw-search-index.mjs'), ...await load('core/index.mjs'),
    budget: (await load('core/context-read-budget.mjs')).contextBudget };
});
test.after(async () => workspace?.cleanup());
test.beforeEach(installRawSearchTestClock);
const code = work => { try { work(); return 'ready'; } catch (error) { return error.code; } };
const normalized = value => JSON.parse(JSON.stringify(value, (key, item) =>
  ['proof', 'ticket', 'nextCursor', 'snapshot'].includes(key) ? item ? '<opaque>' : item : key === 'timings' ? '<timings>' : item));

test('unscoped Raw outputs, all prepared paths, retention, expiry and refusal codes equal the base', async t => {
  const f = sourceFixture(t); await savedSource(f, 'Synthetic copper hosted parity.');
  const current = await searchFixture(f); await current.maintain();
  const previous = await original.openRawSearch(current.options); f.workspace.defer(() => previous.close());
  const run = async service => {
    const found = await service.search({ query: 'copper' }, current.host.token), candidate = found.candidates[0];
    assert.ok(candidate);
    const single = await service.prepare(candidate, {}, current.host.token);
    const batch = await service.prepareMany([candidate], {}, current.host.token);
    const exact = await service.prepareSource(candidate.ranges[0], {}, current.host.token);
    let refusal;
    try { await service.search({ query: 'copper' }, {}); } catch (error) { refusal = error.code; }
    return { found: normalized(found), prepared: [single, batch.handles[0], exact].map(handle => handle.validate()), refusal };
  };
  assert.deepEqual(await run(current.service), await run(previous));
  const hits = await Promise.all([current.service, previous].map(service => service.search({ query: 'copper' }, current.host.token)));
  const handles = [[], []], services = [current.service, previous];
  for (let i = 0; i < 73; i++) for (let n = 0; n < 2; n++)
    handles[n].push(await services[n].prepare(hits[n].candidates[0], {}, current.host.token));
  const retained = handles.map((rows, n) => rows.map(handle => code(() => services[n].revalidate([handle]))));
  assert.deepEqual(retained[0], retained[1]); assert.equal(retained[0].filter(value => value === 'ready').length, 72);
  await rawSearchTestWait(5001);
  for (let n = 0; n < 2; n++) assert.equal(code(() => services[n].revalidate([handles[n].at(-1)])), 'raw_search_unavailable');
});

test('no-key ranking outputs and the exact 128-entry eviction boundary equal the base', async t => {
  const f = coreFixture(t); for (let i = 0; i < 3; i++) f.admit('apple synthetic hosted parity ' + i);
  const previous = original.openMemoryCore({ path: f.path, contextRead: f.config }); f.workspace.defer(() => previous.close());
  const input = query({ limit: 1 }), run = core => f.trusted.call(core, 'findCandidates', input);
  const a = ok(await run(f.context)), b = ok(await run(previous));
  assert.deepEqual(normalized(a), normalized(b));
  for (let i = 0; i < 127; i++) { ok(await run(f.context)); ok(await run(previous)); }
  const page = (core, cursor) => f.trusted.call(core, 'findCandidates', { ...input, cursor });
  assert.deepEqual(normalized(ok(await page(f.context, a.nextCursor))), normalized(ok(await page(previous, b.nextCursor))));
  ok(await run(f.context)); ok(await run(previous));
  assert.deepEqual(await page(f.context, a.nextCursor), await page(previous, b.nextCursor));
  assert.equal((await page(f.context, a.nextCursor)).error.code, 'cursor_stale');
});

test('no-scope budget concurrency, lifetime charges, refunds and refusals equal the base', async () => {
  async function trace(factory, suffix) {
    let release; const gate = new Promise(resolve => { release = resolve; }); let calls = 0;
    const embedder = { id: 'synthetic-hosted-parity-' + suffix, revision: '1', async embed(_texts, { settleUsd }) {
      calls++; if (calls === 1) { settleUsd(.25); await gate; } return [[1]];
    } };
    const policy = { family: 'hosted', maxConcurrent: 1, maxRequests: 3, maxUsd: 1, estimateUsd: () => 1 };
    const dispatch = factory({ budgetConfigured: true, embedder, policy });
    const run = () => dispatch(embedder, ['synthetic'], { guard() {}, signal: new AbortController().signal, deadlineAt: performance.now() + 5000 });
    const status = async () => { try { return await run(); } catch (error) { return error.code; } };
    const pending = status(), active = await status(); release(); const settled = await pending;
    const capped = await status(); policy.maxUsd = 1.25; const second = await status(), exhausted = await status();
    return { active, settled, capped, second, exhausted, calls };
  }
  const current = await trace(contextBudget, 'current'), previous = await trace(original.budget, 'base');
  assert.deepEqual(current, previous);
  assert.equal(current.active, 'budget_denied'); assert.equal(current.calls, 2);
});
