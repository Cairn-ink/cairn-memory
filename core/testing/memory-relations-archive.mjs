import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Frozen source packages are independent of checkout history and contain no stores.
export function memoryRelationsArchive(workspace, kind = 'pre-feature') {
  assert.ok(['pre-feature', 'four-label'].includes(kind));
  const name = `memory-relations-${kind}`;
  const fixture = new URL(`../test/fixtures/${name}.tgz`, import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL(`../test/fixtures/${name}.json`, import.meta.url), 'utf8'));
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(digest(readFileSync(fixture)), manifest.archiveSha256);
  const directory = join(workspace, name);
  mkdirSync(directory, { mode: 0o700 });
  const unpack = spawnSync('tar', ['-xzf', fileURLToPath(fixture), '-C', directory], { encoding: 'utf8', timeout: 30000 });
  assert.equal(unpack.error, undefined);
  assert.equal(unpack.status, 0, unpack.stderr);
  const files = [];
  function walk(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const next = join(path, entry.name);
      if (entry.isDirectory()) walk(next);
      else files.push(relative(directory, next));
    }
  }
  walk(directory);
  assert.deepEqual(files.sort(), Object.keys(manifest.sourceHashes).sort(), 'archive filesystem versus frozen source list');
  for (const file of files) assert.equal(digest(readFileSync(join(directory, file))), manifest.sourceHashes[file], file);
  return directory;
}
