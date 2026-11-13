import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { hostFixture } from './fixtures/local-host-workspace.mjs';
import { createLocalCaptureTransport } from '../raw/local-transport.mjs';

test('macOS real capture transport reports synthetic child diagnostics on failure', {
  skip: process.platform !== 'darwin' && 'Requires native macOS child execution and filesystem semantics.',
}, async t => {
  // Same authority, private store, home and config as the failing host suite.
  const f = await hostFixture(t, { client: 'claude-code' });
  f.config.interpretation = 'raw-only'; f.save();
  const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
  const spawn = cp.spawn, stderr = { probe: [], capture: [] };
  let children = 0;
  t.mock.method(cp, 'spawn', function (executable, args, options) {
    const child = spawn.call(this, executable, args, options);
    const kind = args[0] === `${root}/adapters/local/cli.mjs` ? 'capture' : args[0] === '--version' ? 'probe' : null;
    if (kind === 'capture') children++;
    if (kind) child.stderr.on('data', chunk => stderr[kind].push(chunk));
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const transport = createLocalCaptureTransport({ nodeExecutable: process.execPath, runtimeRoot: root,
    configPath: f.configPath, expectedAuthority: f.config.authority, home: f.profile.home, env: {} });
  try {
    const reply = await transport.capture(f.request());
    assert.equal(reply.status, 200);
    assert.equal(children, 1, 'exactly one real capture child, with no retry');
  } catch (error) {
    t.diagnostic(JSON.stringify({ stage: error.stage, exitCode: error.exitCode ?? null, signal: error.signal ?? null }));
    // This opt-in test owns every input. Production errors never retain stderr.
    for (const kind of ['probe', 'capture'])
      t.diagnostic(`synthetic ${kind} child stderr:\n` + Buffer.concat(stderr[kind]).toString('utf8'));
    throw error;
  }
});
