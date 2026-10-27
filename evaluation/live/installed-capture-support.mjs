import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(code); };

export function privateDirectory(directory) {
  const resolved = path.resolve(directory);
  const stat = lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(resolved) !== resolved
    || (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o700)
    || readdirSync(resolved).length) fail('unsafe_private_directory');
  return resolved;
}

export function privateWrite(filename, data) {
  writeFileSync(filename, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
}

function pinnedArtifact(archive, expectedHash) {
  if (!/^[a-f0-9]{64}$/u.test(expectedHash)) fail('invalid_cairn_artifact');
  const bytes = readFileSync(realpathSync(archive));
  if (hash(bytes) !== expectedHash) fail('unpinned_cairn_artifact');
  return bytes;
}

function validateRelative(relative) {
  if (typeof relative !== 'string' || !/^[a-zA-Z0-9_./-]+$/u.test(relative)
    || path.isAbsolute(relative) || relative.split('/').some(part => part === '..' || part === '.')) fail('invalid_cairn_artifact');
}

function sourceBytes(packageRoot, relative) {
  const filename = path.join(packageRoot, relative);
  if (realpathSync(filename) !== filename || !lstatSync(filename).isFile()) fail('cairn_install_source_mismatch');
  return readFileSync(filename);
}

function headerString(header, offset, length) {
  const bytes = header.subarray(offset, offset + length);
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end === -1 ? bytes.length : end).toString('utf8');
}

function headerOctal(header, offset, length) {
  const text = headerString(header, offset, length).trim();
  if (!/^[0-7]+$/u.test(text)) fail('invalid_cairn_artifact');
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value)) fail('invalid_cairn_artifact');
  return value;
}

function archiveMembers(bytes) {
  // npm pack uses pacote's portable headers and fixed integer mtime. The
  // artifact's ASCII paths/sizes fit ustar; no PAX extensions are needed.
  // Corrupt gzip keeps native zlib errors; exact parity with legacy tar subprocess errors is impossible.
  const tar = gunzipSync(bytes);
  if (tar.length % 512 !== 0) fail('invalid_cairn_artifact');
  const files = new Map(), seen = new Set();
  for (let offset = 0; offset < tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      if (tar.length - offset < 1024 || !tar.subarray(offset).every(byte => byte === 0)) fail('invalid_cairn_artifact');
      return files;
    }
    let checksum = 8 * 0x20;
    for (let index = 0; index < 512; index++) {
      if (index < 148 || index >= 156) checksum += header[index];
    }
    if (checksum !== headerOctal(header, 148, 8)) fail('invalid_cairn_artifact');
    const size = headerOctal(header, 124, 12);
    const start = offset + 512, paddedSize = Math.ceil(size / 512) * 512;
    if (size > tar.length - start || paddedSize > tar.length - start) fail('invalid_cairn_artifact');
    const type = header[156];
    if (![0, 0x30, 0x35].includes(type) || (type === 0x35 && size !== 0)) fail('invalid_cairn_artifact');
    const name = headerString(header, 0, 100);
    const magic = header.toString('ascii', 257, 263);
    const prefix = ['ustar\0', 'ustar '].includes(magic) ? headerString(header, 345, 155) : '';
    const member = prefix ? `${prefix}/${name}` : name;
    validateRelative(member);
    if (!member.startsWith('package/')) fail('invalid_cairn_artifact');
    const canonical = path.posix.normalize(member).replace(/\/$/u, '');
    if (seen.has(canonical)) fail('invalid_cairn_artifact');
    seen.add(canonical);
    if (type !== 0x35) {
      const relative = member.slice('package/'.length);
      if (!relative || member.endsWith('/')) fail('invalid_cairn_artifact');
      files.set(relative, tar.subarray(start, start + size));
    }
    offset = start + paddedSize;
  }
  fail('invalid_cairn_artifact');
}

// Full archive inspection belongs in preflight, before any server/model timer.
export function inspectArtifact(executable, archive, expectedHash) {
  const bytes = pinnedArtifact(archive, expectedHash);
  const packageRoot = path.dirname(path.dirname(realpathSync(executable)));
  const members = archiveMembers(bytes);
  if (!members.has('package.json')) fail('invalid_cairn_artifact');
  const manifest = JSON.parse(members.get('package.json'));
  if (manifest.name !== 'cairn-memory-local-preview' || !Array.isArray(manifest.files)
    || !manifest.files.includes('core/contract.mjs') || !manifest.files.includes('adapters/openai/index.mjs')) fail('invalid_cairn_artifact');
  const sourceHashes = new Map();
  for (const relative of new Set([...manifest.files, 'package.json'])) {
    validateRelative(relative);
    if (!members.has(relative)) fail('invalid_cairn_artifact');
    const installed = hash(sourceBytes(packageRoot, relative));
    if (installed !== hash(members.get(relative))) fail('cairn_install_source_mismatch');
    sourceHashes.set(relative, installed);
  }
  return { packageRoot, artifactSha256: expectedHash, sourceHashes: Object.fromEntries(sourceHashes) };
}

// Preserve the first-send TOCTOU check without extracting the archive again.
export function verifyInspectedArtifact(executable, archive, provenance) {
  pinnedArtifact(archive, provenance.artifactSha256);
  let packageRoot;
  try { packageRoot = path.dirname(path.dirname(realpathSync(executable))); }
  catch { fail('cairn_install_source_mismatch'); }
  if (packageRoot !== provenance.packageRoot) fail('cairn_install_source_mismatch');
  for (const [relative, expected] of Object.entries(provenance.sourceHashes)) {
    validateRelative(relative);
    try {
      if (hash(sourceBytes(packageRoot, relative)) !== expected) fail('cairn_install_source_mismatch');
    } catch { fail('cairn_install_source_mismatch'); }
  }
  return provenance;
}
