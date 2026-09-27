import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { observeHosted, observeMechanisms } from './observe-legacy.mjs';

const client = fileURLToPath(new URL('../', import.meta.url));
const plugin = fileURLToPath(new URL('../../../plugins/cairn-memory/', import.meta.url));
const golden = JSON.parse(await readFile(new URL('./fixtures/claude-hosted-0.1.0.json', import.meta.url), 'utf8'));

test('shared mechanisms preserve released Claude outputs and state bytes', async () => {
  assert.deepEqual(await observeMechanisms(client, { shared: true }), golden.mechanisms);
});

test('compatibility exports preserve released Claude outputs and state bytes', async () => {
  assert.deepEqual(await observeMechanisms(join(plugin, 'lib')), golden.mechanisms);
});

test('isolated plugin preserves hosted payload bytes, message/event IDs and frozen retries', async () => {
  const isolated = await mkdtemp(join(tmpdir(), 'cx1-installed-plugin-'));
  try {
    // Only distributed plugin runtime files exist here, with no repository parent.
    await cp(join(plugin, 'lib'), join(isolated, 'lib'), { recursive: true });
    await cp(join(plugin, 'scripts'), join(isolated, 'scripts'), { recursive: true });
    assert.deepEqual(await observeHosted(isolated), golden.hosted);
  } finally { await rm(isolated, { recursive: true, force: true }); }
});
