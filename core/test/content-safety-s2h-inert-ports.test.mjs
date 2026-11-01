import { DatabaseSync } from 'node:sqlite';
import { measureContentRead } from '../testing/content-safety-cost-meter.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { openMemoryCore } from '../index.mjs';
import { cardHost } from '../testing/raw-source-fixtures.mjs';
import { request, splitRaw, localPlainPort } from '../testing/raw-capture-fixtures.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';
import { transaction } from '../database.mjs';
import { contentWriteBoundaryConnection } from '../content-write-context.mjs';
import { suppressOwnerInside } from '../content-suppression-storage.mjs';
import { host, publish, read } from './role-fixture.mjs';

const erase = db => transaction(db,()=>suppressOwnerInside(db,{ownerId:ns.ownerId,reason:'account_erasure',actionId:'port-erasure'}));
// Isolate the boundary proof from runtime.getPage's independent namespace-epoch
// fence. This engine-owned read still validates owner suppression in its native
// snapshot, and closes that snapshot before any retained counter dispatch.
function scopedPage(runtime,id) {
 const db=contentWriteBoundaryConnection(runtime.assertContentScope);
 return transaction(db,()=>{runtime.assertContentScope([ns]);return {memory:db.prepare('SELECT id,content FROM memories WHERE id=? AND owner_id=?').get(id,ns.ownerId)};});
}

for (const journal of ['DELETE','WAL']) for (const method of ['getConversation','resolveSourceReferences','getSource'])
for (const shape of ['getter','proxy','thenable']) test(`inert E1 ${journal} ${method} ${shape}: stop before second opening`,async t=>{
 const f=safetyFixture(t,33);await f.migrate();const db=f.connect();
 assert.equal(db.prepare('PRAGMA journal_mode='+journal).get().journal_mode.toUpperCase(),journal);
 const h=cardHost(),base=localPlainPort();let armed=false,calls=0,erased=false;
 const mutation=()=>{if(!erased){erase(db);erased=true;}};
 const port={...base,async openRaw(value){
  const result=await base.openRaw(value);if(!armed)return result;calls++;
  if(shape==='getter')return {get text(){mutation();return result.text;}};
  if(shape==='proxy')return new Proxy(result,{get(target,key){if(key==='text')mutation();return Reflect.get(target,key);}});
  return {then(resolve){mutation();resolve(result);}};
 }};
 const core=openRawCaptureCore({path:f.path,privateCards:h.options,model:{countTokens:()=>1,contextWindow:8192,extract:()=>({items:[]})}},
  {mode:'raw-v1',port,sources:true,readPolicy:()=>({generation:'synthetic',reason:null})});
 t.after(()=>{core.close();db.close();});
 const text='ProtectedSyntheticOneProtectedSyntheticTwo',parts=splitRaw(text,{size:21});assert.equal(parts.length,2);let raw;
 for(const [i,part]of parts.entries())raw=ok(await core.captureRaw(request(part,{namespace:ns,client:'codex',sessionId:'inert-source',eventId:'inert-'+i})));
 const conversationId=raw.raw.conversationId,revision=db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(conversationId).revision;
 const input={namespace:ns,anchors:[{rawAnchor:{conversationId,messageId:parts[0].id,start:0,end:text.length,precision:'exact'},expectedConversationRevision:revision}]};
 const source=method==='getSource'?ok(await h.call(core,'resolveSourceReferences',input)).sources[0]:null;
 armed=true;const result=method==='getConversation'?await core.getConversation({namespace:ns,conversationId}):await h.call(core,method,method==='getSource'?{namespace:ns,source}:input);
 assert.equal(erased,true,'caller materialization committed outside swallowed port assertions');
 assert.equal(calls,1,'no second crypto dispatch');assert.equal(result.ok,false);assert.doesNotMatch(JSON.stringify(result),/ProtectedSynthetic/);
});

for(const shape of ['valueOf','primitive'])test(`counter ${shape} result is refused without coercing caller data`,async t=>{
 const f=safetyFixture(t);await f.migrate();const db=f.connect();let armed=false,calls=0,coercions=0;
 const core=openMemoryCore({path:f.path,model:{countTokens(){if(!armed)return 1;calls++;return shape==='valueOf'?{valueOf(){coercions++;erase(db);return 1;}}:{[Symbol.toPrimitive](){coercions++;erase(db);return 1;}};}}});
 t.after(()=>{core.close();db.close();});ok(core.admit({namespace:ns,memory:{content:'ProtectedSyntheticCounter',kind:'fact'},receipts:[receipt('counter')]}));
 armed=true;const measured=await measureContentRead('map','refused-counter-'+shape,()=>core.map({namespace:ns}),()=>calls),result=measured.result;
 const epochs=measured.trace.filter(row=>/^SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs/.test(row.sql));
 assert.equal(epochs.length,3,'entry, one post-counter observation even on refusal, delivery');assert.equal(epochs[1].transaction,false);
 assert.equal(calls,1);assert.equal(coercions,0);assert.equal(result.ok,false);assert.doesNotMatch(JSON.stringify(result),/ProtectedSynthetic/);
});

for(const mode of ['authority','forged-id'])test(`role E1 ${mode}: authority completes before counter epoch fence`,async t=>{
 const f=safetyFixture(t,33);await f.migrate();const db=f.connect();let armed=false,erased=false,calls=0;
 const h=host({onCurrent(){if(armed&&calls===1&&!erased&&mode==='authority'){erase(db);erased=true;}},counter:{id:'internal-projection',countTokens(){calls++;if(armed&&mode==='forged-id'&&!erased){erase(db);erased=true;}return 1;}}});
 const core=openMemoryCore({path:f.path,methodPackages:h.methods,roleProfiles:h.options,contextRead:h.context});t.after(()=>{core.close();db.close();});
 ok(core.publishRoleProfileRelease(publish(ns,'finance','profile',null,null,{duties:['ProtectedSyntheticRole'],requiredOutputs:['Report']}),{}));
 calls=0;armed=true;const result=core.readRoleTaskContext(read('finance',[ns]),{});
 assert.equal(erased,true);assert.equal(calls,1,'authority erasure stops next counter');assert.equal(result.ok,false);assert.doesNotMatch(JSON.stringify(result),/ProtectedSynthetic/);
});

// Exercise the shared dispatch boundary for every supported provider method,
// independently of each planner's schema validation and fallback behavior.
for(const method of ['select','rank','extract','qualify','qualifyCandidates','interpretEpisode','reconcile','classify','relate','reviewBasis'])
test(`model ${method}: getter result is inert before its single epoch read`,async t=>{
 const {createMemoryRuntime}=await import('../runtime.mjs');
 const {contentSafetyFacade}=await import('../content-safety-boundary.mjs');
 const {callModel}=await import('../model-call.mjs');
 const f=safetyFixture(t);await f.migrate();const db=f.connect(),core=openMemoryCore({path:f.path});
 const memory=ok(core.admit({namespace:ns,memory:{content:'ProtectedSyntheticModel',kind:'fact'},receipts:[receipt('provider')]})).memory;
 const runtime=createMemoryRuntime({path:f.path});t.after(()=>{runtime.close();core.close();db.close();});
 let counters=0,providers=0,erased=false;
 const model={contextWindow:8192,countTokens(){counters++;return 1;},[method](){providers++;return {get retained(){erase(db);erased=true;return 'ProtectedSyntheticModel';}};}};
 const facade=contentSafetyFacade({async recall(){runtime.getPage(ns,memory.id,20);return callModel(model,method,'Synthetic',{});}},
  {check:runtime.assertContentScope,portGuard:runtime.contentPortGuard,failure:error=>({ok:false,error:{code:error.code}})});
 const result=await facade.recall({namespace:ns});
 assert.equal(erased,true,JSON.stringify(result));assert.equal(providers,1);assert.equal(counters,1,'no output counter after erasure');assert.equal(result.ok,false);assert.doesNotMatch(JSON.stringify(result),/ProtectedSyntheticModel/);
});

test('role binary authority erasure refuses before the first counter dispatch',async t=>{
 const f=safetyFixture(t,33);await f.migrate();const db=f.connect();let armed=false,erased=false,calls=0;
 const h=host({counter:{id:'synthetic',countTokens(){calls++;return 1;}}}),assets={...h.assets,authority:{...h.authority,authorize(request,token){if(armed){erase(db);erased=true;}return h.authority.authorize(request,token);}}};
 const core=openMemoryCore({path:f.path,methodPackages:h.methods,assets,roleProfiles:h.options,contextRead:h.context});t.after(()=>{core.close();db.close();});
 const m=ok(core.importMethodVersion({namespace:ns,actionId:'binary-method',title:'Synthetic method',manifestFormat:'mixed-v1',files:[{kind:'text',path:'SKILL.md',text:'Synthetic guide',mediaType:'text/markdown'},{kind:'binary',path:'reference.pdf',mediaType:'application/pdf',bytes:Buffer.from('%PDF-1.7 Synthetic')} ]},{}));
 ok(core.adoptMethodVersion({bindingNamespace:ns,package:m.package,version:m.version,readSet:[ns],roleId:null,expectedRevision:null,actionId:'adopt'},{}));
 ok(core.publishRoleProfileRelease(publish(ns,'finance','profile',null,null,{duties:['ProtectedSyntheticBinaryRole'],requiredOutputs:['Report'],methods:[m.package]}),{}));
 const now=ok(core.readRoleTaskContext(read('finance',[ns]),{}));
 calls=0;armed=true;const result=core.readRoleTaskContext({mode:'file',readSet:[ns],receipt:now.metered.receipt,package:m.package,path:'reference.pdf'},{});
 assert.equal(erased,true,'the dedicated asset authority ran');assert.equal(calls,0,'no retained payload after the authority commit');assert.equal(result.ok,false);assert.doesNotMatch(JSON.stringify(result),/ProtectedSynthetic/);
});

test('counter callback accessor is refused before it can erase and dispatch retained text',async t=>{
 const f=safetyFixture(t);await f.migrate();const db=f.connect();let armed=false,lookups=0,calls=0,leaked=false;
 const model={get countTokens(){lookups++;if(armed&&lookups===2)erase(db);return text=>{calls++;if(text.includes('ProtectedSyntheticLookup'))leaked=true;return 1;};}};
 const core=openMemoryCore({path:f.path,model});t.after(()=>{core.close();db.close();});ok(core.admit({namespace:ns,memory:{content:'ProtectedSyntheticLookup',kind:'fact'},receipts:[receipt('lookup')]}));
 lookups=0;calls=0;armed=true;const result=core.map({namespace:ns});assert.equal(result.ok,false);assert.equal(lookups,0);assert.equal(calls,0);assert.equal(leaked,false);
});

test('diagnostic observer is fenced before any later retained counter dispatch',async t=>{
 const {createMemoryRuntime}=await import('../runtime.mjs');const {contentSafetyFacade}=await import('../content-safety-boundary.mjs');
 const {emitDiagnostic}=await import('../model-diagnostics.mjs');const {countTokens}=await import('../model-budget.mjs');
 const f=safetyFixture(t);await f.migrate();const db=f.connect(),core=openMemoryCore({path:f.path});
 const memory=ok(core.admit({namespace:ns,memory:{content:'ProtectedSyntheticObserver',kind:'fact'},receipts:[receipt('observer')]})).memory;
 const runtime=createMemoryRuntime({path:f.path});t.after(()=>{runtime.close();core.close();db.close();});let observers=0,counters=0,erased=false;
 const model={onDiagnostic(){observers++;erase(db);erased=true;},countTokens(){counters++;return 1;}};
 const facade=contentSafetyFacade({recall(){runtime.getPage(ns,memory.id,20);emitDiagnostic(model,'select','core_call','provider_failure');return countTokens(model,'ProtectedSyntheticObserver');}},
  {check:runtime.assertContentScope,portGuard:runtime.contentPortGuard,failure:error=>({ok:false,error:{code:error.code}})});
 const result=facade.recall({namespace:ns});assert.equal(erased,true,JSON.stringify(result));assert.equal(observers,1);assert.equal(counters,0);assert.equal(result.ok,false);assert.doesNotMatch(JSON.stringify(result),/ProtectedSynthetic/);
});

for(const path of ['recall','embedded'])test(`caller-queued erasure crosses an engine await before ${path} dispatch`,async t=>{
 const f=safetyFixture(t);await f.migrate();const db=f.connect();let armed=false,queued=false,erased=false,providerCalls=0,counterCalls=0;
 const h=host({onCurrent(){if(path==='embedded'&&armed&&!queued){queued=true;queueMicrotask(()=>{erase(db);erased=true;});}},counter:{id:'synthetic',countTokens(){counterCalls++;return 1;}}});
 const model={contextWindow:8192,countTokens(text){if(path==='recall'&&armed&&!queued&&text.startsWith('{"system":')){queued=true;queueMicrotask(()=>{erase(db);erased=true;});}return 1;},select(){providerCalls++;return {refs:[]};},rank(){providerCalls++;return {refs:[]};}};
 const core=openMemoryCore({path:f.path,model,...(path==='embedded'?{contextRead:h.context}:{})});t.after(()=>{core.close();db.close();});
 ok(core.admit({namespace:ns,memory:{content:'ProtectedSyntheticQueued',kind:'fact'},receipts:[receipt('queued')]}));
 if(path==='embedded')ok(await core.refreshContextIndex({readSet:[ns],types:['memory'],intent:'current',budget:{maxItems:1024,maxMs:5000}},{}));
 counterCalls=0;armed=true;
 const result=path==='recall'?await core.recall({readSet:[ns],query:'ProtectedSyntheticQueued'}):await core.contextRead({readSet:[ns],types:['memory'],intent:'current',query:'ProtectedSyntheticQueued',budget:{maxTokens:4000,maxItems:12}},{});
 assert.equal(erased,true,'queued callback actually committed');assert.equal(queued,true);assert.equal(providerCalls,0);assert.equal(counterCalls,0,'no assembled text reaches a counter after the engine await');assert.equal(result.ok,false);assert.doesNotMatch(JSON.stringify(result),/ProtectedSyntheticQueued/);
});

for(const method of ['refreshContextIndex','findCandidates','contextRead'])for(const shape of ['array-accessor','typed-iterator'])
test(`embedder ${method} ${shape}: materialize before one epoch read`,async t=>{
 const {createFakeEmbedder}=await import('../context-read-embedder.mjs');
 const f=safetyFixture(t);await f.migrate();const db=f.connect();let armed=false,erased=false,embeds=0,counters=0;
 let epochReads=0,portStart=0,readsBeforeGetter;
 const prepare=DatabaseSync.prototype.prepare;
 DatabaseSync.prototype.prepare=function(sql){const connection=this,statement=prepare.call(this,sql);return new Proxy(statement,{get(target,key){const value=Reflect.get(target,key,target);return typeof value!=='function'?value:(...args)=>{if(['get','all','iterate'].includes(key)&&/^SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs/.test(sql))epochReads++;return Reflect.apply(value,target,args);};}});};
 t.after(()=>{DatabaseSync.prototype.prepare=prepare;});
 const fake=createFakeEmbedder({dimensions:8}),authority={authorize(request){const {input,...binding}=request;return {...binding,accessGeneration:1};},isCurrent:g=>g};
 const core=openMemoryCore({path:f.path,model:{countTokens:()=>1},contextRead:{version:'context-read-v1',authority,
  counter:{id:'synthetic',countTokens(){counters++;return 1;}},embedder:{...fake,async embed(texts,controls){
   const vectors=await fake.embed(texts,controls);if(!armed)return vectors;embeds++;portStart=epochReads;
   const mutate=()=>{if(!erased){readsBeforeGetter=epochReads-portStart;erase(db);erased=true;}};
   if(shape==='array-accessor'){const vector=Array.from(vectors[0]);Object.defineProperty(vector,0,{get(){mutate();return vectors[0][0];},enumerable:true});return [vector,...vectors.slice(1)];}
   const vector=new Float32Array(vectors[0]);vector[Symbol.iterator]=function*(){mutate();yield* Float32Array.prototype.values.call(this);};return [vector,...vectors.slice(1)];
  }},policy:{family:'local',maxRequests:10000,maxConcurrent:1,maxBatchDocuments:1},localStatus:()=>({state:'ready',reason:null})}});
 t.after(()=>{core.close();db.close();});
 for(let i=0;i<2;i++)ok(core.admit({namespace:ns,memory:{content:'ProtectedSyntheticVector '+i,kind:'fact'},receipts:[receipt('vector-'+i)]}));
 const projection={readSet:[ns],types:['memory'],intent:'current'};
 if(method!=='refreshContextIndex')ok(await core.refreshContextIndex({...projection,budget:{maxItems:1024,maxMs:5000}},{}));
 embeds=0;counters=0;armed=true;
 const input=method==='refreshContextIndex'?{...projection,budget:{maxItems:1024,maxMs:5000}}:method==='findCandidates'?{...projection,query:'ProtectedSyntheticVector',semantic:true,limit:12,deadlineMs:5000}:{...projection,query:'ProtectedSyntheticVector',semantic:true,budget:{maxTokens:4000,maxItems:12},deadlineMs:5000};
 const result=await core[method](input,{});
 assert.equal(erased,true,JSON.stringify(result));assert.equal(embeds,1);assert.equal(readsBeforeGetter,0,'all caller vector hooks precede the sole E1 observation');assert.equal(counters,0);assert.equal(result.ok,false);assert.doesNotMatch(JSON.stringify(result),/ProtectedSyntheticVector/);
});

test('embedding estimator erasure stops before the first embedder dispatch',async t=>{
 const {createFakeEmbedder}=await import('../context-read-embedder.mjs');const f=safetyFixture(t);await f.migrate();const db=f.connect();
 let embeds=0,erased=false;const fake=createFakeEmbedder({dimensions:8}),authority={authorize(request){const {input,...binding}=request;return {...binding,accessGeneration:1};},isCurrent:g=>g};
 const core=openMemoryCore({path:f.path,model:{countTokens:()=>1},contextRead:{version:'context-read-v1',authority,counter:{id:'synthetic',countTokens:()=>1},embedder:{...fake,embed(...args){embeds++;return fake.embed(...args);}},policy:{family:'hosted',maxRequests:10000,maxUsd:1,maxConcurrent:1,estimateUsd(){erase(db);erased=true;return 0;}}}});
 t.after(()=>{core.close();db.close();});ok(core.admit({namespace:ns,memory:{content:'ProtectedSyntheticEstimator',kind:'fact'},receipts:[receipt('estimator')]}));
 const result=await core.refreshContextIndex({readSet:[ns],types:['memory'],intent:'current',budget:{maxItems:1024,maxMs:5000}},{});
 assert.equal(erased,true,JSON.stringify(result));assert.equal(embeds,0);assert.equal(result.ok,false);assert.doesNotMatch(JSON.stringify(result),/ProtectedSyntheticEstimator/);
});

for(const journal of ['DELETE','WAL'])test(`independent caller reads ${journal}: the second read cannot reuse its sibling epoch`,async t=>{
 const {createMemoryRuntime}=await import('../runtime.mjs'),{contentSafetyFacade}=await import('../content-safety-boundary.mjs');
 const {callModel}=await import('../model-call.mjs'),{countTokens}=await import('../model-budget.mjs');
 const f=safetyFixture(t,33);await f.migrate();const db=f.connect();assert.equal(db.prepare('PRAGMA journal_mode='+journal).get().journal_mode.toUpperCase(),journal);
 const core=openMemoryCore({path:f.path}),runtime=createMemoryRuntime({path:f.path});t.after(()=>{runtime.close();core.close();db.close();});
 const memory=ok(core.admit({namespace:ns,memory:{content:'ProtectedSyntheticSibling',kind:'fact'},receipts:[receipt('sibling')]})).memory;
 let erased=false,afterCommit=0,first,second;
 const counter={countTokens(){if(erased)afterCommit++;return 1;}};
 const boundary={check:runtime.assertContentScope,portGuard:runtime.contentPortGuard,failure:error=>({ok:false,error:{code:error.code}})};
 const reader=contentSafetyFacade({get(){const page=scopedPage(runtime,memory.id);countTokens(counter,page.memory.content);return {ok:true,value:page};}},boundary);
 const model={contextWindow:8192,countTokens:()=>1,async select(){first=await reader.get({namespace:ns});erase(db);erased=true;second=await reader.get({namespace:ns});return {refs:[]};}};
 const facade=contentSafetyFacade({async recall(){runtime.getPage(ns,memory.id,20);return callModel(model,'select','Synthetic',{});}},boundary);
 const result=await facade.recall({namespace:ns});
 assert.equal(erased,true,JSON.stringify(result));assert.equal(first.ok,true);assert.match(JSON.stringify(first),/ProtectedSyntheticSibling/);
 assert.equal(afterCommit,0,'no retained counter dispatch from a later independent caller read');assert.equal(second.ok,false);assert.equal(result.ok,false);assert.doesNotMatch(JSON.stringify(second),/ProtectedSynthetic/);
});

for(const journal of ['DELETE','WAL'])for(const kind of ['authorize','current','estimator','status'])
test(`synchronous caller ${journal} ${kind}: independent reads never inherit sibling proof`,async t=>{
 const {createMemoryRuntime}=await import('../runtime.mjs'),{contentSafetyFacade}=await import('../content-safety-boundary.mjs');
 const {countTokens}=await import('../model-budget.mjs'),{createFakeEmbedder}=await import('../context-read-embedder.mjs');
 const f=safetyFixture(t,33);await f.migrate();const db=f.connect();assert.equal(db.prepare('PRAGMA journal_mode='+journal).get().journal_mode.toUpperCase(),journal);
 const runtime=createMemoryRuntime({path:f.path});let armed=false,erased=false,afterCommit=0,first,second,memory;
 const boundary={check:runtime.assertContentScope,portGuard:runtime.contentPortGuard,failure:error=>({ok:false,error:{code:error.code}})};
 const counter={countTokens(){if(erased)afterCommit++;return 1;}};
 const reader=contentSafetyFacade({get(){const page=scopedPage(runtime,memory.id);countTokens(counter,page.memory.content);return {ok:true,value:page};}},boundary);
 const reenter=()=>{if(!armed||erased)return;first=reader.get({namespace:ns});erase(db);erased=true;second=reader.get({namespace:ns});};
 const h=host({onCurrent(){if(kind==='current')reenter();}}),authorize=h.authority.authorize;
 h.authority.authorize=function(...args){if(kind==='authorize')reenter();return Reflect.apply(authorize,this,args);};
 const fake=createFakeEmbedder({dimensions:8});
 const context=kind==='estimator'||kind==='status'?{...h.context,embedder:fake,...(kind==='status'?{
  policy:{family:'local',maxRequests:10000,maxConcurrent:1,maxBatchDocuments:1},localStatus(){reenter();return {state:'ready',reason:null};}
 }:{policy:{family:'hosted',maxRequests:10000,maxUsd:1,maxConcurrent:1,estimateUsd(){reenter();return 0;}}})}:h.context;
 const core=openMemoryCore({path:f.path,methodPackages:h.methods,roleProfiles:h.options,contextRead:context});
 t.after(()=>{runtime.close();core.close();db.close();});
 memory=ok(core.admit({namespace:ns,memory:{content:'ProtectedSyntheticCallback',kind:'fact'},receipts:[receipt('callback')]})).memory;
 if(kind==='authorize'||kind==='current')ok(core.publishRoleProfileRelease(publish(ns,'finance','profile',null,null,{duties:['ProtectedSyntheticCallback'],requiredOutputs:['Report']}),{}));
 armed=true;const result=kind==='authorize'||kind==='current'?core.readRoleTaskContext(read('finance',[ns]),{}):await core.refreshContextIndex({readSet:[ns],types:['memory'],intent:'current',budget:{maxItems:1024,maxMs:5000}},{});
 assert.equal(erased,true,JSON.stringify(result));assert.equal(first.ok,true,JSON.stringify(first));
 assert.equal(afterCommit,0,'a sibling read cannot dispatch retained text after the callback commits');
 assert.equal(second.ok,false,JSON.stringify(second));assert.equal(result.ok,false);assert.doesNotMatch(JSON.stringify(result),/ProtectedSyntheticCallback/);
});

for(const journal of ['DELETE','WAL'])test(`abort listener ${journal}: independent caller reads get fresh proofs`,async t=>{
 const {createMemoryRuntime}=await import('../runtime.mjs'),{contentSafetyFacade}=await import('../content-safety-boundary.mjs');
 const {countTokens}=await import('../model-budget.mjs'),{callModel}=await import('../model-call.mjs');
 const f=safetyFixture(t,33);await f.migrate();const db=f.connect();assert.equal(db.prepare('PRAGMA journal_mode='+journal).get().journal_mode.toUpperCase(),journal);
 const runtime=createMemoryRuntime({path:f.path}),core=openMemoryCore({path:f.path});t.after(()=>{runtime.close();core.close();db.close();});
 const memory=ok(core.admit({namespace:ns,memory:{content:'ProtectedSyntheticAbort',kind:'fact'},receipts:[receipt('abort')]})).memory;
 let erased=false,afterCommit=0,first,second;
 const boundary={check:runtime.assertContentScope,portGuard:runtime.contentPortGuard,failure:error=>({ok:false,error:{code:error.code}})};
 const reader=contentSafetyFacade({get(){const page=scopedPage(runtime,memory.id);countTokens({countTokens(){if(erased)afterCommit++;return 1;}},page.memory.content);return {ok:true,value:page};}},boundary);
 const model={contextWindow:8192,countTokens:()=>1,select({signal}){signal.addEventListener('abort',()=>{first=reader.get({namespace:ns});erase(db);erased=true;second=reader.get({namespace:ns});},{once:true});return new Promise(()=>{});}};
 const facade=contentSafetyFacade({async recall(){runtime.getPage(ns,memory.id,20);return callModel(model,'select','Synthetic',{}, {deadline:{expired:()=>false,remainingMs:()=>10}});}},boundary);
 const result=await facade.recall({namespace:ns});
 assert.equal(erased,true,JSON.stringify(result));assert.equal(first.ok,true,JSON.stringify(first));assert.equal(afterCommit,0,'abort observers cannot reuse a sibling proof');assert.equal(second.ok,false);assert.equal(result.ok,false);assert.doesNotMatch(JSON.stringify(result),/ProtectedSyntheticAbort/);
});

test('caller reentry into a held canonical snapshot refuses before retained dispatch',async t=>{
 const {createMemoryRuntime}=await import('../runtime.mjs'),{contentSafetyFacade,assertContentPort}=await import('../content-safety-boundary.mjs');
 const {contentWriteBoundaryConnection}=await import('../content-write-context.mjs'),{countTokens}=await import('../model-budget.mjs');
 const {readTransaction}=await import('../database.mjs');
 const f=safetyFixture(t,33);await f.migrate();const db=f.connect();assert.equal(db.prepare('PRAGMA journal_mode=WAL').get().journal_mode.toUpperCase(),'WAL');
 const runtime=createMemoryRuntime({path:f.path}),core=openMemoryCore({path:f.path});t.after(()=>{runtime.close();core.close();db.close();});
 const memory=ok(core.admit({namespace:ns,memory:{content:'ProtectedSyntheticHeldSnapshot',kind:'fact'},receipts:[receipt('held')]})).memory;
 let erased=false,afterCommit=0,first,second;
 const boundary={check:runtime.assertContentScope,portGuard:runtime.contentPortGuard,failure:error=>({ok:false,error:{code:error.code}})};
 const connection=contentWriteBoundaryConnection(runtime.assertContentScope);
 const reader=contentSafetyFacade({get(){const page=connection.prepare('SELECT content FROM memories WHERE id=?').get(memory.id);countTokens({countTokens(){if(erased)afterCommit++;return 1;}},page.content);return {ok:true,value:page};}},boundary);
 const authority={isCurrent(){first=reader.get({namespace:ns});erase(db);erased=true;second=reader.get({namespace:ns});return true;}};
 const facade=contentSafetyFacade({get(){return readTransaction(connection,()=>{connection.prepare('SELECT content FROM memories WHERE id=?').get(memory.id);assertContentPort({invoke:()=>authority.isCurrent({}, {})});return {ok:true,value:{}};});}},boundary);
 const result=facade.get({namespace:ns});
 assert.equal(erased,true,JSON.stringify(result));assert.equal(first.ok,false,'new caller reads cannot use an engine-held snapshot');assert.equal(afterCommit,0);assert.equal(second.ok,false);assert.equal(result.ok,false);assert.doesNotMatch(JSON.stringify(second),/ProtectedSyntheticHeldSnapshot/);
});

for(const key of ['select','contextWindow'])test(`provider callback accessor ${key} is refused before retained counter dispatch`,async t=>{
 const {createMemoryRuntime}=await import('../runtime.mjs'),{contentSafetyFacade}=await import('../content-safety-boundary.mjs');
 const {callModel}=await import('../model-call.mjs');const f=safetyFixture(t);await f.migrate();const db=f.connect();
 const runtime=createMemoryRuntime({path:f.path}),core=openMemoryCore({path:f.path});t.after(()=>{runtime.close();core.close();db.close();});
 const memory=ok(core.admit({namespace:ns,memory:{content:'ProtectedSyntheticProviderLookup',kind:'fact'},receipts:[receipt('provider-lookup')]})).memory;
 let erased=false,lookups=0,counters=0,afterCommit=0;
 const model={contextWindow:8192,select:()=>({refs:[]}),countTokens(text){counters++;if(erased&&text.includes('ProtectedSyntheticProviderLookup'))afterCommit++;return 1;}};
 Object.defineProperty(model,key,{get(){lookups++;erase(db);erased=true;return key==='select'?()=>({refs:[]}):8192;}});
 const facade=contentSafetyFacade({async recall(){runtime.getPage(ns,memory.id,20);return callModel(model,'select','ProtectedSyntheticProviderLookup',{});}},
  {check:runtime.assertContentScope,portGuard:runtime.contentPortGuard,failure:error=>({ok:false,error:{code:error.code}})});
 const result=await facade.recall({namespace:ns});assert.equal(afterCommit,0,'no protected input is counted after a provider-lookup getter commits');assert.equal(lookups,0);assert.equal(counters,0);assert.equal(result.ok,false);assert.doesNotMatch(JSON.stringify(result),/ProtectedSyntheticProviderLookup/);
});

for(const journal of ['DELETE','WAL'])for(const kind of ['estimator','raw-policy'])
test(`synchronous error ${kind} ${journal}: error getters remain inside the caller boundary`,async t=>{
 const {createMemoryRuntime}=await import('../runtime.mjs'),{contentSafetyFacade}=await import('../content-safety-boundary.mjs');
 const {countTokens}=await import('../model-budget.mjs'),{createFakeEmbedder}=await import('../context-read-embedder.mjs');
 const f=safetyFixture(t,33);await f.migrate();const db=f.connect();assert.equal(db.prepare('PRAGMA journal_mode='+journal).get().journal_mode.toUpperCase(),journal);
 const seed=openMemoryCore({path:f.path}),runtime=createMemoryRuntime({path:f.path});
 const memory=ok(seed.admit({namespace:ns,memory:{content:'ProtectedSyntheticErrorGetter',kind:'fact'},receipts:[receipt('error-getter')]})).memory;
 let armed=false,erased=false,afterCommit=0,first,second,dispatches=0,getters=0;
 const boundary={check:runtime.assertContentScope,portGuard:runtime.contentPortGuard,failure:error=>({ok:false,error:{code:error.code}})};
 const reader=contentSafetyFacade({get(){const page=scopedPage(runtime,memory.id);countTokens({countTokens(){if(erased)afterCommit++;return 1;}},page.memory.content);return {ok:true,value:page};}},boundary);
 const error={get code(){getters++;if(!erased){first=reader.get({namespace:ns});erase(db);erased=true;second=reader.get({namespace:ns});}return 'provider_error';}};
 let core,action;
 if(kind==='estimator'){
  const h=host(),fake=createFakeEmbedder({dimensions:8});core=openMemoryCore({path:f.path,contextRead:{...h.context,embedder:{...fake,embed(...args){dispatches++;return fake.embed(...args);}},policy:{family:'hosted',maxRequests:10000,maxUsd:1,maxConcurrent:1,estimateUsd(){throw error;}}}});
  action=()=>core.refreshContextIndex({readSet:[ns],types:['memory'],intent:'current',budget:{maxItems:1024,maxMs:5000}},{});
 }else{
  const h=cardHost(),base=localPlainPort();core=openRawCaptureCore({path:f.path,privateCards:h.options,model:{contextWindow:8192,countTokens:()=>1,extract:()=>({items:[]})}},
   {mode:'raw-v1',port:{...base,sealRaw(...args){dispatches++;return base.sealRaw(...args);}},readPolicy(){if(armed)throw error;return {generation:'synthetic',reason:null};}});
  action=()=>core.captureRaw(request(splitRaw('Synthetic fresh input')[0],{namespace:ns,client:'codex',sessionId:'error-policy',eventId:'error-policy'}));
 }
 t.after(()=>{core.close();runtime.close();seed.close();db.close();});
 const facade=contentSafetyFacade({async recall(){runtime.getPage(ns,memory.id,20);return action();}},boundary);
 armed=true;const result=await facade.recall({namespace:ns});
 assert.ok(getters>0,'the error frame was inspected');assert.equal(erased,true,JSON.stringify(result));assert.equal(first.ok,true,JSON.stringify(first));
 assert.equal(afterCommit,0,'no retained counter dispatch from a getter on an escaped error');assert.equal(second.ok,false);assert.equal(dispatches,0);assert.equal(result.ok,false);assert.doesNotMatch(JSON.stringify(result),/ProtectedSyntheticErrorGetter/);
});

for(const journal of ['DELETE','WAL'])test(`seal return ${journal}: materialize before the single epoch fence`,async t=>{
 const f=safetyFixture(t,33);await f.migrate();const db=f.connect();
 assert.equal(db.prepare('PRAGMA journal_mode='+journal).get().journal_mode.toUpperCase(),journal);
 const base=localPlainPort();let calls=0,erased=false;
 const port={...base,async sealRaw(input){calls++;const result=await base.sealRaw(input);return {...result,get sealed(){if(!erased){erase(db);erased=true;}return result.sealed;}};}};
 const core=openRawCaptureCore({path:f.path,model:{countTokens:()=>1,contextWindow:8192,extract:()=>({items:[]})}},
  {mode:'raw-v1',port,readPolicy:()=>({generation:'synthetic',reason:null})});
 t.after(()=>{core.close();db.close();});
 const messages=[...splitRaw('ProtectedSyntheticSealOne',{id:'seal-one',ordinal:1}),...splitRaw('ProtectedSyntheticSealTwo',{id:'seal-two',ordinal:2})];
 const measured=await measureContentRead('captureRaw','seal-return-'+journal,()=>core.captureRaw(request(messages[0],{namespace:ns,eventId:'seal-return',messages})),()=>calls),result=measured.result;
 if(process.env.CAIRN_SEAL_REPORT)console.log(JSON.stringify({tag:'R3_SEAL_PORT',journal,calls,statements:measured.statements,begin:measured.begin,epochs:measured.trace}));
 const epochs=measured.trace.filter(row=>/^SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs/.test(row.sql));
 assert.equal(epochs.filter(row=>!row.transaction).length,2,'entry plus exactly one post-seal epoch observation');
 assert.equal(epochs.filter(row=>row.transaction).length,1,'only the erasure writer observes its epoch inside a transaction');
 assert.equal(measured.begin,1,'only the erasure writer opens a transaction');
 assert.equal(erased,true);assert.equal(calls,1,'erasure stops the second sealing dispatch');
 assert.equal(result.ok,false);assert.doesNotMatch(JSON.stringify(result),/ProtectedSynthetic/);
});

for(const journal of ['DELETE','WAL'])test(`policy return ${journal}: snapshot once before policy validation`,async t=>{
 const f=safetyFixture(t,33);await f.migrate();const db=f.connect();
 assert.equal(db.prepare('PRAGMA journal_mode='+journal).get().journal_mode.toUpperCase(),journal);
 const accesses=[];let poisonCalls=0,seals=0;
 const poison={toJSON(){poisonCalls++;erase(db);return 'raw_disabled';}};
 const base=localPlainPort(),core=openRawCaptureCore({path:f.path,model:{countTokens:()=>1,contextWindow:8192,extract:()=>({items:[]})}},
  {mode:'raw-v1',port:{...base,sealRaw(...args){seals++;return base.sealRaw(...args);}},readPolicy(){
   const index=accesses.push(0)-1;return {generation:'synthetic',get reason(){return ++accesses[index]===1?null:poison;}};
  }});
 t.after(()=>{core.close();db.close();});
 const result=await core.captureRaw(request(splitRaw('Synthetic fresh policy input')[0],{namespace:ns,eventId:'policy-return'}));
 assert.ok(accesses.length>0);assert.deepEqual(accesses,accesses.map(()=>1),'host properties sampled once per return');
 assert.equal(poisonCalls,0,'no unvalidated caller value reaches later serialization');assert.equal(seals,1);assert.equal(result.ok,true,JSON.stringify(result));
});

for(const kind of ['authority','raw-policy'])test(`changing error code ${kind}: only a checked primitive escapes`,async t=>{
 const {MemoryStoreError}=await import('../validation.mjs');
 const f=safetyFixture(t,33);await f.migrate();let reads=0;
 const error=new MemoryStoreError('provider_error'),poison={toJSON:()=> 'escaped-caller-value'};
 Object.defineProperty(error,'code',{get(){return ++reads<3?'provider_error':poison;}});
 const h=cardHost();let core,result;
 if(kind==='authority'){
  h.options.authority.authorize=()=>{throw error;};core=openMemoryCore({path:f.path,privateCards:h.options});
  result=await h.call(core,'listCards',{namespace:ns,states:['draft','confirmed'],limit:12});
 }else{
  core=openRawCaptureCore({path:f.path,model:{countTokens:()=>1,contextWindow:8192,extract:()=>({items:[]})}},
   {mode:'raw-v1',port:localPlainPort(),readPolicy(){throw error;}});
  result=await core.captureRaw(request(splitRaw('Synthetic error code input')[0],{namespace:ns,eventId:'changing-code'}));
 }
 t.after(()=>core.close());
 assert.ok(reads>0,'the caller error was framed');
 assert.equal(result.ok,false);assert.equal(typeof result.error.code,'string','error framing must not retain a changing caller value');
 assert.doesNotMatch(JSON.stringify(result),/escaped-caller-value/);
});

test('static core boundary import keeps caller error framing SQLite-free',async()=>{
 const {spawnSync}=await import('node:child_process');
 const entry=new URL('../content-safety-boundary.mjs',import.meta.url).href;
 const source=`import {registerHooks} from 'node:module';registerHooks({resolve(s,c,n){if(s==='node:sqlite')throw Error('SQLite linked');return n(s,c);}});await import(${JSON.stringify(entry)});`;
 const child=spawnSync(process.execPath,['--input-type=module','--eval',source],{encoding:'utf8',env:{...process.env}});
 assert.equal(child.status,0,child.stderr);assert.equal(child.stderr,'');
});

import { createMemoryRuntime } from '../runtime.mjs';
import { contentSafetyFacade } from '../content-safety-boundary.mjs';
import { countTokens } from '../model-budget.mjs';
import { callModel } from '../model-call.mjs';
for(const shape of ['aborted','addEventListener','removeEventListener'])test(`caller-owned signal ${shape}: no callback escapes its port`,async t=>{
 const f=safetyFixture(t);await f.migrate();const db=f.connect(),seed=openMemoryCore({path:f.path}),runtime=createMemoryRuntime({path:f.path});
 const memory=ok(seed.admit({namespace:ns,memory:{content:'ProtectedSyntheticSignal',kind:'fact'},receipts:[receipt('signal')]})).memory;
 let hooks=0,erased=false,afterCommit=0,embeds=0;
 const boundary={check:runtime.assertContentScope,portGuard:runtime.contentPortGuard,failure:error=>({ok:false,error:{code:error.code}})};
 const reader=contentSafetyFacade({get(){const conn=contentWriteBoundaryConnection(runtime.assertContentScope);const page=transaction(conn,()=>{runtime.assertContentScope([ns]);return conn.prepare('SELECT content FROM memories WHERE id=?').get(memory.id);});countTokens({countTokens(){if(erased)afterCommit++;return 1;}},page.content);return {ok:true};}},boundary);
 const hook=()=>{hooks++;if(erased)return;reader.get({namespace:ns});transaction(db,()=>suppressOwnerInside(db,{ownerId:ns.ownerId,reason:'account_erasure',actionId:'signal-hook'}));erased=true;reader.get({namespace:ns});};
 const authority={authorize(request){const {input,...binding}=request;return {...binding,accessGeneration:1};},isCurrent:g=>g};
 const core=openMemoryCore({path:f.path,contextRead:{version:'context-read-v1',authority,counter:{id:'synthetic',countTokens:()=>1},embedder:{id:'signal-fake',revision:'1',dimensions:2,normalization:'l2',embed(texts,{signal}){embeds++;if(shape==='aborted')Object.defineProperty(signal,'aborted',{get(){hook();return false;},configurable:true});else{const original=EventTarget.prototype[shape];Object.defineProperty(signal,shape,{value:function(...args){hook();return Reflect.apply(original,this,args);},configurable:true});}return texts.map(()=>[1,0]);}},policy:{family:'hosted',maxRequests:1000,maxUsd:1,maxConcurrent:1,estimateUsd:()=>0}}});
 t.after(()=>{core.close();runtime.close();seed.close();db.close();});
 const facade=contentSafetyFacade({async recall(){runtime.getPage(ns,memory.id,20);return core.refreshContextIndex({readSet:[ns],types:['memory'],intent:'current',budget:{maxItems:1024,maxMs:5000}},{});}},boundary);
 const result=await facade.recall({namespace:ns});console.log(JSON.stringify({shape,hooks,erased,afterCommit,embeds,ok:result.ok,error:result.error?.code}));
 assert.equal(afterCommit,0,'no retained counter dispatch from signal hooks');assert.equal(hooks,0,'engine signal operations use intrinsic access');assert.equal(embeds,1);assert.equal(result.ok,true,JSON.stringify(result));
});

test('caller-owned signal post-return slot: no callback runs after its epoch fence',async t=>{
 const f=safetyFixture(t);await f.migrate();const db=f.connect(),seed=openMemoryCore({path:f.path}),runtime=createMemoryRuntime({path:f.path});
 const memory=ok(seed.admit({namespace:ns,memory:{content:'ProtectedSyntheticSignalSlot',kind:'fact'},receipts:[receipt('signal-slot')]})).memory;
 let erased=false,afterCommit=0,embeds=0,epochs=0,start=0,hooks=0,slotFound=false;
 const prepare=DatabaseSync.prototype.prepare;DatabaseSync.prototype.prepare=function(sql){const connection=this,statement=prepare.call(this,sql);return new Proxy(statement,{get(target,key){const value=Reflect.get(target,key,target);return typeof value!=='function'?value:(...args)=>{if(['get','all'].includes(key)&&sql.startsWith('SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs')&&!connection.isTransaction)epochs++;return Reflect.apply(value,target,args);};}});};t.after(()=>{DatabaseSync.prototype.prepare=prepare;});
 const boundary={check:runtime.assertContentScope,portGuard:runtime.contentPortGuard,failure:error=>({ok:false,error:{code:error.code}})};
 const reader=contentSafetyFacade({get(){const conn=contentWriteBoundaryConnection(runtime.assertContentScope);const page=transaction(conn,()=>{runtime.assertContentScope([ns]);return conn.prepare('SELECT content FROM memories WHERE id=?').get(memory.id);});countTokens({countTokens(){if(erased)afterCommit++;return 1;}},page.content);return {ok:true};}},boundary);
 const hook=()=>{hooks++;reader.get({namespace:ns});transaction(db,()=>suppressOwnerInside(db,{ownerId:ns.ownerId,reason:'account_erasure',actionId:'signal-slot'}));erased=true;reader.get({namespace:ns});};
 const authority={authorize(request){const {input,...binding}=request;return {...binding,accessGeneration:1};},isCurrent:g=>g};
 const core=openMemoryCore({path:f.path,contextRead:{version:'context-read-v1',authority,counter:{id:'synthetic',countTokens:()=>1},embedder:{id:'signal-slot-fake',revision:'1',dimensions:2,normalization:'l2',embed(texts,{signal}){embeds++;start=epochs;const slot=Object.getOwnPropertySymbols(signal).find(s=>s.description==='kAborted');slotFound=Boolean(slot);if(!slot)return texts.map(()=>[1,0]);const descriptor=Object.getOwnPropertyDescriptor(signal,slot);Object.defineProperty(signal,slot,{get(){if(epochs>start&&!erased){Object.defineProperty(signal,slot,descriptor);hook();}return false;},configurable:true});return texts.map(()=>[1,0]);}},policy:{family:'hosted',maxRequests:1000,maxUsd:1,maxConcurrent:1,estimateUsd:()=>0}}});
 t.after(()=>{core.close();runtime.close();seed.close();db.close();});
 const facade=contentSafetyFacade({async recall(){runtime.getPage(ns,memory.id,20);return core.refreshContextIndex({readSet:[ns],types:['memory'],intent:'current',budget:{maxItems:1024,maxMs:5000}},{});}},boundary);
 const result=await facade.recall({namespace:ns});console.log(JSON.stringify({slot:true,hooks,erased,afterCommit,embeds,ok:result.ok,error:result.error?.code}));
 assert.equal(slotFound,true);assert.ok(hooks<=1);assert.equal(afterCommit,0,'post-epoch signal callbacks must retain caller reentry isolation');assert.equal(embeds,1);assert.equal(result.ok,!erased);
});

test('caller-owned model error signal: error framing uses private cancellation state',async t=>{
 const f=safetyFixture(t);await f.migrate();const db=f.connect(),seed=openMemoryCore({path:f.path}),runtime=createMemoryRuntime({path:f.path});
 const memory=ok(seed.admit({namespace:ns,memory:{content:'ProtectedSyntheticModelSignal',kind:'fact'},receipts:[receipt('model-signal')]})).memory;
 let erased=false,afterCommit=0,providers=0,hooks=0,slotFound=false;
 const boundary={check:runtime.assertContentScope,portGuard:runtime.contentPortGuard,failure:error=>({ok:false,error:{code:error.code}})};
 const reader=contentSafetyFacade({get(){const conn=contentWriteBoundaryConnection(runtime.assertContentScope);const page=transaction(conn,()=>{runtime.assertContentScope([ns]);return conn.prepare('SELECT content FROM memories WHERE id=?').get(memory.id);});countTokens({countTokens(){if(erased)afterCommit++;return 1;}},page.content);return {ok:true};}},boundary);
 const hook=()=>{hooks++;reader.get({namespace:ns});transaction(db,()=>suppressOwnerInside(db,{ownerId:ns.ownerId,reason:'account_erasure',actionId:'model-signal'}));erased=true;reader.get({namespace:ns});};
 const model={contextWindow:8192,countTokens:()=>1,select({signal}){providers++;const slot=Object.getOwnPropertySymbols(signal).find(s=>s.description==='kAborted');slotFound=Boolean(slot);if(!slot)throw Error('signal slot missing');const descriptor=Object.getOwnPropertyDescriptor(signal,slot);Object.defineProperty(signal,slot,{get(){Object.defineProperty(signal,slot,descriptor);hook();return false;},configurable:true});throw Error('Synthetic provider failure');}};
 t.after(()=>{runtime.close();seed.close();db.close();});const facade=contentSafetyFacade({async recall(){runtime.getPage(ns,memory.id,20);return callModel(model,'select','Synthetic',{});}},boundary);
 const result=await facade.recall({namespace:ns});console.log(JSON.stringify({modelSignal:true,hooks,erased,afterCommit,providers,ok:result.ok,error:result.error?.code}));
 assert.equal(slotFound,true);assert.equal(erased,true);assert.equal(hooks,1);assert.equal(afterCommit,0,'error signal hooks execute before the provider epoch read');assert.equal(providers,1);assert.equal(result.ok,false);
});

test('caller-owned signal pre-dispatch slot: next batch has no escaped hook',async t=>{
 const f=safetyFixture(t);await f.migrate();const db=f.connect(),seed=openMemoryCore({path:f.path}),runtime=createMemoryRuntime({path:f.path});
 const memory=ok(seed.admit({namespace:ns,memory:{content:'ProtectedSyntheticSignalSlot',kind:'fact'},receipts:[receipt('signal-slot')]})).memory;ok(seed.admit({namespace:ns,memory:{content:'ProtectedSyntheticSignalSlotTwo',kind:'fact'},receipts:[receipt('signal-slot-two')]}));
 let erased=false,afterCommit=0,embeds=0,epochs=0,start=0,hooks=0,slotFound=false;
 const prepare=DatabaseSync.prototype.prepare;DatabaseSync.prototype.prepare=function(sql){const connection=this,statement=prepare.call(this,sql);return new Proxy(statement,{get(target,key){const value=Reflect.get(target,key,target);return typeof value!=='function'?value:(...args)=>{if(['get','all'].includes(key)&&sql.startsWith('SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs')&&!connection.isTransaction)epochs++;return Reflect.apply(value,target,args);};}});};t.after(()=>{DatabaseSync.prototype.prepare=prepare;});
 const boundary={check:runtime.assertContentScope,portGuard:runtime.contentPortGuard,failure:error=>({ok:false,error:{code:error.code}})};
 const reader=contentSafetyFacade({get(){const conn=contentWriteBoundaryConnection(runtime.assertContentScope);const page=transaction(conn,()=>{runtime.assertContentScope([ns]);return conn.prepare('SELECT content FROM memories WHERE id=?').get(memory.id);});countTokens({countTokens(){if(erased)afterCommit++;return 1;}},page.content);return {ok:true};}},boundary);
 const hook=()=>{hooks++;reader.get({namespace:ns});transaction(db,()=>suppressOwnerInside(db,{ownerId:ns.ownerId,reason:'account_erasure',actionId:'signal-slot'}));erased=true;reader.get({namespace:ns});};
 const authority={authorize(request){const {input,...binding}=request;return {...binding,accessGeneration:1};},isCurrent:g=>g};
 const core=openMemoryCore({path:f.path,contextRead:{version:'context-read-v1',authority,counter:{id:'synthetic',countTokens:()=>1},embedder:{id:'signal-slot-fake',revision:'1',dimensions:2,normalization:'l2',embed(texts,{signal}){embeds++;start=epochs;const slot=Object.getOwnPropertySymbols(signal).find(s=>s.description==='kAborted');slotFound=Boolean(slot);if(!slot)return texts.map(()=>[1,0]);const descriptor=Object.getOwnPropertyDescriptor(signal,slot);Object.defineProperty(signal,slot,{get(){if(epochs>start&&!erased){Object.defineProperty(signal,slot,descriptor);hook();}return false;},configurable:true});return texts.map(()=>[1,0]);}},localStatus:()=>({state:'ready',reason:null}),policy:{family:'local',maxRequests:1000,maxConcurrent:1,maxBatchDocuments:1}}});
 t.after(()=>{core.close();runtime.close();seed.close();db.close();});
 const facade=contentSafetyFacade({async recall(){runtime.getPage(ns,memory.id,20);return core.refreshContextIndex({readSet:[ns],types:['memory'],intent:'current',budget:{maxItems:1024,maxMs:5000}},{});}},boundary);
 const result=await facade.recall({namespace:ns});console.log(JSON.stringify({slot:true,hooks,erased,afterCommit,embeds,ok:result.ok,error:result.error?.code}));
 assert.equal(slotFound,true);assert.ok(hooks<=1);assert.equal(afterCommit,0,'post-epoch signal callbacks must retain caller reentry isolation');assert.equal(embeds,1);assert.equal(erased,true);assert.equal(result.ok,false);
});


test('caller-owned signal late-dispatch slot: signal hooks precede the last canonical guard',async t=>{
 const previousLimit=Error.stackTraceLimit;Error.stackTraceLimit=100;t.after(()=>{Error.stackTraceLimit=previousLimit;});
 const f=safetyFixture(t);await f.migrate();const db=f.connect(),seed=openMemoryCore({path:f.path}),runtime=createMemoryRuntime({path:f.path});
 const memory=ok(seed.admit({namespace:ns,memory:{content:'ProtectedSyntheticSignalSlot',kind:'fact'},receipts:[receipt('signal-slot')]})).memory;ok(seed.admit({namespace:ns,memory:{content:'ProtectedSyntheticSignalSlotTwo',kind:'fact'},receipts:[receipt('signal-slot-two')]}));
 let erased=false,afterCommit=0,embeds=0,epochs=0,start=0,hooks=0,slotFound=false;
 const prepare=DatabaseSync.prototype.prepare;DatabaseSync.prototype.prepare=function(sql){const connection=this,statement=prepare.call(this,sql);return new Proxy(statement,{get(target,key){const value=Reflect.get(target,key,target);return typeof value!=='function'?value:(...args)=>{if(['get','all'].includes(key)&&sql.startsWith('SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs')&&!connection.isTransaction)epochs++;return Reflect.apply(value,target,args);};}});};t.after(()=>{DatabaseSync.prototype.prepare=prepare;});
 const boundary={check:runtime.assertContentScope,portGuard:runtime.contentPortGuard,failure:error=>({ok:false,error:{code:error.code}})};
 const reader=contentSafetyFacade({get(){const conn=contentWriteBoundaryConnection(runtime.assertContentScope);const page=transaction(conn,()=>{runtime.assertContentScope([ns]);return conn.prepare('SELECT content FROM memories WHERE id=?').get(memory.id);});countTokens({countTokens(){if(erased)afterCommit++;return 1;}},page.content);return {ok:true};}},boundary);
 const hook=()=>{hooks++;reader.get({namespace:ns});transaction(db,()=>suppressOwnerInside(db,{ownerId:ns.ownerId,reason:'account_erasure',actionId:'signal-slot'}));erased=true;reader.get({namespace:ns});};
 const authority={authorize(request){const {input,...binding}=request;return {...binding,accessGeneration:1};},isCurrent:g=>g};
 const core=openMemoryCore({path:f.path,contextRead:{version:'context-read-v1',authority,counter:{id:'synthetic',countTokens:()=>1},embedder:{id:'signal-slot-fake',revision:'1',dimensions:2,normalization:'l2',embed(texts,{signal}){embeds++;start=epochs;const slot=Object.getOwnPropertySymbols(signal).find(s=>s.description==='kAborted');slotFound=Boolean(slot);if(!slot)return texts.map(()=>[1,0]);const descriptor=Object.getOwnPropertyDescriptor(signal,slot);Object.defineProperty(signal,slot,{get(){if(epochs>start&&!erased&&new Error().stack.includes('beforeDispatch')){Object.defineProperty(signal,slot,descriptor);hook();}return false;},configurable:true});return texts.map(()=>[1,0]);}},localStatus:()=>({state:'ready',reason:null}),policy:{family:'local',maxRequests:1000,maxConcurrent:1,maxBatchDocuments:1}}});
 t.after(()=>{core.close();runtime.close();seed.close();db.close();});
 const facade=contentSafetyFacade({async recall(){runtime.getPage(ns,memory.id,20);return core.refreshContextIndex({readSet:[ns],types:['memory'],intent:'current',budget:{maxItems:1024,maxMs:5000}},{});}},boundary);
 const result=await facade.recall({namespace:ns});console.log(JSON.stringify({slot:true,hooks,erased,afterCommit,embeds,ok:result.ok,error:result.error?.code}));
 assert.equal(slotFound,true);assert.ok(hooks<=1);assert.equal(afterCommit,0,'post-epoch signal callbacks must retain caller reentry isolation');assert.equal(embeds,1);assert.equal(erased,true);assert.equal(result.ok,false);
});
