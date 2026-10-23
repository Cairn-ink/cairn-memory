import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { installedMethods } from './fixtures/method-packages.mjs';
import { installedImportClosure } from './fixtures/installed-import-closure.mjs';
import { contextHost, contextNamespace as ns } from '../../adapters/mcp/test/context-support.mjs';
import { countOpenAITokens } from '../../adapters/openai/index.mjs';
import { meteredText } from '../../core/context-read-assembly.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const roots = ['core/index.mjs', 'core/contract.mjs', 'adapters/mcp/cli.mjs', 'adapters/local/cli.mjs', 'integrations/client/raw/local-host-cli.mjs'];
const added = ['adapters/openai/context-counter.mjs', 'core/context-read-assembly.mjs'];
const metaKey = 'ink.cairn/context-read-diagnostics';
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const walk = (path, prefix = '') => readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ?
  walk(join(path, entry.name), prefix + entry.name + '/') : [prefix + entry.name]).sort();
let workspace, installed;
before(async () => {
  workspace = createTestWorkspace(null, { prefix: 'installed-assembly-' });
  installed = await installedMethods(workspace);
});
after(async () => { await workspace?.cleanup(); });

test('A12 offline artifact: independent installed/static closure, manifest, filesystem and hashes include every assembly module', () => {
  const source = installedImportClosure(root, roots), artifact = installedImportClosure(installed.root, roots);
  const manifest = JSON.parse(readFileSync(join(root, 'packaging/artifact-files.json'), 'utf8'));
  assert.deepEqual(artifact.required, source.required);
  assert.deepEqual(source.required.filter(path => !manifest.includes(path)), []);
  assert.deepEqual(manifest.filter(path => !existsSync(join(root, path))), []);
  assert.equal(new Set(manifest).size, manifest.length);
  for (const path of added) {
    assert.ok(source.eager.includes(path), path + ' reachable from entry graph');
    assert.ok(manifest.includes(path)); assert.ok(installed.artifact.files.includes(path));
  }
  assert.equal(manifest.filter(path => path === 'docs/context-read-local.md').length, 1);
  const packageFiles = JSON.parse(readFileSync(join(installed.root, 'package.json'), 'utf8')).files.sort();
  const filesystem = walk(installed.root);
  assert.deepEqual(filesystem, packageFiles); assert.deepEqual(filesystem, [...installed.artifact.files].sort());
  for (const path of manifest) {
    const bytes = readFileSync(join(installed.root, path));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), installed.artifact.sourceHashes[path], path);
    assert.deepEqual(bytes, readFileSync(join(root, path)), path);
  }
});

test('A12 installed keyless and keyed CLI expose assembly, inject the counter, preserve canonical text and isolate diagnostics', { timeout: 60000 }, async t => {
  const memory = ok(installed.core.admit({ namespace: ns, memory: { content: 'assembly ＡＢＣ evidence', kind: 'fact' },
    receipts: [{ client: 'synthetic', sessionId: 'assembly', eventId: 'installed', role: 'user', excerpt: 'assembly canonical receipt' }] })).memory;
  const canonical = ok(installed.core.get({ namespace: ns, memoryId: memory.id })).memory.content;
  for (const key of [false, true]) {
    const trace = join(workspace.path, key ? 'keyed-loaded.json' : 'keyless-loaded.json');
    const preload = 'data:text/javascript,' + encodeURIComponent(`
      import {registerHooks} from 'node:module';import {appendFileSync} from 'node:fs';
      registerHooks({load(url,context,next){
        if(!${key}&&url.endsWith('/adapters/openai/index.mjs'))throw Error('keyless startup constructed legacy model');
        const result=next(url,context);appendFileSync(${JSON.stringify(trace)},JSON.stringify(url)+'\\n');return result;}});
      globalThis.fetch=()=>{process.exit(91)};`);
    const { client } = await contextHost(workspace, installed.path, { entry: installed.entry, key, preload });
    const tools = (await client.listTools()).tools, tool = tools.find(tool => tool.name === 'read_memory_context');
    assert.ok(tool); assert.equal(tool.annotations.readOnlyHint, true); assert.equal(tool.annotations.openWorldHint, true);
    for (const policy of [undefined, { id: 'coverage-first-v1' }]) {
      const response = await client.callTool({ name: tool.name, arguments: { query: 'assembly', types: ['memory'], intent: 'current',
        maxTokens: 4000, maxItems: 1, ...(policy ? { policy } : {}) } });
      const value = ok(JSON.parse(response.content[0].text));
      assert.deepEqual(response.content, [{ type: 'text', text: meteredText(value) }]);
      assert.equal(value.counter.id, 'tiktoken-o200k_base');
      assert.equal(value.policy.id, policy?.id ?? 'rank-first-whole-v1');
      assert.equal(value.items.length, 1); assert.equal(value.items[0].ref.memoryId, memory.id);
      assert.equal(value.items[0].body.text, canonical); assert.equal(canonical, 'assembly ABC evidence');
      assert.equal(response.isError, false); assert.equal(response.content[0].text.includes('diagnostics'), false);
      assert.equal(response.content[0].text.includes('counterCalls'), false);
      assert.deepEqual(Object.keys(response._meta), [metaKey]);
      const diagnostics = response._meta[metaKey];
      assert.equal(diagnostics.budget.used, countOpenAITokens(response.content[0].text));
      assert.ok(diagnostics.budget.used <= 4000); assert.equal(diagnostics.budget.maxItems, 1);
      assert.equal(diagnostics.candidates.channels.semantic.state, 'disabled');
      assert.ok(Buffer.byteLength(JSON.stringify(response)) <= 262144);
    }
    await client.close();
    const loaded = new Set(readFileSync(trace, 'utf8').trim().split('\n').map(JSON.parse));
    for (const path of added) assert.ok(loaded.has(new URL(path, 'file://' + installed.root + '/').href), path + ' loaded');
  }
  const closure = installedImportClosure(installed.root, roots);
  t.diagnostic(JSON.stringify({ sourceClosure: installedImportClosure(root, roots).required.length,
    installedClosure: closure.required.length, manifest: JSON.parse(readFileSync(join(root, 'packaging/artifact-files.json'))).length,
    installedFilesystem: walk(installed.root).length, archive: installed.artifact.files.length,
    addedModules: added.length, missing: 0, difference: 0, packExit: 0, installExit: 0, paidCalls: 0 }));
});
