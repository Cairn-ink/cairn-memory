import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { buildArtifact, command, packageName } from '../build.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/raw-skipped-tail-barrier.mjs', import.meta.url));

for (const client of ['claude-code', 'codex']) test(`B2a-06 installed ${client}: policy-skip tails recover through a fresh feature-off project writer`, { timeout: 120000 }, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'installed-raw-skipped-barrier-' });
  const home = join(workspace.path, 'home'); mkdirSync(home, { mode: 0o700 });
  const artifact = buildArtifact();
  writeFileSync(join(workspace.path, 'package.json'), JSON.stringify({ name: 'synthetic-installed-barrier', version: '0.0.0', private: true }), { flag: 'wx', mode: 0o600 });
  assert.equal(command('npm', ['prefix', '--prefix', workspace.path], workspace.path, artifact.userconfig).trim(), workspace.path);
  command('npm', ['install', '--prefix', workspace.path, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', artifact.artifactPath], workspace.path, artifact.userconfig);
  const installed = join(workspace.path, 'node_modules', packageName), database = join(workspace.path, 'store.sqlite'), state = join(workspace.path, 'state.json');
  for (const path of ['core/index.mjs', 'core/raw-control-storage.mjs']) {
    assert.ok(artifact.files.includes(path));
    assert.deepEqual(readFileSync(join(installed, path)), readFileSync(join(root, path)));
  }
  const pids = new Set();
  for (const phase of ['create', 'barrier', 'resume']) {
    const child = spawnSync(process.execPath, [fixture, phase, installed, database, state, client], { cwd: workspace.path, encoding: 'utf8', timeout: 30000,
      env: { PATH: dirname(process.execPath), HOME: home, TMPDIR: workspace.path, TMP: workspace.path, TEMP: workspace.path,
        NODE_DISABLE_COMPILE_CACHE: '1', NODE_NO_WARNINGS: '1' } });
    assert.equal(child.error, undefined, child.error?.message); assert.equal(child.signal, null);
    assert.equal(child.status, 0, child.stderr + '\n' + child.stdout);
    const result = JSON.parse(child.stdout);
    assert.equal(result.phase, phase); assert.equal(result.client, client);
    assert.equal(result.importedCore, join(installed, 'core/index.mjs'));
    assert.equal(result.networkCalls, 0); assert.equal(result.modelCalls, phase === 'barrier' ? 0 : 3);
    assert.equal(result.skipReasons, 3); pids.add(result.pid);
  }
  assert.equal(pids.size, 3);
  t.diagnostic(JSON.stringify({ client, stages: pids.size, skipReasons: 3, archiveFiles: artifact.files.length }));
  await workspace.cleanup(); assert.equal(existsSync(workspace.path), false);
});
