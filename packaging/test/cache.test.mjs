import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { command } from '../build.mjs';

test('cache preparation command boundary excludes ambient credentials and npm config', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-cache-env-test-'));
  const userconfig = join(directory, 'empty.npmrc');
  writeFileSync(userconfig, '');
  // Probe in a child so no real process credential values need reading/restoring.
  const script = `import { command } from ${JSON.stringify(new URL('../build.mjs', import.meta.url).href)};
    process.env.OPENAI_API_KEY = 'synthetic-canary';
    process.env.NPM_TOKEN = 'synthetic-canary';
    process.env.npm_config_cache = '/synthetic-do-not-use';
    process.env.npm_config_registry = 'https://synthetic.invalid';
    process.env.npm_config_userconfig = '/synthetic-do-not-read';
    const result = command(process.execPath, ['-e', 'console.log(JSON.stringify({key:!!process.env.OPENAI_API_KEY,token:!!process.env.NPM_TOKEN,cache:!!process.env.npm_config_cache,registry:!!process.env.npm_config_registry,config:process.env.npm_config_userconfig}))'], ${JSON.stringify(directory)}, ${JSON.stringify(userconfig)});
    process.stdout.write(result);`;
  const result = JSON.parse(command(process.execPath, ['--input-type=module', '-e', script], directory, userconfig));
  assert.deepEqual(result, { key: false, token: false, cache: false, registry: false, config: userconfig });
});
