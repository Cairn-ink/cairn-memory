import { constants, lstatSync, realpathSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { ownData } from '../../core/local-authority-input.mjs';
import { identifier, MemoryStoreError } from '../../core/validation.mjs';

const invalid = () => { throw new Error('invalid_retained_raw_profile'); };
export function assertRetainedRuntime() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (process.platform !== 'linux' || !(major > 22 || major === 22 && minor >= 16)) {
    throw new Error('retained_raw_runtime_unavailable');
  }
}
export function retainedProfilePath(value) {
  return typeof value === 'string' && value.isWellFormed() && !value.includes('\0') &&
    isAbsolute(value) && resolve(value) === value;
}
function entry(path, directory) {
  const info = lstatSync(path);
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile()) ||
      typeof process.getuid !== 'function' || info.uid !== process.getuid() ||
      (info.mode & 0o777) !== (directory ? 0o700 : 0o600)) invalid();
  return info;
}
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
function location(input) {
  if (!retainedProfilePath(input)) invalid();
  const path = join(realpathSync(dirname(input)), basename(input));
  const parent = entry(dirname(path), true), file = entry(path, false);
  return { path, file, check() {
    if (join(realpathSync(dirname(input)), basename(input)) !== path ||
        !same(parent, entry(dirname(path), true)) || !same(file, entry(path, false))) invalid();
  } };
}
function configuration(value) {
  const input = ownData(value, ['version', 'path', 'storeId', 'namespace']);
  const namespace = ownData(input.namespace, ['ownerId', 'scope', 'projectId']);
  if (Object.keys(input).length !== 4 || Object.keys(namespace).length !== 3 ||
      input.version !== 'local-raw-retained-profile-v1' || !retainedProfilePath(input.path)) invalid();
  identifier(input.storeId); identifier(namespace.ownerId);
  if (namespace.scope === 'project') identifier(namespace.projectId);
  else if (namespace.scope !== 'personal' || namespace.projectId !== null) invalid();
  return { ...input, namespace: Object.freeze(namespace) };
}

/** No SQLite, SDK, provider, directory creation or policy callback is loaded here. */
export async function readRetainedRawProfile(profilePath) {
  assertRetainedRuntime();
  let profile, database, config;
  try {
    profile = location(profilePath);
    const file = await open(profile.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await file.stat();
      if (!same(profile.file, before) || !before.isFile() || before.uid !== process.getuid() ||
          (before.mode & 0o777) !== 0o600 || before.size > 65536) invalid();
      const bytes = Buffer.alloc(65537); let count = 0;
      while (count < bytes.length) {
        const read = await file.read(bytes, count, bytes.length - count, null);
        if (!read.bytesRead) break;
        count += read.bytesRead;
      }
      if (count > 65536) invalid();
      config = configuration(JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, count))));
      const after = await file.stat();
      if (!same(before, after) || after.size !== count || after.uid !== process.getuid() ||
          (after.mode & 0o777) !== 0o600) invalid();
    } finally { await file.close(); }
    profile.check(); database = location(config.path);
  } catch { invalid(); }
  return Object.freeze({ ...config, path: database.path, profilePath: profile.path,
    check() {
      try { profile.check(); database.check(); }
      catch { throw new Error('retained_raw_profile_changed'); }
    } });
}

export function retainedRawOptions() {
  return { mode: 'off', configureCap: false,
    readPolicy: () => ({ generation: 'retained-read-no-capture', reason: 'raw_disabled' }),
    port: Object.freeze({ version: 'raw-seal-v1',
      sealRaw() { throw new MemoryStoreError('raw_crypto_unavailable'); },
      openRaw({ format, keyVersion, sealed }) {
        if (format !== 'local-plain-v1' || keyVersion !== null) throw new MemoryStoreError('raw_crypto_unavailable');
        try { return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(sealed) }; }
        catch { throw new MemoryStoreError('raw_crypto_unavailable'); }
      },
    }),
  };
}
