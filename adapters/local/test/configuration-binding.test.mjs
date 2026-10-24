import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { readConfiguration, readConfigurationSnapshot } from '../configuration.mjs';
import { fixture, ok } from './fixtures/workspace.mjs';
const digest = text => createHash('sha256').update(text, 'utf8').digest('hex');

test('B4a config snapshot commits the exact private-reader UTF-8 text and preserves legacy CLI', async t => {
  const f = fixture(t), text = readFileSync(f.configPath, 'utf8') + '\n'; writeFileSync(f.configPath, text);
  const snapshot = await readConfigurationSnapshot(f.configPath);
  assert.equal(snapshot.digest, digest(text)); assert.equal(snapshot.config.authority.namespace.projectId, null);
  assert.deepEqual(await readConfiguration(['--config', f.configPath]), snapshot.config);
  assert.deepEqual(await readConfiguration(['--config', f.configPath, '--config-digest', snapshot.digest]), snapshot.config);
  assert.equal(Object.isFrozen(snapshot), true);
});

test('B4a config commitment and closed CLI arguments refuse replacement, duplicates and malformed digests', async t => {
  const f = fixture(t), snapshot = await readConfigurationSnapshot(f.configPath);
  writeFileSync(f.configPath, readFileSync(f.configPath, 'utf8') + ' ');
  for (const args of [ ['--config', f.configPath, '--config-digest', snapshot.digest],
    ['--config', f.configPath, '--config-digest', 'A'.repeat(64)], ['--config', f.configPath, '--config-digest', 'a'.repeat(63)],
    ['--config', f.configPath, '--config', f.configPath], ['--config-digest', snapshot.digest, '--config', f.configPath],
    ['--config', f.configPath, '--config-digest', snapshot.digest, '--config-digest', snapshot.digest] ])
    await assert.rejects(readConfiguration(args), { code: 'invalid_local_capture_configuration' });
});

test('B4a actual CLI rejects changed config commitment before Raw, usage or provider effects', async t => {
  const f = fixture(t), before = ok(f.core.getRawUsage({ ownerId: f.namespace.ownerId }));
  const outcome = await f.run(f.request(), { args: ['--config-digest', '0'.repeat(64)] });
  assert.equal(outcome.code, 1); assert.equal(outcome.stdout, ''); assert.equal(outcome.signal, null);
  assert.equal(f.calls().length, 0); assert.equal(f.ledger(), null);
  assert.deepEqual(ok(f.core.getRawUsage({ ownerId: f.namespace.ownerId })), before);
});
