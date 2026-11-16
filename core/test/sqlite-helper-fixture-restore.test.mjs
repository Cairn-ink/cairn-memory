import test from 'node:test';
import assert from 'node:assert/strict';
import children from 'node:child_process';
import threads from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
const originals = [children.spawnSync, threads.Worker, DatabaseSync.prototype.prepare];
const { faults } = await import('./fixtures/sqlite-helper-child-faults.mjs');
test('fixture patches are scoped to one test', t => {
  faults.install?.(t);
  assert.notEqual(children.spawnSync, originals[0]);
  assert.notEqual(threads.Worker, originals[1]);
  assert.notEqual(DatabaseSync.prototype.prepare, originals[2]);
});
test('FIXTURE_ORIGINALS_RESTORED: subsequent same-process test sees all originals', () => {
  assert.equal(children.spawnSync, originals[0], 'FIXTURE_ORIGINALS_RESTORED_spawnSync');
  assert.equal(threads.Worker, originals[1], 'FIXTURE_ORIGINALS_RESTORED_Worker');
  assert.equal(DatabaseSync.prototype.prepare, originals[2], 'FIXTURE_ORIGINALS_RESTORED_prepare');
});
test('FIXTURE_FAILED_BODY: an intentionally throwing subtest restores before its sibling', () => {
  const result = children.spawnSync(process.execPath, ['--test', new URL('./fixtures/sqlite-helper-failing-body.mjs', import.meta.url).pathname], { encoding: 'utf8', env: {}, timeout: 10000 });
  assert.equal(result.status, 1, 'intentional failure is contained in a separate test process');
  assert.match(result.stdout, /INTENTIONAL_BODY_FAILURE/);
  assert.match(result.stdout, /FAILED_BODY_RESTORED/, 'FIXTURE_FAILED_BODY_RESTORED');
  assert.equal(children.spawnSync, originals[0]);
});
