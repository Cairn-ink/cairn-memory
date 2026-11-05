import { costGateFamilies, costFamilyLabel, costFamilyFixture, costFamilyPhysical } from '../testing/receipt-event-time-gates.mjs';
import { costMatrixGate as familyGate, familyCostParity } from '../testing/receipt-event-time-gates.mjs';
import { assertEpisodeContentCost, assertEpisodeContentCostInventory } from '../testing/content-safety-s2h-deferred-cost.mjs';
import { assertCostGateCases, assertCostGateCell, assertCostGateCells, costGatePopulations, unmigratedCostOnly } from '../testing/content-safety-s2h-cost-inventory.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openCostMemoryCore as openMemoryCore } from '../testing/content-safety-cost-hosts.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';
import { measureContentRead } from '../testing/content-safety-cost-meter.mjs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { batch } from '../testing/episode-helpers.mjs';
const completeMetadata=familyGate('S2h-3 metadata matrices',costGateFamilies().length*6);
const fixedByCase=new Map(),episodeByCase=new Map();
for(const family of costGateFamilies())for(const base of [18,23,33])for(const n of [1,12])test(`R2 temporal/admission/review v${base} ${n} items${costFamilyLabel(family, base)}`,async t=>{
 const records=[];
 for(const [safety,facts]of costGatePopulations()) {
  const f=costFamilyFixture(t,base,family);if(safety)await f.migrate();const db=f.connect();let counters=0,providers=0;
  const model={contextWindow:8192,countTokens(){counters++;return 1;},extract:()=>({malformed:true}),reviewBasis(){providers++;return {units:[],links:[]};}};
  const core=openMemoryCore({path:f.path,model,decisionReview:'required-v1',captureEvidence:'staged-v1',captureQualification:'source-bound-v2',sessionEpisodes:{mode:'episode-v1'}}),runtime=createMemoryRuntime({path:f.path,sessionEpisodes:{mode:'episode-v1'}});
  t.after(()=>{runtime.close();core.close();db.close();});const memories=[];let episodeId;
  for(let i=0;i<n;i++){
   memories.push(ok(core.admit({namespace:ns,memory:{content:'Synthetic metadata Memory '+i,kind:'fact'},receipts:[receipt('metadata-'+i)]})).memory);
   const input=batch('episode-'+i,'Synthetic retained episode evidence '+i,'metadata-session-'+i),registered=runtime.reserveEpisodeBatch(ns,input);
   episodeId=registered.episodeId;
   const writer=runtime.claimEpisodeWriter(ns,{episodeId,generation:'initial'}),claim=runtime.claimEpisodeDraft(ns,{episodeId,generation:'initial',writerToken:writer.token,trigger:'batch',watermark:registered.position});
   const field=value=>({value,anchors:[{sourceIndex:0,start:0,end:input.view.messages[0].content.length}]});
   runtime.commitEpisodeDraft(ns,{episodeId,token:claim.token,sources:[{eventId:input.eventId,messageId:input.view.messages[0].id}],
    result:{type:field('work'),language:'en',gist:field('Synthetic episode gist '+i),outcome:null,nextStep:field('Review evidence'),disposition:null},dispositions:[{eventId:input.eventId,omitted:0}],
    modelMetadata:{adapter:'scripted',model:null,profile:null,promptVersion:'storage-test',digest:createHash('sha256').update('prompt').digest('hex'),portVersion:'episode-v1'}});
  }
  const completed={namespace:ns,client:'synthetic',eventId:'completed',payloadDigest:'a'.repeat(64)},claim=ok(core.claimAdmission({...completed,leaseMs:125000}));
  ok(core.finishAdmission({...completed,token:claim.token,items:Array.from({length:Math.min(n,4)},(_,i)=>({content:'Synthetic completed admission '+i,kind:'fact',confidence:.8,receipts:[receipt('completed-'+i)]}))}));
  // A genuine failed capture retains staged evidence for the inspection path.
  const stagedCore=openMemoryCore({path:f.path,model,decisionReview:'required-v1',captureEvidence:'staged-v1',captureQualification:'source-bound-v2'});t.after(()=>stagedCore.close());
  const failed=await stagedCore.capture({namespace:ns,client:'synthetic',sessionId:'staged',eventId:'staged',messages:[{id:'message',role:'user',content:'Synthetic staged evidence'}]});
  assert.equal(failed.ok,false);assert.equal(failed.error.code,'invalid_model_output');
  if(facts)transaction(db,()=>{for(let i=0;i<facts;i++)writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:'unrelated-'+i,reason:'purge',actionId:'fact-'+i});});
  assertCostGateCell(db,base,safety,facts,ns.ownerId,{family,testName:t.name,n});
  const other={...ns,scope:'project',projectId:'absent'},range={since:new Date(Date.now()-86400000).toISOString(),until:new Date(Date.now()+86400000).toISOString(),limit:1};
  const cases=[['getEpisode',{namespace:ns,episodeId},'hit'],['listEpisodes',{namespace:ns,...range,timeBasis:'receipt'},'hit'],['listMemoriesByTime',{namespace:ns,...range,timeBasis:'revision'},'hit'],
   ['listEpisodes',{namespace:other,...range,timeBasis:'receipt'},'absent'],['listMemoriesByTime',{namespace:other,...range,timeBasis:'revision'},'absent'],
   ['inspectAdmission',{namespace:ns,client:'synthetic',eventId:'completed'},'hit'],['inspectAdmission',{namespace:ns,client:'synthetic',eventId:'absent'},'absent'],
   ['inspectCaptureEvidence',{namespace:ns,client:'synthetic',eventId:'staged'},'hit'],['inspectCaptureEvidence',{namespace:ns,client:'synthetic',eventId:'absent'},'absent'],
   ['getRationale',{namespace:ns,memoryId:memories[0].id,revision:memories[0].revision},'hit'],['listReviewConflicts',{namespace:ns},'empty'],['listReviewTransitions',{namespace:ns,status:'all'},'empty'],
   ['reviewDecisionBasis',{namespace:ns,refs:memories.slice(0,6).map(m=>({memoryId:m.id,revision:m.revision}))},'empty-proposal'],['epoch',{namespace:ns},'runtime']];
  const measured=[];
  for(const [method,input,variant]of cases){const row=await measureContentRead(method,variant,()=>method==='epoch'?{ok:true,value:runtime.epoch(ns)}:core[method](input),()=>counters+providers);assert.equal(row.result.ok,true,method+' '+JSON.stringify(row.result));
   if(method==='inspectAdmission'&&variant==='hit'){assert.equal(row.result.value.status,'completed');assert.equal(row.result.value.members.length,Math.min(n,4));}
   if(method==='inspectCaptureEvidence'&&variant==='hit')assert.match(JSON.stringify(row.result.value),/Synthetic staged evidence/);
   if(variant==='absent'){if(method==='inspectAdmission')assert.equal(row.result.value.status,'absent');else if(method==='inspectCaptureEvidence')assert.equal(row.result.value.evidence,null);else assert.deepEqual(row.result.value.items,[]);}
   measured.push({...row,result:undefined});
   if(n>1&&['listEpisodes','listMemoriesByTime'].includes(method)&&variant==='hit'){assert.ok(row.result.value.nextCursor);const page=await measureContentRead(method,'cursor',()=>core[method]({...input,cursor:row.result.value.nextCursor}));assert.equal(page.result.ok,true,JSON.stringify(page.result));assert.ok(page.result.value.items.length);measured.push({...page,result:undefined});}
  }
  assertCostGateCases('metadata-'+n,measured);records.push({base,n,safety,facts,records:measured});
 }
 t.diagnostic('R3_METADATA_COUNTS '+JSON.stringify(records));
 if(assertCostGateCells(records))return;
 const [legacy,zero,five]=records,problems=[],ratchets=new Set();
 for(const current of [zero,five]){assert.deepEqual(current.records.map(r=>[r.method,r.variant]),legacy.records.map(r=>[r.method,r.variant]));for(const [i,row]of current.records.entries()){
  const old=legacy.records[i];assert.equal(row.ports,old.ports);
  if(['getEpisode','listEpisodes'].includes(row.method)){
   const dimensions={family,testName:t.name,base,n,facts:current.facts};
   await t.test(`Episode formula ${row.method}:${row.variant} facts=${current.facts}`,()=>{
    assertEpisodeContentCost(row,old,dimensions,ratchets);
    const key=JSON.stringify([family,base,current.facts,row.method,row.variant]),small=episodeByCase.get(key);
    if(small)assert.ok(row.statements-small[0].statements<=old.statements-small[1].statements,'Episode population slope '+key);
    episodeByCase.set(key,[row,old]);
   });continue;
  }
  assert.equal(row.begin,old.begin,row.method);
  const fixed=row.statements-old.statements-row.ports,key=JSON.stringify([family,base,current.facts,row.method,row.variant]);
  if(!current.facts&&!(fixed>=0&&fixed<=6))problems.push({base,n,method:row.method,variant:row.variant,facts:current.facts,fixed});
  if(fixedByCase.has(key)){if(fixed!==fixedByCase.get(key))problems.push({base,n,method:row.method,variant:row.variant,facts:current.facts,fixed,previous:fixedByCase.get(key)});}else fixedByCase.set(key,fixed);
 }}
 assertEpisodeContentCostInventory(ratchets,t.name);
 assert.deepEqual(problems,[],'non-deferred temporal R2 costs');
 completeMetadata(t.name);
});


test('R2 product family gate B: metadata smallest case, exact zero/five-fact parity', async t => {
  await familyCostParity(t, 33, async (f, db, facts) => {

  const core = openMemoryCore({ path: f.path }); t.after(() => core.close());
  const completed = { namespace: ns, client: 'synthetic', eventId: 'completed', payloadDigest: 'a'.repeat(64) };
  const claim = ok(core.claimAdmission({ ...completed, leaseMs: 125000 }));
  ok(core.finishAdmission({ ...completed, token: claim.token, items: [{ content: 'Synthetic completed admission', kind: 'fact', confidence: .8, receipts: [receipt('completed')] }] }));
  return { method: 'inspectAdmission', variant: 'hit', call: () => core.inspectAdmission({ namespace: ns, client: 'synthetic', eventId: 'completed' }),
    check(result) { assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.value.status, 'completed'); assert.equal(result.value.members.length, 1); } };
  });
});
