// Compare the actual constructor's registered handler with immutable main.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createTestWorkspace } from './workspace.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
test('unbound context reads match main input reads and never record demand', async t => {
  const w = createTestWorkspace(t, { prefix: 'unbound-demand-' }), main = join(w.path, 'main');
  mkdirSync(main);
  for (const [program, args] of [['git', ['archive', '--output', join(w.path, 'main.tar'), '39ae9111']],
    ['tar', ['-xf', join(w.path, 'main.tar'), '-C', main]]]) {
    const child = spawnSync(program, args, { cwd: root, encoding: 'utf8' });
    t.diagnostic(JSON.stringify({ program, args, rc: child.status }));
    assert.equal(child.status, 0, child.stderr);
  }
  for (const directory of ['adapters/mcp', 'adapters/openai']) {
    const dependencies = join(root, directory, 'node_modules');
    if (existsSync(dependencies)) symlinkSync(dependencies, join(main, directory, 'node_modules'), 'dir');
  }
  const require = createRequire(join(root, 'adapters/mcp/package.json'));
  const { McpServer } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/server').replace(/\.cjs$/, '.mjs')));
  const register = McpServer.prototype.registerTool;
  let handler;
  t.mock.method(McpServer.prototype, 'registerTool', function(name, configuration, callback) {
    if (name === 'read_memory_context') handler = callback;
    return Reflect.apply(register, this, [name, configuration, callback]);
  });
  const results = {};
  for (const [label, tree] of [['main', main], ['branch', root]]) {
    const { createCairnServer } = await import(pathToFileURL(join(tree, 'adapters/mcp/server.mjs')));
    const now = Date.now;
    let measuring = false, demandClockSamples = 0;
    const clock = t.mock.method(Date, 'now', () => {
      if (measuring && new Error().stack.includes('at Object.note (')) demandClockSamples++;
      return now();
    });
    const server = createCairnServer({ path: join(w.path, label + '.sqlite'),
      namespace: { ownerId: 'synthetic-unbound-demand', scope: 'personal', projectId: null },
      raw: false, contextCounter: { id: 'synthetic-counter', countTokens: text => text.length } });
    w.defer(() => server.close());
    const reads = [];
    const types = ['memory'];
    const input = new Proxy({ query: 'synthetic query', types, intent: 'current', semantic: false }, {
      get(target, key, receiver) { reads.push(String(key)); return Reflect.get(target, key, receiver); },
    });
    const set = Map.prototype.set;
    let recordings = 0;
    const recording = t.mock.method(Map.prototype, 'set', function(key, value) {
      if (new Error().stack.includes('at Object.note (')) recordings++;
      return Reflect.apply(set, this, [key, value]);
    });
    let response;
    try { measuring = true; response = await handler(input); }
    finally { recording.mock.restore(); clock.mock.restore(); }
    assert.equal(response.isError, false, label + ' ' + JSON.stringify(response));
    results[label] = { reads, recordings, demandClockSamples };
  }
  t.diagnostic('R2O5_INPUT_READS ' + JSON.stringify(results));
  assert.deepEqual(results.branch, results.main, 'R2O5_UNBOUND_NO_DEMAND');
  assert.equal(results.branch.recordings, 0, 'R2O5_UNBOUND_NO_DEMAND');
  assert.equal(results.branch.demandClockSamples, 0, 'R2O5_UNBOUND_NO_DEMAND');
});
