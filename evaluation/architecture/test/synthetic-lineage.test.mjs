import assert from 'node:assert/strict';
import test from 'node:test';

const supportsSqlite = Number(process.versions.node.split('.')[0]) >= 22
  && (Number(process.versions.node.split('.')[0]) > 22
    || Number(process.versions.node.split('.')[1]) >= 16);

test('fixed synthetic lineage uses real capture, recall, and answer packing',
  { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' }, async () => {
    const { runSyntheticLineage } = await import('../synthetic-lineage.mjs');
    const report = await runSyntheticLineage();
    assert.equal(report.synthetic, true);
    assert.equal(report.semanticAccuracy, 'not-measured');
    assert.equal(report.reportVersion, 'synthetic-evidence-lineage-v1');
    assert.equal(report.scenarios.length, 7);
    const byName = Object.fromEntries(report.scenarios.map(item => [item.scenario, item]));
    const source = name => byName[name].sources[0];
    assert.equal(byName['extraction-omission'].observations.capture, 1);
    assert.deepEqual(byName['extraction-omission'].sources.map(item => item.extraction), ['proposed', 'omitted']);
    assert.equal(byName['extraction-omission'].sources[1].admission, 'none');
    assert.equal(byName['extraction-omission'].sources[1].visible, 'unknown');

    assert.equal(byName['extraction-unavailable'].status, 'failed');
    assert.equal(byName['extraction-unavailable'].observations.extract, 1);
    assert.equal(source('extraction-unavailable').extraction, 'unknown');
    assert.equal(source('extraction-unavailable').admission, 'unknown');
    assert.equal(source('extraction-unavailable').returned, 'unknown');

    assert.equal(byName['admitted-unfiled'].status, 'failed');
    assert.equal(byName['admitted-unfiled'].reason, 'ingestion_incomplete');
    assert.equal(source('admitted-unfiled').admission, 'admitted');
    assert.equal(source('admitted-unfiled').filing, 'unfiled');
    assert.equal(byName['admitted-unfiled'].observations.recall, 0);
    assert.equal(source('admitted-unfiled').returned, 'unknown');

    assert.equal(source('visible-unselected').visible, 'yes');
    assert.equal(source('visible-unselected').selected, 'no');
    assert.equal(source('visible-unselected').rankInput, 'unknown');
    assert.equal(source('visible-unselected').returned, 'no');

    assert.equal(source('selected-rank-rejected').selected, 'yes');
    assert.equal(source('selected-rank-rejected').rankInput, 'yes');
    assert.equal(source('selected-rank-rejected').rankOutput, 'no');
    assert.equal(source('selected-rank-rejected').returned, 'no');

    for (const field of ['visible', 'selected', 'rankInput', 'rankOutput', 'returned', 'packed']) {
      assert.equal(source('source-delivered')[field], 'yes', field);
    }
    const packed = byName['packing-omission'];
    assert.equal(packed.status, 'completed');
    assert.equal(packed.memoryCount, 2);
    assert.deepEqual(packed.sources.map(item => item.returned), ['yes', 'yes']);
    assert.deepEqual(packed.sources.map(item => item.packed).sort(), ['no', 'yes']);
    assert.ok(report.scenarios.every(item => item.overflow === false));
  });

test('report has no raw content or identifiers and repeated runs are independent',
  { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' }, async () => {
    const { runSyntheticLineage } = await import('../synthetic-lineage.mjs');
    const first = await runSyntheticLineage();
    const second = await runSyntheticLineage();
    assert.deepEqual(first, second);
    assert.deepEqual(Object.keys(first).sort(), ['reportVersion', 'scenarios', 'semanticAccuracy', 'synthetic']);
    const scenarioNames = new Set(['extraction-omission', 'extraction-unavailable',
      'admitted-unfiled', 'visible-unselected', 'selected-rank-rejected',
      'source-delivered', 'packing-omission']);
    const statuses = new Set(['yes', 'no', 'unknown']);
    for (const scenario of first.scenarios) {
      assert.deepEqual(Object.keys(scenario).sort(), ['memoryCount', 'observations', 'overflow',
        'reason', 'scenario', 'sourceCount', 'sources', 'status']);
      assert.ok(scenarioNames.has(scenario.scenario));
      assert.ok(['completed', 'failed', 'blocked', 'unknown'].includes(scenario.status));
      assert.ok([null, 'ingestion_incomplete', 'recall_failed', 'context_window_exceeded',
        'full_history_context_window_exceeded', 'other'].includes(scenario.reason));
      assert.ok(Number.isSafeInteger(scenario.sourceCount) && scenario.sourceCount <= 4);
      assert.ok(Number.isSafeInteger(scenario.memoryCount) && scenario.memoryCount <= 5);
      assert.equal(typeof scenario.overflow, 'boolean');
      assert.equal(scenario.sources.length, scenario.sourceCount);
      assert.deepEqual(Object.keys(scenario.observations).sort(), ['answer', 'capture', 'extract',
        'rank', 'recall', 'select']);
      for (const count of Object.values(scenario.observations)) {
        assert.ok(Number.isSafeInteger(count) && count >= 0 && count <= 8);
      }
      for (const row of scenario.sources) {
        assert.deepEqual(Object.keys(row).sort(), ['admission', 'extraction', 'filing',
          'packed', 'rankInput', 'rankOutput', 'returned', 'selected', 'source', 'visible']);
        assert.ok(Number.isSafeInteger(row.source) && row.source >= 1 && row.source <= 4);
        assert.ok(['proposed', 'omitted', 'unknown'].includes(row.extraction));
        assert.ok(['admitted', 'none', 'unknown'].includes(row.admission));
        assert.ok(['filed', 'unfiled', 'unknown'].includes(row.filing));
        for (const field of ['visible', 'selected', 'rankInput', 'rankOutput', 'returned', 'packed']) {
          assert.ok(statuses.has(row[field]));
        }
      }
    }
    const printed = JSON.stringify(first);
    for (const forbidden of ['Amber ledger', 'Blue ledger', 'What does the ledger', 'memory.sqlite',
      'synthetic-classification-failure', 'lme-turn-', 'lme-case-', 'lme-session-', 'cairn-lineage-']) {
      assert.equal(printed.includes(forbidden), false, forbidden);
    }
    assert.match(printed, /"semanticAccuracy":"not-measured"/u);
  });
