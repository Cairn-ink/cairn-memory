import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { CARDINALITY_HISTORY_SIZE, HISTORY_SIZES, assertHealthy, runWriteDiagnostic } from '../testing/write-failure-diagnostic.mjs';

test('Stage D actual core/OpenAI capture: healthy controls, ledger work and finite failure evidence', async t => {
  const direct = await runWriteDiagnostic({ guarded: false });
  assertHealthy(direct);
  assert.equal(direct.physicalRequests, 12);
  assert.equal(direct.captureWork.fullValidationQueries, 0);
  const scaling = [];
  for (const historySize of HISTORY_SIZES) {
    const report = await runWriteDiagnostic({ historySize });
    assertHealthy(report);
    assert.equal(report.physicalRequests, direct.physicalRequests);
    assert.equal(report.accounting.halted, false);
    assert.equal(report.accounting.pendingCount, 0);
    assert.equal(report.configuredPolicy.cairnCount.timeoutMs, 60_000);
    assert.equal(report.transport.total, 12);
    assert.equal(report.transport.observations.every(row => row.termination === 'response'), true);
    assert.ok(report.captureWork.fullValidationQueries > 0);
    assert.ok(report.captureWork.validatedAttemptRows >= historySize * report.captureWork.fullValidationQueries);
    scaling.push(report);
  }
  assert.equal(scaling[0].captureWork.fullValidationQueries, scaling[1].captureWork.fullValidationQueries);
  assert.equal(scaling[1].captureWork.validatedAttemptRows - scaling[0].captureWork.validatedAttemptRows,
    (HISTORY_SIZES[1] - HISTORY_SIZES[0]) * scaling[0].captureWork.fullValidationQueries);
  t.diagnostic(JSON.stringify({ kind: 'synthetic-scaling', reports: [direct, ...scaling] }));

  for (const injection of ['count-rejection', 'generation-rejection', 'classification-rejection',
    'prefix-tamper', 'request-cap', 'monetary-cap']) {
    const report = await runWriteDiagnostic({ injection, batches: 1 });
    assert.throws(() => assertHealthy(report), assert.AssertionError);
    assert.equal(report.cleanupRemoved, true);
    assert.equal(report.accounting.pendingCount, 0);
    assert.equal(report.accounting.halted, true);
    if (['classification-rejection', 'request-cap', 'monetary-cap'].includes(injection)) {
      assert.deepEqual(report.sourceOutcomes.map(row => [row.ok, row.admittedCount, row.classification]), [[true, 1, 'failed']]);
      assert.equal(report.retainedCount, 1, 'classification failure keeps prior admission');
      assert.equal(report.sourceIntegrity, true);
    } else {
      assert.equal(report.sourceOutcomes[0].ok, false);
      assert.equal(report.retainedCount, 0, 'extraction failure admits no source memory');
    }
    if (injection === 'count-rejection' || injection === 'generation-rejection') {
      const row = report.transport.observations.at(-1);
      assert.notEqual(row.fetchEnteredMs, null);
      assert.equal(row.responseAvailableMs, null);
      assert.equal(row.termination, 'transport_failure');
      assert.equal(row.accountingOutcome, 'unknown');
    }
    t.diagnostic(JSON.stringify({ kind: 'synthetic-control', report }));
  }
  // Prove GREEN by removing only the first-fetch injection from the minimal
  // one-batch fixture and using precisely the same assertHealthy function.
  assertHealthy(await runWriteDiagnostic({ injection: 'none', batches: 1 }));
  const later = await runWriteDiagnostic({ injection: 'later-generation-rejection', batches: 3 });
  assert.throws(() => assertHealthy(later), assert.AssertionError);
  assert.deepEqual(later.sourceOutcomes.map(row => [row.ordinal, row.ok, row.admittedCount]),
    [[0, true, 1], [1, false, 0]]);
  assert.equal(later.completedBatches, 1);
  assert.equal(later.retainedCount, 1);
  assert.equal(later.sourceIntegrity, true, 'earlier admitted source survives the later extraction failure');
  assert.equal(later.physicalRequests, 6, 'later planned batches send nothing after the failure halt');
  assert.equal(later.accounting.attempts.at(-1).outcome, 'unknown');
  assert.equal(later.accounting.halted, true);
  assert.equal(later.cleanupRemoved, true);
  t.diagnostic(JSON.stringify({ kind: 'synthetic-later-failure', report: later }));
});

for (const [injection, termination, halted] of [
  ['core-timeout', 'core_deadline', false],
  ['transport-timeout', 'transport_deadline', false],
  ['external-abort', 'external_abort', true],
]) test(`Stage D test-only accelerated ${injection} preserves full unknown reservation`, async t => {
  // Core remains 30s; transport keeps 60s except this explicitly test-only
  // transport control, where 10ms avoids the earlier core deadline winning.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const report = await runWriteDiagnostic({ injection, batches: 1,
    advanceTimers: milliseconds => t.mock.timers.tick(milliseconds) });
  assert.throws(() => assertHealthy(report), assert.AssertionError);
  assert.equal(report.physicalRequests, 1);
  assert.equal(report.accounting.halted, halted);
  assert.equal(report.accounting.pendingCount, 0);
  assert.equal(report.accounting.attempts[0].outcome, 'unknown');
  assert.equal(report.accounting.attempts[0].actualMicroUsd, null);
  assert.equal(report.accounting.attempts[0].reservedMicroUsd, 5000);
  assert.equal(report.transport.observations[0].termination, termination);
  assert.equal(report.configuredPolicy.cairnCount.timeoutMs, injection === 'transport-timeout' ? 10 : 60_000);
  assert.equal(report.cleanupRemoved, true);
  t.diagnostic(JSON.stringify({ kind: 'synthetic-timeout-control', report }));
});

test('Stage D identical subprocess health assertion is RED with injection, GREEN without, and removes owned residue', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-write-health-parent-' });
  for (const [injection, exitCode] of [['count-rejection', 1], ['none', 0]]) {
    const result = spawnSync(process.execPath, ['tools/testing/run.mjs', '--script',
      'evaluation/experiment-budget/testing/write-failure-diagnostic.mjs',
      `--injection=${injection}`, '--expect-healthy'], { encoding: 'utf8', timeout: 10_000,
      env: { PATH: process.env.PATH, TMPDIR: workspace.path, TMP: workspace.path, TEMP: workspace.path,
        NODE_DISABLE_COMPILE_CACHE: '1' } });
    assert.equal(result.error, undefined);
    assert.equal(result.status, exitCode);
    assert.deepEqual(readdirSync(workspace.path), [], 'runner and fixture must leave no owned success/failure residue');
    const report = JSON.parse(result.stdout.trim());
    assert.equal(report.cleanupRemoved, true);
    if (exitCode === 1) assert.match(result.stderr, /all planned captures must complete/u);
    else assertHealthy(report);
  }
  await workspace.cleanup();
  assert.equal(existsSync(workspace.path), false);
});

test('Stage D one healthy batch at exactly 35,812 synthetic settled rows preserves source and accounting', async t => {
  // One explicitly authorized cardinality point on the ordinary v1 path; the
  // default three-batch 16/4096 controls above are unchanged. No live book,
  // embedding/mixed profile or elapsed threshold is represented by this point.
  const control = await runWriteDiagnostic({ historySize: 16, batches: 1 });
  const point = await runWriteDiagnostic({ historySize: CARDINALITY_HISTORY_SIZE, batches: 1 });
  for (const report of [control, point]) {
    assertHealthy(report);
    assert.equal(report.completedBatches, 1);
    assert.equal(report.retainedCount, 1);
    assert.equal(report.sourceIntegrity, true);
    assert.equal(report.physicalRequests, 4);
    assert.equal(report.accounting.requestCount, report.historySize + 4);
    assert.equal(report.accounting.reservedMicroUsd, report.historySize + 20_000);
    assert.equal(report.accounting.halted, false);
    assert.equal(report.accounting.pendingCount, 0);
    assert.equal(report.cleanupRemoved, true);
  }
  assert.equal(point.captureWork.fullValidationQueries, control.captureWork.fullValidationQueries);
  assert.equal(point.captureWork.validatedAttemptRows - control.captureWork.validatedAttemptRows,
    (CARDINALITY_HISTORY_SIZE - 16) * control.captureWork.fullValidationQueries);
  t.diagnostic(JSON.stringify({ kind: 'synthetic-one-batch-cardinality', reports: [control, point] }));
});
