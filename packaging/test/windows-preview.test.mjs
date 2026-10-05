import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

// The POSIX process-group runner is intentionally unsupported on Windows.
// Run this focused native check with node --test; its own workspace owns all
// installation, build and walkthrough output and registers cleanup immediately.
test('native Windows source installation and six-stage keyless SDK lifecycle', {
  skip: process.platform !== 'win32', timeout: 240000,
}, t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-windows-preview-' });
  const root = fileURLToPath(new URL('../../', import.meta.url));
  assert.equal(readFileSync(join(root, 'packaging/bin/cairn-memory.mjs'), 'utf8').split('\n')[0],
    '#!/usr/bin/env node', 'Git checkout must preserve the executable LF shebang');
  const target = join(workspace.path, 'local preview & spaces');
  const env = { PATH: `${dirname(process.execPath)};${process.env.PATH ?? ''}`,
    SystemRoot: process.env.SystemRoot, TMPDIR: workspace.path, TMP: workspace.path, TEMP: workspace.path,
    OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1', NODE_DISABLE_COMPILE_CACHE: '1' };
  const run = args => spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8',
    timeout: 120000, maxBuffer: 4 * 1024 * 1024, shell: false });
  const installed = run(['packaging/install-preview.mjs', '--directory', target, '--owner', 'synthetic-windows-owner']);
  assert.equal(installed.status, 0, 'native installer must complete');
  const report = JSON.parse(installed.stdout);
  const receipt = JSON.parse(readFileSync(report.receiptPath, 'utf8'));
  assert.equal(receipt.stdio.command, process.execPath);
  assert.equal(receipt.ownerId, 'synthetic-windows-owner');
  assert.equal(receipt.projectId, null);
  assert.equal(createHash('sha256').update(readFileSync(receipt.artifact.path)).digest('hex'), receipt.artifact.sha256);
  for (const [path, expected] of Object.entries(receipt.artifact.sourceHashes)) {
    const installedFile = join(target, 'app/node_modules/cairn-memory-local-preview', path);
    assert.equal(createHash('sha256').update(readFileSync(installedFile)).digest('hex'), expected, path);
  }
  assert.equal(existsSync(receipt.databasePath), false, 'installation must not open a database');
  const refused = run(['packaging/install-preview.mjs', '--directory', target, '--owner', 'synthetic-windows-owner']);
  assert.equal(refused.status, 1, 'existing installations must not be overwritten');
  assert.match(refused.stderr, /partial installation is retained/);
  assert.deepEqual(JSON.parse(readFileSync(report.receiptPath, 'utf8')), receipt);
  const checked = run([receipt.executable, '--check-config', ...receipt.stdio.args.slice(1)]);
  assert.equal(checked.status, 0);
  const configuration = JSON.parse(checked.stdout);
  assert.equal(configuration.ok, true);
  assert.equal(configuration.databaseOpened, false);
  assert.equal(configuration.providerContacted, false);
  assert.equal(configuration.modelKeyPresent, false);
  const walked = run(['adapters/mcp/walkthrough.mjs', '--executable', receipt.executable]);
  assert.equal(walked.status, 0, 'native SDK walkthrough must complete');
  const walkthrough = JSON.parse(walked.stdout);
  assert.equal(walkthrough.status, 'passed');
  assert.equal(walkthrough.withRecall, false);
  assert.deepEqual(walkthrough.stages, [
    'five_tools', 'remember_and_inspect', 'restart_and_inspect',
    'correct_and_reject_stale', 'model_disabled', 'forget_and_empty_inspect',
  ].map(stage => ({ stage, status: 'passed' })));
  t.diagnostic(JSON.stringify({ platform: process.platform, architecture: process.arch,
    node: process.versions.node, sourceHashesVerified: Object.keys(receipt.artifact.sourceHashes).length,
    stages: walkthrough.stages.map(item => item.stage), modelRequests: 0 }));
});
