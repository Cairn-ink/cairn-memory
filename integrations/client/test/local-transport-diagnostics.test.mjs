import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod } from 'node:fs/promises';
import { createLocalCaptureTransport } from '../raw/local-transport.mjs';
import { LocalCaptureTransportError } from '../raw/local-process.mjs';
import { transportFixture } from './fixtures/local-transport-workspace.mjs';

test('transport diagnostics contain only fixed stages and child outcomes', async t => {
  const f = transportFixture(t);
  for (const [mode, stage, exitCode] of [['nonzero', 'child_exit', 7], ['no-newline', 'reply', undefined]]) {
    f.set(mode);
    await assert.rejects(createLocalCaptureTransport(f.options).capture(f.request), error => {
      assert.equal(error.stage, stage); assert.equal(error.uncertain, true);
      if (exitCode !== undefined) { assert.equal(error.exitCode, exitCode); assert.equal(error.signal, null); }
      assert.doesNotMatch(JSON.stringify(error), /synthetic|stderr|\/|sentinel/);
      return true;
    });
  }
  const unsupported = f.executable({ version: 'v20.0.0\n' });
  await assert.rejects(createLocalCaptureTransport({ ...f.options, nodeExecutable: unsupported }).capture(f.request),
    error => error.stage === 'probe' && error.uncertain === false);
  const disappears = f.executable({ removeSelf: true });
  await assert.rejects(createLocalCaptureTransport({ ...f.options, nodeExecutable: disappears }).capture(f.request),
    error => error.stage === 'spawn' && error.uncertain === false);
  await chmod(f.configPath, 0o644);
  await assert.rejects(createLocalCaptureTransport(f.options).capture(f.request),
    error => error.stage === 'config_snapshot' && error.uncertain === false);
  await chmod(f.configPath, 0o600);
  assert.equal(new LocalCaptureTransportError(false, 'synthetic-secret').stage, 'input');
  assert.equal(new LocalCaptureTransportError(true, 'child_exit', { exitCode: 1, signal: 'synthetic-secret' }).signal, null);
});
