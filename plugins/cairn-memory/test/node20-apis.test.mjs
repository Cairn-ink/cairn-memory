import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../../', import.meta.url));
async function sources(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['test', 'testing', 'node_modules'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await sources(path));
    else if (/\.[cm]?js$/.test(entry.name)) paths.push(path);
  }
  return paths;
}

test('production integrations and plugin hooks retain Node 20 API compatibility', async () => {
  const files = (await Promise.all(['integrations', 'plugins/cairn-memory/lib',
    'plugins/cairn-memory/scripts'].map(path => sources(join(root, path))))).flat();
  assert.ok(files.length > 0);
  for (const path of files) {
    assert.doesNotMatch(await readFile(path, 'utf8'), /\bPromise\s*\.\s*withResolvers\s*\(/u,
      path.slice(root.length));
  }
});
