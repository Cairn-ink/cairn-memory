import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildArtifact } from '../../packaging/build.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { memberFixture, smallHierarchy, namespace, ok, expected } from '../testing/topic-members-fixture.mjs';
import { base } from '../testing/topic-member-previews-fixture.mjs';
import { openDatabase } from '../database.mjs';

test('P1 offline archive/installed actual Worker closure, schemas18/33 DELETE/WAL, busy and stale', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'preview-installed-' });
  const npm = join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js');
  const exits = [];
  const runCommand = (cmd, args, cwd, userconfig) => {
    const result = spawnSync(cmd === 'npm' ? process.execPath : cmd, cmd === 'npm' ? [npm, ...args] : args,
      { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, npm_config_userconfig: userconfig,
        npm_config_cache: join(workspace.path, 'npm-cache'), npm_config_audit: 'false', npm_config_fund: 'false',
        npm_config_offline: 'true', TMPDIR: workspace.path }, maxBuffer: 8 * 1024 * 1024 });
    exits.push({ command: cmd, code: result.status, signal: result.signal });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.signal, null);
    return result.stdout;
  };
  const artifact = buildArtifact({ runCommand, ownDirectory(path) { workspace.defer(() => rm(path, { recursive: true })); } });
  const install = join(workspace.path, 'installed'); mkdirSync(install);
  runCommand('tar', ['-xzf', artifact.artifactPath, '-C', install], install, artifact.userconfig);
  const root = join(install, 'package'), files = [];
  function inventory(directory) { for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name); if (entry.isDirectory()) inventory(path); else { assert.ok(entry.isFile()); files.push(relative(root, path)); }
  } }
  inventory(root); assert.deepEqual(files.sort(), artifact.files);
  const manifest = JSON.parse(readFileSync(new URL('../../packaging/artifact-files.json', import.meta.url))), visited = new Set();
  function visit(file) {
    if (visited.has(file)) return; visited.add(file); assert.ok(manifest.includes(file), file);
    const source = readFileSync(join(root, file), 'utf8');
    assert.equal(source, readFileSync(new URL('../../' + file, import.meta.url), 'utf8'));
    for (const match of source.matchAll(/(?:from\s*|import\s*(?:\(\s*)?|new URL\(\s*)['"](\.[^'"]+\.mjs)['"]/g)) {
      visit(relative(root, resolve(dirname(join(root, file)), match[1])));
    }
  }
  visit('core/index.mjs'); visit('core/topic-overview-worker.mjs');
  const { openMemoryReader } = await import(pathToFileURL(join(root, 'core/index.mjs')).href);
  for (const schema of [18,33]) for (const mode of ['DELETE','WAL']) {
    const f = memberFixture(t, { mode }); smallHierarchy(f); f.admit('installed-extra'); f.core.close();
    if (schema === 33) { const db = openDatabase(f.path, { currentDependencies: true }); db.close(); }
    const reader = openMemoryReader({ path: f.path, ownerId: namespace.ownerId }); t.after(() => reader.close());
    assert.deepEqual(Object.keys(ok(await reader.readTopicOverview({ namespace })).snapshot), ['indexRevision','generation']);
    const issued = ok(await reader.readTopicOverview({ namespace, snapshotVersion: 'topic-snapshot-v1' }));
    const input = { ...base, limit: 1, expectedSnapshot: JSON.parse(JSON.stringify(issued.snapshot)) };
    const first = ok(await reader.readTopicMembers(input)); assert.equal(first.items.length, 1);
    const nextInput = { ...input, cursor: first.nextCursor }, final = await reader.readTopicMembers(nextInput);
    assert.ok(final.ok); assert.equal(final.value.nextCursor, null); assert.deepEqual(await reader.readTopicMembers(nextInput), final);
    const rootNode = issued.items.find(n => n.level === 'L2');
    const rootPage = ok(await reader.readTopicMembers({ ...input, limit: 100, selection: expected(rootNode) }));
    assert.equal(rootPage.items.length, 3); assert.equal(new Set(rootPage.items.map(i => i.id)).size, 3);
    const rootInput = { ...input, limit: 1, selection: expected(rootNode) };
    const rootFirst = ok(await reader.readTopicMembers(rootInput));
    assert.ok(rootFirst.nextCursor);
    const rootContinuation = { ...rootInput, cursor: rootFirst.nextCursor };
    const rootNext = await reader.readTopicMembers(rootContinuation);
    assert.ok(rootNext.ok); assert.equal(rootNext.value.items.length, 1);
    assert.deepEqual(await reader.readTopicMembers(rootContinuation), rootNext);
    if (mode === 'DELETE') {
      f.db.exec('BEGIN EXCLUSIVE');
      try { assert.deepEqual(await reader.readTopicMembers(rootContinuation), { ok: false, error: { code: 'storage_busy' } }); }
      finally { f.db.exec('ROLLBACK'); }
    }
    assert.deepEqual(await reader.readTopicMembers(rootContinuation), rootNext);
    const epoch = f.db.prepare("SELECT epoch FROM namespace_epochs WHERE owner_id=? AND scope='personal' AND project_id=''").get(namespace.ownerId).epoch;
    f.db.prepare("UPDATE namespace_epochs SET epoch=epoch+1 WHERE owner_id=? AND scope='personal' AND project_id=''").run(namespace.ownerId);
    assert.equal(f.db.prepare("SELECT epoch FROM namespace_epochs WHERE owner_id=? AND scope='personal' AND project_id=''").get(namespace.ownerId).epoch, epoch + 1);
    assert.deepEqual(await reader.readTopicMembers(rootContinuation), { ok: false, error: { code: 'cursor_stale' } });
    await reader.close();
  }
  t.diagnostic(JSON.stringify({ archiveFiles: artifact.files.length, installedFiles: files.length,
    installedReachableModules: visited.size, inventoryDifference: [], childExits: exits }));
});
