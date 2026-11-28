import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { openStorage } from '../../packaging/core-local/adapter-slot.mjs';
import { localClock } from '../../packaging/core-local/local-provider.mjs';
import { callTool } from '../../packaging/core-local/wire-tools.mjs';
import { createTestWorkspace } from './workspace.mjs';

async function loadBaselineTool() {
  const baseline = new URL('../../packaging/core-local/wire-tools.mjs?baseline', import.meta.url).href;
  const hook = registerHooks({ load(url, context, next) {
    const loaded = next(url, context);
    if (url !== baseline) return loaded;
    const source = loaded.source.toString();
    const start = source.indexOf('        const { maxTokens, maxItems, ...query } = args;');
    const end = source.indexOf('        const items = diagnostics.items.map', start);
    assert.ok(start >= 0 && end > start);
    return { ...loaded, source: source.slice(0, start) + `
        const { maxTokens, maxItems, ...query } = args;
        const budget = { ...(maxTokens !== undefined && { maxTokens }), ...(maxItems !== undefined && { maxItems }) };
        const { assembly, diagnostics, snapshot } = await service.readContext(readSet, { ...query, budget });
` + source.slice(end) };
  } });
  try { return (await import(baseline)).callTool; }
  finally { hook.deregister(); }
}

test('other Context Read shapes keep the same request and response bytes', async t => {
  const baselineCall = await loadBaselineTool();
  const workspace = createTestWorkspace(null);
  const monotonicMs = localClock.monotonicMs;
  let runtime;
  try {
    const started = monotonicMs();
    localClock.monotonicMs = () => started;
    runtime = await openStorage(join(workspace.path, 'store.sqlite'));
    const scope = { owner: 'test-owner', namespace: 'personal\0' };
    const readSet = { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [0] };
    const handles = { issue(_kind, signed) {
      return signed === null ? null : createHash('sha256').update(signed).digest('base64url');
    } };
    const call = (wire, name, args, service = runtime.service) => wire(service, scope, handles, name, args);
    const body = 'The compass is stored in a red cabinet.';
    const saved = await call(callTool, 'remember_memory', { content: body });
    assert.equal(saved.isError, false, saved.content[0].text);
    const raw = 'The compass needs a new case.';
    const { storage } = runtime;
    await storage.uow.run(scope.owner, { pauseLock: true }, tx => storage.raw.importArchive(tx, scope,
      { client: 'fixture', sessionId: 'observations' },
      [{ id: 'note', role: 'user', occurredAtMs: Date.UTC(2026, 0, 2), content: raw }]));
    assert.equal(await storage.maintainContextRaw(readSet), true);

    const search = { query: 'compass', types: ['memory'], intent: 'current', semantic: false, deadlineMs: 5000 };
    const capture = async (wire, args) => {
      let request;
      const response = await call(wire, 'read_memory_context', args, { async readContext(readSet, input) {
        request = JSON.stringify({ readSet, input });
        return runtime.service.readContext(readSet, input);
      } });
      return { request, response };
    };

    const cases = [
      ['mixed memory and card', { ...search, types: ['memory', 'card'] }],
      ['history', { ...search, intent: 'history' }],
      ['explicit representation-v2', { ...search, representation: 'representation-v2', maxItems: 2, maxTokens: 512 }],
    ];
    for (const [label, args] of cases) await t.test(label, async () => {
      // Warm the lexical projection for this shape before comparing maintenance diagnostics.
      await capture(baselineCall, args);
      const baseline = await capture(baselineCall, args);
      assert.equal(baseline.response.isError, false, baseline.response.content[0].text);
      const candidate = await capture(callTool, args);
      assert.equal(candidate.request, baseline.request);
      assert.equal(JSON.stringify(candidate.response), JSON.stringify(baseline.response));
      if (args.intent === 'current') {
        const { value } = JSON.parse(candidate.response.content[0].text);
        const memory = value.items.find(item => item.body === body);
        assert.ok(memory?.sources.length > 0);
        if (args.representation === 'representation-v2') assert.ok(candidate.response.content[0].text.includes(raw));
      }
    });
  } finally {
    localClock.monotonicMs = monotonicMs;
    try { await runtime?.close(); }
    finally { await workspace.cleanup(); }
  }
});
