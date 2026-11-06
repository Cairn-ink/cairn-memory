import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync,fork } from 'node:child_process';
import { lineageFixture,ns,ok,receipt } from '../testing/card-lineage-fixture.mjs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { contentSafetyInventory } from '../content-safety-migration.mjs';
import { registerContentWriteGuard } from '../content-write-context.mjs';
import { beginContentWriteSafety } from '../content-write-safety.mjs';
import { request,splitRaw,localPlainPort } from '../testing/raw-capture-fixtures.mjs';
import { collectCardBodySourcesInside,sealCardBodyInside } from '../card-lineage.mjs';
import { sourceReadSafety } from '../content-safety.mjs';

const retained=row=>Object.fromEntries(['state','title','body','body_revision'].map(key=>[key,row[key]]));
const refFor=(f,card)=>({type:'card',namespace:ns,cardId:card.id,revision:f.row(card.id).revision,bodyRevision:f.row(card.id).body_revision});
function hidden(f,card) {
  assert.equal(ok(f.call('getCard',{cardId:card.id})).card,null);
  const list=ok(f.call('listCards',{states:['draft','confirmed']}));
  assert.equal(JSON.stringify(list).includes(card.id),false);
  for(const intent of ['current','history']) {
    const result=f.call('fetchEvidence',{refs:[refFor(f,card)],intent});
    assert.equal(result.ok,false);assert.equal(JSON.stringify(result).includes('Synthetic retained body'),false);
  }
  const mapped=f.call('mapEvidence',{type:'card'}),map=mapped.ok?mapped.value:mapped;
  if(!mapped.ok)assert.equal(mapped.error.code,'evidence_unavailable');
  assert.equal(JSON.stringify(map).includes(card.id),false);
}
function cold(f,card) {
  const source=`import { openMemoryCore } from ${JSON.stringify(new URL('../index.mjs',import.meta.url).href)};
    import { lineageHost } from ${JSON.stringify(new URL('../testing/card-lineage-fixture.mjs',import.meta.url).href)};
    const h=lineageHost(),core=openMemoryCore({path:process.argv[1],privateCards:h.options});
    try{console.log(JSON.stringify(h.call(core,'getCard',{namespace:${JSON.stringify(ns)},cardId:process.argv[2]})));}finally{core.close();}`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',source,f.path,card.id],{encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).value.card,null);
}
function edit(f,card,bindings,actionId) {
  const row=f.row(card.id);
  return ok(f.call(row.state==='confirmed'?'editKnowledgeCard':'editCardDraft',{actionId,cardId:card.id,
    expectedRevision:row.revision,title:row.title,body:row.body,bindings,...(row.state==='confirmed'?{applicability:'current'}:{})}));
}

for(const confirmed of [false,true])for(const operation of ['forget','correct','note'])for(const mode of ['bound','removed','denied-sibling','missing-header','unknown-body'])
test(`outer commit ${operation}, ${confirmed?'confirmed':'draft'}, ${mode}`,async t=>{
  const f=await lineageFixture(t),b=f.note('sibling');let target,card;
  if(operation==='note'){target=f.note('target');card=f.draft([target,b]);}
  else {
    target=ok(f.core.admit({namespace:ns,memory:{content:'Synthetic original Memory',kind:'fact'},receipts:[receipt('original')]})).memory;
    card=ok(f.call('createCardDraft',{actionId:'draft',drafting:'authored',input:{title:'Synthetic title',body:'Synthetic retained body',
      memoryRefs:[{type:'memory',namespace:ns,memoryId:target.id,revision:target.revision}],sourcePolicy:'retained-receipts-v1'}}));
    card=edit(f,card,[...ok(f.call('getCard',{cardId:card.id})).card.bindings.map(b=>b.source),b],'add-sibling');
  }
  if(confirmed)card=f.confirm(card);
  if(mode==='removed')card=edit(f,card,[b],'remove-target');
  if(mode==='denied-sibling')transaction(f.db,()=>writeContentSuppressionInside(f.db,{namespace:ns,kind:'submitted-note',key:b.sourceId,reason:'privacy_erase',actionId:'prior-sibling-denial'}));
  if(mode==='missing-header')f.db.prepare('UPDATE private_cards SET body_revision=body_revision+1 WHERE id=?').run(card.id);
  if(mode==='unknown-body')transaction(f.db,()=>{
    f.db.prepare('UPDATE private_cards SET body_revision=body_revision+1 WHERE id=?').run(card.id);
    sealCardBodyInside(f.db,{identity:f.identity,namespace:ns,cardId:card.id,newBody:true,legacy:true,sources:[]});
  });
  const before=retained(f.row(card.id)),headers=f.db.prepare('SELECT * FROM card_body_provenance').all(),sources=f.db.prepare('SELECT * FROM card_body_sources').all();
  let validated=0;
  registerContentWriteGuard((db,operation)=>{const guard=beginContentWriteSafety(db,operation);if(!guard)return guard;return {...guard,validate(result){validated++;guard.validate(result);}};});
  let result;
  try { result=operation==='note'?f.call('deleteSourceNote',{actionId:'delete-note',sourceId:target.sourceId,expectedRevision:target.revision}):operation==='forget'?
    f.core.forget({namespace:ns,memoryId:target.id,expectedRevision:target.revision}):
    f.core.correct({namespace:ns,memoryId:target.id,expectedRevision:target.revision,content:'Synthetic corrected Memory',kind:'fact',receipt:receipt('replacement')}); }
  finally {registerContentWriteGuard(beginContentWriteSafety);}
  ok(result);assert.equal(validated,1,'real outer native validation');
  assert.deepEqual(retained(f.row(card.id)),before);assert.deepEqual(f.db.prepare('SELECT * FROM card_body_provenance').all(),headers);
  assert.deepEqual(f.db.prepare('SELECT * FROM card_body_sources').all(),sources);
  if(operation==='note') {
    assert.equal(f.db.prepare('SELECT state FROM card_notes WHERE id=?').get(target.sourceId).state,'deleted');
    assert.equal(f.db.prepare('SELECT byte_count FROM card_note_usage').get().byte_count,Buffer.byteLength('Synthetic sibling'));
  } else {
    assert.equal(f.db.prepare('SELECT deleted FROM memories WHERE id=?').get(target.id).deleted,operation==='forget'?1:0);
    assert.equal(f.db.prepare("SELECT count(*) n FROM receipts WHERE memory_id=? AND event_id='original'").get(target.id).n,0);
  }
  assert.ok(f.db.prepare('SELECT 1 FROM content_suppressions WHERE stable_key=?').get(target.sourceId??target.id));
  hidden(f,card);if(mode==='removed'||mode==='missing-header')cold(f,card);
});

for(const confirmed of [false,true])for(const support of ['raw','receipt'])for(const mode of ['bound','removed','denied-sibling','missing-header','unknown-body'])for(const operation of ['delete','span'])
test(`outer Raw ${operation} ${support}, ${confirmed?'confirmed':'draft'}, ${mode}`,async t=>{
  const plain=localPlainPort();let deniedMaterializer=false,opens=0;
  const port={...plain,openRaw(value){if(deniedMaterializer){opens++;throw Error('synthetic unavailable materializer');}return plain.openRaw(value);}};
  const f=await lineageFixture(t,{base:33,raw:true,rawPort:port,options:{model:{contextWindow:8192,countTokens:()=>1,
    extract:()=>({items:[{content:'Synthetic Raw interpretation',kind:'fact',confidence:.8,sourceIndices:[0]}]})}}}),b=f.note('sibling');
  const part=splitRaw('Synthetic retained terminal Raw source.')[0],saved=ok(await f.core.captureRaw(request(part,{namespace:ns,eventId:'raw-capture'})));
  const conversationId=saved.raw.conversationId,revision=f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(conversationId).revision;
  const rawRef=ok(await f.call('resolveSourceReferences',{anchors:[{rawAnchor:{conversationId,messageId:part.id,start:0,end:8,precision:'exact'},expectedConversationRevision:revision}]})).sources[0];
  const memory=ok(saved.interpretation).admission.memories[0];
  let card=support==='raw'?f.draft([rawRef,b]):ok(f.call('createCardDraft',{actionId:'draft',drafting:'authored',input:{title:'Synthetic title',body:'Synthetic retained body',
    memoryRefs:[{type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision}],sourcePolicy:'retained-receipts-v1'}}));
  if(support==='receipt')card=edit(f,card,[...ok(f.call('getCard',{cardId:card.id})).card.bindings.map(b=>b.source),b],'add-sibling');
  if(confirmed)card=f.confirm(card);
  if(mode==='removed')card=edit(f,card,[b],'remove-target');
  if(mode==='denied-sibling')transaction(f.db,()=>writeContentSuppressionInside(f.db,{namespace:ns,kind:'submitted-note',key:b.sourceId,reason:'privacy_erase',actionId:'prior-sibling-denial'}));
  if(mode==='missing-header')f.db.prepare('UPDATE private_cards SET body_revision=body_revision+1 WHERE id=?').run(card.id);
  if(mode==='unknown-body')transaction(f.db,()=>{
    f.db.prepare('UPDATE private_cards SET body_revision=body_revision+1 WHERE id=?').run(card.id);
    sealCardBodyInside(f.db,{identity:f.identity,namespace:ns,cardId:card.id,newBody:true,legacy:true,sources:[]});
  });
  const before=retained(f.row(card.id));
  deniedMaterializer=true;
  if(operation==='delete')ok(f.core.deleteConversation({namespace:ns,conversationId,expectedRevision:revision,actionId:'delete-raw'}));
  else ok(f.core.forget({namespace:ns,memoryId:memory.id,expectedRevision:memory.revision}));
  if(operation==='delete')assert.equal(f.db.prepare('SELECT 1 FROM raw_conversations WHERE id=?').get(conversationId),undefined);
  else {
    assert.ok(f.db.prepare('SELECT 1 FROM raw_conversations WHERE id=?').get(conversationId));
    const exclusion=f.db.prepare('SELECT start,end FROM raw_source_exclusions WHERE conversation_id=? AND message_id=?').get(conversationId,part.id);
    assert.ok(exclusion&&exclusion.start===0&&exclusion.end>=8,'the exact canonical message span is excluded');
  }
  assert.ok(f.db.prepare("SELECT 1 FROM content_suppressions WHERE kind='raw' AND stable_key=?").get(conversationId));
  assert.deepEqual(retained(f.row(card.id)),before);hidden(f,card);
  assert.equal(opens,0,'privacy and denied reads never open Raw');
  if(mode==='removed')cold(f,card);
});

for(const fault of ['title','body','binding','state','header','source','forged-effect','foreign-effect'])test(`restricted invalidation rejects ${fault} and rolls back atomically`,async t=>{
  const f=await lineageFixture(t),a=f.note('target'),b=f.note('sibling'),extra=f.note('additional'),card=f.draft([a,b]),before=contentSafetyInventory(f.db);
  registerContentWriteGuard((db,operation)=>{
    const guard=beginContentWriteSafety(db,operation);if(!guard)return guard;
    return {...guard,validate(result){
      if(fault==='title')db.prepare('UPDATE private_cards SET title=?,body_revision=body_revision+1 WHERE id=?').run('Disguised edit',card.id);
      if(fault==='body')db.prepare('UPDATE private_cards SET body=?,body_revision=body_revision+1 WHERE id=?').run('Disguised body',card.id);
      if(fault==='binding')db.prepare('DELETE FROM card_bindings WHERE card_id=? AND source_id=?').run(card.id,b.sourceId);
      if(fault==='state')db.prepare("UPDATE private_cards SET state='confirmed' WHERE id=?").run(card.id);
      if(fault==='header')db.prepare(`INSERT INTO card_body_provenance SELECT owner_id,scope,project_id,card_kind,card_id,
        body_revision,provenance_revision+1,body_digest,?,completeness,origin,source_count,authorization_action FROM card_body_provenance
        WHERE card_id=? ORDER BY provenance_revision DESC LIMIT 1`).run('a'.repeat(64),card.id);
      if(fault==='source')sealCardBodyInside(db,{identity:f.identity,namespace:ns,cardId:card.id,
        sources:collectCardBodySourcesInside(db,f.identity,ns,[extra],ref=>sourceReadSafety(db,{identity:f.identity,namespace:ns,ref}).allowed)});
      if(fault==='forged-effect')db.prepare("UPDATE card_effects SET kind='card_deleted' WHERE entity_type='card'").run();
      if(fault==='foreign-effect')db.prepare("UPDATE card_effects SET owner_id='foreign-owner' WHERE entity_type='card'").run();
      guard.validate(result);
    }};
  });
  let result;try {result=f.call('deleteSourceNote',{actionId:'delete-target',sourceId:a.sourceId,expectedRevision:a.revision});}
  finally{registerContentWriteGuard(beginContentWriteSafety);}
  assert.equal(result.ok,false);assert.equal(contentSafetyInventory(f.db),before,'no false acknowledgement or partial denial');
});

test('a genuine busy COMMIT after source denial rolls back atomically with no success acknowledgement',async t=>{
  const f=await lineageFixture(t),a=f.note('target'),card=f.draft([a]),before=contentSafetyInventory(f.db);
  const child=fork(new URL('../testing/card-lineage-reader-child.mjs',import.meta.url),[f.path],{execArgv:[],stdio:['ignore','ignore','ignore','ipc']});
  let closed=false;const exit=new Promise(resolve=>child.once('exit',(code,signal)=>{closed=true;resolve({code,signal});}));
  let timer;
  try {
    await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('reader readiness timeout')),10000);child.once('message',message=>{clearTimeout(timer);assert.equal(message.ready,true);resolve();});child.once('error',reject);});
    let validated=false;
    registerContentWriteGuard((db,operation)=>{const guard=beginContentWriteSafety(db,operation);if(!guard)return guard;return {...guard,validate(result){guard.validate(result);validated=true;}};});
    let result;try{result=f.call('deleteSourceNote',{actionId:'blocked-commit',sourceId:a.sourceId,expectedRevision:a.revision});}
    finally{registerContentWriteGuard(beginContentWriteSafety);}
    assert.equal(validated,true,'failure occurs after real validation and source fact insertion');
    assert.equal(result.ok,false);assert.equal(result.error.code,'storage_busy');
    assert.equal(contentSafetyInventory(f.db),before);assert.equal(f.row(card.id).state,'draft');
  } finally {
    clearTimeout(timer);if(child.connected)child.send('release');
    const result=await Promise.race([exit,new Promise(resolve=>{timer=setTimeout(()=>{if(!closed)child.kill('SIGTERM');resolve({code:null,signal:'timeout'});},10000);})]);
    clearTimeout(timer);assert.deepEqual(result,{code:0,signal:null});
  }
});


async function receiptAncestryCard(t,confirmed,count) {
  const f=await lineageFixture(t,{base:33,raw:true,options:{model:{contextWindow:8192,countTokens:()=>1,
    extract:()=>({items:Array.from({length:count},(_,i)=>({content:'Synthetic Raw interpretation '+i,kind:'fact',confidence:.8,sourceIndices:[0]}))})}}});
  const part=splitRaw('Synthetic retained Raw source for both facts.')[0];
  const saved=ok(await f.core.captureRaw(request(part,{namespace:ns,eventId:'multi-source-capture'})));
  const memories=ok(saved.interpretation).admission.memories;
  assert.equal(memories.length,count);
  let card=ok(f.call('createCardDraft',{actionId:'draft',drafting:'authored',input:{title:'Synthetic title',body:'Synthetic retained body',
    memoryRefs:memories.map(memory=>({type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision})),sourcePolicy:'retained-receipts-v1'}}));
  if(confirmed)card=f.confirm(card);
  const conversationId=saved.raw.conversationId;
  const revision=f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(conversationId).revision;
  return {f,card,memories,conversationId,revision};
}

for (const confirmed of [false,true]) for (const count of [1,2]) test(`delete Raw with ${count} receipt Memory contributors, ${confirmed?'confirmed':'draft'}`, async t => {
  const {f,card,memories,conversationId,revision}=await receiptAncestryCard(t,confirmed,count);
  const before=f.row(card.id).revision,bytes=retained(f.row(card.id));
  const authority=['card_body_sources','card_body_provenance','card_body_authorizations'].map(table=>f.db.prepare('SELECT * FROM '+table).all());
  assert.equal(f.db.prepare('SELECT count(*) n FROM card_raw_bindings WHERE card_id=?').get(card.id).n,0);
  let during,validated=0;
  registerContentWriteGuard((db,operation)=>{
    const guard=beginContentWriteSafety(db,operation);if(!guard)return guard;
    return {...guard,validate(result){
      const current=db.prepare('SELECT revision FROM private_cards WHERE id=?').get(card.id);
      validated++;during={before,after:current.revision,delta:current.revision-before,
        effects:db.prepare("SELECT count(*) n FROM card_effects WHERE entity_id=? AND kind='evidence_invalidated'").get(card.id).n};
      guard.validate(result);
    }};
  });
  let result;
  try{result=f.core.deleteConversation({namespace:ns,conversationId,expectedRevision:revision,actionId:'delete-both'});}
  finally{registerContentWriteGuard(beginContentWriteSafety);}
  t.diagnostic(JSON.stringify({result,during,rawStillExists:!!f.db.prepare('SELECT 1 FROM raw_conversations WHERE id=?').get(conversationId),
    suppressionFacts:f.db.prepare('SELECT count(*) n FROM content_suppressions').get().n,cardRevision:f.row(card.id).revision}));
  assert.equal(result.ok,true,'authorized source deletion must commit');
  assert.equal(validated,1,'real outer native validation');
  assert.equal(during.delta,count);assert.equal(during.effects,count);
  assert.equal(f.db.prepare('SELECT 1 FROM raw_conversations WHERE id=?').get(conversationId),undefined);
  assert.equal(f.db.prepare('SELECT count(*) n FROM receipts').get().n,0);
  assert.deepEqual(retained(f.row(card.id)),bytes);
  assert.deepEqual(['card_body_sources','card_body_provenance','card_body_authorizations'].map(table=>f.db.prepare('SELECT * FROM '+table).all()),authority);
  const effects=f.db.prepare("SELECT revision,action_id FROM card_effects WHERE entity_id=? AND kind='evidence_invalidated' ORDER BY ordinal").all(card.id);
  assert.deepEqual(effects.map(e=>e.revision),Array.from({length:count},(_,i)=>before+i+1));
  assert.deepEqual(new Set(effects.map(e=>e.action_id)),new Set(memories.map(m=>'memory-revision-'+m.id+'-'+(m.revision+1))));
  hidden(f,card);cold(f,card);
});


for(const confirmed of [false,true])for(const sameBytes of [false,true])test(`repeat correction ${sameBytes?'same':'changed'} bytes, ${confirmed?'confirmed':'draft'} already denied Card`,async t=>{
  const f=await lineageFixture(t);
  const original=ok(f.core.admit({namespace:ns,memory:{content:'Synthetic original Memory',kind:'fact'},receipts:[receipt('original')]})).memory;
  let card=ok(f.call('createCardDraft',{actionId:'draft',drafting:'authored',input:{title:'Synthetic title',body:'Synthetic original Card body',
    memoryRefs:[{type:'memory',namespace:ns,memoryId:original.id,revision:original.revision}],sourcePolicy:'retained-receipts-v1'}}));
  if(confirmed)card=f.confirm(card);
  const first=ok(f.core.correct({namespace:ns,memoryId:original.id,expectedRevision:original.revision,content:'Synthetic corrected Memory',kind:'fact',receipt:receipt('first-correction')})).memory;
  assert.equal(ok(f.call('getCard',{cardId:card.id})).card,null,'the old bound body is already denied');
  const beforeCardRevision=f.row(card.id).revision,bytes=retained(f.row(card.id));
  const authority=['card_body_sources','card_body_provenance','card_body_authorizations'].map(table=>f.db.prepare('SELECT * FROM '+table).all());
  const retiredReceipts=f.db.prepare('SELECT id FROM receipts WHERE memory_id=?').all(original.id);
  let atValidation,validated=0;
  registerContentWriteGuard((db,operation)=>{
    const guard=beginContentWriteSafety(db,operation);if(!guard)return guard;
    return {...guard,validate(result){
      validated++;atValidation={memory:db.prepare('SELECT revision,content FROM memories WHERE id=?').get(original.id),
        cardRevision:db.prepare('SELECT revision FROM private_cards WHERE id=?').get(card.id).revision,
        beforeCardRevision,factCount:db.prepare('SELECT count(*) n FROM content_suppressions').get().n};
      guard.validate(result);
    }};
  });
  let second;
  try{second=f.core.correct({namespace:ns,memoryId:original.id,expectedRevision:first.revision,
    content:sameBytes?'Synthetic corrected Memory':'Synthetic second corrected Memory',kind:'fact',receipt:receipt('second-correction')});}
  finally{registerContentWriteGuard(beginContentWriteSafety);}
  const stored=f.db.prepare('SELECT revision,content FROM memories WHERE id=?').get(original.id);
  const facts=f.db.prepare('SELECT kind,match_mode,source_version,reason FROM content_suppressions ORDER BY epoch_hi,epoch_lo').all();
  t.diagnostic(JSON.stringify({second,atValidation,stored,facts,cardRevision:f.row(card.id).revision}));
  assert.equal(second.ok,true,'a valid correction must not be vetoed by an already-denied old Card body');
  assert.equal(stored.revision,first.revision+1);assert.equal(validated,1);
  assert.equal(atValidation.memory.revision,stored.revision);assert.equal(atValidation.factCount,4);
  assert.equal(f.row(card.id).revision,beforeCardRevision+1);
  assert.equal(facts.length,4);assert.ok(facts.some(f=>f.source_version===JSON.stringify(['memory-revision-through-v1',first.revision])));
  for(const row of retiredReceipts)assert.equal(f.db.prepare('SELECT 1 FROM receipts WHERE id=?').get(row.id),undefined);
  assert.deepEqual(f.db.prepare('SELECT event_id FROM receipts WHERE memory_id=?').all(original.id).map(r=>r.event_id),['second-correction']);
  assert.deepEqual(retained(f.row(card.id)),bytes);
  assert.deepEqual(['card_body_sources','card_body_provenance','card_body_authorizations'].map(table=>f.db.prepare('SELECT * FROM '+table).all()),authority);
  hidden(f,card);cold(f,card);
});


test('an unrelated submitted-note write cannot name a denied Card through an injected effect',async t=>{
  const f=await lineageFixture(t),a=f.note('a'),card=f.draft([a]);
  ok(f.call('deleteSourceNote',{actionId:'deny-card',sourceId:a.sourceId,expectedRevision:a.revision}));
  const revision=f.row(card.id).revision,before=contentSafetyInventory(f.db);
  registerContentWriteGuard((db,operation)=>{
    const guard=beginContentWriteSafety(db,operation);if(!guard)return guard;
    return {...guard,validate(result){
      db.prepare(`INSERT INTO card_effects VALUES('synthetic-unrelated-effect',?,?,?,?,?,?,?,?,
        (SELECT coalesce(max(ordinal),0)+1 FROM card_effects))`)
        .run(ns.ownerId,ns.scope,ns.projectId??'','evidence_invalidated','card',card.id,revision,'unrelated-note');
      guard.validate(result);
    }};
  });
  let result;
  try{result=f.call('submitSourceNote',{actionId:'unrelated-note',text:'Synthetic unrelated note',occurredAt:null});}
  finally{registerContentWriteGuard(beginContentWriteSafety);}
  const effect=!!f.db.prepare("SELECT 1 FROM card_effects WHERE effect_id='synthetic-unrelated-effect'").get();
  t.diagnostic(JSON.stringify({result,unrelatedEffectCommitted:effect}));
  assert.equal(result.ok,false,'unrelated mutation must retain normal Card-readable validation');
  assert.equal(effect,false,'the unrelated write must roll back');
  assert.equal(contentSafetyInventory(f.db),before,'the note, operation receipt, audit authorization and effect all roll back');
});

for(const confirmed of [false,true])for(const fault of ['forged-effect','canonical-action','foreign-namespace','changed-effect','removed-effect'])
test(`unchanged Card rejects ${fault} during source deletion, ${confirmed?'confirmed':'draft'}`,async t=>{
  const f=await lineageFixture(t),a=f.note('target'),b=f.note('survivor');let card=f.draft([a,b]);
  if(confirmed)card=f.confirm(card);
  card=edit(f,card,[b],'remove-target');
  const before=contentSafetyInventory(f.db),previous=f.row(card.id).revision;
  const prior=f.db.prepare("SELECT effect_id FROM card_effects WHERE entity_type='card' AND entity_id=? ORDER BY ordinal LIMIT 1").get(card.id);
  let validated=0;
  registerContentWriteGuard((db,operation)=>{
    const guard=beginContentWriteSafety(db,operation);if(!guard)return guard;
    return {...guard,validate(result){
      validated++;assert.equal(db.prepare('SELECT revision FROM private_cards WHERE id=?').get(card.id).revision,previous);
      if(fault==='changed-effect')db.prepare('UPDATE card_effects SET action_id=? WHERE effect_id=?').run('unrelated-forged-action',prior.effect_id);
      else if(fault==='removed-effect')db.prepare('DELETE FROM card_effects WHERE effect_id=?').run(prior.effect_id);
      else db.prepare(`INSERT INTO card_effects VALUES('synthetic-forged-no-card-change',?,?,?,?,?,?,?,?,
        (SELECT coalesce(max(ordinal),0)+1 FROM card_effects))`)
        .run(fault==='foreign-namespace'?'foreign-owner':ns.ownerId,ns.scope,ns.projectId??'','evidence_invalidated','card',card.id,
          previous+(fault==='forged-effect'?100:1),fault==='forged-effect'?'unrelated-forged-action':'genuine-source-denial');
      guard.validate(result);
    }};
  });
  let result;
  try{result=f.call('deleteSourceNote',{actionId:'genuine-source-denial',sourceId:a.sourceId,expectedRevision:a.revision});}
  finally{registerContentWriteGuard(beginContentWriteSafety);}
  assert.equal(validated,1);assert.equal(result.ok,false);assert.equal(result.error.code,'evidence_unavailable');
  assert.equal(contentSafetyInventory(f.db),before,'the source, canonical denial, operation receipt and effects roll back');
  assert.equal(ok(f.call('listCardEffects',{limit:50})).effects.some(e=>e.effectId==='synthetic-forged-no-card-change'),false);
  assert.ok(ok(f.call('getCard',{cardId:card.id})).card,'the rolled-back deletion leaves the Card readable');
  // Removing the injected mutation must still allow the actual privacy action.
  const row=f.row(card.id),authority=['card_body_sources','card_body_provenance','card_body_authorizations'].map(table=>f.db.prepare('SELECT * FROM '+table+' WHERE card_id=?').all(card.id));
  ok(f.call('deleteSourceNote',{actionId:'genuine-source-denial',sourceId:a.sourceId,expectedRevision:a.revision}));
  assert.deepEqual(f.row(card.id),row,'a removed presentation binding needs no Card row update');
  assert.deepEqual(['card_body_sources','card_body_provenance','card_body_authorizations'].map(table=>f.db.prepare('SELECT * FROM '+table+' WHERE card_id=?').all(card.id)),authority,'retained body authority stays unchanged');
  assert.equal(f.db.prepare('SELECT state FROM card_notes WHERE id=?').get(a.sourceId).state,'deleted');
  assert.ok(f.db.prepare('SELECT 1 FROM content_suppressions WHERE stable_key=?').get(a.sourceId));
  hidden(f,card);cold(f,card);
});

for(const confirmed of [false,true])for(const fault of ['extra-revision','missing-step','duplicate-step','reversed-step','unrelated-cause','timestamp','title','body'])
test(`multi-Memory invalidation rejects ${fault}, ${confirmed?'confirmed':'draft'}`,async t=>{
  const {f,card,conversationId,revision}=await receiptAncestryCard(t,confirmed,2),before=contentSafetyInventory(f.db);
  let injected=false;
  registerContentWriteGuard((db,operation)=>{
    const guard=beginContentWriteSafety(db,operation);if(!guard)return guard;
    return {...guard,validate(result){
      const effects=db.prepare("SELECT * FROM card_effects WHERE entity_id=? AND kind='evidence_invalidated' ORDER BY ordinal").all(card.id);
      assert.equal(effects.length,2);injected=true;
      if(fault==='extra-revision')db.prepare('UPDATE private_cards SET revision=revision+1 WHERE id=?').run(card.id);
      if(fault==='missing-step')db.prepare('DELETE FROM card_effects WHERE effect_id=?').run(effects[0].effect_id);
      if(fault==='duplicate-step')db.prepare('UPDATE card_effects SET revision=? WHERE effect_id=?').run(effects[1].revision,effects[0].effect_id);
      if(fault==='reversed-step') {
        db.prepare('UPDATE card_effects SET revision=? WHERE effect_id=?').run(effects[1].revision,effects[0].effect_id);
        db.prepare('UPDATE card_effects SET revision=? WHERE effect_id=?').run(effects[0].revision,effects[1].effect_id);
      }
      if(fault==='unrelated-cause')db.prepare('UPDATE card_effects SET action_id=? WHERE effect_id=?').run('synthetic-unrelated-cause',effects[0].effect_id);
      if(fault==='timestamp')db.prepare('UPDATE private_cards SET updated_at=? WHERE id=?').run('2001-01-01T00:00:00.000Z',card.id);
      if(fault==='title')db.prepare('UPDATE private_cards SET title=?,body_revision=body_revision+1 WHERE id=?').run('Disguised multi-Memory title',card.id);
      if(fault==='body')db.prepare('UPDATE private_cards SET body=?,body_revision=body_revision+1 WHERE id=?').run('Disguised multi-Memory body',card.id);
      guard.validate(result);
    }};
  });
  let result;
  try{result=f.core.deleteConversation({namespace:ns,conversationId,expectedRevision:revision,actionId:'delete-both'});}
  finally{registerContentWriteGuard(beginContentWriteSafety);}
  assert.equal(injected,true);assert.equal(result.ok,false);assert.equal(result.error.code,'evidence_unavailable');
  assert.equal(contentSafetyInventory(f.db),before,'all source denials/deletions and Card changes roll back');
});

for(const confirmed of [false,true])test(`metadata-only supersession cannot use retirement exemption, ${confirmed?'confirmed':'draft'}`,async t=>{
  const f=await lineageFixture(t);
  const original=ok(f.core.admit({namespace:ns,memory:{content:'Synthetic supersession original',kind:'fact'},receipts:[receipt('original')]})).memory;
  let card=ok(f.call('createCardDraft',{actionId:'draft',drafting:'authored',input:{title:'Synthetic title',body:'Synthetic retained body',
    memoryRefs:[{type:'memory',namespace:ns,memoryId:original.id,revision:original.revision}],sourcePolicy:'retained-receipts-v1'}}));
  if(confirmed)card=f.confirm(card);
  const corrected=ok(f.core.correct({namespace:ns,memoryId:original.id,expectedRevision:original.revision,
    content:'Synthetic corrected supersession target',kind:'fact',receipt:receipt('corrected')})).memory;
  hidden(f,card);const before=contentSafetyInventory(f.db);
  const result=f.core.supersede({namespace:ns,memoryId:corrected.id,expectedRevision:corrected.revision,
    replacement:{content:'Synthetic historical replacement',kind:'fact'},receipts:[receipt('replacement')]});
  assert.equal(result.ok,false);assert.equal(result.error.code,'evidence_unavailable');
  assert.equal(contentSafetyInventory(f.db),before,'no new canonical denial means normal retained-history validation');
});
