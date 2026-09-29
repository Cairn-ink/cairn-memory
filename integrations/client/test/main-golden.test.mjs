import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { BASE, observeStandalone } from '../testing/main-golden.mjs';
import { observeHosted } from './observe-legacy.mjs';
const plugin = fileURLToPath(new URL('../../../plugins/cairn-memory/', import.meta.url));
const golden = JSON.parse(await readFile(new URL('./fixtures/claude-hosted-3a1c17d9.json', import.meta.url)));
test('frozen golden pins main 0.1.1 and its complete runtime source inventory', () => {
  assert.equal(golden.base, BASE);
  for (const file of ['lib/identity.mjs', 'lib/version.mjs', 'scripts/hook.mjs', 'scripts/launch-capture.mjs']) {
    assert.match(golden.hashes[`plugins/cairn-memory/${file}`], /^[a-f0-9]{64}$/);
  }
  assert.equal(golden.standalone.length, 28);
});
test('isolated 0.1.2 plugin matches 0.1.1 bytes with only VERSION token changes', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cx2-main-parity-' });
  for (const name of ['lib', 'scripts']) await cp(join(plugin, name), join(workspace.path, name), { recursive: true });
  const actual = await observeStandalone(workspace.path);
  const expected = structuredClone(golden.standalone);
  let substitutions = 0;
  for (const variant of expected) {
    variant.requestBytes = variant.requestBytes.replaceAll('\\"version\\":\\"0.1.1\\"', () => {
      substitutions++; return '\\"version\\":\\"0.1.2\\"';
    });
  }
  assert.ok(substitutions > 0, 'fixture must exercise telemetry VERSION');
  assert.deepEqual(actual, expected);
  assert.deepEqual(await observeHosted(workspace.path), golden.hosted);
});
