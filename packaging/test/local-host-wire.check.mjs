import assert from 'node:assert/strict';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { buildCoreLocalCandidate } from '../build-core-local.mjs';
import { deriveRuntimeGraph } from '../core-local/import-graph.mjs';
import { compareWire, diagnosticsKey, golden, installCandidate, scopeArgs, snapshotKey, withStdio } from './fixtures/local-host-wire-replay.mjs';

import { compareFiledWire, seedFreshFiled } from './fixtures/installed-local-0.6.11-filed-wire.mjs';

const host = 'packaging/core-local/host.mjs';
const cli = 'packaging/core-local/cli.mjs';
const copyInputs = ['packaging/core-local', 'packages/core/package.json', 'packages/core/src', 'packages/adapter-sqlite/src'];
const require = createRequire(import.meta.url);

test('installed core-local candidate runs the 50-exchange SQLite round trip', async t => {
  const { path } = createTestWorkspace(t);
  const output = join(path, 'out');
  const result = buildCoreLocalCandidate(output);
  const installed = installCandidate(join(path, 'install'), join(output, result.archive.filename), result.package.name);
  const encoding = require('../core-local/vendor/tiktoken/tiktoken.cjs').get_encoding('o200k_base');
  t.after(() => encoding.free());
  await t.test('save, find, read, fetch and forget through the installed bin', async () => {
    const args = ['--db', join(path, 'smoke.sqlite'), ...scopeArgs];
    const search = { query: 'petrel', types: ['memory'], intent: 'current' };
    const content = 'The synthetic petrel has a green ribbon.';
    const call = async (request, name, args) => {
      const { result } = await request('tools/call', { name, arguments: args });
      const envelope = JSON.parse(result.content[0].text);
      assert.equal(result.isError, !envelope.ok);
      return { ...envelope, meta: result._meta };
    };
    const snapshot = await withStdio(installed.bin, args, path, async (request, notify) => {
      assert.deepEqual(await request('initialize', golden.exchanges.initialize.params), golden.exchanges.initialize.response);
      notify('notifications/initialized');
      const saved = (await call(request, 'remember_memory', { content })).value;
      const found = (await call(request, 'find_memory_candidates', search)).value;
      assert.equal(found.items[0].ref.memoryId, saved.memory.id);
      const read = await call(request, 'read_memory_context', search);
      assert.equal(read.value.items[0].body, content);
      const snapshot = read.meta[snapshotKey];
      assert.match(snapshot, /^[A-Za-z0-9_-]{43}$/u);
      assert.equal((await call(request, 'fetch_memory_candidate_evidence', { snapshot })).value.items[0].content, content);
      assert.equal((await call(request, 'fetch_memory_candidate_evidence',
        { refs: [found.items[0].ref], intent: 'current' })).value.items[0].content, content);
      const forgotten = (await call(request, 'forget_memory',
        { memoryId: saved.memory.id, expectedRevision: saved.memory.revision })).value;
      assert.deepEqual(forgotten, { forgotten: true, indexRevision: saved.indexRevision + 1 });
      assert.deepEqual((await call(request, 'find_memory_candidates', search)).value.items, []);
      assert.equal((await call(request, 'fetch_memory_candidate_evidence', { snapshot })).error.code, 'snapshot_stale');
      return snapshot;
    });
    await withStdio(installed.bin, args, path, async (request, notify) => {
      await request('initialize', golden.exchanges.initialize.params);
      notify('notifications/initialized');
      assert.equal((await call(request, 'fetch_memory_candidate_evidence', { snapshot })).error.code, 'snapshot_stale');
    });
  });
  const count = text => encoding.encode(text, [], []).length;
  await t.test('unmodified candidate replay matches the golden', async t => {
    const args = ['--db', join(path, 'active.sqlite'), ...scopeArgs];
    const comparison = await withStdio(installed.bin, args, path, (request, notify) =>
      compareWire(request, notify, count));
    t.diagnostic(comparison.matched + ' of ' + comparison.total + ' candidate exchanges matched');
    assert.equal(comparison.total, 50);
    assert.equal(comparison.matched, 50);
    assert.deepEqual(comparison.differences, []);
  });
  await t.test('inspect procedural cannot match by returning a literal UUID placeholder', async t => {
    const args = ['--db', join(path, 'placeholder.sqlite'), ...scopeArgs];
    const comparison = await withStdio(installed.bin, args, path, (request, notify) =>
      compareWire(async (method, params, label) => {
        const reply = await request(method, params);
        if (label === 'inspect procedural') {
          const block = reply.result.content[0];
          const envelope = JSON.parse(block.text);
          envelope.value.memory.id = '<uuid-6>';
          block.text = JSON.stringify(envelope);
          const budget = reply.result._meta?.[diagnosticsKey]?.budget;
          if (budget) budget.used = count(block.text);
        }
        return reply;
      }, notify, count));
    t.diagnostic(comparison.matched + ' of ' + comparison.total + ' candidate exchanges matched with a literal placeholder');
    assert.equal(comparison.total, 50);
    assert.equal(comparison.matched, 49);
    assert.deepEqual(comparison.differences, ['inspect procedural reserved normalization placeholder in id']);
  });
});

test('the real runtime graph refuses startup composition and unapproved adapter capabilities', t => {
  const { path } = createTestWorkspace(t);
  for (const file of copyInputs) cpSync(new URL('../../' + file, import.meta.url), join(path, file), { recursive: true });
  assert.doesNotThrow(() => deriveRuntimeGraph(path));
  const cases = [
    [host, text => text + '\nawait openLocalService({});', /eager_core_local_composition_reference/],
    [host, text => text.replace('if (scope && !error)', 'if (scope)'), /eager_core_local_composition_reference/],
    [cli, text => text.replace('import { serveStdio }', 'import { serveStdio, openLocalService }'), /invalid_core_local_host_edge/],
    [host, text => text + "\nexport function another() { return import('./adapter-slot.mjs'); }", /invalid_core_local_adapter_edge/],
    [host, text => text + "\nimport { openSqliteAdapter } from '../../packages/adapter-sqlite/src/adapter.mjs';", /invalid_core_local_sqlite_edge/],
    [host, text => text + "\nimport tokenizer from './vendor/tiktoken/tiktoken.cjs';", /unsupported_core_local_import/],
    ['packages/adapter-sqlite/src/uow.mjs', text => text + "\nimport { readFileSync } from 'node:fs';", /unsupported_core_local_import/],
  ];
  for (const [file, change, expected] of cases) {
    const filename = join(path, file);
    const source = readFileSync(filename, 'utf8');
    const mutant = change(source);
    assert.notEqual(mutant, source);
    writeFileSync(filename, mutant);
    assert.throws(() => deriveRuntimeGraph(path), expected);
    writeFileSync(filename, source);
  }
});

test('fresh installed core-local matches filed inspect and relation wire', async t => {
  const { path } = createTestWorkspace(t);
  const output = join(path, 'out');
  const built = buildCoreLocalCandidate(output);
  const installed = installCandidate(join(path, 'install'), join(output, built.archive.filename), built.package.name);
  const database = join(path, 'filed.sqlite');
  const ids = await seedFreshFiled(database);
  const comparison = await compareFiledWire(installed.bin, database, path, ids);
  t.diagnostic(comparison.matched + ' of ' + comparison.total + ' fresh filed exchanges matched');
  assert.equal(comparison.total, 4);
  assert.deepEqual(comparison.differences, []);
});
