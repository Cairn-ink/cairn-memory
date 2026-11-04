import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../index.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { createRawLineageStorage } from '../raw-lineage-storage.mjs';
import { createRawCardInvalidation } from '../card-raw-sources.mjs';
import { transaction } from '../database.mjs';
import { contentSafetyFacade } from '../content-safety-boundary.mjs';
import { beginContentWriteSafety } from '../content-write-safety.mjs';
import { registerContentWriteGuard } from '../content-write-context.mjs';
import { contentSafetyInventory } from '../content-safety-migration.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { cardHost } from '../testing/raw-source-fixtures.mjs';
import { request, splitRaw, localPlainPort } from '../testing/raw-capture-fixtures.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';

const operations=Object.freeze({cancel:'cancelCardDraft',delete:'deleteKnowledgeCard',note:'deleteSourceNote',forget:'forget',
  'remove-receipt':'deleteConversation',exclude:'setRawCaptureControl',raw:'deleteConversation'});

async function setup(t,base,raw=false){
  const f=safetyFixture(t,base);await f.migrate();const host=cardHost();
  const config={path:f.path,privateCards:host.options,model:{contextWindow:8192,countTokens:()=>1,
    extract:()=>({items:[{content:'Synthetic dependent interpretation',kind:'fact',confidence:.8,sourceIndices:[0]}]})}};
  const core=raw?openRawCaptureCore(config,{mode:'raw-v1',sources:true,deletion:true,port:localPlainPort(),readPolicy:()=>({generation:'synthetic',reason:null})}):openMemoryCore(config);
  const db=f.connect();t.after(()=>{core.close();db.close();});
  return {...f,core,db,call:(method,input)=>host.call(core,method,{namespace:ns,...input})};
}
const note=(f,id)=>ok(f.call('submitSourceNote',{actionId:id,text:'Synthetic '+id,occurredAt:null})).source;
function draft(f,sources,id){return ok(f.call('createCardDraft',{actionId:id,drafting:'authored',input:{title:'Synthetic dependent',body:'Synthetic retained body',sources}}));}
function confirm(f,card){return ok(f.call('confirmCardDraft',{actionId:'confirm-'+card.id,cardId:card.id,expectedRevision:card.revision}));}
function suppressNote(f,source){transaction(f.db,()=>writeContentSuppressionInside(f.db,{namespace:ns,kind:'submitted-note',key:source.sourceId,reason:'privacy_erase',actionId:'unrelated-prior-fact'}));}
function refusedUnchanged(f,result,before){
  assert.deepEqual({refused:result.ok===false,unchanged:contentSafetyInventory(f.db)===before},{refused:true,unchanged:true});
}

// Exercise a future acknowledgement projection inside the real mutation's
// guard. This decorates the result only; the actual writer, native changeset,
// shared predicate and COMMIT/ROLLBACK path remain production implementations.
async function acknowledge(f,card,invoke){
  let acknowledgements=0;
  registerContentWriteGuard((db,operation)=>{
    const state=beginContentWriteSafety(db,operation);if(!state)return state;
    return {...state,validate(result){acknowledgements++;result.dependentCardId=card.id;state.validate(result);}};
  });
  try{return {result:await invoke(),acknowledgements};}
  finally{registerContentWriteGuard(beginContentWriteSafety);}
}

for(const base of [23,33])for(const mutation of ['note','forget'])for(const negative of [false,true])test(`r4 dependent sweep ${base} ${mutation}: ${negative?'unrelated contributor refuses and rolls back':'automatic invalidation succeeds'}`,async t=>{
  const f=await setup(t,base),other=note(f,'independent-contributor');let target,card;
  if(mutation==='note'){target=note(f,'terminal-contributor');card=draft(f,[target,other],'dependent');}
  else{
    target=ok(f.core.admit({namespace:ns,memory:{content:'Synthetic forgotten contributor',kind:'fact'},receipts:[receipt('terminal-memory')]})).memory;
    card=ok(f.call('createCardDraft',{actionId:'dependent',drafting:'authored',input:{title:'Synthetic dependent',body:'Synthetic retained body',
      memoryRefs:[{type:'memory',namespace:ns,memoryId:target.id,revision:target.revision}],sourcePolicy:'retained-receipts-v1'}}));
    const bindings=ok(f.call('getCard',{cardId:card.id})).card.bindings.map(b=>b.source);
    card=ok(f.call('editCardDraft',{actionId:'add-independent',cardId:card.id,expectedRevision:card.revision,title:'Synthetic dependent',body:'Synthetic retained body',bindings:[...bindings,other]}));
  }
  card=confirm(f,card);
  transaction(f.db,()=>writeContentSuppressionInside(f.db,{namespace:ns,kind:mutation==='note'?'submitted-note':'memory',
    key:target.sourceId??target.id,reason:'privacy_erase',actionId:'own-prior-fact'}));
  if(negative)suppressNote(f,other);
  const before=contentSafetyInventory(f.db),effects=f.db.prepare('SELECT count(*) n FROM card_effects WHERE entity_id=?').get(card.id).n;
  const {result,acknowledgements}=await acknowledge(f,card,()=>mutation==='note'?f.call('deleteSourceNote',{actionId:'terminal',sourceId:target.sourceId,expectedRevision:target.revision}):
    f.core.forget({namespace:ns,memoryId:target.id,expectedRevision:target.revision}));
  if(negative){refusedUnchanged(f,result,before);assert.equal(JSON.stringify(result).includes(card.id),false);}
  else{
    assert.equal(ok(result).dependentCardId,card.id);
    assert.equal(f.db.prepare('SELECT revision FROM private_cards WHERE id=?').get(card.id).revision,card.revision+1);
    assert.equal(f.db.prepare('SELECT count(*) n FROM card_effects WHERE entity_id=?').get(card.id).n,effects+1);
    assert.equal(f.db.prepare(mutation==='note'?'SELECT state AS value FROM card_notes WHERE id=?':'SELECT deleted AS value FROM memories WHERE id=?').get(target.sourceId??target.id).value,mutation==='note'?'deleted':1);
    assert.equal(ok(f.call('getCard',{cardId:card.id})).card,null,'ordinary reads still deny the invalidated Card');
  }
  assert.equal(acknowledgements,1);
});

for(const mutation of ['remove-receipt','exclude','raw'])for(const rawBinding of mutation==='exclude'?[true,false]:[true])for(const negative of [false,true])test(`r4 dependent sweep 33 ${mutation} ${rawBinding?'mixed':'receipt-only'}: ${negative?'unrelated contributor refuses and rolls back':'automatic invalidation succeeds'}`,async t=>{
  const f=await setup(t,33,true),other=note(f,'independent-contributor'),part=splitRaw('Synthetic retained terminal Raw evidence.')[0];
  const saved=ok(await f.core.captureRaw(request(part,{namespace:ns,client:'codex',sessionId:'terminal-raw',eventId:'terminal-raw'})));
  let memory=ok(saved.interpretation).admission.memories[0];const conversationId=saved.raw.conversationId;
  if(mutation==='remove-receipt')memory=ok(f.core.admit({namespace:ns,memory:{content:'Synthetic dependent interpretation',kind:'fact'},receipts:[receipt('independent-memory')]})).memory;
  const rawRef=ok(await f.call('resolveSourceReferences',{anchors:[{rawAnchor:{conversationId,messageId:part.id,start:0,end:8,precision:'exact'},
    expectedConversationRevision:f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(conversationId).revision}]})).sources[0];
  let card=ok(f.call('createCardDraft',{actionId:'dependent',drafting:'authored',input:{title:'Synthetic dependent',body:'Synthetic retained body',
    memoryRefs:[{type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision}],sourcePolicy:'retained-receipts-v1'}}));
  const bindings=ok(f.call('getCard',{cardId:card.id})).card.bindings.map(b=>b.source);
  card=ok(f.call('editCardDraft',{actionId:'add-independent',cardId:card.id,expectedRevision:card.revision,title:'Synthetic dependent',body:'Synthetic retained body',bindings:[...bindings,...(rawBinding?[rawRef]:[]),other]}));
  card=confirm(f,card);
  const lineage=f.db.prepare('SELECT * FROM raw_receipt_lineage WHERE conversation_id=? LIMIT 1').get(conversationId);
  transaction(f.db,()=>writeContentSuppressionInside(f.db,{namespace:ns,kind:'raw',key:conversationId,reason:'privacy_erase',actionId:'own-prior-fact',
    ...(mutation==='exclude'?{matchMode:'span',messageId:lineage.message_id,start:lineage.start,end:lineage.end}:{})}));
  if(negative)suppressNote(f,other);
  const before=contentSafetyInventory(f.db),effects=f.db.prepare('SELECT count(*) n FROM card_effects WHERE entity_id=?').get(card.id).n;
  const api=contentSafetyFacade({setRawCaptureControl(){return transaction(f.db,()=>{
    createRawLineageStorage(f.db).excludeMemory(ns,memory.id,{reason:'privacy_erase',actionId:'terminal-exclude'});return {conversationId};
  });}}, {check(){},failure:error=>({ok:false,error:{code:error.code}})});
  const {result,acknowledgements}=await acknowledge(f,card,()=>mutation==='exclude'?api.setRawCaptureControl({namespace:ns}):
    f.core.deleteConversation({namespace:ns,conversationId,expectedRevision:f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(conversationId).revision,actionId:'terminal-delete'}));
  if(negative){refusedUnchanged(f,result,before);assert.equal(JSON.stringify(result).includes(card.id),false);}
  else{
    assert.equal((result.value??result).dependentCardId,card.id);assert.notEqual(result.ok,false);
    const delta=rawBinding?1:0;
    assert.equal(f.db.prepare('SELECT revision FROM private_cards WHERE id=?').get(card.id).revision,card.revision+delta);
    assert.equal(f.db.prepare('SELECT count(*) n FROM card_effects WHERE entity_id=?').get(card.id).n,effects+delta);
    assert.equal(f.db.prepare('SELECT deleted FROM memories WHERE id=?').get(memory.id).deleted,mutation==='raw'?1:0);
    assert.equal(ok(f.call('getCard',{cardId:card.id})).card,null);
    if(mutation==='remove-receipt')assert.equal(f.db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(memory.id).n,1);
  }
  assert.equal(acknowledgements,1);
});

for(const mutation of ['cancel','delete'])for(const negative of [false,true])test(`r4 dependent sweep 33 ${mutation}: ${negative?'unrelated acknowledgement refuses and rolls back':'terminal target succeeds without automatic content dependents'}`,async t=>{
  const f=await setup(t,33),source=note(f,'terminal-source'),other=note(f,'other-source');
  let target=draft(f,[source],'terminal-card');if(mutation==='delete')target=confirm(f,target);
  const unrelated=confirm(f,draft(f,[other],'unrelated-card'));if(negative)suppressNote(f,other);
  const before=contentSafetyInventory(f.db),otherEffects=f.db.prepare('SELECT count(*) n FROM card_effects WHERE entity_id=?').get(unrelated.id).n;
  // Card cancel/delete purge bindings and bump organization epochs; they do
  // not automatically invalidate another content identity. Classify that case
  // explicitly, and prove an unrelated id cannot acquire exemption (c).
  const {result,acknowledgements}=await acknowledge(f,negative?unrelated:target,()=>f.call(operations[mutation],{actionId:'terminal',cardId:target.id,expectedRevision:target.revision}));
  if(negative)refusedUnchanged(f,result,before);
  else{
    assert.equal(ok(result).dependentCardId,target.id);
    assert.equal(f.db.prepare('SELECT state FROM private_cards WHERE id=?').get(target.id).state,mutation==='cancel'?'cancelled':'deleted');
    assert.equal(f.db.prepare('SELECT revision FROM private_cards WHERE id=?').get(unrelated.id).revision,unrelated.revision);
    assert.equal(f.db.prepare('SELECT count(*) n FROM card_effects WHERE entity_id=?').get(unrelated.id).n,otherEffects);
  }
  assert.equal(acknowledgements,1);
});

test('r4 terminal sweep classifies every requested operation',()=>{
  assert.deepEqual(Object.keys(operations).sort(),['cancel','delete','exclude','forget','note','raw','remove-receipt']);
});

for(const negative of [false,true])test(`r4 narrow Raw terminal: ${negative?'another span on the same conversation refuses':'own prior span permits invalidation'}`,async t=>{
  const f=await setup(t,33,true),part=splitRaw('Synthetic retained terminal Raw evidence.')[0];
  const saved=ok(await f.core.captureRaw(request(part,{namespace:ns,eventId:'span-source'}))),conversationId=saved.raw.conversationId;
  const refs=ok(await f.call('resolveSourceReferences',{anchors:[[0,8],[12,20]].map(([start,end])=>({
    rawAnchor:{conversationId,messageId:part.id,start,end,precision:'exact'},expectedConversationRevision:f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(conversationId).revision}))})).sources;
  const card=confirm(f,draft(f,refs,'two-spans'));
  const fact=(start,end,actionId)=>writeContentSuppressionInside(f.db,{namespace:ns,kind:'raw',key:conversationId,matchMode:'span',messageId:part.id,start,end,reason:'privacy_erase',actionId});
  transaction(f.db,()=>{fact(0,8,'own-prior-span');if(negative)fact(12,20,'unrelated-prior-span');});
  const before=contentSafetyInventory(f.db),cards=createRawCardInvalidation(f.db);
  const api=contentSafetyFacade({setRawCaptureControl(){return transaction(f.db,()=>cards.mutate(ns,'terminal-span',()=>{
    cards.collect(ns,[{conversationId,messageId:part.id,start:0,end:8}]);fact(0,8,'terminal-span');
    f.db.prepare(`INSERT INTO raw_exclusion_clocks VALUES(?,?,?,1) ON CONFLICT(owner_id,scope,project_id) DO UPDATE SET generation=generation+1`).run(ns.ownerId,ns.scope,ns.projectId??'');
    const generation=f.db.prepare('SELECT generation FROM raw_exclusion_clocks WHERE owner_id=? AND scope=? AND project_id=?').get(ns.ownerId,ns.scope,ns.projectId??'').generation;
    f.db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,?)').run(conversationId,part.id,0,8,generation);
    return {conversationId};
  }));}}, {check(){},failure:error=>({ok:false,error:{code:error.code}})});
  const {result,acknowledgements}=await acknowledge(f,card,()=>api.setRawCaptureControl({namespace:ns}));
  if(negative)refusedUnchanged(f,result,before);
  else{
    assert.notEqual(result.ok,false,JSON.stringify(result));assert.equal(result.dependentCardId,card.id);
    assert.equal(f.db.prepare('SELECT revision FROM private_cards WHERE id=?').get(card.id).revision,card.revision+1);
    assert.equal(f.db.prepare('SELECT count(*) n FROM raw_source_exclusions WHERE conversation_id=?').get(conversationId).n,1);
  }
  assert.equal(acknowledgements,1);
});
