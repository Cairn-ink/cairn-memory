import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutFixture, seed, ns, key } from '../testing/recall-recency-fixture.mjs';
import { installRecallScanClock } from '../testing/recall-scan-clock.mjs';
import { createQueryExcerpt } from '../query-excerpt.mjs';
import { createQueryScore, SOURCE_QUERY_RECEIPT_LIMIT } from '../query-candidates.mjs';

for (const layout of ['plain', 53]) test(`final labels: layout ${layout} keeps floor work and signed boundaries unchanged`, async t => {
  const clock = installRecallScanClock(t);
  const f = await layoutFixture(t, layout);
  seed(f.db, 2304);
  const regular = createQueryExcerpt('note'), final = createQueryExcerpt('note', true);
  const floorCalls = [], finalCalls = [];
  const options = { score: createQueryScore('note'),
    memoryLabel(content) { floorCalls.push(content); return regular(content); },
    memoryLabelAfterScan(content, score) { finalCalls.push(content); return final(content, score); } };
  const result = f.runtime.queryCandidateRows(ns, options);
  const expected = f.db.prepare(`SELECT id,revision,content FROM index_read_memories
    WHERE owner_id=? AND scope=? AND project_id=? AND deleted=0
      AND review_state!='awaiting' AND currentness='current' ORDER BY id LIMIT 1024`)
    .all(ns.ownerId, ns.scope, ns.projectId).map(memory => ({ item: { type: 'unfiled',
      ref: { memoryId: memory.id, revision: memory.revision }, label: regular(memory.content) } }));
  assert.equal(JSON.stringify(result.rows), JSON.stringify(expected));
  assert.equal(result.scanBoundary.rows, 2304);
  assert.equal(result.scanBoundary.stop, 'end');
  assert.equal(floorCalls.length, 1024, 'mandatory floor keeps its original label path');
  assert.ok(finalCalls.length > 0, 'tail winners use the final label path');
  const floorBodies = new Set(floorCalls);
  assert.ok(finalCalls.every(body => !floorBodies.has(body)), 'cached floor placements are never relabeled');

  floorCalls.length = finalCalls.length = 0;
  const replay = f.runtime.queryCandidateRows(ns, { ...options, scanBoundary: result.scanBoundary,
    expectedEpoch: result.epoch, expectedSuppressionEpoch: result.suppressionEpoch });
  assert.equal(JSON.stringify(replay), JSON.stringify(result), 'same signed boundary reconstructs identical rows');
  assert.equal(floorCalls.length, 1024);
  assert.ok(finalCalls.length > 0);

  const sourceScore = createQueryScore('sourceonly1');
  const sourceLabel = createQueryExcerpt('sourceonly1');
  const finalSourceLabel = createQueryExcerpt('sourceonly1', true);
  let checked = 0;
  const sourced = f.runtime.queryCandidateRows(ns, { score: sourceScore, memoryLabel: sourceLabel,
    sourceReceiptLimit: SOURCE_QUERY_RECEIPT_LIMIT,
    memoryLabelAfterScan(content, score) {
      assert.equal(score, sourceScore(content), 'bound belongs to the winning text, including receipts');
      checked++;
      return finalSourceLabel(content, score);
    } });
  assert.ok(checked > 0);
  const winner = sourced.rows.find(row => row.item.ref.memoryId === key(1));
  assert.ok(winner.item.label.includes('sourceonly1'));

  floorCalls.length = finalCalls.length = 0;
  let tick = 0; clock(() => tick++ * 500);
  const bounded = f.runtime.queryCandidateRows(ns, options);
  assert.equal(bounded.scanBoundary.rows, 1024);
  assert.equal(bounded.scanBoundary.stop, 'budget');
  assert.equal(floorCalls.length, 1024);
  assert.equal(finalCalls.length, 0, 'floor-only budget stop runs no optimized labels');
});
