import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../index.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { openDatabase, transaction } from '../database.mjs';
import { createMemoryRelationStorage } from '../memory-relations-storage.mjs';
import { relateCapturedMemories } from '../memory-relations.mjs';
import { installMemoryThreadLayout } from '../testing/install-memory-thread-layout.mjs';
import { previousRelationDDL } from '../memory-relations-schema.mjs';
import { attestContentSafety } from '../content-safety-schema.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';
import { measureContentRead } from '../testing/content-safety-cost-meter.mjs';
import { host } from '../testing/context-read-core-fixture.mjs';
import { memoryThreadFixture } from '../testing/memory-thread-fixture.mjs';
const otherOwner={...ns,ownerId:'synthetic-other'},otherProject={...ns,projectId:'synthetic-other'};
const admit=(core,namespace,text)=>ok(core.admit({namespace,memory:{content:text,kind:'fact'},receipts:[receipt(text)]})).memory;

for(const graph of ['absent','empty','present'])test(`candidate, resolve and expand helpers independently enforce scope and canonical eligibility; graph=${graph}`,async t=>{
 const f=safetyFixture(t);await f.migrate();
 const core=openMemoryCore({path:f.path}),db=openDatabase(f.path);t.after(()=>{core.close();db.close();});
 const a=admit(core,ns,'Synthetic breakfast allowed'),b=admit(core,ns,'Synthetic breakfast peer');
 const owner=admit(core,otherOwner,'Synthetic breakfast foreign owner'),project=admit(core,otherProject,'Synthetic breakfast foreign project');
 const forgotten=admit(core,ns,'Synthetic breakfast forgotten'),suppressed=admit(core,ns,'Synthetic breakfast suppressed'),orphan=admit(core,ns,'Synthetic breakfast without retained source');
 db.prepare('DELETE FROM receipts WHERE memory_id=?').run(orphan.id);
 ok(core.forget({namespace:ns,memoryId:forgotten.id,expectedRevision:forgotten.revision}));
 transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:suppressed.id,reason:'purge',actionId:'hide'}));
 if(graph!=='absent')installMemoryThreadLayout(f.path);
 if(graph==='present')db.prepare(`INSERT INTO memory_relations(id,from_memory_id,from_revision,to_memory_id,to_revision,relation,confidence,decided_by,created_at)
 VALUES('allowed-edge',?,?,?,?,'same_thread',1,'user','now')`).run(b.id,b.revision,a.id,a.revision);
 const runtime=createMemoryRuntime({path:f.path});t.after(()=>runtime.close());
 const refs=[a,b,owner,project,forgotten,suppressed,orphan].map(m=>({id:m.id,revision:m.revision}));
 assert.deepEqual(runtime.relationCandidates(ns,[{content:'Synthetic breakfast'}])[0].map(r=>r.id).sort(),[a.id,b.id].sort());
 assert.deepEqual(runtime.resolveRelationCandidates(ns,[...refs,{id:a.id,revision:a.revision+1}]).map(r=>r.id).sort(),[a.id,b.id].sort());
 for(const [namespace,memory] of [[otherOwner,owner],[otherProject,project]]){
  assert.deepEqual(runtime.resolveRelationCandidates(namespace,refs).map(r=>r.id),[memory.id]);
  assert.deepEqual(runtime.relationCandidates(namespace,[{content:'Synthetic breakfast'}])[0].map(r=>r.id),[memory.id]);
 }
 const expanded=runtime.expandRelationRefs([ns],refs.map(ref=>({namespaceIndex:0,memoryId:ref.id,revision:ref.revision})).concat([
  {namespaceIndex:0,memoryId:a.id,revision:a.revision+1},{namespaceIndex:8,memoryId:a.id,revision:a.revision}]));
 assert.deepEqual([...new Set(expanded.map(ref=>ref.memoryId))].sort(),[a.id,b.id].sort());
 assert.ok(expanded.every(ref=>ref.namespaceIndex===0));
});

for(const state of ['enabled','disabled','managed','pinned','fenced','revision-one','revision-two','dirty-cache'])test(`relationWritesEnabled and relationMode execute zero SQL: ${state}`,async t=>{
 const f=safetyFixture(t,state==='managed'?33:18);
 if(state==='pinned')await f.migrate();
 const db=openDatabase(f.path);t.after(()=>db.close());
 if(state==='revision-one'){
  transaction(db,()=>{db.exec('ALTER TABLE memory_conflicts RENAME TO old_conflicts');db.exec(previousRelationDDL);db.exec('DROP TABLE old_conflicts; PRAGMA user_version=118');attestContentSafety(db);});
 }
 if(state==='revision-two')installMemoryThreadLayout(f.path);
 const storeId=db.prepare('SELECT store_id FROM store_metadata').get().store_id;
 const {lstatSync}=await import('node:fs');const stat=lstatSync(f.path);
 const fence={version:'store-fence-v1',dev:String(stat.dev),ino:String(stat.ino),storeId,applicationId:db.prepare('PRAGMA application_id').get().application_id,userVersion:db.prepare('PRAGMA user_version').get().user_version};
 const runtime=createMemoryRuntime({path:f.path,...(state==='disabled'?{memoryRelations:false}:{}),
  ...(state==='managed'?{existingStore:{version:'schema33-existing-v1',storeId}}:{}),
  ...(state==='fenced'?{storeFence:fence}:{}),
  ...(state==='pinned'?{existingStore:{version:'content-safety-existing-v1',storeId,physical:34,base:18,suppressionRevision:1,cardLineageRevision:0}}:{})});t.after(()=>runtime.close());
 if(state==='dirty-cache')installMemoryThreadLayout(f.path);
 for(const method of ['relationWritesEnabled','relationMode']){
  const row=await measureContentRead(method,state,()=>runtime[method]());
  assert.equal(row.statements,0,JSON.stringify(row.sql));assert.equal(row.ports,0);
  assert.equal(row.result,method==='relationMode'?state==='revision-two':!['disabled','managed','pinned','fenced'].includes(state));
 }
});

test('pending relation times isolate identical fingerprints across owners/projects and reject foreign receipt clocks',t=>{
 const f=safetyFixture(t),core=openMemoryCore({path:f.path}),db=openDatabase(f.path);t.after(()=>{core.close();db.close();});
 const storage=createMemoryRelationStorage({db,advanceEpoch:()=>{}});
 const entries=[];
 for(const [index,namespace] of [ns,otherOwner,otherProject].entries()){
  const m=admit(core,namespace,'My breakfast is oats.');const row=db.prepare('SELECT * FROM memories WHERE id=?').get(m.id);
  const p=db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(m.id).id;
  const entry={factIndex:0,memoryId:m.id,memoryRevision:m.revision,item:{fingerprint:row.fingerprint},insertedReceiptIds:[p]};
  const time=`2026-01-0${index+1}T00:00:00.000Z`;
  transaction(db,()=>storage.insert(namespace,[entry],[{factIndex:0,timingOnly:true,eventTime:time}]));
  entries.push({namespace,m,entry,time});
 }
 for(const {namespace,m,time} of entries)assert.equal(storage.resolve(namespace,[{id:m.id,revision:m.revision}])[0].eventTime,time);
 const {m,entry}=entries[0];
 // A pending hint with another memory's receipt is not evidence, even when its
 // fingerprint, memory ID and namespace otherwise match.
 transaction(db,()=>storage.insert(ns,[{...entry,insertedReceiptIds:entries[1].entry.insertedReceiptIds}], [{factIndex:0,timingOnly:true,eventTime:'2090-01-01T00:00:00.000Z'}]));
 assert.notEqual(storage.resolve(ns,[{id:m.id,revision:m.revision}])[0].eventTime,'2090-01-01T00:00:00.000Z');
 installMemoryThreadLayout(f.path);
 const peer=admit(core,ns,'My breakfast is eggs.');
 const p=db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(peer.id).id;
 transaction(db,()=>storage.insert(ns,[{factIndex:0,memoryId:peer.id,memoryRevision:peer.revision,item:{},insertedReceiptIds:entries[1].entry.insertedReceiptIds}], [{factIndex:0,timingOnly:true,eventTime:'2090-01-01T00:00:00.000Z'}]));
 assert.equal(db.prepare('SELECT count(*) n FROM memory_relation_times WHERE memory_id=?').get(peer.id).n,0,'new clocks also require a receipt owned by this exact memory');
 transaction(db,()=>storage.insert(ns,[{factIndex:0,memoryId:peer.id,memoryRevision:peer.revision,item:{},insertedReceiptIds:[p],
  previousRelationTime:{memory_id:peer.id,event_time:'2090-01-01T00:00:00.000Z',receipt_id:entries[2].entry.insertedReceiptIds[0]}}], [{factIndex:0,timingOnly:true,eventTime:'2026-03-01T00:00:00.000Z'}]));
 assert.equal(db.prepare('SELECT event_time FROM memory_relation_times WHERE memory_id=?').get(peer.id).event_time,'2026-03-01T00:00:00.000Z');
});

test('post-validation emits only the exact per-fact shown candidate IDs and revisions and drops batch prose',async()=>{
 const a={id:'candidate-a',revision:3,content:'My breakfast is oats.'},b={id:'candidate-b',revision:7,content:'My lunch is rice.'};
 const model={contextWindow:8192,countTokens:()=>1,relateMemories:()=>({facts:[0,1].map(factIndex=>({factIndex,edges:[
  {candidateId:'foreign',relation:'contradicts',confidence:1},...[a,b].map(c=>({candidateId:c.id,relation:'contradicts',confidence:1,reason:'Untracked prose'}))]}))})};
 const result=await relateCapturedMemories({model,items:[{content:'My breakfast is eggs.'},{content:'My lunch is soup.'}],operations:{relationCandidates:()=>[[a],[b]]}});
 assert.deepEqual(result.filter(r=>!r.timingOnly).map(({factIndex,candidateId,candidateRevision,reason})=>({factIndex,candidateId,candidateRevision,reason})),[
  {factIndex:0,candidateId:a.id,candidateRevision:3,reason:null},{factIndex:1,candidateId:b.id,candidateRevision:7,reason:null}]);
});

test('get, recall and product Worker thread dates/metadata exclude foreign owners and same-owner other projects',async t=>{
 const f=memoryThreadFixture(t,{tier:2}),namespace={ownerId:'synthetic-thread',scope:'project',projectId:'visible'};
 const foreign=[{...namespace,ownerId:'synthetic-foreign'},{...namespace,projectId:'foreign'}];
 let visible=[];const hidden=[];
 for(const target of [namespace,...foreign]){
  const ids=[];
  for(const [i,word] of ['oats','eggs'].entries())ids.push((await f.capture(`My breakfast is ${word}.`,{namespace:target,occurredAt:`2026-01-0${i+1}T00:00:00.000Z`})).admission.memories[0].id);
  if(target===namespace)visible=ids;else hidden.push(...ids);
 }
 for(const id of visible){const result=ok(f.core.get({namespace,memoryId:id}));assert.ok(result.relations.length);assert.ok(result.relations.every(r=>visible.includes(r.memoryId)));}
 f.model.select=()=>({refs:[{namespaceIndex:0,memoryId:visible[0],revision:ok(f.core.get({namespace,memoryId:visible[0]})).memory.revision}]});
 f.model.rank=({input})=>({refs:input.candidates.map(c=>({namespaceIndex:c.namespaceIndex,memoryId:c.memory.id,revision:c.memory.revision}))});
 const recall=ok(await f.core.recall({readSet:[namespace],query:'breakfast',limit:2}));
 assert.deepEqual(recall.memories.map(r=>r.memory.id).sort(),visible.sort());
 for(const id of hidden)assert.ok(!JSON.stringify(recall).includes(id));
 const {configured,prebuild}=await import('../testing/context-product-owner-fixture.mjs');
 for(const target of [...foreign,namespace])await prebuild(configured(t,f.path,[target],{service:true}),['memory']);
 const config=configured(t,f.path,[namespace]),reader=await config.open();
 const pack=ok(await reader.contextRead({readSet:[namespace],types:['memory'],intent:'current',query:'breakfast',semantic:false,deadlineMs:5000,budget:{maxItems:1,maxTokens:6000}},config.token));
 assert.deepEqual(pack.metered.items.map(r=>r.ref.id).sort(),visible.sort());
 assert.ok(pack.metered.items.every(r=>r.date&&r.metadata.thread.eventTime&&visible.includes(r.metadata.thread.currentMemoryId)&&r.metadata.relations.every(edge=>visible.includes(edge.memoryId))));
 for(const id of hidden)assert.ok(!JSON.stringify(pack).includes(id));
});

test('vector lookup isolates owners/projects with identical metadata and rejects stale, forgotten and suppressed refs',async t=>{
 const {createFakeEmbedder}=await import('../context-read-embedder.mjs');
 const {withMemoryRelationVectors,unionMemoryRelationCandidates}=await import('../memory-relations-vectors.mjs');
 const {host}=await import('../testing/context-read-core-fixture.mjs');
 const f=safetyFixture(t);await f.migrate();const h=host();h.state.allowed=[ns,otherOwner,otherProject];
 const embedder=createFakeEmbedder();
 const core=openMemoryCore({path:f.path,contextRead:{version:'context-read-v1',authority:h.authority,counter:{id:'synthetic',countTokens:()=>1},embedder,policy:{family:'local',maxRequests:1000,maxUsd:1,maxConcurrent:1,estimateUsd:()=>0}}}),db=openDatabase(f.path);
 t.after(()=>{core.close();db.close();});
 const live=admit(core,ns,'Synthetic identical vector breakfast'),owner=admit(core,otherOwner,'Synthetic identical vector breakfast'),project=admit(core,otherProject,'Synthetic identical vector breakfast');
 const stale=admit(core,ns,'Synthetic stale vector breakfast'),forgotten=admit(core,ns,'Synthetic forgotten vector breakfast'),suppressed=admit(core,ns,'Synthetic suppressed vector breakfast');
 for(const namespace of [ns,otherOwner,otherProject]){
  let complete=false;for(let i=0;i<100;i++)if(ok(await h.call(core,'refreshContextIndex',{readSet:[namespace],types:['memory'],intent:'current',budget:{maxItems:1024,maxMs:5000}})).status==='complete'){complete=true;break;}
  assert.ok(complete);
 }
 ok(core.forget({namespace:ns,memoryId:forgotten.id,expectedRevision:forgotten.revision}));
 db.prepare('UPDATE memories SET revision=revision+1 WHERE id=?').run(stale.id);
 transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:suppressed.id,reason:'purge',actionId:'vector-hide'}));
 const runtime=createMemoryRuntime({path:f.path});t.after(()=>runtime.close());
 for(const [namespace,memory] of [[ns,live],[otherOwner,owner],[otherProject,project]]){
  const probes=[];
  const result=await withMemoryRelationVectors({path:f.path,embedder,dispatch:(port,texts)=>port.embed(texts)},()=>unionMemoryRelationCandidates(namespace,[{content:'Synthetic vector query'}],[[]],refs=>{probes.push(...refs);return runtime.resolveRelationCandidates(namespace,refs);},runtime.identity));
  assert.deepEqual(result[0].map(row=>row.id),[memory.id]);assert.ok(probes.length>0,'cache path actually resolved vector candidates');
  for(const foreign of [live,owner,project].filter(m=>m.id!==memory.id))assert.ok(!probes.some(p=>p.id===foreign.id),'namespace predicate excludes foreign cache keys before resolve');
 }
});

test('temporal self preferences preserve the model label and the prompt supplies each worked label example',async()=>{
 const candidate={id:'earlier',revision:2,content:'I like coffee.',eventTime:'2026-01-01T00:00:00.000Z'};
 const result=await relateCapturedMemories({model:{contextWindow:8192,countTokens:()=>1,relateMemories:({system,input})=>{
  for(const label of ['supersedes','contradicts','refines','causes','null'])assert.ok(system.includes('- '+label+':'));
  assert.match(system,/I stopped drinking coffee because it upsets my stomach/);
  assert.notEqual(input.facts[0].eventTime,input.candidates[0][0].eventTime);
  return {facts:[{factIndex:0,edges:[{candidateId:'earlier',relation:'contradicts',confidence:1,reason:'Synthetic endpoint reason'}]}]};
 }},items:[{content:'I stopped drinking coffee because it upsets my stomach.',receiptTimes:['2026-02-01T00:00:00.000Z']}],operations:{relationCandidates:()=>[[candidate]]}});
 assert.equal(result.find(r=>!r.timingOnly).relation,'contradicts','only the model chooses the label');
 assert.equal(result.find(r=>!r.timingOnly).reason,'Synthetic endpoint reason','the endpoint-only request may retain prose');
});
