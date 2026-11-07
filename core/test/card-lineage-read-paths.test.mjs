import test from 'node:test';
import assert from 'node:assert/strict';
import { lineageFixture,ns,ok,receipt } from '../testing/card-lineage-fixture.mjs';
import { host as contextHost,policy } from '../testing/context-read-core-fixture.mjs';
import { createFakeEmbedder } from '../context-read-embedder.mjs';
import { transaction } from '../database.mjs';
import { sealCardBodyInside,collectCardBodySourcesInside } from '../card-lineage.mjs';
import { sourceReadSafety } from '../content-safety.mjs';

const ref=(f,card)=>({type:'card',namespace:ns,cardId:card.id,revision:f.row(card.id).revision,bodyRevision:f.row(card.id).body_revision});
test('same-body union invalidates prepared evidence with no Card or Memory epoch change',async t=>{
  const f=await lineageFixture(t),a=f.note('a'),b=f.note('b'),card=f.confirm(f.draft([a]));
  const prepared=ok(f.call('fetchEvidence',{refs:[ref(f,card)],intent:'history'}));
  const epochs=f.db.prepare('SELECT * FROM card_epochs').all();
  transaction(f.db,()=>sealCardBodyInside(f.db,{identity:f.identity,namespace:ns,cardId:card.id,
    sources:collectCardBodySourcesInside(f.db,f.identity,ns,[b],source=>sourceReadSafety(f.db,{identity:f.identity,namespace:ns,ref:source}).allowed)}));
  assert.deepEqual(f.db.prepare('SELECT * FROM card_epochs').all(),epochs);
  const result=f.call('revalidateEvidence',{snapshot:prepared.snapshot});
  assert.equal(result.ok,false);assert.equal(result.error.code,'snapshot_stale');
  assert.doesNotMatch(JSON.stringify(result),/Synthetic title|Synthetic retained body/);
});

for(const mode of ['union','forget','missing-header'])test(`final counter gap refuses stale authored body: ${mode}`,async t=>{
  const trusted=contextHost();let hook;
  const f=await lineageFixture(t,{options:{contextRead:{version:'context-read-v1',authority:trusted.authority,
    counter:{id:'synthetic',countTokens(text){if(hook&&text.includes('Synthetic retained body')){const run=hook;hook=null;run();}return 1;}}}}});
  const a=f.note('a'),b=f.note('b'),card=f.confirm(f.draft([a]));
  const projection={readSet:[ns],types:['card'],intent:'current'};
  ok(await trusted.call(f.core,'refreshContextIndex',{...projection,budget:{maxItems:1024,maxMs:5000}}));
  hook=()=>{
    if(mode==='union')transaction(f.db,()=>sealCardBodyInside(f.db,{identity:f.identity,namespace:ns,cardId:card.id,
      sources:collectCardBodySourcesInside(f.db,f.identity,ns,[b],source=>sourceReadSafety(f.db,{identity:f.identity,namespace:ns,ref:source}).allowed)}));
    else if(mode==='forget')ok(f.call('deleteSourceNote',{actionId:'forget-source',sourceId:a.sourceId,expectedRevision:a.revision}));
    else f.db.prepare('UPDATE private_cards SET body_revision=body_revision+1 WHERE id=?').run(card.id);
  };
  const result=await trusted.call(f.core,'contextRead',{...projection,query:'Synthetic',deadlineMs:5000});
  assert.equal(hook,null,'the real counter gap ran');assert.equal(result.ok,false,JSON.stringify(result));
  assert.doesNotMatch(JSON.stringify(result),/Synthetic retained body|Synthetic title/);
});

test('zero-fact missing lineage cannot expose list metadata, MOC titles or end-of-stream metadata',async t=>{
  const f=await lineageFixture(t),a=f.note('a'),card=f.confirm(f.draft([a]));
  const r=ref(f,card),map=ok(f.call('mapEvidence',{type:'card'}));
  ok(f.call('applyCardPlacement',{actionId:'place',refs:[r],expectedIndexRevision:map.indexRevision,
    proposal:{items:[{cardId:card.id,parentIds:[],newL1:{title:'Synthetic derived topic',parentL2Ids:[]}}]}}));
  assert.equal(f.db.prepare('SELECT count(*) n FROM content_suppressions').get().n,0);
  f.db.prepare('UPDATE private_cards SET body_revision=body_revision+1 WHERE id=?').run(card.id);
  assert.equal(ok(f.call('getCard',{cardId:card.id})).card,null);
  const list=ok(f.call('listCards',{states:['confirmed'],limit:1}));
  assert.equal(list.nextCursor,null);assert.deepEqual(list.cards,[]);
  for(const result of [f.call('mapEvidence',{type:'card'}),f.call('selectEvidence',{query:'Synthetic',types:['card'],intent:'history',limit:1})]) {
    assert.doesNotMatch(JSON.stringify(result),/Synthetic derived topic|Synthetic retained body|Synthetic title/);
    assert.equal(JSON.stringify(result).includes(card.id),false,'no identifier-bearing metadata');
  }
});

test('history retains an intact superseded dependency while current intent refuses it',async t=>{
  const f=await lineageFixture(t),memory=ok(f.core.admit({namespace:ns,memory:{content:'Synthetic predecessor',kind:'fact'},receipts:[receipt('predecessor')]})).memory;
  const draft=ok(f.call('createCardDraft',{actionId:'draft',drafting:'authored',input:{title:'Synthetic title',body:'Synthetic retained body',
    memoryRefs:[{type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision}],sourcePolicy:'retained-receipts-v1'}}));
  const card=f.confirm(draft);
  ok(f.core.supersede({namespace:ns,memoryId:memory.id,expectedRevision:memory.revision,
    replacement:{content:'Synthetic successor',kind:'fact'},receipts:[receipt('successor')]}));
  assert.ok(ok(f.call('fetchEvidence',{refs:[ref(f,card)],intent:'history'})).items.length);
  assert.equal(f.call('fetchEvidence',{refs:[ref(f,card)],intent:'current'}).ok,false);
});

for(const missing of [false,true])test(`zero-fact ${missing?'missing':'unknown'} lineage sends no Card bytes to an embedding port`,async t=>{
  const trusted=contextHost(),base=createFakeEmbedder(),inputs=[];
  const embedder={id:base.id,revision:base.revision,dimensions:base.dimensions,normalization:base.normalization,
    async embed(texts,options){inputs.push(...texts);options?.beforeDispatch?.();return base.embed(texts,options);}};
  const f=await lineageFixture(t,{options:{contextRead:{version:'context-read-v1',authority:trusted.authority,embedder,policy:policy()}}});
  const a=f.note('a'),card=f.confirm(f.draft([a]));
  transaction(f.db,()=>{
    f.db.prepare('UPDATE private_cards SET body_revision=body_revision+1 WHERE id=?').run(card.id);
    if(!missing)sealCardBodyInside(f.db,{identity:f.identity,namespace:ns,cardId:card.id,newBody:true,legacy:true,sources:[]});
  });
  assert.equal(f.db.prepare('SELECT count(*) n FROM content_suppressions').get().n,0);
  const projection={readSet:[ns],types:['card'],intent:'history'};
  const refresh=await trusted.call(f.core,'refreshContextIndex',{...projection,budget:{maxItems:1024,maxMs:5000}});
  assert.equal(refresh.ok,true,JSON.stringify(refresh));
  const result=await trusted.call(f.core,'findCandidates',{...projection,query:'Synthetic',semantic:true});
  assert.equal(JSON.stringify(result).includes(card.id),false);
  assert.doesNotMatch(JSON.stringify(result),/Synthetic title|Synthetic retained body/);
  assert.ok(inputs.every(text=>!text.includes('Synthetic title')&&!text.includes('Synthetic retained body')),'no provider input contains hidden Card bytes');
});
