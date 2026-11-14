// Explicit one-time qualification against the coordinator's immutable main.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { setImmediate as turn } from 'node:timers/promises';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import { createTestWorkspace } from './workspace.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url)), base = '39ae9111', passes = 20;
const ns = { ownerId: 'synthetic-upkeep-cost', scope: 'personal', projectId: null };
const methods = ['run', 'get', 'all', 'iterate', 'exec'];
const median = values => { const sorted = [...values].sort((a,b) => a-b); return (sorted[9] + sorted[10]) / 2; };

test('unbound and one-connection shared idle upkeep cost against main 39ae9111', { timeout: 120000 }, async t => {
  const w = createTestWorkspace(t, { prefix: 'unbound-upkeep-' }), previous = join(w.path, 'main');
  const archive = join(w.path, 'main.tar');
  const command = (program, args) => {
    const child = spawnSync(program, args, { cwd: root, encoding: 'utf8' });
    t.diagnostic('R2O3_COST_COMMAND ' + JSON.stringify({ program, args, rc: child.status, signal: child.signal }));
    assert.equal(child.status, 0, child.stderr);
  };
  command('mkdir', ['-p', previous]);
  command('git', ['archive', '--output', archive, base]);
  command('tar', ['-xf', archive, '-C', previous]);
  // Reuse the installed adapter dependencies, without installing or modifying them.
  for (const directory of ['adapters/mcp', 'adapters/openai']) {
    const dependencies = resolve(root, directory, 'node_modules');
    if (existsSync(dependencies)) symlinkSync(dependencies, join(previous, directory, 'node_modules'), 'dir');
  }
  const owner = new AsyncLocalStorage(), states = new Map(), tokens = new WeakSet();
  const nativeSet = globalThis.setTimeout, nativeClear = globalThis.clearTimeout;
  t.mock.method(globalThis, 'setTimeout', function(callback, ms, ...args) {
    const label = owner.getStore();
    if (!label || ms !== 1000 || !new Error().stack.includes('at arm (')) return nativeSet(callback, ms, ...args);
    const state = states.get(label), token = { unref() {} }; tokens.add(token);
    state.pending = AsyncLocalStorage.bind(callback); state.arms++; return token;
  });
  t.mock.method(globalThis, 'clearTimeout', token => { if (!tokens.has(token)) nativeClear(token); });
  let meter;
  // This exact wrapper measures both imported trees in the same process.
  for (const method of methods) {
    const prototype = method === 'exec' ? DatabaseSync.prototype : StatementSync.prototype, original = prototype[method];
    t.mock.method(prototype, method, function(...args) {
      if (meter) meter[method]++;
      return Reflect.apply(original, this, args);
    });
  }
  const engines = {};
  for (const [label, tree] of [['branch', root], ['shared', root], ['main', previous]]) {
    const { openMemoryCore } = await import(pathToFileURL(join(tree, 'core/contract.mjs')));
    const { createCairnServer } = await import(pathToFileURL(join(tree, 'adapters/mcp/server.mjs')));
    const { cardHost } = await import(pathToFileURL(join(tree, 'core/testing/raw-source-fixtures.mjs')));
    const adapterRequire = createRequire(join(root, 'adapters/mcp/package.json'));
    const { Client } = await import(pathToFileURL(adapterRequire.resolve('@modelcontextprotocol/client')));
    const { StdioServerTransport } = await import(pathToFileURL(adapterRequire.resolve('@modelcontextprotocol/server/stdio')));
    const { streams, context } = await import(pathToFileURL(join(root, 'adapters/mcp/test/local-shared-support.mjs')));
    const path = join(w.path, label + '.sqlite'), cards = cardHost(), seed = openMemoryCore({ path, raw: false, privateCards: cards.options });
    const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
    for (let i = 0; i < 3; i++) ok(seed.admit({ namespace: ns, memory: { content: 'Synthetic idle upkeep memory ' + i, kind: 'fact' },
      receipts: [{ client: 'synthetic', sessionId: 'upkeep', eventId: String(i), role: 'user', excerpt: 'Synthetic source ' + i }] }));
    const card = ok(await cards.call(seed, 'createCardDraft', { namespace: ns, actionId: 'draft', drafting: 'authored',
      input: { title: 'Synthetic upkeep card', body: 'Synthetic idle card', authoredInput: { text: 'Synthetic authored source', occurredAt: null } } }));
    ok(await cards.call(seed, 'confirmCardDraft', { namespace: ns, actionId: 'confirm', cardId: card.id, expectedRevision: 1, applicability: 'current' }));
    seed.close();
    states.set(label, { arms: 0 });
    const configuration = { path, namespace: ns, raw: false, privateCards: 'local-v1',
      contextCounter: { id: 'synthetic-cost-counter', countTokens: text => Math.ceil(text.length / 4) },
      contextEmbedding: { embedder: { id: 'synthetic-cost-' + label, revision: '1', dimensions: 1, normalization: 'none',
        async embed(texts) { return texts.map(() => [1]); } },
      policy: { family: 'hosted', maxRequests: 10000, maxUsd: 10000, maxConcurrent: 1, estimateUsd: () => 0 } } };
    const [a,b] = streams(), client = new Client({ name: 'synthetic-cost-client', version: '1' });
    let server;
    if (label === 'shared') {
      const { createLocalSharedRuntime } = await import(pathToFileURL(join(root, 'adapters/mcp/local-shared-runtime.mjs')));
      const host = createLocalSharedRuntime(configuration);
      owner.run(label, () => host.attach(a,a));
      server = { connect: async () => {}, close: () => host.close() };
      assert.equal(host.inspect().connections, 1, 'shared cost measures exactly one connection');
    } else server = owner.run(label, () => createCairnServer(configuration));

    w.defer(async () => { await client.close(); await server.close(); a.destroy(); b.destroy(); });
    await server.connect(new StdioServerTransport(a,a));
    await client.connect(new StdioServerTransport(b,b));
    for (const type of ['memory', 'card']) await context(client, { query: 'synthetic upkeep', types: [type], intent: 'current', semantic: false });
    engines[label] = { client, context };
  }
  const pass = async (label, measured) => {
    const state = states.get(label), before = state.arms, counts = Object.fromEntries(methods.map(method => [method,0]));
    assert.equal(typeof state.pending, 'function');
    const started = performance.now(); meter = measured ? counts : undefined;
    try {
      state.pending();
      for (let i = 0; state.arms === before && i < 10000; i++) await turn();
      assert.equal(state.arms, before + 1, 'the complete upkeep pass settled and rearmed');
    } finally { meter = undefined; }
    return { counts, statements: Object.values(counts).reduce((a,b) => a+b,0), wallMs: performance.now()-started };
  };
  // Warm identical synthetic stores, then leave the recently demanded views idle.
  for (let i = 0; i < 16; i++) for (const label of ['branch','shared','main']) await pass(label, false);
  const rows = { branch: [], shared: [], main: [] };
  for (let i = 0; i < passes; i++) for (const label of i % 2 ? ['main','shared','branch'] : ['branch','shared','main']) rows[label].push(await pass(label, true));
  const summary = Object.fromEntries(Object.entries(rows).map(([label, values]) => [label, {
    statements: { median: median(values.map(row => row.statements)), max: Math.max(...values.map(row => row.statements)), total: values.reduce((n,row) => n+row.statements,0) },
    wallMs: { median: median(values.map(row => row.wallMs)), max: Math.max(...values.map(row => row.wallMs)), total: values.reduce((n,row) => n+row.wallMs,0) },
  }]));
  const flags = { moreStatements: summary.branch.statements.total > summary.main.statements.total,
    wallOverTenPercent: summary.branch.wallMs.total > summary.main.wallMs.total * 1.1 };
  flags.sharedMoreStatements = summary.shared.statements.total > summary.main.statements.total;
  t.diagnostic('R2O4_UPKEEP_COST ' + JSON.stringify({ base, passes, interleaved: true, rows, summary, flags }));
  assert.equal(summary.branch.statements.total, summary.main.statements.total, 'R2O4_UNBOUND_UPKEEP_COST');
  assert.ok(!flags.sharedMoreStatements, 'R2O4_HOST_UPKEEP_COST');
});
