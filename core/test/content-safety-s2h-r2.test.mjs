import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore, openMemoryReader } from '../index.mjs';
import { openContextReadSidecar } from '../context-read-sidecar.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { request, splitRaw, localPlainPort } from '../testing/raw-capture-fixtures.mjs';
import { sourceReader, sourceBudget } from '../context-read-relations.mjs';
import { createFakeEmbedder } from '../context-read-embedder.mjs';
import { openProductIndex } from '../context-product-index.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { transaction, readTransaction } from '../database.mjs';
import { suppressOwnerInside, writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';
import { suppressionFixture } from '../testing/content-suppression-fixture.mjs';
import { cardHost } from '../testing/raw-source-fixtures.mjs';
import { input as methodInput } from '../testing/method-package-fixtures.mjs';
import { input as assetInput } from '../testing/asset-fixtures.mjs';
import { refresh, query } from '../testing/context-read-core-fixture.mjs';
import { publish, read as roleRead } from './role-fixture.mjs';
import { callModel } from '../model-call.mjs';
import { MemoryStoreError } from '../validation.mjs';
import { accessDigest } from '../context-product-validation.mjs';

const erased = db => transaction(db,()=>suppressOwnerInside(db,{ownerId:ns.ownerId,reason:'account_erasure',actionId:'erase'}));
const refused = result => {assert.equal(result.ok,false,JSON.stringify(result));assert.ok(['memory_not_found','evidence_unavailable','moc_not_found','index_unavailable'].includes(result.error.code),JSON.stringify(result));};
function authority() {const grants=new WeakMap();return {authorize(r){const g={}, {input,...b}=r;grants.set(g,b);return g;},isCurrent(g){return {...grants.get(g),accessGeneration:1};}};}
for(const base of [18,23,33])test(`r2 qualification ${base}: every anchor is checked independently of receipt pagination`,async t=>{
 const f=safetyFixture(t,base);await f.migrate();const db=f.connect(),core=openMemoryCore({path:f.path});t.after(()=>{core.close();db.close();});
 const receipts=Array.from({length:4},(_,i)=>receipt('anchor-'+i,'ProtectedAnchorText'+i));
 const qualification={version:1,slot:{subject:'User',property:'style',scope:'personal',applies:'today'},value:'ProtectedDerivedValue',attribution:'direct',commitment:'considered',
  anchors:receipts.map((r,i)=>({receiptIndex:i,start:0,end:r.excerpt.length,text:r.excerpt,fields:['subject','property','scope','applies','value','attribution','commitment']}))};
 const memory=ok(core.admit({namespace:ns,memory:{content:'Synthetic qualified claim',kind:'preference'},receipts,qualification})).memory;
 const rows=db.prepare('SELECT * FROM receipts WHERE memory_id=? ORDER BY created_at,id').all(memory.id),target=rows.at(-1);
 assert.equal(ok(core.get({namespace:ns,memoryId:memory.id,receiptLimit:1,includeQualification:true})).qualification.anchors.length,4);
 transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'receipt',key:target.id,reason:'privacy_erase',actionId:'anchor'}));
 const result=core.get({namespace:ns,memoryId:memory.id,receiptLimit:1,includeQualification:true});
 assert.equal(result.ok,false,'qualification_anchor_gate');assert.doesNotMatch(JSON.stringify(result),/ProtectedAnchorText|ProtectedDerivedValue/);
});

test('r2 owner scope: staged evidence, method files, asset bytes and complete topic topology refuse',async t=>{
 const f=safetyFixture(t,33);await f.migrate();const db=f.connect(),port=authority();
 const core=openMemoryCore({path:f.path,captureEvidence:'staged-v1',captureQualification:'source-bound-v2',model:{contextWindow:8192,countTokens:()=>1,extract:()=>({malformed:true})},
  methodPackages:{version:'method-packages-local-v1',storage:'local-plain-v1',authority:port},assets:{version:'assets-local-v1',storage:'sqlite-blob-v1',authority:port}});t.after(()=>{core.close();db.close();});
 const method=ok(core.importMethodVersion({...methodInput(),namespace:ns},{})).version;
 const asset=ok(core.importAssetVersion({...assetInput(),namespace:ns},{})).version;
 const staged={namespace:ns,client:'synthetic',sessionId:'staged',eventId:'staged',messages:[{id:'message',role:'user',content:'ProtectedStagedBytes'}]};
 assert.equal((await core.capture(staged)).ok,false);const inspect={namespace:ns,client:'synthetic',eventId:'staged'};
 assert.match(JSON.stringify(ok(core.inspectCaptureEvidence(inspect))),/ProtectedStagedBytes/);
 const memory=ok(core.admit({namespace:ns,memory:{content:'ProtectedTopology',kind:'fact'},receipts:[receipt('topic')]})).memory;
 const index=ok(core.map({namespace:ns})).indexRevision;
 const placed=ok(core.applyPlacement({namespace:ns,expectedIndexRevision:index,expectedMemoryRevisions:[{memoryId:memory.id,revision:memory.revision}],proposal:{items:[{memoryId:memory.id,parentIds:[],newL1:{title:'ProtectedChild',parentL2Ids:[],newL2Title:'ProtectedRoot'}}]}}));
 assert.equal(placed.createdMocs.length,2);
 const reader=openMemoryReader({path:f.path,ownerId:ns.ownerId});t.after(()=>reader.close());
 erased(db);
 const responses={staged:core.inspectCaptureEvidence(inspect),method:core.readMethodFile({version:method,path:'SKILL.md',intent:'history'},{}),asset:core.readAssetBytes({version:asset},{}),map:core.map({namespace:ns}),topic:await reader.readTopicOverview({namespace:ns})};
 for(const [name,result]of Object.entries(responses))await t.test(name,()=>{refused(result);assert.doesNotMatch(JSON.stringify(result),/Protected|mocId|parentId|contains|totalByteCount/);});
});

test('r2 native refusal: restoring a guard cannot revive fresh support wrappers, relation reads or embedding',async t=>{
 const f=safetyFixture(t,23);await f.migrate();const db=f.connect(),host=cardHost(),core=openMemoryCore({path:f.path,privateCards:host.options});t.after(()=>{core.close();db.close();});
 const memory=ok(core.admit({namespace:ns,memory:{content:'ProtectedNativeCardSource',kind:'fact'},receipts:[receipt('native')]})).memory;
 const draft=ok(host.call(core,'createCardDraft',{namespace:ns,actionId:'draft',drafting:'authored',input:{title:'ProtectedNativeCard',body:'ProtectedNativeBody',sourcePolicy:'retained-receipts-v1',memoryRefs:[{type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision}]}}));
 ok(host.call(core,'confirmCardDraft',{namespace:ns,cardId:draft.id,expectedRevision:1,actionId:'confirm',applicability:'current'}));
 const side=openContextReadSidecar({path:f.path,db});t.after(()=>side.close());const input={readSet:[ns],types:['memory','card'],intent:'current',accessGeneration:1,budget:{maxItems:1024,maxMs:5000}};
 for(let i=0;i<20;i++)if(side.reconcile(input).status==='complete')break;
 const guard=db.prepare("SELECT sql FROM sqlite_schema WHERE name='safety_memories_insert'").get().sql;
 db.exec('DROP TRIGGER safety_memories_insert');assert.throws(()=>side.reconcile(input),{code:'unsupported_database'});db.exec(guard);
 await t.test('same sidecar',()=>assert.throws(()=>side.reconcile(input),{code:'unsupported_database'},'native_refusal_survives_wrappers'));
 const identity=db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get();
 await t.test('relation wrapper',()=>assert.throws(()=>readTransaction(db,()=>sourceReader(db,identity,{},input,sourceBudget(Infinity)).endpoint({type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision})),{code:'unsupported_database'},'native_relation_gate'));
 await t.test('embedder dispatch',async()=>{
  let calls=0,error;const fake=createFakeEmbedder();try{await side.refreshVectors(input,{...fake,embed(...args){calls++;return fake.embed(...args);}},{isCurrent:()=>true});}catch(caught){error=caught;}
  assert.equal(calls,0,'native_embedder_gate');assert.equal(error?.code,'unsupported_database');
 });
});

test('r2 ordered capture: 32768 receipts take bounded fallback before materialization',async t=>{
 const f=safetyFixture(t);await f.migrate();const db=f.connect();let calls=0;
 const core=openMemoryCore({path:f.path,model:{contextWindow:8192,countTokens:()=>1,extract:({input})=>({items:[{content:input.messages[0].content,kind:'fact',confidence:.8,sourceIndices:[0]}]}),reconcile(){calls++;return{transitions:[]};}}});t.after(()=>{core.close();db.close();});
 const input=n=>({namespace:ns,client:'synthetic',sessionId:'ordered',eventId:'ordered-'+n,causal:{streamId:'stream',sequence:n},messages:[{id:'ordered-'+n,role:'user',content:'Synthetic ordered value '+n}]});
 const memory=ok(await core.capture(input(1))).admission.memories[0];
 transaction(db,()=>{const insert=db.prepare('INSERT INTO receipts(id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at) VALUES(?,?,?,?,?,?,?,?,?)');for(let i=1;i<32768;i++){
  const r={client:'synthetic',sessionId:'ordered',eventId:'extra-'+i,role:'user',excerpt:'Synthetic bounded receipt '+i};
  insert.run(randomUUID(),memory.id,createHash('sha256').update(JSON.stringify(r)).digest('hex'),r.client,r.sessionId,r.eventId,r.role,r.excerpt,new Date().toISOString());
 }});
 const prepare=DatabaseSync.prototype.prepare;let maximum=0;
 DatabaseSync.prototype.prepare=function(sql){const stmt=prepare.call(this,sql);if(!/FROM receipts\b.*memory_id/s.test(sql))return stmt;return new Proxy(stmt,{get(target,key){const value=Reflect.get(target,key,target);if(key==='all')return(...args)=>{const rows=value.apply(target,args);maximum=Math.max(maximum,rows.length);return rows;};return typeof value==='function'?value.bind(target):value;}});};
 let result;try{result=await core.capture(input(2));}finally{DatabaseSync.prototype.prepare=prepare;}
 await t.test('materialized receipt bound',()=>assert.ok(maximum<=5,'ordered_materialization_bound rows='+maximum));
 assert.equal(result.ok,true,'ordered_receipt_bound '+JSON.stringify(result));assert.equal(result.value.reconciliation.reason,'unordered_sources');assert.ok(maximum<=5,'materialized '+maximum+' receipt rows');assert.equal(calls,0);
});

test('r2 pull windows: 10000-fact checkpoints and cached batches use bounded seeks and charged rows',async t=>{
 const f=await suppressionFixture(t),a=f.descriptor(f.memory());
 transaction(f.db,()=>{for(let i=0;i<10000;i++)writeContentSuppressionInside(f.db,{namespace:ns,kind:'memory',key:a.key,reason:'purge',actionId:'history-'+i});});
 const b=f.descriptor(f.memory('Synthetic independent input')),c=f.descriptor(f.memory('Synthetic independent second')), {handle}=await f.reader();
 const options={expected:f.checkpoint(10000),limit:1},first=ok(await handle.isSuppressed(ns.ownerId,[b,c],options,f.credential));assert.ok(first.nextCursor);
 const prepare=DatabaseSync.prototype.prepare;let statements=0,rows=0,aggregate=false;
 DatabaseSync.prototype.prepare=function(sql){const stmt=prepare.call(this,sql);return new Proxy(stmt,{get(target,key){const value=Reflect.get(target,key,target);if(['get','all'].includes(key))return(...args)=>{statements++;if(/count\(\*\).*content_suppressions/is.test(sql))aggregate=true;const result=value.apply(target,args);rows+=key==='all'?result.length:result?1:0;return result;};return typeof value==='function'?value.bind(target):value;}});};
 let listed,batch;try{listed=await handle.listSuppressionsSince(ns.ownerId,'10000',options,f.credential);batch=await handle.isSuppressed(ns.ownerId,[b,c],{...options,cursor:first.nextCursor},f.credential);}finally{DatabaseSync.prototype.prepare=prepare;}
 assert.equal(aggregate,false,'pull_full_history_scan');assert.deepEqual(ok(listed),{items:[],throughEpoch:'10000',nextCursor:null});assert.equal(ok(batch).results.length,1);assert.ok(statements<64,'statements='+statements);assert.ok(rows<64,'rows='+rows);t.diagnostic('bounded pull statements='+statements+' rows='+rows);
});

test('r2 product counts and scores exclude per-identity suppressions before ranking',async t=>{
 const f=safetyFixture(t);await f.migrate();const db=f.connect(),core=openMemoryCore({path:f.path});t.after(()=>{core.close();db.close();});const memories=[];
 for(let i=0;i<30;i++)memories.push(ok(core.admit({namespace:ns,memory:{content:'ProtectedKeyword '+i,kind:'fact'},receipts:[receipt('count-'+i)]})).memory);
 const facade=openContextProductFacade(f.path,{});t.after(()=>facade.close());const access={accessGenerations:accessDigest({ownerId:ns.ownerId,namespaces:{readSet:[ns]}}),check(){},envelope:work=>work()};
 const common={path:f.path,facade,authorize:()=>access,ownerCoverage:{policy:'recent-projects-v1',selectionRevision:'synthetic',requestedNamespaces:1,selectedNamespaces:1,omittedNamespaces:0}};
 const maintainer=openProductIndex({...common,maintenance:true});t.after(()=>maintainer.close());for(let i=0;i<30;i++)if(ok(maintainer.run('refreshContextIndex',{...refresh(),mode:'lexical'})).status==='complete')break;
 const reader=openProductIndex({...common,maintenance:false});t.after(()=>reader.close());const first=ok(reader.run('findCandidates',query({query:'ProtectedKeyword',limit:1})));assert.equal(first.coverage.byType.memory.eligible,30);assert.ok(first.nextCursor);
 const last=[...memories].sort((a,b)=>a.id.localeCompare(b.id)).at(-1);
 transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:last.id,reason:'purge',actionId:'cached-count'}));
 await t.test('cached counts',()=>assert.equal(reader.run('findCandidates',query({query:'ProtectedKeyword',limit:1,cursor:first.nextCursor})).ok,false,'cached_count_epoch'));
 transaction(db,()=>{for(const m of memories)writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:m.id,reason:'purge',actionId:m.id});});
 for(const term of ['ProtectedKeyword','AbsentKeyword'])await t.test(term,()=>{const result=ok(reader.run('findCandidates',query({query:term})));assert.deepEqual(result.items,[]);assert.equal(result.coverage.byType.memory.eligible,0,'product_filtered_counts');assert.equal(result.coverage.byType.memory.indexed,0);assert.equal(result.coverage.omitted.lexical,0);assert.equal(result.coverage.omitted.horizon,0);});
});

test('r2 receipt counts exclude a suppressed receipt outside the delivered prefix',async t=>{
 const f=safetyFixture(t);await f.migrate();const core=openMemoryCore({path:f.path}),db=f.connect();t.after(()=>{core.close();db.close();});
 const memory=ok(core.admit({namespace:ns,memory:{content:'Synthetic receipt count',kind:'fact'},receipts:[receipt('a'),receipt('b'),receipt('c')]})).memory;
 const target=db.prepare('SELECT id FROM receipts WHERE memory_id=? ORDER BY created_at DESC,id DESC LIMIT 1').get(memory.id).id;
 transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'receipt',key:target,reason:'privacy_erase',actionId:'count-receipt'}));
 assert.equal(ok(core.get({namespace:ns,memoryId:memory.id,receiptLimit:1})).memory.receiptCount,2,'receipt_count_gate');
 assert.equal(ok(core.list({namespace:ns})).memories[0].receiptCount,2);
});

test('r2 note usage refuses retained suppressed note contributions',async t=>{
 const f=safetyFixture(t,23);await f.migrate();const host=cardHost(),core=openMemoryCore({path:f.path,privateCards:host.options}),db=f.connect();t.after(()=>{core.close();db.close();});
 const source=ok(host.call(core,'submitSourceNote',{namespace:ns,actionId:'note',text:'ProtectedNoteBytes',occurredAt:null})).source;
 assert.ok(ok(host.call(core,'getPrivateCardUsage',{namespace:ns})).submittedNoteBytes>0);
 transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'submitted-note',key:source.sourceId,reason:'purge',actionId:'note-count'}));
 assert.equal(host.call(core,'getPrivateCardUsage',{namespace:ns}).ok,false,'note_usage_gate');
});

test('r2 Raw usage refuses retained suppressed Raw contributions',async t=>{
 const f=safetyFixture(t,33);await f.migrate();const db=f.connect(),host=cardHost();
 const core=openRawCaptureCore({path:f.path,privateCards:host.options,model:{contextWindow:8192,countTokens:()=>1,extract:()=>({items:[]})}},
  {mode:'raw-v1',port:localPlainPort(),sources:true,readPolicy:()=>({generation:'synthetic',reason:null})});t.after(()=>{core.close();db.close();});
 const raw=ok(await core.captureRaw(request(splitRaw('ProtectedRawUsage')[0],{namespace:ns,client:'codex',sessionId:'usage',eventId:'usage'})));
 assert.ok(ok(core.getRawUsage({ownerId:ns.ownerId})).savedBytes>0);
 const part=db.prepare('SELECT message_id,start,end FROM raw_parts WHERE conversation_id=? AND saved=1 LIMIT 1').get(raw.raw.conversationId);
 transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'raw',key:raw.raw.conversationId,matchMode:'span',messageId:part.message_id,start:part.start,end:part.end,reason:'privacy_erase',actionId:'raw-span-metadata'}));
 await t.test('span metadata',()=>{const result=core.listRawConversations({namespace:ns,client:'codex'});assert.equal(result.ok,false,'raw_span_metadata_gate');assert.doesNotMatch(JSON.stringify(result),new RegExp(raw.raw.conversationId));});
 transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'raw',key:raw.raw.conversationId,reason:'purge',actionId:'raw-usage'}));
 assert.equal(core.getRawUsage({ownerId:ns.ownerId}).ok,false,'raw_usage_gate');
});


test('r2 method reason identities: retained suppressed Memory refs never leave metadata',async t=>{
 const f=safetyFixture(t,33);await f.migrate();const db=f.connect(),port=authority();
 const core=openMemoryCore({path:f.path,methodPackages:{version:'method-packages-local-v1',storage:'local-plain-v1',authority:port}});t.after(()=>{core.close();db.close();});
 const memory=ok(core.admit({namespace:ns,memory:{content:'ProtectedReasonMemory',kind:'fact'},receipts:[receipt('reason')]})).memory;
 const input={namespace:ns,reasonRefs:[{type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision}]};
 assert.equal(ok(core.checkMethodReasonRefs(input,{})).reasonRefs[0].status,'available');
 transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:memory.id,reason:'purge',actionId:'reason'}));
 const response=core.checkMethodReasonRefs(input,{});assert.equal(response.ok,false,'method_reason_identity_gate');assert.doesNotMatch(JSON.stringify(response),new RegExp(memory.id+'|ProtectedReasonMemory'));
});


test('r2 namespace boundary preserves another namespace',async t=>{
 const f=safetyFixture(t);await f.migrate();const db=f.connect(),core=openMemoryCore({path:f.path});t.after(()=>{core.close();db.close();});
 const other={...ns,scope:'project',projectId:'independent'};
 const memory=ok(core.admit({namespace:other,memory:{content:'Synthetic independent namespace',kind:'fact'},receipts:[receipt('other')]})).memory;
 transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'namespace',matchMode:'namespace',reason:'privacy_erase',actionId:'namespace'}));
 assert.equal(ok(core.get({namespace:other,memoryId:memory.id})).memory.id,memory.id);
 refused(core.list({namespace:ns}));
});


test('r2 evidence selection never counts or cursors a suppressed retained identity',async t=>{
 const f=safetyFixture(t,23);await f.migrate();const db=f.connect(),host=cardHost(),core=openMemoryCore({path:f.path,privateCards:host.options});t.after(()=>{core.close();db.close();});
 const memory=ok(core.admit({namespace:ns,memory:{content:'ProtectedSelectionCount',kind:'fact'},receipts:[receipt('select-count')]})).memory;
 const input={namespace:ns,types:['memory'],intent:'history',query:'ProtectedSelectionCount'};
 assert.equal(ok(host.call(core,'selectEvidence',input)).items.length,1);
 transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:memory.id,reason:'purge',actionId:'select-count'}));
 const result=host.call(core,'selectEvidence',input);assert.equal(result.ok,false,'evidence_selection_count_gate');assert.doesNotMatch(JSON.stringify(result),new RegExp(memory.id+'|ProtectedSelectionCount|scannedRows'));
});


for(const type of ['memory','card'])test(`r2 ${type} map never counts retained suppressed identities`,async t=>{
 const f=safetyFixture(t,type==='memory'?18:23);await f.migrate();const db=f.connect(),host=cardHost(),core=openMemoryCore({path:f.path,model:{countTokens:()=>1},...(type==='card'?{privateCards:host.options}:{})});t.after(()=>{core.close();db.close();});
 let id;
 if(type==='memory')id=ok(core.admit({namespace:ns,memory:{content:'ProtectedMapCount',kind:'fact'},receipts:[receipt('map-count')]})).memory.id;
 else {
  const draft=ok(host.call(core,'createCardDraft',{namespace:ns,actionId:'map-draft',drafting:'authored',input:{title:'ProtectedMapCount',body:'ProtectedMapBody',authoredInput:{text:'Synthetic support',occurredAt:null}}}));
  id=ok(host.call(core,'confirmCardDraft',{namespace:ns,cardId:draft.id,expectedRevision:draft.revision,actionId:'map-confirm',applicability:'current'})).id;
 }
 const map=()=>type==='memory'?core.map({namespace:ns}):host.call(core,'mapEvidence',{namespace:ns,type:'card'});
 assert.equal(map().ok,true);if(type==='memory')assert.match(JSON.stringify(map()),/ProtectedMapCount/);
 transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:type,key:id,reason:'purge',actionId:'map-count'}));
 const result=map();assert.equal(result.ok,false,type+'_map_count_gate');assert.doesNotMatch(JSON.stringify(result),new RegExp(id+'|ProtectedMapCount|scanned'));
});


for(const mode of ['related identity','owner callback'])test(`r2 role counter rechecks ${mode} before dispatching retained guidance`,async t=>{
 const f=safetyFixture(t,33);await f.migrate();const db=f.connect(),port=authority();let armed=false,calls=0,leaked=false;
 const counter={id:'synthetic',countTokens(text){calls++;if(mode==='related identity'&&text.includes('ProtectedRoleGuidance'))leaked=true;if(armed){armed=false;erased(db);}return 1;}};
 const core=openMemoryCore({path:f.path,methodPackages:{version:'method-packages-local-v1',storage:'local-plain-v1',authority:port},
  roleProfiles:{version:'role-profiles-local-v1',storage:'local-plain-v1',authority:port,attribution:{actorId:'synthetic',agentId:'synthetic'}},
  contextRead:{version:'context-read-v1',authority:port,counter}});t.after(()=>{core.close();db.close();});
 const memory=ok(core.admit({namespace:ns,memory:{content:'Synthetic related Memory',kind:'fact'},receipts:[receipt('role-related')]})).memory;
 const fields={duties:['ProtectedRoleGuidance'],requiredOutputs:['Synthetic report'],related:[{type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision}]};
 ok(core.publishRoleProfileRelease(publish(ns,'finance','role',null,null,fields),{}));
 assert.match(JSON.stringify(ok(core.readRoleTaskContext(roleRead('finance',[ns]),{}))),/ProtectedRoleGuidance/);
 calls=0;leaked=false;
 if(mode==='related identity')transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:memory.id,reason:'purge',actionId:'role-related'}));else armed=true;
 const result=core.readRoleTaskContext(roleRead('finance',[ns]),{});
 if(mode==='related identity'){assert.equal(leaked,false,'role_related_port_gate');assert.doesNotMatch(JSON.stringify(result),/ProtectedRoleGuidance/);}
 else {assert.equal(result.ok,false,'role_owner_delivery_gate');assert.equal(calls,1,'role_counter_revalidation');}
});


for(const mode of ['conflict endpoint','transition endpoint','transition receipt'])test(`r2 review metadata checks every ${mode} before pagination`,async t=>{
 const f=safetyFixture(t);await f.migrate();const db=f.connect(),core=openMemoryCore({path:f.path,decisionReview:'required-v1'});t.after(()=>{core.close();db.close();});
 const add=label=>ok(core.admit({namespace:ns,memory:{content:'Synthetic review '+label,kind:'fact'},receipts:[receipt(label)]})).memory;
 const a=add('left'),b=add('right'),receipts=id=>db.prepare('SELECT id FROM receipts WHERE memory_id=?').all(id).map(r=>r.id);
 transaction(db,()=>{if(mode==='conflict endpoint')db.prepare("INSERT INTO confirmation_conflicts(memory_id,memory_revision,target_id,target_revision,source) VALUES(?,?,?,?,?)").run(a.id,a.revision,b.id,b.revision,'synthetic');
  else db.prepare("INSERT INTO confirmation_supersessions VALUES(?,?,?,?,?,?,?,'dropped',?)").run(a.id,a.revision,b.id,b.revision,JSON.stringify(receipts(b.id)),db.prepare('SELECT fingerprint FROM memories WHERE id=?').get(a.id).fingerprint,JSON.stringify(receipts(a.id)),JSON.stringify({status:'dropped',reason:'synthetic'}));
 });
 const read=()=>mode==='conflict endpoint'?core.listReviewConflicts({namespace:ns,limit:1}):core.listReviewTransitions({namespace:ns,status:'all',limit:1});
 assert.equal(read().ok,true);
 transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:mode==='transition receipt'?'receipt':'memory',key:mode==='transition receipt'?receipts(b.id)[0]:b.id,reason:'privacy_erase',actionId:'review'}));
 const result=read();assert.equal(result.ok,false,'review_'+mode+'_gate');assert.doesNotMatch(JSON.stringify(result),new RegExp(a.id+'|'+b.id+'|targetId|exhausted'));
});


test('r2 stale placement binds its recorded Memory version rather than the current row',async t=>{
 const f=safetyFixture(t);await f.migrate();const db=f.connect(),core=openMemoryCore({path:f.path,model:{countTokens:()=>1}});t.after(()=>{core.close();db.close();});
 const memory=ok(core.admit({namespace:ns,memory:{content:'Synthetic versioned placement',kind:'fact'},receipts:[receipt('versioned-placement')]})).memory;
 ok(core.applyPlacement({namespace:ns,expectedIndexRevision:ok(core.map({namespace:ns})).indexRevision,expectedMemoryRevisions:[{memoryId:memory.id,revision:memory.revision}],proposal:{items:[{memoryId:memory.id,parentIds:[],newL1:{title:'Synthetic placement',parentL2Ids:[]}}]}}));
 const bound=db.prepare('SELECT memory_revision FROM moc_memory_refs WHERE memory_id=?').get(memory.id).memory_revision;
 transaction(db,()=>{db.prepare('UPDATE memories SET revision=? WHERE id=?').run(bound+3,memory.id);writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:memory.id,matchMode:'revision-through',sourceVersion:JSON.stringify(['memory-revision-through-v1',bound]),reason:'correction_supersession',actionId:'old-placement'});});
 assert.equal(core.get({namespace:ns,memoryId:memory.id}).ok,true);
 const result=core.map({namespace:ns});assert.equal(result.ok,false,'stale_placement_version_gate');assert.doesNotMatch(JSON.stringify(result),new RegExp(memory.id+'|invalidRefs'));
});


for(const mode of ['owner','identity'])test(`r2 counter retry never redispatches retained text after ${mode} suppression`,async t=>{
 const f=safetyFixture(t);await f.migrate();const db=f.connect();let target,secret,armed=false,dispatches=0;
 const model={countTokens(text){if(armed&&text.includes(secret)){dispatches++;if(dispatches===1){transaction(db,()=>mode==='owner'?suppressOwnerInside(db,{ownerId:ns.ownerId,reason:'account_erasure',actionId:'counter'}):writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:target.id,reason:'purge',actionId:'counter'}));return 5000;}}return 1;}};
 const core=openMemoryCore({path:f.path,model});t.after(()=>{core.close();db.close();});
 const rows=['one','two'].map(label=>{const content='ProtectedCounter '+label;return {...ok(core.admit({namespace:ns,memory:{content,kind:'fact'},receipts:[receipt('counter-'+label)]})).memory,content};}).sort((a,b)=>a.id.localeCompare(b.id));
 target=rows[0];secret=target.content;armed=true;
 const result=core.map({namespace:ns,tokenBudget:100});assert.equal(result.ok,false);assert.equal(dispatches,1,'counter_retry_'+mode+'_gate');
});


test('r2 model input counter checks canonical freshness before retained text dispatch',async t=>{
 const f=safetyFixture(t);await f.migrate();const db=f.connect(),core=openMemoryCore({path:f.path});t.after(()=>{core.close();db.close();});
 const memory=ok(core.admit({namespace:ns,memory:{content:'ProtectedModelCounter',kind:'fact'},receipts:[receipt('model-counter')]})).memory;
 const content=ok(core.get({namespace:ns,memoryId:memory.id})).memory.content;
 transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:memory.id,reason:'purge',actionId:'model-counter'}));
 let counters=0,models=0;
 await assert.rejects(()=>callModel({contextWindow:8192,countTokens(){counters++;return 1;},extract(){models++;return{};}},'extract','Synthetic system',{content},
  {validateFresh(){if(!core.get({namespace:ns,memoryId:memory.id}).ok)throw new MemoryStoreError('evidence_unavailable');}}),{code:'evidence_unavailable'});
 assert.equal(counters,0,'model_input_counter_gate');assert.equal(models,0);
});
