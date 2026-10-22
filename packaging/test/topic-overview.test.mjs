import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { buildArtifact, command, packageName } from '../build.mjs';

const fixture = fileURLToPath(new URL('./fixtures/topic-overview.mjs', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
test('installed archive executes the real asynchronous topic reader and its fixed Worker closure',
  { timeout: 120000 }, async t => {
    const workspace = createTestWorkspace(t, { prefix: 'cairn-installed-topic-overview-' });
    const root = workspace.path, home = join(root, 'home'); mkdirSync(home);
    const artifact = buildArtifact();
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-topic-overview-install', private: true }));
    command('npm', ['install', '--prefix', root, '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
      artifact.artifactPath], root, artifact.userconfig);
    const installed = join(root, 'node_modules', packageName);
    // Archive-derived modules versus an independent installed import/Worker walk.
    const archive = artifact.files.filter(path => path.startsWith('core/') && path.endsWith('.mjs'));
    const closure = new Set();
    function visit(path) {
      if (closure.has(path)) return;
      closure.add(path);
      const text = readFileSync(join(installed, path), 'utf8');
      for (const match of text.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
        const resolved = join(dirname(path), match[1]);
        if (resolved.endsWith('.mjs')) visit(resolved);
      }
      for (const match of text.matchAll(/new URL\(['"](\.[^'"]+\.mjs)['"],\s*import\.meta\.url\)/g)) {
        visit(join(dirname(path), match[1]));
      }
    }
    visit('core/index.mjs');
    const readerClosure = [...closure].filter(path => /memory-reader|read-database|topic-overview/.test(path)).sort();
    const archivedReader = archive.filter(path => /memory-reader|read-database|topic-overview/.test(path)).sort();
    assert.deepEqual(readerClosure, archivedReader);
    assert.equal(readerClosure.length, 5, 'five installed reader modules independently cross-checked');
    for (const file of readerClosure) {
      assert.equal(hash(readFileSync(join(installed, file))), artifact.sourceHashes[file]);
      assert.deepEqual(readFileSync(join(installed, file)), readFileSync(new URL(`../../${file}`, import.meta.url)));
    }
    const child = spawnSync(process.execPath, [fixture, installed, join(root, 'synthetic.sqlite')], {
      cwd: root, encoding: 'utf8', timeout: 30000,
      env: { PATH: dirname(process.execPath), HOME: home, TMPDIR: root, TMP: root, TEMP: root,
        NODE_NO_WARNINGS: '1', NODE_DISABLE_COMPILE_CACHE: '1' },
    });
    assert.equal(child.error, undefined); assert.equal(child.signal, null);
    assert.equal(child.status, 0, `actual installed child exit ${child.status}: ${child.stderr}`);
    const evidence = JSON.parse(child.stdout);
    assert.equal(evidence.importedCore, join(installed, 'core/index.mjs'));
    assert.equal(evidence.observedWorker, join(installed, 'core/topic-overview-worker.mjs'));
    assert.equal(evidence.databaseUnchanged, true);
    await workspace.cleanup(); assert.equal(existsSync(root), false);
  });
