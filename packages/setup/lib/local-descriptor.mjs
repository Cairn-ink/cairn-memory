import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { SetupError } from './errors.mjs';

export const engineIdPattern = /^\d+\.\d+\.\d+(?:-[\w.]+)?-[0-9a-f]{12}(?:-r(?:[2-9]|[1-9]\d+))?$/u;
const clients = ['claude', 'codex'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, names) => object(value) && Object.keys(value).sort().join(',') === [...names].sort().join(',');
export const validIdentifier = value => typeof value === 'string' && value.length > 0 &&
  value.length <= 200 && value.trim() === value && !/^-/u.test(value) && !/[\x00-\x1f\x7f]/u.test(value);
export const validPath = value => typeof value === 'string' && isAbsolute(value) &&
  !/[\x00-\x1f\x7f]/u.test(value) && !value.split(/[\\/]/u).includes('..');
export const inside = (root, path) => path === root || (!relative(root, path).startsWith('..' + sep) &&
  relative(root, path) !== '..' && !isAbsolute(relative(root, path)));
const recovery = root => new SetupError('local_recovery_required', 2, { path: join(root, 'installation.json') });
export const localFilesystemError = (error, key = 'local_recovery_required') => error instanceof SetupError ? error :
  new SetupError(key, 2, { code: typeof error.code === 'string' ? error.code : 'filesystem_error' });
export const pidIsDead = pid => {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; }
};
export async function ownedDirectory(path, { missing = false, key = 'local_root_invalid' } = {}) {
  try {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o7777) !== 0o700 ||
        (process.getuid && stat.uid !== process.getuid())) throw new SetupError(key, 2, { code: 'insecure_directory' });
    return true;
  } catch (error) { if (missing && error.code === 'ENOENT') return false; throw localFilesystemError(error, key); }
}
export async function ownedLocalTree(root) {
  if (!await ownedDirectory(root, { missing: true })) return;
  await ownedDirectory(join(root, 'data'), { missing: true });
  if (!await ownedDirectory(join(root, 'engine'), { missing: true })) return;
  try {
    for (const entry of await readdir(join(root, 'engine'), { withFileTypes: true })) {
      if (entry.name === 'npm-cache' || entry.isDirectory() || entry.isSymbolicLink()) {
        const path = join(root, 'engine', entry.name);
        await ownedDirectory(path);
        if (entry.name !== 'npm-cache') await ownedDirectory(join(path, 'app'), { missing: true });
      }
    }
  } catch (error) { throw localFilesystemError(error, 'local_root_invalid'); }
}

// A small strict JSON reader: JSON.parse alone silently accepts duplicate keys.
// No source text or parse excerpts escape this function.
export function parseStrictJSON(text) {
  let at = 0;
  const whitespace = () => { while (/[\x20\t\r\n]/u.test(text[at] ?? '') && at < text.length) at++; };
  function string() {
    const start = at++;
    while (at < text.length) {
      const char = text[at++];
      if (char === '\\') at++;
      else if (char === '"') return JSON.parse(text.slice(start, at));
    }
    throw new Error('json');
  }
  function value(depth = 0) {
    if (depth > 100) throw new Error('json');
    whitespace();
    if (text[at] === '"') return string();
    if (text[at] === '{') {
      at++; whitespace(); const result = Object.create(null), seen = new Set();
      if (text[at] === '}') { at++; return result; }
      for (;;) {
        whitespace(); if (text[at] !== '"') throw new Error('json');
        const key = string(); if (seen.has(key)) throw new Error('duplicate'); seen.add(key);
        whitespace(); if (text[at++] !== ':') throw new Error('json');
        result[key] = value(depth + 1); whitespace();
        const end = text[at++]; if (end === '}') return result;
        if (end !== ',') throw new Error('json');
      }
    }
    if (text[at] === '[') {
      at++; whitespace(); const result = [];
      if (text[at] === ']') { at++; return result; }
      for (;;) {
        result.push(value(depth + 1)); whitespace();
        const end = text[at++]; if (end === ']') return result;
        if (end !== ',') throw new Error('json');
      }
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(text.slice(at));
    if (!match) throw new Error('json');
    at += match[0].length; return JSON.parse(match[0]);
  }
  const result = value(); whitespace(); if (at !== text.length) throw new Error('json'); return result;
}

export async function boundedJSON(path, limit, { privateFile = false, strict = true } = {}) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > limit ||
      (privateFile && ((before.mode & 0o777) !== 0o600 || before.nlink !== 1 ||
        (process.getuid && before.uid !== process.getuid())))) throw new Error('unsafe_file');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (info.ino !== before.ino || info.dev !== before.dev || info.size > limit) throw new Error('changed');
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break; length += bytesRead;
    }
    if (length > limit) throw new Error('limit');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
    return strict ? parseStrictJSON(text) : JSON.parse(text);
  } finally { await file.close(); }
}

export async function canonicalPath(path) {
  if (!validPath(path)) throw new SetupError('local_root_invalid', 2);
  try { const canonical = await realpath(path); if (!validPath(canonical)) throw new SetupError('local_root_invalid', 2); return canonical; }
  catch (error) {
    if (error.code !== 'ENOENT') throw localFilesystemError(error, 'local_root_invalid');
    const parent = dirname(path);
    if (parent === path) throw localFilesystemError(error, 'local_root_invalid');
    return join(await canonicalPath(parent), path.slice(parent.length));
  }
}
export function requestedRoot(env = process.env) {
  const path = env.CAIRN_MEMORY_HOME ?? join(env.HOME || homedir(), '.cairn-memory');
  if (!validPath(path)) throw new SetupError('local_root_invalid', 2);
  return resolve(path);
}
export async function localRoot(env = process.env, { create = false } = {}) {
  const path = requestedRoot(env);
  try {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid()) ||
        (stat.mode & 0o7777) !== 0o700) throw new Error('unsafe_root');
  } catch (error) {
    if (error.code !== 'ENOENT') throw localFilesystemError(error, 'local_root_invalid');
    if (create) {
      try { await mkdir(path, { recursive: true, mode: 0o700 }); }
      catch (failure) { throw localFilesystemError(failure, 'local_root_invalid'); }
      await ownedDirectory(path);
    }
  }
  return canonicalPath(path);
}
export function executableFor(root, engineId) {
  if (!engineIdPattern.test(engineId)) throw recovery(root);
  return join(root, 'engine', engineId, 'app/node_modules/cairn-memory-local-preview/bin/cairn-memory.mjs');
}
export const vectorArguments = (root, vector) => [executableFor(root, vector.engineId), '--db',
  vector.databasePath, '--owner', vector.ownerId, ...(vector.projectId === null ? [] : ['--project', vector.projectId])];
export const sameVector = (a, b) => Boolean(a) && Boolean(b) &&
  ['engineId', 'node', 'databasePath', 'ownerId', 'projectId'].every(key => a[key] === b[key]);
const validVector = value => keys(value, ['engineId', 'node', 'databasePath', 'ownerId', 'projectId']) &&
  engineIdPattern.test(value.engineId) && validPath(value.node) && validPath(value.databasePath) &&
  validIdentifier(value.ownerId) && (value.projectId === null || validIdentifier(value.projectId));
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export function validateDescriptor(value, root) {
  const fail = () => { throw recovery(root); };
  if (!keys(value, ['version', 'state', 'installerVersion', 'ownerId', 'projectId', 'database', 'engine',
    'node', 'operation', 'clients', 'createdAt', 'updatedAt']) || value.version !== 'cairn-local-installation-v1' ||
      !['pending', 'installed', 'uninstalling', 'uninstalled'].includes(value.state) ||
      !/^\d+\.\d+\.\d+(?:-[\w.]+)?$/u.test(value.installerVersion) || !validIdentifier(value.ownerId) ||
      !(value.projectId === null || validIdentifier(value.projectId)) || !iso(value.createdAt) || !iso(value.updatedAt) ||
      !keys(value.database, ['path', 'external']) || !validPath(value.database.path) ||
      typeof value.database.external !== 'boolean' || !keys(value.clients, clients)) fail();
  if (value.database.external ? inside(root, value.database.path) :
    value.database.path !== join(root, 'data/memory.sqlite')) fail();
  const databaseSafe = path => ![join(root, 'engine'), ...['.setup.lock', 'installation.json', '.npmrc'].map(name => join(root, name))]
    .some(target => inside(target, path));
  if (!databaseSafe(value.database.path)) fail();
  const consistent = vector => vector.ownerId === value.ownerId && vector.projectId === value.projectId && vector.databasePath === value.database.path;
  if (value.engine !== null && (!keys(value.engine, ['id', 'package', 'packageVersion', 'sha256']) ||
      !engineIdPattern.test(value.engine.id) || value.engine.package !== 'cairn-memory-local-preview' ||
      value.engine.packageVersion !== '0.0.0-preview.1' || !/^[a-f0-9]{64}$/u.test(value.engine.sha256))) fail();
  if (value.node !== null && !validPath(value.node)) fail();
  for (const client of clients) {
    const receipt = value.clients[client];
    if (receipt === null) continue;
    if (!keys(receipt, client === 'claude' ? ['server', 'scope', 'home', 'vector'] : ['server', 'configPath', 'vector']) ||
        receipt.server !== 'cairn-local' || (client === 'claude' && receipt.scope !== 'user') ||
        !validPath(client === 'claude' ? receipt.home : receipt.configPath) || !validVector(receipt.vector) || !consistent(receipt.vector) ||
        !databaseSafe(receipt.vector.databasePath)) fail();
  }
  const op = value.operation;
  if (op !== null) {
    if (!keys(op, ['kind', 'clients', 'startedAt', 'checkpoints']) || !['setup', 'uninstall'].includes(op.kind) ||
        !iso(op.startedAt) || !Array.isArray(op.clients) || !op.clients.length ||
        op.clients.some((client, index) => !clients.includes(client) || op.clients.indexOf(client) !== index) ||
        !keys(op.checkpoints, op.clients) || op.clients.join(',') !== clients.filter(client => op.clients.includes(client)).join(',')) fail();
    for (const checkpoint of Object.values(op.checkpoints)) {
      if (!keys(checkpoint, ['state', 'destination', 'previous', 'desired']) || !validPath(checkpoint.destination) ||
          !(op.kind === 'setup' ? ['planned', 'registering', 'done', 'manual'] : ['planned', 'detaching', 'detached']).includes(checkpoint.state) ||
          ![checkpoint.previous, checkpoint.desired].every(vector => vector === null || (validVector(vector) && consistent(vector) && databaseSafe(vector.databasePath))) ||
          (op.kind === 'setup' && checkpoint.desired === null)) fail();
    }
  }
  if (value.state === 'pending' && (!value.node || op?.kind !== 'setup')) fail();
  if (value.state === 'installed' && (!value.engine || !value.node || op !== null || !Object.values(value.clients).some(Boolean))) fail();
  if (value.state === 'uninstalling' && op?.kind !== 'uninstall') fail();
  if (value.state === 'uninstalled' && (value.engine !== null || value.node !== null || op !== null || Object.values(value.clients).some(Boolean))) fail();
  return value;
}
export async function readDescriptor(root) {
  try {
    const value = await boundedJSON(join(root, 'installation.json'), 65536, { privateFile: true });
    validateDescriptor(value, root);
    for (const vector of [value.database.path, ...Object.values(value.clients).filter(Boolean).map(receipt => receipt.vector.databasePath),
      ...Object.values(value.operation?.checkpoints ?? {}).flatMap(cp => [cp.previous, cp.desired].filter(Boolean).map(v => v.databasePath))]) {
      const path = await canonicalPath(vector);
      if (vector === value.database.path && value.database.external && inside(root, path)) throw recovery(root);
      if ([join(root, 'engine'), ...['.setup.lock', 'installation.json', '.npmrc'].map(name => join(root, name))].some(target => inside(target, path))) throw recovery(root);
    }
    return value;
  } catch (error) { if (error.code === 'ENOENT') return null; throw localFilesystemError(error); }
}
export function publishedReferences(descriptor) {
  const result = new Set();
  for (const receipt of Object.values(descriptor?.clients ?? {})) if (receipt) result.add(receipt.vector.engineId);
  for (const cp of Object.values(descriptor?.operation?.checkpoints ?? {})) if (['registering', 'done'].includes(cp.state)) {
    for (const vector of [cp.previous, cp.desired]) if (vector) result.add(vector.engineId);
  }
  return result;
}
export async function deletionPath(root, name, { purge = false, databasePath, references = new Set(), renameOnly = false } = {}) {
  try {
  await ownedDirectory(root);
  const allowed = ['.setup.lock', 'engine', ...(purge ? ['installation.json', '.npmrc'] : [])];
  if (!allowed.includes(name) && !(renameOnly && name.startsWith('engine/') &&
      engineIdPattern.test(name.slice(7)) && !references.has(name.slice(7)))) throw recovery(root);
  const path = join(root, name);
  if (databasePath && inside(path, await canonicalPath(databasePath))) throw recovery(root);
  if (name.startsWith('engine/')) await ownedDirectory(join(root, 'engine'), { key: 'local_recovery_required' });
  try { const stat = await lstat(path); if (stat.isSymbolicLink()) throw recovery(root);
    if (stat.isDirectory()) await ownedDirectory(path, { key: 'local_recovery_required' });
    if (name.startsWith('engine/')) await ownedDirectory(join(path, 'app'), { missing: true, key: 'local_recovery_required' });
    if (name === 'engine') await ownedLocalTree(root);
  }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return path;
  } catch (error) { throw localFilesystemError(error); }
}
const locks = new Map();
export async function withLocalLock(root, work) {
  await ownedLocalTree(root);
  const path = join(root, '.setup.lock'); let file;
  try { file = await open(path, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw localFilesystemError(error, 'local_root_invalid');
    let stale = false;
    try { const value = await boundedJSON(path, 1024, { privateFile: true });
      stale = pidIsDead(value.pid) && (!Object.hasOwn(value, 'child') || value.child === null || pidIsDead(value.child));
    } catch { /* An unreadable lock cannot be proven stale. */ }
    throw new SetupError(stale ? 'local_lock_stale' : 'lock_retry', 2, { path });
  }
  try {
    const value = { pid: process.pid, startedAt: new Date().toISOString(), child: null };
    const updateChild = async child => {
      value.child = child;
      const bytes = Buffer.from(JSON.stringify(value) + '\n');
      try { await file.truncate(0); await file.write(bytes, 0, bytes.length, 0); await file.sync(); }
      catch (error) { throw localFilesystemError(error, 'local_root_invalid'); }
    };
    await updateChild(null); locks.set(root, file); return await work(updateChild);
  } catch (error) { throw localFilesystemError(error, 'local_root_invalid');
  } finally {
    locks.delete(root);
    try { await file.close(); await rm(await deletionPath(root, '.setup.lock')); }
    catch (error) { throw localFilesystemError(error, 'local_root_invalid'); }
  }
}
export async function writeDescriptor(root, descriptor) {
  try {
  if (!locks.has(root)) throw recovery(root);
  descriptor.updatedAt = new Date().toISOString(); validateDescriptor(descriptor, root);
  const temporary = join(root, `.installation-${process.pid}-${randomBytes(8).toString('hex')}.tmp`);
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(descriptor, null, 2) + '\n'); await file.sync(); }
  finally { await file.close(); }
  await rename(temporary, join(root, 'installation.json'));
  const directory = await open(root, 'r'); try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) { throw localFilesystemError(error); }
}
export function newDescriptor(root, installerVersion, { owner, db, project } = {}) {
  const now = new Date().toISOString();
  return { version: 'cairn-local-installation-v1', state: 'pending', installerVersion,
    ownerId: owner ?? 'local-' + randomBytes(8).toString('hex'), projectId: project ?? null,
    database: { path: db ?? join(root, 'data/memory.sqlite'), external: Boolean(db && db !== join(root, 'data/memory.sqlite')) },
    engine: null, node: process.execPath, operation: null, clients: { claude: null, codex: null }, createdAt: now, updatedAt: now };
}
export function beginOperation(descriptor, kind, selected, destinations, desired = null) {
  descriptor.state = kind === 'setup' ? 'pending' : 'uninstalling';
  descriptor.operation = { kind, clients: [...selected], startedAt: new Date().toISOString(),
    checkpoints: Object.fromEntries(selected.map(client => [client, { state: 'planned', destination: destinations[client],
      previous: descriptor.clients[client]?.vector ?? null, desired: kind === 'setup' ? { ...desired } : null }])) };
  return descriptor;
}
export function recordClient(descriptor, client, vector) {
  const cp = descriptor.operation.checkpoints[client];
  cp.state = vector ? 'done' : 'detached';
  descriptor.clients[client] = vector ? { server: 'cairn-local', ...(client === 'claude' ?
    { scope: 'user', home: cp.destination } : { configPath: cp.destination }), vector: { ...vector } } : null;
}
