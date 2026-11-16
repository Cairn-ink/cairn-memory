// Private coordination files only. No function here accepts a store filename.
import { constants } from 'node:fs';
import { lstat, mkdir, realpath, statfs, open, link, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

export const refuse = code => Object.assign(Error(code), { code });
const localTypes = new Set([0xef53, 0x58465342, 0x9123683e, 0x794c7630, 0x01021994, 0x858458f6]);
export function assertLocalFilesystem(path, type) {
  if (path === '/mnt' || path.startsWith('/mnt/')) throw refuse('daemon_filesystem');
  if (!localTypes.has(Number(type))) throw refuse('daemon_filesystem');
}
export async function runtimeDirectory({ root, uid = process.getuid?.() } = {}) {
  if (!Number.isSafeInteger(uid) || process.platform !== 'linux') throw refuse('daemon_platform');
  let parent = root;
  if (parent === undefined) {
    parent = `/run/user/${uid}`;
    try { await lstat(parent); }
    catch (error) { if (error.code !== 'ENOENT') throw refuse('daemon_directory'); parent = `/tmp/cairn-${uid}`; }
  }
  if (typeof parent !== 'string' || !parent.startsWith('/') || resolve(parent) !== parent) throw refuse('daemon_directory');
  async function create(path) {
    try { await mkdir(path, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw refuse('daemon_directory'); }
  }
  async function validate(path, pin) {
    const info = await lstat(path, { bigint: true });
    if (info.isSymbolicLink() || !info.isDirectory()) throw refuse('daemon_directory_type');
    if (info.uid !== BigInt(uid)) throw refuse('daemon_directory_owner');
    if ((Number(info.mode) & 0o7777) !== 0o700) throw refuse('daemon_directory_mode');
    if (await realpath(path) !== path) throw refuse('daemon_filesystem');
    assertLocalFilesystem(path, (await statfs(path)).type);
    if (pin && (info.dev !== pin.dev || info.ino !== pin.ino)) throw refuse('daemon_directory_changed');
    return { dev: info.dev, ino: info.ino };
  }
  await create(parent);
  const parentPin = await validate(parent), path = join(parent, 'cairn-memory');
  await create(path);
  const pin = await validate(path);
  return Object.freeze({ path, uid, validate: async () => {
    await validate(parent, parentPin);
    return validate(path, pin);
  } });
}
export function endpointPaths(directory, digest) {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw refuse('daemon_identity');
  const base = `d-${digest.slice(0, 32)}`;
  const socket = join(directory.path, base + '.sock');
  if (Buffer.byteLength(socket) > 100) throw refuse('daemon_socket_length');
  return Object.freeze({ socket, ready: join(directory.path, base + '.json'),
    lock: join(directory.path, base + '.lock'), takeover: join(directory.path, base + '.takeover.lock'),
    stamp: join(directory.path, base + '.stamp'), log: join(directory.path, base + '.log') });
}
export async function checkedEntry(directory, path, { socket = false, missing = false } = {}) {
  await directory.validate();
  if (!path.startsWith(directory.path + '/') || path.slice(directory.path.length + 1).includes('/')) throw refuse('daemon_entry');
  let info;
  try { info = await lstat(path, { bigint: true }); } catch (error) { if (missing && error.code === 'ENOENT') return; throw error; }
  if (info.isSymbolicLink() || !(socket ? info.isSocket() : info.isFile())) throw refuse('daemon_entry_type');
  if (info.uid !== BigInt(directory.uid)) throw refuse('daemon_entry_owner');
  if ((Number(info.mode) & 0o7777) !== 0o600) throw refuse('daemon_entry_mode');
  return info;
}
// Typed runtime references exclude stores, journals and arbitrary uid-owned files.
const fileClasses = {
  descriptor: /^d-[a-f0-9]{32}\.json$/,
  stamp: /^d-[a-f0-9]{32}\.stamp$/,
  log: /^d-[a-f0-9]{32}\.log$/,
  key: /^identity-v1\.key$/,
  lock: /^(?:d-[a-f0-9]{32}(?:\.takeover)?|p-[a-f0-9]{32})\.lock(?:\.(?:owner|reap)-[a-z0-9-]+)*$/,
};
export const privateTransient = error => error?.privateOutcome === 'replacement' || error?.code === 'ENOENT';
export async function retryMetadata(operation, deadline) {
  for (;;) {
    try { return await operation(); }
    catch (error) {
      if (!privateTransient(error) || performance.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.min(25, Math.max(1, deadline - performance.now()))));
    }
  }
}
export async function readPrivate(directory, path, { fileClass, missing = false, openMissing = missing, maxBytes = 65536, deadline } = {}) {
  const name = typeof path === 'string' && path.startsWith(directory.path + '/') ? path.slice(directory.path.length + 1) : '';
  if (!Object.hasOwn(fileClasses, fileClass) || !fileClasses[fileClass].test(name)) throw refuse('daemon_entry');
  const snapshot = async () => {
    const before = await checkedEntry(directory, path, { missing });
    if (!before) return;
    let file;
    try { file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (error) { if (openMissing && error.code === 'ENOENT') return; throw error; }
    try {
      const after = await file.stat({ bigint: true });
      if (!after.isFile()) throw refuse('daemon_entry_type');
      if (after.uid !== BigInt(directory.uid)) throw refuse('daemon_entry_owner');
      if ((Number(after.mode) & 0o7777) !== 0o600) throw refuse('daemon_entry_mode');
      if (after.size > maxBytes) throw refuse('daemon_entry_changed');
      if (after.nlink === 0n) throw Object.assign(refuse('daemon_entry_changed'), { privateOutcome: 'replacement' });
      const maxLinks = fileClass === 'lock' || fileClass === 'key' ? 2n : 1n;
      if (after.nlink < 1n || after.nlink > maxLinks) throw refuse('daemon_entry_links');
      if (after.dev !== before.dev || after.ino !== before.ino)
        throw Object.assign(refuse('daemon_entry_changed'), { privateOutcome: 'replacement' });
      await directory.validate();
      // One extra byte detects growth without ever doing an unbounded read.
      const bytes = Buffer.alloc(maxBytes + 1); let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > maxBytes) throw refuse('daemon_entry_changed');
      return bytes.subarray(0, length).toString('utf8');
    } finally { await file.close(); }
  };
  return deadline === undefined ? snapshot() : retryMetadata(snapshot, deadline);
}
export async function writePrivate(directory, path, bytes, { exclusive = false } = {}) {
  await checkedEntry(directory, path, { missing: true });
  const temporary = path + '.tmp-' + randomBytes(12).toString('hex');
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await file.writeFile(bytes); await file.sync(); await file.close();
    await directory.validate();
    await checkedEntry(directory, path, { missing: true });
    if (exclusive) { try { await link(temporary, path); } catch (error) { if (error.code !== 'EEXIST') throw error; } }
    else await rename(temporary, path);
  } finally { await file.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
}
export async function removePrivate(directory, path, options = {}) {
  const before = await checkedEntry(directory, path, { ...options, missing: true });
  if (!before) return;
  const after = await checkedEntry(directory, path, options);
  if (before.dev !== after.dev || before.ino !== after.ino) throw refuse('daemon_entry_changed');
  await unlink(path);
}
export async function identityKey(directory, { deadline = performance.now() + 1000 } = {}) {
  const path = join(directory.path, 'identity-v1.key');
  await writePrivate(directory, path, randomBytes(32).toString('hex'), { exclusive: true });
  const key = await readPrivate(directory, path, { fileClass: 'key', deadline });
  if (!/^[a-f0-9]{64}$/.test(key)) throw refuse('daemon_identity_key');
  return Buffer.from(key, 'hex');
}
const logCodes = new Set(['daemon_ready', 'daemon_draining', 'daemon_exit', 'daemon_failed', 'daemon_refused', 'daemon_grace_expired']);
export async function logCode(directory, path, code, { deadline = performance.now() + 1000 } = {}) {
  if (!logCodes.has(code)) throw refuse('daemon_log_code');
  // Serialize at the host. A full log is truncated, never rotated onto unchecked paths.
  const old = await readPrivate(directory, path, { fileClass: 'log', missing: true, maxBytes: 262144, deadline });
  await writePrivate(directory, path, ((old?.length ?? 0) + code.length + 1 > 262144 ? '' : old ?? '') + code + '\n');
}
