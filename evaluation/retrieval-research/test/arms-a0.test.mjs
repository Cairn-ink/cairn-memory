import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { armDocuments } from '../lib/fixture.mjs';
import { createA0Store, frozenA0Stores, a0b } from '../lib/a0-core.mjs';
import { toyFixture, document } from './fixtures-arms/toy.mjs';
function projections(fixture) {
  const project=(intent,include)=>armDocuments(fixture,{namespace:'target',scale:'S300',intent,include});
  return {history:project('history','body'),current:project('current','body'),spans:project('history','spans')};
}
test('public A0 admit/supersede/receipt seed enables selectEvidence with trusted host',()=>{
  const store=createA0Store(projections(toyFixture()));
  try {
    assert.equal(store.capabilities.evidenceReads.version,'exact-namespace-evidence-v1');
    assert.equal(store.capabilities.evidenceReads.defaults.limit,12);
    assert.equal(store.capabilities.evidenceReads.defaults.scanRows,128);
    const current=store.search({text:'Amber',intent:'current'});
    assert.deepEqual(current.ranked.sort(),['m-a','m-c']);
    const history=store.search({text:'Amber',intent:'history'},{paged:true});
    assert.ok(history.ranked.includes('m-old')); assert.ok(history.ranked.includes('m-await'));
    assert.equal(history.errors.length,0); assert.equal(history.coverage.at(-1).status,'complete');
    assert.equal(history.scannedRows,6); assert.equal(current.pages,1);
    assert.equal(current.recall24Available,false);
  } finally{store.close();}
});
test('A0-paged follows unchanged cursor parameters to completion, truncates concatenated API order',()=>{
  const docs=Array.from({length:160},(_,i)=>document(`m-${i}`,'common synthetic row '+i));
  const store=createA0Store({history:docs,current:docs,spans:docs.map(doc=>document(doc.memoryId,doc.text,'span'))});
  try{
    const defaults=store.search({text:'common',intent:'current'}),paged=store.search({text:'common',intent:'current'},{paged:true});
    assert.equal(defaults.ranked.length,12); assert.equal(paged.ranked.length,24);
    assert.equal(paged.pages,7); assert.equal(paged.scannedRows,160); assert.deepEqual(paged.errors,[]);
    assert.deepEqual(paged.coverage.map(c=>c.scannedRows),[24,24,24,24,24,24,16]);
    const expected=Object.entries(store.mapping).sort((a,b)=>a[1]<b[1]?-1:1).slice(0,24).map(([id])=>id);
    assert.deepEqual(paged.ranked,expected);
  }finally{store.close();}
});
test('five frozen UUID stores, mappings and rankings stable on reopen',t=>{
  const workspace=createTestWorkspace(t,{prefix:'hr1-a0-'}), fixture=toyFixture();
  const options={...projections(fixture),directory:join(workspace.path,'snapshots'),scale:'S300'};
  const stores=frozenA0Stores(options),mapping=stores.map(store=>store.mapping),rankings=stores.map(store=>store.search({text:'Amber',intent:'history'}));
  assert.equal(stores.length,5); assert.equal(new Set(mapping.map(m=>m['m-a'])).size,5);
  for(const store of stores)store.close();
  const reopened=frozenA0Stores(options);
  try{assert.deepEqual(reopened.map(store=>store.mapping),mapping);
    assert.deepEqual(reopened.map(store=>store.search({text:'Amber',intent:'history'})),rankings);
  }finally{for(const store of reopened)store.close();}
});
test('A0 foreign projection invariance and A0b full projection retains zeroes',()=>{
  const fixture=toyFixture(),filtered=structuredClone(fixture);
  filtered.corpus.memories=filtered.corpus.memories.filter(m=>m.namespace==='target');
  const a=createA0Store(projections(fixture)),b=createA0Store(projections(filtered));
  try{
    assert.deepEqual(a.search({text:'unmatched',intent:'current'}).ranked,b.search({text:'unmatched',intent:'current'}).ranked);
    assert.deepEqual(a.search({text:'Amber',intent:'current'}).ranked.sort(),b.search({text:'Amber',intent:'current'}).ranked.sort());
    assert.deepEqual(a0b([document('b','none'),document('a','none')],'absent').map(row=>row.memoryId),['a','b']);
  }finally{a.close();b.close();}
});
