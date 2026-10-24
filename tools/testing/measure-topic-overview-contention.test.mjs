import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { createTestWorkspace } from './workspace.mjs';
import { installedImportClosure } from '../../packaging/test/fixtures/installed-import-closure.mjs';
import { buildTrialPlan, compareTrials, compactTable, createCandidate, inspectStore, latency,
  namespaces, openWriter, parseArgs, PROTOCOL, publicWrite, readerMetrics, seedStore } from './measure-topic-overview-contention.mjs';

test('measurement parsing fixes the full windows/repetitions and labels the only smoke subset', () => {
  assert.equal(parseArgs([]).smoke, false);
  assert.equal(dirname(parseArgs([]).report), process.cwd(), 'report survives the npm wrapper scratch cleanup');
  assert.equal(parseArgs(['--plan', '--report', '/tmp/synthetic-e1c.json']).plan, true);
  assert.equal(parseArgs(['--smoke']).smoke, true);
  assert.throws(() => parseArgs(['--window-ms', '2']));
  assert.throws(() => parseArgs(['--report']));
  const full = buildTrialPlan(), groups = Map.groupBy(full, cell => cell.pair);
  assert.equal(full.length, 190);
  assert.deepEqual([...new Set(full.map(cell => cell.repetition))], [0, 1, 2, 3, 4]);
  assert.ok(full.every(cell => cell.windowMs === 30000));
  for (const cells of groups.values()) {
    const expected = cells[0].writer === 'none' ? ['as-is', 'bounded'] : ['as-is', 'bounded', 'no-reader'];
    assert.deepEqual(cells.map(cell => cell.variant).sort(), expected);
  }
  assert.deepEqual(full.slice(0, 2).map(cell => cell.variant), ['as-is', 'bounded']);
  const odd = full.filter(cell => cell.repetition === 1);
  assert.equal(odd[0].journal, 'WAL');
  assert.deepEqual(odd.slice(0, 2).map(cell => cell.variant), ['bounded', 'as-is']);
  assert.ok(full.some(cell => cell.schema === 18));
  assert.ok(full.every(cell => cell.schema !== 18 || cell.writer !== 'raw'));
  assert.ok(buildTrialPlan({ schema18Available: false }).every(cell => cell.schema === 29));
  const smoke = buildTrialPlan({ smoke: true });
  assert.equal(smoke.length, 3);
  assert.ok(smoke.every(cell => cell.windowMs === 2000 && cell.repetition === 0 && cell.schema === 29 && cell.journal === 'DELETE'));
});

test('metrics parse every failure and baseline pairing independently of alternating order', () => {
  const reader = readerMetrics([{ elapsedMs: 4, complete: true, countsComplete: true },
    { elapsedMs: 250, code: 'storage_busy' }, { elapsedMs: 7, code: 'cursor_stale' }]);
  assert.equal(reader.attempts, 3); assert.equal(reader.storageBusyRate, 1 / 3);
  assert.deepEqual(reader.otherFailures, { cursor_stale: 1 });
  assert.equal(reader.p95Ms, 250); assert.equal(reader.completeOverviews, 1);
  assert.deepEqual(latency([]), { p50Ms: null, p95Ms: null, maxMs: null });
  const base = { pair: 'synthetic', schema: 29, journal: 'DELETE', writerKind: 'same-owner', repetition: 0,
    eventLoopDelay: null, companions: null, reader: readerMetrics([{ elapsedMs: 5, complete: true }]),
    writer: { commits: 40, commitsPerSecond: 40, p95Ms: 10, commitPaced: true, failures: [] } };
  const bounded = { ...base, variant: 'bounded', writer: { ...base.writer, commitsPerSecond: 36 } };
  const baseline = { ...base, variant: 'no-reader' };
  const paired = compareTrials([bounded, baseline]);
  assert.equal(paired[0].comparison.throughputRatio, .9); assert.equal(paired[0].gate.status, 'pass');
  assert.equal(compareTrials([bounded, baseline], true)[0].gate.status, 'observation');
  assert.equal(compareTrials([{ ...bounded, reader }, baseline])[0].gate.status, 'fail');
  assert.equal(compareTrials([{ ...bounded, writer: { ...base.writer, commits: 0, commitPaced: false } }, baseline])[0].gate.status, 'fail');
  assert.match(compactTable(paired), /29 DELETE same-owner bounded 1/);
});

for (const schema of [18, 29]) test(`physical schema${schema} fixture supports public writers and both real reader variants`, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'e1c-harness-functional-' });
  const path = join(workspace.path, 'synthetic.sqlite');
  assert.deepEqual(await seedStore(path, schema, { memories: 24, mocs: 12 }),
    { schema, memories: 24, mocs: 12, namespaces: 4, rawAvailable: schema === 29 });
  const core = await openWriter(path, 'same-owner');
  try {
    await publicWrite(core, 'same-owner', 0);
    await publicWrite(core, 'other-owner', 1);
  } finally { core.close(); }
  assert.equal((await inspectStore(path)).memories, 26);
  if (schema === 29) {
    const raw = await openWriter(path, 'raw');
    try { await publicWrite(raw, 'raw', 2); } finally { raw.close(); }
    assert.equal((await inspectStore(path)).schema, 29);
    assert.equal((await inspectStore(path)).memories, 27);
  }
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path, { timeout: 5000 });
  workspace.defer(() => db.close());
  const candidate = createCandidate(join(workspace.path, 'candidate'));
  assert.equal(candidate.patches.length, 3);
  assert.ok(candidate.patches.every(patch => patch.originalSha256 !== patch.candidateSha256));
  const entries = ['core/memory-reader.mjs', 'core/topic-overview-worker.mjs'];
  const originalGraph = installedImportClosure(fileURLToPath(new URL('../../', import.meta.url)), entries);
  assert.deepEqual(candidate.sources.map(source => source.file).sort(), originalGraph.required);
  const copiedGraph = installedImportClosure(dirname(dirname(fileURLToPath(candidate.readerUrl))), entries);
  assert.deepEqual(copiedGraph.required, [...originalGraph.required, 'core/measurement-database.mjs'].sort());
  const originalSource = readFileSync(new URL('../../core/read-database.mjs', import.meta.url), 'utf8');
  assert.match(originalSource, /busy_timeout=\$\{contextRead \? 5000 : 0\}/);
  for (const variant of ['as-is', 'bounded']) {
    const { openMemoryReader } = await import(variant === 'bounded' ? candidate.readerUrl : new URL('../../core/memory-reader.mjs', import.meta.url).href);
    const reader = openMemoryReader({ path, ownerId: namespaces[0].ownerId });
    workspace.defer(() => reader.close());
    const value = await reader.readTopicOverview({ namespace: namespaces[0] });
    assert.equal(value.ok, true, JSON.stringify(value));
    assert.equal(value.value.coverage.complete, true);
    assert.equal(value.value.totals.unique.total, schema === 29 ? 8 : 7);
    db.exec('BEGIN EXCLUSIVE');
    try {
      // Functional lock outcome only: NO duration, throughput, overlap or p95 assertion.
      assert.deepEqual(await reader.readTopicOverview({ namespace: namespaces[0] }), { ok: false, error: { code: 'storage_busy' } });
      const pending = reader.readTopicOverview({ namespace: namespaces[0] });
      await reader.close();
      assert.deepEqual(await pending, { ok: false, error: { code: 'store_closed' } });
    } finally { db.exec('ROLLBACK'); }
    await reader.close();
  }
  db.exec('PRAGMA journal_mode=WAL');
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  const walWriter = await openWriter(path, 'same-owner');
  try {
    await publicWrite(walWriter, 'same-owner', 3);
    assert.ok(readFileSync(path + '-wal').length >= 32);
    for (const url of [new URL('../../core/memory-reader.mjs', import.meta.url).href, candidate.readerUrl]) {
      const { openMemoryReader } = await import(url);
      const reader = openMemoryReader({ path, ownerId: namespaces[0].ownerId });
      try { assert.equal((await reader.readTopicOverview({ namespace: namespaces[0] })).ok, true); }
      finally { await reader.close(); }
    }
  } finally { walWriter.close(); }
});

test('candidate shares one remaining native wait budget across prepared statements and transactions', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'e1c-budget-functional-' });
  createCandidate(join(workspace.path, 'candidate'));
  const { measurementDatabase } = await import(pathToFileURL(join(workspace.path, 'candidate/core/measurement-database.mjs')).href);
  const sql = [], native = { exec: text => sql.push(text), prepare: () => ({ get: () => ({ n: 1 }) }) };
  let now = 0;
  globalThis.__measurementLockDeadline = PROTOCOL.candidateWaitMs;
  t.after(() => { delete globalThis.__measurementLockDeadline; });
  const db = measurementDatabase(native, { now: () => now });
  const statement = db.prepare('SELECT 1');
  now = 100; statement.get();
  now = 249.7; db.exec('COMMIT');
  now = 300; statement.get();
  globalThis.__measurementLockDeadline = 550;
  statement.get(); // A NEW request may get a new budget; SQL cannot reset it.
  assert.deepEqual(sql, ['PRAGMA busy_timeout=250', 'PRAGMA busy_timeout=150', 'PRAGMA busy_timeout=0', 'COMMIT', 'PRAGMA busy_timeout=250']);
});
