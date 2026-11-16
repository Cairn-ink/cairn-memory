import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

for (const path of [
  '../local-authority-schema.mjs',
  '../content-safety-schema.mjs',
  '../database.mjs',
  '../runtime.mjs',
  '../index.mjs',
  '../../adapters/mcp/raw-command.mjs',
]) {
  test(`fresh process imports ${path} first`, () => {
    const target = new URL(path, import.meta.url).href;
    const child = spawnSync(process.execPath, [
      '--input-type=module', '-e', `await import(${JSON.stringify(target)})`,
    ], { encoding: 'utf8', timeout: 30000 });
    assert.equal(child.error, undefined, child.error?.message);
    assert.equal(child.signal, null, child.stderr);
    assert.equal(child.status, 0, child.stderr);
  });
}
