import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';
import { suppressionFixture } from '../testing/content-suppression-fixture.mjs';
import { cardHost } from '../testing/raw-source-fixtures.mjs';
import { host as contextHost } from '../testing/context-read-core-fixture.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { request, splitRaw, localPlainPort } from '../testing/raw-capture-fixtures.mjs';
import { openMemoryCore } from '../index.mjs';
import { createOperationLedger } from '../private-operation-helpers.mjs';
import { contentReadSafety } from '../content-safety.mjs';
import { attestContentSafety } from '../content-safety-schema.mjs';
import { transaction, readTransaction } from '../database.mjs';
import { writeContentSuppressionInside, suppressOwnerInside } from '../content-suppression-storage.mjs';
import { productSidecar } from '../context-product-sidecar.mjs';
import { openProductIndex } from '../context-product-index.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import * as suppressionStorage from '../content-suppression-storage.mjs';
// Historical runtimes have no request memo: the same count assertions exercise
// their uncached predicate path rather than failing at module linkage.
const withContentSuppressionRequest=suppressionStorage.withContentSuppressionRequest??(work=>work());
const withContentSuppressionReadInside=suppressionStorage.withContentSuppressionReadInside??((_db,_set,work)=>work({facts:null}));
const inContentSuppressionRequestInside=suppressionStorage.inContentSuppressionRequestInside??((_db,work)=>work());
import { accessDigest } from '../context-product-validation.mjs';

const query={readSet:[ns],types:['memory'],intent:'current',query:'synthetic',limit:12};
const refresh={readSet:[ns],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:1024,maxMs:5000}};
function index(t,f){
  const facade=openContextProductFacade(f.path,{});t.after(()=>facade.close());
  const access={accessGenerations:accessDigest({ownerId:ns.ownerId,namespaces:{readSet:[ns]}}),check(){},envelope:f=>f()};
  const common={path:f.path,facade,authorize:()=>access,ownerCoverage:{policy:'recent-projects-v1',selectionRevision:'synthetic',requestedNamespaces:1,selectedNamespaces:1,omittedNamespaces:0}};
  const maintainer=openProductIndex({...common,maintenance:true});t.after(()=>maintainer.close());return maintainer;
}
test('r3 isolation: fixture copies never run in a SQLite-holding parent',async t=>{
  const first=safetyFixture(t),db=first.connect();t.after(()=>db.close());
  const copy=fs.copyFileSync,read=fs.readFileSync;let attempted=0;
  fs.copyFileSync=(...args)=>{attempted++;throw Error('parent_sqlite_file_access');};
  fs.readFileSync=(path,...args)=>{if(String(path).endsWith('.sqlite')){attempted++;throw Error('parent_sqlite_file_access');}return read(path,...args);};
  syncBuiltinESMExports();
  try{const second=safetyFixture(t);await second.migrate();assert.equal(attempted,0);}
  finally{fs.copyFileSync=copy;fs.readFileSync=read;syncBuiltinESMExports();}
});
for(const deletedEpoch of [1,2])test(`r3 contiguity: missing epoch ${deletedEpoch} refuses batch and matching list window`,async t=>{
  const f=await suppressionFixture(t),items=['one','two','three'].map(x=>f.descriptor(f.memory('Synthetic gap '+x)));
  for(const item of items)f.fact(item);
  const {handle}=await f.reader(),options={expected:f.checkpoint(0),limit:1};
  assert.equal(ok(await handle.isSuppressed(ns.ownerId,[items[deletedEpoch-1]],options,f.credential)).results[0].suppressed,true);
  const guard=f.db.prepare("SELECT sql FROM sqlite_schema WHERE name='safety_suppression_delete'").get().sql;
  f.db.exec('DROP TRIGGER safety_suppression_delete');f.db.prepare('DELETE FROM content_suppressions WHERE epoch_lo=?').run(deletedEpoch);f.db.exec(guard);
  assert.equal((await handle.isSuppressed(ns.ownerId,[items[deletedEpoch-1]],options,f.credential)).ok,false,'interior_gap_batch');
  const start=String(deletedEpoch-1);
  assert.equal((await handle.listSuppressionsSince(ns.ownerId,start,{...options,expected:f.checkpoint(start)},f.credential)).ok,false,'interior_gap_list');
});
test('r3 contiguity: 2048 epochs succeed, 2049 refuse, and current checkpoint succeeds',async t=>{
  const f=await suppressionFixture(t),a=f.descriptor(f.memory('Synthetic capped source'));
  transaction(f.db,()=>{for(let i=0;i<2048;i++)writeContentSuppressionInside(f.db,{namespace:ns,kind:'memory',key:a.key,reason:'purge',actionId:'cap-'+i});});
  const {handle}=await f.reader();
  assert.equal(ok(await handle.isSuppressed(ns.ownerId,[a],{expected:f.checkpoint(0),limit:1},f.credential)).results[0].suppressed,true);
  f.fact(a);
  assert.equal((await handle.isSuppressed(ns.ownerId,[a],{expected:f.checkpoint(0),limit:1},f.credential)).ok,false,'batch_contiguity_cap');
  assert.equal(ok(await handle.isSuppressed(ns.ownerId,[a],{expected:f.checkpoint(2049),limit:1},f.credential)).results[0].suppressed,true);
});
test('r3 cached batch checks its original dense interval after guard restoration',async t=>{
  const f=await suppressionFixture(t),a=f.descriptor(f.memory('Synthetic cache interval'));
  for(let i=0;i<3;i++)f.fact(a);
  const inputs=['one','two'].map(x=>f.descriptor(f.memory('Synthetic cached independent '+x))),{handle}=await f.reader();
  const options={expected:f.checkpoint(0),limit:1},first=ok(await handle.isSuppressed(ns.ownerId,inputs,options,f.credential));assert.ok(first.nextCursor);
  const guard=f.db.prepare("SELECT sql FROM sqlite_schema WHERE name='safety_suppression_delete'").get().sql;
  f.db.exec('DROP TRIGGER safety_suppression_delete');f.db.prepare('DELETE FROM content_suppressions WHERE epoch_lo=2').run();f.db.exec(guard);
  const result=await handle.isSuppressed(ns.ownerId,inputs,{...options,cursor:first.nextCursor},f.credential);
  assert.equal(result.ok,false,'cached_interval_gap');
});
test('r3 cached batch keeps its fixed observed interval when later facts exceed the catch-up cap',async t=>{
  const f=await suppressionFixture(t),a=f.descriptor(f.memory('Synthetic cached growth'));f.fact(a);
  const inputs=['one','two'].map(x=>f.descriptor(f.memory('Synthetic fixed interval '+x))),{handle}=await f.reader();
  const options={expected:f.checkpoint(0),limit:1},first=ok(await handle.isSuppressed(ns.ownerId,inputs,options,f.credential));
  transaction(f.db,()=>{for(let i=0;i<2048;i++)writeContentSuppressionInside(f.db,{namespace:ns,kind:'memory',key:a.key,reason:'purge',actionId:'later-'+i});});
  const next=ok(await handle.isSuppressed(ns.ownerId,inputs,{...options,cursor:first.nextCursor},f.credential));
  assert.equal(next.observedEpoch,'1');assert.equal(next.results[0].suppressed,false);
});
test('r3 pull plans and actual owner-history visits stay bounded at checkpoint 10000',async t=>{
  const f=await suppressionFixture(t),a=f.descriptor(f.memory('Synthetic history'));
  transaction(f.db,()=>{for(let i=0;i<10000;i++)writeContentSuppressionInside(f.db,{namespace:ns,kind:'memory',key:a.key,reason:'purge',actionId:'history-'+i});});
  const inputs=['b','c'].map(x=>f.descriptor(f.memory('Synthetic independent '+x))),{handle}=await f.reader();
  const options={expected:f.checkpoint(10000),limit:1};let first;
  let visits=0;const plans=[];f.db.function('s2h_visit',_fact=>{visits++;return 1;});const metered=new WeakSet();
  const prepare=DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare=function(sql){
    if(!/FROM content_suppressions\b/.test(sql))return prepare.call(this,sql);
    if(!metered.has(this)){this.function('s2h_visit',_fact=>{visits++;return 1;});metered.add(this);}
    const instrumented=sql.replace(/\bWHERE\b/g,'WHERE s2h_visit(fact_id)=1 AND ');
    const statement=prepare.call(this,instrumented),db=this;
    return new Proxy(statement,{get(target,key){const value=Reflect.get(target,key,target);if(!['get','all'].includes(key))return typeof value==='function'?value.bind(target):value;
      return(...args)=>{plans.push(...prepare.call(db,'EXPLAIN QUERY PLAN '+sql).all(...args).map(r=>r.detail));return value.apply(target,args);};}});
  };
  let listed,batch;
  try{first=ok(await handle.isSuppressed(ns.ownerId,inputs,options,f.credential));listed=await handle.listSuppressionsSince(ns.ownerId,'10000',options,f.credential);batch=await handle.isSuppressed(ns.ownerId,inputs,{...options,cursor:first.nextCursor},f.credential);}
  finally{DatabaseSync.prototype.prepare=prepare;}
  assert.equal(listed.ok,true,JSON.stringify(listed));assert.equal(batch.ok,true,JSON.stringify(batch));assert.ok(visits<=32,'visited_suppression_facts='+visits);
  assert.ok(plans.some(p=>p.includes('content_suppression_target')));
  assert.ok(plans.every(p=>!p.includes('SCAN content_suppressions')&&!/USING PRIMARY KEY \(owner_id=\?\)$/.test(p)),JSON.stringify(plans));
  for(const plan of plans.filter(p=>p.includes('content_suppression_target')))
    assert.match(plan,/owner_id=\? AND scope=\? AND project_id=\? AND kind=\? AND stable_key=\? AND incarnation=\?/);
  t.diagnostic('actual suppression-fact visits='+visits);
});
for(const mode of ['owner','namespace','item'])test(`r3 maintainer ${mode}: work stays available while population delivery refuses`,async t=>{
  const f=safetyFixture(t);await f.migrate();const core=openMemoryCore({path:f.path}),db=f.connect();t.after(()=>{core.close();db.close();});
  const ids=[];for(let i=0;i<3;i++)ids.push(ok(core.admit({namespace:ns,memory:{content:'Synthetic population '+i,kind:'fact'},receipts:[receipt('population-'+i)]})).memory.id);
  const maintenance=index(t,f);for(let i=0;i<20;i++)if(ok(maintenance.run('refreshContextIndex',refresh)).status==='complete')break;
  transaction(db,()=>mode==='owner'?suppressOwnerInside(db,{ownerId:ns.ownerId,reason:'account_erasure',actionId:'erase'}):
    writeContentSuppressionInside(db,{namespace:ns,kind:mode==='namespace'?'namespace':'memory',key:mode==='namespace'?'':ids[0],matchMode:mode==='namespace'?'namespace':'incarnation',reason:'privacy_erase',actionId:'erase'}));
  for(const [method,input]of [['refreshContextIndex',refresh],['getContextIndexStatus',{readSet:[ns],types:['memory'],intent:'current'}]]){
    const result=maintenance.run(method,input);
    if(mode==='item'){
      assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.value.coverage.byType.memory.eligible,2,'maintenance_filtered_population');
      assert.equal(result.value.coverage.byType.memory.indexed,2);
      if(method==='refreshContextIndex')assert.deepEqual(result.value.progress,{lexical:null,transformed:null,embeddingAttempts:null,embedded:null});
    }else{assert.equal(result.ok,false,'maintenance_population_'+mode);assert.doesNotMatch(JSON.stringify(result),/eligible|indexed|transformed|coverage|progress/);}
  }
  maintenance.close();
  const facade=openContextProductFacade(f.path,{});t.after(()=>facade.close());
  const storage=productSidecar({path:f.path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,writable:true});t.after(()=>storage.close());
  storage.reset();assert.equal(storage.vectors(side=>side.prepare('SELECT count(*) n FROM documents').get().n),0,'trusted_cleanup_remains_available');
});
test('r3 legacy maintainer with item facts hides physical usage and preserves readable queries',async t=>{
  const f=safetyFixture(t);await f.migrate();const host=contextHost(),core=openMemoryCore({path:f.path,contextRead:{version:'context-read-v1',authority:host.authority}}),db=f.connect();t.after(()=>{core.close();db.close();});
  const memories=[];for(let i=0;i<3;i++)memories.push(ok(core.admit({namespace:ns,memory:{content:'Synthetic legacy population '+i,kind:'fact'},receipts:[receipt('legacy-'+i)]})).memory);
  const input={readSet:[ns],types:['memory'],intent:'current',budget:{maxItems:1024,maxMs:5000}};
  for(let i=0;i<20;i++)if(ok(await host.call(core,'refreshContextIndex',input)).status==='complete')break;
  transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:memories[0].id,reason:'privacy_erase',actionId:'legacy-item'}));
  const result=await host.call(core,'refreshContextIndex',input);assert.equal(result.ok,false,'legacy_maintenance_population');
  assert.doesNotMatch(JSON.stringify(result),/eligible|indexed|transformed|coverage|progress/);
  const found=ok(await host.call(core,'findCandidates',{readSet:[ns],types:['memory'],intent:'current',query:'Synthetic legacy population'}));
  assert.equal(found.items.length,2);assert.ok(!JSON.stringify(found).includes(memories[0].id));
});
test('r3 admission: suppressed fingerprint never deduplicates or acknowledges an existing identity',async t=>{
  const f=safetyFixture(t);await f.migrate();const core=openMemoryCore({path:f.path}),db=f.connect();t.after(()=>{core.close();db.close();});
  const body={content:'Synthetic dedup source',kind:'fact'},memory=ok(core.admit({namespace:ns,memory:body,receipts:[receipt('first')]})).memory;
  transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:memory.id,reason:'privacy_erase',actionId:'erase'}));
  const before=db.prepare('SELECT revision FROM memories WHERE id=?').get(memory.id).revision;
  const result=core.admit({namespace:ns,memory:body,receipts:[receipt('second')]});
  assert.equal(result.ok,false,'suppressed_dedup');assert.equal(result.error.code,'memory_suppressed');
  assert.ok(!JSON.stringify(result).includes(memory.id));assert.doesNotMatch(JSON.stringify(result),/revision|deduplicated/);
  assert.equal(db.prepare('SELECT revision FROM memories WHERE id=?').get(memory.id).revision,before);
  assert.equal(db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(memory.id).n,1);
});
test('r3 admission capture and replay: suppressed Memory ids never leave a completed job',async t=>{
  const f=safetyFixture(t);await f.migrate();let calls=0;
  const core=openMemoryCore({path:f.path,model:{contextWindow:8192,countTokens:()=>1,extract:()=>{calls++;return {items:[{content:'Synthetic inferred repeated body',kind:'fact',confidence:.8,sourceIndices:[0]}]};}}}),db=f.connect();t.after(()=>{core.close();db.close();});
  const input={namespace:ns,client:'synthetic',sessionId:'capture',eventId:'first',messages:[{id:'first',role:'user',content:'Synthetic input'}]};
  const first=ok(await core.capture(input)),memory=first.admission.memories[0];
  transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:memory.id,reason:'privacy_erase',actionId:'erase'}));
  await t.test('completed replay',async()=>{const replay=await core.capture(input);assert.equal(replay.ok,false,'admission_replay_safety');assert.ok(!JSON.stringify(replay).includes(memory.id));assert.equal(calls,1);});
  await t.test('new inferred duplicate',async()=>{const next=ok(await core.capture({...input,eventId:'second',messages:[{id:'second',role:'user',content:'Synthetic input again'}]}));
    assert.equal(next.admission.suppressedCount,1);assert.deepEqual(next.admission.memories,[]);assert.ok(!JSON.stringify(next).includes(memory.id));});
});
test('r3 private replay and upsert: suppressed Card targets refuse before mutation',async t=>{
  const f=safetyFixture(t,23);await f.migrate();const host=cardHost(),core=openMemoryCore({path:f.path,privateCards:host.options}),db=f.connect();t.after(()=>{core.close();db.close();});
  const input={namespace:ns,actionId:'draft',drafting:'authored',input:{title:'Synthetic private target',body:'Synthetic private body',authoredInput:{text:'Synthetic support',occurredAt:null}}};
  let card=ok(host.call(core,'createCardDraft',input));
  const originalSource=JSON.parse(db.prepare('SELECT source_ref FROM card_bindings WHERE card_id=?').get(card.id).source_ref);
  card=ok(host.call(core,'editCardDraft',{namespace:ns,cardId:card.id,expectedRevision:card.revision,actionId:'positive-edit',title:'Synthetic edit',body:'Synthetic edit body',bindings:[originalSource]}));
  transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'card',key:card.id,reason:'purge',actionId:'erase'}));
  await t.test('creation replay',()=>{const replay=host.call(core,'createCardDraft',input);assert.equal(replay.ok,false,'private_replay_safety');assert.ok(!JSON.stringify(replay).includes(card.id));});
  const source=JSON.parse(db.prepare('SELECT source_ref FROM card_bindings WHERE card_id=?').get(card.id).source_ref);
  await t.test('draft upsert',()=>{const edit=host.call(core,'editCardDraft',{namespace:ns,cardId:card.id,expectedRevision:card.revision,actionId:'edit',title:'Synthetic replacement',body:'Synthetic replacement body',bindings:[source]});
  assert.equal(edit.ok,false,'private_upsert_safety');assert.equal(db.prepare('SELECT revision FROM private_cards WHERE id=?').get(card.id).revision,card.revision);});
});
test('r3 Raw replay: a completed interpretation cannot return a suppressed Memory id',async t=>{
  const f=safetyFixture(t,33);await f.migrate();let calls=0;
  const core=openRawCaptureCore({path:f.path,model:{contextWindow:8192,countTokens:()=>1,extract:()=>{calls++;return {items:[{content:'Synthetic Raw-derived value',kind:'fact',confidence:.8,sourceIndices:[0]}]};}}},
    {mode:'raw-v1',deletion:true,port:localPlainPort(),readPolicy:()=>({generation:'synthetic',reason:null})});
  const db=f.connect();t.after(()=>{core.close();db.close();});
  const input=request(splitRaw('Synthetic Raw replay input')[0],{namespace:ns,sessionId:'raw-replay',eventId:'raw-replay'}),first=ok(await core.captureRaw(input)),memory=ok(first.interpretation).admission.memories[0];
  transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:memory.id,reason:'privacy_erase',actionId:'erase'}));
  const replay=await core.captureRaw(input);assert.ok(!JSON.stringify(replay).includes(memory.id),'raw_replay_safety');assert.equal(calls,1);
});
test('r3 note replay: pending note facts hide an earlier source acknowledgement',async t=>{
  const f=safetyFixture(t,23);await f.migrate();const host=cardHost(),core=openMemoryCore({path:f.path,privateCards:host.options}),db=f.connect();t.after(()=>{core.close();db.close();});
  const input={namespace:ns,actionId:'note-replay',text:'Synthetic retained note',occurredAt:null},source=ok(host.call(core,'submitSourceNote',input)).source;
  transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'submitted-note',key:source.sourceId,reason:'privacy_erase',actionId:'erase'}));
  const result=host.call(core,'submitSourceNote',input);assert.equal(result.ok,false,'note_replay_safety');assert.ok(!JSON.stringify(result).includes(source.sourceId));
});
for(const method of ['importMethodVersion','importAssetVersion','publishRoleProfileRelease'])test(`r3 ${method} ledger replay checks bound reason identities`,async t=>{
  const f=safetyFixture(t);await f.migrate();const core=openMemoryCore({path:f.path}),db=f.connect();t.after(()=>{core.close();db.close();});
  const memory=ok(core.admit({namespace:ns,memory:{content:'Synthetic ledger reason',kind:'fact'},receipts:[receipt('ledger')]})).memory;
  db.exec('CREATE TABLE r3_replays(owner_id TEXT,scope TEXT,project_id TEXT,action_id TEXT,method TEXT,payload_binding TEXT,target_id TEXT,result TEXT,created_at TEXT) STRICT');
  const ledger=createOperationLedger(db,'r3_replays'),input={reasonRefs:[{type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision}]};
  transaction(db,()=>ledger.record(ns,'action',method,'binding','synthetic-target',{accepted:true},'time'));
  assert.deepEqual(transaction(db,()=>ledger.replay(ns,'action',method,'binding',input)),{accepted:true});
  transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:memory.id,reason:'privacy_erase',actionId:'erase'}));
  assert.throws(()=>transaction(db,()=>ledger.replay(ns,'action',method,'binding',input)),{code:'evidence_unavailable'},'bound_reason_replay');
});
test('r3 request facts: reuse only within one request and use indexed fallback above 4096',async t=>{
  const f=safetyFixture(t);await f.migrate();const core=openMemoryCore({path:f.path}),db=f.connect();t.after(()=>{core.close();db.close();});
  const memory=ok(core.admit({namespace:ns,memory:{content:'Synthetic memo source',kind:'fact'},receipts:[receipt('memo')]})).memory;
  transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:memory.id,reason:'purge',actionId:'memo-first'}));
  attestContentSafety(db);let sets=0,headers=0,seeks=0;const prepare=DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare=function(sql){const statement=prepare.call(this,sql);
    return new Proxy(statement,{get(target,key){const value=Reflect.get(target,key,target);
      return typeof value!=='function'?value:(...args)=>{
        if(['get','all','run','iterate'].includes(key)){
          if(/SELECT \* FROM content_suppressions INDEXED BY content_suppression_target/.test(sql))sets++;
          if(/schema_version AS cookie/.test(sql))headers++;if(/AS ancestry/.test(sql))seeks++;
        }
        return value.apply(target,args);
      };}});};
  try{
    for(let request=0;request<2;request++)withContentSuppressionRequest(()=>{
      readTransaction(db,()=>withContentSuppressionReadInside(db,[ns],()=>{
        for(let i=0;i<30;i++)assert.equal(contentReadSafety(db,{namespace:ns,ref:{type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision}}).allowed,false);
      }));
      readTransaction(db,()=>inContentSuppressionRequestInside(db,()=>{
        for(let i=0;i<30;i++)assert.equal(contentReadSafety(db,{namespace:ns,ref:{type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision}}).allowed,false);
      }));
    });
    assert.equal(headers,2,'one header per request; the public delivery boundary owns the independent final fence');
    assert.equal(sets,4,'two scoped range reads per request, never per item or snapshot');assert.equal(seeks,0);
  }finally{DatabaseSync.prototype.prepare=prepare;}
  transaction(db,()=>{for(let i=0;i<4096;i++)writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:memory.id,reason:'purge',actionId:'memo-cap-'+i});});
  readTransaction(db,()=>withContentSuppressionReadInside(db,[ns],memo=>{
    assert.equal(memo.facts,null);assert.equal(contentReadSafety(db,{namespace:ns,ref:{type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision}}).allowed,false);
  }));
});
for(const method of ['correct','supersede','setProceduralMemory'])test(`r3 existing Memory ${method} refuses suppressed targets before writing`,async t=>{
  const f=safetyFixture(t);await f.migrate();const core=openMemoryCore({path:f.path}),db=f.connect();t.after(()=>{core.close();db.close();});
  const memory=ok(core.admit({namespace:ns,memory:{content:'Synthetic existing write target',kind:'fact'},receipts:[receipt('target')]})).memory;
  transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:memory.id,reason:'privacy_erase',actionId:'erase'}));
  const base={namespace:ns,memoryId:memory.id,expectedRevision:memory.revision};
  const input=method==='correct'?{...base,content:'Synthetic replacement value',kind:'fact',receipt:receipt('replacement')}:
    method==='supersede'?{...base,replacement:{content:'Synthetic replacement value',kind:'fact'},receipts:[receipt('replacement')]}:
    {...base,expectedTagRevision:0,procedural:null};
  const result=core[method](input);assert.equal(result.ok,false,'existing_target_'+method);assert.ok(!JSON.stringify(result).includes(memory.id));
  assert.equal(db.prepare('SELECT revision FROM memories WHERE id=?').get(memory.id).revision,memory.revision);
  assert.equal(db.prepare('SELECT count(*) n FROM memories').get().n,1);
});
for(const method of ['bindQualifiedClaim','transitionQualified','transitionQualifiedSet'])test(`r3 existing Memory ${method} checks every bound claim before reuse`,async t=>{
  const f=safetyFixture(t);await f.migrate();const core=openMemoryCore({path:f.path}),db=f.connect();t.after(()=>{core.close();db.close();});
  const admit=value=>{const text='Synthetic qualified value '+value;return ok(core.admit({namespace:ns,memory:{content:text,kind:'fact'},receipts:[{...receipt(value),excerpt:text}],
    qualification:{version:1,slot:{subject:'Synthetic subject',property:'deadline',scope:'synthetic',applies:'current'},value,attribution:'direct',commitment:'adopted',
      anchors:[{receiptIndex:0,start:0,end:text.length,text,fields:['subject','property','scope','applies','value','attribution','commitment']}]}})).memory;};
  const previous=admit('Friday'),replacement=admit('Monday'),ref=m=>({memoryId:m.id,expectedRevision:m.revision});
  const bind=m=>({namespace:ns,...ref(m),slotId:null,singleClaim:true}),slot=ok(core.bindQualifiedClaim(bind(previous))).slotId;
  ok(core.bindQualifiedClaim({...bind(replacement),slotId:slot}));
  transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:previous.id,reason:'privacy_erase',actionId:'erase'}));
  const input=method==='bindQualifiedClaim'?bind(previous):method==='transitionQualified'?{namespace:ns,predecessor:ref(previous),replacement:ref(replacement)}:
    {namespace:ns,predecessors:[ref(previous)],replacement:ref(replacement)};
  const result=core[method](input);assert.equal(result.ok,false,'existing_bound_claim_'+method);assert.equal(result.error.code,'memory_suppressed');
  assert.ok(!JSON.stringify(result).includes(previous.id));assert.equal(db.prepare('SELECT revision FROM memories WHERE id=?').get(previous.id).revision,previous.revision);
  assert.equal(db.prepare('SELECT count(*) n FROM qualified_claim_bindings').get().n,2);
});
test('r3 confirmation checks fresh targets and bound replay revisions inside its transaction',async t=>{
  const f=safetyFixture(t);await f.migrate();const core=openMemoryCore({path:f.path,decisionReview:'required-v1',model:{contextWindow:8192,countTokens:()=>1,
    extract:({input})=>({items:[{content:input.messages[0].content,kind:'decision',confidence:.8,sourceIndices:[0]}]})}}),db=f.connect();t.after(()=>{core.close();db.close();});
  const capture=async eventId=>ok(await core.capture({namespace:ns,client:'synthetic',sessionId:'review',eventId,messages:[{id:eventId,role:'user',content:'Synthetic confirmation '+eventId}]})).admission.memories[0];
  const first=await capture('first'),input={namespace:ns,memoryId:first.id,expectedRevision:first.revision,actionId:'confirm-first',receipt:receipt('confirm-first')};
  ok(core.confirm(input));transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:first.id,reason:'privacy_erase',actionId:'erase-first'}));
  const replay=core.confirm(input);assert.equal(replay.ok,false,'confirmation_replay');assert.ok(!JSON.stringify(replay).includes(first.id));
  const second=await capture('second');transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:second.id,reason:'privacy_erase',actionId:'erase-second'}));
  const result=core.confirm({...input,memoryId:second.id,expectedRevision:second.revision,actionId:'confirm-second',receipt:receipt('confirm-second')});
  assert.equal(result.ok,false,'confirmation_target');assert.equal(db.prepare('SELECT revision FROM memories WHERE id=?').get(second.id).revision,second.revision);
});
for(const method of ['admit','correct','supersede'])test(`r3 existing Memory ${method} rolls back a newly suppressed resulting revision`,async t=>{
  const f=safetyFixture(t);await f.migrate();const core=openMemoryCore({path:f.path}),db=f.connect();t.after(()=>{core.close();db.close();});
  const content='Synthetic revision target',memory=ok(core.admit({namespace:ns,memory:{content,kind:'fact'},receipts:[receipt('original')]})).memory;
  transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:memory.id,matchMode:'version',
    sourceVersion:JSON.stringify(['memory-revision-v1',2]),reason:'privacy_erase',actionId:'future'}));
  const input=method==='admit'?{namespace:ns,memory:{content,kind:'fact'},receipts:[receipt('new')]}:method==='correct'?
    {namespace:ns,memoryId:memory.id,expectedRevision:1,content:'Synthetic changed value',kind:'fact',receipt:receipt('changed')}:
    {namespace:ns,memoryId:memory.id,expectedRevision:1,replacement:{content:'Synthetic replacement',kind:'fact'},receipts:[receipt('replacement')]};
  const result=core[method](input);assert.equal(result.ok,false,'resulting_revision_'+method);assert.ok(!JSON.stringify(result).includes(memory.id));
  assert.equal(db.prepare('SELECT revision FROM memories WHERE id=?').get(memory.id).revision,1);assert.equal(db.prepare('SELECT count(*) n FROM memories').get().n,1);
  assert.equal(db.prepare('SELECT count(*) n FROM content_suppressions').get().n,1);
});
test('r3 confirmation checks identities in dependent transition acknowledgements before commit',async t=>{
  const f=safetyFixture(t);await f.migrate();const core=openMemoryCore({path:f.path,decisionReview:'required-v1',model:{contextWindow:8192,countTokens:()=>1,
    extract:()=>({items:[{content:'Synthetic held replacement',kind:'decision',confidence:.8,sourceIndices:[0]}]})}}),db=f.connect();t.after(()=>{core.close();db.close();});
  const previous=ok(core.admit({namespace:ns,memory:{content:'Synthetic held predecessor',kind:'fact'},receipts:[receipt('previous')]})).memory;
  const replacement=ok(await core.capture({namespace:ns,client:'synthetic',sessionId:'review',eventId:'held',messages:[{id:'held',role:'user',content:'Synthetic held replacement'}]})).admission.memories[0];
  const ids=id=>db.prepare('SELECT id FROM receipts WHERE memory_id=?').all(id).map(r=>r.id),fingerprint=db.prepare('SELECT fingerprint FROM memories WHERE id=?').get(previous.id).fingerprint;
  transaction(db,()=>{db.prepare(`INSERT INTO confirmation_supersessions(previous_id,previous_revision,replacement_id,replacement_revision,receipt_ids,previous_fingerprint,previous_receipt_ids)
    VALUES(?,?,?,?,?,?,?)`).run(previous.id,previous.revision,replacement.id,replacement.revision,JSON.stringify(ids(replacement.id)),fingerprint,JSON.stringify(ids(previous.id)));
    writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:previous.id,reason:'privacy_erase',actionId:'previous'});});
  const result=core.confirm({namespace:ns,memoryId:replacement.id,expectedRevision:replacement.revision,actionId:'confirm-held',receipt:receipt('confirm-held')});
  assert.equal(result.ok,false,'dependent_transition_identity');assert.ok(!JSON.stringify(result).includes(previous.id));
  assert.equal(db.prepare('SELECT revision FROM memories WHERE id=?').get(previous.id).revision,previous.revision);
  assert.equal(db.prepare('SELECT review_state FROM memories WHERE id=?').get(replacement.id).review_state,'awaiting');
  assert.equal(db.prepare('SELECT count(*) n FROM confirmation_actions').get().n,0);
});
// R2 statement counts now live in content-safety-s2h-query-cost.test.mjs,
// including the stricter zero-fact budget and all three safety cells.
