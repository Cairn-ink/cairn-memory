// One-time R1 qualification: unscoped Raw, ranking and budget parity against
// fixed base 3cbbb1a46b590bca3c68376eaedf4f63c8d1e321. Requires full git history.
// Main 63cd28b6 itself failed this comparison against the earlier base 405893c9
// (maintenance diagnostics differ), so the base moved to current main.
// Run explicitly: node tools/testing/local-sharing-hosted-parity.qualification.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { mkdirSync, unlinkSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createTestWorkspace } from './workspace.mjs';
import { sourceFixture, savedSource } from '../../core/testing/raw-source-fixtures.mjs';
import { searchFixture } from '../../core/testing/raw-search-fixtures.mjs';
import { installRawSearchTestClock, rawSearchTestWait } from '../../core/testing/raw-search-clock.mjs';
import { host, ns, receipt, query, ok } from '../../core/testing/context-read-core-fixture.mjs';
import { openMemoryCore } from '../../core/index.mjs';
import { contextBudget } from '../../core/context-read-budget.mjs';

// Exercise the approved, immutable engine base as an independent implementation.
// All files and stores are temporary synthetic test workspaces; no installation.
const base = '3cbbb1a46b590bca3c68376eaedf4f63c8d1e321';
let workspace, original;
test.before(async () => {
  workspace = createTestWorkspace(null, { prefix: 'r1-base-parity-' });
  const archive = join(workspace.path, 'base.tar');
  execFileSync('git', ['archive', '--output', archive, base, 'core', 'tools/testing', 'plugins/cairn-memory/lib/redact.mjs']);
  execFileSync('tar', ['-xf', archive, '-C', workspace.path]); unlinkSync(archive);
  const load = path => import(pathToFileURL(join(workspace.path, path)).href);
  original = { ...await load('core/raw-search-index.mjs'), ...await load('core/index.mjs'),
    budget: (await load('core/context-read-budget.mjs')).contextBudget };
});
test.after(async () => workspace?.cleanup());
test.beforeEach(installRawSearchTestClock);
const code = work => { try { work(); return 'ready'; } catch (error) { return error.code; } };
const normalized = value => JSON.parse(JSON.stringify(value, (key, item) =>
  ['proof', 'ticket', 'nextCursor', 'snapshot', 'lastActualWork'].includes(key) ? item ? '<opaque>' : item : key === 'timings' ? '<timings>' : item));

test('unscoped Raw outputs, all prepared paths, retention, expiry and refusal codes equal the base', async t => {
  const f = sourceFixture(t); await savedSource(f, 'Synthetic copper hosted parity.');
  const current = await searchFixture(f);
  const directory = join(f.workspace.path, 'base-index'); mkdirSync(directory, { mode: 0o700 });
  const previous = await original.openRawSearch({ ...current.options, directory }); f.workspace.defer(() => previous.close());
  const maintenance = { current: normalized(await current.maintain()),
    base: normalized(await previous.maintain(undefined, current.host.token)) };
  assert.deepEqual(maintenance.current, maintenance.base);
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
  const a = await run(current.service), b = await run(previous);
  t.diagnostic('HOSTED_PARITY_CASE ' + JSON.stringify({ case: 'unscoped Raw', current: a, base: b, maintenance }));
  assert.deepEqual(a, b);
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
  const w = createTestWorkspace(t), trusted = host(), config = { version: 'context-read-v1', authority: trusted.authority };
  const seedPath = join(w.path, 'seed.sqlite'), currentPath = join(w.path, 'current.sqlite'), basePath = join(w.path, 'base.sqlite');
  const seed = openMemoryCore({ path: seedPath });
  try {
    for (let i = 0; i < 3; i++) ok(seed.admit({ namespace: ns,
      memory: { content: 'apple synthetic hosted parity ' + i, kind: 'fact' }, receipts: [receipt('synthetic-' + i)] }));
  } finally { seed.close(); }
  // Copy the closed canonical fixture before either implementation opens it.
  // External cp/cmp also keep raw DB file descriptors out of this process.
  for (const path of [currentPath, basePath]) execFileSync('cp', [seedPath, path]);
  execFileSync('cmp', [currentPath, basePath]);
  const current = openMemoryCore({ path: currentPath, contextRead: config }); w.defer(() => current.close());
  const previous = original.openMemoryCore({ path: basePath, contextRead: config }); w.defer(() => previous.close());
  const input = query({ limit: 1 }), run = core => trusted.call(core, 'findCandidates', input);
  const a = ok(await run(current)), b = ok(await run(previous));
  t.diagnostic('HOSTED_PARITY_CASE ' + JSON.stringify({ case: 'no-key ranking', current: normalized(a), base: normalized(b), fixtureCopiesEqual: true }));
  assert.deepEqual(normalized(a), normalized(b));
  for (let i = 0; i < 127; i++) { ok(await run(current)); ok(await run(previous)); }
  const page = (core, cursor) => trusted.call(core, 'findCandidates', { ...input, cursor });
  assert.deepEqual(normalized(ok(await page(current, a.nextCursor))), normalized(ok(await page(previous, b.nextCursor))));
  ok(await run(current)); ok(await run(previous));
  assert.deepEqual(await page(current, a.nextCursor), await page(previous, b.nextCursor));
  assert.equal((await page(current, a.nextCursor)).error.code, 'cursor_stale');
});

test('no-scope budget concurrency, lifetime charges, refunds and refusals equal the base', async t => {
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
  t.diagnostic('HOSTED_PARITY_CASE ' + JSON.stringify({ case: 'budget', current, base: previous }));
  assert.deepEqual(current, previous);
  assert.equal(current.active, 'budget_denied'); assert.equal(current.calls, 2);
});
