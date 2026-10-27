import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { buildArtifact, command, packageName } from '../build.mjs';
import { installedImportClosure } from './fixtures/installed-import-closure.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/topic-overview-raw29.mjs', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const walk = (path, prefix = '') => readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
  ? walk(join(path, entry.name), prefix + entry.name + '/') : [prefix + entry.name]).sort();
for (const [mode, client] of [['layouts', 'claude-code'], ['raw', 'claude-code'], ['raw', 'codex']]) {
  test(`R29 installed ${mode} ${client}: physical compatibility and actual fixed Worker closure`, { timeout: 120000 }, async t => {
    const workspace = createTestWorkspace(t, { prefix: 'installed-overview-raw29-' }), home = join(workspace.path, 'home'); mkdirSync(home);
    const artifact = buildArtifact(), graph = installedImportClosure(root, ['core/index.mjs']);
    writeFileSync(join(workspace.path, 'package.json'), JSON.stringify({ name: 'synthetic-installed-overview-raw29', private: true }));
    command('npm', ['install', '--prefix', workspace.path, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', artifact.artifactPath], workspace.path, artifact.userconfig);
    const installed = join(workspace.path, 'node_modules', packageName), archived = command('tar', ['-tzf', artifact.artifactPath], workspace.path, artifact.userconfig)
      .trim().split('\n').map(path => path.slice('package/'.length)).sort();
    assert.deepEqual(archived, [...JSON.parse(readFileSync(join(installed, 'package.json'))).files].sort()); assert.deepEqual(walk(installed), archived);
    for (const path of graph.required) { assert.ok(archived.includes(path), path); assert.equal(hash(readFileSync(join(installed, path))), artifact.sourceHashes[path]); }
    for (const [path, expected] of Object.entries(artifact.sourceHashes)) assert.equal(hash(readFileSync(join(installed, path))), expected, path);
    assert.deepEqual(installedImportClosure(installed, ['core/index.mjs']), graph);
    assert.deepEqual(graph.workerEntries, ['core/context-product-worker.mjs', 'core/topic-overview-worker.mjs']);
    assert.ok(graph.lazy.includes('core/context-product-worker.mjs'));
    const child = spawnSync(process.execPath, [fixture, installed, workspace.path, mode, client], { cwd: workspace.path, encoding: 'utf8', timeout: 30000, maxBuffer: 262144,
      env: { PATH: dirname(process.execPath), HOME: home, TMPDIR: workspace.path, TMP: workspace.path, TEMP: workspace.path,
        NODE_NO_WARNINGS: '1', NODE_DISABLE_COMPILE_CACHE: '1' } });
    assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, 0, child.stderr);
    const report = JSON.parse(child.stdout); assert.equal(report.importedCore, join(installed, 'core/index.mjs')); assert.equal(report.workersClosed, true);
    if (mode === 'layouts') { assert.equal(report.outcomes.length, 10); assert.equal(report.missingUncreated, true); assert.equal(report.malformedUnchanged, true); }
    else { assert.equal(report.publicCaptures, 5); assert.equal(report.lineageBefore, 5); assert.equal(report.independentSupportSurvived, true); assert.equal(report.metadataModelCalls, 0); }
    t.diagnostic(JSON.stringify({ ...report, childCode: child.status, childSignal: child.signal, requiredClosure: graph.required.length, eagerClosure: graph.eager.length }));
    await workspace.cleanup(); assert.equal(existsSync(workspace.path), false);
  });
}
