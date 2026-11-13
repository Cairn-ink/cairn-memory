import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceFixture,savedSource,ns,ok,request,splitRaw } from '../testing/raw-source-fixtures.mjs';
import { searchFixture } from '../testing/raw-search-fixtures.mjs';
import { installRawSearchTestClock } from '../testing/raw-search-clock.mjs';

test.beforeEach(installRawSearchTestClock);

function control(f,mode) {
  f.db.prepare(`INSERT INTO episode_controls(owner_id,scope,project_id,generation,paused,enabled)
    VALUES(?,?,?,'synthetic',?,?) ON CONFLICT(owner_id,scope,project_id)
    DO UPDATE SET paused=excluded.paused,enabled=excluded.enabled`)
    .run(ns.ownerId,ns.scope,ns.projectId??'',+(mode==='paused'),+(mode!=='disabled'));
}
function recorder() {
  const calls=[];
  return {calls,port:{id:'synthetic-maintenance-pause',revision:'1',dimensions:2,normalization:'l2',
    async embed(texts,controls) {
      // Record entry before even the provider's own guard: reaching this
      // function with denied text is already a failure.
      calls.push([...texts]);
      controls.beforeDispatch();
      return texts.map(()=>[1,0]);
    }}};
}
async function settle(s) {
  // Exercise discovery, reconciliation, vector refresh and result settlement,
  // including no-change turns after the finite synthetic inventory drains.
  for(let turn=0;turn<32;turn++)await s.tick({embeddings:true,maxMs:5000});
  const status=await s.service.status();
  assert.equal(status.maintenance.phase,'idle');
  assert.equal(status.maintenance.pending,false);
}
const policy={family:'local',maxBatchDocuments:1,maxRequests:100,maxConcurrent:1,maxUsd:0};

for(const mode of ['paused','disabled'])test(`maintenance never embeds stored Raw in a ${mode} namespace`,async t=>{
  const f=sourceFixture(t),record=recorder(),denied='Synthetic denied telescope.',allowed='Synthetic allowed compass.';
  await savedSource(f,denied);
  control(f,mode);
  const other={...ns,scope:'project',projectId:'synthetic-other'};
  ok(await f.core.captureRaw(request(splitRaw(allowed,{id:'allowed',ordinal:1})[0],
    {namespace:other,client:'codex',sessionId:'other',eventId:'other'})));
  const s=await searchFixture(f,{readSet:[ns,other],embedder:record.port,policy});
  await settle(s);
  assert.equal(record.calls.filter(texts=>texts.some(text=>text.includes(denied))).length,0);
  assert.deepEqual(record.calls,[[allowed]],'the allowed namespace alone reaches the embedder');
  control(f,'resumed');
  await settle(s);
  assert.equal(record.calls.filter(texts=>texts.includes(denied)).length,1,'resume embeds the saved denied source');
});

test('a pause after refresh opens stored text prevents provider entry and resume embeds it',async t=>{
  const f=sourceFixture(t),record=recorder(),text='Synthetic refresh telescope.';
  await savedSource(f,text);
  let armed=false,paused=false,opened=0;
  const open=f.port.openRaw;
  f.port.openRaw=async input=>{
    const result=await open(input);
    if(armed&&!paused){opened++;paused=true;control(f,'paused');}
    return result;
  };
  const s=await searchFixture(f,{embedder:record.port,policy});
  // Publish lexical chunks first, so the armed opener belongs to refresh().
  for(let turn=0;turn<8;turn++)await s.tick({maxMs:5000});
  assert.equal(s.indexCount(),1);
  assert.deepEqual(record.calls,[]);
  armed=true;
  await settle(s);
  assert.equal(opened,1,'the pause committed after refresh opened the source');
  assert.equal(paused,true);
  assert.deepEqual(record.calls,[],'no denied source reaches embed, even before its own guard');
  control(f,'resumed');
  await settle(s);
  assert.deepEqual(record.calls,[[text]]);
});
