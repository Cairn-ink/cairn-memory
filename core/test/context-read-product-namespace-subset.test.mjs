import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { subsetFixture,personal,project,publication,ok,bare,card } from '../testing/context-product-subset-fixture.mjs';

function scoped(value,selected) {
  const details=value.diagnostics?.candidates??value;
  assert.equal(details.coverage.namespaces.policy,'authorized-subset-v1');
  assert.equal(details.coverage.namespaces.selectedNamespaces,selected.length);
  assert.equal(details.coverage.namespaces.requestedNamespaces,selected.length);
  assert.equal(details.coverage.namespaces.omittedNamespaces,0);
  assert.equal(details.trace.namespaceSelection,undefined);
  for(const c of Object.values(details.coverage.byType))for(const key of ['eligible','indexed','embedded','embeddedFraction','scannedFraction'])assert.equal(c[key],null,key);
  assert.equal(details.coverage.maintenance.progress,null);
  assert.equal(details.coverage.stops.budget,null);
  for(const item of value.items??value.metered?.items??[])assert.ok(selected.some(ns=>JSON.stringify(ns)===JSON.stringify(item.ref.namespace??publication[item.ref.ns])));
}
for(const safety of [false,true])for(const cards of [false,true])test(`native personal / personal plus project, safety=${safety} cards=${cards}`,async t=>{
  const s=subsetFixture(t,{safety,cards,seed(f){
    const rows=publication.map((ns,i)=>f.admit('orchard namespace '+i,ns));
    if(cards)for(const ns of publication)card(f,ns,'orchard card','selected support');
    return rows;
  }});
  const db=s.side();t.after(()=>db.close());
  const before=db.prepare('SELECT * FROM publications ORDER BY projection').all();
  const records=db.prepare('SELECT record FROM validation_records ORDER BY publication').all();
  const seal=db.prepare('SELECT * FROM product_attestation').get();
  for(const namespaces of [[personal],[personal,project('a')],[personal,project('b')]])for(const semantic of [false,true]) {
    const value=ok(await s.run('findCandidates',{namespaces,semantic,limit:24}));scoped(value,namespaces);
    assert.equal(value.items.length,namespaces.length*(cards?2:1));
    assert.equal(value.coverage.omitted.lexical,0);
    const assembly=ok(await s.run('contextRead',{namespaces,semantic,budget:{maxTokens:6000,maxItems:24}}));scoped(assembly,namespaces);
    assert.equal(assembly.metered.items.length,value.items.length);
  }
  assert.deepEqual(db.prepare('SELECT * FROM publications ORDER BY projection').all(),before);
  assert.deepEqual(db.prepare('SELECT record FROM validation_records ORDER BY publication').all(),records);
  assert.deepEqual(db.prepare('SELECT * FROM product_attestation').get(),seal);
  assert.equal(db.prepare('SELECT count(*) n FROM work').get().n,0);
  assert.equal(s.calls.provider,0);
});

test('selected entries survive an excluded multi-page lexical horizon before ranking',async t=>{
  const s=subsetFixture(t,{seed(f){
    for(let i=0;i<300;i++)f.admit('orchard orchard orchard '+i,project('b'));
    return Array.from({length:4},(_,i)=>f.admit('orchard '+('length '.repeat(40))+i,personal));
  }});
  const full=ok(await s.run('findCandidates',{limit:24}));assert.equal(full.items.length,24);
  assert.ok(full.items.every(i=>i.ref.namespace.projectId==='b'),'excluded project dominates the unfiltered top 24');
  const selected=ok(await s.run('findCandidates',{namespaces:[personal],limit:24}));
  assert.equal(selected.items.length,4);assert.equal(selected.coverage.omitted.lexical,0);scoped(selected,[personal]);
});

test('lexical scan crosses an entirely excluded page and retains its next page boundary hit',async t=>{
  const s=subsetFixture(t,{seed(f){
    const first=f.admit('orchard personal',personal);
    for(let i=0;i<382;i++)f.admit('orchard excluded '+i,project('a'));
    return [first,f.admit('orchard boundary',project('b')),f.admit('orchard after boundary',project('b'))];
  }});
  const db=s.side();
  try{
    const raw=db.prepare(`SELECT d.stream,d.id FROM postings p JOIN statistics s ON s.generation=p.generation AND s.term_id=p.term
      JOIN documents d ON d.generation=p.generation AND d.doc=p.doc WHERE s.term='orchard' ORDER BY p.doc`).all();
    assert.equal(raw.length,385);
    assert.ok(raw.slice(128,256).every(row=>row.stream===1));
    assert.equal(raw[383].stream,2);
    assert.deepEqual(new Set(raw.slice(383).map(row=>row.id)),new Set(s.rows.slice(1).map(row=>row.id)));
  }finally{db.close();}
  const value=ok(await s.run('findCandidates',{namespaces:[personal,project('b')],limit:24}));
  assert.deepEqual(new Set(value.items.map(item=>item.ref.memoryId)),new Set(s.rows.map(row=>row.id)));
  assert.equal(value.coverage.omitted.lexical,0);
});

test('cursor continuation binds personal, either project, full, and semantic mode',async t=>{
  const s=subsetFixture(t,{seed(f){return Array.from({length:8},(_,i)=>f.admit('orchard page '+i,personal));}});
  for(const semantic of [false,true]){
    const patch={namespaces:[personal],semantic,limit:2};
    const first=ok(await s.run('findCandidates',patch));assert.ok(first.nextCursor);
    const next=ok(await s.run('findCandidates',{...patch,cursor:first.nextCursor}));scoped(next,[personal]);
    assert.equal(next.items[0].rank,3);
    for(const namespaces of [undefined,[personal,project('a')],[personal,project('b')]]){
      const input={...s.query,semantic,limit:2,cursor:first.nextCursor,...(namespaces?{namespaces}:{})};
      assert.deepEqual(await s.index.run('findCandidates',input,{}),bare('invalid_cursor'));
    }
  }
});

test('scoped assembly forces implicit Raw off and refuses explicit raw true before provider work',async t=>{
  let rawCalls=0;
  const trap=()=>{rawCalls++;throw Error('broad Raw called');};
  const s=subsetFixture(t,{rawSearch:{supportsLexicalSearch:true,search:trap,prepare:trap,revalidate:trap}});
  for(const patch of [{},{raw:false}])scoped(ok(await s.run('contextRead',{namespaces:[personal],...patch})),[personal]);
  assert.deepEqual(await s.run('contextRead',{namespaces:[personal],raw:true}),bare('invalid_input'));
  assert.equal(rawCalls,0);
  await s.run('contextRead');assert.ok(rawCalls>0,'full read retains the original Raw default');
});

for(const inside of [false,true])test(`forget ${inside?'inside':'outside'} the subset preserves whole-publication safety`,async t=>{
  const s=subsetFixture(t,{safety:true}),target=s.rows[inside?0:2];
  const writer=new DatabaseSync(s.f.path);
  try{transaction(writer,()=>writeContentSuppressionInside(writer,{namespace:publication[inside?0:2],kind:'memory',key:target.id,reason:'user_forget',actionId:'synthetic-forget'}));}finally{writer.close();}
  const full=await s.run('findCandidates',{limit:24}),result=await s.run('findCandidates',{namespaces:[personal],limit:24});
  assert.equal(result.ok,full.ok,'the subset cannot bypass the whole-publication fence');
  if(result.ok){scoped(result.value,[personal]);assert.equal(result.value.items.length,inside?0:1);assert.ok(!JSON.stringify(result).includes(target.id));}
  else assert.equal(result.error.code,full.error.code);
  s.build();
  const after=ok(await s.run('findCandidates',{namespaces:[personal],limit:24}));scoped(after,[personal]);
  assert.equal(after.items.length,inside?0:1);
});

test('unavailable diagnostics carry no publication population or maintenance progress',async t=>{
  const s=subsetFixture(t);s.f.admit('new orchard evidence',project('b'));
  for(const method of ['findCandidates','contextRead']){
    const result=await s.run(method,{namespaces:[personal],semantic:true});assert.equal(result.error.code,'index_unavailable');
    scoped(result.error.details.candidates??result.error.details,[personal]);
  }
});
