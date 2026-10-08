import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

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
