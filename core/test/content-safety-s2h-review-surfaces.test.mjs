import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../index.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { openProductIndex } from '../context-product-index.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { roleEvidence } from '../role-context-evidence.mjs';
import { sourceReader, sourceBudget } from '../context-read-relations.mjs';
import { semanticMaintenance } from '../context-semantic-maintenance.mjs';
import { accessDigest } from '../context-product-validation.mjs';
import { transaction, readTransaction } from '../database.mjs';
import { suppressOwnerInside, writeContentSuppressionInside, contentSuppressionFenceInside } from '../content-suppression-storage.mjs';
import { host as contextHost, refresh, query } from '../testing/context-read-core-fixture.mjs';
import { cardHost } from '../testing/raw-source-fixtures.mjs';
import { request, splitRaw, localPlainPort, config } from '../testing/raw-capture-fixtures.mjs';
import { callModel } from '../model-call.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { interpretation } from '../testing/episode-capture-helpers.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';

const hidden = value => assert.doesNotMatch(JSON.stringify(value),/ProtectedSyntheticBody|ProtectedSyntheticReceipt|ProtectedSyntheticCard|ProtectedSyntheticNote/);
const erase = db => transaction(db,()=>suppressOwnerInside(db,{ownerId:ns.ownerId,reason:'account_erasure',actionId:'erase'}));
const add = (core,text='ProtectedSyntheticBody') => ok(core.admit({namespace:ns,memory:{content:text,kind:'fact'},receipts:[receipt(text,'ProtectedSyntheticReceipt')]})).memory;
for(const base of [18,23,33])test(`surface matrix ${base}: owner fact denies Memory, Card, exact, snapshot, cached candidate, assembly and role delivery`,async t=>{
  const f=safetyFixture(t,base);await f.migrate();const db=f.connect(),cards=cardHost(),trusted=contextHost();
  const core=openMemoryCore({path:f.path,model:rationaleModel(),...(base>=23?{privateCards:cards.options}:{}),contextRead:{version:'context-read-v1',authority:trusted.authority,counter:{id:'synthetic',countTokens:()=>1}}});
  t.after(()=>{core.close();db.close();});const memory=add(core);add(core,'ProtectedSyntheticBody second');
  const ref={type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision},call=(method,input)=>cards.call(core,method,input);
  let cardRef,cardSource,noteSource,snapshot;
  if(base>=23){
    const draft=ok(call('createCardDraft',{namespace:ns,actionId:'draft',drafting:'authored',input:{title:'ProtectedSyntheticCard',body:'ProtectedSyntheticCard body',sourcePolicy:'retained-receipts-v1',memoryRefs:[ref]}}));
    const card=ok(call('confirmCardDraft',{namespace:ns,cardId:draft.id,expectedRevision:1,actionId:'confirm',applicability:'current'}));
    cardRef={type:'card',namespace:ns,cardId:card.id,revision:card.revision,bodyRevision:card.bodyRevision};
    cardSource=ok(call('getCard',{namespace:ns,cardId:card.id})).card.bindings[0].source;
    snapshot=ok(call('fetchEvidence',{namespace:ns,refs:[cardRef],intent:'history'})).snapshot;
    noteSource=ok(call('submitSourceNote',{namespace:ns,actionId:'note',text:'ProtectedSyntheticNote',occurredAt:null})).source;
    assert.match(JSON.stringify(ok(call('getSource',{namespace:ns,source:noteSource}))),/ProtectedSyntheticNote/);
    ok(call('applyCardPlacement',{namespace:ns,actionId:'card-placement',refs:[cardRef],expectedIndexRevision:ok(call('mapEvidence',{namespace:ns,type:'card'})).indexRevision,
      proposal:{items:[{cardId:cardRef.cardId,parentIds:[],newL1:{title:'ProtectedSyntheticCard topic',parentL2Ids:[],newL2Title:'ProtectedSyntheticCard root'}}]}}));
    assert.match(JSON.stringify(ok(call('mapEvidence',{namespace:ns,type:'card'}))),/ProtectedSyntheticCard topic/);
  }
  for(let i=0;i<30;i++)if(ok(await trusted.call(core,'refreshContextIndex',refresh())).status==='complete')break;
  const first=ok(await trusted.call(core,'findCandidates',query({query:'ProtectedSyntheticBody',limit:1})));assert.ok(first.nextCursor);
  const facade=openContextProductFacade(f.path,{});t.after(()=>facade.close());
  const access={accessGenerations:accessDigest({ownerId:ns.ownerId,namespaces:{readSet:[ns]}}),check(){},envelope:work=>work()};
  const product=openProductIndex({path:f.path,facade,authorize:()=>access,maintenance:true,counter:{id:'synthetic',countTokens:()=>1},ownerCoverage:{policy:'recent-projects-v1',selectionRevision:'synthetic',requestedNamespaces:1,selectedNamespaces:1,omittedNamespaces:0}});t.after(()=>product.close());
  for(let i=0;i<30;i++)if(ok(product.run('refreshContextIndex',{...refresh(),mode:'lexical'})).status==='complete')break;
  const pf=ok(product.run('findCandidates',query({query:'ProtectedSyntheticBody',limit:1})));assert.ok(pf.nextCursor);
  const assembled=ok(await trusted.call(core,'contextRead',{readSet:[ns],types:['memory'],intent:'history',query:'ProtectedSyntheticBody',budget:{maxTokens:4000,maxItems:4}}));
  erase(db);
  const responses=[core.get({namespace:ns,memoryId:memory.id}),core.list({namespace:ns}),core.fetch({namespace:ns,refs:[{memoryId:memory.id,revision:memory.revision}]}),core.sourceSnapshot({readSet:[ns]}),
    await trusted.call(core,'findCandidates',query({query:'ProtectedSyntheticBody'})),await trusted.call(core,'findCandidates',query({query:'ProtectedSyntheticBody',limit:1,cursor:first.nextCursor})),
    await trusted.call(core,'fetchCandidateEvidence',{readSet:[ns],refs:[ref],intent:'history'}),await trusted.call(core,'fetchCandidateEvidence',{readSet:[ns],snapshot:assembled.snapshot}),
    await trusted.call(core,'contextRead',{readSet:[ns],types:['memory'],intent:'history',query:'ProtectedSyntheticBody',budget:{maxTokens:4000,maxItems:4}}),
    product.run('findCandidates',query({query:'ProtectedSyntheticBody'})),product.run('findCandidates',query({query:'ProtectedSyntheticBody',limit:1,cursor:pf.nextCursor})),
    product.run('contextRead',{readSet:[ns],types:['memory'],intent:'history',query:'ProtectedSyntheticBody',budget:{maxTokens:4000,maxItems:4}})];
  if(base>=23)responses.push(call('getCard',{namespace:ns,cardId:cardRef.cardId}),call('listCards',{namespace:ns,states:['draft','confirmed']}),call('selectEvidence',{namespace:ns,types:['memory','card'],query:'ProtectedSynthetic',intent:'history'}),
    call('fetchEvidence',{namespace:ns,refs:[ref,cardRef],intent:'history'}),call('revalidateEvidence',{namespace:ns,snapshot}),call('mapEvidence',{namespace:ns,type:'memory'}),call('mapEvidence',{namespace:ns,type:'card'}),call('getSource',{namespace:ns,source:cardSource}),call('getSource',{namespace:ns,source:noteSource}));
  responses.forEach(hidden);
  const identity=db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get();
  if(base>=23){const roles=roleEvidence({db,identity,ready(){}},{path:f.path});assert.throws(()=>readTransaction(db,()=>roles.item(ref,[ns],1,'history')),{code:'evidence_unavailable'});}
  readTransaction(db,()=>{const reader=sourceReader(db,identity,facade.port.features,{readSet:[ns],types:['memory'],intent:'current'},sourceBudget(Infinity));assert.ok(reader.endpoint(ref).reason);});
});

for(const mode of ['span','incarnation','version'])test(`surface R1 Raw ${mode}: retained lineage denies derived map/title/overview and Raw delivery`,async t=>{
  const f=safetyFixture(t,33);await f.migrate();const db=f.connect(),host=cardHost();
  const core=openRawCaptureCore({path:f.path,privateCards:host.options,model:{...rationaleModel(),extract:()=>({items:[{content:'ProtectedSyntheticBody',kind:'fact',confidence:.8,sourceIndices:[0]}]})}},
    {mode:'raw-v1',port:localPlainPort(),sources:true,readPolicy:()=>({generation:'synthetic',reason:null})});t.after(()=>{core.close();db.close();});
  const raw=ok(await core.captureRaw(request(splitRaw('ProtectedSyntheticReceipt raw bytes')[0],{namespace:ns,client:'codex',sessionId:'synthetic-raw',eventId:'synthetic-event'})));
  const memory=ok(raw.interpretation).admission.memories[0],conversationId=raw.raw.conversationId;
  const placed=ok(core.applyPlacement({namespace:ns,proposal:{items:[{memoryId:memory.id,parentIds:[],newL1:{title:'ProtectedSyntheticCard derived title',parentL2Ids:[]}}]},expectedMemoryRevisions:[{memoryId:memory.id,revision:memory.revision}],expectedIndexRevision:ok(core.map({namespace:ns})).indexRevision}));assert.ok(placed.createdMocs.length);
  const anchor=db.prepare('SELECT * FROM raw_receipt_lineage WHERE receipt_id IN (SELECT id FROM receipts WHERE memory_id=?)').get(memory.id);
  transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'raw',key:conversationId,matchMode:mode,reason:'privacy_erase',actionId:'raw-'+mode,
    ...(mode==='span'?{messageId:anchor.message_id,start:anchor.start,end:anchor.end}:{}),...(mode==='version'?{sourceVersion:JSON.stringify(['raw-v1',1,anchor.message_id,[0],[],'exact'])}:{})}));
  hidden(core.map({namespace:ns}));hidden(core.get({namespace:ns,memoryId:memory.id}));hidden(await core.getConversation({namespace:ns,conversationId}));
  if(mode==='incarnation'){const listed=core.listRawConversations({namespace:ns,client:'codex'});assert.equal(listed.error?.code,'conversation_not_found');assert.doesNotMatch(JSON.stringify(listed),new RegExp(conversationId));}
});

for(const method of ['classify','relate','reviewBasis','select','rank'])test(`port matrix ${method}: scoped fact prevents stored text dispatch`,async t=>{
  const f=safetyFixture(t);await f.migrate();const db=f.connect();let calls=0,armed=false,fired=false;
  const model={...rationaleModel(),select:({input})=>({refs:input.maps.flatMap(map=>map.items.filter(item=>['unfiled','ref'].includes(item.type)&&(!item.ref.childType||item.ref.childType==='memory')).map(item=>({namespaceIndex:map.namespaceIndex,...(item.type==='unfiled'?item.ref:{memoryId:item.ref.childId,revision:item.ref.childRevision})})))}),reviewBasis:()=>({}),[method](){calls++;return{};},countTokens(text){if(armed&&!fired&&text.startsWith('{"system":')&&(method!=='rank'||text.includes('"candidates":'))){fired=true;erase(db);}return 1;}};
  const core=openMemoryCore({path:f.path,model});t.after(()=>{core.close();db.close();});const memory=add(core);
  const refs=[{memoryId:memory.id,revision:memory.revision}];armed=true;
  let response;
  if(method==='classify')response=await core.classifyPlacement({namespace:ns,memoryIds:[memory.id],expectedMemoryRevisions:refs,mapRevision:ok(core.map({namespace:ns})).indexRevision});
  else if(method==='relate')response=await core.reviewRationale({namespace:ns,refs});
  else if(method==='reviewBasis')response=await core.reviewDecisionBasis({namespace:ns,refs});
  else if(['select','rank'].includes(method))response=await core.recall({readSet:[ns],query:'ProtectedSyntheticBody'});

  assert.equal(calls,0);hidden(response);
  assert.equal(fired,true);
});

test('port R2 product transmission rechecks the owner fact epoch after the asynchronous handoff',async t=>{
  const f=safetyFixture(t);await f.migrate();const db=f.connect();t.after(()=>db.close());
  const epoch=readTransaction(db,()=>contentSuppressionFenceInside(db,ns.ownerId));erase(db);
  const maintenance=semanticMaintenance({c:{host:{configuration:{}}},sqlite:undefined,identity:()=>({}),secretState:{}});t.after(()=>maintenance.close());
  assert.throws(()=>maintenance.transmission({kind:'refresh',projection:{readSet:[ns],types:['memory'],intent:'current',suppressionEpoch:epoch}},
    {path:f.path,readSet:[ns],maintenance:true},{ownerId:ns.ownerId}),{code:'evidence_unavailable'});
});

for(const method of ['extract','qualify','qualifyCandidates','interpretEpisode','reconcile'])test(`capture port seam ${method}: positive dispatch, then pending privacy denial immediately before invocation`,async t=>{
  const f=safetyFixture(t);await f.migrate();const runtime=createMemoryRuntime({path:f.path}),db=f.connect();t.after(()=>{runtime.close();db.close();});
  let calls=0;const source=receipt('retained','ProtectedSyntheticReceipt'),model={contextWindow:8192,countTokens:()=>1,[method](){calls++;return{synthetic:true};}};
  const seed=openMemoryCore({path:f.path});try{ok(seed.admit({namespace:ns,memory:{content:'ProtectedSyntheticBody',kind:'fact'},receipts:[source]}));}finally{seed.close();}
  assert.equal(db.prepare('SELECT count(*) n FROM receipts').get().n,1);
  const input={retained:[source]},validateFresh=()=>runtime.assertCaptureSources(ns,[source]);
  await callModel(model,method,'Synthetic system',input,{validateFresh});assert.equal(calls,1);
  erase(db);calls=0;await assert.rejects(()=>callModel(model,method,'Synthetic system',input,{validateFresh}),{code:'memory_not_found'});assert.equal(calls,0);
});

test('surface episode summaries and next steps revalidate retained Raw origins under pending span facts',async t=>{
  const f=safetyFixture(t,33);await f.migrate();const db=f.connect(),host=cardHost();
  const core=openRawCaptureCore({path:f.path,...config('episode'),sessionEpisodes:{mode:'episode-v1',draftEveryBatches:2},privateCards:host.options,
    model:{...rationaleModel(),extract:()=>({items:[]}),interpretEpisode(request){const value=interpretation(request);value.gist.value='ProtectedSyntheticEpisode';value.nextStep={value:'ProtectedSyntheticEpisode next step',anchors:value.gist.anchors};return value;}}},
    {mode:'raw-v1',port:localPlainPort(),sources:true,readPolicy:()=>({generation:'synthetic',reason:null})});t.after(()=>{core.close();db.close();});
  let raw;for(let i=1;i<=2;i++)raw=ok(await core.captureRaw(request(splitRaw('ProtectedSyntheticEpisode source '+i,{id:'episode-source-'+i,ordinal:i})[0],{namespace:ns,client:'codex',sessionId:'episode-raw',eventId:'episode-event-'+i},'episode')));
  const row=db.prepare('SELECT * FROM session_episodes').get(),record=JSON.parse(row.record);assert.equal(record.gist,'ProtectedSyntheticEpisode');
  const source=db.prepare('SELECT * FROM episode_sources WHERE id=?').get(record.anchors.gist[0].sourceId);
  const now=Date.now(),range={namespace:ns,timeBasis:'receipt',since:new Date(now-86400000).toISOString(),until:new Date(now+86400000).toISOString()};
  assert.match(JSON.stringify(ok(core.getEpisode({namespace:ns,episodeId:row.id}))),/ProtectedSyntheticEpisode/);
  assert.match(JSON.stringify(ok(core.sessionStartContext({namespace:ns,groups:{procedural:false}}))),/ProtectedSyntheticEpisode/);
  transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'raw',key:raw.raw.conversationId,matchMode:'span',messageId:source.message_id,start:0,end:source.text.length,reason:'privacy_erase',actionId:'episode-origin'}));
  for(const result of [core.getEpisode({namespace:ns,episodeId:row.id}),core.listEpisodes(range),core.sessionStartContext({namespace:ns,groups:{procedural:false}})]){
    assert.equal(result.ok,false);assert.doesNotMatch(JSON.stringify(result),/ProtectedSyntheticEpisode/);
  }
});
