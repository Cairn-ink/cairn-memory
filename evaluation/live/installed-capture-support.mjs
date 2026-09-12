import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
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

export function inspectArtifact(executable, archive, expectedHash) {
  if (!/^[a-f0-9]{64}$/u.test(expectedHash)) fail('invalid_cairn_artifact');
  const artifact = realpathSync(archive);
  if (hash(readFileSync(artifact)) !== expectedHash) fail('unpinned_cairn_artifact');
  const packageRoot = path.dirname(path.dirname(realpathSync(executable)));
  const entry = relative => execFileSync('tar', ['-xOzf', artifact, `package/${relative}`],
    { maxBuffer: 2_000_000, stdio: ['ignore', 'pipe', 'ignore'] });
  const manifestBytes = entry('package.json');
  const manifest = JSON.parse(manifestBytes);
  if (manifest.name !== 'cairn-memory-local-preview' || !Array.isArray(manifest.files)
    || !manifest.files.includes('core/contract.mjs') || !manifest.files.includes('adapters/openai/index.mjs')) fail('invalid_cairn_artifact');
  const sourceHashes = {};
  for (const relative of new Set([...manifest.files, 'package.json'])) {
    if (typeof relative !== 'string' || !/^[a-zA-Z0-9_./-]+$/u.test(relative)
      || path.isAbsolute(relative) || relative.split('/').some(part => part === '..' || part === '.')) fail('invalid_cairn_artifact');
    const filename = path.join(packageRoot, relative);
    if (realpathSync(filename) !== filename || !lstatSync(filename).isFile()) fail('cairn_install_source_mismatch');
    const installed = hash(readFileSync(filename));
    if (installed !== hash(entry(relative))) fail('cairn_install_source_mismatch');
    sourceHashes[relative] = installed;
  }
  return { packageRoot, artifactSha256: expectedHash, sourceHashes };
}
