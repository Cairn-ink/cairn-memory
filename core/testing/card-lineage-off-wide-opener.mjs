import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hash, normalizeSQL, reconstructWideTrace, reviseSQL, workloadKeys } from './card-lineage-off-wide-compare.mjs';

export const openerPins = JSON.parse(readFileSync(new URL('../test/fixtures/card-lineage-off-wide-opener.json', import.meta.url), 'utf8'));

export function run(source, path, mode, cell) {
  const worker = fileURLToPath(new URL('./card-lineage-off-wide-worker.mjs', import.meta.url));
  const child = spawnSync(process.execPath, [worker, source, path, mode, String(cell)],
    { encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(child.status, 0, child.error?.message ?? child.stderr);
  return JSON.parse(child.stdout);
}

export const callOffsetHash = calls => hash(calls.map(([method, , ...offsets]) => [method, ...offsets]));

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
    assert.equal(entries.length, count * 7, 'seven literal statement rows for every archived opener');
    assert.deepEqual([...new Set(entries.map(entry => entry.index))], data.archivedOpeners[key], 'probe indexes cover precisely the archived openers');
    for (const index of data.archivedOpeners[key]) {
      const group = entries.filter(entry => entry.index === index);
      assert.equal(group.length, 7, 'each literal probe group has exactly seven rows');
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
  assert.deepEqual(Object.keys(data.filtered).sort(), Object.keys(data.archivedOpeners).sort());
  assert.deepEqual(Object.keys(data.rawArchive).sort(), Object.keys(data.archivedOpeners).sort());
  for (const [key, { openers }] of Object.entries(data.filtered)) {
    assert.deepEqual(openers.map(({ archivedIndex }) => archivedIndex), data.archivedOpeners[key], `${key} pinned archive coordinates`);
  }
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
  // Main's frozen call ranges include its approved addition ledger. Resolve
  // each archive-anchored probe through its literal call before moving ranges.
  const positions = entries.map(entry => {
    const call = frozen.calls.filter(call => call[0] === entry.method)[entry.ordinal - 1];
    assert.ok(call, 'probe belongs to a frozen call');
    return (call[0] === 'open' && call[3] === null ? 0 : call[2]) + entry.after + 1;
  });
  for (const call of pinned.calls) for (let field = 2; field < call.length; field++)
    if (call[field] !== null) call[field] += positions.filter(position => position <= call[field]).length;
  pinned.statements += entries.length;
  pinned.sql = data.currentSql[key];
  return pinned;
}

// Restore the worker coordinates used by main's retirement and receipt pins.
export function filterOpenerTrace(key, current, data = openerPins) {
  const label = `211 opener filter ${key}`;
  const pin = data.filtered?.[key];
  assert.ok(pin, `${label}: cell has pre-211 pins`);
  const { anchorBefore, anchorAfter, sqlAdditions } = data.openerProbes;
  const edits = new Map();
  let removed = 0;
  for (const { index, method, ordinal, after, archivedIndex } of pin.openers) {
    const rows = sqlAdditions.filter(entry => entry.key === key && entry.index === archivedIndex).map(entry => entry.statement);
    const call = current.calls.filter(([name]) => name === method)[ordinal - 1];
    assert.ok(call && (call.length === 4 || method === 'open' && call.length === 3), `${label}: exact opener call`);
    const start = call.length === 4 ? call[2] : 0;
    const live = index + removed;
    assert.equal(live, start + after + 1, `${label}: pinned call-relative opener position`);
    assert.ok(live > start && live + rows.length < call.at(-1), `${label}: opener anchor and rows are inside their call`);
    assert.ok(!edits.has(live), `${label}: distinct opener anchors`);
    assert.deepEqual(current.statements[live - 1], anchorBefore, `${label}: exact SQL predecessor`);
    if (Object.hasOwn(data.openerProbes.counts, key)) {
      assert.equal(rows.length, 7, `${label}: exactly seven pinned probe rows`);
      assert.deepEqual(current.statements.slice(live, live + rows.length), rows, `${label}: exact probe SQL and bindings`);
      assert.deepEqual(current.statements[live + rows.length], anchorAfter, `${label}: exact writer BEGIN after the probe`);
      for (let cursor = live; cursor < live + rows.length; cursor++) edits.set(cursor, null);
      removed += rows.length;
    } else {
      assert.deepEqual(current.statements[live], ['BEGIN', 'exec', []], `${label}: exact deferred BEGIN`);
      edits.set(live, anchorAfter);
    }
  }
  const statements = [], offsets = [];
  for (const [index, row] of current.statements.entries()) {
    offsets.push(statements.length);
    const replacement = edits.has(index) ? edits.get(index) : row;
    if (replacement !== null) statements.push(replacement);
  }
  offsets.push(statements.length);
  const calls = current.calls.map(([method, result, ...range]) => [method, result, ...range.map(offset => offsets[offset])]);
  assert.equal(statements.length, pin.statements, `${label}: exact pre-211 statement count`);
  assert.equal(callOffsetHash(calls), pin.callOffsets, `${label}: exact pre-211 calls and offset mapping`);
  return { ...current, statements, calls };
}

export function reconstructOpenerTrace(key, filtered, data = openerPins) {
  const replacements = new Map(data.filtered[key].openers.map(({ archivedIndex, index }) => [archivedIndex, index]));
  const openerProbes = { ...data.openerProbes, sqlAdditions: data.openerProbes.sqlAdditions
    .filter(entry => entry.key === key).map(entry => ({ ...entry, index: replacements.get(entry.index) })) };
  const reconstructed = reconstructWideTrace(key, filtered, [], [], { openerProbes });
  const revisions = data.sqlRevisions.filter(entry => entry.key === key)
    .map(entry => ({ ...entry, index: replacements.get(entry.index) }));
  reviseSQL(key, reconstructed.statements, revisions);
  return reconstructed;
}

export function assertCurrentOpenerCensus(key, current, data) {
  assert.deepEqual(Object.fromEntries(['BEGIN', 'BEGIN IMMEDIATE', 'COMMIT', 'ROLLBACK'].map(sql =>
    [sql, current.statements.filter(([text]) => text === sql).length])), data.currentCensus[key], `${key} executed SQL census`);
}
