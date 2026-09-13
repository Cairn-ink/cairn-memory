import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
  assert.equal(report.cases.length, 10);
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
    assert.equal(entry.targetVisibleCount, entry.targets.length, id);
    assert.equal(entry.targetRecalledCount, entry.targets.length, id);
    // Public inventory order is not the query-aware recall candidate order.
    assert.ok(entry.targetMapPages.every(page => page > 2), id);
    assert.equal(entry.targetLexicalCount, entry.targets.length, id);
    assert.equal(entry.recall.value.coverage, 'budget_exhausted', id);
  }
  for (const id of ['english-small', 'english-early', 'chinese-spaced-control', 'unfiled-distractors']) {
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
  // Current classification uses a complete topic-only catalog, not memory bodies.
  const large = report.classification[1];
  assert.equal(large.observations[0].mapExhausted, true);
  assert.equal(large.observations[0].mapItemCount, 0);
  assert.equal(large.result.ok, true);
});

test('frozen historical matrix retains original prefix misses and catalog failure without rewriting evidence', () => {
  const bytes = readFileSync(new URL('../../../evaluations/results/moc-architecture-v1.json', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),
    '917068fadc720d665f167efb6190ab2ef8ec722fdcf74611275d80b6685da583');
  const report = JSON.parse(bytes);
  assert.equal(report.cases.length, 10);
  assert.equal(report.providerRequests, 0);
  for (const id of ['english-late', 'english-misfiled', 'unfiled-behind-filed', 'multi-evidence-late']) {
    const entry = report.cases.find(item => item.id === id);
    assert.equal(entry.targetVisibleCount, 0, id);
    assert.equal(entry.targetRecalledCount, 0, id);
    assert.ok(entry.targetMapPages.every(page => page > 2), id);
    assert.equal(entry.targetLexicalCount, entry.targets.length, id);
    assert.equal(entry.recall.value.coverage, 'budget_exhausted', id);
  }
  const large = report.classification.find(item => item.size === 101);
  assert.equal(large.observations[0].mapExhausted, false);
  assert.equal(large.result.ok, false);
  assert.equal(large.result.error.code, 'invalid_model_output');
});

test('diagnostic refuses an occupied output directory before creating any store', async t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'cairn-moc-directory-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(path.join(directory, 'sentinel'), 'synthetic-preserve');
  await assert.rejects(runMocRetrievalDiagnostic({ directory }), /unsafe_diagnostic_directory/u);
});
