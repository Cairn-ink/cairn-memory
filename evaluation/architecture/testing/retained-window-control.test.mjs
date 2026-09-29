import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { forbiddenSourceReturned, parseRetainedWindowReport } from '../retained-window-control.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = fileURLToPath(new URL('../retained-window-control-fixture.mjs', import.meta.url));
const expectedFixtureSha = '9354e0c21e1d01827129945125ae167e5aec6178076c60f0b573cab0c7be84db';

function run(workspace, seconds, arg = null) {
  const args = ['--signal=TERM', '--kill-after=20s', `${seconds}s`, process.execPath,
    'tools/testing/run.mjs', '--script',
    'evaluation/architecture/retained-window-control-cli.mjs', ...(arg ? [arg] : [])];
  const result = spawnSync('timeout', args, { cwd: root, encoding: 'utf8', timeout: 325_000,
    maxBuffer: 256 * 1024, env: { ...process.env, TMPDIR: workspace.path,
      TMP: workspace.path, TEMP: workspace.path, NODE_DISABLE_COMPILE_CACHE: '1' } });
  assert.equal(result.error, undefined, result.error?.message);
  assert.deepEqual(readdirSync(workspace.path), [], 'owned runner cleaned its scratch');
  return result;
}

test('frozen synthetic source control traverses real cold capture/admit, recall, and lifecycle', t => {
  assert.equal(createHash('sha256').update(readFileSync(fixture)).digest('hex'), expectedFixtureSha);
  const workspace = createTestWorkspace(t, { prefix: 'cairn-retained-trial-' });
  const result = run(workspace, 300);
  assert.equal(result.status, 0, result.stderr);
  const report = parseRetainedWindowReport(result.stdout, result.status);
  assert.equal(report.status, 'completed');
  assert.deepEqual(report.acceptanceIds, ['RWC-01', 'RWC-02', 'RWC-03', 'RWC-04',
    'RWC-05', 'RWC-06', 'RWC-07']);
  assert.deepEqual(report.coldIdentity, { baseline: 250, control: 300 });
  assert.equal(report.baseline.metrics.calls.extract, 50);
  assert.equal(report.baseline.metrics.calls.classify, 50);
  assert.equal(report.control.metrics.calls.extract, 0);
  assert.equal(report.control.metrics.calls.classify, 0);
  assert.ok(report.shared.counterTokens <= 32_000_000);
  assert.ok(report.shared.callbackTokens <= 2_000_000);
  assert.deepEqual(report.queries.map(row => row.id), ['Q1', 'Q2', 'Q3', 'Q4', 'Q5']);
  assert.equal(report.queries[0].baseline.sources.primary.status, 'not-retained');
  assert.equal(report.queries[0].control.sources.primary.source.currentSourceBinding, 'yes');
  assert.equal(report.queries[1].baseline.sources.primary.source.currentSourceBinding, 'yes');
  assert.equal(report.queries[1].control.sources.primary.source.currentSourceBinding, 'yes');
  assert.equal(report.queries[3].control.sources.decoy.status, 'observed');
  assert.deepEqual(report.queries[4].control.sources, {});
  assert.deepEqual(report.queries[4].control.delivered, {});
  assert.equal(report.lifecycle.q6.id, 'Q6');
  assert.equal(report.lifecycle.q6.sources.primary.source.currentSourceBinding, 'yes');
  for (const name of ['correction', 'forgetting', 'deduplication', 'isolation']) {
    assert.ok(Object.values(report.lifecycle[name]).every(Boolean), name);
  }
  assert.ok(report.baseline.databaseBytes.final.total > 0);
  assert.ok(report.control.databaseBytes.final.total > 0);
  assert.ok(report.captureElapsedMs > 0 && report.elapsedMs >= report.captureElapsedMs);

  const tampered = structuredClone(report);
  tampered.baseline.cards = 249;
  assert.throws(() => parseRetainedWindowReport(`${JSON.stringify(tampered)}\n`, 0));
  tampered.baseline.cards = 250;
  tampered.unexpected = true;
  assert.throws(() => parseRetainedWindowReport(`${JSON.stringify(tampered)}\n`, 0));
  delete tampered.unexpected;
  tampered.queries[0].control.delivered.primary = !tampered.queries[0].control.delivered.primary;
  assert.throws(() => parseRetainedWindowReport(`${JSON.stringify(tampered)}\n`, 0));
  const unknownTrace = structuredClone(report);
  unknownTrace.queries[0].control.sources.primary.status = 'invented';
  assert.throws(() => parseRetainedWindowReport(`${JSON.stringify(unknownTrace)}\n`, 0));
  const unknownReason = structuredClone(report);
  unknownReason.queries[0].control.sources.primary = { version: 1,
    scope: 'one-current-source/one-recall', status: 'unavailable',
    reason: 'arbitrary-private-text', firstObservedGap: 'unavailable' };
  unknownReason.queries[0].control.delivered.primary = false;
  assert.throws(() => parseRetainedWindowReport(`${JSON.stringify(unknownReason)}\n`, 0));
  const missingPrimary = structuredClone(report);
  delete missingPrimary.queries[0].control.sources.primary;
  delete missingPrimary.queries[0].control.delivered.primary;
  assert.throws(() => parseRetainedWindowReport(`${JSON.stringify(missingPrimary)}\n`, 0));
  const optionalReason = structuredClone(report);
  optionalReason.reason = 'arbitrary-private-text';
  assert.throws(() => parseRetainedWindowReport(`${JSON.stringify(optionalReason)}\n`, 0));
  assert.throws(() => parseRetainedWindowReport(`noise\n${result.stdout}`, 0));
  assert.throws(() => parseRetainedWindowReport(result.stdout, 1));
  assert.throws(() => parseRetainedWindowReport(`${result.stdout.slice(0, -1)} Batch 37 slot 5\n`, 0));
});

test('projected recall negative control detects forbidden pre-forget lineage', () => {
  const forbidden = { memoryId: 'memory-a', receiptId: 'receipt-a', role: 'user',
    excerpt: 'synthetic forbidden source' };
  assert.equal(forbiddenSourceReturned([{ memory: { id: 'memory-a' }, receipts: [] }], forbidden), true);
  assert.equal(forbiddenSourceReturned([{ memory: { id: 'other' }, receipts: [{ id: 'receipt-a',
    role: 'user', excerpt: 'synthetic forbidden source' }] }], forbidden), true);
  assert.equal(forbiddenSourceReturned([{ memory: { id: 'other' }, receipts: [{ id: 'other-receipt',
    role: 'user', excerpt: 'different source' }] }], forbidden), false);
});

test('real counter guard, post-collection failure and watchdog clean owned scratch', t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-retained-faults-' });
  const counter = run(workspace, 300, '--fault=counter-limit');
  assert.equal(counter.status, 1);
  assert.equal(counter.stdout, '');
  assert.match(counter.stderr, /resource_nonfit_counter/u);
  const afterCollection = run(workspace, 300, '--fault=after-collection');
  assert.equal(afterCollection.status, 1);
  assert.equal(afterCollection.stdout, '');
  assert.match(afterCollection.stderr, /retained_window_control_failed/u);
  const watchdog = run(workspace, 3, '--fault=hold');
  assert.equal(watchdog.status, 124);
  assert.equal(watchdog.stdout, '');
  assert.match(watchdog.stderr, /retained_window_hold_ready/u);
  const cleanup = run(workspace, 300, '--fault=cleanup');
  assert.equal(cleanup.status, 1);
  assert.equal(cleanup.stdout, '');
  assert.match(cleanup.stderr, /retained_window_report_ready/u);
  assert.match(cleanup.stderr, /retained_window_cleanup_failed/u);
  assert.ok(cleanup.stderr.indexOf('retained_window_report_ready') <
    cleanup.stderr.indexOf('retained_window_cleanup_failed'));
});
