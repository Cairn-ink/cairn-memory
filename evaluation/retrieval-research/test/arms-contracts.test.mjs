import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import * as fixtureAPI from '../lib/fixture.mjs';
import { createBM25, collapseMemories } from '../lib/bm25.mjs';
import { createTrigram } from '../lib/fts5-trigram.mjs';
import { createDenseIndex } from '../lib/embed-local.mjs';
import { createArm } from '../lib/arms.mjs';
import { fuse, CONFIRMATORY } from '../lib/fusion.mjs';
import { createA0Store } from '../lib/a0-core.mjs';
import { loadSelection, runRankings } from '../run.mjs';
import { runLatency } from '../latency.mjs';
import { document, toyFixture, fakeEmbedder } from './fixtures-arms/toy.mjs';

const ARMS = ['A0-default', 'A0-paged', 'A0b', 'A1', 'A1+', 'A1t', 'A2', 'A3', 'F-RRF60', 'F-RRF10', 'F-MM', 'A5-spans', 'A5-both'];
const apiFor = fixture => ({ ...fixtureAPI, async loadFixture() { return fixture; } });
const options = (workspace, extra = {}) => ({ fixtureDir: workspace.path, split: 'dev', scale: 'S300', arms: ['A1'],
  models: ['e5-small'], out: join(workspace.path, 'out.json'), cacheDir: join(workspace.path, 'cache'),
  storeDir: join(workspace.path, 'stores'), threads: 1, ...extra });
const selection = extra => ({ format: 'hr1-selection-v1', sourceSplit: 'dev', scale: 'S1000', status: 'ready',
  easeCheck: { saturated: false }, comparator: { arm: 'A1' }, nominated: { local: { model: 'e5-small', menu: 'A3' } },
  fixtureHashes: { toy: 'synthetic' }, ...extra });

for (const arm of ARMS) test(`${arm}: test rankings and timing require selection before any fixture read`, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr1-selection-' });
  let reads = 0;
  const dependencies = { fixtureAPI: { async loadFixture() { reads++; throw new Error('must not read fixture'); } } };
  const opts = options(workspace, { split: 'test', arms: [arm] });
  for (const run of [runRankings, runLatency]) await assert.rejects(run(opts, dependencies), /^Error: frozen_selection_required$/);
  assert.equal(reads, 0);
  assert.equal((await loadSelection({ ...opts, split: 'dev' })).selection, null);
});

test('every test arm rejects non-ready or malformed selections, while dev has no readiness gate', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr1-selection-state-' });
  const path = join(workspace.path, 'selection.json');
  for (const candidate of [selection({ status: 'inconclusive' }), selection({ status: undefined }),
    selection({ easeCheck: { saturated: true } }), selection({ easeCheck: undefined }),
    selection({ format: 'invented' }), selection({ sourceSplit: 'test' }),
    selection({ comparator: undefined }), selection({ fixtureHashes: undefined })]) {
    await writeFile(path, JSON.stringify(candidate));
    for (const arm of ARMS) for (const run of [runRankings, runLatency])
      await assert.rejects(run(options(workspace, { split: 'test', arms: [arm], selectionPath: path })), /selection/);
  }
  await writeFile(path, JSON.stringify(selection({ status: 'inconclusive' })));
  assert.equal((await loadSelection(options(workspace, { selectionPath: path }))).lexical, 'A1');
});

test('ready selection authorizes baseline test rankings and timing, and hashes remain mandatory', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr1-selection-ready-' });
  const fixture = toyFixture(); fixture.split['hidden-family'] = 'test';
  const path = join(workspace.path, 'selection.json');
  await writeFile(path, JSON.stringify(selection()));
  const opts = options(workspace, { split: 'test', selectionPath: path });
  const rankings = await runRankings(opts, { fixtureAPI: apiFor(fixture) });
  assert.equal(rankings.outputs[0].run.status, 'complete');
  const timing = await runLatency({ ...opts, out: join(workspace.path, 'timing.json') }, { fixtureAPI: apiFor(fixture) });
  assert.equal(timing.runs[0].failures, 0);
  await writeFile(path, JSON.stringify(selection({ fixtureHashes: { toy: 'changed' } })));
  for (const run of [runRankings, runLatency])
    await assert.rejects(run(opts, { fixtureAPI: apiFor(fixture) }), /selection_fixture_hash_mismatch/);
});

test('max aggregation selects highest score then smallest document ID before top-k', () => {
  const rows = [
    { memoryId: 'm', docId: 'm#s2', score: 2 }, { memoryId: 'm', docId: 'm#s1', score: 2 },
    { memoryId: 'm', docId: 'm#body', score: 1 }, { memoryId: 'n', docId: 'n#body', score: 1 },
  ];
  assert.deepEqual(collapseMemories(rows, 1), [{ memoryId: 'm', docId: 'm#s1', score: 2 }]);
  assert.deepEqual(collapseMemories([...rows].reverse()), collapseMemories(rows));
});

test('BM25, trigram and dense indexes retain body/span identity on equal scores regardless of input order', async () => {
  const docs = [document('m', 'amber', 'span', 'm#s2'), document('m', 'amber', 'span', 'm#s1'), document('m', 'amber')];
  for (const build of [async input => createBM25(input), async input => createTrigram(input),
    async input => createDenseIndex(input, fakeEmbedder())]) {
    const first = await build(docs), reversed = await build([...docs].reverse());
    try {
      const a = await first.search('amber'), b = await reversed.search('amber');
      assert.deepEqual(a, b); assert.equal(a[0].docId, 'm#body');
    } finally { first.close?.(); reversed.close?.(); }
  }
});

test('fusion carries retained per-channel winners, independently of final fused rank', () => {
  const lex = [{ memoryId: 'm', docId: 'm#body', score: 5 }, { memoryId: 'n', docId: 'n#s1', score: 3 }];
  const sem = [{ memoryId: 'm', docId: 'm#s2', score: 0.9 }, { memoryId: 'outside', docId: 'outside#s1', score: 0.1 }];
  for (const config of Object.values(CONFIRMATORY)) {
    const result = fuse(lex, sem, { ...config, depth: 1 });
    assert.deepEqual(result.winningDocs, { lex: { m: 'm#body' }, sem: { m: 'm#s2' } });
    assert.deepEqual(result.channelScores, { lex: { m: 5 }, sem: { m: 0.9 } });
  }
});

test('A5 distinguishes a winning body, unrelated span and required span across lexical and semantic channels', async () => {
  const docs = [document('m', 'amber amber'), document('m', 'blue', 'span', 'm#unrelated'),
    document('m', 'amber cedar note', 'span', 'm#required')];
  for (const requiredWins of [false, true]) {
    const embedder = { async embed(texts, { kind } = {}) { return texts.map(text => {
      if (kind === 'query') return [1, 0];
      if (text === 'amber amber') return [0, 1];
      return text === (requiredWins ? 'amber cedar note' : 'blue') ? [1, 0] : [0.8, 0.6];
    }); } };
    const arm = await createArm({ arm: 'A5-both', documents: docs, embedder });
    try {
      const result = await arm.search({ text: 'amber', intent: 'current' });
      assert.deepEqual(result.ranked, ['m']);
      assert.equal(result.winningDocs.lex.m, 'm#body');
      assert.equal(result.winningDocs.sem.m, requiredWins ? 'm#required' : 'm#unrelated');
      assert.equal(result.channelScores.sem.m, 1);
      assert.equal(Object.hasOwn(result, 'scores'), false);
    } finally { arm.close(); }
  }
});

test('all arm artifacts include score and winning-document maps for C8 and FOREIGN queries', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr1-diagnostics-' }), fixture = toyFixture();
  fixture.queries.queries.push(
    { id: 'q-c8', text: 'zzzzmissing', intent: 'current', family: 'hidden-family', category: 'C8' },
    { id: 'q-foreign', text: '資料庫', intent: 'current', family: 'hidden-family', category: 'FOREIGN' });
  const path = join(workspace.path, 'selection.json'); await writeFile(path, JSON.stringify(selection()));
  const output = await runRankings(options(workspace, { arms: ARMS, selectionPath: path }),
    { fixtureAPI: apiFor(fixture), embedderFactory: () => fakeEmbedder() });
  for (const file of output.files) {
    const rankings = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(rankings.run.status, 'complete');
    for (const result of Object.values(rankings.queries)) {
      assert.equal(Object.hasOwn(result, 'scores'), false);
      assert.ok(Object.keys(result.channelScores).length > 0);
      for (const [channel, scores] of Object.entries(result.channelScores)) {
        const retained = result.channels?.[channel] ?? result.ranked;
        assert.deepEqual(Object.keys(scores), retained);
        assert.deepEqual(Object.keys(result.winningDocs[channel]), retained);
        for (const id of retained) {
          assert.ok(Number.isFinite(scores[id]));
          assert.equal(typeof result.winningDocs[channel][id], 'string');
          assert.ok(result.winningDocs[channel][id].startsWith(`${id}#`));
        }
      }
      if (!rankings.run.arm.startsWith('A5-')) for (const winners of Object.values(result.winningDocs))
        assert.ok(Object.values(winners).every(docId => docId.endsWith('#body')));
    }
  }
});

test('A0 retains public selector scores and projected body IDs during UUID translation', () => {
  const docs = [document('m-a', 'amber deploy', 'body', 'opaque-body-a'), document('m-b', 'amber', 'body', 'opaque-body-b')];
  const spans = docs.map(doc => document(doc.memoryId, doc.text, 'span'));
  const store = createA0Store({ history: docs, current: docs, spans });
  try {
    for (const paged of [false, true]) {
      const result = store.search({ text: 'amber deploy', intent: 'current' }, { paged });
      assert.deepEqual(result.ranked, ['m-a', 'm-b']);
      assert.deepEqual(result.channelScores, { lex: { 'm-a': 2, 'm-b': 1 } });
      assert.deepEqual(result.winningDocs, { lex: { 'm-a': 'opaque-body-a', 'm-b': 'opaque-body-b' } });
    }
  } finally { store.close(); }
});
