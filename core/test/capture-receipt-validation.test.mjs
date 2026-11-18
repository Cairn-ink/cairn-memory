import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { openMemoryCore } from '../index.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { createRawLineageStorage } from '../raw-lineage-storage.mjs';
import { captureMessages } from '../capture.mjs';
import { safetyFixture, ns, ok } from '../testing/content-safety-s2h-fixture.mjs';
import { eventTimeSafetyFixture } from '../testing/receipt-event-time-fixture.mjs';

const receipt = eventId => ({ client:'synthetic', sessionId:'capture-cuts', eventId, role:'user', excerpt:'Synthetic '+eventId });
async function fixture(t, layout) {
  const f=(layout===53?eventTimeSafetyFixture:safetyFixture)(t,33);
  await f.migrate();
  const core=openMemoryCore({path:f.path,model:{contextWindow:8192,countTokens:()=>1,
    extract:async()=>({items:[0,1,2].map(i=>({content:'Synthetic captured fact '+i,kind:'fact',confidence:.8,sourceIndices:[0,1]}))})}});
  const db=f.connect();t.after(async()=>{await core.close();db.close();});
  const seed=ok(core.admit({namespace:ns,memory:{content:'Synthetic seed',kind:'fact'},receipts:[receipt('seed')]})).memory;
  transaction(db,()=>{
    const insert=db.prepare(`INSERT INTO memories(id,owner_id,scope,project_id,fingerprint,content,kind,origin,confidence,revision,deleted,created_at,updated_at)
      SELECT ?,owner_id,scope,project_id,?,?,'fact',origin,confidence,1,0,created_at,updated_at FROM memories WHERE id=?`);
    for(let i=0;i<129;i++)insert.run('synthetic-neighbor-'+i,'synthetic-fingerprint-'+i,'Synthetic neighbor '+i,seed.id);
  });
  return {...f,core,db,seed};
}
function countWalks(work) {
  const prepare=DatabaseSync.prototype.prepare,all=StatementSync.prototype.all;
  const page=new WeakSet();let starts=0;
  DatabaseSync.prototype.prepare=function(sql){const statement=prepare.call(this,sql);
    if(/^SELECT id,revision,deleted,updated_at/.test(sql)&&!sql.includes('AND updated_at'))page.add(statement);
    return statement;
  };
  StatementSync.prototype.all=function(...args){if(page.has(this)&&args.length===5)starts++;return all.apply(this,args);};
  return Promise.resolve().then(work).then(result=>({result,walks:starts/2})).finally(()=>{
    DatabaseSync.prototype.prepare=prepare;StatementSync.prototype.all=all;
  });
}
for(const layout of [48,53])test(`capture admission shares exactly one union walk at layout ${layout}`,async t=>{
  const f=await fixture(t,layout);
  const capture=await countWalks(()=>f.core.capture({namespace:ns,client:'codex',sessionId:'capture-cuts',eventId:'capture',
    messages:[{id:'user',role:'user',content:'Synthetic capture question'},{id:'assistant',role:'assistant',content:'Synthetic capture response'}]}));
  assert.equal(ok(capture.result).admission.memories.length,3);
  assert.equal(capture.walks,6,'five source freshness/filter walks plus one admission union');
  const admitted=await countWalks(()=>f.core.admit({namespace:ns,memory:{content:'Synthetic manual',kind:'fact'},receipts:[receipt('manual')]}));
  ok(admitted.result);assert.equal(admitted.walks,1);
});

// Preserve the snapshot's active-page, active-receipt, then deleted-page order.
// Sparse receipt inputs isolate that bound from receipt-batch/retention limits.
const populations = [
  [65,64],[100,100],[128,128],[128,0],[0,128],[129,0],[0,129],[64,64],[129,129],
  [127,127],[127,128],[127,129],[128,127],[128,129],[129,127],[129,128],
];
const sourceCases = [...populations.map(([active,deleted])=>({active,deleted,probe:'boundary'})),
  {active:1,deleted:129,probe:'suppressed-active'},
  {active:128,deleted:129,probe:'active-receipt-batch'}];
for (const layout of [48,53]) for (const {active,deleted,probe} of sourceCases)
test(`source first-page parity v${layout} active=${active} deleted=${deleted} ${probe}`, async t => {
  const f=(layout===53?eventTimeSafetyFixture:safetyFixture)(t,33);await f.migrate();
  const core=openMemoryCore({path:f.path}),writer=f.connect();let sourceDb;
  const runtime=createMemoryRuntime({path:f.path},{attachRaw(db){sourceDb=db;db.exec('PRAGMA busy_timeout=0');}});
  t.after(()=>{runtime.close();core.close();writer.close();});
  const seed=ok(core.admit({namespace:ns,memory:{content:'Synthetic size seed',kind:'fact'},receipts:[receipt('unrelated')]})).memory;
  transaction(writer,()=>{
    const insert=writer.prepare(`INSERT INTO memories(id,owner_id,scope,project_id,fingerprint,content,kind,origin,confidence,revision,deleted,created_at,updated_at)
      SELECT ?,owner_id,scope,project_id,?,?,'fact',origin,confidence,1,?,created_at,updated_at FROM memories WHERE id=?`);
    for(const state of [0,1]) for(let i=(state===(active?0:1)?1:0);i<(state?deleted:active);i++)
      insert.run(`size-${state}-${i}`,`size-fingerprint-${state}-${i}`,state?null:'Synthetic size neighbor',state,seed.id);
    if(!active)writer.prepare('UPDATE memories SET deleted=1,content=NULL WHERE id=?').run(seed.id);
  });
  assert.deepEqual(writer.prepare('SELECT deleted,count(*) n FROM memories GROUP BY deleted ORDER BY deleted').all().map(r=>[r.deleted,r.n]),
    [[0,active],[1,deleted]].filter(([,n])=>n));
  if(probe==='suppressed-active')transaction(writer,()=>writeContentSuppressionInside(writer,{
    namespace:ns,kind:'memory',key:seed.id,reason:'purge',actionId:'source-active-purge'}));
  if(probe==='active-receipt-batch')transaction(writer,()=>{
    const insert=writer.prepare(`INSERT INTO receipts(id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
      SELECT ?,memory_id,?,client,session_id,?,role,excerpt,created_at FROM receipts WHERE memory_id=? LIMIT 1`);
    for(let i=0;i<4;i++)insert.run('batch-receipt-'+i,'batch-key-'+i,'batch-event-'+i,seed.id);
  });
  const clock=t.mock.method(performance,'now',()=>0);
  try {
    const observed=[],expectedCells=[],batchReads=[];
    for(const locked of [false,true]) for(const method of ['filterCaptureSources','assertCaptureSources']) {
      const sequence=[],exec=sourceDb.exec.bind(sourceDb),prepare=sourceDb.prepare.bind(sourceDb);
      let lastRead=null,lastReadBeforeRollback=null;
      const reads=t.mock.method(sourceDb,'prepare',sql=>{const st=prepare(sql);
        for(const method of ['get','all','iterate']){const run=st[method].bind(st);st[method]=(...args)=>{lastRead=sql.replace(/\s+/g,' ').trim();return run(...args);};}return st;});
      const hook=t.mock.method(sourceDb,'exec',sql=>{if(/^(BEGIN|COMMIT|ROLLBACK)/.test(sql))sequence.push(sql);
        if(sql==='ROLLBACK'&&lastReadBeforeRollback===null)lastReadBeforeRollback=lastRead;return exec(sql);});
      let result;
      if(locked)writer.exec('BEGIN IMMEDIATE');
      try {result={value:runtime[method](ns,[receipt(probe==='suppressed-active'?'unrelated':'absent')])??null};}
      catch(error){result={error:error.code};}
      finally {hook.mock.restore();reads.mock.restore();if(locked)writer.exec('ROLLBACK');}
      const denied=probe==='suppressed-active',overflow=!denied&&(active>128||deleted>128);
      const expected=denied?(method==='filterCaptureSources'?{value:[]}:{error:'source_excluded'}):
        locked&&overflow?{error:'storage_busy'}:{value:method==='filterCaptureSources'?[0]:null};
      const begins=overflow?['BEGIN','ROLLBACK','BEGIN IMMEDIATE',...(locked?[]:['COMMIT'])]:['BEGIN',denied&&method==='assertCaptureSources'?'ROLLBACK':'COMMIT'];
      t.diagnostic('B1_CELL '+JSON.stringify({layout,active,deleted,probe,locked,method,result,sequence,lastReadBeforeRollback}));
      if(probe==='active-receipt-batch')batchReads.push(lastReadBeforeRollback?.startsWith('SELECT r.*,'));
      observed.push({result,sequence});expectedCells.push({result:expected,sequence:begins});
    }
    assert.deepEqual(observed,expectedCells);
    assert.ok(batchReads.every(Boolean),'active receipt-batch overflow must precede the deleted-page check');
  } finally {clock.mock.restore();}
});

for(const layout of [48,53]) for(const stage of ['filterCaptureSources','assertCaptureSources'])
test(`publicly seeded mixed source contention v${layout} ${stage}`,async t=>{
  const f=(layout===53?eventTimeSafetyFixture:safetyFixture)(t,33);await f.migrate();
  const core=openMemoryCore({path:f.path}),writer=f.connect();let sourceDb;
  const runtime=createMemoryRuntime({path:f.path},{attachRaw(db){sourceDb=db;db.exec('PRAGMA busy_timeout=0');}});
  t.after(()=>{runtime.close();core.close();writer.close();});
  const memories=[];
  for(let i=0;i<129;i++)memories.push(ok(core.admit({namespace:ns,memory:{content:'Synthetic independent fact '+i,kind:'fact'},receipts:[receipt('public-'+i)]})).memory);
  for(const memory of memories.slice(-64))ok(core.forget({namespace:ns,memoryId:memory.id,expectedRevision:memory.revision}));
  assert.deepEqual(writer.prepare('SELECT deleted,count(*) n FROM memories GROUP BY deleted ORDER BY deleted').all().map(r=>[r.deleted,r.n]),[[0,65],[1,64]]);
  const evidence=receipt('public-0'),sequence=[];let extracted=0;
  // Observe only the source connection, and contend only its synchronous boundary.
  const exec=DatabaseSync.prototype.exec;
  const trace=t.mock.method(DatabaseSync.prototype,'exec',function(sql){if(this===sourceDb&&/^(BEGIN|COMMIT|ROLLBACK)/.test(sql))sequence.push(sql);return exec.call(this,sql);});
  const source=method=>sources=>{
    if(method!==stage)return runtime[method](ns,sources);
    writer.exec('BEGIN IMMEDIATE');try{return runtime[method](ns,sources);}finally{writer.exec('ROLLBACK');}
  };
  let result;
  try {
    result=await captureMessages({input:{namespace:ns,client:evidence.client,sessionId:evidence.sessionId,eventId:'public-capture',
      messages:[{id:evidence.eventId,role:evidence.role,content:evidence.excerpt}]},
      model:{contextWindow:8192,countTokens:()=>1,extract(){extracted++;return {items:[{content:'Synthetic delivered fact',kind:'fact',confidence:.8,sourceIndices:[0]}]};}},
      operations:{filterCaptureSources:source('filterCaptureSources'),assertCaptureSources:source('assertCaptureSources'),
        claimAdmission:value=>core.claimAdmission({...value,leaseMs:125000}),finishAdmission:core.finishAdmission,abandonAdmission:core.abandonAdmission,
        get:core.get,map:core.map,beginInitialClassification:core.beginInitialClassification,failInitialClassification:core.failInitialClassification}});
  } finally {trace.mock.restore();}
  assert.equal(result.admission.memories.length,1);assert.equal(extracted,1);
  t.diagnostic('B1_PUBLIC '+JSON.stringify({layout,stage,delivered:result.admission.memories.length,sequence}));
});

for(const layout of [48,53]) for(const probe of ['denied-first','mutated-later'])
test(`receipt union ${probe} v${layout}`,async t=>{
  const f=await fixture(t,layout),lineage=createRawLineageStorage(f.db),safe=[receipt('safe')],denied=[receipt('seed')];
  f.db.prepare('UPDATE memories SET deleted=1,content=NULL WHERE id=?').run(f.seed.id);
  transaction(f.db,()=>assert.throws(()=>lineage.assertReceipts(ns,denied),{code:'source_excluded'}));
  if(probe==='denied-first') transaction(f.db,()=>lineage.withReceiptValidation(ns,[safe,denied],validate=>{
    assert.throws(()=>validate(ns,denied),{code:'storage_error'});
  }));
  else transaction(f.db,()=>lineage.withReceiptValidation(ns,[safe,denied],validate=>{
    const excerpt=denied[0].excerpt;
    denied[0].excerpt='temporarily unmatched';
    try {validate(ns,safe);} finally {denied[0].excerpt=excerpt;}
    assert.throws(()=>validate(ns,denied),{code:'source_excluded'});
  }));
});
for(const layout of [48,53])test(`empty source validation keeps its read path in a large namespace at layout ${layout}`,async t=>{
  const f=await fixture(t,layout),runtime=createMemoryRuntime({path:f.path});t.after(()=>runtime.close());
  let writers=0;const exec=DatabaseSync.prototype.exec;
  const clock=t.mock.method(performance,'now',()=>0);
  const probe=t.mock.method(DatabaseSync.prototype,'exec',function(sql){if(sql==='BEGIN IMMEDIATE')writers++;return exec.call(this,sql);});
  try {
    assert.deepEqual(runtime.filterCaptureSources(ns,[]),[]);
    assert.equal(runtime.assertCaptureSources(ns,[]),undefined);
    assert.equal(writers,0,'an empty source set requires no namespace-size fallback');
  } finally { probe.mock.restore();clock.mock.restore(); }
});
for(const layout of [48,53])test(`receipt validation capability expires with its synchronous writer callback at layout ${layout}`,async t=>{
  const f=await fixture(t,layout),lineage=createRawLineageStorage(f.db),batch=[receipt('safe')];let retained;
  const prepare=f.db.prepare.bind(f.db);let secretReads=0;
  const probe=t.mock.method(f.db,'prepare',sql=>{if(sql==='SELECT secret FROM episode_identity WHERE singleton=1')secretReads++;return prepare(sql);});
  let single;
  try {
    transaction(f.db,()=>lineage.withReceiptValidation(ns,[batch],validate=>validate(ns,batch)));
    single=secretReads;secretReads=0;const equivalent=[...batch];
    transaction(f.db,()=>lineage.withReceiptValidation(ns,[batch,equivalent],validate=>{validate(ns,batch);validate(ns,equivalent);}));
    assert.ok(single>0,'the fixture exercises Raw/source validation');
    assert.deepEqual([secretReads,single],[2,3],'equivalent batches validate each source only once');
  } finally { probe.mock.restore(); }
  assert.throws(()=>lineage.withReceiptValidation(ns,[batch],()=>{}),{code:'storage_error'});
  transaction(f.db,()=>lineage.withReceiptValidation(ns,[batch],validate=>{
    retained=validate;validate(ns,batch);validate(ns,batch);
    assert.throws(()=>validate({...ns,ownerId:'foreign'},batch),{code:'storage_error'});
    assert.throws(()=>validate(ns,[...batch]),{code:'storage_error'});
    const excerpt=batch[0].excerpt;batch[0].excerpt='Synthetic changed receipt';
    assert.throws(()=>validate(ns,batch),{code:'storage_error'});batch[0].excerpt=excerpt;
  }));
  transaction(f.db,()=>assert.throws(()=>retained(ns,batch),{code:'storage_error'}));
  assert.throws(()=>transaction(f.db,()=>lineage.withReceiptValidation(ns,[batch],validate=>{
    retained=validate;return Promise.resolve();
  })),{code:'storage_error'});
  await Promise.resolve();
  transaction(f.db,()=>assert.throws(()=>retained(ns,batch),{code:'storage_error'}));
  f.db.prepare('UPDATE memories SET deleted=1,content=NULL WHERE id=?').run(f.seed.id);
  const denied=[receipt('seed')];
  transaction(f.db,()=>lineage.withReceiptValidation(ns,[denied,batch],validate=>{
    assert.throws(()=>validate(ns,denied),{code:'source_excluded'});
    assert.throws(()=>validate(ns,batch),{code:'storage_error'},'a failed stream cannot seed another validation');
  }));
});
