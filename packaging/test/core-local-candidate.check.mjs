// Threat model: this static audit catches ACCIDENTAL capability use (SQLite, network,
// native, worker or child-process access) in first-party code reachable from the
// candidate's entry points. It is not a sandbox: code written to evade it on purpose,
// for example through reflection, is out of scope. The runtime check is the builder's
// installed startup smoke with SQLite disabled.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
const coreEntry = 'packages/core/src/index.mjs';
const deferredHost = `export async function openLocalService() {
  const { DatabaseSync } = await import('./adapter-slot.mjs');
  return DatabaseSync;
}
export function serveStdio() {}
`;

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
    [coreEntry]: 'export const value = 1;',
    [cliEntry]: "import { serveStdio } from './host.mjs';",
    [host]: deferredHost,
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
  assert.deepEqual(deriveRuntimeGraph(path), [coreEntry, slot, cliEntry, host]);
  writeFileSync(join(path, 'packages/core/src/unbundled.mjs'), "import('node:sqlite');");
  assert.throws(() => deriveRuntimeGraph(path), /sqlite_outside_core_local_adapter.*unbundled\.mjs/);
});

const cases = [
  ['direct SQLite', { [host]: "import 'node:sqlite';" + deferredHost }, /sqlite_outside_core_local_adapter/],
  ['transitive SQLite', { [host]: "import './bridge.mjs';" + deferredHost,
    'packaging/core-local/bridge.mjs': "export * from 'node:sqlite';" }, /sqlite_outside_core_local_adapter.*bridge/],
  ['static adapter edge', { [host]: "export * from './adapter-slot.mjs';" }, /invalid_core_local_adapter_edge/],
  ['top-level awaited adapter import', { [host]: "await import('./adapter-slot.mjs');" + deferredHost },
    /invalid_core_local_adapter_edge/],
  ['adapter import in an invoked wrapper', { [host]: "(() => import('./adapter-slot.mjs'))();" + deferredHost },
    /invalid_core_local_adapter_edge/],
  ['computed adapter specifier', { [host]: "import('./adapter-' + 'slot.mjs');" + deferredHost },
    /unsupported_core_local_import/],
  ['direct host call', { [host]: deferredHost + 'await openLocalService();' }, /eager_core_local_composition_reference/],
  ['aliased host call', { [host]: deferredHost + 'const open = openLocalService; await open();' },
    /eager_core_local_composition_reference/],
  ['CLI composition import', { [cliEntry]: "import { openLocalService as open } from './host.mjs'; await open();" },
    /invalid_core_local_host_edge/],
  ['CLI namespace import', { [cliEntry]: "import * as host from './host.mjs'; await host.openLocalService();" },
    /invalid_core_local_host_edge/],
  ['CLI dynamic host import', { [cliEntry]: "const host = await import('./host.mjs'); await host.openLocalService();" },
    /invalid_core_local_host_edge/],
  ['transitive host re-export', { [cliEntry]: "import './bridge.mjs';",
    'packaging/core-local/bridge.mjs': "export * from './host.mjs';" }, /invalid_core_local_host_edge/],
  ['core adapter import', { [coreEntry]: "import('../../../packaging/core-local/adapter-slot.mjs');" },
    /core_import_escapes_package/],
];
for (const [label, overrides, error] of cases) {
  test(`closure rejects ${label}`, t => assert.throws(() => deriveRuntimeGraph(fixture(t, overrides)), error));
}

const capabilities = [
  ['named builtin loader', "process['getBuiltinModule']('node:sqlite');", /unsupported_core_local_loader/],
  ['computed builtin loader', "process['get' + 'BuiltinModule']('node:sqlite');"],
  ['process binding', 'const load = process.binding;'],
  ['process dlopen', 'const load = process.dlopen;'],
  ['ambient fetch', 'const request = fetch;'],
  ['ambient WebSocket', 'const socket = WebSocket;'],
  ['ambient XMLHttpRequest', 'const request = XMLHttpRequest;'],
  ['ambient EventSource', 'const stream = EventSource;'],
  ['ambient WebAssembly', 'const native = WebAssembly;'],
  ['ambient Worker', 'const worker = Worker;'],
  ['ambient require', 'const load = require;'],
  ['ambient eval', 'const run = eval;'],
  ['aliased global', "const ambient = globalThis; const request = ambient['fe' + 'tch'];"],
  ['computed constructor', "const make = (() => {})['con' + 'structor'];"],
  ['out-of-scope shadow', '{ const fetch = 1; } const request = fetch;'],
  ['switch discriminant', 'switch (fetch) { default: let fetch; }'],
  ['parameter initializer outside the function body', 'function run(request = fetch) { var fetch; return request; }'],
];
for (const [label, statement, error = /unsupported_core_local_capability/] of capabilities) {
  test(`closure rejects ${label} in host and core`, t => {
    assert.throws(() => deriveRuntimeGraph(fixture(t, { [host]: deferredHost + statement })), error);
    assert.throws(() => deriveRuntimeGraph(fixture(t, { [coreEntry]: statement })), error);
  });
}

test('closure permits injected capabilities and CLI stdio while refusing broader process access', t => {
  const path = fixture(t, {
    [coreEntry]: 'export function run({ fetch }) { if (fetch) { var call = fetch; } return call(); }',
    [cliEntry]: `import { serveStdio } from './host.mjs';
      if (process.argv.length) await serveStdio(process.stdin, process.stdout);
      else { console.error('usage'); process.exitCode = 2; }`,
  });
  assert.deepEqual(deriveRuntimeGraph(path), [coreEntry, slot, cliEntry, host]);
  for (const access of ['process', "process['argv']", 'process.env', 'process.binding', 'process.dlopen']) {
    writeFileSync(join(path, cliEntry), `import { serveStdio } from './host.mjs'; const value = ${access};`);
    assert.throws(() => deriveRuntimeGraph(path), /unsupported_core_local_capability.*process/);
  }
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

  const { openLocalService } = await import(pathToFileURL(join(installed, host)).href);
  await assert.rejects(() => openLocalService({}, {}), /core_local_adapter_unavailable/);
});

test('builder checks installed help and handshake before publishing a candidate', t => {
  const { path } = createTestWorkspace(t);
  const build = 'packaging/build-core-local.mjs';
  for (const file of ['LICENSE', 'packages/core/package.json', 'packages/core/src', 'packaging/core-local',
    build, 'packaging/build.mjs', 'packaging/artifact-files.json', 'packaging/core-local-files.json',
    'tools/testing/vendor/acorn/acorn.mjs']) {
    cpSync(new URL('../../' + file, import.meta.url), join(path, file), { recursive: true });
  }
  // The installed slot can link SQLite when composed. Startup must never load it.
  writeFileSync(join(path, slot), "export { DatabaseSync } from 'node:sqlite';\n" + readFileSync(join(path, slot), 'utf8'));
  const cliSource = readFileSync(join(path, cliEntry), 'utf8');
  const hostSource = readFileSync(join(path, host), 'utf8');
  const run = label => spawnSync(process.execPath, [join(path, build), '--output', join(path, label)], {
    encoding: 'utf8', timeout: 30_000,
  });
  const valid = run('valid');
  assert.ifError(valid.error);
  assert.equal(valid.status, 0, valid.stderr);
  for (const [file, oldSource, from, to, error] of [
    [cliEntry, cliSource, 'Usage:', 'Broken:', /core_local_startup_help_mismatch/],
    [host, hostSource, 'reply.result = {};', 'reply.result = { broken: true };', /core_local_startup_handshake_mismatch/],
  ]) {
    const updated = oldSource.replace(from, to);
    assert.notEqual(updated, oldSource);
    writeFileSync(join(path, file), updated);
    assert.doesNotThrow(() => deriveRuntimeGraph(path));
    const rejected = run('rejected');
    assert.ifError(rejected.error);
    assert.equal(rejected.status, 1, rejected.stderr);
    assert.match(rejected.stderr, error);
    assert.equal(existsSync(join(path, 'rejected')), false);
    writeFileSync(join(path, file), oldSource);
  }
});
