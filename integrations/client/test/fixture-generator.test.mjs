import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const generator = new URL('../testing/generate-base-93e52b7-fixture.mjs', import.meta.url);
const fixture = new URL('./fixtures/claude-hosted-93e52b7.json', import.meta.url);

test('fixture maintenance requires explicit writing and has no import side effects', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cairn-fixture-generator-test-'));
  const before = await stat(fixture);
  const options = { cwd: directory, encoding: 'utf8', env: { TMPDIR: directory, PATH: process.env.PATH } };
  try {
    const imported = spawnSync(process.execPath, ['--input-type=module', '-e',
      `const { generateBaseFixture } = await import(${JSON.stringify(generator.href)});
       await (await import('node:assert/strict')).default.rejects(generateBaseFixture(), /fixture_output_required/);`], options);
    assert.equal(imported.status, 0, imported.stderr);
    assert.equal(imported.stdout, '');
    const missingFlag = spawnSync(process.execPath, [fileURLToPath(generator)], options);
    assert.equal(missingFlag.status, 1);
    assert.match(missingFlag.stderr, /Usage:.*--write/);
    assert.deepEqual(await readdir(directory), []);
    assert.equal((await stat(fixture)).mtimeMs, before.mtimeMs);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
