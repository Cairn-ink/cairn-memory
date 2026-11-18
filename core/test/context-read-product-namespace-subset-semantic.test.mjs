import test from 'node:test';
import assert from 'node:assert/strict';
import { subsetFixture,personal,project,publication,ok,bare,vector,snapshot } from '../testing/context-product-subset-fixture.mjs';

function selected(value) {
  const details=value.diagnostics?.candidates??value;
  for(const c of Object.values(details.coverage.byType)){
    assert.equal(c.eligible,null);assert.equal(c.indexed,null);assert.equal(c.embedded,null);
    assert.equal(c.embeddedFraction,null);assert.equal(c.scannedFraction,null);
  }
  for(const item of value.items??value.metered?.items??[])assert.deepEqual(item.ref.namespace??publication[item.ref.ns],personal);
}

test('excluded project dominates both top-24 horizons; personal hybrid still gets its good matches',async t=>{
  const s=subsetFixture(t,{semantic:true,seed(f){
    for(let i=0;i<140;i++)f.admit('orchard orchard orchard '+i,project('b'));
    return [...Array.from({length:4},(_,i)=>f.admit('orchard '+('longer '.repeat(30))+i,personal)),f.admit('violet semantic evidence',personal)];
  },vectorOf:row=>vector(JSON.parse(row.identity)[1]==='personal'?.8:1)});
  const lexical=s.storage.lexical(s.p,s.lexical,'orchard',24);
  assert.equal(lexical.rows.length,24);assert.ok(lexical.rows.every(row=>row.ref.namespace.projectId==='b'));
  const semantic=s.vectors.rank(s.vectors.observe(s.p,s.lexical,snapshot,{load:true}),vector()).slice(0,24);
  assert.equal(semantic.length,24);assert.ok(semantic.every(row=>row.ref.namespace.projectId==='b'));
  const full=ok(await s.run('findCandidates',{semantic:true,limit:24}));
  assert.ok(full.items.length>=12);assert.ok(full.items.every(item=>item.ref.namespace.projectId==='b'));
  const scoped=ok(await s.run('findCandidates',{semantic:true,namespaces:[personal],limit:24}));
  selected(scoped);assert.equal(scoped.trace.effective,'hybrid');assert.equal(scoped.items.length,5);
  assert.equal(scoped.items.filter(item=>item.channels.semantic!==null).length,5);
  assert.equal(scoped.items.filter(item=>item.channels.lexical===null).length,1,'semantic-only selected match survives');
  assert.equal(scoped.coverage.omitted.lexical,0);assert.equal(scoped.coverage.omitted.semantic,0);
  assert.equal(scoped.coverage.omitted.horizon,0);
  const assembly=ok(await s.run('contextRead',{semantic:true,namespaces:[personal],budget:{maxTokens:6000,maxItems:24}}));
  selected(assembly);assert.equal(assembly.metered.items.length,5);
});

for(const reason of ['provider_error','budget_denied','provider_unavailable'])test(`semantic ${reason} degrades to scoped lexical candidates`,async t=>{
  const s=subsetFixture(t,{semantic:true});s.setProviderError(reason);
  const value=ok(await s.run('findCandidates',{semantic:true,namespaces:[personal]}));
  selected(value);assert.equal(value.items.length,1);assert.equal(value.trace.effective,'lexical');
  assert.equal(value.trace.semantic.degradedReason,reason);
});

test('semantic-off makes no embedding call; globally disabled semantics cannot be bypassed',async t=>{
  const s=subsetFixture(t,{semantic:true});
  selected(ok(await s.run('findCandidates',{semantic:false,namespaces:[personal]})));assert.equal(s.calls.provider,0);
  s.setPolicy({semantic:false,purgeEpoch:0});
  const off=ok(await s.run('findCandidates',{semantic:true,namespaces:[personal]}));selected(off);
  assert.equal(s.calls.provider,0);assert.equal(off.trace.semantic.degradedReason,'not_enabled');
});

test('semantic paging binds subset before canonical evidence and does not repeat query embedding',async t=>{
  const s=subsetFixture(t,{semantic:true,seed(f){return Array.from({length:5},(_,i)=>f.admit('orchard '+i,personal));}});
  const first=ok(await s.run('findCandidates',{semantic:true,namespaces:[personal],limit:1}));
  assert.equal(s.calls.provider,1);assert.ok(first.nextCursor);
  const page=ok(await s.run('findCandidates',{semantic:true,namespaces:[personal],limit:1,cursor:first.nextCursor}));
  selected(page);assert.equal(page.items[0].rank,2);assert.equal(s.calls.provider,1);
  for(const namespaces of [[personal,project('a')],[personal,project('b')]])
    assert.deepEqual(await s.run('findCandidates',{semantic:true,namespaces,limit:1,cursor:first.nextCursor}),bare('invalid_cursor'));
});
