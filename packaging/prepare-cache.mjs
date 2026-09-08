import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { command } from './build.mjs';

// Explicit public-registry network preparation, separate from offline tests.
// npm ci caches locked tarballs but not all metadata needed by npm install.
export function prepareCache(directory, userconfig) {
  for (const spec of ['@modelcontextprotocol/server@2.0.0', '@modelcontextprotocol/core@2.0.0',
    'zod@4.5.4', 'tiktoken@1.0.22']) {
    command('npm', ['view', spec, 'version', '--json', '--registry=https://registry.npmjs.org/'], directory, userconfig);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 2) throw new Error('unexpected_arguments');
    const directory = mkdtempSync(join(tmpdir(), 'cairn-cache-prepare-'));
    const userconfig = join(directory, 'empty.npmrc');
    writeFileSync(userconfig, '', { mode: 0o600 });
    prepareCache(directory, userconfig);
    console.log('Public package metadata cache prepared; no model requests.');
  } catch { console.error('cairn_cache_preparation_failed'); process.exitCode = 1; }
}
