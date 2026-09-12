import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runMocRetrievalDiagnostic } from '../moc-retrieval-diagnostic.mjs';

test('real-core matrix separates stored evidence, page visibility and lexical retrieval', async t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'cairn-moc-matrix-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const report = await runMocRetrievalDiagnostic({ directory });
  assert.equal(report.providerRequests, 0);
  assert.match(report.model, /oracle/u);
  assert.match(report.counter, /synthetic/u);
  assert.equal(report.cases.length, 9);
  for (const entry of report.cases) {
    assert.equal(entry.status, 'observed', JSON.stringify({ id: entry.id, error: entry.error, recall: entry.recall }));
    assert.equal(entry.coldDirectReadSupported, true);
    assert.equal(entry.allTargetsInventoried, true);
    assert.equal(entry.fullInventoryCount, entry.size);
    assert.equal(entry.namespaceIsolated, true);
    assert.ok(entry.observations.filter(item => item.method === 'select').length <= 2);
    assert.ok(entry.observations.filter(item => item.method === 'rank').length <= 1);
    assert.ok(entry.targetRecalledCount <= entry.targetVisibleCount);
    assert.equal(entry.lexical.scannedDocuments, entry.size);
    assert.ok(entry.lexical.ids.length <= 12);
  }
  const at = id => report.cases.find(entry => entry.id === id);
  for (const id of ['english-late', 'english-misfiled', 'unfiled-behind-filed', 'multi-evidence-late']) {
    const entry = at(id);
    assert.equal(entry.targetVisibleCount, 0, id);
    assert.equal(entry.targetRecalledCount, 0, id);
    assert.ok(entry.targetMapPages.every(page => page > 2), id);
    assert.equal(entry.targetLexicalCount, entry.targets.length, id);
    assert.equal(entry.recall.value.coverage, 'budget_exhausted', id);
  }
  for (const id of ['english-small', 'english-early', 'chinese-spaced-control']) {
    assert.equal(at(id).targetRecalledCount, 1, id);
    assert.equal(at(id).targetLexicalCount, 1, id);
  }
  for (const id of ['chinese-contiguous', 'paraphrase-control']) {
    assert.equal(at(id).targetVisibleCount, 1, id);
    assert.equal(at(id).targetRecalledCount, 1, id);
    assert.equal(at(id).targetLexicalCount, 0, id);
  }
  assert.equal(report.classification[0].result.ok, true);
  assert.equal(report.classification[0].observations[0].mapExhausted, true);
  assert.equal(report.classification[1].observations[0].mocCount, 0);
  // Observe the bottleneck without requiring a separately delivered catalog fix
  // to preserve it. Incomplete catalogs must still reject speculative creation.
  const large = report.classification[1];
  if (large.observations[0].mapExhausted) {
    assert.equal(large.observations[0].mapItemCount, 0);
    assert.equal(large.result.ok, true);
  } else {
    assert.equal(large.result.ok, false);
    assert.equal(large.result.error.code, 'invalid_model_output');
  }
});

test('diagnostic refuses an occupied output directory before creating any store', async t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'cairn-moc-directory-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(path.join(directory, 'sentinel'), 'synthetic-preserve');
  await assert.rejects(runMocRetrievalDiagnostic({ directory }), /unsafe_diagnostic_directory/u);
});
