import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const child = fileURLToPath(new URL('../testing/source-ranking-snapshot-child.mjs', import.meta.url));
function run(t, scenario, mutation) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-snapshot-parent-' });
  const result = spawnSync(process.execPath, [child, scenario, ...(mutation ? [mutation] : [])], {
    encoding: 'utf8', timeout: 30000, env: { TMPDIR: workspace.path, TMP: workspace.path, TEMP: workspace.path } });
  assert.equal(result.error, undefined, result.stderr);
  assert.equal(result.signal, null);
  assert.equal(result.status, mutation ? 2 : 0, result.stdout + result.stderr);
  const observed = JSON.parse(result.stdout);
  assert.equal(observed.cleanup, true);
  assert.deepEqual(readdirSync(workspace.path), [], 'child scratch removed on success and assertion failure');
  return { observed, stderr: result.stderr };
}

for (const scenario of ['foreign-mask', 'foreign-label', 'same-mask', 'same-page', 'same-label',
  'same-winner-batch', 'receipt-mask', 'forget-mask', 'filing-label', 'null-mask', 'null-label-private',
  'null-counter', 'publish-mask', 'active-publish-label', 'same-model', 'read-error', 'label-error',
  'poison-eligible', 'poison-excluded']) {
  test(`P3 real initialized-connection snapshot race: ${scenario}`, t => {
    const { observed } = run(t, scenario);
    assert.equal(observed.assertion, null);
    assert.equal(observed.journalMode, 'delete');
  });
}

test('P3 red long-transaction control blocks actual foreign capture COMMIT', t => {
  const { observed, stderr } = run(t, 'foreign-mask', 'long-transaction');
  assert.match(stderr, /SNAPSHOT_RACE_ASSERTION_FAILED:outside-lock capture must fully commit before release/u);
  assert.equal(observed.mutationResult.ok, false);
  assert.equal(observed.mutationResult.code, 'storage_busy');
  assert.equal(observed.paused.activeTransactions, 1);
});

test('P3 red omitted-generation control returns stale private candidates after real NULL staging', t => {
  const { observed, stderr } = run(t, 'null-label-private', 'omit-generation');
  assert.match(stderr, /SNAPSHOT_RACE_ASSERTION_FAILED:staged NULL must reject at anchored read/u);
  assert.equal(observed.mutationResult.generation, null);
  assert.equal(observed.mutationResult.epochAfter, observed.beforeEpoch);
  assert.equal(observed.done.ok, true);
  assert.equal(observed.done.returned, 5);
});
