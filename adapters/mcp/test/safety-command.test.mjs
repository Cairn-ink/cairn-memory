import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { installedImportClosure } from '../../../packaging/test/fixtures/installed-import-closure.mjs';
import { fixture, ns, refusal, independentFiles } from '../../../core/test/content-safety-preflight-fixture.mjs';
import { removeReviewedRoleHelpAdditions } from './fixtures/role-profile-help-compat.mjs';

const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const root = fileURLToPath(new URL('../../../', import.meta.url));
test('R2.7 reviewed safety usage addition preserves the pinned help bytes', () => {
  const child = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8', env: {} });
  assert.equal(child.status, 0); assert.equal(child.stderr, '');
  const projected = removeReviewedRoleHelpAdditions(child.stdout);
  assert.match(projected, /^Cairn Memory[^\n]*\n\nUsage:\n/);
  assert.equal(projected.includes('safety preflight'), false);
});

function command(args) {
  const child = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { NODE_NO_WARNINGS: '1' }, timeout: 30000 });
  assert.equal(child.error, undefined); assert.equal(child.signal, null);
  assert.equal(child.stderr, ''); return { status: child.status, value: JSON.parse(child.stdout), stdout: child.stdout };
}
test('safety preflight CLI emits only reconciled counts with no private material', t => {
  const f = fixture(t), memory = f.admit(), card = f.draft(ns, [memory], true); f.draft();
  const leaks = [ns.ownerId, memory.id, card.id, f.path, 'synthetic-session-secret',
    'Synthetic private title', 'Synthetic private body', 'Synthetic memory secret', 'Synthetic source text'];
  f.close(); const before = independentFiles(f.path), result = command(['safety', 'preflight', '--db', f.path]);
  assert.equal(result.status, 0);
  t.diagnostic('Synthetic preflight example: ' + JSON.stringify(result.value));
  assert.deepEqual(result.value, { enumerated: 2, complete: 0, unknown: 2, knownSuppressed: 0,
    owners: { complete: 0, unknown: 1, knownSuppressed: 0 }, ownersAffected: 1,
    knownSuppressedScope: 'single-producer-v1', mode: 'first-install', schemaBase: 23, unchangedFiles: true });
  for (const secret of leaks) assert.equal(result.stdout.includes(secret), false);
  assert.deepEqual(independentFiles(f.path), before);
});
for (const args of [['safety'], ['safety', 'preflight'], ['safety', 'preflight', '--db', '/synthetic/missing.sqlite'],
  ['safety', 'preflight', '--db', '/synthetic/store.sqlite', '--owner', 'synthetic-secret']]) {
  test(`safety CLI refusal has no partial output (${args.length} arguments)`, () => {
    const result = command(args); assert.equal(result.status, 1); assert.deepEqual(result.value, refusal);
    assert.equal(result.stdout.includes('synthetic'), false);
  });
}
test('safety CLI/core/classifier statically load with SQLite forbidden; artifact graph includes every new runtime file', () => {
  const source = `import {registerHooks} from 'node:module'; const loaded=[];
    registerHooks({resolve(s,c,n){if(s==='node:sqlite')throw Error('SQLite linked');return n(s,c);},load(u,c,n){loaded.push(u);return n(u,c);}});
    await import(${JSON.stringify(new URL('../cli.mjs', import.meta.url).href)});
    console.log(JSON.stringify(loaded));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', env: {}, timeout: 30000 });
  assert.equal(child.status, 0, child.stderr); assert.equal(child.stderr, '');
  const loaded = JSON.parse(child.stdout), graph = installedImportClosure(root, ['adapters/mcp/cli.mjs']);
  const manifest = JSON.parse(readFileSync(new URL('../../../packaging/artifact-files.json', import.meta.url)));
  for (const path of ['adapters/mcp/safety-command.mjs', 'core/content-safety-preflight.mjs', 'core/content-safety-classifier.mjs',
    'core/content-safety-observations.mjs', 'core/content-safety-files-child.mjs']) {
    assert.ok(graph.required.includes(path), path); assert.ok(manifest.includes(path), path);
    if (!path.endsWith('-child.mjs')) assert.ok(loaded.some(url => url.endsWith('/' + path)), path);
  }
  assert.ok(graph.childEntries.includes('core/content-safety-files-child.mjs'));
  for (const path of graph.required) assert.ok(manifest.includes(path), path);
});
