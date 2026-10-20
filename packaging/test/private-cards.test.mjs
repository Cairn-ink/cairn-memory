import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { buildArtifact, command, packageName } from '../build.mjs';

const fixture = fileURLToPath(new URL('./fixtures/private-cards.mjs', import.meta.url));
const modules = ['input', 'schema', 'storage', 'facade'].map(name => `core/private-card-${name}.mjs`);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('installed private Cards retain an explicit provided note across process restart and cascade source deletion',
  { timeout: 120000 }, async t => {
    const workspace = createTestWorkspace(t, { prefix: 'cairn-installed-private-cards-' });
    const root = workspace.path;
    const home = join(root, 'home'); mkdirSync(home);
    // buildArtifact allocates beneath the outer owned runner's temporary root,
    // which also cleans partially built archives if build/install/assertions fail.
    const artifact = buildArtifact();
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: 'synthetic-private-cards-install', private: true, version: '0.0.0',
    }), { flag: 'wx' });
    assert.equal(command('npm', ['prefix', '--prefix', root], root, artifact.userconfig).trim(), root);
    command('npm', ['install', '--prefix', root, '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
      artifact.artifactPath], root, artifact.userconfig);
    const installed = join(root, 'node_modules', packageName);
    for (const file of modules) {
      assert.ok(artifact.files.includes(file), `${file} must be in the inspected archive`);
      const bytes = readFileSync(join(installed, file));
      assert.equal(hash(bytes), artifact.sourceHashes[file], `${file} installed bytes match the archive source hash`);
      assert.deepEqual(bytes, readFileSync(new URL(`../../${file}`, import.meta.url)));
    }
    const databasePath = join(root, 'synthetic-private-cards.sqlite');
    const statePath = join(root, 'synthetic-restart.json');
    const run = phase => {
      const child = spawnSync(process.execPath, [fixture, phase, installed, databasePath, statePath], {
        cwd: root, encoding: 'utf8', timeout: 30000,
        env: { PATH: dirname(process.execPath), HOME: home, TMPDIR: root, TMP: root, TEMP: root,
          NODE_NO_WARNINGS: '1', NODE_DISABLE_COMPILE_CACHE: '1' },
      });
      assert.equal(child.error, undefined, `${phase}: ${child.error?.message}`);
      assert.equal(child.signal, null, `${phase}: unexpected signal ${child.signal}`);
      assert.equal(child.status, 0, `${phase}: exit ${child.status}\n${child.stderr}\n${child.stdout}`);
      const evidence = JSON.parse(child.stdout);
      assert.equal(evidence.modelCalls, 0);
      assert.equal(evidence.httpCalls, 0);
      assert.equal(evidence.phase, phase);
      assert.equal(evidence.importedCore, join(installed, 'core/index.mjs'));
      return evidence;
    };
    const first = run('create');
    assert.equal(first.state, 'confirmed');
    assert.equal(existsSync(databasePath), true);
    const cold = run('restart-delete');
    assert.notEqual(first.pid, cold.pid, 'restart must use a different Node process');
    assert.equal(cold.confirmedRetainedAfterSourceDelete, true);
    assert.equal(cold.dependentDraftRemoved, true);
    assert.equal(cold.deletedCard, null);
    await workspace.cleanup();
    assert.equal(existsSync(root), false, 'installed project, manifest and SQLite files were removed');
  });
