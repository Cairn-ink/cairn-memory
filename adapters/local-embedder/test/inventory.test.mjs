import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './fixtures/pack.mjs';
const project = fileURLToPath(new URL('../../../', import.meta.url));
async function walk(path, relative = '') {
  const files = [];
  for (const entry of await readdir(join(path, relative), { withFileTypes: true })) {
    const name = relative ? relative + '/' + entry.name : entry.name;
    if (entry.isDirectory()) files.push(...await walk(path, name)); else if (entry.isFile()) files.push(name);
  }
  return files.sort();
}
test('L05 package closure, native files and licence inventory independently enumerate and match', async t => {
  const f = await fixture(t), paths = await walk(f.root), recursive = (await readdir(f.root, { recursive: true, withFileTypes: true })).filter(e => e.isFile()).map(e => join(e.parentPath, e.name).slice(f.root.length + 1)).sort();
  assert.deepEqual(paths, recursive);
  const packages = paths.filter(p => /^runtime\/(?:node_modules\/(?:@[^/]+\/)?[^/]+\/)+package\.json$/.test(p)).map(p => p.slice(0, -13)).sort();
  assert.deepEqual(packages, f.manifest.runtime.packages.map(p => p.root));
  const native = paths.filter(p => p.endsWith('.node')).sort(); assert.deepEqual(native, f.manifest.files.filter(p => p.role === 'native').map(p => p.path));
  const licenses = paths.filter(p => p.startsWith('licenses/') || p.startsWith('provenance/')).sort();
  assert.deepEqual(licenses, f.manifest.files.filter(p => ['license', 'provenance'].includes(p.role)).map(p => p.path));
  t.diagnostic(`Cross-checked ${paths.length} files, ${packages.length} packages, ${native.length} native files, ${licenses.length} evidence/notices/source-offer files; differences 0`);
});
test('L13 runtime directory, artifact manifest and relative import graph agree; new entry is SQLite-free', async t => {
  const listed = JSON.parse(await readFile(join(project, 'packaging/artifact-files.json'), 'utf8'));
  const runtime = (await readdir(join(project, 'adapters/local-embedder'))).filter(p => p.endsWith('.mjs')).map(p => 'adapters/local-embedder/' + p).sort();
  assert.deepEqual(listed.filter(p => p.startsWith('adapters/local-embedder/') && p.endsWith('.mjs')).sort(), runtime);
  const visited = new Set();
  async function visit(path) {
    if (visited.has(path)) return; visited.add(path);
    const source = await readFile(join(project, path), 'utf8'); assert.equal(source.includes("from 'node:sqlite'"), false, path);
    const literals = [...source.matchAll(/(?:from\s*|import\s*\()(['"])(\.\.?\/[^'"]+)\1/g)].map(m => m[2]);
    for (const literal of literals) {
      const relative = resolve(project, dirname(path), literal).slice(project.length);
      assert.ok(listed.includes(relative), relative);
      if (relative.startsWith('adapters/local-embedder/')) await visit(relative);
    }
  }
  // Child runners are launched through URL paths, so independently include
  // them as entrypoints instead of pretending they are static imports.
  for (const entry of ['index.mjs', 'install.mjs', 'supervisor.mjs', 'child.mjs']) await visit('adapters/local-embedder/' + entry);
  assert.deepEqual([...visited].sort(), runtime);
  t.diagnostic(`Cross-checked ${runtime.length} runtime modules by filesystem, artifact entries and runner/import closure; differences 0`);
});
