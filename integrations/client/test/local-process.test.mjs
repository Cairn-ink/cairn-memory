import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { localProcessScope } from '../raw/local-process.mjs';

test('an immediate successful version probe ignores stdin and needs no finish event', async t => {
  const spawn = cp.spawn;
  let probes = 0;
  t.mock.method(cp, 'spawn', function (executable, args, options) {
    assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
    const child = spawn.call(this, executable, args, options);
    assert.equal(child.stdin, null);
    probes++;
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const scope = localProcessScope(5000);
  try {
    assert.equal((await scope.run(process.execPath, ['-e', "process.stdout.write('v22.16.0\\n')"],
      { PATH: '/usr/bin:/bin' }, undefined, { probe: true })).toString(), 'v22.16.0\n');
    assert.equal(scope.uncertain, false);
    assert.equal(probes, 1);
  } finally { scope.close(); }
});

// Guard against applying probe stdin handling (ignore, no input or finish) to capture.
test('capture rejects unread large stdin instead of inheriting probe stdin handling', async t => {
  const spawn = cp.spawn;
  let finished = false;
  t.mock.method(cp, 'spawn', function (executable, args, options) {
    assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe']);
    const child = spawn.call(this, executable, args, options);
    child.stdin.once('finish', () => { finished = true; });
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const scope = localProcessScope(5000);
  try {
    await assert.rejects(scope.run(process.execPath, ['-e', 'process.exit(0)'],
      { PATH: '/usr/bin:/bin' }, Buffer.alloc(8 * 1024 * 1024)),
    { code: 'local_capture_transport_failed', stage: 'child_exit', uncertain: true });
    assert.equal(finished, false);
  } finally { scope.close(); }
});
