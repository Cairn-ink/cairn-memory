import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { runtimeDirectory } from '../local-daemon-state.mjs';
import { runDaemonCommand } from '../local-daemon-liveness.mjs';

for (const action of ['status', 'stop']) test(action + ' refuses a runtime-directory store before coordination reads', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'location-'));
  const directory = await runtimeDirectory({ root });
  const open = fs.open; let opened = 0, output = '';
  fs.open = (...args) => { opened++; return open(...args); }; syncBuiltinESMExports();
  try {
    await assert.rejects(runDaemonCommand([action, '--db', join(directory.path, 'synthetic.sqlite')], {
      root, write: text => { output += text; },
    }), { code: 'daemon_store_location' });
    assert.equal(opened, 0); assert.equal(output, '');
  } finally { fs.open = open; syncBuiltinESMExports(); await fs.rm(root, { recursive: true, force: true }); }
});
