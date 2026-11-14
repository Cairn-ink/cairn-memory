import test from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/server';
import { buildCairnServer } from '../server.mjs';
import { rawSearchRequestState } from '../../../core/raw-search-request-scope.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
for (const outcome of ['success', 'refusal', 'failure', 'abort', 'disconnect'])
test('local tool scope closes on ' + outcome, { timeout: 10000 }, async t => {
  const tools = new Map(), register = McpServer.prototype.registerTool;
  const entered = deferred(), gate = deferred(); t.after(() => gate.resolve());
  let state, closes = 0;
  const core = { list: () => ({ ok: true, value: {} }), close() {}, async get() {
    state = rawSearchRequestState({}, () => ({ prepared: new Map([['synthetic', { text: 'synthetic tool text' }]]),
      searches: new Map([['synthetic', {}]]), routes: new Set([{}]),
      close() { closes++; this.prepared.clear(); this.searches.clear(); this.routes.clear(); } }));
    assert.ok(state, 'each local tool invocation must install a scope');
    entered.resolve();
    if (outcome === 'abort' || outcome === 'disconnect') await gate.promise;
    if (outcome === 'failure') throw Error('synthetic failure');
    return outcome === 'refusal' ? { ok: false, error: { code: 'synthetic_refusal' } } : { ok: true, value: {} };
  } };
  let server;
  McpServer.prototype.registerTool = function(name, configuration, handler) { tools.set(name, handler); return register.call(this, name, configuration, handler); };
  try { server = buildCairnServer({ core, binding: { ownerId: 'synthetic-owner', scope: 'personal', projectId: null } }); }
  finally { McpServer.prototype.registerTool = register; }
  t.after(() => server.close());
  const controller = new AbortController();
  const operation = tools.get('inspect_memory')({ memoryId: 'synthetic' }, { signal: controller.signal });
  await Promise.race([entered.promise, operation.then(() => { throw Error('tool_action_did_not_enter_scoped_work'); })]);
  if (outcome === 'abort' || outcome === 'disconnect') {
    if (outcome === 'abort') controller.abort(); else await server.close();
    assert.equal(state.prepared.size, 0, 'disconnect cleanup precedes action settlement');
    gate.resolve();
  }
  const response = await operation;
  assert.equal(response.isError, outcome === 'failure' || outcome === 'refusal');
  assert.equal(closes, 1); assert.equal(state.prepared.size, 0); assert.equal(state.searches.size, 0); assert.equal(state.routes.size, 0);
});
