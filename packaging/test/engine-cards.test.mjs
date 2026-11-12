import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { buildArtifact, command, packageName } from '../build.mjs';
import { installedImportClosure } from './fixtures/installed-import-closure.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/engine-cards.mjs', import.meta.url));
const engineModules = ['clusters', 'maintenance', 'output', 'storage'].map(name => `core/engine-card-${name}.mjs`);

test('installed engine Cards stay lazy until maintenance and consolidate using archive modules only', { timeout: 120000 }, t => {
  const workspace = createTestWorkspace(t, { prefix: 'installed-engine-cards-' });
  const home = join(workspace.path, 'home'); mkdirSync(home);
  const artifact = buildArtifact();
  writeFileSync(join(workspace.path, 'package.json'), JSON.stringify({ name: 'synthetic-engine-cards', private: true }));
  command('npm', ['install', '--prefix', workspace.path, '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
    artifact.artifactPath], workspace.path, artifact.userconfig);
  const installed = join(workspace.path, 'node_modules', packageName);
  const source = installedImportClosure(root, ['core/index.mjs']);
  const enabled = installedImportClosure(root, ['core/index.mjs', 'core/engine-card-maintenance.mjs', 'core/engine-card-storage.mjs']);
  const archive = installedImportClosure(installed, ['core/index.mjs']);
  assert.deepEqual(archive, source);
  for (const path of source.required) {
    assert.ok(artifact.files.includes(path), path);
    assert.deepEqual(readFileSync(join(installed, path)), readFileSync(join(root, path)), path);
  }
  for (const mode of ['unconfigured', 'configured']) {
    const trace = join(workspace.path, mode + '.jsonl');
    const child = spawnSync(process.execPath, [fixture, installed, root, join(workspace.path, mode + '.sqlite'), trace, mode], {
      cwd: workspace.path, encoding: 'utf8', timeout: 30000,
      env: { PATH: dirname(process.execPath), HOME: home, TMPDIR: workspace.path, TMP: workspace.path, TEMP: workspace.path,
        NODE_DISABLE_COMPILE_CACHE: '1', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(child.error, undefined, child.error?.message);
    assert.equal(child.signal, null); assert.equal(child.status, 0, child.stderr + '\n' + child.stdout);
    const result = JSON.parse(child.stdout);
    assert.equal(result.networkCalls, 0); assert.equal(result.sourceReads, 0);
    assert.equal(result.modelCalls, mode === 'configured' ? 1 : 0);
    assert.deepEqual(result.loadedBeforeMaintenance.filter(path => engineModules.includes(path)), []);
    const rows = readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    const loaded = [...new Set(rows.filter(row => row.kind === 'load').map(row => row.path))].sort();
    const resolved = new Set(rows.filter(row => row.kind === 'resolve').map(row => row.path));
    for (const path of loaded) assert.ok(source.required.includes(path), 'module outside independently derived closure: ' + path);
    for (const path of engineModules) {
      assert.equal(loaded.includes(path), mode === 'configured', path);
      assert.equal(resolved.has(path), mode === 'configured', path);
    }
    const observed = [...new Set(rows.map(row => row.path))].sort();
    if (mode === 'configured') assert.deepEqual(observed, enabled.eager);
    t.diagnostic(JSON.stringify({ mode, installedModules: loaded.length, modelCalls: result.modelCalls,
      engineModulesLoaded: loaded.filter(path => engineModules.includes(path)).length, networkCalls: 0, sourceReads: 0 }));
  }
});
