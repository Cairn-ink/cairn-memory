import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { accessSync, constants, cpSync, existsSync, lstatSync, mkdirSync, readFileSync,
  readdirSync, realpathSync, rmSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { delimiter, dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { engineCacheComplete, primeEngineCache } from './engine-cache.mjs';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const sourceSetup = join(repo, 'packages', 'setup');
const setup = process.env.CAIRN_SETUP_TEST_PACKAGE || sourceSetup;
const { installEngine, verifyInstalledTree, engineIdFor, engineBaseId, nextRepairId } =
  await import(pathToFileURL(join(setup, 'lib/local-engine.mjs')));
const bytes = readFileSync(join(setup, 'runtime/engine/manifest.json'));
const manifest = JSON.parse(bytes);
const installerVersion = JSON.parse(readFileSync(join(setup, 'package.json'))).version;
const id = engineIdFor(installerVersion, bytes);
const archive = join(setup, 'runtime/engine', `${manifest.package.name}-${manifest.package.version}.tgz`);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const workspace = t => createTestWorkspace(t, { prefix: 'cairn-setup-engine-' }).path;
function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 120000,
    maxBuffer: 8 * 1024 * 1024, ...options });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}
function command(executable, args, options) {
  const result = run(executable, args, options);
  assert.equal(result.status, 0, `exit ${result.status}: ${result.stderr}`);
  return result.stdout;
}
function diskFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? diskFiles(join(directory, entry.name)).map(name => `${entry.name}/${name}`) : [entry.name]).sort();
}
const tarFiles = archive => command('tar', ['-tzf', archive]).trim().split(/\r?\n/u)
  .map(name => name.replace(/^package\//u, '')).sort();
function countMatch(t, label, first, second) {
  const message = `${label}: route A=${first.length}, route B=${second.length}`;
  assert.deepEqual([...first].sort(), [...second].sort(), message);
  t.diagnostic(message);
}

test('E02 engine inventory: archive/manifest and source allowlist/extracted tree', t => {
  const directory = workspace(t);
  command('tar', ['-xzf', archive, '-C', directory]);
  countMatch(t, 'archive vs manifest', tarFiles(archive), manifest.files);
  const mapped = new Map([
    ...json(join(repo, 'packaging/artifact-files.json')).map(name => [name, name]),
    ['bin/cairn-memory.mjs', 'packaging/bin/cairn-memory.mjs'],
    ['README.md', 'packaging/README.md'],
    ['THIRD_PARTY_NOTICES.md', 'packaging/THIRD_PARTY_NOTICES.md'],
    ['licenses/tiktoken-LICENSE', 'packaging/licenses/tiktoken-LICENSE'],
  ]);
  countMatch(t, 'source allowlist plus generated vs extracted disk',
    [...mapped.keys(), 'package.json', 'npm-shrinkwrap.json'], diskFiles(join(directory, 'package')));
  countMatch(t, 'source hashes vs source allowlist', Object.keys(manifest.sourceHashes), [...mapped.keys()]);
  for (const [target, source] of mapped) {
    assert.equal(manifest.sourceHashes[target], hash(readFileSync(join(repo, source))), target);
    assert.equal(hash(readFileSync(join(directory, 'package', target))), manifest.sourceHashes[target], target);
  }
  assert.deepEqual(Object.keys(manifest.generatedHashes).sort(), ['npm-shrinkwrap.json', 'package.json']);
  for (const [name, expected] of Object.entries(manifest.generatedHashes)) {
    assert.equal(hash(readFileSync(join(directory, 'package', name))), expected, name);
  }
  assert.equal(hash(readFileSync(archive)), manifest.sha256);
  assert.equal(lstatSync(archive).size, manifest.bytes);
  assert.equal(id, `${installerVersion}-${hash(bytes).slice(0, 12)}`);
});

test('E03 packed installer inventory: npm JSON, files rules/disk, and tar agree', t => {
  const directory = workspace(t);
  const result = JSON.parse(command('npm', ['pack', '--offline', '--ignore-scripts', '--json',
    '--pack-destination', directory], { cwd: setup,
    env: { ...process.env, npm_config_cache: join(directory, 'cache') } }));
  assert.equal(result.length, 1);
  const packed = result[0].files.map(entry => entry.path);
  const rules = json(join(setup, 'package.json')).files;
  const expected = new Set(['package.json']);
  for (const rule of rules) {
    if (rule.endsWith('/')) for (const name of diskFiles(join(setup, rule))) expected.add(rule + name);
    else if (existsSync(join(setup, rule))) expected.add(rule);
  }
  countMatch(t, 'npm pack JSON vs files rules and disk', packed, [...expected]);
  countMatch(t, 'tar vs npm pack JSON', tarFiles(join(directory, result[0].filename)), packed);
  countMatch(t, 'packed runtime vs runtime disk', packed.filter(name => name.startsWith('runtime/')),
    diskFiles(join(setup, 'runtime')).map(name => 'runtime/' + name));
});

test('E03 prepack check passes, permits archive drift, and rejects a stale manifest byte', t => {
  const directory = workspace(t);
  const copy = join(directory, 'packages/setup');
  mkdirSync(join(directory, 'packages'));
  cpSync(sourceSetup, copy, { recursive: true });
  // Only the setup package is mutable. Build-time repository inputs are read
  // through these links; the build continues to use the actual packaging code.
  for (const name of ['packaging', 'integrations']) symlinkSync(join(repo, name), join(directory, name));
  const check = () => run(process.execPath, [join(copy, 'build-runtime.mjs'), '--check']);
  let result = check();
  assert.equal(result.status, 0, `check exit ${result.status}: ${result.stderr}`);
  const manifestPath = join(copy, 'runtime/engine/manifest.json');
  const copiedArchive = join(copy, relative(setup, archive));
  const changedArchive = gzipSync(gunzipSync(readFileSync(copiedArchive)), { level: 1 });
  writeFileSync(copiedArchive, changedArchive);
  const changed = json(manifestPath);
  changed.sha256 = hash(changedArchive); changed.bytes = changedArchive.length;
  writeFileSync(manifestPath, JSON.stringify(changed, null, 2) + '\n');
  result = check();
  assert.equal(result.status, 0, `drift check exit ${result.status}: ${result.stderr}`);
  assert.match(result.stderr, /engine_bundle_sha_drift/u);
  // Flip exactly one hash byte while retaining valid JSON.
  changed.sha256 = (changed.sha256[0] === 'a' ? 'b' : 'a') + changed.sha256.slice(1);
  writeFileSync(manifestPath, JSON.stringify(changed, null, 2) + '\n');
  result = check();
  assert.equal(result.status, 1, `stale check exit ${result.status}`);
  assert.match(result.stderr, /engine_bundle_stale/u);
});

function fakeNpm(directory, body) {
  const bin = join(directory, 'bin'); mkdirSync(bin);
  symlinkSync(process.execPath, join(bin, 'node'));
  writeFileSync(join(bin, 'npm'), `#!${process.execPath}\n${body}\n`, { mode: 0o755 });
  return { node: join(bin, 'node'), PATH: bin + delimiter + (process.env.PATH ?? '') };
}
function rootAt(directory) {
  const root = join(directory, 'root'); mkdirSync(root, { mode: 0o700 });
  writeFileSync(join(root, '.npmrc'), 'registry=https://registry.npmjs.org/\n', { mode: 0o600 });
  return root;
}

test('engineBaseId accepts repair generations and strips exactly one valid suffix', () => {
  assert.equal(engineBaseId(id), id);
  for (const generation of ['2', '9', '10', '19', '100']) {
    assert.equal(engineBaseId(`${id}-r${generation}`), id);
  }
  const prerelease = `1.2.3-beta.1-${hash(bytes).slice(0, 12)}`;
  assert.equal(engineBaseId(prerelease + '-r2'), prerelease);
  for (const suffix of ['-r1', '-r01', '-r2-r2']) {
    assert.throws(() => engineBaseId(id + suffix), { key: 'local_engine_install_failed' });
  }
});

test('nextRepairId skips existing and failed generations and chooses the smallest free number', async t => {
  const directory = workspace(t), root = rootAt(directory);
  const engines = join(root, 'engine'); mkdirSync(engines);
  assert.equal(await nextRepairId(root, id), id + '-r2');
  for (let generation = 2; generation <= 9; generation++) {
    mkdirSync(join(engines, `${id}-r${generation}${generation === 5 ? '.failed-123' : ''}`));
  }
  assert.equal(await nextRepairId(root, id), id + '-r10');
  rmSync(join(engines, id + '-r4'), { recursive: true });
  assert.equal(await nextRepairId(root, id), id + '-r4');
});

test('installEngine requires explicit references before creating an engine directory', async t => {
  const directory = workspace(t), root = rootAt(directory);
  await assert.rejects(installEngine({ root, engineId: id, node: process.execPath, env: {} }),
    { key: 'local_engine_install_failed', code: 1 });
  assert.equal(existsSync(join(root, 'engine')), false);
});

test('npm exit 1 quarantines all partial files, captures diagnostics, and prints none', async t => {
  const directory = workspace(t), root = rootAt(directory);
  const fake = fakeNpm(directory, `import {writeFileSync} from 'node:fs';
    writeFileSync('partial-marker', 'retained');
    console.log('synthetic-private-output'); console.error('synthetic-private-error'); process.exit(1);`);
  const output = [];
  await assert.rejects(installEngine({ root, engineId: id, node: fake.node, references: new Set(),
    env: { PATH: fake.PATH, CAIRN_SETUP_NPM_OFFLINE: '1' }, write: line => output.push(line) }), error => {
    assert.equal(error.key, 'local_engine_install_failed'); assert.equal(error.code, 1);
    assert.equal(error.params.exitCode, 1);
    assert.match(error.params.stdout, /synthetic-private-output/u, JSON.stringify(error.params));
    assert.match(error.params.stderr, /synthetic-private-error/u);
    assert.doesNotMatch(error.message, /synthetic-private/u);
    return true;
  });
  assert.doesNotMatch(output.join('\n'), /synthetic-private/u);
  assert.equal(existsSync(join(root, 'engine', id)), false);
  const failed = readdirSync(join(root, 'engine')).filter(name => name.startsWith(id + '.failed-'));
  assert.equal(failed.length, 1); assert.match(failed[0], /\.failed-\d+$/u);
  assert.equal(readFileSync(join(root, 'engine', failed[0], 'app/partial-marker'), 'utf8'), 'retained');
  assert.equal(json(join(root, 'engine', failed[0], 'app/package.json')).private, true);
});

function extractedApp(app) {
  const modules = join(app, 'node_modules'); mkdirSync(modules, { recursive: true });
  command('tar', ['-xzf', archive, '-C', modules]);
  // An extracted engine plus synthetic dependency manifests isolates the tree
  // verifier without fetching or pretending to prove a loadable installation.
  const engine = join(modules, manifest.package.name);
  renameSync(join(modules, 'package'), engine);
  for (const [name, version] of Object.entries({ '@modelcontextprotocol/server': '2.0.0',
    '@modelcontextprotocol/core': '2.0.0', zod: '4.5.4', tiktoken: '1.0.22' })) {
    mkdirSync(join(modules, name), { recursive: true });
    writeFileSync(join(modules, name, 'package.json'), JSON.stringify({ name, version }));
  }
  return engine;
}

test('installed-tree verification rejects missing, changed, extra files and dependency drift', async t => {
  const directory = workspace(t), app = join(directory, 'app');
  const engine = extractedApp(app), modules = join(app, 'node_modules');
  assert.equal(await verifyInstalledTree(app, manifest), true);
  const victim = join(engine, manifest.files[0]), original = readFileSync(victim);
  rmSync(victim);
  await assert.rejects(verifyInstalledTree(app, manifest), { key: 'local_engine_verification_failed', code: 1 });
  writeFileSync(victim, original); writeFileSync(victim, 'changed');
  await assert.rejects(verifyInstalledTree(app, manifest), { key: 'local_engine_verification_failed' });
  writeFileSync(victim, original); writeFileSync(join(engine, 'extra'), 'extra');
  await assert.rejects(verifyInstalledTree(app, manifest), { key: 'local_engine_verification_failed' });
  rmSync(join(engine, 'extra'));
  writeFileSync(join(modules, 'zod/package.json'), '{"name":"zod","version":"0.0.0"}');
  await assert.rejects(verifyInstalledTree(app, manifest), { key: 'local_engine_verification_failed' });
});

async function brokenInstall(directory, root, engineId) {
  const template = join(directory, 'template');
  extractedApp(template);
  assert.equal(await verifyInstalledTree(template, manifest), true);
  const installed = join(root, 'engine', engineId);
  mkdirSync(installed, { recursive: true, mode: 0o700 });
  cpSync(template, join(installed, 'app'), { recursive: true });
  rmSync(join(installed, 'app/node_modules', manifest.package.name, manifest.files[0]));
  return installed;
}

test('unreferenced broken tree is quarantined before reinstalling the same id in one call', async t => {
  const directory = workspace(t), root = rootAt(directory);
  const installed = await brokenInstall(directory, root, id);
  const before = diskFiles(installed);
  const recording = join(directory, 'reinstall.json');
  const fake = fakeNpm(directory, `import {readdirSync,writeFileSync} from 'node:fs';
    const failed=readdirSync(${JSON.stringify(join(root, 'engine'))})
      .filter(name=>name.startsWith(${JSON.stringify(id + '.failed-')}));
    writeFileSync(${JSON.stringify(recording)},JSON.stringify({failed,cwd:process.cwd()}));
    process.exit(1);`);
  await assert.rejects(installEngine({ root, engineId: id, node: fake.node, references: [],
    env: { PATH: fake.PATH, CAIRN_SETUP_NPM_OFFLINE: '1' } }), error => {
    assert.equal(error.key, 'local_engine_install_failed'); assert.equal(error.params.exitCode, 1);
    return true;
  });
  const observed = json(recording);
  assert.equal(observed.failed.length, 1, 'broken tree was quarantined before npm ran');
  assert.equal(observed.cwd, join(installed, 'app'));
  const engines = join(root, 'engine');
  assert.deepEqual(diskFiles(join(engines, observed.failed[0])), before);
  const failed = readdirSync(engines).filter(name => name.startsWith(id + '.failed-'));
  assert.equal(failed.length, 2, 'both the broken tree and the failed reinstall are retained');
  const reinstalled = failed.find(name => name !== observed.failed[0]);
  assert.deepEqual(diskFiles(join(engines, reinstalled)), ['app/package.json']);
  assert.equal(existsSync(installed), false);
});

test('referenced broken tree remains untouched while a fresh repair generation fails', async t => {
  const directory = workspace(t), root = rootAt(directory);
  const installed = await brokenInstall(directory, root, id);
  const before = diskFiles(installed);
  const hashes = before.map(name => hash(readFileSync(join(installed, name))));
  const recording = join(directory, 'repair-cwd');
  const fake = fakeNpm(directory, `import {writeFileSync} from 'node:fs';
    writeFileSync(${JSON.stringify(recording)},process.cwd()); process.exit(1);`);
  await assert.rejects(installEngine({ root, engineId: id, node: fake.node, references: new Set([id]),
    env: { PATH: fake.PATH, CAIRN_SETUP_NPM_OFFLINE: '1' } }), error => {
    assert.equal(error.key, 'local_engine_install_failed'); assert.equal(error.params.exitCode, 1);
    return true;
  });
  assert.equal(readFileSync(recording, 'utf8'), join(root, 'engine', id + '-r2', 'app'));
  assert.deepEqual(diskFiles(installed), before);
  assert.deepEqual(before.map(name => hash(readFileSync(join(installed, name)))), hashes);
  const engines = readdirSync(join(root, 'engine'));
  assert.equal(engines.some(name => name.startsWith(id + '.failed-')), false);
  const failed = engines.filter(name => name.startsWith(id + '-r2.failed-'));
  assert.equal(failed.length, 1);
  assert.deepEqual(diskFiles(join(root, 'engine', failed[0])), ['app/package.json']);
  assert.equal(existsSync(join(root, 'engine', id + '-r2')), false);
});

const skipReason = 'Set CAIRN_SETUP_TEST_NETWORK=1 for the network phase, or supply a complete CAIRN_SETUP_NPM_CACHE.';
test('offline install verifies the tree, exact child environment, check JSON, and npm-free repeat', async t => {
  const directory = workspace(t);
  const cache = process.env.CAIRN_SETUP_NPM_CACHE || join(directory, 'cache');
  if (!engineCacheComplete(cache) && (process.env.CAIRN_SETUP_TEST_NETWORK !== '1' ||
      process.env.CAIRN_SETUP_NPM_OFFLINE === '1')) { t.skip(skipReason); return; }
  await primeEngineCache(cache);
  const root = rootAt(directory), recording = join(directory, 'npm-env.json');
  let npmCLI;
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    try {
      const candidate = realpathSync(join(directory, 'npm'));
      accessSync(candidate, constants.X_OK);
      if (lstatSync(candidate).isFile()) { npmCLI = candidate; break; }
    } catch { /* Keep searching the test process's PATH. */ }
  }
  assert.ok(npmCLI, 'Cannot find an executable npm on the test process PATH.');
  const fake = fakeNpm(directory, `import {writeFileSync} from 'node:fs';
    import {spawnSync} from 'node:child_process';
    writeFileSync(${JSON.stringify(recording)}, JSON.stringify({env:process.env,args:process.argv.slice(2)}));
    const r=spawnSync(${JSON.stringify(process.execPath)},[${JSON.stringify(npmCLI)},...process.argv.slice(2)],
      {env:process.env,stdio:'inherit'}); process.exit(r.status ?? 1);`);
  const env = { PATH: fake.PATH, CAIRN_SETUP_NPM_CACHE: cache, CAIRN_SETUP_NPM_OFFLINE: '1',
    HOME: join(directory, 'must-not-inherit'), OPENAI_API_KEY: 'synthetic-must-not-inherit',
    CAIRN_OTHER: 'must-not-inherit', TMPDIR: directory, TMP: directory, TEMP: directory };
  const args = { root, engineId: id, node: fake.node, env, references: new Set(), ownerId: 'synthetic-owner',
    databasePath: join(root, 'data/memory.sqlite') };
  const installed = await installEngine(args);
  const app = join(root, 'engine', id, 'app');
  assert.equal(await verifyInstalledTree(app, manifest), true);
  assert.equal(installed.executable, join(app, 'node_modules', manifest.package.name, 'bin/cairn-memory.mjs'));
  assert.equal(lstatSync(installed.executable).isFile(), true);
  assert.equal(installed.sha256, manifest.sha256);
  const recorded = json(recording);
  const expectedEnv = { PATH: `${dirname(fake.node)}${delimiter}${env.PATH}`,
    npm_config_userconfig: join(root, '.npmrc'), npm_config_cache: cache,
    npm_config_audit: 'false', npm_config_fund: 'false', TMPDIR: directory, TMP: directory, TEMP: directory };
  assert.deepEqual(recorded.env, expectedEnv);
  for (const key of ['HOME', 'OPENAI_API_KEY', 'CAIRN_SETUP_NPM_CACHE', 'CAIRN_SETUP_NPM_OFFLINE']) {
    assert.equal(Object.hasOwn(recorded.env, key), false, key);
  }
  assert.deepEqual(recorded.args, ['install', '--prefix', app, '--ignore-scripts', '--no-audit',
    '--no-fund', '--offline', archive]);
  const check = JSON.parse(command(fake.node, [installed.executable, '--check-config',
    '--db', args.databasePath, '--owner', args.ownerId], { env: expectedEnv }));
  assert.deepEqual(check, { ok: true, mode: 'configuration-check', scope: 'personal', modelKeyPresent: false,
    recallModel: null, recall: 'model_not_configured', cloudProcessing: false,
    automaticCapture: false, databaseOpened: false, providerContacted: false,
    unverified: ['database-readiness', 'credential-validity', 'model-availability'] });
  assert.equal(existsSync(args.databasePath), false);
  writeFileSync(join(dirname(fake.node), 'npm'), `#!${process.execPath}\nprocess.exit(99);\n`, { mode: 0o755 });
  assert.deepEqual(await installEngine(args), installed);
  const copy = join(directory, 'installed-copy'); cpSync(app, copy, { recursive: true });
  rmSync(join(copy, 'node_modules', manifest.package.name, manifest.files[0]));
  await assert.rejects(verifyInstalledTree(copy, manifest), { key: 'local_engine_verification_failed' });
});
