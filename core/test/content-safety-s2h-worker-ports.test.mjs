import { testClock } from '../testing/context-product-test-clock.mjs';
import { familyGate } from '../testing/receipt-event-time-gates.mjs';
const complete=familyGate('native worker-ports',510);
const semanticSafetyLayouts=[{version:18,family:'safety'},...([18,23,33].map(version=>({version,family:'event-time'})))];
// Install the shared clock before product factories capture their timers.
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { semanticHandle } from '../context-semantic-coordinator.mjs';
import { semanticClient } from '../context-semantic-client.mjs';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { transaction } from '../database.mjs';
import { suppressOwnerInside,writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { openContextIndexMaintainer,openContextProductReader } from '../index.mjs';
import { setupProductSemantic,ns,ok } from '../testing/content-safety-s2h-product-semantic-probe.mjs';

const realNow=()=>{const [s,ns]=process.hrtime();return s*1000+ns/1e6;};
async function waitFor(state,index){const until=realNow()+10000;while(!Atomics.load(state,index)&&realNow()<until)await delay(5);assert.equal(Atomics.load(state,index),1,'native caller reached barrier');}
function targetFact(db,mutation){
 if(mutation==='account')return suppressOwnerInside(db,{ownerId:ns.ownerId,reason:'account_erasure',actionId:'synthetic-port'});
 const row=db.prepare('SELECT id,revision FROM memories ORDER BY id LIMIT 1').get();
 return writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:row.id,
   reason:{forget:'user_forget',correction:'correction_supersession',privacy:'privacy_erase'}[mutation],actionId:'synthetic-port',
   ...(mutation==='correction'?{matchMode:'revision-through',sourceVersion:JSON.stringify(['memory-revision-through-v1',row.revision])}:{})});
}
for(const layout of semanticSafetyLayouts)for(const journal of ['DELETE','WAL'])for(const [mode,name]of [[1,'load'],[2,'cas'],[3,'provider'],[4,'getter'],[5,'proxy'],[6,'listOwners'],[8,'anchor Proxy'],[9,'anchor accessor'],[10,'inventory Proxy'],[11,'error accessor'],[15,'thenable'],[16,'reservation seal'],[17,'transmission prepare'],[18,'transmission seal'],[19,'compensation'],[22,'last price sample'],[23,'CAS bool Proxy'],[24,'CAS error accessor'],[28,'refused dispatch retry']])for(const mutation of ['account','forget','correction','privacy'])test(`native worker E1 ${layout.family} v${layout.version} ${journal} ${name} ${mutation}`,async t=>{
 const portState=new SharedArrayBuffer(64),state=new Int32Array(portState);
 t.after(()=>{Atomics.store(state,11,1);Atomics.notify(state,11);});
 const s=await setupProductSemantic(t,{...layout,safety:true,corpus:12,canonicalMode:journal,host:{portState,factMutation:mutation,counterDivisor:1000}});
 ok(await s.coordinator.setOwnerSemantic({ownerId:ns.ownerId,semantic:true,expectedRevision:0},s.token));
 const m=s.configure(true);Object.assign(m.options.host.configuration,{portState,counterDivisor:1000});
 const h=await openContextIndexMaintainer(m.options);s.f.workspace.defer(()=>h.close());
 const input={readSet:[ns],types:['memory'],intent:'current'};
 ok(await h.refreshContextIndex({...input,mode:'lexical',budget:{maxItems:1024,maxMs:5000}},m.credential));
 ok(await h.refreshContextIndex({...input,mode:'embeddings',budget:{maxItems:1024,maxMs:5000,maxUsd:'0.50'}},m.credential));
 const r=s.configure(false);Object.assign(r.options.host.configuration,{portState,counterDivisor:1000});
 const reader=await openContextProductReader(r.options);s.f.workspace.defer(()=>reader.close());
 let query='semantic';
 if(mode===22){
   // The final price-hook regression dispatches the exact body covered by the
   // committed fact on the before engine, not only a generic search token.
   const db=new DatabaseSync(s.f.path);
   try{query=db.prepare('SELECT content FROM memories ORDER BY id LIMIT 1').get().content;}finally{db.close();}
   assert.match(query,/semantic probecommon synthetic evidence/,'control: query is the exact target Memory body');
 }
 Atomics.store(state,0,mode);
 const pending=reader.contextRead({...input,query,semantic:true,deadlineMs:5000,budget:{maxTokens:4000,maxItems:12}},r.credential);
 if(![4,9,11,15,22,24,28].includes(mode)){
   await waitFor(state,10);
   const db=new DatabaseSync(s.f.path);
   try{transaction(db,()=>targetFact(db,mutation));Atomics.store(state,1,1);}
   finally{db.close();Atomics.store(state,11,1);Atomics.notify(state,11);}
 }
 const result=await pending;
 // Response/counter checks are a6ec0e0e controls. E1, inert returns,
 // last-price dispatch and durable CAS-return reconciliation are regressions.
 assert.equal(Atomics.load(state,1),1,'control: target fact committed');
 assert.equal(result.ok,false,'control: no content after suppression');
 assert.doesNotMatch(JSON.stringify(result),/semantic probecommon synthetic evidence|synthetic protected error text/,'control: no protected response text');
 assert.equal(Atomics.load(state,3),0,'control: no retained counter after commit');
 assert.equal(Atomics.load(state,2),0,'no provider after commit (last-price case is fail-before; suspended-return cases are controls)');
 assert.equal(Atomics.load(state,6),0,'one autocommit epoch is first SQL after each materialized caller return');
 assert.equal(Atomics.load(state,9),0,'control: D2 callbacks use only accounting allowlist fields');
 assert.equal(Atomics.load(state,12),Atomics.load(state,8),'exactly one epoch read per actual awaited caller return, including D2 settlement');
 if([4,9,11,15,24].includes(mode))assert.ok(Atomics.load(state,4)<=1,'caller accessor cannot survive inert snapshot');
 if([5,8,10,23].includes(mode))assert.equal(Atomics.load(state,4),0,'Proxy return refused without a get trap');
 if(mode===28)assert.equal(Atomics.load(state,5),0,'control: a refused dispatch retry invokes no later price hook');
 if(mode===23)assert.equal(Atomics.load(state,5),1,'control: raw async assimilation only; no caller then lookup survives E1');
 const ledger=new DatabaseSync(s.ledgerPath);
 try{const row=ledger.prepare('SELECT state FROM semantic_owners WHERE owner_id=?').get(ns.ownerId),reservations=Object.values(JSON.parse(row.state).reservations);
   assert.ok(reservations.every(r=>!['reserved','may_transmit'].includes(r.status)),'control: D2 reservation reaches a terminal state after refusal');
 }finally{ledger.close();}
 assert.equal(JSON.parse(s.authority.prepare('SELECT anchor FROM anchors WHERE owner=?').get(ns.ownerId).anchor).pending,null,'exact prepared anchor is reconciled (CAS-return refusals are regressions; other cases are controls)');
 await reader.close();await h.close();await s.coordinator.close();await s.supervisor.close();
 // The reader, client, coordinator and supervisor are closed; expire the finished requests' 5000 ms reservations.
 await testClock.advance(5001,{waitForWorkers:false});
 if(layout.family==='event-time')complete(t.name);
});

// These cases isolate the first protected service snapshot through the real
// service Worker and semantic client. They need no lexical/vector sidecar.
for(const layout of semanticSafetyLayouts)for(const journal of ['DELETE','WAL'])for(const mutation of ['account','forget','correction','privacy'])test(`native snapshot refusal survives client catch ${layout.family} v${layout.version} ${journal} ${mutation}`,async t=>{
 const portState=new SharedArrayBuffer(64),state=new Int32Array(portState);
 t.after(()=>{Atomics.store(state,11,1);Atomics.notify(state,11);});
 const s=await setupProductSemantic(t,{...layout,safety:true,corpus:1,canonicalMode:journal,host:{portState,factMutation:mutation,counterDivisor:1000}});
 ok(await s.coordinator.setOwnerSemantic({ownerId:ns.ownerId,semantic:true,expectedRevision:0},s.token));
 const handle=semanticHandle(s.coordinator),port=handle.attach({ownerId:ns.ownerId,path:s.f.path,readSet:[ns],maintenance:false});
 const operation={operationId:randomUUID(),operationCutoffMonoNs:String(process.hrtime.bigint()+5000000000n)};
 const client=semanticClient(port,{ownerState:handle.ownerState,writer:'0'},()=>operation);
 t.after(()=>client.close());
 const fence={ownerId:ns.ownerId,canonicalPath:s.f.path,storeId:s.f.storeId,readSet:[ns],suppressionEpoch:'0:0'};
 if(client.bindContentFence)client.bindContentFence(fence);
 else {
   // Before-engine adapter sends the same private wire record. The baseline
   // Worker ignores it, so the failure is the real missing E1/catch refusal.
   const post=port.postMessage;port.postMessage=message=>Reflect.apply(post,port,[{...message,contentFence:{...fence,operationId:operation.operationId}}]);
 }
 Atomics.store(state,0,1);
 const pending=client.snapshot();
 await waitFor(state,10);
 const db=new DatabaseSync(s.f.path);
 try{transaction(db,()=>targetFact(db,mutation));Atomics.store(state,1,1);}finally{db.close();Atomics.store(state,11,1);Atomics.notify(state,11);}
 await assert.rejects(pending,error=>error.code==='evidence_unavailable'&&error.safetyFence===true,'E1 refusal survives snapshot catch-all over native IPC');
 assert.equal(Atomics.load(state,6),0,'first SQL is exactly one autocommit owner epoch');
 assert.equal(Atomics.load(state,7),1,'one actual awaited load has exactly one E1 observation');
 assert.equal(Atomics.load(state,8),1,'control: exactly one actual awaited load');
 assert.equal(Atomics.load(state,12),1,'exactly one total worker epoch SELECT for that load');
 client.close();await s.coordinator.close();await s.supervisor.close();
 // The reader, client, coordinator and supervisor are closed; expire the finished requests' 5000 ms reservations.
 await testClock.advance(5001,{waitForWorkers:false});
 if(layout.family==='event-time')complete(t.name);
});

// Refusing caller method lookup/async policy cannot consume a provider attempt.
// No fact is inserted here; ordinary lexical availability is a control.
for(const layout of semanticSafetyLayouts)for(const journal of ['DELETE','WAL'])for(const [mode,name]of [[12,'poisoned Promise.catch'],[13,'provider accessor'],[14,'provider prototype Proxy'],[26,'inert CAS bool return'],[33,'detached provider dispatch callback']])test(`native protected model port ${layout.family} v${layout.version} ${journal} ${name}`,async t=>{
 const portState=new SharedArrayBuffer(64),state=new Int32Array(portState);
 const s=await setupProductSemantic(t,{...layout,safety:true,corpus:12,canonicalMode:journal,host:{portState,factMutation:'account',counterDivisor:1000}});
 ok(await s.coordinator.setOwnerSemantic({ownerId:ns.ownerId,semantic:true,expectedRevision:0},s.token));
 const m=s.configure(true);Object.assign(m.options.host.configuration,{portState,counterDivisor:1000});
 const h=await openContextIndexMaintainer(m.options);s.f.workspace.defer(()=>h.close());
 const input={readSet:[ns],types:['memory'],intent:'current'};
 ok(await h.refreshContextIndex({...input,mode:'lexical',budget:{maxItems:1024,maxMs:5000}},m.credential));
 ok(await h.refreshContextIndex({...input,mode:'embeddings',budget:{maxItems:1024,maxMs:5000,maxUsd:'0.50'}},m.credential));
 const r=s.configure(false);Object.assign(r.options.host.configuration,{portState,counterDivisor:1000});
 const reader=await openContextProductReader(r.options);s.f.workspace.defer(()=>reader.close());
 const attempts=Atomics.load(s.view,4);Atomics.store(state,0,mode);
 const result=await reader.contextRead({...input,query:'semantic',semantic:true,deadlineMs:5000,budget:{maxTokens:4000,maxItems:12}},r.credential);
 assert.equal(Atomics.load(state,4),0,'no accessor/Proxy lookup hook or own Promise.catch is read');
 assert.equal(Atomics.load(s.view,4),attempts+(mode===33?1:0),'unsafe lookup cannot create another provider attempt; detached callback has one control attempt');
 assert.equal(result.ok,true,'control: ordinary lexical fallback remains available without a fact');
 if(mode===26){
   assert.equal(JSON.parse(s.authority.prepare('SELECT anchor FROM anchors WHERE owner=?').get(ns.ownerId).anchor).pending,null,'durable malformed prepare return is reconciled before fallback');
   assert.equal(Atomics.load(state,5),1,'control: native assimilation only; no raw then hook survives the return boundary');
 }
 assert.equal(Atomics.load(state,6),0,'each actual awaited authority return still has its E1 observation');
 assert.equal(Atomics.load(state,12),Atomics.load(state,8),'no epoch reads for synchronous policy or lookup refusal');
 const ledger=new DatabaseSync(s.ledgerPath);
 try{assert.ok(Object.values(JSON.parse(ledger.prepare('SELECT state FROM semantic_owners WHERE owner_id=?').get(ns.ownerId).state).reservations).every(r=>!['reserved','may_transmit'].includes(r.status)),'control: no untransmitted reservation remains outstanding');}finally{ledger.close();}
 await reader.close();await h.close();await s.coordinator.close();await s.supervisor.close();
 // The reader, client, coordinator and supervisor are closed; expire the finished requests' 5000 ms reservations.
 await testClock.advance(5001,{waitForWorkers:false});
 if(layout.family==='event-time')complete(t.name);
});
