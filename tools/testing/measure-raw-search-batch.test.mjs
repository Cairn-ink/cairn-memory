import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { sourceFixture, ns } from '../../core/testing/raw-source-fixtures.mjs';
import { rawPreparationMode, preparationMemoryPopulations, seedPreparationMemories, observeReceiptAncestry } from './raw-search-prepare-cost.mjs';
import { measureRawSearch } from './measure-raw-search.mjs';
import { RAW_SEARCH_TARGETS } from '../../core/test/raw-search-performance.test.mjs';

test('preparation modes retain the single default and include a large batch Memory population', () => {
  assert.equal(rawPreparationMode('single'), 'single'); assert.equal(rawPreparationMode('batch'), 'batch');
  assert.throws(() => rawPreparationMode('unknown'));
  assert.deepEqual(preparationMemoryPopulations('single', undefined), [0]);
  const counts = preparationMemoryPopulations('batch', undefined);
  assert.ok(counts.length >= 2); assert.ok(counts[0] < counts.at(-1)); assert.ok(counts.at(-1) >= 20000);
  assert.deepEqual(preparationMemoryPopulations('batch', '4,8'), [4, 8]);
  for (const value of ['-1', '1,1', 'NaN', '1.5']) assert.throws(() => preparationMemoryPopulations('batch', value));
});

for (const count of [4, 8]) test(`ancestry observer distinguishes returned rows from ${count} visited Memories`, async t => {
  const f = sourceFixture(t);
  assert.equal(seedPreparationMemories(f.db, ns, count), count);
  assert.equal(f.db.prepare('SELECT count(*) n FROM receipts').get().n, count);
  let initial = true;
  const original = DatabaseSync.prototype.prepare, observer = observeReceiptAncestry({ initialSnapshot: () => initial });
  try {
    const sql = `SELECT r.id,r.session_id FROM receipts r JOIN memories m ON m.id=r.memory_id
      WHERE m.owner_id=? AND m.scope=? AND m.project_id=? AND r.client=? AND r.event_id=?
      AND NOT EXISTS(SELECT 1 FROM raw_receipt_lineage l WHERE l.receipt_id=r.id AND l.conversation_id=? AND l.message_id=?) LIMIT 1025`;
    const query = () => f.db.prepare(sql).all(ns.ownerId, ns.scope, '', 'codex', 'synthetic-missing', 'synthetic-conversation', 'synthetic-message');
    await observer.run('batch', async () => { assert.deepEqual(query(), []); initial = false; assert.deepEqual(query(), []); });
    await observer.run('single', async () => assert.deepEqual(query(), []));
    await assert.rejects(observer.run('batch', async () => { throw Error('synthetic failure'); }));
    const result = observer.finish();
    assert.equal(result.batch.statements, 2); assert.equal(result.single.statements, 1);
    assert.equal(result.batch.returnedRows, 0); assert.equal(result.batch.visitedMemoryRows, count * 2);
    assert.equal(result.single.visitedMemoryRows, count); assert.equal(result.batch.distinctLookups, 1);
    assert.deepEqual(result.batch.initialSnapshot, { statements: 1, returnedRows: 0, visitedMemoryRows: count, distinctLookups: 1 });
    assert.equal(result.single.initialSnapshot.statements, 0);
    assert.ok(result.batch.plans.flat().some(row => row.includes('index_memory_keyset')));
  } finally { observer.close(); }
  assert.equal(DatabaseSync.prototype.prepare, original);
});

// Explicitly separate a functional smoke from the quiet-machine timing run.
// Sampling dimensions change; all frozen thresholds and gate code are reused.
test('opt-in small batch and single harness smoke', {
  skip: process.env.CAIRN_RAW_MEASURE_SMOKE !== '1', timeout: 120000,
}, async t => {
  assert.notEqual(process.env.CAIRN_MEASURE_RAW_SEARCH, '1', 'smoke must not enable the full timing run');
  const keys = ['CAIRN_RAW_MEASURE_MODE', 'CAIRN_RAW_MEASURE_MEMORIES', 'CAIRN_RAW_MEASURE_TURNS'];
  const previous = keys.map(key => process.env[key]);
  t.after(() => keys.forEach((key, index) => {
    if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index];
  }));
  process.env.CAIRN_RAW_MEASURE_MEMORIES = '4,8'; process.env.CAIRN_RAW_MEASURE_TURNS = '3';
  const targets = { ...RAW_SEARCH_TARGETS, sizes: [3], warmupSearches: 1, searchSamples: 1, captureSamples: 2 };
  const originalPrepare = DatabaseSync.prototype.prepare, originalExec = DatabaseSync.prototype.exec;
  for (const mode of ['single', 'batch']) {
    process.env.CAIRN_RAW_MEASURE_MODE = mode;
    const reports = [];
    const diagnostics = { diagnostic(value) {
      const report = JSON.parse(value);
      if (report.scenario) reports.push(report);
      t.diagnostic(value);
    } };
    try { assert.deepEqual(await measureRawSearch(diagnostics, targets), reports); }
    catch (error) {
      // This is a functional smoke on a shared machine. The harness still
      // executes and reports its unchanged timing gates; preserve that signal
      // without presenting these tiny samples as timing qualification.
      assert.equal(error.code, 'ERR_ASSERTION'); assert.match(error.message, /frozen performance targets/);
      const timing = new Set(['warm_search_api', 'full_read', 'canonical_section', 'capture_contention',
        'capture_overlap_unobserved', 'contended_canonical_section']);
      assert.ok(error.actual.length && error.actual.every(name => timing.has(name)), 'functional failures still fail smoke');
      t.diagnostic(JSON.stringify({ smokeTimingFailures: error.actual, mode }));
    }
    assert.equal(reports.length, 2); assert.deepEqual(reports.map(report => report.preparationCost.memoryPopulation), [4, 8]);
    for (const report of reports) {
      assert.equal(report.mode, mode); assert.equal(report.prepare.samples, 1);
      const cost = report.preparationCost, holds = cost.writerVisibleHold[mode];
      assert.ok(holds.initialSnapshot.samples > 0); assert.ok(holds.initialSnapshot.max >= holds.initialSnapshot.p95);
      const ancestry = cost.receiptAncestry[mode];
      assert.ok(ancestry.statements > 0); assert.equal(ancestry.returnedRows, 0);
      assert.equal(ancestry.visitedMemoryRows, ancestry.statements * cost.memoryPopulation);
      assert.equal(cost.writerVisibleHold.single.initialSnapshot.samples, cost.preparedRanges.max);
      if (mode === 'batch') {
        assert.equal(holds.initialSnapshot.samples, 1); assert.equal(cost.preparedCandidates.max, 3);
        assert.equal(cost.singlePrepare.samples, 3); assert.equal(cost.singlePrepareGroup.samples, 1);
        assert.ok(cost.writerVisibleHold.single.initialSnapshot.samples >= 3);
        assert.ok(cost.receiptAncestry.single.statements > 0);
        assert.ok(ancestry.initialSnapshot.statements > 0);
        assert.equal(ancestry.initialSnapshot.visitedMemoryRows, ancestry.initialSnapshot.statements * cost.memoryPopulation);
        assert.ok(ancestry.initialSnapshot.statements < ancestry.statements, 'later guards are counted separately');
      }
    }
    assert.equal(DatabaseSync.prototype.prepare, originalPrepare); assert.equal(DatabaseSync.prototype.exec, originalExec);
  }
});
