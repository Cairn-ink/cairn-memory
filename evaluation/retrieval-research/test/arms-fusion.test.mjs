import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIRMATORY, explorationGrid, fuse } from '../lib/fusion.mjs';
import { createArm, includeForArm } from '../lib/arms.mjs';
import { armDocuments, armQueries } from '../lib/fixture.mjs';
import { document, toyDocuments, toyQueries, toyFixture, fakeEmbedder } from './fixtures-arms/toy.mjs';
const row = (memoryId, score) => ({ memoryId, score });

test('RRF is one-based; missing channels contribute zero; ties break by ID', () => {
  const result = fuse([row('b',8), row('a',1)], [row('c',3), row('a',2)], CONFIRMATORY['F-RRF60']);
  assert.deepEqual(result.rows.map(r => r.memoryId), ['a','b','c']);
  assert.equal(result.rows[0].score, 1/62);
  assert.equal(result.rows[1].score, 0.5/61);
  assert.equal(result.unionSize, 3);
});
test('A3 every two-channel hit at depth 12 outranks every possible single-channel hit', () => {
  assert.ok(0.45/72 + 0.45/72 > 0.45/61); // worst dual vs best single
  for (let lexRank = 1; lexRank <= 12; lexRank++) for (let semRank = 1; semRank <= 12; semRank++) {
    const lex = Array.from({ length: 12 }, (_, i) => row(i + 1 === lexRank ? 'dual' : `l${i}`, 100-i));
    const sem = Array.from({ length: 12 }, (_, i) => row(i + 1 === semRank ? 'dual' : `s${i}`, 100-i));
    assert.equal(fuse(lex, sem, CONFIRMATORY.A3).rows[0].memoryId, 'dual');
  }
});
test('min-max uses retained channel top-k, missing/constant ranges become zero', () => {
  const result = fuse([row('b',20),row('a',10),row('ignored',-100)], [row('c',4),row('d',4)], { method:'mm',depth:2,weights:[0.5,0.5] });
  assert.deepEqual(result.rows, [row('b',0.5),row('a',0),row('c',0),row('d',0)]);
  assert.equal(result.unionSize,4);
});
test('exploration grid and MemPalace cosine-distance re-scoring', () => {
  assert.equal(explorationGrid().length, 37);
  const configs = explorationGrid().filter(config => config.method === 'mempalace');
  assert.equal(configs.length,5);
  const result = fuse([], [row('a',0.8),row('b',0.79)], configs.at(-1), {
    text: 'amber deploy', documents: [document('a','cedar'),document('b','amber deploy')],
  });
  assert.deepEqual(result.rows.map(r=>r.memoryId), ['b','a']);
  assert.ok(Math.abs(result.rows[0].score - (-0.21*0.5)) < 1e-10);
});
test('eligibility, scale and evaluator-input barrier through shared projections', () => {
  const fixture = toyFixture();
  const current = armDocuments(fixture, { namespace:'target',scale:'S300',intent:'current',include:'body' });
  assert.deepEqual(current.map(doc=>doc.memoryId), ['m-a','m-b','m-c','m-d']);
  const history = armDocuments(fixture, { namespace:'target',scale:'S300',intent:'history',include:'body' });
  assert.ok(history.some(doc=>doc.memoryId==='m-old')); assert.ok(history.some(doc=>doc.memoryId==='m-await'));
  for (const doc of history) assert.deepEqual(Object.keys(doc).sort(), ['docId','kind','memoryId','text']);
  const large = armDocuments(fixture, { namespace:'target',scale:'S1000',intent:'current',include:'body' });
  assert.ok(large.some(doc=>doc.memoryId==='m-extra'));
  for (const query of armQueries(fixture,{split:'dev'})) assert.deepEqual(Object.keys(query).sort(), ['intent','queryId','text']);
});
test('foreign isolation and ranking invariance for lexical, semantic, confirmatory and grid arms', async () => {
  const fixture = toyFixture(), withoutForeign = structuredClone(fixture);
  withoutForeign.corpus.memories = withoutForeign.corpus.memories.filter(m=>m.namespace==='target');
  const project = f => armDocuments(f,{namespace:'target',scale:'S1000',intent:'current',include:'body'});
  assert.deepEqual(project(fixture), project(withoutForeign));
  const arms = ['A0b','A1','A1+','A1t','A2',...Object.keys(CONFIRMATORY),...explorationGrid().map(c=>c.name),'A5-spans','A5-both'];
  for (const arm of arms) {
    const scoped = f => armDocuments(f,{namespace:'target',scale:'S1000',intent:'current',include:includeForArm(arm)});
    const a = await createArm({ arm, documents:scoped(fixture), embedder:fakeEmbedder() });
    const b = await createArm({ arm, documents:scoped(withoutForeign), embedder:fakeEmbedder() });
    try {
      const result = await a.search(toyQueries[0]);
      assert.deepEqual(result, await b.search(toyQueries[0]), arm);
      assert.ok(result.ranked.every(id=>!id.startsWith('foreign')));
      assert.ok(result.ranked.length<=24);
    } finally { a.close(); b.close(); }
  }
});
test('A5 per-memory dense max before depth and deterministic final rankings', async () => {
  const docs = [...toyDocuments, ...Array.from({length:60}, (_,i)=>document('m-a','Amber deploy','span',`m-a#${i}`))];
  const arm = await createArm({arm:'A5-both',documents:docs,embedder:fakeEmbedder(),fusion:'F-RRF60'});
  try {
    const first = await arm.search(toyQueries[0]);
    assert.equal(new Set(first.ranked).size,first.ranked.length);
    assert.equal(first.channels.sem.length,4);
    assert.deepEqual(await arm.search(toyQueries[0]),first);
  } finally {arm.close();}
});
