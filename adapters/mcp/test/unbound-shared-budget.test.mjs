import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { setImmediate as turn } from 'node:timers/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createCommitDispatcher } from '../../../core/commit-dispatch.mjs';
import { createCairnServer, createLocalCairnRuntime } from '../server.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { cardHost } from '../../../core/testing/raw-source-fixtures.mjs';
import { createContextReadAccess } from '../context-read-access.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { ns, counter, streams, context, deferred, ok } from './local-shared-support.mjs';

for (const mode of ['unbound', 'runtime', 'dispatcher']) for (const cap of ['requests', 'usd', 'concurrency']) test(`${mode} upkeep/tool ${cap} accounting`, { timeout: 15000 }, async t => {
  const w = createTestWorkspace(t), path = join(w.path, 'synthetic-budget.sqlite');
  let sends = 0, blocking = false;
  const release = deferred();
  const embedder = { id: 'synthetic-unbound-' + randomUUID(), revision: '1', dimensions: 1, normalization: 'none',
    async embed(texts) { sends++; if (blocking && sends === 1) await release.promise; return texts.map(() => [1]); } };
  const cards = cardHost(), access = createContextReadAccess(ns, false, { maintenance: true });
  const seed = openMemoryCore({ path, raw: false, privateCards: cards.options,
    contextRead: { ...access.configuration, embedder, counter,
      policy: { family: 'hosted', maxRequests: 100, maxUsd: 100, maxConcurrent: 1, estimateUsd: () => 1 } } });
  ok(seed.admit({ namespace: ns, memory: { content: 'Synthetic cobalt telescope budget document', kind: 'fact' },
    receipts: [{ client: 'synthetic', sessionId: 'budget', eventId: 'document', role: 'user', excerpt: 'Synthetic budget source' }] }));
  if (cap === 'concurrency') {
    const warmed = ok(await access.call(seed, 'refreshContextIndex', { readSet: [ns], types: ['memory'],
      intent: 'current', budget: { maxItems: 16, maxMs: 5000 } }));
    assert.equal(warmed.channels.semantic.state, 'ready');
    const card = ok(await cards.call(seed, 'createCardDraft', { namespace: ns, actionId: 'draft', drafting: 'authored',
      input: { title: 'Synthetic card', body: 'Synthetic upkeep card', authoredInput: { text: 'Synthetic source', occurredAt: null } } }));
    ok(await cards.call(seed, 'confirmCardDraft', { namespace: ns, actionId: 'confirm', cardId: card.id,
      expectedRevision: 1, applicability: 'current' }));
  }
  seed.close(); sends = 0; blocking = cap === 'concurrency';
  const nativeSet = globalThis.setTimeout, nativeClear = globalThis.clearTimeout, timers = new WeakSet();
  let pending, arms = 0;
  t.mock.method(globalThis, 'setTimeout', function(callback, ms, ...args) {
    if (ms !== 1000 || !new Error().stack.includes('at arm (')) return nativeSet(callback, ms, ...args);
    const token = { unref() {} }; timers.add(token); pending = AsyncLocalStorage.bind(callback); arms++; return token;
  });
  t.mock.method(globalThis, 'clearTimeout', token => { if (!timers.has(token)) nativeClear(token); });
  const options = { path, namespace: ns, raw: false, contextCounter: counter,
    ...(cap === 'concurrency' ? { privateCards: 'local-v1' } : {}),
    contextEmbedding: { embedder, policy: { family: 'hosted', maxRequests: cap === 'requests' ? 1 : 100,
      maxUsd: cap === 'usd' ? 1 : 100, maxConcurrent: 1, estimateUsd: () => 1 } } };
  const dispatcher = mode === 'dispatcher' ? createCommitDispatcher({ strict: true }) : null;
  const server = mode === 'unbound' ? createCairnServer(options)
    : (dispatcher ? dispatcher.open(() => createLocalCairnRuntime(options, { dispatcher }))
      : createLocalCairnRuntime(options)).server({ ownsRuntime: true });
  const [a, b] = streams(), client = new Client({ name: 'synthetic-budget-client', version: '1' });
  t.after(async () => { release.resolve(); await client.close(); await server.close(); a.destroy(); b.destroy(); });
  await server.connect(new StdioServerTransport(a, a));
  await client.connect(new StdioServerTransport(b, b));
  if (cap !== 'concurrency') await context(client, { query: 'synthetic budget warm-up', types: ['memory'], intent: 'current', semantic: false });
  assert.ok(pending, 'the real unbound server armed maintenance');
  for (let pass = 0; sends === 0 && pass < 12; pass++) {
    const before = arms; pending();
    for (let i = 0; arms === before && sends === 0 && i < 1000; i++) await turn();
  }
  assert.equal(sends, 1, 'maintenance reached its paid request');
  if (cap !== 'concurrency') for (let i = 0; i < 20; i++) await turn();
  try {
    const result = await context(client, { query: 'synthetic unique semantic budget query', types: ['memory'],
      intent: 'current', semantic: true, deadlineMs: 5000 });
    assert.equal(sends, mode === 'unbound' ? 1 : 2, 'R2O3_UNBOUND_SHARED_BUDGET ' + mode + ' ' + cap);
    assert.equal(result.diagnostics.candidates.channels.semantic.causes.includes('budget_denied'), mode === 'unbound',
      'R2O3_UNBOUND_SHARED_BUDGET ' + JSON.stringify(result.diagnostics));
  } finally { release.resolve(); }
});
