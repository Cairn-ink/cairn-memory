import '../testing/context-product-test-clock.mjs';
import { familyGate } from '../testing/receipt-event-time-gates.mjs';
const complete=familyGate('native settlement',78);
const semanticSafetyLayouts=[{version:18,family:'safety'},...([18,23,33].map(version=>({version,family:'event-time'})))];
// Native service Workers and IPC; all faults live in the synthetic test host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { openContextIndexMaintainer,openContextProductReader } from '../index.mjs';
import { setupProductSemantic,ns,ok } from '../testing/content-safety-s2h-product-semantic-probe.mjs';
import { semanticHandle } from '../context-semantic-coordinator.mjs';
import { semanticClient } from '../context-semantic-client.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { productSidecar } from '../context-product-sidecar.mjs';
import { productVectors } from '../context-product-vectors.mjs';
import { createProductSqlitePolicy } from '../context-product-sqlite.mjs';
import { accessDigest,digest } from '../context-product-validation.mjs';
import { tokenCost } from '../context-semantic-input.mjs';

const input={readSet:[ns],types:['memory'],intent:'current'};
async function fixture(t,journal,layout) {
 const portState=new SharedArrayBuffer(64),state=new Int32Array(portState);
 const s=await setupProductSemantic(t,{...layout,safety:true,corpus:2,canonicalMode:journal,host:{portState,counterDivisor:1000,maxConcurrent:1}});
 ok(await s.coordinator.setOwnerSemantic({ownerId:ns.ownerId,semantic:true,expectedRevision:0},s.token));
 const m=s.configure(true);Object.assign(m.options.host.configuration,{portState,counterDivisor:1000});
 const h=await openContextIndexMaintainer(m.options);s.f.workspace.defer(()=>h.close());
 ok(await h.refreshContextIndex({...input,mode:'lexical',budget:{maxItems:1024,maxMs:5000}},m.credential));
 ok(await h.refreshContextIndex({...input,mode:'embeddings',budget:{maxItems:1024,maxMs:5000,maxUsd:'0.50'}},m.credential));
 return {s,m,h,portState,state};
}
function ledgerState(s) {
 const db=new DatabaseSync(s.ledgerPath);
 try{return JSON.parse(db.prepare('SELECT state FROM semantic_owners WHERE owner_id=?').get(ns.ownerId).state);}finally{db.close();}
}
function ownerEpoch(s) {
 const db=new DatabaseSync(s.f.path);
 try{const row=db.prepare('SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs WHERE owner_id=?').get(ns.ownerId);return row?`${row.epoch_hi}:${row.epoch_lo}`:'0:0';}finally{db.close();}
}
function anchor(s){return JSON.parse(s.authority.prepare('SELECT anchor FROM anchors WHERE owner=?').get(ns.ownerId).anchor);}
function boundaryCounts(state) {
 assert.equal(Atomics.load(state,6),0,'first SQL after each materialized return is an autocommit epoch read');
 assert.equal(Atomics.load(state,12),Atomics.load(state,8),'exactly one E1 read per awaited callback, none for internal awaits');
 assert.equal(Atomics.load(state,9),0,'D2 accounting arguments stay on the allowlist');
}
for(const layout of semanticSafetyLayouts)for(const journal of ['DELETE','WAL'])for(const [mode,name] of [[41,'Memory forget'],[40,'epoch SELECT I/O']])for(const method of ['findCandidates','contextRead'])test(`terminal settlement refusal ${layout.family} v${layout.version} ${journal} ${name} ${method}`,async t=>{
 const {s,h,portState,state}=await fixture(t,journal,layout);
 const db=new DatabaseSync(s.f.path);let body;
 try{body=db.prepare('SELECT content FROM memories ORDER BY id LIMIT 1').get().content;}finally{db.close();}
 const r=s.configure(false);Object.assign(r.options.host.configuration,{portState,counterDivisor:1000,protectedQuery:body});
 const reader=await openContextProductReader(r.options);s.f.workspace.defer(()=>reader.close());
 const attempts=Atomics.load(s.view,4);Atomics.store(state,0,mode);
 const result=await reader[method]({...input,query:body,semantic:true,deadlineMs:5000,...(method==='findCandidates'?{limit:12}:{budget:{maxTokens:4000,maxItems:12}})},r.credential);
 t.diagnostic(JSON.stringify({mode,journal,method,ok:result.ok,code:result.error?.code,sourceText:JSON.stringify(result).includes(body),postRefusalCurrentness:Atomics.load(state,5),providerAttempts:Atomics.load(s.view,4)-attempts}));
 assert.equal(Atomics.load(state,mode===41?1:15),1,'native forget or actual epoch SQL fault happened');
 assert.equal(Atomics.load(state,10),1,'settlement attempted the failing accounting load');
 assert.equal(Atomics.load(state,5),0,'protected query never replays to a currentness host after commit');
 assert.equal(result.ok,false,'latched E1 refusal survives settlement error without lexical fallback');
 assert.equal(result.error.code,'evidence_unavailable','terminal content refusal code');
 assert.ok(!JSON.stringify(result).includes(body),'source text never appears in response');
 assert.equal(Atomics.load(s.view,4),attempts,'no provider dispatch after refusal');
 assert.equal(Atomics.load(state,2),0,'no later provider payload');
 assert.equal(Atomics.load(state,3),0,'no later counter payload');
 boundaryCounts(state);
 await reader.close();await h.close();await s.coordinator.close();await s.supervisor.close();
 if(layout.family==='event-time')complete(t.name);
});

async function nativeClient(t,s,m) {
 const sqlite=createProductSqlitePolicy();sqlite.start(Number(process.hrtime.bigint())/1e6+30000);
 const facade=openContextProductFacade(s.f.path,{sqlite});t.after(()=>facade.close());
 const storage=productSidecar({path:s.f.path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,sqlite});t.after(()=>storage.close());
 const handle=semanticHandle(s.coordinator),port=handle.attach({ownerId:ns.ownerId,path:s.f.path,readSet:[ns],maintenance:false});
 let operation;const client=semanticClient(port,{ownerState:handle.ownerState,writer:'0'},()=>operation);t.after(()=>client.close());
 function bind(epoch){operation={operationId:randomUUID(),operationCutoffMonoNs:String(process.hrtime.bigint()+5000000000n)};client.bindContentFence({ownerId:ns.ownerId,canonicalPath:s.f.path,storeId:s.f.storeId,readSet:[ns],suppressionEpoch:epoch});}
 bind('0:0');const snapshot=await client.snapshot(),p={...input,ownerCoverage:m.options.ownerCoverage};
 const observed=facade.port.read(()=>storage.observe(p,accessDigest(m.options.host.configuration.serviceBinding)));
 const vector=productVectors({storage,facade}).observe(p,observed.publication,snapshot);
 assert.equal(vector.status,'complete','control: native vector publication ready');
 const projection={...input,accessDigest:observed.publication.accessDigest,lexicalValidationDigest:digest(observed.publication),vectorValidationDigest:digest(vector.record),suppressionEpoch:'0:0'};
 return {client,bind,snapshot,projection,close(){client.close();storage.close();facade.close();}};
}
for(const layout of semanticSafetyLayouts)for(const journal of ['DELETE','WAL'])for(const [stage,offset] of [['load',0],['prepare',2],['seal',4]])for(const [fault,delta] of [['Proxy',0],['throw',1]])test(`D2 settlement retry ${layout.family} v${layout.version} ${journal} ${stage} ${fault}`,async t=>{
 const {s,m,h,state}=await fixture(t,journal,layout),n=await nativeClient(t,s,m);
 const initial=ledgerState(s),oldIds=new Set(Object.keys(initial.reservations)),attempts=Atomics.load(s.view,4);
 const text='synthetic settlement query';Atomics.store(state,0,42+offset+delta);
 const error=await n.client.call('embed',{texts:[text],kind:'query',expected:n.snapshot.policy,projection:n.projection}).then(()=>null,e=>e);
 const first=ledgerState(s),entry=Object.values(first.reservations).find(r=>!oldIds.has(r.id));
 assert.ok(entry,'provider attempt has a reservation');
 const immediate=entry.status;
 assert.equal(Atomics.load(state,1),1,'erasure committed during provider-return materialization');
 assert.equal(Atomics.load(state,10),1,'selected settlement callback fault occurred exactly once');
 // The next embed must finish old accounting before its own maxConcurrent=1
 // check. Its stale publication may refuse transmission, but it must reserve
 // and release its own slot, with no provider replay or protected dispatch.
 const epoch=ownerEpoch(s);
 n.bind(epoch);
 const nextError=await n.client.call('embed',{texts:['synthetic next query'],kind:'query',expected:n.snapshot.policy,projection:{...n.projection,suppressionEpoch:epoch,lexicalValidationDigest:digest('synthetic stale publication')}}).then(()=>null,e=>e);
 const after=ledgerState(s),next=Object.values(after.reservations).filter(r=>!oldIds.has(r.id)&&r.id!==entry.id);
 const evidence={code:error?.code,safetyFence:error?.safetyFence===true,status:after.reservations[entry.id].status,usage:after.reservations[entry.id].usage,
   cost:after.reservations[entry.id].cost,nextStatus:next.map(r=>r.status),pending:anchor(s).pending};
 t.diagnostic(JSON.stringify({stage,fault,immediate,nextError:nextError?.code,...evidence}));
 // One assertion records both independent defects on the before engine.
 assert.deepEqual(evidence,{code:'evidence_unavailable',safetyFence:true,status:'settled',usage:'validated',cost:String(tokenCost(Buffer.byteLength(text),entry.price.rate)),nextStatus:['released'],pending:null},'latched marker survives and next admission finalizes exact usage before concurrency');
 if(stage==='seal')assert.equal(immediate,'settled','seal failure follows the native terminal commit');
 const stable=ledgerState(s);n.bind(epoch);await n.client.snapshot();
 assert.deepEqual(ledgerState(s).reservations,stable.reservations,'repeated admission is idempotent: no duplicate or lost charge');
 assert.equal(Atomics.load(s.view,4),attempts+1,'only original provider attempt, no replay');
 assert.equal(Atomics.load(state,2),0,'zero provider dispatch after erasure');
 assert.equal(Atomics.load(state,3),0,'zero counter dispatch after erasure');
 assert.equal(Atomics.load(state,5),0,'zero currentness dispatch after erasure');
 assert.equal(Atomics.load(state,4),0,'no Proxy inspection beyond native async then assimilation');
 boundaryCounts(state);
 n.close();await h.close();await s.coordinator.close();await s.supervisor.close();
 if(layout.family==='event-time')complete(t.name);
});
for(const layout of semanticSafetyLayouts)for(const journal of ['DELETE','WAL'])for(const [providerMode,name] of [[3,'unknown usage'],[8,'protocol failure']])test(`D2 retry preserves ${name} ${layout.family} v${layout.version} ${journal}`,async t=>{
 const {s,m,h,state}=await fixture(t,journal,layout),n=await nativeClient(t,s,m);
 const before=ledgerState(s),oldIds=new Set(Object.keys(before.reservations));
 Atomics.store(s.view,7,providerMode);Atomics.store(state,0,43);
 const error=await n.client.call('embed',{texts:['synthetic unknown query'],kind:'query',expected:n.snapshot.policy,projection:n.projection}).then(()=>null,e=>e);
 const first=ledgerState(s),entry=Object.values(first.reservations).find(r=>!oldIds.has(r.id));
 assert.equal(Atomics.load(state,10),1,'failed settlement load');
 // A metadata admission has no protected payload; it must finish the retained
 // accounting even when the original operation has already returned refusal.
 ok(await s.coordinator.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token));
 const after=ledgerState(s),r=after.reservations[entry.id];
 assert.deepEqual({code:error?.code,marker:error?.safetyFence,status:r.status,usage:r.usage,cost:r.cost,blocked:after.identities[r.identity]?.blocked===true},
   {code:'evidence_unavailable',marker:true,status:'unknown',usage:'unknown',cost:entry.cost,blocked:providerMode===8},'retry preserves unknown charge and protocol identity block');
 boundaryCounts(state);n.close();await h.close();await s.coordinator.close();await s.supervisor.close();
 if(layout.family==='event-time')complete(t.name);
});
for(const layout of semanticSafetyLayouts)for(const journal of ['DELETE','WAL'])test(`control ordinary settlement failure ${layout.family} v${layout.version} ${journal}`,async t=>{
 const {s,m,h,state}=await fixture(t,journal,layout),n=await nativeClient(t,s,m);Atomics.store(state,0,48);
 const error=await n.client.call('embed',{texts:['synthetic ordinary query'],kind:'query',expected:n.snapshot.policy,projection:n.projection}).then(()=>null,e=>e);
 assert.equal(Atomics.load(state,10),1,'accounting failure injected');
 assert.equal(error?.code,'ledger_unavailable','ordinary accounting failure keeps existing mapping');
 assert.equal(error?.safetyFence,undefined,'ordinary failure gains no refusal marker');
 assert.equal(Atomics.load(state,1),0,'no erasure/refusal');boundaryCounts(state);
 n.close();await h.close();await s.coordinator.close();await s.supervisor.close();
 if(layout.family==='event-time')complete(t.name);
});
test('latched client IPC marker wins over late-message timeout',async()=>{
 const port=new EventEmitter();port.postMessage=message=>port.emit('message',{id:message.id,ok:false,code:'evidence_unavailable',safetyFence:true});
 const client=semanticClient(port,{ownerState:new SharedArrayBuffer(56),writer:'0'},()=>({operationId:randomUUID(),operationCutoffMonoNs:String(process.hrtime.bigint()-1n)}));
 await assert.rejects(client.snapshot(),e=>e.code==='evidence_unavailable'&&e.safetyFence===true,'snapshot preserves an already received refusal at cutoff');
});
