import { testClock } from '../testing/context-product-test-clock.mjs';
import { familyGate } from '../testing/receipt-event-time-gates.mjs';
const complete=familyGate('native settlement-boundary',78);
const semanticSafetyLayouts=[{version:18,family:'safety'},...([18,23,33].map(version=>({version,family:'event-time'})))];
// Native service Workers and IPC; all faults live in the synthetic test host.
import threads from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
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
async function fixture(t,journal,layout,host={}) {
 const portState=new SharedArrayBuffer(80),state=new Int32Array(portState);
 const s=await setupProductSemantic(t,{...layout,safety:true,corpus:2,canonicalMode:journal,host:{portState,counterDivisor:1000,maxConcurrent:1,...host}});
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

// Test-only source observation in native semantic Workers. Nothing is added to
// the shipped Worker, its callback arguments, SQL, or successful-path costs.
// Exact matching makes a stale instrumentation target an explicit test failure.
const observerSource=`export async function load(url,context,next){
 const result=await next(url,context);
 if(url.endsWith('/context-semantic-client.mjs')){
  const from='pending.set(id,{resolve,reject,timer,attempts,cutoff:';
  const to=\`const originalReject=reject;reject=error=>{const buffer=settlementTestWorkerData.host.configuration.portState;if(buffer){const view=new Int32Array(buffer);Atomics.add(view,error.safetyFence===true?17:16,1);}originalReject(error);};pending.set(id,{resolve,reject,timer,attempts,cutoff:\`;
  const source=String(result.source);if(source.split(from).length!==2)throw Error('client decision observation target mismatch');
  return {...result,source:"import {workerData as settlementTestWorkerData} from 'node:worker_threads';\\n"+source.replace(from,to)};
 }
 if(!url.endsWith('/context-semantic-worker.mjs'))return result;
 const from='const pendingSettlements=new Map();';
 const to=\`const pendingSettlements=new class extends Map {
   observe(){const buffer=c.host.configuration.settlementObservation;if(!buffer)return;const view=new Int32Array(buffer);Atomics.store(view,0,this.size);Atomics.store(view,1,Math.max(Atomics.load(view,1),this.size));}
   set(key,value){super.set(key,value);this.observe();return this;}
   delete(key){const changed=super.delete(key);this.observe();return changed;}
 }();\`;
 const source=String(result.source);if(source.split(from).length!==2)throw Error('settlement observation target mismatch');
 return {...result,source:source.replace(from,to)};
}`;
const observerURL='data:text/javascript,'+encodeURIComponent(observerSource);
const importURL='data:text/javascript,'+encodeURIComponent(`import {register} from 'node:module';register(${JSON.stringify(observerURL)},import.meta.url);`);
// Services intentionally clear execArgv. Wrap the existing test-clock Worker
// so only this test's Workers receive the observation preload.
const ClockWorker=threads.Worker;
threads.Worker=class extends ClockWorker {
 constructor(entry,options={}){
  const observe=['/context-semantic-worker.mjs','/context-product-worker.mjs'].some(suffix=>String(entry).endsWith(suffix));
  super(entry,{...options,execArgv:[...(options.execArgv??[]),...(observe?['--import',importURL]:[])]});
 }
};
syncBuiltinESMExports();
async function barrier(state){
 for(let i=0;i<2000&&!Atomics.load(state,10);i++)await delay(5);
 assert.equal(Atomics.load(state,10),1,'native settlement/admission barrier reached');
}
for(const layout of semanticSafetyLayouts)for(const ordering of ['all Workers','request Worker first'])for(const journal of ['DELETE','WAL'])for(const mode of [40,41])for(const method of ['findCandidates','contextRead'])test(`P1 public sub-cutoff ${ordering} ${layout.family} v${layout.version} ${journal} mode${mode} ${method}`,async t=>{
 const {s,h,portState,state}=await fixture(t,journal,layout);
 const db=new DatabaseSync(s.f.path);let body;try{body=db.prepare('SELECT content FROM memories ORDER BY id LIMIT 1').get().content;}finally{db.close();}
 const r=s.configure(false);Object.assign(r.options.host.configuration,{portState,counterDivisor:1000,protectedQuery:body});
 const reader=await openContextProductReader(r.options);s.f.workspace.defer(()=>reader.close());
 const attempts=Atomics.load(s.view,4);Atomics.store(state,0,mode);Atomics.store(state,11,3);
 const pending=reader[method]({...input,query:body,semantic:true,deadlineMs:5000,...(method==='findCandidates'?{limit:12}:{budget:{maxTokens:4000,maxItems:12}})},r.credential);
 let result;
 try{
  await barrier(state);
  assert.equal(Atomics.load(state,mode===40?15:1),1,'real E1 I/O fault or forget before advancing clock');
  if(ordering==='request Worker first')await testClock.advanceRequestFirst(3001);else await testClock.advance(3001);
  result=await pending;
 }finally{Atomics.store(state,11,0);Atomics.notify(state,11);}
 const replay=Atomics.load(state,5),sourceText=JSON.stringify(result).includes(body);
 t.diagnostic(JSON.stringify({ordering,journal,mode,method,ok:result.ok,code:result.error?.code,sourceText,replay,providerAttempts:Atomics.load(s.view,4)-attempts}));
 ok(await s.coordinator.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token));
 await reader.close();await h.close();await s.coordinator.close();await s.supervisor.close();
 assert.equal(replay,0,'client timer must not replay the query after a latched refusal');
 assert.equal(result.ok,false,'latched refusal survives client timer before marker delivery');
 assert.equal(result.error.code,'evidence_unavailable');assert.equal(sourceText,false);
 assert.equal(Atomics.load(state,17),1,'semantic client decision receives a marked refusal');
 assert.equal(Atomics.load(s.view,4),attempts,'no provider dispatch');
 if(layout.family==='event-time')complete(t.name);
});
for(const layout of semanticSafetyLayouts)for(const journal of ['DELETE','WAL'])for(const method of ['findCandidates','contextRead'])test(`control unlatched public sub-cutoff ${layout.family} v${layout.version} ${journal} ${method}`,async t=>{
 const {s,h,portState,state}=await fixture(t,journal,layout);
 const r=s.configure(false);Object.assign(r.options.host.configuration,{portState,counterDivisor:1000});
 const reader=await openContextProductReader(r.options);s.f.workspace.defer(()=>reader.close());
 Atomics.store(state,0,50);
 const pending=reader[method]({...input,query:'semantic probecommon',semantic:true,deadlineMs:5000,...(method==='findCandidates'?{limit:12}:{budget:{maxTokens:4000,maxItems:12}})},r.credential);
 let result;
 try{await barrier(state);await testClock.advanceRequestFirst(3001);result=await pending;}
 finally{Atomics.store(state,11,1);Atomics.notify(state,11);}
 assert.equal(result.ok,true,'plain timeout still degrades to lexical');
 const trace=method==='contextRead'?result.value.diagnostics.candidates.trace:result.value.trace;
 assert.equal(trace.semantic.degradedReason,'timeout');
 assert.equal(Atomics.load(state,16),1,'plain timeout has no marker');assert.equal(Atomics.load(state,17),0);
 assert.equal(Atomics.load(state,1),0,'no refusal fact');assert.equal(Atomics.load(state,15),0,'no E1 failure');
 await reader.close();await h.close();await s.coordinator.close();await s.supervisor.close();
 if(layout.family==='event-time')complete(t.name);
});
for(const layout of semanticSafetyLayouts)for(const journal of ['DELETE','WAL'])for(const mode of [43,48])test(`P2 sustained outage ${layout.family} v${layout.version} ${journal} mode${mode}`,async t=>{
 const observation=new SharedArrayBuffer(8),sizes=new Int32Array(observation);
 const {s,m,h,state}=await fixture(t,journal,layout,{settlementObservation:observation});
 const n=await nativeClient(t,s,m),old=new Set(Object.keys(ledgerState(s).reservations)),attempts=Atomics.load(s.view,4);
 const text='synthetic sustained outage';Atomics.store(state,0,mode);
 const first=await n.client.call('embed',{texts:[text],kind:'query',expected:n.snapshot.policy,projection:n.projection}).then(()=>null,e=>e);
 assert.equal(first?.code,mode===43?'evidence_unavailable':'ledger_unavailable');assert.equal(first.safetyFence===true,mode===43);
 assert.equal(Atomics.load(sizes,0),1,'real stranded reservation retained');
 Atomics.store(state,11,2);
 const errors=[];
 for(let i=0;i<129;i++){
  const epoch=ownerEpoch(s);n.bind(epoch);
  errors.push(await n.client.call('embed',{texts:['synthetic rejected retry '+i],kind:'query',expected:n.snapshot.policy,projection:{...n.projection,suppressionEpoch:epoch}}).then(()=>null,e=>e.code));
 }
 const during=ledgerState(s),created=Object.values(during.reservations).filter(r=>!old.has(r.id));
 assert.equal(created.length,1,'only the first request created a reservation');
 assert.ok(errors.every(code=>['ledger_unavailable','evidence_unavailable'].includes(code)),'all 129 admissions fail with a code');
 assert.equal(Atomics.load(s.view,4),attempts+1,'failed admissions dispatch nothing');
 const retained=Atomics.load(sizes,0),maximum=Atomics.load(sizes,1);
 Atomics.store(state,11,0);ok(await s.coordinator.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token));
 const after=ledgerState(s),reservation=after.reservations[created[0].id];
 assert.deepEqual({status:reservation.status,usage:reservation.usage,cost:reservation.cost},{status:'settled',usage:'validated',cost:String(tokenCost(Buffer.byteLength(text),reservation.price.rate))});
 assert.equal(Atomics.load(sizes,0),0,'recovery empties retained map');
 ok(await s.coordinator.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token));
 assert.deepEqual(ledgerState(s).reservations,after.reservations,'recovery settles exactly once');
 n.close();await h.close();await s.coordinator.close();await s.supervisor.close();
 t.diagnostic(JSON.stringify({journal,mode,retained,maximum,created:created.length,retries:errors.length}));
 assert.ok(maximum<=2,'retention bound maxConcurrent + one uncertain reserving mutation');
 assert.equal(retained,1,'failed pre-reservation admissions retain nothing');
 if(layout.family==='event-time')complete(t.name);
});
for(const layout of semanticSafetyLayouts)for(const journal of ['DELETE','WAL'])test(`P2 uncertain reserving commit ${layout.family} v${layout.version} ${journal}`,async t=>{
 const {s,m,h,state}=await fixture(t,journal,layout),n=await nativeClient(t,s,m),old=new Set(Object.keys(ledgerState(s).reservations)),attempts=Atomics.load(s.view,4);
 Atomics.store(state,0,49);
 const error=await n.client.call('embed',{texts:['synthetic uncertain reserve'],kind:'query',expected:n.snapshot.policy,projection:n.projection}).then(()=>null,e=>e);
 assert.equal(error?.code,'ledger_unavailable');assert.equal(error?.safetyFence,undefined);
 const created=Object.values(ledgerState(s).reservations).filter(r=>!old.has(r.id));
 assert.equal(created.length,1);assert.equal(created[0].status,'reserved','commit preceded lost acknowledgement');
 assert.equal(Atomics.load(s.view,4),attempts,'no provider dispatch before acknowledgement');
 Atomics.store(state,11,0);ok(await s.coordinator.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token));
 const after=ledgerState(s);assert.equal(after.reservations[created[0].id].status,'released','uncertain reservation is retained and settled');
 assert.equal(anchor(s).pending,null);
 ok(await s.coordinator.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token));assert.deepEqual(ledgerState(s).reservations,after.reservations);
 n.close();await h.close();await s.coordinator.close();await s.supervisor.close();
 if(layout.family==='event-time')complete(t.name);
});

for(const point of ['timer','message cutoff','close'])for(const latched of [false,true])test(`control client decision ${point} latch=${latched}`,async()=>{
 const port=new EventEmitter();port.close=()=>port.emit('close');
 port.postMessage=message=>{Atomics.store(new Int32Array(message.attemptState),0,1);if(latched&&message.attemptState.byteLength>=8)Atomics.store(new Int32Array(message.attemptState),1,1);if(point==='message cutoff')port.emit('message',{id:message.id,ok:true,value:{}});};
 const cutoff=process.hrtime.bigint()+(point==='message cutoff'?-1n:1000000n),client=semanticClient(port,{ownerState:new SharedArrayBuffer(56),writer:'0'},()=>({operationId:randomUUID(),operationCutoffMonoNs:String(cutoff)}));
 const pending=client.call('snapshot').then(()=>null,e=>e);
 if(point==='close')port.emit('close');
 else if(point==='timer')await testClock.advance(2,{waitForWorkers:false});
 const error=await pending;
 assert.equal(error?.code,latched?'evidence_unavailable':point==='close'?'ledger_unavailable':'timeout');
 assert.equal(error?.safetyFence===true,latched);assert.equal(error?.attempts,1,'attempt count preserved');client.close();
});
