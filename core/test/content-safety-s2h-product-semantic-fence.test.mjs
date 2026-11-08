import '../testing/context-product-test-clock.mjs';
import { costGateFamilies } from '../testing/content-safety-cost-families.mjs';
// Install the shared clock before product factories capture their timers.
import { DatabaseSync } from 'node:sqlite';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setupProductSemantic,ns,ok } from '../testing/content-safety-s2h-product-semantic-probe.mjs';
import { openContextIndexMaintainer,openContextProductReader } from '../index.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { productSidecar } from '../context-product-sidecar.mjs';
import { productVectors } from '../context-product-vectors.mjs';
import { createProductSqlitePolicy } from '../context-product-sqlite.mjs';
import { accessDigest,digest } from '../context-product-validation.mjs';
import { semanticHandle } from '../context-semantic-coordinator.mjs';
import { semanticClient } from '../context-semantic-client.mjs';

// Fail-before: query transmission on a6ec0e0e ignores suppressionEpoch and
// dispatches the provider for each malformed projection below. No synthetic
// wrapper replaces the native service Worker, ledger or IPC transport.
for(const family of costGateFamilies())for(const base of [18,23,33])for(const journal of ['DELETE','WAL'])test(`native query epoch projection v${base} ${family} ${journal}`,async t=>{
 const s=await setupProductSemantic(t,{version:base,family,safety:true,corpus:1,canonicalMode:journal});
 ok(await s.coordinator.setOwnerSemantic({ownerId:ns.ownerId,semantic:true,expectedRevision:0},s.token));
 const m=s.configure(true),h=await openContextIndexMaintainer(m.options);s.f.workspace.defer(()=>h.close());
 const input={readSet:[ns],types:['memory'],intent:'current'};
 ok(await h.refreshContextIndex({...input,mode:'lexical',budget:{maxItems:1024,maxMs:5000}},m.credential));
 ok(await h.refreshContextIndex({...input,mode:'embeddings',budget:{maxItems:1024,maxMs:5000,maxUsd:'0.50'}},m.credential));
 const sqlite=createProductSqlitePolicy();sqlite.start(Number(process.hrtime.bigint())/1e6+30000);
 const facade=openContextProductFacade(s.f.path,{sqlite});t.after(()=>facade.close());
 const storage=productSidecar({path:s.f.path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,sqlite});t.after(()=>storage.close());
 const handle=semanticHandle(s.coordinator),port=handle.attach({ownerId:ns.ownerId,path:s.f.path,readSet:[ns],maintenance:false});
 const client=semanticClient(port,{ownerState:handle.ownerState,writer:'0'},()=>({operationId:randomUUID(),operationCutoffMonoNs:String(process.hrtime.bigint()+5000000000n)}));t.after(()=>client.close());
 const snapshot=await client.snapshot(),p={...input,ownerCoverage:m.options.ownerCoverage};
 const observed=facade.port.read(()=>storage.observe(p,accessDigest(m.options.host.configuration.serviceBinding)));
 const vector=productVectors({storage,facade}).observe(p,observed.publication,snapshot);
 assert.equal(vector.status,'complete','control: independently observed native vector publication is complete');
 for(const variant of ['absent','different','nonprimitive'])await t.test(variant,async()=>{
   const projection={...input,accessDigest:observed.publication.accessDigest,lexicalValidationDigest:digest(observed.publication),vectorValidationDigest:digest(vector.record),
     ...(variant==='absent'?{}:{suppressionEpoch:variant==='different'?'0:1':{epoch:'0:0'}})};
   const attempts=Atomics.load(s.view,4);
   const result=await client.call('embed',{texts:['synthetic query'],kind:'query',expected:snapshot.policy,projection}).then(()=>({ok:true}),error=>({ok:false,code:error.code}));
   assert.equal(result.ok,false,'query projection must bind its captured primitive suppression epoch');
   assert.equal(Atomics.load(s.view,4),attempts,'invalid query projection cannot reach the provider');
   assert.doesNotMatch(JSON.stringify(result),/semantic probecommon synthetic evidence/,'control: refusal has no protected content');
 });
 client.close();storage.close();facade.close();await h.close();await s.coordinator.close();await s.supervisor.close();
});

// Controls on a6ec0e0e: a positive same-namespace fact still suppresses every
// retained surface, while unrelated facts do not erase readable neighbours.
// These pin the behaviour of the newly folded visible-count proof.
for(const family of costGateFamilies())for(const base of [18,23,33])for(const journal of ['DELETE','WAL'])for(const intent of ['current','history'])test(`control native positive fact v${base} ${family} ${journal} ${intent}`,async t=>{
 const s=await setupProductSemantic(t,{version:base,family,safety:true,corpus:12,canonicalMode:journal});
 ok(await s.coordinator.setOwnerSemantic({ownerId:ns.ownerId,semantic:true,expectedRevision:0},s.token));
 const m=s.configure(true),h=await openContextIndexMaintainer(m.options);s.f.workspace.defer(()=>h.close());
 const input={readSet:[ns],types:['memory'],intent};
 ok(await h.refreshContextIndex({...input,mode:'lexical',budget:{maxItems:1024,maxMs:5000}},m.credential));
 ok(await h.refreshContextIndex({...input,mode:'embeddings',budget:{maxItems:1024,maxMs:5000,maxUsd:'0.50'}},m.credential));
 const zero=new DatabaseSync(s.f.path);
 try{zero.prepare('INSERT INTO owner_suppression_epochs VALUES(?,0,0)').run(ns.ownerId);}finally{zero.close();}
 const zeroStatus=ok(await h.getContextIndexStatus(input,m.credential));
 assert.equal(zeroStatus.lexical.progress,null,'control: a present zero epoch still hides progress');
 assert.equal(zeroStatus.coverage.byType.memory.eligible,null,'control: row presence is distinct from the zero epoch');
 const db=new DatabaseSync(s.f.path);let target;
 try{target=db.prepare('SELECT id,content FROM memories ORDER BY id LIMIT 1').get();transaction(db,()=>{
   for(let i=0;i<5;i++)writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:i===0?target.id:'unrelated-positive-'+i,reason:'user_forget',actionId:'positive-'+i});
 });}finally{db.close();}
 const status=ok(await h.getContextIndexStatus(input,m.credential));
 assert.equal(status.lexical.progress,null,'control: fact-bearing metadata hides progress');
 assert.equal(status.coverage.byType.memory.embedded,null,'control: fact-bearing metadata hides embedded counts');
 if(base===33)assert.equal(status.coverage.byType.memory.eligible,null,'control: Raw ancestry keeps visible counts unknown');
 else assert.equal(status.coverage.byType.memory.eligible,11,'control: positive fact removes exactly one visible Memory');
 const refreshed=ok(await h.refreshContextIndex({...input,mode:'embeddings',budget:{maxItems:1024,maxMs:5000,maxUsd:'0.50'}},m.credential));
 assert.equal(refreshed.coverage.stops.budget,null,'control: maintenance hides fact-dependent budget metadata');
 assert.deepEqual(refreshed.progress,{lexical:null,transformed:null,embeddingAttempts:null,embedded:null},'control: maintenance hides fact-dependent work');
 const r=s.configure(false),reader=await openContextProductReader(r.options);s.f.workspace.defer(()=>reader.close());
 for(const method of ['findCandidates','contextRead']){
   const result=await reader[method]({...input,query:'semantic',semantic:true,deadlineMs:5000,...(method==='findCandidates'?{limit:12}:{budget:{maxTokens:4000,maxItems:12}})},r.credential);
   assert.equal(result.ok,true,'control: readable neighbours remain available');
   const items=method==='findCandidates'?result.value.items:result.value.metered.items;
   assert.equal(items.length,11,'control: only the positive target is excluded');
   assert.ok(items.every(item=>item.ref.memoryId!==target.id),'control: no forgotten ref');
   assert.ok(!JSON.stringify(result).includes(target.content),'control: no forgotten text on any response surface');
 }
 await reader.close();await h.close();await s.coordinator.close();await s.supervisor.close();
});
