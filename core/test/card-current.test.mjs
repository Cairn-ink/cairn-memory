import { createCardCurrentStorage } from '../card-current-storage.mjs';
import { readTransaction } from '../database.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { unlinkSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { openMemoryCore, openContextReader } from '../index.mjs';
import { fixture, ns, project, ok, adopt, query, child, cardOptions, host, rendezvous, importMethod } from './card-current-fixture.mjs';
const denied=(r,code)=>assert.deepEqual(r,{ok:false,error:{code,retryable:false}});
const detail=(f,ref)=>ok(f.call('getCard',{namespace:ns,cardId:ref.cardId})).card;
const epochs=f=>['card_epochs','namespace_epochs'].map(table=>f.db.prepare('SELECT * FROM '+table).all());

test('C11/C13/C14/C16 finance adoption derives qualified history on all exact and candidate fetch forms; edit then revalidate restores current',async t=>{
 const f=fixture(t),ref=f.card(),original=detail(f,ref),frozen=epochs(f);
 ok(f.call('importMethodVersion',{...importMethod('unadopted-v3','unadopted future method'),package:f.v1.package,expectedPackageRevision:2,basedOn:f.v2.version}));
 assert.equal(detail(f,ref).support.currentDependency.status,'current');
 const current=ok(f.call('fetchEvidence',{namespace:ns,refs:[ref],intent:'current'}));
 const history=ok(f.call('fetchEvidence',{namespace:ns,refs:[ref],intent:'history'}));
 const contextCurrent=ok(await f.call('fetchCandidateEvidence',{readSet:[ns],refs:[ref],intent:'current'}));
 const contextHistory=ok(await f.call('fetchCandidateEvidence',{readSet:[ns],refs:[ref],intent:'history'}));
 const assembly=ok(await f.call('contextRead',query()));const compact=assembly.metered.items[0].ref;
 assert.equal(original.support.currentDependency.status,'current');
 assert.equal(ok(f.call('selectEvidence',{namespace:ns,query:'finance',types:['card'],intent:'current'})).items.length,1);
 f.change();assert.deepEqual(epochs(f),frozen);
 const stale=detail(f,ref);assert.equal(stale.title,original.title);assert.equal(stale.body,original.body);assert.equal(stale.revision,ref.revision);assert.equal(stale.bodyRevision,ref.bodyRevision);
 assert.equal(stale.support.currentDependency.status,'needs-review');assert.deepEqual(stale.support.currentDependency.reasons,['binding_changed']);
 assert.equal(stale.support.currentDependency.versions[0].described.versionId,f.v1.version.versionId);assert.equal(stale.support.currentDependency.versions[0].current.versionId,f.v2.version.versionId);
 assert.equal(ok(f.call('listCards',{namespace:ns,states:['confirmed']})).cards[0].support.currentDependency.status,'needs-review');
 assert.equal(ok(f.call('selectEvidence',{namespace:ns,query:'finance',types:['card'],intent:'current'})).items.length,0);
 denied(f.call('fetchEvidence',{namespace:ns,refs:[ref],intent:'current'}),'evidence_unavailable');
 denied(f.call('revalidateEvidence',{namespace:ns,snapshot:current.snapshot}),'evidence_unavailable');
 denied(f.call('revalidateEvidence',{namespace:ns,snapshot:history.snapshot}),'snapshot_stale');
 assert.equal(ok(f.call('fetchEvidence',{namespace:ns,refs:[ref],intent:'history'})).items[0].body,original.body);
 for(const input of [{refs:[ref],intent:'current'},{refs:[ref],intent:'current',fences:[compact.f]},{snapshot:contextCurrent.snapshot}])denied(await f.call('fetchCandidateEvidence',{readSet:[ns],...input}),'evidence_unavailable');
 denied(await f.call('fetchCandidateEvidence',{readSet:[ns],refs:[ref],intent:'history',fences:[compact.f]}),'snapshot_stale');
 denied(await f.call('fetchCandidateEvidence',{readSet:[ns],snapshot:contextHistory.snapshot}),'snapshot_stale');
 assert.equal(ok(await f.call('fetchCandidateEvidence',{readSet:[ns],refs:[ref],intent:'history'})).items[0].body,original.body);
 assert.equal(ok(await f.call('contextRead',query())).metered.items.length,0);
 const edited=ok(f.call('editKnowledgeCard',{namespace:ns,cardId:ref.cardId,expectedRevision:2,actionId:'edit',title:original.title,body:'finance monthly report uses v2',bindings:original.bindings.map(b=>b.source),applicability:'current'}));
 assert.equal(detail(f,ref).support.currentDependency.status,'needs-review');
 ok(f.call('revalidateCardCurrentDependencies',{namespace:ns,cardId:ref.cardId,expectedRevision:edited.revision,expectedDependencyRevision:1,actionId:'revalidate',currentDependencies:f.declaration()}));
 assert.equal(detail(f,ref).support.currentDependency.status,'current');assert.equal(ok(await f.call('contextRead',query())).metered.items.length,1);
});

test('C12/C15/C21 feature-off child/managed adoption invalidates warm pages and read-only readers, restart and full rebuild',async t=>{
 const f=fixture(t);for(let i=0;i<3;i++)f.card();
 const page=ok(await f.call('findCandidates',query({limit:1})));assert.ok(page.nextCursor);
 const storeId=f.db.prepare('SELECT store_id FROM store_metadata').get().store_id;
 const managed=openMemoryCore({path:f.path,privateCards:cardOptions(f.h.authority,false),methodPackages:f.h.methods,contextRead:f.h.context,existingStore:{version:'schema33-existing-v1',storeId}});t.after(()=>managed.close());
 const frozenRef=page.items[0].ref;assert.equal(ok(managed.getCard({namespace:ns,cardId:frozenRef.cardId},{})).card.support.currentDependency.status,'current');
 child(f,{method:'adoptMethodVersion',input:adopt(f.v2,'child-adopt',null,ns,1,[ns]),existingStore:{version:'schema33-existing-v1',storeId}});
 assert.equal(ok(managed.getCard({namespace:ns,cardId:frozenRef.cardId},{})).card.support.currentDependency.status,'needs-review');
 denied(managed.fetchCandidateEvidence({readSet:[ns],refs:[frozenRef],intent:'current'},{}),'evidence_unavailable');
 denied(await f.call('findCandidates',query({limit:1,cursor:page.nextCursor})),'cursor_stale');
 const reader=openContextReader({path:f.path,contextRead:f.h.context});t.after(()=>reader.close());
 assert.equal((await reader.findCandidates(query(),{})).error.code,'index_unavailable');
 assert.equal(ok(await f.call('findCandidates',query())).items.length,0);
 assert.equal(ok(await reader.findCandidates(query(),{})).items.length,0);
 f.reopen(false);assert.equal(f.core.revalidateCardCurrentDependencies,undefined);assert.equal(ok(await f.call('findCandidates',query())).items.length,0);
 unlinkSync(f.path+'.context-read-v1.sqlite');assert.equal(ok(await f.call('findCandidates',query())).items.length,0);
 child(f,{method:'disableMethodBinding',existingStore:{version:'schema33-existing-v1',storeId},input:{bindingNamespace:ns,package:f.v1.package,roleId:null,readSet:[ns],expectedRevision:2,actionId:'managed-disable'}});
 const disabled=ok(managed.getCard({namespace:ns,cardId:frozenRef.cardId},{})).card.support.currentDependency;assert.equal(disabled.status,'needs-review');assert.ok(disabled.reasons.includes('binding_disabled'));
});

test('C12 absence-aware project override, same-version adoption, rollback and disabled barriers require review',t=>{
 const f=fixture(t),ref=f.card({context:{readSet:[ns,project],roleId:'finance'}});
 // Exact-namespace metadata may never probe the undelegated project context.
 assert.deepEqual(detail(f,ref).support.currentDependency,{revision:1,status:'needs-review',reasons:['access_revoked']});
 const input={readSet:[ns,project],refs:[ref],intent:'current'};assert.equal(ok(f.call('fetchCandidateEvidence',input)).items.length,1);
 f.change(f.v1,{bindingNamespace:project,roleId:'finance',expectedRevision:null,readSet:[ns,project]});
 denied(f.call('fetchCandidateEvidence',input),'evidence_unavailable');
 const personal=f.card();f.change(f.v1,{expectedRevision:1});assert.equal(detail(f,personal).support.currentDependency.status,'needs-review');
 f.change(f.v2,{expectedRevision:2});f.change(f.v1,{expectedRevision:3});assert.equal(detail(f,personal).support.currentDependency.status,'needs-review');
 ok(f.call('disableMethodBinding',{bindingNamespace:ns,package:f.v1.package,roleId:null,readSet:[ns],expectedRevision:4,actionId:'disable'}));
 assert.ok(detail(f,personal).support.currentDependency.reasons.includes('binding_disabled'));
});

test('C17/C20 adoption during counters fences assembly and role guidance, while historical reason refs survive the same adoption',async t=>{
 let f,fire=false;const h=host({counter:{id:'race',countTokens(){if(fire){fire=false;child(f,{method:'adoptMethodVersion',input:adopt(f.v2,'counter-adopt',null,ns,1,[ns])});}return 1;}}});
 f=fixture(t,{h});const ref=f.card();
 ok(f.call('publishRoleProfileRelease',{namespace:ns,roleKey:'finance',actionId:'profile',expectedCurrentRelease:null,expectedRegistryRevision:null,fields:{duties:['Finance'],requiredOutputs:['Report'],related:[ref],methods:[f.v1.package]}}));
 const provenanceFields={duties:['Record provenance'],requiredOutputs:['Report']};
 const reasonHead=ok(f.call('publishRoleProfileRelease',{namespace:ns,roleKey:'reasons',actionId:'reason-head',expectedCurrentRelease:null,expectedRegistryRevision:null,fields:provenanceFields}));
 ok(f.call('publishRoleProfileRelease',{namespace:ns,roleKey:'reasons',actionId:'reason-release',expectedCurrentRelease:reasonHead.release,expectedRegistryRevision:1,fields:provenanceFields,changeReason:{text:'Recorded reason',reasonRefs:[ref]}}));
 const before=ok(await f.call('readRoleTaskContext',{mode:'now',roleKey:'finance',readSet:[ns],task:'finance'})).metered;
 assert.ok(before.evidence.length);fire=true;
 denied(await f.call('contextRead',query()),'snapshot_stale');
 const now=ok(await f.call('readRoleTaskContext',{mode:'now',roleKey:'finance',readSet:[ns],task:'finance'})).metered;
 assert.equal(now.profile.applicability,'unavailable');assert.equal(now.profile.release.fields,null);assert.equal(now.evidence.length,0);
 const historicalReason=ok(await f.call('readRoleTaskContext',{mode:'now',roleKey:'reasons',readSet:[ns]})).metered.profile.release.changeReason;assert.equal(historicalReason.status,'available');assert.equal(historicalReason.refs[0].status,'available');
 assert.deepEqual(ok(f.call('checkMethodReasonRefs',{namespace:ns,reasonRefs:[ref]})).reasonRefs.map(r=>r.status),['available']);
 ok(f.call('disableMethodBinding',{bindingNamespace:ns,package:f.v1.package,roleId:null,readSet:[ns],expectedRevision:2,actionId:'disable',reasonRefs:[ref]}));
 const events=ok(f.call('listMethodBindingEvents',{bindingNamespace:ns,package:f.v1.package})).events;assert.equal(events.at(-1).reasonRefs[0].status,'available');
 const then=ok(await f.call('readRoleTaskContext',{mode:'then',receipt:before.receipt,readSet:[ns]})).metered;assert.equal(then.receipt,before.receipt);assert.equal(then.evidence.length,0);
});

test('C17 deadline expiry still completes final dependency validation without a callback afterwards',async t=>{
 let now=0,calls=0;t.mock.method(performance,'now',()=>now);
 const h=host({counter:{id:'deadline',countTokens(){calls++;if(calls===4)now=6000;return 1;}}}),f=fixture(t,{h});f.card();
 const result=ok(await f.call('contextRead',query()));assert.equal(result.diagnostics.stops.deadline,true);assert.equal(result.metered.items.length,1);
 assert.deepEqual(result.diagnostics.trace.finalDependencyValidationReserve,{records:1,resolutions:1,bindingProbes:4,manifestRows:256});
 assert.equal(detail(f,{cardId:f.db.prepare('SELECT id FROM private_cards').get().id}).support.currentDependency.status,'current');
});

for(const enabled of [true,false])test(`C21 scope_changed after preparation/counting with declarations, authoring ${enabled}`,async t=>{
 let fire=false;const h=host({counter:{id:'revoke',countTokens(){if(fire)h.revoke();return 1;}}}),f=fixture(t,{h});f.card();f.reopen(enabled);fire=true;
 denied(await f.call('contextRead',query()),'scope_changed');
});

test('C22 authored bodies survive required source deletion; undeclared history remains unaffected by adoption and deleted versions cannot be reconstructed',t=>{
 const f=fixture(t),ref=f.card(),historical=f.card({declare:false,applicability:'historical',body:'Historical finance v1 fact'}),old=detail(f,ref);
 f.change();assert.equal(detail(f,historical).support.currentDependency,undefined);const retainedHistory=ok(f.call('fetchEvidence',{namespace:ns,refs:[historical],intent:'history'})).items[0];assert.equal(retainedHistory.body,'Historical finance v1 fact');assert.equal(retainedHistory.qualification.applicability,'historical');denied(f.call('fetchEvidence',{namespace:ns,refs:[historical],intent:'current'}),'evidence_unavailable');
 ok(f.call('deleteSourceNote',{namespace:ns,sourceId:old.bindings[0].source.sourceId,expectedRevision:1,actionId:'delete-source'}));
 assert.equal(detail(f,ref),null);const retained=f.db.prepare('SELECT * FROM private_cards WHERE id=?').get(ref.cardId);assert.equal(retained.body,old.body);
 const latest={...ref,revision:retained.revision};denied(f.call('fetchEvidence',{namespace:ns,refs:[latest],intent:'history'}),'evidence_unavailable');
 denied(f.call('fetchEvidence',{namespace:ns,refs:[latest],intent:'current'}),'evidence_unavailable');
 ok(f.call('deleteMethodVersion',{ref:f.v1.version,expectedRevision:1,actionId:'delete-version'}));
 const identity=f.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get();
 assert.ok(readTransaction(f.db,()=>createCardCurrentStorage({db:f.db,identity}).compare(ns,retained)).reasons.includes('version_deleted'));
 assert.equal(f.db.prepare('SELECT count(*) n FROM method_files WHERE version_id=?').get(f.v1.version.versionId).n,0);
});

test('C23 dual CAS, stale resolution refusal, replay before mutable checks, standalone byte/revision preservation',t=>{
 const f=fixture(t),ref=f.card({declare:false}),before=detail(f,ref);
 const input={namespace:ns,cardId:ref.cardId,expectedRevision:2,expectedDependencyRevision:null,actionId:'declare',currentDependencies:f.declaration()};
 const result=ok(f.call('declareCardCurrentDependencies',input));assert.equal(result.dependencyRevision,1);
 denied(f.call('declareCardCurrentDependencies',{...input,actionId:'other'}),'revision_conflict');
 f.change();denied(f.call('revalidateCardCurrentDependencies',{...input,actionId:'stale',expectedDependencyRevision:1}),'revision_conflict');
 const fresh={...input,currentDependencies:f.declaration(),expectedDependencyRevision:1,actionId:'fresh'};const revalidated=ok(f.call('revalidateCardCurrentDependencies',fresh));assert.equal(revalidated.dependencyRevision,2);
 const after=detail(f,ref);for(const field of ['title','body','revision','bodyRevision','updatedAt'])assert.equal(after[field],before[field]);
 denied(f.call('revalidateCardCurrentDependencies',{...fresh,actionId:'loser'}),'revision_conflict');
 ok(f.call('deleteKnowledgeCard',{namespace:ns,cardId:ref.cardId,expectedRevision:2,actionId:'delete'}));assert.deepEqual(ok(f.call('revalidateCardCurrentDependencies',fresh)),revalidated);
 denied(f.call('revalidateCardCurrentDependencies',{...fresh,expectedRevision:3}),'action_conflict');
});


test('C23 two rendezvoused real revalidations have exactly one winner',async t=>{
 const f=fixture(t),ref=f.card();f.change();
 const input={namespace:ns,cardId:ref.cardId,expectedRevision:2,expectedDependencyRevision:1,currentDependencies:f.declaration()};
 const a=rendezvous(t,f,{method:'revalidateCardCurrentDependencies',input:{...input,actionId:'rendezvous-a'}}),b=rendezvous(t,f,{method:'revalidateCardCurrentDependencies',input:{...input,actionId:'rendezvous-b'}});
 await Promise.all([a.ready(),b.ready()]);a.release();b.release();const results=await Promise.all([a.done,b.done]);assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.find(r=>!r.ok).error.code,'revision_conflict');assert.equal(detail(f,ref).support.currentDependency.revision,2);
});
for(const mutation of ['binding','edit','replacement','deletion'])test('C23 prepared real revalidation loses atomically to '+mutation,async t=>{
 const f=fixture(t),ref=f.card(),before=detail(f,ref),input={namespace:ns,cardId:ref.cardId,expectedRevision:2,expectedDependencyRevision:1,actionId:'prepared',currentDependencies:f.declaration()};
 const worker=rendezvous(t,f,{method:'revalidateCardCurrentDependencies',input});await worker.ready();
 if(mutation==='binding')f.change();
 if(mutation==='edit')ok(f.call('editKnowledgeCard',{namespace:ns,cardId:ref.cardId,expectedRevision:2,actionId:'edit-race',title:before.title,body:before.body+' edited',bindings:before.bindings.map(b=>b.source),applicability:'current'}));
 if(mutation==='replacement')ok(f.call('declareCardCurrentDependencies',{...input,actionId:'replacement'}));
 if(mutation==='deletion')ok(f.call('deleteKnowledgeCard',{namespace:ns,cardId:ref.cardId,expectedRevision:2,actionId:'delete-race'}));
 worker.release();const result=await worker.done;assert.equal(result.ok,false);assert.ok(['revision_conflict','card_state_conflict'].includes(result.error.code));
 assert.equal(f.db.prepare("SELECT count(*) n FROM card_operations WHERE action_id='prepared'").get().n,0);
});

for(const enabled of [true,false])test(`C21 revoked query-embedding await discards declared projections and makes no subsequent denied lookup (${enabled})`,async t=>{
 let armed=false,revoked=false,deniedLookups=0;const h=host(),embedder={id:'synthetic-current',revision:'1',dimensions:2,normalization:'l2',async embed(texts){if(armed){revoked=true;h.revoke();}return texts.map(()=>[1,0]);}};
 const f=fixture(t,{h});f.card();const contextRead={...h.context,embedder,policy:{maxRequests:10,maxUsd:1,estimateUsd:()=>0}};f.reopen(enabled,{contextRead});
 ok(await f.call('refreshContextIndex',{readSet:[ns],types:['card'],intent:'current',budget:{maxItems:1024,maxMs:5000}}));
 const {DatabaseSync}=await import('node:sqlite');const original=DatabaseSync.prototype.prepare;const spy=t.mock.method(DatabaseSync.prototype,'prepare',function(sql){if(revoked&&/method_(bindings|versions|files)|FROM private_cards/.test(sql))deniedLookups++;return original.call(this,sql);});
 armed=true;const result=await f.call('findCandidates',query({semantic:true}));assert.equal(revoked,true);denied(result,'scope_changed');assert.equal(deniedLookups,0);spy.mock.restore();
 denied(await f.call('findCandidates',query()),'authority_required');
});

for(const enabled of [true,false])test(`C21 independent fetch final authorization overrides prepared declared content (${enabled})`,async t=>{
 let prepared=false,revoked=false,deniedLookups=0;
 const h=host({onCurrent(request){if(prepared&&request.method==='fetchCandidateEvidence'){revoked=true;h.revoke();}}}),f=fixture(t,{h}),ref=f.card();f.reopen(enabled);
 const {DatabaseSync}=await import('node:sqlite');const original=DatabaseSync.prototype.prepare;const spy=t.mock.method(DatabaseSync.prototype,'prepare',function(sql){
  const s=original.call(this,sql);if(!/FROM private_cards|FROM method_(bindings|versions)/.test(sql))return s;
  return new Proxy(s,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return(...args)=>{if(revoked)deniedLookups++;const result=value.apply(target,args);if(/FROM private_cards/.test(sql))prepared=true;return result;};}});
 });
 denied(f.call('fetchCandidateEvidence',{readSet:[ns],refs:[ref],intent:'current'}),'scope_changed');assert.equal(deniedLookups,0);spy.mock.restore();
});

test('C20 role now and refresh refuse adoption between preparation and authoritative final validation',async t=>{
 for(const mode of ['now','refresh']){
  let f,armed=false;const h=host({counter:{id:'role-adoption-race',countTokens(){if(armed){armed=false;child(f,{method:'adoptMethodVersion',input:adopt(f.v2,'role-race',null,ns,1,[ns])});}return 1;}}});
  f=fixture(t,{h});const ref=f.card();ok(f.call('publishRoleProfileRelease',{namespace:ns,roleKey:'finance',actionId:'profile',expectedCurrentRelease:null,expectedRegistryRevision:null,fields:{duties:['Finance'],requiredOutputs:['Report'],related:[ref],methods:[f.v1.package]}}));
  const initial=ok(await f.call('readRoleTaskContext',{mode:'now',roleKey:'finance',readSet:[ns],task:'finance'}));armed=true;
  denied(await f.call('readRoleTaskContext',{mode,readSet:[ns],task:'finance',...(mode==='refresh'?{receipt:initial.metered.receipt}:{roleKey:'finance'})}),'snapshot_stale');
 }
});


test('C23 revalidation requires the exact package set and preserves declaration order across reviewed permutations',t=>{
 const f=fixture(t),other=ok(f.call('importMethodVersion',importMethod('other-package')));ok(f.call('adoptMethodVersion',adopt(other,'other-adopt')));
 const ref=f.card({packages:[f.v1.package,other.package]}),before=detail(f,ref).support.currentDependency.versions;
 const input={namespace:ns,cardId:ref.cardId,expectedRevision:2,expectedDependencyRevision:1,actionId:'permuted',currentDependencies:f.declaration(undefined,[other.package,f.v1.package])};
 ok(f.call('revalidateCardCurrentDependencies',input));assert.deepEqual(detail(f,ref).support.currentDependency.versions,before);
 denied(f.call('revalidateCardCurrentDependencies',{...input,actionId:'incomplete',expectedDependencyRevision:2,currentDependencies:f.declaration(undefined,[f.v1.package])}),'revision_conflict');
});

test('C15 the affected continuation page would be empty after adoption, and the frozen cursor still refuses', async t => {
 const f=fixture(t),ref=f.card({title:'Endpoint',body:'finance'});
 const memory=ok(f.core.admit({namespace:ns,memory:{content:'finance finance finance finance',kind:'fact'},receipts:[{client:'s',sessionId:'s',eventId:'first',role:'user',excerpt:'finance'}]})).memory;
 const request=query({types:['memory','card'],limit:1});
 const first=ok(await f.call('findCandidates',request));assert.equal(first.items[0].ref.memoryId,memory.id);assert.ok(first.nextCursor);
 const second=ok(await f.call('findCandidates',{...request,cursor:first.nextCursor}));assert.deepEqual(second.items.map(item=>item.ref.cardId),[ref.cardId]);assert.equal(second.nextCursor,null);
 f.change();
 const fresh=ok(await f.call('findCandidates',{...request,limit:24}));assert.deepEqual(fresh.items.map(item=>item.ref.memoryId),[memory.id]);assert.deepEqual(fresh.items.slice(first.items.length),[]);
 denied(await f.call('findCandidates',{...request,cursor:first.nextCursor}),'cursor_stale');
});
