import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { buildPlan, failureRecord, compare, diagnosticControl, PROTOCOL } from './measure-topic-reader-wal.mjs';
import { createTestWorkspace } from './workspace.mjs';

test('registered full matrix and smoke cover both modes, schemas, lifecycles and methods', () => {
  const full = buildPlan(), smoke = buildPlan(true);
  assert.equal(full.length, 200); assert.equal(smoke.length, 40);
  assert.ok(full.every(c => c.windowMs === 30000)); assert.ok(smoke.every(c => c.windowMs === 2000));
  assert.deepEqual([...new Set(full.map(c => c.repetition))], [0, 1, 2, 3, 4]);
  for (const cells of Map.groupBy(full, c => c.pair).values()) {
    assert.deepEqual(cells.map(c => c.variant).sort(), ['baseline', 'members', 'overview', 'zero-wait-members', 'zero-wait-overview']);
  }
  assert.equal(PROTOCOL.thresholds.hostLoopMaxMs, 100);
  assert.deepEqual(failureRecord({ ok: false, error: { code: 'storage_busy', diagnostics: {
    stage: 'prepare', statement: 'application_id', sqlite: { code: 5, extendedCode: 261 } } } }), {
    publicCode: 'storage_busy', stage: 'prepare', statement: 'application_id', errcode: 5, extendedCode: 261,
    errstr: 'database is locked', errstrSource: 'canonical-sqlite-primary-code' });
  assert.equal(failureRecord({ ok: false, error: { code: 'read_timeout' } }).errcode, null);
});
test('gates cover WAL production cells only; DELETE and smoke remain observations', () => {
  const base = { pair: 'one', journal: 'WAL', variant: 'baseline', reader: { successes: 1, storageBusy: 0, p95Ms: 12 },
    writer: { calls: 20, callsPerSecond: 10, failures: [], p95Ms: 8 }, hostLoopMaxMs: 11 };
  const trial = { ...base, variant: 'members', writer: { ...base.writer, callsPerSecond: 9 } };
  assert.equal(compare([base, trial], false)[1].gate, 'pass');
  assert.equal(compare([base, { ...trial, hostLoopMaxMs: 101 }], false)[1].gate, 'fail');
  assert.equal(compare([base, { ...trial, journal: 'DELETE' }], false)[1].gate, 'observation');
  assert.equal(compare([base, trial], true)[1].gate, 'observation');
});
test('diagnostic control changes only the WAL wait constant in a temporary reader closure', t => {
  const workspace = createTestWorkspace(t), dir = join(workspace.path, 'control');
  const control = diagnosticControl(dir);
  assert.deepEqual(control.inventory.filter(f => f.original !== f.control).map(f => f.file), ['core/topic-reader-sqlite.mjs']);
  assert.match(readFileSync(join(dir, 'core/topic-reader-sqlite.mjs'), 'utf8'), /TOPIC_WAL_WAIT_MS = 0;/);
});
