import assert from 'node:assert/strict';
import test from 'node:test';
import { assertRecordedEngine, installerFixture, realDaemonEngine, uninstall } from './daemon-installer-fixture.mjs';

for (const [operation, code, stdout] of [
  ['status', 0, '{ "daemons": [{ "store": "b12345678901", "running": true, "build": "b98765432101", "attached_sessions": 2, "stamp_age_seconds": 0.01, "last_codes": ["daemon_ready"] }] }\n'],
  ['stop', 7, '{ "stopped": 1, "still_running": 2 }\n'],
]) test(`daemon ${operation} --local forwards the pinned engine's JSON bytes and exit code`, async t => {
  const f = await installerFixture(t);
  await f.setEngine(`process.stdout.write(${JSON.stringify(stdout)}); process.exitCode = ${code};`);
  assert.deepEqual(f.run(['daemon', operation, '--local']), { code, stdout, stderr: '' });
  const calls = await f.calls();
  assert.equal(calls.length, 1);
  assertRecordedEngine(calls[0], f, operation);
});

for (const operation of ['status', 'stop']) test(`daemon ${operation} --local forwards non-Linux daemon_platform`, async t => {
  const f = await installerFixture(t);
  await f.setEngine(realDaemonEngine({ platform: 'darwin' }));
  assert.deepEqual(f.run(['daemon', operation, '--local']), { code: 0, stdout: 'daemon_platform\n', stderr: '' });
  const calls = await f.calls();
  assert.equal(calls.length, 1);
  assertRecordedEngine(calls[0], f, operation);
});

test('daemon status --local uses the existing not-installed error without a descriptor or after uninstall', async t => {
  const absent = await installerFixture(t, { clients: [] });
  const removed = await installerFixture(t, { behavior: 'missing-node' });
  assert.equal(removed.run(uninstall).code, 0);
  for (const f of [absent, removed]) {
    const error = f.run(['config', '--lang', 'en']);
    assert.equal(error.code, 2);
    assert.match(error.stdout, /Automatic memory is not installed/u);
    assert.deepEqual(f.run(['daemon', 'status', '--local', '--lang', 'en']), error);
  }
});

test('daemon commands require --local and refuse store overrides and client selection', async t => {
  const f = await installerFixture(t);
  await f.setEngine('process.exitCode = 5;');
  for (const args of [['stop'], ['restart', '--local'], ['stop', '--local', '--db', f.database],
    ['stop', '--local', '--client', 'claude'], ['stop', '--local', '--yes']]) {
    assert.equal(f.run(['daemon', ...args]).code, 2);
  }
  assert.deepEqual(await f.calls(), []);
});

test('installer help includes the local daemon commands in both languages', async t => {
  const f = await installerFixture(t, { clients: [] });
  for (const lang of ['en', 'zh']) {
    const result = f.run(['--help', '--lang', lang]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /daemon status\|stop --local/u);
  }
});
