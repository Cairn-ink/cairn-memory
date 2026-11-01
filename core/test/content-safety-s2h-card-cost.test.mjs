import { assertCostGateCases, assertCostGateCell, assertCostGateCells } from '../testing/content-safety-s2h-cost-inventory.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../index.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';
import { measureContentRead } from '../testing/content-safety-cost-meter.mjs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
const authority={authorize(request){const {input,...binding}=request;return {...binding,accessGeneration:1};},isCurrent:g=>g};
for(const base of [23,33])for(const n of [1,4])test(`R2 Card/evidence v${base} ${n} items and non-Raw source variants`,async t=>{
 const records=[];
 for(const safety of [false,true])for(const facts of safety?[0,5]:[0]) {
  const f=safetyFixture(t,base);if(safety)await f.migrate();const db=f.connect(),core=openMemoryCore({path:f.path,model:{countTokens:()=>1},privateCards:{version:'private-cards-local-v1',source:'submitted-note-v1',storage:'local-plain-v1',disclosure:'explicit-submitted-note-v1',authority}});
  t.after(()=>{core.close();db.close();});const call=(method,input)=>core[method](input,{}),refs=[];
  for(let i=0;i<n;i++){
   const memory=ok(core.admit({namespace:ns,memory:{content:'Synthetic card evidence '+i,kind:'fact'},receipts:[receipt('card-'+i,'Synthetic card receipt '+i)]})).memory;
   const ref={type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision};refs.push(ref);
   const draft=ok(call('createCardDraft',{namespace:ns,actionId:'draft-'+i,drafting:'authored',input:{title:'Synthetic card '+i,body:'Synthetic card body '+i,sourcePolicy:'retained-receipts-v1',memoryRefs:[ref]}}));
   const card=ok(call('confirmCardDraft',{namespace:ns,cardId:draft.id,expectedRevision:1,actionId:'confirm-'+i,applicability:'current'}));
   refs.push({type:'card',namespace:ns,cardId:card.id,revision:card.revision,bodyRevision:card.bodyRevision});
  }
  const source=ok(call('getCard',{namespace:ns,cardId:refs[1].cardId})).card.bindings[0].source;
  const note=ok(call('submitSourceNote',{namespace:ns,actionId:'note',text:'Synthetic note '+ 'x'.repeat(8000),occurredAt:null})).source;
  const placed=ok(call('applyCardPlacement',{namespace:ns,actionId:'place',refs:[refs[1]],expectedIndexRevision:ok(call('mapEvidence',{namespace:ns,type:'card'})).indexRevision,
   proposal:{items:[{cardId:refs[1].cardId,parentIds:[],newL1:{title:'Synthetic card topic',parentL2Ids:[],newL2Title:'Synthetic card root'}}]}}));
  const mocId=placed.createdMocRefs.find(m=>m.level==='L1').mocId;
  const cardTopic=placed.createdMocRefs.find(m=>m.level==='L1'),emptyMocId=placed.createdMocRefs.find(m=>m.level==='L2').mocId;
  const mappings=[];
  for(let i=0;i<n;i++){
   const extra=ok(core.admit({namespace:ns,memory:{content:'Synthetic mapping memory '+i,kind:'fact'},receipts:[receipt('mapping-'+i)]})).memory;
   const ref={memoryId:extra.id,revision:extra.revision},index=ok(core.map({namespace:ns})).indexRevision;
   const placedMemory=ok(core.applyPlacement({namespace:ns,expectedIndexRevision:index,expectedMemoryRevisions:[{memoryId:ref.memoryId,revision:ref.revision}],proposal:{items:[{memoryId:ref.memoryId,parentIds:[],newL1:{title:'Synthetic memory topic '+i,parentL2Ids:[]}}]}}));
   const memoryTopic=placedMemory.createdMocs.find(m=>m.level==='L1');
   const pair={memoryTopic:{mocId:memoryTopic.id,revision:memoryTopic.revision},cardTopic:{mocId:cardTopic.mocId,revision:cardTopic.revision}};
   const proposed=ok(call('proposeEvidenceMapping',{namespace:ns,actionId:'mapping-'+i,...pair,expectedMemoryIndexRevision:ok(call('mapEvidence',{namespace:ns,type:'memory'})).indexRevision,expectedCardIndexRevision:ok(call('mapEvidence',{namespace:ns,type:'card'})).indexRevision}));mappings.push({pair,proposed});
  }

  for(const [i,{pair,proposed}]of mappings.entries())ok(call('reviewEvidenceMapping',{namespace:ns,actionId:'activate-'+i,mappingId:proposed.id,expectedRevision:1,state:'active',...pair,expectedMemoryIndexRevision:ok(call('mapEvidence',{namespace:ns,type:'memory'})).indexRevision,expectedCardIndexRevision:ok(call('mapEvidence',{namespace:ns,type:'card'})).indexRevision}));
  if(facts)transaction(db,()=>{for(let i=0;i<facts;i++)writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:'unrelated-'+i,reason:'purge',actionId:'fact-'+i});});
  assertCostGateCell(db,base,safety,facts,ns.ownerId,{testName:t.name,n});
  const snapshot=ok(call('fetchEvidence',{namespace:ns,refs,intent:'current'})).snapshot;
  const cases=[['getPrivateCardUsage',{namespace:ns},'hit'],['inspectCardOperation',{namespace:ns,operationActionId:'draft-0'},'hit'],['listCardEffects',{namespace:ns},'hit'],
   ['mapEvidence',{namespace:ns,type:'card'},'card'],['mapEvidence',{namespace:ns,type:'memory'},'memory'],['fetchEvidence',{namespace:ns,refs,intent:'current'},'hit'],
   ['selectEvidence',{namespace:ns,query:'Synthetic card',types:['memory','card'],intent:'current'},'hit'],['selectEvidence',{namespace:ns,query:'absentterm',types:['memory','card'],intent:'current'},'absent'],
   ['revalidateEvidence',{namespace:ns,snapshot},'hit'],['listEvidenceMappings',{namespace:ns,type:'card',mocId,limit:1},'hit'],['listEvidenceMappings',{namespace:ns,type:'card',mocId:emptyMocId},'empty-mappings'],
   ['getSource',{namespace:ns,source},'receipt'],['getSource',{namespace:ns,source:note,limit:1},'submitted-note']];
  const measured=[];
  for(const [method,input,variant]of cases){const row=await measureContentRead(method,variant,()=>call(method,input));assert.equal(row.result.ok,true,method+' '+JSON.stringify(row.result));
   if(variant==='absent'||variant==='empty-mappings')assert.equal(row.result.value.items.length,0,'correct empty result');
   measured.push({...row,result:undefined});
   if(method==='listEvidenceMappings'&&variant==='hit'&&n>1){assert.ok(row.result.value.nextCursor);const page=await measureContentRead(method,'cursor',()=>call(method,{...input,cursor:row.result.value.nextCursor}));assert.equal(page.result.ok,true,JSON.stringify(page.result));assert.ok(page.result.value.items.length);measured.push({...page,result:undefined});}
   if(method==='getSource'&&variant==='submitted-note'){assert.ok(row.result.value.nextCursor);const page=await measureContentRead(method,'submitted-note-cursor',()=>call(method,{...input,cursor:row.result.value.nextCursor}));assert.equal(page.result.ok,true,JSON.stringify(page.result));assert.ok(page.result.value.parts.length);measured.push({...page,result:undefined});}
  }
  assert.deepEqual(measured.map(r=>[r.method,r.variant]),[...cases.slice(0,-1).flatMap(([method,,variant])=>[[method,variant],...(method==='listEvidenceMappings'&&variant==='hit'&&n>1?[[method,'cursor']]:[])]),['getSource','submitted-note'],['getSource','submitted-note-cursor']]);
  assertCostGateCases('card-'+n,measured);
  records.push({base,n,safety,facts,records:measured});
 }
 t.diagnostic('R3_CARD_COUNTS '+JSON.stringify(records));
 assertCostGateCells(records);
 const [legacy,zero,five]=records;
 for(const current of [zero,five]){assert.deepEqual(current.records.map(r=>[r.method,r.variant]),legacy.records.map(r=>[r.method,r.variant]));for(const [i,row]of current.records.entries()){
  const old=legacy.records[i];assert.equal(row.begin,old.begin,row.method);assert.equal(row.statements-old.statements,row.method==='getPrivateCardUsage'?(current.facts?10:6):row.method==='mapEvidence'&&row.variant==='memory'?(current.facts?5:3):(current.facts?6:4),row.method+' '+row.variant);
 }}
});
