import { readdir, readFile, mkdir, writeFile, mkdtemp, copyFile, rm, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildArtifact, command } from '../../packaging/build.mjs';

// npm caches are not a runtime location. Ship a frozen, self-contained copy;
// the installer copies this inventory again to its private versioned directory.
const clients = (await readdir(new URL('../../integrations/client/', import.meta.url)))
  .filter(name => name.endsWith('.mjs') && name !== 'bundle.mjs');
const codex = (await readdir(new URL('../../integrations/codex/', import.meta.url)))
  .filter(name => name.endsWith('.mjs'));
const paths = [...clients.map(name => `integrations/client/${name}`),
  ...codex.map(name => `integrations/codex/${name}`)].sort();
const files = {};
const check = process.argv.includes('--check');
for (const path of paths) {
  const bytes = await readFile(new URL('../../' + path, import.meta.url));
  files[path] = createHash('sha256').update(bytes).digest('hex');
  const target = new URL('./runtime/' + path, import.meta.url);
  if (check) {
    if (!(await readFile(target)).equals(bytes)) throw new Error('runtime_bundle_stale: ' + path);
  } else {
    await mkdir(new URL('./', target), { recursive: true });
    await writeFile(target, bytes);
  }
}
const manifest = JSON.stringify({ version: 1, files }, null, 2) + '\n';
const target = new URL('./runtime/manifest.json', import.meta.url);
if (check) {
  if (await readFile(target,'utf8') !== manifest) throw new Error('runtime_manifest_stale');
} else await writeFile(target, manifest);
console.log(`Codex runtime bundle ${check ? 'verified' : 'generated'}: ${paths.length} files.`);

// Keep the hosted inventory above unchanged. The engine has its own manifest.
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bundle = fileURLToPath(new URL('./runtime/engine/', import.meta.url));
let buildDirectory, scratch;
try {
  // Own the builder's temporary parent even if it throws before returning its
  // artifact path. Restore the caller's environment before doing other work.
  buildDirectory = await mkdtemp(join(tmpdir(), 'cairn-engine-build-'));
  const tempKeys = ['TMPDIR', 'TMP', 'TEMP'];
  const previousTemp = tempKeys.map(key => process.env[key]);
  let artifact;
  try {
    for (const key of tempKeys) process.env[key] = buildDirectory;
    artifact = buildArtifact();
  } finally {
    tempKeys.forEach((key, index) => {
      if (previousTemp[index] === undefined) delete process.env[key];
      else process.env[key] = previousTemp[index];
    });
  }
  scratch = await mkdtemp(join(tmpdir(), 'cairn-engine-bundle-'));
  async function extract(archive, name) {
    const directory = join(scratch, name);
    await mkdir(directory);
    command('tar', ['-xzf', archive, '-C', directory], scratch, artifact.userconfig);
    return join(directory, 'package');
  }
  async function entryMetadata(directory, prefix = '.') {
    const info = await lstat(directory);
    const entries = { [prefix]: { type: info.mode & 0o170000, mode: info.mode & 0o7777 } };
    if (info.isDirectory()) {
      for (const name of (await readdir(directory)).sort()) {
        Object.assign(entries, await entryMetadata(join(directory, name), `${prefix}/${name}`));
      }
    }
    return entries;
  }
  const rebuilt = await extract(artifact.artifactPath, 'rebuilt');
  const generatedHashes = {};
  for (const name of ['package.json', 'npm-shrinkwrap.json']) {
    generatedHashes[name] = hash(await readFile(join(rebuilt, name)));
  }
  const expected = { schemaVersion: 1, package: { name: artifact.name, version: artifact.version },
    sha256: artifact.sha256, bytes: artifact.bytes, files: artifact.files,
    sourceHashes: artifact.sourceHashes, generatedHashes };
  const archive = join(bundle, `${artifact.name}-${artifact.version}.tgz`);
  if (!check) {
    await mkdir(bundle, { recursive: true });
    await copyFile(artifact.artifactPath, archive);
    await writeFile(join(bundle, 'manifest.json'), JSON.stringify(expected, null, 2) + '\n');
  } else {
    try {
      const committed = JSON.parse(await readFile(join(bundle, 'manifest.json'), 'utf8'));
      const bytes = await readFile(archive);
      // The committed archive must always match its own manifest. Only packing
      // metadata differences between honest builds qualify for the warning.
      if (!isDeepStrictEqual(committed, { ...expected, sha256: hash(bytes), bytes: bytes.length })) {
        throw new Error('manifest_mismatch');
      }
      if (committed.sha256 !== expected.sha256) {
        const previous = await extract(archive, 'committed');
        const inventory = command('tar', ['-tzf', archive], scratch, artifact.userconfig)
          .trim().split(/\r?\n/u).map(name => name.replace(/^package\//u, '')).sort();
        if (!isDeepStrictEqual(inventory, artifact.files)) throw new Error('inventory_mismatch');
        if (!isDeepStrictEqual(await entryMetadata(previous), await entryMetadata(rebuilt))) {
          throw new Error('entry_metadata_mismatch');
        }
        for (const name of artifact.files) {
          if (hash(await readFile(join(previous, name))) !== hash(await readFile(join(rebuilt, name)))) {
            throw new Error('content_mismatch');
          }
        }
        console.warn('engine_bundle_sha_drift');
      }
    } catch (cause) { throw new Error('engine_bundle_stale', { cause }); }
  }
  console.log(`Engine bundle ${check ? 'verified' : 'generated'}: ${artifact.files.length} files.`);
} finally {
  try { if (scratch) await rm(scratch, { recursive: true, force: true }); }
  finally { if (buildDirectory) await rm(buildDirectory, { recursive: true, force: true }); }
}
