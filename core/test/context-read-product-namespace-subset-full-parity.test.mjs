import test from 'node:test';
import assert from 'node:assert/strict';
import { subsetFixture,personal,project,ok,stable,sqlMeter } from '../testing/context-product-subset-fixture.mjs';

// Same publication, identity, secret and epochs: snapshot bytes are compared
// literally. Only measured elapsed timings are omitted. A 24-item page avoids
// random cursor IDs; a separate cross-shape continuation tests cursor binding.
for(const readSet of [[personal],[personal,project('a')]])for(const semantic of [false,true])test(`equal-full literal result bytes and SQL, ${readSet.length} namespaces semantic=${semantic}`,async t=>{
  const s=subsetFixture(t,{readSet,semantic,omitted:0}),meter=sqlMeter();t.after(()=>meter.close());
  for(const method of ['findCandidates','contextRead']){
    const patch={semantic,...(method==='findCandidates'?{limit:24}:{raw:false,budget:{maxTokens:6000,maxItems:24}})};
    // Compare like connection/cache states; cold opening is independently
    // compared against the baseline by the out-of-tree qualification.
    ok(await s.run(method,patch));ok(await s.run(method,{...patch,namespaces:readSet}));
    const full=await meter.measure(()=>s.run(method,patch));ok(full.value);
    const equal=await meter.measure(()=>s.run(method,{...patch,namespaces:[...readSet].reverse()}));ok(equal.value);
    // Semantic diagnostic durations are independently measured just like
    // trace.timings; preserve attempts, reasons, all scores/counts/text/refs.
    const timed=value=>JSON.parse(stable(value),(key,v)=>['queryEmbeddingMs','queryEmbeddingBudgetMs'].includes(key)?0:v);
    assert.equal(JSON.stringify(timed(equal.value)),JSON.stringify(timed(full.value)));
    assert.deepEqual(equal.events.map(e=>[e.sql,e.method]),full.events.map(e=>[e.sql,e.method]));
  }
  const first=ok(await s.run('findCandidates',{limit:1}));
  if(first.nextCursor)ok(await s.run('findCandidates',{limit:1,cursor:first.nextCursor,namespaces:readSet}));
});

test('wide full publication keeps legacy coverage; explicitly listing two projects refuses',async t=>{
  const s=subsetFixture(t);const full=ok(await s.run('findCandidates',{limit:24}));
  assert.equal(full.items.length,3);assert.equal(full.coverage.byType.memory.eligible,3);
  assert.equal(full.coverage.namespaces.policy,'recent-projects-v1');
  assert.equal((await s.run('findCandidates',{namespaces:s.readSet})).error.code,'invalid_read_set');
});
