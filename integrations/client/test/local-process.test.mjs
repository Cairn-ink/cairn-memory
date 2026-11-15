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

test('a capture child exiting zero without reading large stdin still fails', async t => {
  const spawn = cp.spawn;
  let outcome, finished = false;
  t.mock.method(cp, 'spawn', function (executable, args, options) {
    assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe']);
    const child = spawn.call(this, executable, args, options);
    child.stdin.once('finish', () => { finished = true; });
    child.once('close', (code, signal) => { outcome = { code, signal }; });
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const scope = localProcessScope(5000);
  try {
    await assert.rejects(scope.run(process.execPath, ['-e', 'process.exit(0)'],
      { PATH: '/usr/bin:/bin' }, Buffer.alloc(8 * 1024 * 1024)),
    { code: 'local_capture_transport_failed', stage: 'child_exit', uncertain: true, exitCode: 0, signal: null });
    assert.deepEqual(outcome, { code: 0, signal: null });
    assert.equal(finished, false);
  } finally { scope.close(); }
});
