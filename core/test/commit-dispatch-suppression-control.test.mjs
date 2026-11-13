import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

test('negative control: skipping the bound source guard rerun fails the directed receipt test', t => {
  const w = createTestWorkspace(t, { prefix: 'suppression-control-' });
  const root = new URL('../../', import.meta.url);
  for (const path of ['core', 'tools/testing', 'plugins/cairn-memory/lib']) {
    const target = join(w.path, path); mkdirSync(target, { recursive: true });
    cpSync(new URL(path, root), target, { recursive: true });
  }
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
  const child = spawnSync(process.execPath, ['tools/testing/run.mjs', '--test-name-pattern=^receipt:',
    'core/test/commit-dispatch-suppression.test.mjs'], { cwd: w.path, encoding: 'utf8', timeout: 60000 });
  assert.equal(child.signal, null, child.stderr);
  assert.equal(child.status, 1, child.stdout + child.stderr);
  assert.match(child.stdout + child.stderr, /R2K_RECEIPT_GUARD_RERUN/);
  t.diagnostic('source guard bypass: child rc=1, R2K_RECEIPT_GUARD_RERUN observed');
});
