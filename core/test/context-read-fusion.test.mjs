import test from 'node:test';
import assert from 'node:assert/strict';
import { fuseCandidates, RRF_PRESETS } from '../context-read-fusion.mjs';
import { compareCanonical } from '../context-read-bm25.mjs';
const row = (memoryId, score) => ({ memoryId, score });
const hybrid = preset => ({ preset, semanticState: 'ready', coverageComplete: true });

test('R03 frozen RRF presets; one-based ranks, missing membership zero and canonical ties', () => {
  assert.deepEqual(RRF_PRESETS['rrf-k60-d12'], { k:60, depth:12, weights:[.45,.45], unionMaximum:24 });
  assert.deepEqual(RRF_PRESETS['rrf-k10'], { k:10, depth:24, weights:[.5,.5], unionMaximum:48 });
  for (const [preset, k, weight] of [['rrf-k60-d12',60,.45], ['rrf-k10',10,.5]]) {
    const result = fuseCandidates([row('b',8),row('a',1)], [row('c',3),row('a',2)], hybrid(preset));
    assert.deepEqual(result.rows.map(r=>r.memoryId), ['a','b','c']);
    assert.equal(result.rows[0].score, 2 * weight * (1/(k+2)));
    assert.equal(result.rows[1].score, weight * (1/(k+1)));
    assert.equal(result.unionSize,3);
    assert.deepEqual(result.rows[0].channels, { lexical:{rank:2,rawScore:1},semantic:{rank:2,rawScore:2} });
  }
  assert.throws(()=>fuseCandidates([],[],{preset:'arbitrary'}), /invalid_fusion/);
});

// HR-1 test/arms-fusion.test.mjs: A3's complete depth-12 rank grid.
test('R03 every depth-12 two-channel hit outranks every possible single-channel hit', () => {
  assert.ok(.45/72+.45/72 > .45/61);
  for (let lexRank=1;lexRank<=12;lexRank++) for(let semRank=1;semRank<=12;semRank++) {
    const lex = Array.from({length:12},(_,i)=>row(i+1===lexRank?'dual':`l${i}`,100-i));
    const sem = Array.from({length:12},(_,i)=>row(i+1===semRank?'dual':`s${i}`,100-i));
    assert.equal(fuseCandidates(lex,sem,hybrid('rrf-k60-d12')).rows[0].memoryId,'dual');
  }
});
test('R03 depth, union maxima, horizon and binary owner/scope/project/type/id ordering', () => {
  const lex=Array.from({length:50},(_,i)=>row(`l${i}`,100-i)), sem=Array.from({length:50},(_,i)=>row(`s${i}`,100-i));
  assert.equal(fuseCandidates(lex,sem,hybrid('rrf-k60-d12')).unionSize,24);
  const hosted=fuseCandidates(lex,sem,hybrid('rrf-k10'));
  assert.equal(hosted.unionSize,48); assert.equal(hosted.rows.length,24);
  const ref = (owner,scope,project,type,id) => ({ ref:{namespace:{ownerId:owner,scope,projectId:project}, type,
    ...(type==='memory'?{memoryId:id}:{cardId:id})},score:1 });
  const rows=[ref('z','personal',null,'memory','a'),ref('a','project','z','memory','a'),ref('a','project','a','memory','a'),
    ref('a','personal',null,'memory','a'),ref('a','project','a','card','z'),ref('a','project','a','card','a')];
  assert.deepEqual(fuseCandidates(rows,[],{semanticState:'disabled'}).rows.map(r=>r.ref),[...rows].sort(compareCanonical).map(r=>r.ref));
  // UTF-8/SQLite BINARY order differs from UTF-16 ordering for these IDs.
  assert.ok(compareCanonical(row('\uE000',1),row('𠀀',1))<0);
});
test('R05 absent/disabled/degraded/incomplete semantic uses full lexical BM25, zero fusion', () => {
  const lex=Array.from({length:24},(_,i)=>row(`l${i}`,100-i));
  for (const semanticState of ['disabled','absent','timeout','provider_error','rate_limited','budget_denied','stale_index','dimension_mismatch','partial_coverage','ready']) {
    const result=fuseCandidates(lex,[row('semantic-only',999)],{semanticState,coverageComplete:false});
    assert.equal(result.mode,'lexical'); assert.equal(result.rows.length,24);
    assert.deepEqual(result.rows.map(r=>r.memoryId),lex.map(r=>r.memoryId));
    assert.ok(result.rows.every(r=>r.fusionScore===null && r.channels.semantic===null));
  }
});
