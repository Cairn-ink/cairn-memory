import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { buildCoreLocalCandidate } from '../build-core-local.mjs';
import { command } from '../build.mjs';
import { engineIdForCoreLocal } from '../core-local/engine-id.mjs';
import { cliEntry, deriveRuntimeGraph } from '../core-local/import-graph.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const host = 'packaging/core-local/host.mjs';
const slot = 'packaging/core-local/adapter-slot.mjs';

test('generation identity binds canonical filenames and bytes independently of enumeration order', () => {
  const a = digest('a'), b = digest('b');
  const prefix = 'core-local-v1';
  const expected = prefix + '-' + digest(JSON.stringify([prefix, [['a.mjs', a], ['package.json', b]]]));
  assert.equal(engineIdForCoreLocal({ 'package.json': b, 'a.mjs': a }), expected);
  assert.equal(engineIdForCoreLocal({ 'a.mjs': a, 'package.json': b }), expected);
  assert.notEqual(engineIdForCoreLocal({ 'a.mjs': a, 'package.json': a }), expected);
  assert.notEqual(engineIdForCoreLocal({ 'a.mjs': b, 'package.json': b }), expected);
  assert.notEqual(engineIdForCoreLocal({ 'b.mjs': a, 'package.json': b }), expected);
  for (const files of [{ 'a.mjs': a }, { 'package.json': a, '../escape': b }, { 'package.json': 'bad' }]) {
    assert.throws(() => engineIdForCoreLocal(files), /invalid_core_local_file_digests/);
  }
});

function fixture(t, overrides) {
  const { path } = createTestWorkspace(t);
  const files = {
    'packages/core/package.json': '{"exports":{".":{"default":"./src/index.mjs"}}}',
    'packages/core/src/index.mjs': 'export const value = 1;',
    [cliEntry]: "import './host.mjs';",
    [host]: "export const load = () => import('./adapter-slot.mjs');",
    [slot]: "export { DatabaseSync } from 'node:sqlite';",
    ...overrides,
  };
  for (const [file, source] of Object.entries(files)) {
    const name = join(path, file);
    mkdirSync(dirname(name), { recursive: true });
    writeFileSync(name, source);
  }
  return path;
}

test('closure permits SQLite behind the lazy adapter edge and audits unused core modules', t => {
  const path = fixture(t, { 'packages/core/src/unbundled.mjs': 'export const unused = true;' });
  assert.deepEqual(deriveRuntimeGraph(path), ['packages/core/src/index.mjs', slot, cliEntry, host]);
  writeFileSync(join(path, 'packages/core/src/unbundled.mjs'), "import('node:sqlite');");
  assert.throws(() => deriveRuntimeGraph(path), /sqlite_outside_core_local_adapter.*unbundled\.mjs/);
});

test('closure rejects direct, transitive, eager-edge and computed loader bypasses', t => {
  for (const [source, extra, error] of [
    ["import 'node:sqlite'; import('./adapter-slot.mjs');", {}, /sqlite_outside_core_local_adapter/],
    ["import './bridge.mjs'; import('./adapter-slot.mjs');",
      { 'packaging/core-local/bridge.mjs': "export * from 'node:sqlite';" }, /sqlite_outside_core_local_adapter.*bridge/],
    ["export * from './adapter-slot.mjs';", {}, /invalid_core_local_adapter_edge/],
    ["import('./adapter-' + 'slot.mjs');", {}, /unsupported_core_local_import/],
    ["process['getBuiltinModule']('node:sqlite'); import('./adapter-slot.mjs');", {}, /unsupported_core_local_loader/],
  ]) {
    const path = fixture(t, { [host]: source, ...extra });
    assert.throws(() => deriveRuntimeGraph(path), error);
  }
  const path = fixture(t, {
    'packages/core/src/index.mjs': "import('../../../packaging/core-local/adapter-slot.mjs');",
  });
  assert.throws(() => deriveRuntimeGraph(path), /core_import_escapes_package/);
});

test('candidate archive, source graph and installed files have the same contents and the bin starts offline', async t => {
  const { path } = createTestWorkspace(t);
  const out = join(path, 'out');
  const result = buildCoreLocalCandidate(out);
  const archive = join(out, result.archive.filename);
  const archiveBytes = readFileSync(archive);
  assert.equal(result.archive.sha256, digest(archiveBytes));
  assert.equal(result.archive.bytes, archiveBytes.length);
  assert.deepEqual(JSON.parse(readFileSync(join(out, 'candidate-manifest.json'), 'utf8')), result);
  assert.throws(() => buildCoreLocalCandidate(out), { code: 'EEXIST' });

  const install = join(path, 'offline');
  const npmrc = join(path, 'empty.npmrc');
  mkdirSync(install);
  writeFileSync(npmrc, '');
  command('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock',
    '--cache', join(path, 'npm-cache'), archive], install, npmrc);
  const installed = join(install, 'node_modules', result.package.name);
  const corePackage = JSON.parse(readFileSync(join(installed, 'packages/core/package.json'), 'utf8'));
  assert.deepEqual(corePackage.exports, {
    '.': { default: './src/index.mjs' },
    './routing': { default: './src/routing/index.mjs' },
    './ledger': { default: './src/ledger/index.mjs' },
    './service': { default: './src/service/index.mjs' },
  });
  const members = readdirSync(installed, { recursive: true, encoding: 'utf8' })
    .map(file => file.split('\\').join('/'))
    .filter(file => !lstatSync(join(installed, file)).isDirectory()).sort();
  assert.deepEqual(members, Object.keys(result.files).sort());
  for (const file of members) {
    const absolute = join(installed, file);
    assert.ok(lstatSync(absolute).isFile(), file);
    assert.equal(digest(readFileSync(absolute)), result.files[file], file);
  }

  const preload = 'data:text/javascript,' + encodeURIComponent(`
    import { registerHooks } from 'node:module';
    const banned = /^(?:node:)?(?:sqlite|net|http|https|http2|tls|dns|dgram|child_process|worker_threads)(?:\\/|$)/u;
    const stop = () => process.exit(88);
    const builtin = process.getBuiltinModule;
    process.getBuiltinModule = name => banned.test(name) ? stop() : builtin(name);
    globalThis.fetch = globalThis.WebSocket = stop;
    registerHooks({ resolve(specifier, context, next) {
      if (banned.test(specifier) || specifier.endsWith('/adapter-slot.mjs')) stop();
      return next(specifier, context);
    } });
  `);
  const executable = process.platform === 'win32' ? join(installed, cliEntry)
    : join(install, 'node_modules', '.bin', 'cairn-memory-core-local');
  const run = (args, input) => {
    const child = spawnSync(process.execPath, ['--no-experimental-sqlite', '--import', preload, executable, ...args], {
      cwd: install, env: { HOME: path }, input, encoding: 'utf8', timeout: 10_000,
    });
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stderr, '');
    return child.stdout;
  };
  assert.match(run(['--help']), /Staging MCP handshake/);
  const requests = [
    { id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {},
      clientInfo: { name: 'synthetic', version: '1' } } },
    { method: 'notifications/initialized' },
    { id: 2, method: 'ping' },
  ].map(request => JSON.stringify({ jsonrpc: '2.0', ...request }) + '\n').join('');
  const handshake = run(['--stdio'], requests).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(handshake, [
    { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25', capabilities: {},
      serverInfo: { name: result.package.name, version: result.package.version } } },
    { jsonrpc: '2.0', id: 2, result: {} },
  ]);
  const { openLocalService } = await import(pathToFileURL(join(installed, host)).href);
  await assert.rejects(() => openLocalService({}, {}), /core_local_adapter_unavailable/);
});
