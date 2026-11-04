import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { measureContentRead } from '../testing/content-safety-cost-meter.mjs';

test('cost meter counts executions prepared before the measurement window', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const retained = db.prepare('SELECT 1 AS n'); retained.get();
    const measure = extra => measureContentRead('synthetic', 'retained', () => { retained.get(); if (extra) retained.get(); });
    const baseline = await measure(false), mutant = await measure(true);
    assert.equal(baseline.statements, 1); assert.equal(mutant.statements, 2);
    assert.equal(mutant.statements - baseline.statements, 1, 'one extra retained execution changes the count');
    assert.equal(baseline.begin, 0); assert.equal(mutant.begin, 0);
  } finally { db.close(); }
});

test('public topic snapshot retained-statement mutation changes every reported snapshot count', () => {
  const probe = fileURLToPath(new URL('../testing/content-safety-s2h-topic-cost-probe.mjs', import.meta.url));
  const run = mutation => {
    const child = spawnSync(process.execPath, [probe, '18', '12', '0', 'match', ...(mutation ? ['retained-statement-mutation'] : [])], { encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(child.status, 0, child.stderr + child.stdout.slice(-5000));
    return child.stdout.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line)).filter(row => row.tag !== 'R3_NATIVE_CELL');
  };
  const baseline = run(false), mutant = run(true);
  assert.equal(baseline.length, 6); assert.equal(mutant.length, 6);
  let changed = 0;
  for (const [i, row] of baseline.entries()) {
    const snapshots = row.sql.filter(([sql]) => sql.startsWith('SELECT active_generation FROM namespace_index_state')).reduce((n, [, count]) => n + count, 0);
    assert.equal(mutant[i].begin, row.begin);
    assert.equal(mutant[i].statements - row.statements, snapshots, row.variant);
    if (snapshots) changed++;
  }
  assert.ok(changed >= 4, 'legacy and opt-in overview pages count their retained snapshot statements');
  assert.equal(baseline[0].statements, 63); assert.equal(mutant[0].statements, 66);
});
