import test from 'node:test';
import assert from 'node:assert/strict';
import { openProductIndex } from '../context-product-index.mjs';
import { descriptor } from '../testing/context-product-owner-fixture.mjs';
import { subsetFixture,personal,project,publication,ok,bare,snapshot } from '../testing/context-product-subset-fixture.mjs';

function checkTimings(trace) {
  assert.ok(Object.keys(trace.timings).length>0);
  for(const [key,value] of Object.entries(trace.timings))assert.equal(value,null,key);
  if(trace.semantic){
    assert.equal(trace.semantic.queryEmbeddingMs,null);
    assert.equal(trace.semantic.queryEmbeddingBudgetMs,null);
  }
}

for(const semantic of [false,true])test(`scoped ${semantic?'hybrid':'lexical'} masks timings in initial page, continuation and assembly`,async t=>{
  const s=subsetFixture(t,{semantic});
  const patch={namespaces:[personal,project('a')],semantic,limit:1};
  const first=ok(await s.run('findCandidates',patch));
  assert.equal(first.trace.effective,semantic?'hybrid':'lexical');
  assert.ok(first.nextCursor);
  checkTimings(first.trace);
  const next=ok(await s.run('findCandidates',{...patch,cursor:first.nextCursor}));
  checkTimings(next.trace);
  const {limit,...assemblyPatch}=patch;
  const assembly=ok(await s.run('contextRead',{...assemblyPatch,raw:false,budget:{maxTokens:6000,maxItems:24}}));
  checkTimings(assembly.diagnostics.candidates.trace);
  checkTimings(assembly.diagnostics.trace);
  const full=ok(await s.run('findCandidates',{semantic,limit:1}));
  assert.equal(typeof full.trace.timings.lexicalMs,'number');
  if(semantic)assert.equal(typeof full.trace.semantic.queryEmbeddingBudgetMs,'number');
});

test('scoped unavailable diagnostics mask timings and embedding slack',async t=>{
  const s=subsetFixture(t,{semantic:true});
  s.f.admit('orchard after publication',project('b'));
  for(const method of ['findCandidates','contextRead']){
    const result=await s.run(method,{namespaces:[personal],semantic:true});
    assert.equal(result.error.code,'index_unavailable');
    const details=result.error.details.candidates??result.error.details;
    assert.equal(details.trace.semantic.coverage,'unavailable');
    checkTimings(details.trace);
  }
});

test('scoped coverage ignores projects beyond the maintained selection',async t=>{
  const readSet=[personal,...Array.from({length:31},(_,i)=>project(`p${String(i).padStart(2,'0')}`))];
  const s=subsetFixture(t,{readSet,omitted:0,seed:f=>[f.admit('orchard personal',personal)]});
  const results=[];
  for(const omitted of [0,1]){
    const index=openProductIndex({path:s.f.path,facade:s.facade,ownerCoverage:descriptor(s.readSet,omitted),
      authorize(){return {accessGenerations:s.access,check(){},envelope:work=>work()};}});
    try{
      const full=ok(await index.run('findCandidates',s.query,{}));
      const scoped=ok(await index.run('findCandidates',{...s.query,namespaces:[personal]},{}));
      assert.equal(full.coverage.status,omitted===0?'complete':'partial');
      assert.equal(scoped.coverage.namespaces.omittedNamespaces,0);
      results.push(scoped);
    }finally{index.close();}
  }
  assert.deepEqual(results[0].items,results[1].items);
  assert.deepEqual(results.map(result=>result.coverage.status),['complete','complete']);
});

test('scoped vector proof refuses a changed stable document id',async t=>{
  const s=subsetFixture(t,{semantic:true,seed:f=>publication.map(ns=>f.admit('orchard vector',ns))});
  const input={...s.p,namespaces:[personal]};
  assert.equal(s.vectors.observe(input,s.lexical,snapshot,{load:true}).status,'complete');
  const db=s.side();
  try{
    assert.equal(db.prepare("UPDATE documents SET id='damaged-stable-id' WHERE stream=0 AND eligible=1").run().changes,1);
  }finally{db.close();}
  const observed=s.vectors.observe(input,s.lexical,snapshot,{load:true});
  assert.equal(observed.status,'unavailable');
  assert.equal(observed.reason,'validation_invalid');
  assert.deepEqual(observed.rows,[]);
  const value=ok(await s.run('findCandidates',{namespaces:[personal],semantic:true,query:'absent'}));
  assert.equal(value.trace.semantic.degradedReason,'validation_invalid');
  assert.deepEqual(value.items,[]);
});

test('omitted scope at the direct index preserves trap-free invalid_input for a Proxy',async t=>{
  const s=subsetFixture(t);
  let traps=0;
  function trap(){traps++;throw Error('unexpected request trap');}
  const input=new Proxy(s.query,{get:trap,getPrototypeOf:trap,getOwnPropertyDescriptor:trap,ownKeys:trap});
  for(const method of ['findCandidates','contextRead'])
    assert.deepEqual(await s.index.run(method,input,{}),bare('invalid_input'));
  assert.equal(traps,0);
  assert.equal(s.calls.authorize.length,0);
});
