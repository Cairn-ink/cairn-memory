import { createHash, createHmac } from 'node:crypto';
import { lstat, stat, realpath, readFile } from 'node:fs/promises';
import { statSync, realpathSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refuse } from './local-daemon-state.mjs';

export const DAEMON_PROTOCOL = 1;
// Runtime location intentionally has no environment input. These are the ONLY
// inherited values. Include provider/product reads even when the managed vector
// cannot activate them. Node injection is refused before spawning a candidate.
export const IDENTITY_ENV = Object.freeze(['OPENAI_API_KEY', 'CAIRN_CONTEXT_SEMANTIC_OPENAI_API_KEY',
  'HOME', 'CAIRN_MEMORY_HOME', 'PATH', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'WINDIR',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS',
  'NODE_USE_SYSTEM_CA', 'NODE_USE_ENV_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH']);
export function selectedEnvironment(source = process.env) {
  const selected = {};
  for (const name of IDENTITY_ENV) if (Object.hasOwn(source, name)) {
    if (typeof source[name] !== 'string' || source[name].includes('\0')) throw refuse('daemon_environment');
    selected[name] = source[name];
  }
  if (selected.NODE_OPTIONS || selected.NODE_PATH) throw refuse('daemon_node_injection');
  if (['LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH'].some(name => selected[name])) throw refuse('daemon_node_injection');
  const key = selected.OPENAI_API_KEY;
  if (key && (!key.trim() || /[\r\n]/.test(key))) throw refuse('daemon_configuration');
  return selected;
}
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
export function daemonVector(args) {
  if (!Array.isArray(args)) return { eligible: false };
  const values = new Map(), switches = new Set(['--no-raw', '--no-raw-search', '--no-context-read']);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (values.has(flag)) return { eligible: false };
    if (switches.has(flag)) { values.set(flag, true); continue; }
    if (!['--db', '--owner', '--project'].includes(flag) || typeof args[i + 1] !== 'string' || args[i + 1].startsWith('--')) return { eligible: false };
    values.set(flag, args[++i]);
  }
  const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && value.isWellFormed() && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value);
  const path = values.get('--db');
  if (!validId(values.get('--owner')) || values.has('--project') && !validId(values.get('--project')) ||
      typeof path !== 'string' || !path.trim() || path.includes('\0') || !path.isWellFormed() || path === ':memory:') return { eligible: false };
  if (!values.has('--no-context-read') && (!path.startsWith('/') || resolve(path) !== path)) return { eligible: false };
  return { eligible: true, configuration: {
    path, namespace: { ownerId: values.get('--owner'), scope: values.has('--project') ? 'project' : 'personal', projectId: values.get('--project') ?? null },
    raw: !values.has('--no-raw'), rawSearch: !values.has('--no-raw-search'), contextRead: values.has('--no-context-read') ? false : 'context-read-v1',
  } };
}
export async function physicalStore(path, cwd = process.cwd()) {
  const absolute = resolve(cwd, path), canonicalPath = await realpath(absolute);
  const info = await stat(canonicalPath, { bigint: true });
  if (!info.isFile() || info.nlink !== 1n) throw refuse('daemon_store_alias');
  // Parent canonicalization permits safe symlinks; pin the resulting physical file.
  const again = await stat(await realpath(absolute), { bigint: true });
  if (again.dev !== info.dev || again.ino !== info.ino) throw refuse('daemon_store_changed');
  return { path: canonicalPath, dev: String(info.dev), ino: String(info.ino) };
}
export async function creationIdentity(path, cwd = process.cwd()) {
  let absolute = resolve(cwd, path);
  try { absolute = await realpath(absolute); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try { if ((await lstat(absolute)).isSymbolicLink()) throw refuse('daemon_store_alias'); }
    catch (missing) { if (missing.code !== 'ENOENT') throw missing; }
  }
  const parent = await realpath(dirname(absolute)), info = await stat(parent, { bigint: true });
  return { path: join(parent, basename(absolute)), parent: { path: parent, dev: String(info.dev), ino: String(info.ino) } };
}
export function creationDigest(record) {
  return createHash('sha256').update(canonical({ uid: process.getuid(), creation: record })).digest('hex');
}
export async function assertStoreLocation(path, directory) {
  const creation = await creationIdentity(path);
  if (creation.path === directory.path || creation.path.startsWith(directory.path + '/')) throw refuse('daemon_store_location');
}
export async function assertStore(record) {
  const current = await physicalStore(record.store.path);
  if (canonical(current) !== canonical(record.store)) throw refuse('daemon_store_changed');
}
export function assertStoreSync(record) {
  const path = realpathSync(record.store.path), info = statSync(path, { bigint: true });
  if (path !== record.store.path || String(info.dev) !== record.store.dev || String(info.ino) !== record.store.ino || info.nlink !== 1n) throw refuse('daemon_store_changed');
}
const runtimeFiles = ['local-daemon-identity.mjs', 'local-daemon-state.mjs', 'local-daemon-wire.mjs',
  'local-daemon-liveness.mjs', 'local-daemon.mjs', 'local-forwarder.mjs'];
export async function engineBuild(root = fileURLToPath(new URL('../../', import.meta.url))) {
  const inventory = JSON.parse(await readFile(join(root, 'packaging/artifact-files.json'), 'utf8'));
  const files = [...new Set([...inventory, 'package.json', 'adapters/mcp/package-lock.json',
    'adapters/openai/package-lock.json', ...runtimeFiles.map(name => 'adapters/mcp/' + name)])].sort();
  const hash = createHash('sha256');
  for (const name of files) {
    if (name.startsWith('/') || name.split('/').includes('..')) throw refuse('daemon_build');
    const path = join(root, name), info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw refuse('daemon_build');
    hash.update(name + '\0').update(await readFile(path)).update('\0');
  }
  return hash.digest('hex');
}
export async function createIdentity(args, { key, environment = selectedEnvironment(), cwd,
  uid = process.getuid?.(), build, node = { executable: process.execPath, version: process.version, execArgv: process.execArgv }, protocol = DAEMON_PROTOCOL } = {}) {
  const vector = daemonVector(args);
  if (!vector.eligible) return vector;
  if (!Buffer.isBuffer(key) || key.length !== 32) throw refuse('daemon_identity_key');
  if (!Array.isArray(node.execArgv) || node.execArgv.some(arg => !['--no-warnings', '--experimental-sqlite'].includes(arg))) throw refuse('daemon_node_injection');
  const selected = selectedEnvironment(environment);
  const store = await physicalStore(vector.configuration.path, cwd);
  const configuration = { ...vector.configuration, path: store.path,
    // Explicit effective defaults of the managed vector; advanced flags are ineligible.
    contextSemantic: Boolean(selected.OPENAI_API_KEY), contextReadPersonal: false,
    provider: selected.OPENAI_API_KEY ? { provider: 'openai', model: 'text-embedding-3-small', dimensions: 1536,
      maxRequests: Number.MAX_SAFE_INTEGER, maxUsd: 1, maxConcurrent: 1 } : null,
    client: 'cairn-local-mcp', sessionId: 'explicit-tool', readClient: null,
    captureQualification: null, captureRationale: null, captureEvidence: null, captureEvidenceAccess: null,
    captureDeadlineMs: null, sourceSnapshot: null, recallContext: null, classificationRecovery: null,
    privateCards: null, privateCardCurrentDependencies: null, methodPackages: null, methodReadPersonal: false,
    assets: null, roleProfiles: null, sessionEpisodes: null, sessionEpisodesAccess: null, contextReadSources: null,
  };
  const record = { version: 1, protocol, uid, store, configuration, build: build ?? await engineBuild(),
    node: { ...node, executable: await realpath(node.executable) },
    environment: createHmac('sha256', key).update(canonical(selected)).digest('hex') };
  return { eligible: true, record, digest: createHash('sha256').update(canonical(record)).digest('hex') };
}
