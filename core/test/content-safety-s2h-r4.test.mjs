import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { host as contextHost, query as contextQuery, refresh as contextRefresh } from '../testing/context-read-core-fixture.mjs';
import { transaction, readTransaction } from '../database.mjs';
import { contentReadSafety } from '../content-safety.mjs';
import { memorySuppressionObservationInside, writeContentSuppressionInside, suppressOwnerInside,
  withContentSuppressionRequest, withContentSuppressionReadInside } from '../content-suppression-storage.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';
import { suppressionFixture } from '../testing/content-suppression-fixture.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { request, splitRaw, localPlainPort } from '../testing/raw-capture-fixtures.mjs';
import { openProductIndex } from '../context-product-index.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { accessDigest } from '../context-product-validation.mjs';

const admit=(core,text,kind='fact')=>ok(core.admit({namespace:ns,memory:{content:text,kind},receipts:[receipt(text)]})).memory;
function product(t,f,maintenance,counter,semantic) {
  const facade=openContextProductFacade(f.path,{});t.after(()=>facade.close());
  const access={accessGenerations:accessDigest({ownerId:ns.ownerId,namespaces:{readSet:[ns]}}),check(){},envelope:f=>f()};
  const index=openProductIndex({path:f.path,facade,maintenance,counter,semantic,operation:()=>({operationCutoffMonoNs:String(process.hrtime.bigint()+5000000000n)}),authorize:()=>access,
    ownerCoverage:{policy:'recent-projects-v1',selectionRevision:'synthetic',requestedNamespaces:1,selectedNamespaces:1,omittedNamespaces:0}});
  t.after(()=>index.close());return index;
}
const refresh={readSet:[ns],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:1024,maxMs:5000}};

test('r4 Raw ancestry: cached predicate and observation refuse the same foreign lineage as the uncached path',async t=>{
  const f=safetyFixture(t,33);await f.migrate();const core=openMemoryCore({path:f.path}),db=f.connect();t.after(()=>{core.close();db.close();});
  const memory=admit(core,'Synthetic foreign ancestry'),other=admit(core,'Synthetic unrelated fact');
  const maintainer=product(t,f,true),trusted=contextHost();
  const legacy=openMemoryCore({path:f.path,contextRead:{version:'context-read-v1',authority:trusted.authority,counter:{id:'synthetic',countTokens:()=>1}}});t.after(()=>legacy.close());
  for(const intent of ['current','history']){
    ok(maintainer.run('refreshContextIndex',{...refresh,intent}));
    for(let i=0;i<30;i++)if(ok(await trusted.call(legacy,'refreshContextIndex',contextRefresh({intent}))).status==='complete')break;
  }
  transaction(db,()=>{
    db.prepare('INSERT INTO raw_conversations VALUES(?,?,?,?,?,?,1,?,?)').run('foreign-raw','foreign-synthetic',ns.scope,ns.projectId,'codex','foreign-session','time','time');
    const receiptId=db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(memory.id).id;
    db.prepare('INSERT INTO raw_receipt_lineage VALUES(?,?,?,?,?,?)').run(receiptId,'foreign-raw','message',0,2,'exact');
    writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:other.id,reason:'purge',actionId:'unrelated'});
  });
  const check=()=>{
    const result=contentReadSafety(db,{namespace:ns,ref:{type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision},intent:'history'});
    assert.equal(result.allowed,false,'foreign_ancestry_predicate');assert.equal(result.reason,'ineligible');
    assert.deepEqual(memorySuppressionObservationInside(db,ns,{memoryId:memory.id,revision:memory.revision}),{complete:false,cause:'unavailable'},'foreign_ancestry_observation');
  };
  readTransaction(db,check);
  withContentSuppressionRequest(()=>readTransaction(db,()=>withContentSuppressionReadInside(db,[ns],check)));
  let retainedDispatches=0;
  const reader=product(t,f,false,{id:'synthetic-counter',countTokens(text){if(text.includes('Synthetic foreign ancestry'))retainedDispatches++;return 1;}});
  for(const intent of ['current','history']){
    const candidates=ok(reader.run('findCandidates',{readSet:[ns],types:['memory'],intent,query:'foreign'}));
    assert.equal(candidates.items.length,0,'foreign_ancestry_candidates');
    const cachedLegacy=ok(await trusted.call(legacy,'findCandidates',contextQuery({intent,query:'foreign'})));
    assert.equal(cachedLegacy.items.length,0,'foreign_ancestry_legacy_candidates');
    const assembled=ok(reader.run('contextRead',{readSet:[ns],types:['memory'],intent,query:'foreign',budget:{maxItems:4,maxTokens:2000}}));
    assert.doesNotMatch(JSON.stringify(assembled),/Synthetic foreign ancestry/,'foreign_ancestry_body');
  }
  assert.equal(retainedDispatches,0,'foreign_ancestry_counter_dispatches');
});

for(const semanticEnabled of [false,true])test(`r4 unavailable ${semanticEnabled?'semantic':'lexical'} queries sanitize denied-population progress`,async t=>{
  const f=safetyFixture(t);await f.migrate();const core=openMemoryCore({path:f.path}),db=f.connect();t.after(()=>{core.close();db.close();});
  const memories=Array.from({length:3},(_,i)=>admit(core,'Synthetic denied population '+i));let erased=false,snapshots=0,dispatches=0;
  const erase=()=>{if(erased)return;transaction(db,()=>{for(const m of memories)writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:m.id,reason:'privacy_erase',actionId:m.id});});erased=true;};
  if(!semanticEnabled)erase();
  const maintainer=product(t,f,true);ok(maintainer.run('refreshContextIndex',{...refresh,budget:{maxItems:1,maxMs:5000}}));
  // Commit the semantic case's facts after enumeration and before delivery.
  const semantic=semanticEnabled?{async snapshot(){snapshots++;erase();return {policy:{semantic:false},identity:null};},call(){dispatches++;throw Error('unexpected_provider_dispatch');}}:undefined;
  const reader=product(t,f,false,undefined,semantic);
  for(const method of ['findCandidates','contextRead']){
    const input={readSet:[ns],types:['memory'],intent:'current',query:'unmatched',semantic:semanticEnabled,...(method==='contextRead'?{budget:{maxItems:4,maxTokens:2000}}:{})};
    const result=await reader.run(method,input);assert.equal(result.ok,false);assert.equal(result.error.code,'index_unavailable');
    const details=method==='contextRead'?result.error.details.candidates:result.error.details;
    assert.equal(details.coverage.maintenance.progress,null,'unavailable_progress');
    assert.equal(details.coverage.byType.memory.eligible,null);assert.equal(details.coverage.byType.memory.indexed,null);
  }
  assert.equal(snapshots,semanticEnabled?2:0);assert.equal(dispatches,0);
});
test('r4 unavailable query envelopes have one shared sanitized builder',()=>{
  const source=readFileSync(new URL('../context-product-index.mjs',import.meta.url),'utf8');
  assert.equal([...source.matchAll(/code\s*:\s*(['"])index_unavailable\1/g)].length,1,'single_unavailable_envelope');
});

for(const mode of ['message','span','corrected-message'])test(`r4 Raw capture accepts an unrelated ${mode} in an excluded conversation`,async t=>{
  const sameMessage=mode==='span';
  const f=safetyFixture(t,33);await f.migrate();const db=f.connect();let serial=0;
  const core=openRawCaptureCore({path:f.path,model:{contextWindow:8192,countTokens:()=>1,extract:()=>({items:[{content:'Synthetic interpreted '+serial++,kind:'fact',confidence:.8,sourceIndices:[0]}]})}},
    {mode:'raw-v1',deletion:true,port:localPlainPort(),readPolicy:()=>({generation:'synthetic',reason:null})});t.after(()=>{core.close();db.close();});
  const parts=splitRaw(sameMessage?'x'.repeat(6000):'Synthetic first message');
  const first=ok(await core.captureRaw(request(parts[0],{namespace:ns,sessionId:'same-conversation',eventId:'first'})));
  if(mode==='corrected-message'){
    const memory=ok(first.interpretation).admission.memories[0];
    ok(core.correct({namespace:ns,memoryId:memory.id,expectedRevision:memory.revision,content:'Synthetic corrected interpretation',kind:'fact',receipt:receipt('correction')}));
    assert.equal(db.prepare("SELECT count(*) n FROM content_suppressions WHERE kind='raw' AND match_mode='span'").get().n,1);
  }else transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'raw',key:first.raw.conversationId,matchMode:'span',messageId:parts[0].id,start:0,end:1,reason:'correction_supersession',actionId:'first-span'}));
  const second=sameMessage?parts[1]:{...splitRaw('Synthetic second message')[0],id:'second-message',messageOrdinal:2};
  const saved=ok(await core.captureRaw(request(second,{namespace:ns,sessionId:'same-conversation',eventId:'second'})));
  assert.equal(saved.raw.conversationId,first.raw.conversationId);assert.equal(saved.raw.parts[0].saved,true,'unrelated_raw_capture');
  assert.equal(db.prepare('SELECT count(*) n FROM raw_parts WHERE conversation_id=?').get(first.raw.conversationId).n,2);
  const before=db.prepare('SELECT count(*) n FROM raw_events').get().n;
  const denied=await core.captureRaw(request(parts[0],{namespace:ns,sessionId:'same-conversation',eventId:'first'}));
  assert.equal(denied.ok,false);assert.equal(db.prepare('SELECT count(*) n FROM raw_events').get().n,before);
});

test('r4 owner erasure lookup charges every visited purge fact and refuses at the row budget',async t=>{
  const f=await suppressionFixture(t);
  transaction(f.db,()=>{for(let i=0;i<10000;i++)suppressOwnerInside(f.db,{ownerId:ns.ownerId,reason:'purge',actionId:'owner-purge-'+i});});
  const {handle}=await f.reader();let visits=0;const prepare=DatabaseSync.prototype.prepare,seen=new WeakSet();
  DatabaseSync.prototype.prepare=function(sql){
    if(!/FROM content_suppressions\b/.test(sql))return prepare.call(this,sql);
    if(!seen.has(this)){this.function('r4_visit',_id=>{visits++;return 1;});seen.add(this);}
    return prepare.call(this,sql.replace(/\bWHERE\b/g,'WHERE r4_visit(fact_id)=1 AND '));
  };
  let result;
  try{result=await handle.listSuppressionsSince(ns.ownerId,'10000',{expected:f.checkpoint(10000),limit:1},f.credential);}
  finally{DatabaseSync.prototype.prepare=prepare;}
  t.diagnostic('charged owner-fact visits='+visits);assert.ok(visits<=8193,'visited_owner_facts='+visits);
  assert.equal(result.ok,false,'purge_history_budget');assert.equal(result.error.code,'context_item_too_large');
});

for(const mode of ['default','off','raw-v1'])test(`r4 paused capture ${mode} returns only failed-classification control through every facade after close`,async t=>{
  const f=safetyFixture(t,mode==='default'?18:33);if(mode!=='default')await f.migrate();let enter,release;
  const raw=mode==='default'?{}:{rawConversations:{mode,readPolicy:()=>({generation:'synthetic',reason:null}),...(mode==='raw-v1'?{port:localPlainPort(),capBytes:1048576}:{})}};
  const started=new Promise(resolve=>{enter=resolve;}),core=openMemoryCore({path:f.path,...raw,model:{contextWindow:8192,countTokens:()=>1,
    extract:()=>({items:[{content:'Synthetic paused retained body',kind:'fact',confidence:.8,sourceIndices:[0]}]}),classify:()=>{enter();return new Promise(resolve=>{release=resolve;});}}});
  t.after(()=>core.close());
  const pending=core.capture({namespace:ns,client:'synthetic',sessionId:'paused',eventId:'paused',messages:[{id:'message',role:'user',content:'Synthetic paused input'}]});
  await Promise.race([started,pending.then(value=>{throw Error('capture_settled_before_classifier '+JSON.stringify(value));})]);
  const db=f.connect(),id=db.prepare('SELECT id FROM memories').get().id;db.close();core.close();release({items:[]});
  const result=await pending;assert.deepEqual(result,{ok:true,value:{classification:{status:'failed'}}},'closed_capture_control');
  assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.value)&&Object.isFrozen(result.value.classification),'immutable_control');
  assert.doesNotMatch(JSON.stringify(result),/memory|receipt|revision|Synthetic|admission/i);assert.ok(!JSON.stringify(result).includes(id));
  assert.equal(core.get({namespace:ns,memoryId:id}).ok,false);
});

// R2 statement counts now live in content-safety-s2h-query-cost.test.mjs,
// including the stricter zero-fact budget and all three safety cells.
