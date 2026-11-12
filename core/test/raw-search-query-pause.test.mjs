import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceFixture,savedSource,ns,ok,request,splitRaw } from '../testing/raw-source-fixtures.mjs';
import { searchFixture } from '../testing/raw-search-fixtures.mjs';
import { installRawSearchTestClock } from '../testing/raw-search-clock.mjs';

test.beforeEach(installRawSearchTestClock);
function control(f,namespace,mode) {
  f.db.prepare(`INSERT INTO episode_controls(owner_id,scope,project_id,generation,paused,enabled)
    VALUES(?,?,?,'synthetic',?,?) ON CONFLICT(owner_id,scope,project_id)
    DO UPDATE SET paused=excluded.paused,enabled=excluded.enabled`)
    .run(namespace.ownerId,namespace.scope,namespace.projectId??'',+(mode==='paused'),+(mode!=='disabled'));
}
async function embedded(t,{mixed=false,setupHost}={}) {
  let calls=0;
  const f=sourceFixture(t),other={...ns,scope:'project',projectId:'synthetic-other'};
  const port={id:'synthetic-query-pause-'+t.name,revision:'1',dimensions:2,normalization:'l2',
    async embed(texts,controls){calls++;controls.beforeDispatch();return texts.map(()=>[1,0]);}};
  await savedSource(f,'Synthetic copper telescope.');
  if(mixed)ok(await f.core.captureRaw(request(splitRaw('copper allowed',{id:'allowed',ordinal:1})[0],
    {namespace:other,client:'codex',sessionId:'other',eventId:'other'})));
  const s=await searchFixture(f,{embedder:port,readSet:mixed?[ns,other]:[ns],
    policy:{family:'local',maxBatchDocuments:1,maxRequests:100,maxConcurrent:1,maxUsd:0},
    setupHost:host=>setupHost?.(host,f)});
  await s.maintain();
  for(let i=0;i<24;i++)await s.tick({embeddings:true,maxMs:5000});
  assert.equal((await s.search({query:'copper'})).semantic.state,'ready');
  calls=0;
  return {f,s,other,calls:()=>calls};
}
for(const mode of ['paused','disabled']) {
  test(`a fully embedded ${mode} namespace never sends query text`,async t=>{
    const {f,s,calls}=await embedded(t);
    control(f,ns,mode);
    const result=await s.search({query:'copper'});
    assert.equal(calls(),0);
    assert.deepEqual(result.semantic,{state:'bm25-only',reason:'namespace_paused'});
    assert.equal(result.candidates.length,0);
  });
  test(`a mixed read set with a ${mode} namespace retains allowed lexical hits without sending query text`,async t=>{
    const {f,s,other,calls}=await embedded(t,{mixed:true});
    control(f,ns,mode);
    const result=await s.search({query:'copper'});
    assert.equal(calls(),0);
    assert.deepEqual(result.semantic,{state:'bm25-only',reason:'namespace_paused'});
    assert.equal(result.candidates.length,1);
    assert.deepEqual(result.candidates[0].namespace,other);
    assert.equal(result.candidates[0].messageId,'allowed');
    assert.equal((await s.prepare(result.candidates[0])).validate().ranges[0].text,'copper allowed');
  });
}
test('a pause inside the final beforeDispatch guard prevents the embedder invocation',async t=>{
  const stackLimit=Error.stackTraceLimit;Error.stackTraceLimit=100;
  t.after(()=>{Error.stackTraceLimit=stackLimit;});
  let armed=false,paused=false;
  const {s,calls}=await embedded(t,{setupHost(host,f){
    const current=host.authority.isCurrent;
    host.authority.isCurrent=(...args)=>{
      if(armed&&!paused&&new Error().stack.includes('beforeDispatch')){
        paused=true;control(f,ns,'paused');
      }
      return current(...args);
    };
  }});
  armed=true;
  const result=await s.search({query:'copper'});
  assert.equal(paused,true,'pause landed after readiness inside beforeDispatch');
  assert.equal(calls(),0);
  assert.deepEqual(result.semantic,{state:'bm25-only',reason:'namespace_paused'});
  assert.equal(result.candidates.length,0);
});
