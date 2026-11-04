import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Each scenario owns a child process, so env mutation and builtin interception
// cannot affect concurrent node:test files. No CLI or adapter is loaded.
const child = new URL('./fixtures/context-semantic-key-process.mjs', import.meta.url);
for (const [scenario, title] of [
  ['present', 'dedicated value reaches only the semantic Worker, unchanged'],
  ['absent', 'absent dedicated value has no generic fallback and preserves host error (control)'],
  ['empty', 'empty dedicated value preserves empty env and host error (control)'],
  ['rotation', 'rotation is read at each coordinator Worker start'],
  ['scan', 'provider-error turn and close leave no markers in engine-owned outputs'],
  ['ordinary', 'ordinary product Workers retain exactly empty env (control)'],
]) test('semantic key channel: ' + title, () => {
  const result = spawnSync(process.execPath, [child.pathname, scenario], {
    encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
