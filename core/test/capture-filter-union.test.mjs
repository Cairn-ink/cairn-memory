import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { transaction } from '../database.mjs';
import { cachedContentLayout, installedContentLayout } from '../content-safety-schema.mjs';
import { createRawLineageStorage } from '../raw-lineage-storage.mjs';
import { writeContentSuppressionInside, withContentSuppressionRequest, contentSuppressionRequestInside } from '../content-suppression-storage.mjs';
import { eventTimeSafetyFixture } from '../testing/receipt-event-time-fixture.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { openMemoryCore } from '../index.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { localPlainPort, splitRaw, rawRequest } from '../testing/raw-fixtures.mjs';
import { DatabaseSync } from 'node:sqlite';
import { createMemoryRuntime } from '../runtime.mjs';
import { createEpisodeStorage } from '../episode-storage.mjs';
import { createStagedEvidenceStorage } from '../staged-evidence-storage.mjs';

const ns={ownerId:'synthetic-owner',scope:'project',projectId:'synthetic-project'};
const source=i=>({client:'claude-code',sessionId:'session-'+i,eventId:'event-'+i,role:'user',excerpt:'Synthetic excerpt '+i});
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ok=result=>{assert.equal(result.ok,true,JSON.stringify(result));return result.value;};
function base(storage,db,receipts) {
  const layout=cachedContentLayout(db);
  if(!layout)throw Object.assign(Error('unsupported_database'),{code:'unsupported_database'});
  if(!layout.suppressionRevision&&!storage.enabled())return receipts.map((_,i)=>i);
  return receipts.flatMap((receipt,index)=>{
    try{storage.assertReceipts(ns,[receipt]);return [index];}
    catch(error){if(error.code==='source_excluded')return [];throw error;}
  });
}
function insert(db,i,r,{key=digest(r),deleted=0,parent}={}) {
  const id=parent??'memory-'+String(i).padStart(5,'0'),rid='receipt-'+String(i).padStart(5,'0');
  if(!parent)db.prepare(`INSERT INTO memories(id,owner_id,scope,project_id,fingerprint,content,kind,origin,confidence,revision,deleted,created_at,updated_at)
    VALUES(?,?,?,?,?,?,'fact','explicit',1,1,?,'time','time')`).run(id,ns.ownerId,ns.scope,ns.projectId,id,deleted?null:'Synthetic '+i,deleted);
  db.prepare(`INSERT INTO receipts(id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
    VALUES(?,?,?,?,?,?,?,?,'time')`).run(rid,id,key,r.client,r.sessionId,r.eventId,r.role,r.excerpt);
  return {id,rid};
}
function observe(db,receipts,{reference=false,snapshot=false,inject,rollback=false,single=false,fault='seek'}={}) {
  installedContentLayout(db);
  const storage=createRawLineageStorage(db),prepare=db.prepare.bind(db),trace=[];
  let index=-1,union=0,baseWalks=0,fired=false,original;
  const injected=arguments[2] && Object.hasOwn(arguments[2],'inject');
  db.prepare=sql=>{
    const st=prepare(sql);
    for(const method of ['all','get','iterate','run']) {
      const native=st[method].bind(st);
      st[method]=(...args)=>{
        trace.push({sql,method,args});
        if(sql.includes('FROM content_suppressions INDEXED BY content_suppression_target')&&args[7]==='')index++;
        if(/^SELECT id,revision,deleted,updated_at/.test(sql)&&args.length===5&&args[3]===0)baseWalks++;
        if(sql.includes("event_id IN (SELECT json_extract(value,'$[2]')"))union++;
        if(sql.includes('SELECT 1 FROM raw_session_fences')&&receipts.some(r=>r.sessionId===args[4]))index=receipts.findIndex(r=>r.sessionId===args[4]);
        if(injected&&!fired&&union>0&&(fault==='union'?sql.includes("event_id IN (SELECT json_extract(value,'$[2]')"):sql.includes('AND updated_at=')&&sql.startsWith('SELECT id,revision'))) {
          fired=true;original=inject;
          if(rollback)db.exec('ROLLBACK');
          throw inject;
        }
        return native(...args);
      };
    }
    return st;
  };
  let outcome,caught,proofKinds,snapshotEntered=false,snapshotCompleted=false;
  const work=()=>{try{
    const allowed=single?(storage.assertReceipts(ns,receipts),[]):reference?base(storage,db,receipts):storage.filter(ns,receipts);
    outcome={allowed,excluded:receipts.map((_,i)=>i).filter(i=>!allowed.includes(i)),code:null,index:null};
  }catch(error){caught=error;outcome={code:error?.code??null,index};}};
  try {
    const request=()=>{
      db.exec(snapshot?'BEGIN':'BEGIN IMMEDIATE');
      try{if(snapshot){const proof=contentSuppressionRequestInside(db,[ns]);proofKinds=proof.facts?.map(fact=>fact.kind);index=-1;storage.sourceSnapshot(()=>{snapshotEntered=true;work();},proof,performance.now()+100,ns);snapshotCompleted=true;}else work();}
      finally{if(db.isTransaction)db.exec('ROLLBACK');}
    };
    if(snapshot)withContentSuppressionRequest(request);else request();
  }finally{db.prepare=prepare;}
  return {outcome,union,baseWalks,trace,caught,original,snapshotEntered,snapshotCompleted,proofKinds};
}
function runtimeObserve(runtime,receipts) {
  const prepare=DatabaseSync.prototype.prepare,trace=[];
  let index=-1;
  DatabaseSync.prototype.prepare=function(sql) {
    const st=prepare.call(this,sql);
    for(const method of ['all','get','run','iterate']) {
      const native=st[method].bind(st);
      st[method]=(...args)=>{
        trace.push({sql,method});
        if(sql.includes('SELECT 1 FROM raw_session_fences')&&receipts.some(r=>r.sessionId===args[4]))index=receipts.findIndex(r=>r.sessionId===args[4]);
        return native(...args);
      };
    }
    return st;
  };
  let outcome;
  try {
    const allowed=runtime.filterCaptureSources(ns,receipts);
    outcome={allowed,excluded:receipts.map((_,i)=>i).filter(i=>!allowed.includes(i)),code:null,index:null};
  } catch(error) {outcome={code:error.code,index};}
  finally {DatabaseSync.prototype.prepare=prepare;}
  return {outcome,unionQueries:trace.filter(row=>row.sql.includes("event_id IN (SELECT json_extract(value,'$[2]')")).length,
    snapshotQueries:trace.filter(row=>row.sql.includes("json_extract(wanted.value,'$[1]')")).length,
    snapshotBounds:trace.filter(row=>row.sql.includes('SELECT count(*) AS active FROM (')).length,
    writerQueries:trace.filter(row=>row.sql.includes('receipt_created_at_bytes')).length};
}
function compare(t,db,label,batch,expected,options={}) {
  const old=observe(db,batch,{...options,reference:true});
  if(JSON.stringify(old.outcome)!==JSON.stringify(expected))t.diagnostic(JSON.stringify({
    label,route:options.snapshot?'snapshot':'writer',preflight:old.outcome,proofKinds:old.proofKinds,
    snapshotEntered:old.snapshotEntered,snapshotCompleted:old.snapshotCompleted,
    snapshotReceiptQueries:old.trace.filter(row=>row.sql.includes("json_extract(wanted.value,'$[1]')")).length,
    stack:old.caught?.stack}));
  assert.deepEqual(old.outcome,expected,label+' base preflight');
  const actual=observe(db,batch,options);
  assert.deepEqual(actual.outcome,old.outcome,label+' differential');
  if(options.snapshot)for(const result of [old,actual]) {
    assert.equal(result.snapshotEntered,true,label+' bounded callback entered');
    assert.equal(result.snapshotCompleted,true,label+' bounded callback completed');
    assert.notEqual(result.outcome.code,'source_budget_exceeded',label+' no overflow');
    assert.equal(result.union,0,label+' no union SQL on snapshot');
    assert.ok(result.trace.some(row=>row.sql.includes('SELECT count(*) AS active FROM (')),label+' bounded snapshot namespace query observed');
    assert.equal(result.trace.some(row=>row.sql.includes('receipt_created_at_bytes')),false,label+' no writer receipt SQL');
  }
  if(options.runtime) {
    const caller=runtimeObserve(options.runtime,batch);
    // The runtime facade checks namespace visibility before entering filter.
    assert.deepEqual(caller.outcome,label==='9-scope'?{code:'memory_not_found',index:-1}:old.outcome,label+' runtime caller differential');
    if(batch.length && options.snapshot) {
      assert.equal(caller.unionQueries,0);assert.equal(caller.writerQueries,0);
      assert.ok(caller.snapshotBounds>0,label+' runtime bounded snapshot entered');
    }
    t.diagnostic(JSON.stringify({label,caller:'runtime.filterCaptureSources',route:options.snapshot?'snapshot':'writer',...caller}));
  }
  t.diagnostic(JSON.stringify({label,route:options.snapshot?'snapshot':'writer',base:old.outcome,change:actual.outcome,snapshotEntered:actual.snapshotEntered,snapshotCompleted:actual.snapshotCompleted,unionQueries:actual.union,walks:actual.baseWalks}));
  return actual;
}
const accepted=(allowed,excluded=[])=>({allowed,excluded,code:null,index:null});
for(const snapshot of [false,true])test(`privacy matrix: ${snapshot?'snapshot':'writer'}`,async t=>{
  const f=eventTimeSafetyFixture(t,33);await f.migrate();
  const core=openMemoryCore({path:f.path,raw:true});t.after(()=>core.close());
  const db=f.connect();t.after(()=>db.close());
  const clean=source('clean'),noRawForgot=source('no-raw-forgot'),forgot=source('raw-forgot'),bad=source('bad'),deleted=source('deleted'),memory=source('memory'),fenced=source('fenced'),both=source('both'),overflow=source('overflow');
  const admitted=ok(core.admit({namespace:ns,memory:{content:'Synthetic forgotten fact',kind:'fact'},receipts:[noRawForgot]})).memory;
  ok(core.forget({namespace:ns,memoryId:admitted.id,expectedRevision:admitted.revision}));
  // Public Raw capture creates the anchor and lineage; public forget excludes it.
  if(!snapshot) {
  const raw=openRawCaptureCore({path:f.path,model:rationaleModel()},
    {mode:'raw-v1',port:localPlainPort(),readPolicy:()=>({generation:'synthetic',reason:null}),lineage:true});
  t.after(()=>raw.close());
  const captured=ok(ok(await raw.captureRaw(rawRequest(splitRaw(forgot.excerpt,{id:forgot.eventId})[0],
    {namespace:ns,client:forgot.client,sessionId:forgot.sessionId}))).interpretation);
  const rawMemory=ok(raw.get({namespace:ns,memoryId:captured.admission.memories[0].id})).memory;
  assert.equal(db.prepare('SELECT count(*) n FROM raw_receipt_lineage l JOIN receipts r ON r.id=l.receipt_id WHERE r.memory_id=?').get(rawMemory.id).n>0,true);
  ok(raw.forget({namespace:ns,memoryId:rawMemory.id,expectedRevision:rawMemory.revision}));
  assert.equal(db.prepare('SELECT count(*) n FROM raw_source_exclusions').get().n>0,true);
  }
  transaction(db,()=>{
    insert(db,1,clean);insert(db,2,bad,{key:'inconsistent-key'});insert(db,3,deleted,{deleted:1});
    const m=insert(db,4,memory);writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:m.id,reason:'purge',actionId:'synthetic-memory'});
    insert(db,5,fenced);const b=insert(db,6,both);writeContentSuppressionInside(db,{namespace:ns,kind:'receipt',key:b.rid,reason:'purge',actionId:'synthetic-both'});
    if(!snapshot) {
      const p=insert(db,7,source('parent'));
      for(let i=0;i<8;i++)insert(db,100+i,source('continuation-'+i),{parent:p.id});
      insert(db,108,overflow,{parent:p.id,key:'inconsistent-key'});
    }
    // Snapshot pages group four Memories: one receipt per Memory stays in bounds.
    if(snapshot)insert(db,108,overflow,{key:'inconsistent-key'});
    // Identical tuples belong to distinct Memories, as independent admissions.
    insert(db,109,clean);
    if(!snapshot)for(let i=0;i<140;i++)insert(db,1000+i,source('filler-'+i));
  });
  for(const r of [fenced,both])ok(core.fenceSession({namespace:ns,client:r.client,sessionId:r.sessionId}));
  const runtime=createMemoryRuntime({path:f.path});t.after(()=>runtime.close());
  const opts={snapshot,runtime};
  if(snapshot) {
    const pages=db.prepare(`SELECT deleted,count(*) n FROM memories
      WHERE owner_id=? AND scope=? AND project_id=? GROUP BY deleted`).all(ns.ownerId,ns.scope,ns.projectId);
    const memories=db.prepare(`SELECT id,deleted FROM memories
      WHERE owner_id=? AND scope=? AND project_id=? ORDER BY deleted,updated_at DESC,id`).all(ns.ownerId,ns.scope,ns.projectId);
    let maxReceiptPage=0;
    for(const deleted of [0,1]) {
      const selected=memories.filter(memory=>memory.deleted===deleted);
      for(let i=0;i<selected.length;i+=4) {
        const n=selected.slice(i,i+4).reduce((sum,memory)=>sum+db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(memory.id).n,0);
        maxReceiptPage=Math.max(maxReceiptPage,n);
      }
    }
    assert.ok(pages.every(page=>page.n<=128));assert.ok(maxReceiptPage<=4);
    t.diagnostic(JSON.stringify({fixture:'snapshot',layout:db.prepare('PRAGMA user_version').get().user_version,
      memoryPages:pages,maxReceiptPage,rawExclusions:db.prepare('SELECT count(*) n FROM raw_source_exclusions').get().n,
      rawSuppressionFacts:db.prepare("SELECT count(*) n FROM content_suppressions WHERE kind='raw'").get().n}));
  }
  for(const [label,batch,expect] of [
    ...(!snapshot?[["1a-forgot-first",[forgot,clean,clean],accepted([1,2],[0])],
    ['1a-forgot-middle',[clean,forgot,clean],accepted([0,2],[1])],
    ['1a-forgot-last',[clean,clean,forgot],accepted([0,1],[2])],
    ['1a-forgot-all',[forgot,forgot,forgot],accepted([],[0,1,2])]]:[]),
    // Becomes a refusal cell after the rebase onto 07's fix.
    ['1b-no-raw-first',[noRawForgot,clean,clean],accepted([0,1,2])],
    ['1b-no-raw-middle',[clean,noRawForgot,clean],accepted([0,1,2])],
    ['1b-no-raw-last',[clean,clean,noRawForgot],accepted([0,1,2])],
    ['1b-no-raw-all',[noRawForgot,noRawForgot,noRawForgot],accepted([0,1,2])],
    ['2-fenced-first',[fenced,clean],{code:'conversation_deleted',index:0}],
    ['2-fenced-last-excluded-middle',[clean,deleted,fenced],{code:'conversation_deleted',index:2}],
    ['3-history-before-fence',[clean,both,clean],accepted([0,2],[1])],
    ['6-deleted',[clean,deleted,clean],accepted([0,2],[1])],
    ['6-digest',[clean,bad,clean],accepted([0,2],[1])],
    ['6-memory-suppression',[clean,memory,clean],accepted([0,2],[1])],
    ['8-starvation',[deleted,bad,clean],accepted([2],[0,1])],
    ['8-starvation-later-row',[bad,deleted,clean],accepted([2],[0,1])],
    ...(!snapshot?[['11-continuation-duplicate',[clean,...Array.from({length:8},(_,i)=>source('continuation-'+i)),overflow,forgot,overflow,forgot],accepted([0,1,2,3,4,5,6,7,8],[9,10,11,12])]]:
      [['11-duplicates',[clean,overflow,deleted,overflow,deleted],accepted([0],[1,2,3,4])]]),
    ['empty',[],accepted([])],
  ]) {
    const r=compare(t,db,label,batch,expect,opts);
    if(!snapshot&&batch.length&&label!=='empty')assert.equal(r.baseWalks,1,label+' validation must not replay');
  }
  let serial=500;
  for(const value of ['\0tail','\uFFFD','\ud800']) {
    const odd={...source('odd-'+serial),excerpt:value};
    const stored=transaction(db,()=>insert(db,serial++,odd,{key:'inconsistent-key'}));
    const row=db.prepare('SELECT * FROM receipts WHERE id=?').get(stored.rid);
    const back={client:row.client,sessionId:row.session_id,eventId:row.event_id,role:row.role,excerpt:row.excerpt};
    const same=JSON.stringify(odd)===JSON.stringify(back);
    compare(t,db,'7-odd-first-'+serial,[odd,bad,clean],same?accepted([2],[0,1]):accepted([0,2],[1]),opts);
    compare(t,db,'7-odd-middle-'+serial,[clean,back,bad],accepted([0],[1,2]),opts);
  }
  transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'namespace',matchMode:'namespace',reason:'purge',actionId:'synthetic-scope'}));
  const scoped=compare(t,db,'9-scope',[clean,bad,fenced],accepted([],[0,1,2]),opts);
  assert.equal(scoped.baseWalks,0);assert.equal(scoped.union,0);
});

for(const kind of ['revision','io','composition','fallback-error','validation-error','rollback','rollback-arbitrary','rollback-null','rollback-primitive'])test(`fallback scope: ${kind}`,async t=>{
  const f=eventTimeSafetyFixture(t,33);await f.migrate();
  const db=f.connect();t.after(()=>db.close());const early=source('early'),clean=source('clean'),late=source('late');
  transaction(db,()=>{
    for(let i=0;i<140;i++)insert(db,i,i===0?early:i===1?clean:source('fill-'+i),{key:i===0?'inconsistent-key':digest(i===1?clean:source('fill-'+i))});
    if(kind==='revision')db.prepare('UPDATE memories SET revision=? WHERE id=?').run(9007199254740993n,'memory-00139');
  });
  const io=Object.assign(Error('Synthetic seek-page I/O failure'),{code:'ERR_SQLITE_ERROR',errcode:10});
  if(kind.startsWith('rollback')) {
    const error=kind==='rollback-null'?null:kind==='rollback-primitive'?'synthetic-marker':kind==='rollback-arbitrary'?{marker:true}:io;
    const r=observe(db,[early,clean],{inject:error,rollback:true});
    assert.equal(r.caught,r.original,'original thrown object survives');assert.equal(r.baseWalks,1,'no base walk in autocommit');assert.equal(db.isTransaction,false);
  } else if(kind==='validation-error'||kind==='fallback-error') {
    const core=openMemoryCore({path:f.path,raw:true});t.after(()=>core.close());ok(core.fenceSession({namespace:ns,client:late.client,sessionId:late.sessionId}));
    const r=compare(t,db,kind,[clean,early,late],{code:'conversation_deleted',index:2},kind==='fallback-error'?{inject:io,fault:'union'}:{});
    assert.equal(r.baseWalks,kind==='fallback-error'?4:1,'only union errors restart the base loop');
  } else {
    const batch=kind==='composition'?[early,clean]:[early];
    const r=compare(t,db,kind,batch,kind==='composition'?accepted([1],[0]):accepted([],[0]),kind==='revision'?{}:{inject:io,fault:kind==='composition'?'union':'seek'});
    assert.equal(r.baseWalks,kind==='composition'?3:2,'union plus exact base restart');
  }
});

for(const raw of [false,true])test(`legacy top gate: Raw ${raw}`,async t=>{
  const f=safetyFixture(t,raw?18:18);
  const db=f.connect();t.after(()=>db.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,18);
  if(raw){const core=openMemoryCore({path:f.path,raw:true});t.after(()=>core.close());}
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,raw?29:18);
  compare(t,db,'10-legacy',[source('one'),source('two')],accepted([0,1]));
});

test('missing-layout top gate refuses before enumeration',t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const storage=createRawLineageStorage(db),batch=[source('one')];
  assert.equal(cachedContentLayout(db),undefined);
  assert.throws(()=>base(storage,db,batch),{code:'unsupported_database'});
  assert.throws(()=>storage.filter(ns,batch),{code:'unsupported_database'});
});

for(const kind of ['deleted','digest','memory','receipt','continuation'])for(const position of [0,1,2])test(`episode draftSnapshot: ${kind} at ${position}`,async t=>{
  const f=eventTimeSafetyFixture(t,33);await f.migrate();
  const runtime=createMemoryRuntime({path:f.path,sessionEpisodes:{mode:'episode-v1'}});t.after(()=>runtime.close());
  const db=f.connect();t.after(()=>db.close());
  const messages=Array.from({length:3},(_,i)=>({id:'message-'+i,role:'user',content:'Synthetic episode source '+i,occurredAt:null}));
  const batch={client:'claude-code',sessionId:'synthetic-episode-session',eventId:'episode-event',payloadDigest:digest(messages),generation:'initial',
    clientLabel:'Synthetic client',messages,view:{messages:messages.map(({occurredAt,...rest})=>rest),retainedSourceWindow:{maxUnitsPerMessage:800,truncatedMessageIndices:[]}}};
  const registered=runtime.reserveEpisodeBatch(ns,batch);
  const row=db.prepare('SELECT * FROM session_episodes WHERE id=?').get(registered.episodeId);
  const receipts=messages.map(m=>({client:batch.client,sessionId:row.session_key,eventId:m.id,role:m.role,excerpt:m.content}));
  transaction(db,()=>{
    for(const [i,r] of receipts.entries()) {
      const m=insert(db,i,r,{deleted:kind==='deleted'&&i===position?1:0,key:kind==='digest'&&i===position?'inconsistent-key':digest(r)});
      if(i===position&&['memory','receipt'].includes(kind))writeContentSuppressionInside(db,{namespace:ns,kind,key:kind==='memory'?m.id:m.rid,reason:'purge',actionId:'synthetic-episode'});
      if(i===position&&kind==='continuation') {
        for(let j=0;j<7;j++)insert(db,100+j,source('continuation-'+j),{parent:m.id});
        insert(db,108,r,{parent:m.id,key:'inconsistent-key'});
      }
    }
    for(let i=0;i<129;i++)insert(db,1000+i,source('filler-'+i));
  });
  const writer=runtime.claimEpisodeWriter(ns,{episodeId:row.id,generation:'initial'});
  const claim=runtime.claimEpisodeDraft(ns,{episodeId:row.id,generation:'initial',writerToken:writer.token,trigger:'batch',watermark:registered.position});
  installedContentLayout(db);
  const storage=createRawLineageStorage(db),seen=[];
  const episodes=createEpisodeStorage({db,options:{mode:'episode-v1'},stagedEvidence:createStagedEvidenceStorage({db}),sourceAuthority:{
    filter(namespace,batch) {
      assert.deepEqual(namespace,ns);assert.equal(db.isTransaction,true);
      const old=base(storage,db,batch),actual=storage.filter(namespace,batch);
      assert.deepEqual(actual,old,'episode source filter differential');seen.push({size:batch.length,base:old,change:actual});return actual;
    }
  }});
  const result=episodes.draftSnapshot(ns,{episodeId:row.id,token:claim.token});
  assert.deepEqual(result.events[0].sourceIndices,[0,1,2].filter(i=>i!==position),'episode base refusal preflight');
  assert.deepEqual(seen.map(c=>c.size),[0,3],'prior and staged caller reached');
  // The actual runtime facade must publish the same filtered draft.
  const actual=runtime.episodeDraftSnapshot(ns,{episodeId:row.id,token:claim.token});
  assert.deepEqual(actual.events.map(e=>e.sourceIndices),result.events.map(e=>e.sourceIndices));
  t.diagnostic(JSON.stringify({caller:'episode.draftSnapshot',kind,position,seen,sourceIndices:actual.events[0].sourceIndices}));
});

for(const snapshot of [false,true])for(const overlap of [false,true])test(`Raw range: ${snapshot?'snapshot':'writer'} ${overlap?'overlap':'adjacent'}`,async t=>{
  const f=eventTimeSafetyFixture(t,33);await f.migrate();
  const text='  Synthetic adjacent source.  ',r={...source('range'),excerpt:text.trim()};
  const core=openRawCaptureCore({path:f.path,model:{contextWindow:8192,countTokens:()=>1,extract:()=>({items:[]}),classify:()=>({items:[]})}},
    {mode:'raw-v1',port:localPlainPort(),readPolicy:()=>({generation:'synthetic',reason:null}),lineage:true});t.after(()=>core.close());
  const result=ok(await core.captureRaw(rawRequest(splitRaw(text,{id:r.eventId})[0],{namespace:ns,client:r.client,sessionId:r.sessionId})));
  ok(result.interpretation);
  const db=f.connect();t.after(()=>db.close());
  assert.equal(db.prepare('SELECT start FROM raw_source_maps WHERE message_id=?').get(r.eventId).start,2);
  transaction(db,()=>{
    db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,1)').run(result.raw.conversationId,r.eventId,0,overlap?3:2);
    if(!snapshot)for(let i=0;i<129;i++)insert(db,1000+i,source('filler-'+i));
  });
  const runtime=createMemoryRuntime({path:f.path});t.after(()=>runtime.close());
  compare(t,db,'5-range-'+(overlap?'overlap':'adjacent'),[r],overlap?accepted([],[0]):accepted([0]),{snapshot,runtime});
});

test('Raw forget within page bounds forces runtime writer route',async t=>{
  const f=eventTimeSafetyFixture(t,33);await f.migrate();
  const r=source('small-raw-forgot');
  const core=openRawCaptureCore({path:f.path,model:rationaleModel()},
    {mode:'raw-v1',port:localPlainPort(),readPolicy:()=>({generation:'synthetic',reason:null}),lineage:true});t.after(()=>core.close());
  const result=ok(ok(await core.captureRaw(rawRequest(splitRaw(r.excerpt,{id:r.eventId})[0],{namespace:ns,client:r.client,sessionId:r.sessionId}))).interpretation);
  const memory=ok(core.get({namespace:ns,memoryId:result.admission.memories[0].id})).memory;
  ok(core.forget({namespace:ns,memoryId:memory.id,expectedRevision:memory.revision}));
  const db=f.connect();t.after(()=>db.close());
  assert.ok(db.prepare('SELECT count(*) n FROM memories').get().n<128);
  assert.ok(db.prepare("SELECT count(*) n FROM content_suppressions WHERE kind='raw'").get().n>0);
  const runtime=createMemoryRuntime({path:f.path});t.after(()=>runtime.close());
  const clean=source('clean');
  for(const [label,batch,expected] of [
    ['first',[r,clean,clean],accepted([1,2],[0])],['middle',[clean,r,clean],accepted([0,2],[1])],
    ['last',[clean,clean,r],accepted([0,1],[2])],['all',[r,r,r],accepted([],[0,1,2])]]) {
    const actual=compare(t,db,'1a-forced-writer-'+label,batch,expected,{runtime});
    assert.ok(actual.union>0,'writer union actually ran');
    const caller=runtimeObserve(runtime,batch);assert.ok(caller.unionQueries>0,'runtime selected writer after snapshot overflow');
  }
});
