import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

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
  const artifact = realpathSync(archive);
  if (hash(readFileSync(artifact)) !== expectedHash) fail('unpinned_cairn_artifact');
  return artifact;
}

function validateRelative(relative) {
  if (typeof relative !== 'string' || !/^[a-zA-Z0-9_./-]+$/u.test(relative)
    || path.isAbsolute(relative) || relative.split('/').some(part => part === '..' || part === '.')) fail('invalid_cairn_artifact');
}

function sourceBytes(packageRoot, relative, code = 'cairn_install_source_mismatch') {
  const filename = path.join(packageRoot, relative);
  try {
    if (realpathSync(filename) !== filename || !lstatSync(filename).isFile()) fail(code);
    return readFileSync(filename);
  } catch { fail(code); }
}

// Full archive inspection belongs in preflight, before any server/model timer.
export function inspectArtifact(executable, archive, expectedHash) {
  const artifact = pinnedArtifact(archive, expectedHash);
  const packageRoot = path.dirname(path.dirname(realpathSync(executable)));
  const directory = mkdtempSync(path.join(realpathSync(tmpdir()), 'cairn-artifact-inspect-'));
  try {
    chmodSync(directory, 0o700);
    try { execFileSync('tar', ['-xzf', artifact, '-C', directory], { stdio: 'ignore' }); }
    catch { fail('invalid_cairn_artifact'); }
    const extractedRoot = path.join(directory, 'package');
    let manifest;
    try { manifest = JSON.parse(sourceBytes(extractedRoot, 'package.json', 'invalid_cairn_artifact')); }
    catch { fail('invalid_cairn_artifact'); }
    if (manifest?.name !== 'cairn-memory-local-preview' || !Array.isArray(manifest.files)
      || !manifest.files.includes('core/contract.mjs') || !manifest.files.includes('adapters/openai/index.mjs')) fail('invalid_cairn_artifact');
    const sourceHashes = {};
    for (const relative of new Set([...manifest.files, 'package.json'])) {
      validateRelative(relative);
      const installed = hash(sourceBytes(packageRoot, relative));
      if (installed !== hash(sourceBytes(extractedRoot, relative))) fail('cairn_install_source_mismatch');
      sourceHashes[relative] = installed;
    }
    return { packageRoot, artifactSha256: expectedHash, sourceHashes };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

// Preserve the first-send TOCTOU check without extracting the archive again.
export function verifyInspectedArtifact(executable, archive, provenance) {
  pinnedArtifact(archive, provenance.artifactSha256);
  const packageRoot = path.dirname(path.dirname(realpathSync(executable)));
  if (packageRoot !== provenance.packageRoot) fail('cairn_install_source_mismatch');
  for (const [relative, expected] of Object.entries(provenance.sourceHashes)) {
    validateRelative(relative);
    if (hash(sourceBytes(packageRoot, relative)) !== expected) fail('cairn_install_source_mismatch');
  }
  return provenance;
}
