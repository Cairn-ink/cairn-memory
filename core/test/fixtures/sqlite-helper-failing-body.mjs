import test from 'node:test';
import assert from 'node:assert/strict';
import children, { spawnSync } from 'node:child_process';
import threads, { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { faults } from './sqlite-helper-child-faults.mjs';
const originals = [children.spawnSync, threads.Worker, DatabaseSync.prototype.prepare];
test('intentional failing body and subsequent sibling', async t => {
  await t.test('body fails on purpose', t => {
    faults.install(t);
    throw Error('INTENTIONAL_BODY_FAILURE');
  });
  await t.test('sibling sees automatic restoration', () => {
    assert.deepEqual([children.spawnSync, threads.Worker, DatabaseSync.prototype.prepare], originals);
    assert.equal(spawnSync, originals[0]);
    assert.equal(Worker, originals[1]);
    console.log('FAILED_BODY_RESTORED');
  });
});
