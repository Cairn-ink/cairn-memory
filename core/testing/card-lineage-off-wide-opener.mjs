// Reviewed opener data supplements archive reconstruction, never SQL filtering.
import assert from 'node:assert/strict';
import { normalizeSQL, workloadKeys } from './card-lineage-off-wide-compare.mjs';

export function validateOpenerData(data) {
  const probe = data.openerProbes;
  assert.deepEqual(Object.keys(probe.counts).sort(), ['open:23', 'open:33', 'workload:23', 'workload:33']);
  for (const row of [...probe.sqlAdditions.map(entry => entry.statement), probe.anchorBefore, probe.anchorAfter])
    assert.ok(Array.isArray(row) && row.length === 3 && row[0] === normalizeSQL(row[0]) &&
      ['exec', 'get', 'iterate'].includes(row[1]) && Array.isArray(row[2]) && row[2].length === 0, 'full unbound opener statement row');
  assert.deepEqual(probe.sqlAdditionMethods, ['open', 'openRawCaptureCore']);
  assert.deepEqual(probe.anchorBefore, ['PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF;', 'exec', []]);
  assert.deepEqual(probe.anchorAfter, ['BEGIN IMMEDIATE', 'exec', []]);
  for (const [key, count] of Object.entries(probe.counts)) {
    assert.ok(Number.isInteger(count) && count > 0);
    const entries = probe.sqlAdditions.filter(entry => entry.key === key);
    assert.equal(entries.length, count * 5, 'five literal statement rows for every archived opener');
    assert.deepEqual([...new Set(entries.map(entry => entry.index))], data.archivedOpeners[key], 'probe indexes cover precisely the archived openers');
    for (const index of data.archivedOpeners[key]) {
      const group = entries.filter(entry => entry.index === index);
      assert.equal(group.length, 5, 'each literal probe group has exactly five rows');
      assert.deepEqual(group[0].statement, ['BEGIN', 'exec', []]);
      assert.deepEqual(group.at(-1).statement, ['ROLLBACK', 'exec', []]);
      assert.ok(group.every(entry => entry.method === group[0].method && entry.ordinal === group[0].ordinal && entry.after === group[0].after), 'one call anchor per probe group');
    }
  }
  for (const entry of probe.sqlAdditions) assert.ok(Object.hasOwn(probe.counts, entry.key) &&
    probe.sqlAdditionMethods.includes(entry.method) && entry.ordinal === 1 && entry.after === 0 &&
    Number.isInteger(entry.index) && entry.index > 0, 'literal opener method, ordinal and anchor');
  assert.deepEqual(data.sqlRevisions, ['open:52', 'open:53', 'workload:52', 'workload:53'].flatMap(key =>
    data.archivedOpeners[key].map(index => ({ key, index, old: 'BEGIN IMMEDIATE', new: 'BEGIN' }))),
  'only the five listed suppression-revision openers are revised');
  assert.deepEqual(Object.keys(data.archivedOpeners).sort(), [...workloadKeys, 'open:23', 'open:33', 'open:52', 'open:53'].sort());
  assert.deepEqual(Object.keys(data.currentSql).sort(), Object.keys(data.archivedOpeners).sort());
  assert.deepEqual(Object.keys(data.currentCensus).sort(), Object.keys(data.archivedOpeners).sort());
}

export function assertArchivedOpeners(key, archived, data) {
  const indexes = archived.statements.flatMap((row, index) => index > 0 &&
    JSON.stringify(row) === JSON.stringify(data.openerProbes.anchorAfter) &&
    JSON.stringify(archived.statements[index - 1]) === JSON.stringify(data.openerProbes.anchorBefore) ? [index] : []);
  assert.deepEqual(indexes, data.archivedOpeners[key], `${key} literal archived opener census`);
}

// Keep the archive's result/table/effect pins. Only the explicitly inserted
// block changes offsets/counts; each resulting SQL hash is separately reviewed.
export function currentOpenerPins(key, frozen, data) {
  const pinned = structuredClone(frozen);
  const entries = data.openerProbes.sqlAdditions.filter(entry => entry.key === key);
  for (const call of pinned.calls) for (let field = 2; field < call.length; field++)
    if (call[field] !== null) call[field] += entries.filter(entry => entry.index <= call[field]).length;
  pinned.statements += entries.length;
  pinned.sql = data.currentSql[key];
  return pinned;
}

export function assertCurrentOpenerCensus(key, current, data) {
  assert.deepEqual(Object.fromEntries(['BEGIN', 'BEGIN IMMEDIATE', 'COMMIT', 'ROLLBACK'].map(sql =>
    [sql, current.statements.filter(([text]) => text === sql).length])), data.currentCensus[key], `${key} executed SQL census`);
}
