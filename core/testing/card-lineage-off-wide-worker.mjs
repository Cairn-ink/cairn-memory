// The same synthetic workload runs in isolated children against both trees.
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
let uuid=0,random=0;
crypto.randomUUID=()=>`00000000-0000-4000-8000-${String(++uuid).padStart(12,'0')}`;
crypto.randomBytes=n=>Buffer.alloc(n,++random);
syncBuiltinESMExports();
const NativeDate=Date;
globalThis.Date=class extends NativeDate {constructor(...args){super(...(args.length?args:['2026-01-01T00:00:00.000Z']));}static now(){return 1767225600000;}};
Object.defineProperty(performance,'now',{value:()=>0,configurable:true});
const source=process.argv[2],path=process.argv[3],mode=process.argv[4];
const cell=Number(process.argv[5]),base=cell===52?23:cell===53?33:cell;
const {openDatabase}=await import(pathToFileURL(join(source,'core/database.mjs')));
const seed=openDatabase(path,base===23?{privateCards:true}:{currentDependencies:true});seed.close();
if(cell===52||cell===53) {
  const copied=spawnSync(process.execPath,['--input-type=module','-e',
    "import {copyFileSync} from 'node:fs';copyFileSync(process.argv[1],process.argv[2]);",path,path+'.backup'],{timeout:30000});
  if(copied.status!==0)throw Error('fixture_copy_failed');
  const {migrateReceiptEventTime}=await import(pathToFileURL(join(source,'core/content-safety-migration.mjs')));
  const db=new DatabaseSync(path),storeId=db.prepare('SELECT store_id FROM store_metadata').get().store_id;db.close();
  await migrateReceiptEventTime({path,backupPath:path+'.backup',expected:{storeId,base},
    quiescence:{admissionsClosed:true,writersStopped:true,readersDrained:true,oldHandlesClosed:true}});
}
const proof=new DatabaseSync(path);
try {
  if(proof.prepare('PRAGMA user_version').get().user_version!==cell ||
    (cell===52||cell===53)&&proof.prepare('SELECT card_lineage_revision FROM content_safety_control').get().card_lineage_revision!==0)
    throw Error('wrong_lineage_zero_fixture');
} finally {proof.close();}
const statements=[],prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;
DatabaseSync.prototype.prepare=function(sql){const statement=Reflect.apply(prepare,this,[sql]);for(const method of ['get','all','iterate','run']) {
  const fn=statement[method];statement[method]=function(...args){statements.push([sql.replace(/\s+/g,' ').trim(),method]);return Reflect.apply(fn,this,args);};
}return statement;};
DatabaseSync.prototype.exec=function(sql){statements.push([sql.replace(/\s+/g,' ').trim(),'exec']);return Reflect.apply(exec,this,[sql]);};
const calls=[];
if(mode==='open') {
  const db=openDatabase(path);calls.push(['open',true,statements.length]);db.close();
} else {
  const ns={ownerId:'synthetic-off-owner',scope:'personal',projectId:null};
  const authority={authorize(request,token){if(!token)return null;const {input,...grant}=request;return {...grant,accessGeneration:1};},isCurrent:grant=>grant};
  const modelCalls=[];
  const model={contextWindow:8192,countTokens:()=>1,
    extract:({input})=>{modelCalls.push(['extract',input.messages.length]);return {items:input.messages.map(message=>({
      content:message.content,kind:'fact',confidence:0.5,sourceIndices:[message.index]}))};},
    select:({input})=>({refs:input.maps.flatMap(map=>map.items.filter(item=>item.type==='unfiled').map(item=>({namespaceIndex:map.namespaceIndex,...item.ref})))}),
    rank:({input})=>({refs:input.candidates.slice(0,input.limit).map(candidate=>({namespaceIndex:candidate.namespaceIndex,memoryId:candidate.memory.id,revision:candidate.memory.revision}))})};
  const options={path,model,
    privateCards:{version:'private-cards-local-v1',source:'submitted-note-v1',storage:'local-plain-v1',disclosure:'explicit-submitted-note-v1',authority,
      currentDependencies:{version:'card-current-dependencies-v1'}},
    methodPackages:{version:'method-packages-local-v1',storage:'local-plain-v1',authority},
    roleProfiles:{version:'role-profiles-local-v1',storage:'local-plain-v1',authority,attribution:{actorId:'synthetic-human',agentId:'synthetic-agent'}},
    contextRead:{version:'context-read-v1',authority,counter:{id:'synthetic-exact',countTokens:()=>1}}};
  const {openMemoryCore}=await import(pathToFileURL(join(source,'core/index.mjs')));
  const core=openMemoryCore({...options,rawConversations:{mode:'raw-v1',capBytes:1000000,
    port:{version:'raw-seal-v1',async sealRaw({text}){return {format:'local-plain-v1',keyVersion:null,sealed:Buffer.from(text)};},
      async openRaw({sealed}){return {text:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(sealed)};}},
    readPolicy:()=>({generation:'synthetic',reason:null})}});
  calls.push(['open',true,statements.length]);
  const call=async(method,input,{error}={})=>{
    const start=statements.length;let result;
    try {result=await core[method](input,{});}catch(thrown){result={thrown:{name:thrown.name,code:thrown.code,message:thrown.message}};}
    calls.push([method,result,start,statements.length]);
    if(error ? result.error?.code!==error : !result.ok)throw Error(method+': '+JSON.stringify(result));
    return result.value;
  };
  const cardCall=(method,input,expect)=>call(method,{namespace:ns,...input},expect);
  const receipt=id=>({client:'synthetic',sessionId:'off-session',eventId:id,role:'user',excerpt:'Synthetic '+id});
  const draft=(actionId,input)=>cardCall('createCardDraft',{actionId,drafting:'authored',input:{title:'Synthetic title',body:'Synthetic body',...input}});
  const ref=card=>({type:'card',namespace:ns,cardId:card.id,revision:card.revision,bodyRevision:card.bodyRevision});
  const captureInput={namespace:ns,client:'synthetic',sessionId:'off-session',eventId:'off-capture',messages:[
    {id:'capture-one',role:'user',content:'Synthetic captured protocol preference.'},
    {id:'capture-two',role:'assistant',content:'Synthetic captured review procedure.'}]};
  const captured=await call('capture',captureInput);
  await call('capture',captureInput);
  const memories=(await call('list',{namespace:ns})).memories;
  if(memories.length!==2||!modelCalls.length)throw Error('capture must extract real Memories');
  await call('recall',{readSet:[ns],query:'Synthetic'});
  const sourceInput={actionId:'source',text:'Synthetic submitted source.',occurredAt:null};
  const note=(await cardCall('submitSourceNote',sourceInput)).source;
  await cardCall('submitSourceNote',sourceInput);
  await cardCall('submitSourceNote',{...sourceInput,text:'Synthetic changed source.'},{error:'action_conflict'});
  let card=await draft('note-card',{sources:[note]});
  card=await cardCall('editCardDraft',{actionId:'edit-draft',cardId:card.id,expectedRevision:card.revision,
    title:'Synthetic edited title',body:'Synthetic edited draft body',bindings:[note]});
  await cardCall('editCardDraft',{actionId:'stale-draft',cardId:card.id,expectedRevision:1,title:'Synthetic stale',body:'Synthetic stale',bindings:[note]},{error:'revision_conflict'});
  card=await cardCall('confirmCardDraft',{actionId:'confirm',cardId:card.id,expectedRevision:card.revision,applicability:'current'});
  card=await cardCall('editKnowledgeCard',{actionId:'edit-confirmed',cardId:card.id,expectedRevision:card.revision,
    title:'Synthetic final title',body:'Synthetic final body',bindings:[note],applicability:'current'});
  await cardCall('getCard',{cardId:card.id});await cardCall('listCards',{states:['draft','confirmed'],limit:1});
  await cardCall('getSource',{source:note});await cardCall('fetchEvidence',{refs:[ref(card)],intent:'current'});
  const own=await draft('own-card',{authoredInput:{text:'Synthetic own input',occurredAt:null}});
  let memoryCard=await draft('memory-card',{memoryRefs:[{type:'memory',namespace:ns,memoryId:memories[0].id,revision:memories[0].revision}],sourcePolicy:'retained-receipts-v1'});
  memoryCard=await cardCall('confirmCardDraft',{actionId:'confirm-memory',cardId:memoryCard.id,expectedRevision:memoryCard.revision,applicability:'current'});
  const mapped=await cardCall('mapEvidence',{type:'card'});
  const placement={actionId:'place',refs:[ref(card)],expectedIndexRevision:mapped.indexRevision,
    proposal:{items:[{cardId:card.id,parentIds:[],newL1:{title:'Synthetic topic',parentL2Ids:[],newL2Title:'Synthetic root'}}]}};
  const placed=await cardCall('applyCardPlacement',placement);await cardCall('applyCardPlacement',placement);
  const l1=placed.createdMocRefs.find(topic=>topic.level==='L1');
  const refreshed=await cardCall('refreshCardTopic',{actionId:'refresh-topic',topicRef:{mocId:l1.mocId,revision:l1.revision},
    expectedIndexRevision:(await cardCall('mapEvidence',{type:'card'})).indexRevision,title:'Synthetic refreshed topic',refs:[ref(card)]});
  const memoryIndex=await call('map',{namespace:ns});
  const memoryPlacement=await call('applyPlacement',{namespace:ns,expectedIndexRevision:memoryIndex.indexRevision,
    expectedMemoryRevisions:[{memoryId:memories[1].id,revision:memories[1].revision}],
    proposal:{items:[{memoryId:memories[1].id,parentIds:[],newL1:{title:'Synthetic Memory topic',parentL2Ids:[],newL2Title:'Synthetic Memory root'}}]}});
  const memoryTopic=memoryPlacement.createdMocs.find(topic=>topic.level==='L1');
  const pair={memoryTopic:{mocId:memoryTopic.id,revision:memoryTopic.revision},cardTopic:refreshed.topicRef,
    expectedMemoryIndexRevision:(await cardCall('mapEvidence',{type:'memory'})).indexRevision,
    expectedCardIndexRevision:(await cardCall('mapEvidence',{type:'card'})).indexRevision};
  const mapping=await cardCall('proposeEvidenceMapping',{actionId:'propose-mapping',...pair});
  await cardCall('reviewEvidenceMapping',{actionId:'activate-mapping',mappingId:mapping.id,expectedRevision:mapping.revision,state:'active',...pair});
  await cardCall('listEvidenceMappings',{type:'card',mocId:pair.cardTopic.mocId});
  await cardCall('mapEvidence',{type:'card'});
  await cardCall('selectEvidence',{query:'Synthetic',types:['card'],intent:'current'});
  const imported=await call('importMethodVersion',{namespace:ns,actionId:'method',title:'Synthetic method',files:[{path:'guide.txt',text:'Synthetic procedure',mediaType:'text/plain'}],
    change:{items:[],reasonRefs:[ref(memoryCard)]}});
  await call('checkMethodReasonRefs',{namespace:ns,reasonRefs:[ref(card)]});
  await call('getMethodVersion',{version:imported.version,intent:'history'});
  await call('adoptMethodVersion',{bindingNamespace:ns,package:imported.package,version:imported.version,readSet:[ns],roleId:null,expectedRevision:null,actionId:'adopt'});
  const context={readSet:[ns],roleId:null};
  const resolved=await call('resolveMethod',{...context,package:imported.package});
  await call('readMethodFile',{version:imported.version,intent:'history',path:'guide.txt'});
  const declaration={context,packages:[{package:imported.package,snapshot:resolved.snapshot}]};
  const dependencyInput={cardId:card.id,expectedRevision:card.revision,expectedDependencyRevision:null,actionId:'declare',currentDependencies:declaration};
  await cardCall('declareCardCurrentDependencies',dependencyInput);
  await cardCall('declareCardCurrentDependencies',dependencyInput);
  await cardCall('revalidateCardCurrentDependencies',{...dependencyInput,expectedDependencyRevision:1,actionId:'revalidate'});
  await call('publishRoleProfileRelease',{namespace:ns,roleKey:'reviewer',actionId:'profile',expectedCurrentRelease:null,expectedRegistryRevision:null,
    fields:{duties:['Synthetic review'],requiredOutputs:['Synthetic report'],methods:[imported.package],related:[ref(card)]}},
    cell===53?{error:'evidence_unavailable'}:{});
  const query={readSet:[ns],query:'Synthetic',types:['memory','card'],intent:'current',deadlineMs:5000};
  await call('refreshContextIndex',{readSet:[ns],types:['memory','card'],intent:'current',budget:{maxItems:1024,maxMs:5000}});
  await call('findCandidates',query);await call('contextRead',query);
  const role=await call('readRoleTaskContext',{mode:'now',readSet:[ns],roleKey:'reviewer',task:'Synthetic',deadlineMs:5000});
  await call('readRoleTaskContext',{mode:'then',readSet:[ns],receipt:role.metered.receipt});
  await call('readRoleTaskContext',{mode:'file',readSet:[ns],receipt:role.metered.receipt,package:imported.package,path:'guide.txt'},
    cell===53?{error:'invalid_input'}:{});
  const text='Synthetic retained Raw source.';
  const raw=await call('captureRaw',{namespace:ns,client:'claude-code',sessionId:'synthetic-raw',eventId:'raw-event',messages:[{
    id:'raw-message',role:'user',content:text,occurredAt:null,messageOrdinal:1,part:{index:0,start:0,totalUnits:text.length,totalBytes:Buffer.byteLength(text)}}]});
  const rawRevision=(await call('getConversation',{namespace:ns,conversationId:raw.raw.conversationId})).conversation.revision;
  const rawSource=(await cardCall('resolveSourceReferences',{anchors:[{rawAnchor:{conversationId:raw.raw.conversationId,messageId:'raw-message',start:0,end:8,precision:'exact'},expectedConversationRevision:rawRevision}]})).sources[0];
  const rawCard=await draft('raw-card',{sources:[rawSource]});
  await cardCall('confirmCardDraft',{actionId:'confirm-raw',cardId:rawCard.id,expectedRevision:rawCard.revision,applicability:'current'});
  await cardCall('getSource',{source:rawSource});
  await call('setRawCaptureControl',{ownerId:ns.ownerId,client:'claude-code',expectedRevision:0,enabled:false});
  await call('setRawCaptureControl',{ownerId:ns.ownerId,client:'claude-code',expectedRevision:1,enabled:true});
  const deletion={namespace:ns,conversationId:raw.raw.conversationId,expectedRevision:rawRevision,actionId:'delete-raw'};
  await call('deleteConversation',deletion);await call('deleteConversation',deletion);
  await cardCall('getCard',{cardId:rawCard.id});
  await call('correct',{namespace:ns,memoryId:memories[0].id,expectedRevision:memories[0].revision,content:'Synthetic corrected protocol',kind:'fact',receipt:receipt('correction')});
  await cardCall('getCard',{cardId:memoryCard.id});
  const historic=(await call('get',{namespace:ns,memoryId:memories[1].id})).memory;
  await call('supersede',{namespace:ns,memoryId:historic.id,expectedRevision:historic.revision,
    replacement:{content:'Synthetic replacement procedure',kind:'fact'},receipts:[receipt('replacement')]});
  await call('forget',{namespace:ns,memoryId:memories[0].id,expectedRevision:memories[0].revision},{error:'revision_conflict'});
  const corrected=(await call('get',{namespace:ns,memoryId:memories[0].id})).memory;
  // Preserve the archived suppression guard's refusal for an already-denied
  // dependent, while also comparing a successful independent source forget.
  await call('forget',{namespace:ns,memoryId:corrected.id,expectedRevision:corrected.revision},
    cell===53?{error:'evidence_unavailable'}:{});
  const independent=(await call('admit',{namespace:ns,memory:{content:'Synthetic independent forget target',kind:'fact'},receipts:[receipt('independent')]})).memory;
  await call('forget',{namespace:ns,memoryId:independent.id,expectedRevision:independent.revision});
  const terminalNote=(await cardCall('submitSourceNote',{actionId:'terminal-source',text:'Synthetic terminal source',occurredAt:null})).source;
  const terminalDraft=await draft('terminal-draft',{sources:[terminalNote]});
  const terminalConfirmed=await draft('terminal-confirmed',{sources:[terminalNote]});
  await cardCall('confirmCardDraft',{actionId:'confirm-terminal',cardId:terminalConfirmed.id,expectedRevision:terminalConfirmed.revision,applicability:'current'});
  await cardCall('deleteSourceNote',{actionId:'delete-terminal-source',sourceId:terminalNote.sourceId,expectedRevision:terminalNote.revision});
  await cardCall('getCard',{cardId:terminalDraft.id});await cardCall('getCard',{cardId:terminalConfirmed.id});
  await cardCall('cancelCardDraft',{actionId:'cancel-own',cardId:own.id,expectedRevision:own.revision});
  await cardCall('deleteKnowledgeCard',{actionId:'delete-card',cardId:card.id,expectedRevision:card.revision});
  await call('checkMethodReasonRefs',{namespace:ns,reasonRefs:[ref(card)]},cell===53?{error:'evidence_unavailable'}:{});
  await cardCall('deleteSourceNote',{actionId:'delete-note',sourceId:note.sourceId,expectedRevision:note.revision});
  await cardCall('listCardEffects',{limit:50},cell===53?{error:'evidence_unavailable'}:{});await cardCall('getPrivateCardUsage',{});
  await call('recall',{readSet:[ns],query:'Synthetic'});
  calls.push(['modelCalls',modelCalls]);
  core.close();
}
DatabaseSync.prototype.prepare=prepare;DatabaseSync.prototype.exec=exec;
const db=new DatabaseSync(path);
try {
  const dump=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(({name})=>[
    name,db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all().map(row=>JSON.stringify(row)).sort()]);
  // JavaScript UUIDs above are controlled before execution. SQLite's trigger
  // randomblob IDs are independent: alpha-bind only those opaque effect IDs
  // to their full causal row. No SQL, semantic field or database byte changes.
  const effects=dump.find(([name])=>name==='card_effects')[1].map(row=>JSON.parse(row)),ids=new Map();
  for(const row of effects)if(/^[0-9a-f]{32}$/.test(row.effect_id)) {
    assert.equal(row.kind,'evidence_invalidated');assert.equal(row.entity_type,'card');
    assert.ok(row.action_id==='delete-raw'||row.action_id.startsWith('memory-revision-'));
    const {effect_id,...cause}=row;
    ids.set(effect_id,crypto.createHash('sha256').update(JSON.stringify(['synthetic-sql-effect-v1',cause])).digest('hex').slice(0,32));
  }
  assert.equal(new Set(ids.values()).size,ids.size);
  function bindEffects(value) {
    if(!value||typeof value!=='object')return;
    if(typeof value.effectId==='string'&&ids.has(value.effectId))value.effectId=ids.get(value.effectId);
    for(const child of Object.values(value))bindEffects(child);
  }
  bindEffects(calls);
  for(const row of effects)if(ids.has(row.effect_id))row.effect_id=ids.get(row.effect_id);
  dump.find(([name])=>name==='card_effects')[1]=effects.map(row=>JSON.stringify(row)).sort();
  const record=JSON.stringify({calls,statements,dump});
  for(const id of ids.keys())assert.equal(record.includes(id),false,'unhandled random effect reference');
  process.stdout.write(record);
} finally {db.close();}
