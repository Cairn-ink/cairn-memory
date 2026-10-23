import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const entries = [
  ['../method-package-schema.mjs', 'validateMethodPackages'],
  ['../asset-schema.mjs', 'validateAssets'],
  ['../../adapters/local/configuration.mjs', 'readConfigurationSnapshot'],
  ['../../integrations/client/raw/local-transport.mjs', 'createLocalCaptureTransport'],
  ['../../integrations/client/raw/local-worker.mjs', 'createLocalRawWorker'],
  ['../../integrations/client/raw/local-host.mjs', 'createLocalRawHost'],
  ['../../integrations/client/raw/local-host-cli.mjs', 'runLocalHostCli'],
  ['../../integrations/client/raw/local-setup-cli.mjs', 'runLocalSetupCli'],
];

for (const [relative, exported] of entries) {
  test(`method/asset schema guards keep ${relative} importable without SQLite`, t => {
    const workspace = createTestWorkspace(t, { prefix: 'cairn-schema-import-' });
    const child = join(workspace.path, 'guard.mjs');
    writeFileSync(child, `
      import assert from 'node:assert/strict';
      import { register } from 'node:module';
      register('data:text/javascript,' + encodeURIComponent(
        "export async function resolve(specifier, context, next) {" +
        "if (specifier === 'node:sqlite') throw Error('schema_guard_eager_sqlite');" +
        "return next(specifier, context); }"
      ), import.meta.url);
      const loaded = await import(${JSON.stringify(new URL(relative, import.meta.url).href)});
      assert.equal(typeof loaded[${JSON.stringify(exported)}], 'function');
      // Prove that the resolve guard was active during the preceding import.
      await assert.rejects(import('node:sqlite'), /schema_guard_eager_sqlite/);
    `);
    const log = join(workspace.path, 'child.log');
    const fd = openSync(log, 'wx');
    let result;
    try {
      // A fresh process per entry prevents a cached module from hiding an edge.
      result = spawnSync(process.execPath, [child], {
        stdio: ['ignore', fd, fd], timeout: 15000,
      });
    } finally { closeSync(fd); }
    const output = readFileSync(log, 'utf8');
    assert.equal(result.error, undefined, output);
    assert.equal(result.signal, null, output);
    assert.equal(result.status, 0, output);
  });
}
