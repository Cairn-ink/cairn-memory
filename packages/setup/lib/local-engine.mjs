import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { SetupError } from './errors.mjs';
import { legacyEngineIdPattern as engineIdPattern, coreLocalEngineIdPattern, legacyEngine,
  coreLocalEngine, engineExecutable } from './local-engine-generation.mjs';

const bundle = new URL('../runtime/engine/', import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pins = { '@modelcontextprotocol/server': '2.3.1', '@modelcontextprotocol/core': '2.3.1',
  zod: '4.6.7', tiktoken: '1.0.22' };
const failure = (key, params = {}) => new SetupError(key, 1, params);

export function engineIdFor(installerVersion, manifestBytes) {
  return `${installerVersion}-${hash(manifestBytes).slice(0, 12)}`;
}

export function engineBaseId(engineId) {
  if (typeof engineId !== 'string' || !(engineIdPattern.test(engineId) || coreLocalEngineIdPattern.test(engineId))) {
    throw failure('local_engine_install_failed');
  }
  return engineId.replace(/-r(?:[2-9]|[1-9]\d+)$/u, '');
}

export async function nextRepairId(root, baseId) {
  if (engineBaseId(baseId) !== baseId) throw failure('local_engine_install_failed');
  let entries;
  try { entries = await readdir(join(root, 'engine')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw failure('local_engine_install_failed', { code: error.code });
    entries = [];
  }
  for (let generation = 2; ; generation++) {
    const candidate = `${baseId}-r${generation}`;
    if (!entries.some(name => name === candidate || name.startsWith(candidate + '.failed-'))) {
      return candidate;
    }
  }
}

function validateManifest(manifest, { packageName, packageVersion, binPath } = legacyEngine) {
  const pathOK = name => typeof name === 'string' && name.length > 0 &&
    !isAbsolute(name) && !/[\\\x00-\x1f\x7f]/u.test(name) &&
    name.split('/').every(part => part && part !== '.' && part !== '..');
  if (manifest?.schemaVersion !== 1 || manifest.package?.name !== packageName ||
      manifest.package?.version !== packageVersion || !/^[a-f0-9]{64}$/u.test(manifest.sha256) ||
      !Number.isSafeInteger(manifest.bytes) || manifest.bytes <= 0 || !Array.isArray(manifest.files) ||
      !manifest.sourceHashes || !manifest.generatedHashes) throw failure('engine_bundle_invalid');
  const hashes = { ...manifest.sourceHashes, ...manifest.generatedHashes };
  if (new Set(manifest.files).size !== manifest.files.length ||
      JSON.stringify(Object.keys(hashes).sort()) !== JSON.stringify([...manifest.files].sort()) ||
      Object.keys(manifest.generatedHashes).sort().join(',') !== 'engine-build.json,npm-shrinkwrap.json,package.json' ||
      Object.keys(manifest.sourceHashes).some(name => Object.hasOwn(manifest.generatedHashes, name)) ||
      !manifest.files.includes(binPath) ||
      !manifest.files.every(name => pathOK(name) && /^[a-f0-9]{64}$/u.test(hashes[name]))) {
    throw failure('engine_bundle_invalid');
  }
  return hashes;
}

function validateCandidateManifest(manifest, engineId) {
  const { packageName, packageVersion, binPath } = coreLocalEngine;
  const { archive, files } = manifest ?? {};
  const digest = /^[a-f0-9]{64}$/u;
  if (typeof engineId !== 'string' || !coreLocalEngineIdPattern.test(engineId) ||
      manifest?.schemaVersion !== 1 || manifest.package?.name !== packageName ||
      manifest.package.version !== packageVersion || archive?.filename !== packageName + '-' + packageVersion + '.tgz' ||
      typeof archive.sha256 !== 'string' || !digest.test(archive.sha256) ||
      !Number.isSafeInteger(archive.bytes) || archive.bytes <= 0 ||
      !files || typeof files !== 'object' || Array.isArray(files) ||
      !Object.hasOwn(files, 'package.json') || !Object.hasOwn(files, binPath)) {
    throw failure('engine_bundle_invalid');
  }
  // This digest domain and portable path grammar match the candidate builder.
  const prefix = 'core-local-v1';
  const pairs = Object.keys(files).sort().map(path => [path, files[path]]);
  if (pairs.some(([path, value]) => !/^(?:[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/u.test(path) ||
      typeof value !== 'string' || !digest.test(value)) ||
      manifest.engineId !== prefix + '-' + hash(JSON.stringify([prefix, pairs])) ||
      manifest.engineId !== engineBaseId(engineId)) throw failure('engine_bundle_invalid');
  return files;
}

async function regularFiles(directory, prefix = '') {
  const entries = [];
  for (const name of await readdir(directory)) {
    const relative = prefix + name;
    const info = await lstat(join(directory, name));
    if (info.isDirectory()) entries.push(...await regularFiles(join(directory, name), relative + '/'));
    else if (info.isFile()) entries.push(relative);
    else throw failure('local_engine_verification_failed');
  }
  return entries.sort();
}

export async function verifyInstalledTree(appDirectory, manifest, { candidateEngineId } = {}) {
  try {
    const candidate = candidateEngineId !== undefined;
    const hashes = candidate ? validateCandidateManifest(manifest, candidateEngineId) : validateManifest(manifest);
    const directory = join(appDirectory, 'node_modules', manifest.package.name);
    for (const path of [appDirectory, join(appDirectory, 'node_modules'), directory]) {
      if (!(await lstat(path)).isDirectory()) throw new Error('invalid_directory');
    }
    const files = await regularFiles(directory);
    const expected = (candidate ? Object.keys(hashes) : [...manifest.files]).sort();
    if (JSON.stringify(files) !== JSON.stringify(expected)) throw new Error('inventory');
    for (const name of files) {
      if (hash(await readFile(join(directory, name))) !== hashes[name]) throw new Error('hash');
    }
    for (const [name, version] of candidate ? [] : Object.entries(pins)) {
      let parent = join(appDirectory, 'node_modules');
      for (const part of name.split('/')) {
        parent = join(parent, part);
        if (!(await lstat(parent)).isDirectory()) throw new Error('dependency_directory');
      }
      const dependency = join(appDirectory, 'node_modules', name, 'package.json');
      const info = await lstat(dependency);
      if (!info.isFile()) throw new Error('dependency_file');
      const installed = JSON.parse(await readFile(dependency, 'utf8'));
      if (installed.name !== name || installed.version !== version) throw new Error('dependency_version');
    }
    return true;
  } catch { throw failure('local_engine_verification_failed'); }
}

async function childEnvironment(root, node, env) {
  const result = { PATH: `${dirname(node)}${delimiter}${env.PATH ?? ''}`,
    npm_config_userconfig: join(root, '.npmrc'),
    npm_config_cache: join(root, 'engine', 'npm-cache'),
    npm_config_audit: 'false', npm_config_fund: 'false' };
  async function validateDirectory(value) {
    if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0') ||
        !(await lstat(value)).isDirectory()) throw failure('local_engine_install_failed');
    return value;
  }
  if (env.CAIRN_SETUP_NPM_CACHE !== undefined) {
    result.npm_config_cache = await validateDirectory(env.CAIRN_SETUP_NPM_CACHE);
  }
  for (const key of ['TMPDIR', 'TMP', 'TEMP']) {
    if (env[key] !== undefined) result[key] = await validateDirectory(env[key]);
  }
  if (process.platform === 'win32' && env.SystemRoot) result.SystemRoot = env.SystemRoot;
  return result;
}

// Capture child diagnostics for the coordinator's verbose path only. Never
// interpolate child text into a translated error or send it to the writer.
function run(executable, args, cwd, env, kind, onChild, timeoutMs, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      windowsHide: true });
    let stdout = '', stderr = '', spawnError, timedOut = false, overflow = false;
    let childClosed = false, hookSettled = false, hookFailed = false, settled = false;
    let exitCode, signal;
    const stop = () => child.kill('SIGKILL');
    const finish = () => {
      // Closure is mandatory before quarantine. Once the deadline expires,
      // a pending ownership hook can no longer block completion.
      if (settled || !childClosed || (!timedOut && !hookSettled)) return;
      settled = true;
      clearTimeout(timer);
      const params = { exitCode, stdout, stderr, signal, timedOut, overflow, spawnError };
      if (hookFailed && !timedOut) {
        reject(failure('local_engine_install_failed', { code: 'child_hook_failed' }));
      } else if (timedOut || exitCode !== 0 || spawnError || overflow) {
        reject(failure('local_engine_install_failed', params));
      } else resolve(params);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      if (!childClosed) stop();
      finish();
    }, timeoutMs);
    let ownership;
    try { ownership = Promise.resolve(child.pid === undefined ? undefined : onChild?.({ kind, pid: child.pid })); }
    catch { ownership = Promise.reject(); }
    ownership.then(() => {
      if (settled || timedOut) return;
      hookSettled = true;
      finish();
    }, () => {
      // Consume late rejections without changing an already timed-out run or
      // signalling a PID that may have been reused after child closure.
      if (settled || timedOut) return;
      hookSettled = true; hookFailed = true;
      if (!childClosed) stop();
      finish();
    });
    const collect = key => bytes => {
      if (key === 'stdout') stdout += bytes.toString(); else stderr += bytes.toString();
      if (stdout.length + stderr.length > 4 * 1024 * 1024) { overflow = true; stop(); }
    };
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));
    child.on('error', error => { spawnError = error.code; });
    if (input !== undefined) {
      child.stdin.on('error', error => { spawnError = error.code; });
      child.stdin.end(input);
    }
    child.on('close', (code, terminationSignal) => {
      childClosed = true; exitCode = code; signal = terminationSignal;
      finish();
    });
  });
}

// The staging candidate exposes initialize/ping as its config probe. Block
// SQLite and accidental storage/provider imports along that startup path.
const candidateProbeGuard = 'data:text/javascript,' + encodeURIComponent(String.raw`
  import { registerHooks } from 'node:module';
  const banned = /^(?:node:)?(?:sqlite|fs|net|http|https|http2|tls|dns|dgram|child_process|worker_threads)(?:\/|$)/u;
  registerHooks({ resolve(specifier, context, next) {
    const resolved = next(specifier, context);
    if (banned.test(specifier) || resolved.url.endsWith('/adapter-slot.mjs') || resolved.url.endsWith('.node')) {
      throw new Error('candidate_probe_import_denied');
    }
    return resolved;
  } });
`);

// Callers supply a trusted detached manifest and an already staged app tree.
// The generation id binds the tree's payload, independent of archive compression.
export async function checkCoreLocalConfig({ appDirectory, manifest, engineId, node }) {
  if (typeof appDirectory !== 'string' || !isAbsolute(appDirectory) ||
      typeof node !== 'string' || !isAbsolute(node) || typeof engineId !== 'string') {
    throw failure('local_engine_verification_failed');
  }
  await verifyInstalledTree(appDirectory, manifest, { candidateEngineId: engineId });
  const executable = engineExecutable(appDirectory, coreLocalEngine);
  const protocolVersion = '2025-11-25';
  const requests = [
    { id: 1, method: 'initialize', params: { protocolVersion, capabilities: {},
      clientInfo: { name: 'cairn-memory-setup', version: '1' } } },
    { method: 'notifications/initialized' },
    { id: 2, method: 'ping' },
  ].map(request => JSON.stringify({ jsonrpc: '2.0', ...request }) + '\n').join('');
  const expected = [
    { jsonrpc: '2.0', id: 1, result: { protocolVersion, capabilities: {}, serverInfo: manifest.package } },
    { jsonrpc: '2.0', id: 2, result: {} },
  ];
  let checked;
  try {
    const env = process.platform === 'win32' && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {};
    checked = await run(node, ['--no-experimental-sqlite', '--import', candidateProbeGuard, executable, '--stdio'],
      appDirectory, env, 'check', undefined, 10000, requests);
    const replies = checked.stdout.trim().split('\n').map(line => JSON.parse(line));
    if (checked.stderr === '' && isDeepStrictEqual(replies, expected)) {
      return { ok: true, engineId, databaseOpened: false, providerContacted: false };
    }
  } catch (error) {
    if (error instanceof SetupError) checked = error.params;
  }
  throw failure('local_engine_verification_failed', checked);
}

async function ownedDirectory(directory, { generation = false } = {}) {
  const info = await lstat(directory);
  if (!info.isDirectory()) {
    throw failure('local_engine_install_failed', { code: generation ? 'symlink_generation' : 'insecure_directory' });
  }
  if (process.platform !== 'win32' && ((info.mode & 0o7777) !== 0o700 || info.uid !== process.getuid())) {
    throw failure('local_engine_install_failed', { code: 'insecure_directory' });
  }
}

// The caller holds the setup lock and supplies a canonical, private root. The
// optional identity arguments let the coordinator check the registration vector;
// defaults are safe for the non-opening configuration check in standalone use.
async function install({ root, engineId, node, references, onChild, timeoutMs = 120000,
  env = process.env, write = () => {},
  t = key => key, databasePath = join(root, 'data', 'memory.sqlite'),
  ownerId = 'local-setup-check', projectId = null }) {
  if (!(references instanceof Set) && !Array.isArray(references)) {
    throw failure('local_engine_install_failed');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) {
    throw failure('local_engine_install_failed', { code: 'invalid_timeout' });
  }
  const published = new Set(references);
  let manifest, archive;
  try {
    manifest = JSON.parse(await readFile(new URL('manifest.json', bundle), 'utf8'));
    validateManifest(manifest);
    archive = fileURLToPath(new URL(`${manifest.package.name}-${manifest.package.version}.tgz`, bundle));
    const bytes = await readFile(archive);
    if (hash(bytes) !== manifest.sha256 || bytes.length !== manifest.bytes) throw new Error('bundle');
  } catch { throw failure('engine_bundle_invalid'); }
  if (typeof engineId !== 'string' || !engineIdPattern.test(engineId) ||
      !isAbsolute(root) || !isAbsolute(node)) throw failure('local_engine_install_failed');
  let childEnv;
  try { childEnv = await childEnvironment(root, node, env); }
  catch { throw failure('local_engine_install_failed'); }
  await mkdir(join(root, 'engine'), { recursive: true, mode: 0o700 });
  await ownedDirectory(join(root, 'engine'));
  if (!env.CAIRN_SETUP_NPM_CACHE) {
    try { await ownedDirectory(childEnv.npm_config_cache); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  async function quarantine(directory, error) {
    let timestamp = Date.now();
    let retained;
    // A broken reuse and its failed reinstall must both be retained, including
    // when their failures happen within the same clock millisecond.
    for (;;) {
      retained = directory + `.failed-${timestamp++}`;
      try { await lstat(retained); }
      catch (existingError) { if (existingError.code === 'ENOENT') break; throw existingError; }
    }
    const source = await lstat(directory);
    if (source.isSymbolicLink() || !source.isDirectory()) {
      throw failure('local_engine_install_failed', { code: 'symlink_generation' });
    }
    try { await rename(directory, retained); }
    catch (renameError) {
      throw failure('local_engine_install_failed', { ...error.params, renameCode: renameError.code });
    }
  }
  async function verify(directory, app, executable) {
    if (!(await lstat(directory)).isDirectory()) throw failure('local_engine_verification_failed');
    await verifyInstalledTree(app, manifest);
    const checked = await run(node, [executable, '--check-config', '--db', databasePath,
      '--owner', ownerId, ...(projectId === null ? [] : ['--project', projectId])],
    app, childEnv, 'check', onChild, timeoutMs);
    let report;
    try { report = JSON.parse(checked.stdout); } catch { /* invalid check output */ }
    if (report?.ok !== true || report.databaseOpened !== false || report.providerContacted !== false ||
        report.modelKeyPresent !== false || report.contextRead !== 'context-read-v1' || report.raw !== true || report.rawSearch !== true) throw failure('local_engine_verification_failed', checked);
  }
  for (;;) {
    const directory = join(root, 'engine', engineId);
    const app = join(directory, 'app');
    const executable = engineExecutable(app);
    const result = { executable, engineId, sha256: manifest.sha256 };
    let exists = false;
    try { await lstat(directory); exists = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (exists) {
      await ownedDirectory(directory, { generation: true });
      try { await ownedDirectory(app); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      try { await verify(directory, app, executable); return result; }
      catch (error) {
        if (published.has(engineId)) {
          engineId = await nextRepairId(root, engineBaseId(engineId));
          continue;
        }
        await quarantine(directory, error);
      }
    }
    await mkdir(directory, { mode: 0o700 });
    try {
      await mkdir(app, { mode: 0o700 });
      await writeFile(join(app, 'package.json'),
        JSON.stringify({ name: 'cairn-memory-local-installation', private: true }) + '\n',
        { mode: 0o600, flag: 'wx' });
      if (!env.CAIRN_SETUP_NPM_CACHE) {
        await mkdir(childEnv.npm_config_cache, { recursive: true, mode: 0o700 });
        await ownedDirectory(childEnv.npm_config_cache);
      }
      write(t('local_engine_installing'));
      await run('npm', ['install', '--prefix', app, '--ignore-scripts', '--no-audit', '--no-fund',
        ...(env.CAIRN_SETUP_NPM_OFFLINE === '1' ? ['--offline'] : []), archive],
      app, childEnv, 'npm', onChild, timeoutMs);
      await verify(directory, app, executable);
      return result;
    } catch (error) {
      await quarantine(directory, error);
      if (error instanceof SetupError) throw error;
      throw failure('local_engine_install_failed', { code: error.code });
    }
  }
}

export async function installEngine(options) {
  try { return await install(options); }
  catch (error) {
    if (error instanceof SetupError) throw error;
    throw failure('local_engine_install_failed', { code: error.code });
  }
}
