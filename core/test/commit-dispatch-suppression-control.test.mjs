import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

test('negative control: the receipt source guard discriminates with epoch seeding disabled', t => {
  const w = createTestWorkspace(t, { prefix: 'suppression-control-' });
  const root = new URL('../../', import.meta.url);
  for (const path of ['core', 'tools/testing', 'plugins/cairn-memory/lib']) {
    const target = join(w.path, path); mkdirSync(target, { recursive: true });
    cpSync(new URL(path, root), target, { recursive: true });
  }
  const run = () => spawnSync(process.execPath, ['tools/testing/run.mjs', '--test-name-pattern=^receipt:',
    'core/test/commit-dispatch-suppression.test.mjs'], { cwd: w.path, encoding: 'utf8', timeout: 60000 });
  const baseline = run();
  assert.equal(baseline.signal, null, baseline.stderr);
  assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
  t.diagnostic('unmutated receipt baseline: child rc=0');
  // Coordinator 11-14 D1 (i) with (iii): the epoch guard now refuses before
  // the source guard. Disable seeding in both copies, then isolate that guard.
  const epochs = join(w.path, 'core/content-suppression-storage.mjs');
  const epochSource = readFileSync(epochs, 'utf8'), seed = '  copy(account.epochs, parent);';
  assert.equal(epochSource.split(seed).length, 2);
  writeFileSync(epochs, epochSource.replace(seed, '  // Fault: discard the retained selection epochs.'));
  const receiptTest = join(w.path, 'core/test/commit-dispatch-suppression.test.mjs');
  const receiptSource = readFileSync(receiptTest, 'utf8');
  const expected = "      ? { ok: false, error: { code: 'evidence_unavailable', retryable: false } } : expected,";
  assert.equal(receiptSource.split(expected).length, 2);
  writeFileSync(receiptTest, receiptSource.replace(expected,
    "      ? { ok: false, error: { code: 'source_excluded', retryable: false } } : expected,"));
  const seedDisabled = run();
  assert.equal(seedDisabled.signal, null, seedDisabled.stderr);
  assert.equal(seedDisabled.status, 0, 'R2O5_SEED_DISABLED_BASELINE ' + seedDisabled.stdout + seedDisabled.stderr);
  t.diagnostic('seed-disabled receipt baseline, source guard intact: child rc=0');
  const file = join(w.path, 'core/runtime.mjs');
  const source = readFileSync(file, 'utf8');
  const anchor = '  const rawLineage = createRawLineageStorage(db);';
  assert.equal(source.split(anchor).length, 2);
  writeFileSync(file, "import { hasCommitDispatcher } from './commit-dispatch.mjs';\n" + source.replace(anchor, anchor + `
  // Fault: trust source preparation instead of rerunning admission guards.
  const originalSourceCheck = rawLineage.assertReceipts;
  rawLineage.assertReceipts = (...args) => hasCommitDispatcher(db) && db.isTransaction
    ? undefined : originalSourceCheck(...args);
`));
  const child = run();
  assert.equal(child.signal, null, child.stderr);
  assert.equal(child.status, 1, child.stdout + child.stderr);
  assert.match(child.stdout + child.stderr, /R2K_RECEIPT_GUARD_RERUN/);
  t.diagnostic('source guard bypass: child rc=1, R2K_RECEIPT_GUARD_RERUN observed');
});
