import assert from 'node:assert/strict';
import test from 'node:test';
import { activeDaemonStopped } from '../lib/local-cutover-command.mjs';

test('the macOS platform reply means no daemon is left to stop', () => {
  assert.equal(activeDaemonStopped({ code: 0, stdout: 'daemon_platform\n' }), true);
});

test('a Linux stop reply is stopped only when nothing is still running', () => {
  assert.equal(activeDaemonStopped({ code: 0, stdout: '{"still_running":0}\n' }), true);
  assert.equal(activeDaemonStopped({ code: 0, stdout: '{"still_running":1}\n' }), false);
});

test('a failed or unreadable stop reply is never treated as stopped', () => {
  assert.equal(activeDaemonStopped({ code: 1, stdout: 'daemon_platform\n' }), false);
  assert.equal(activeDaemonStopped({ code: 1, stdout: '{"still_running":0}\n' }), false);
  assert.equal(activeDaemonStopped({ code: 0, stdout: '' }), false);
  assert.equal(activeDaemonStopped({ code: 0, stdout: 'daemon_platform' }), false);
});
