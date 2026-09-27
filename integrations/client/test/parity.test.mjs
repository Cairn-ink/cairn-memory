import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CLIENT_MODULES } from '../bundle.mjs';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { observeHosted, observeMechanisms } from './observe-legacy.mjs';

const client = fileURLToPath(new URL('../', import.meta.url));
const plugin = fileURLToPath(new URL('../../../plugins/cairn-memory/', import.meta.url));
const golden = JSON.parse(await readFile(new URL('./fixtures/claude-hosted-93e52b7.json', import.meta.url), 'utf8'));

test('frozen base 93e52b7 source hashes match every shared module', async () => {
  assert.equal(golden.base, '93e52b7afb298d728cb4831c34bbda6dcf750704');
  for (const [source, original] of Object.entries(CLIENT_MODULES)) {
    const bytes = await readFile(join(client, source));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),
      golden.sourceHashes[`plugins/cairn-memory/lib/${original}`], source);
  }
});

test('shared mechanisms preserve base 93e52b7 Claude outputs and state bytes', async () => {
  assert.deepEqual(await observeMechanisms(client, { shared: true }), golden.mechanisms);
});

test('generated original-path modules preserve base 93e52b7 Claude outputs and state bytes', async () => {
  assert.deepEqual(await observeMechanisms(join(plugin, 'lib')), golden.mechanisms);
});

test('isolated plugin preserves hosted payload bytes, message/event IDs and frozen retries', async () => {
  const isolated = await mkdtemp(join(tmpdir(), 'cairn-installed-plugin-test-'));
  try {
    // Only distributed plugin runtime files exist here, with no repository parent.
    await cp(join(plugin, 'lib'), join(isolated, 'lib'), { recursive: true });
    await cp(join(plugin, 'scripts'), join(isolated, 'scripts'), { recursive: true });
    assert.deepEqual(await observeHosted(isolated), golden.hosted);
  } finally { await rm(isolated, { recursive: true, force: true }); }
});
