// The same synthetic workload runs in isolated children against both trees.
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { statements,effectWitnesses,startTrace,stopTrace } from './card-lineage-off-wide-controls.mjs';
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
let identity;
try {
  if(proof.prepare('PRAGMA user_version').get().user_version!==cell ||
    (cell===52||cell===53)&&proof.prepare('SELECT card_lineage_revision FROM content_safety_control').get().card_lineage_revision!==0)
    throw Error('wrong_lineage_zero_fixture');
  identity={storeId:proof.prepare('SELECT store_id FROM store_metadata').get().store_id,
    suppressionDomain:cell>=52?proof.prepare('SELECT suppression_domain FROM content_safety_control').get().suppression_domain:'00000000-0000-4000-8000-000000000000'};
} finally {proof.close();}
startTrace();
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
      ...(base===33?{currentDependencies:{version:'card-current-dependencies-v1'}}:{})},
    ...(base===33?{
    methodPackages:{version:'method-packages-local-v1',storage:'local-plain-v1',authority},
    assets:{version:'assets-local-v1',storage:'sqlite-blob-v1',authority},
    roleProfiles:{version:'role-profiles-local-v1',storage:'local-plain-v1',authority,attribution:{actorId:'synthetic-human',agentId:'synthetic-agent'}},
    }:{}),
    contextRead:{version:'context-read-v1',authority,counter:{id:'synthetic-exact',countTokens:()=>1}}};
  const api=await import(pathToFileURL(join(source,'core/index.mjs')));
  const rawOptions={mode:'raw-v1',capBytes:1000000,
    port:{version:'raw-seal-v1',async sealRaw({text}){return {format:'local-plain-v1',keyVersion:null,sealed:Buffer.from(text)};},
      async openRaw({sealed}){return {text:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(sealed)};}},
    readPolicy:()=>({generation:'synthetic',reason:null})};
  const core=api.openMemoryCore({...options,...(base===33?{rawConversations:rawOptions}:{})});
  calls.push(['open',true,statements.length]);
  const call=async(method,input,{error}={})=>{
    const start=statements.length;let result;
    try {result=await core[method](input,{});}catch(thrown){result={thrown:{name:thrown.name,code:thrown.code,message:thrown.message}};}
    calls.push([method,result,start,statements.length]);
    if(error ? result.error?.code!==error : !result.ok)throw Error(method+': '+JSON.stringify(result));
    return result.value;
  };
  const cardCall=(method,input,expect)=>call(method,{namespace:ns,...input},expect);
  const pages=async(method,input,key,invoke=call)=>{
    const values=[];let cursor,count=0;
    do {
      assert.ok(++count<=100,method+' terminates');
      const value=await invoke(method,{...input,...(cursor?{cursor}:{})});
      if(Array.isArray(value[key]))values.push(...value[key]);else values.push(value[key]);
      cursor=value.nextCursor;
    }while(cursor);
    assert.ok(count>1,method+' exercises a continuation');
    return values;
  };
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
  await cardCall('getCard',{cardId:card.id});
  assert.equal((await cardCall('inspectCardOperation',{operationActionId:'edit-confirmed'})).operation.actionId,'edit-confirmed');
  await cardCall('inspectCardOperation',{operationActionId:'synthetic-missing-operation'});
  await cardCall('getSource',{source:note});
  const evidence=await cardCall('fetchEvidence',{refs:[ref(card)],intent:'current'});
  await cardCall('revalidateEvidence',{snapshot:evidence.snapshot});
  const own=await draft('own-card',{authoredInput:{text:'Synthetic own input',occurredAt:null}});
  let memoryCard=await draft('memory-card',{memoryRefs:[{type:'memory',namespace:ns,memoryId:memories[0].id,revision:memories[0].revision}],sourcePolicy:'retained-receipts-v1'});
  memoryCard=await cardCall('confirmCardDraft',{actionId:'confirm-memory',cardId:memoryCard.id,expectedRevision:memoryCard.revision,applicability:'current'});
  await pages('listCards',{namespace:ns,states:['draft','confirmed'],limit:1},'cards');
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
  let imported;
  if(base===33) {
  imported=await call('importMethodVersion',{namespace:ns,actionId:'method',title:'Synthetic method',files:[{path:'guide.txt',text:'Synthetic procedure',mediaType:'text/plain'}],
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
  }
  const query={readSet:[ns],query:'Synthetic',types:['memory','card'],intent:'current',deadlineMs:5000};
  await call('refreshContextIndex',{readSet:[ns],types:['memory','card'],intent:'current',budget:{maxItems:1024,maxMs:5000}});
  await call('findCandidates',query);
  const assembled=await call('contextRead',query);
  await call('fetchCandidateEvidence',{readSet:[ns],refs:[ref(memoryCard)],intent:'current'});
  await call('fetchCandidateEvidence',{readSet:[ns],snapshot:assembled.snapshot});
  if(base===33) {
  const role=await call('readRoleTaskContext',{mode:'now',readSet:[ns],roleKey:'reviewer',task:'Synthetic',deadlineMs:5000});
  await call('readRoleTaskContext',{mode:'then',readSet:[ns],receipt:role.metered.receipt});
  await call('readRoleTaskContext',{mode:'file',readSet:[ns],receipt:role.metered.receipt,package:imported.package,path:'guide.txt'},
    cell===53?{error:'invalid_input'}:{});
  await methodWorkload();
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
  await directOpeners({raw});
  const deletion={namespace:ns,conversationId:raw.raw.conversationId,expectedRevision:rawRevision,actionId:'delete-raw'};
  await call('deleteConversation',deletion);await call('deleteConversation',deletion);
  await cardCall('getCard',{cardId:rawCard.id});
  } else await directOpeners({});
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
    cell>=52?{error:'evidence_unavailable'}:{});
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
  if(base===33) {
    await call('checkMethodReasonRefs',{namespace:ns,reasonRefs:[ref(card)]},cell===53?{error:'evidence_unavailable'}:{});
  }
  await cardCall('deleteSourceNote',{actionId:'delete-note',sourceId:note.sourceId,expectedRevision:note.revision});
  await cardCall('listCardEffects',{limit:50},cell>=52?{error:'evidence_unavailable'}:{});await cardCall('getPrivateCardUsage',{});
  await call('recall',{readSet:[ns],query:'Synthetic'});
  calls.push(['modelCalls',modelCalls]);
  core.close();

  async function methodWorkload() {
    // Separate live reasons keep successful serving covered on family 53 too.
    const files=Array.from({length:23},(_,i)=>({path:'step-'+String(i).padStart(2,'0')+'.txt',text:'Synthetic step '+i,mediaType:'text/plain'}));
    const first=await call('importMethodVersion',{namespace:ns,actionId:'method-extra',title:'Synthetic extra method',files,
      change:{items:[],reasonRefs:[ref(memoryCard)]}});
    const second=await call('importMethodVersion',{namespace:ns,actionId:'method-extra-v2',title:'Synthetic extra method',
      package:first.package,expectedPackageRevision:1,basedOn:first.version,files:files.map(file=>({...file,text:file.text+' revised'})),
      change:{items:[{summary:'Synthetic update',paths:[files[0].path]}],reasonRefs:[ref(memoryCard)]}});
    const pdf=Buffer.alloc(33000,0x61);pdf.set(Buffer.from('%PDF-1.7'));
    const mixed=await call('importMethodVersion',{namespace:ns,actionId:'mixed-method',title:'Synthetic attachment method',manifestFormat:'mixed-v1',
      files:[{kind:'text',path:'guide.txt',text:'Synthetic attachment guide',mediaType:'text/plain'},
        {kind:'binary',path:'reference.pdf',bytes:pdf,mediaType:'application/pdf'}],change:{items:[],reasonRefs:[ref(memoryCard)]}});
    await pages('listMethodManifest',{version:first.version,intent:'history'},'files');
    await pages('listMethodPackages',{namespace:ns,limit:1},'packages');
    await pages('listMethodVersions',{package:first.package,limit:1},'versions');
    await pages('compareMethodVersions',{from:first.version,to:second.version},'changes');
    for(const receipt of [first,mixed])await call('adoptMethodVersion',{bindingNamespace:ns,package:receipt.package,version:receipt.version,
      readSet:[ns],roleId:'synthetic-reader',expectedRevision:null,actionId:'adopt-extra-'+receipt.package.packageId});
    await pages('resolveMethodsForRole',{readSet:[ns],roleId:'synthetic-reader',limit:1},'methods');
    const disable={bindingNamespace:ns,package:first.package,readSet:[ns],roleId:'synthetic-reader',expectedRevision:1,actionId:'disable-extra'};
    await call('disableMethodBinding',disable);await call('disableMethodBinding',disable);
    await pages('listMethodBindingEvents',{bindingNamespace:ns,package:first.package,limit:1},'events');
    const chunks=await pages('readMethodAttachmentBytes',{version:mixed.version,intent:'history',path:'reference.pdf'},'bytes');
    assert.deepEqual(Buffer.concat(chunks.map(chunk=>Buffer.from(chunk,'base64'))),pdf,'exact attachment bytes');
    const deletion={actionId:'delete-extra-version',ref:first.version,expectedRevision:1};
    await call('deleteMethodVersion',deletion);await call('deleteMethodVersion',deletion);
    const removal={actionId:'delete-extra-package',ref:first.package,expectedRevision:3};
    await call('deleteMethodPackage',removal);await call('deleteMethodPackage',removal);
    await pages('listMethodEffects',{namespace:ns,limit:1},'effects');
    assert.ok((await call('getMethodPackageUsage',{namespace:ns})).retainedFileBytes>0);
    await call('listMethodManifest',{version:first.version,intent:'history'});
  }

  async function directOpeners({raw}) {
    if(base===33){
      let complete=false;
      for(let i=0;i<100;i++)if((await call('refreshContextIndex',{readSet:[ns],types:['memory','card'],intent:'current',
        budget:{maxItems:1024,maxMs:5000}})).status==='complete'){complete=true;break;}
      assert.ok(complete,'Raw capture and method changes are indexed before direct reads');
    }
    const invoke=async(name,work,{error}={})=>{
      const start=statements.length;let result;
      try{result=await work();}catch(thrown){result={thrown:{name:thrown.name,code:thrown.code,message:thrown.message}};}
      calls.push([name,result,start,statements.length]);
      if(error)assert.equal(result.thrown?.code??result.error?.code,error,name);
      else assert.equal(result.ok,true,name+': '+JSON.stringify(result));
      return result.value;
    };
    const open=async(name,options,expect)=>{
      let handle;
      await invoke(name,async()=>{handle=await api[name](options);return {ok:true};},expect);
      return handle;
    };
    const on=(name,handle)=>async(method,input)=>invoke(name+'.'+method,()=>handle[method](input,{}));
    const reader=await open('openMemoryReader',{path,ownerId:ns.ownerId});
    try{await pages('readTopicOverview',{namespace:ns,nodeLimit:1},'items',on('openMemoryReader',reader));}
    finally{await reader.close();}
    const context=await open('openContextReader',{path,contextRead:options.contextRead});
    try{
      const read=on('openContextReader',context);
      await read('findCandidates',query);
      const value=await read('contextRead',query);
      await read('fetchCandidateEvidence',{readSet:[ns],snapshot:value.snapshot});
      await read('fetchCandidateEvidence',{readSet:[ns],refs:[ref(memoryCard)],intent:'current'});
    }finally{await context.close();}

    const {credentialDigest,PRODUCT_PROFILE}=await import(pathToFileURL(join(source,'core/context-product-control.mjs')));
    const coverage={policy:'recent-projects-v1',selectionRevision:'synthetic',requestedNamespaces:1,selectedNamespaces:1,omittedNamespaces:0};
    const credential={opaque:'synthetic-product-credential'};
    const service={kind:'service',serviceId:'synthetic-service',credentialBindingId:'synthetic-binding',credentialExpiresUtcMs:null,
      credentialDigest:credentialDigest(credential),ownerId:ns.ownerId,namespaces:{readSet:[ns],ownerCoverage:coverage},issuedAt:0};
    const supervisor=api.createContextReadSupervisor();
    try{
      const common={supervisor,path,version:'context-read-v1',profile:PRODUCT_PROFILE,readSet:[ns],ownerCoverage:coverage,
        host:{moduleUrl:new URL('./card-lineage-off-wide-controls.mjs',import.meta.url).href,configuration:{serviceBinding:service}}};
      const maintainer=await open('openContextIndexMaintainer',{...common,sidecarJournalMode:'DELETE'});
      try{
        const maintain=async(method,input)=>invoke('openContextIndexMaintainer.'+method,()=>maintainer[method](input,credential));
        const status=await maintain('getContextIndexStatus',{readSet:[ns],types:['memory','card'],intent:'current'});
        assert.equal(status.lexical.state,'absent');
      }finally{await maintainer.close();}
      const ids={requestId:'synthetic-request',handleId:'synthetic-handle',credentialBindingId:'synthetic-request-binding',credentialExpiresUtcMs:null};
      const binding={...service,kind:'request',...ids};delete binding.serviceId;
      const product=await open('openContextProductReader',{...common,requestControl:{...ids,requestMaxMs:5000},
        host:{moduleUrl:common.host.moduleUrl,configuration:{requestBinding:binding,requestReservation:new SharedArrayBuffer(4)}}});
      try{
        const read=async(method,input)=>invoke('openContextProductReader.'+method,()=>product[method](input,credential));
        const status=await read('getContextIndexStatus',{readSet:[ns],types:['memory','card'],intent:'current'});
        assert.equal(status.lexical.state,'absent');
        await read('fetchCandidateEvidence',{readSet:[ns],refs:[ref(memoryCard)],intent:'current'});
      }finally{await product.close();}
    }finally{await supervisor.close();}

    const suppression={version:'content-suppression-grant-v1',expected:identity,scope:{kind:'owner'},
      permissions:{reconcile:true,erasureReconciliation:false},accessGeneration:1};
    const {suppressionServiceIssuance}=await import(pathToFileURL(join(source,'core/context-product-service.mjs')));
    const suppressionBinding=suppressionServiceIssuance(service,suppression);
    const pull=await open('openContentSuppressionReader',{version:'content-suppression-read-v1',path,expected:identity,
      serviceBinding:service,suppression,host:{authorize:()=>suppressionBinding,isCurrent:()=>true},requestMaxMs:5000},
      cell<52?{error:'unsupported_database'}:{});
    if(pull)try{
      const descriptors=[];
      // Explicit admission supplies independent retained origins on Raw
      // families too; ordinary extraction can retain an unknown origin.
      for(let i=0;i<2;i++){
        const current=(await call('admit',{namespace:ns,memory:{content:'Synthetic suppression probe '+i,kind:'fact'},
          receipts:[receipt('suppression-'+i)]})).memory;
        descriptors.push({kind:'memory',...identity,namespace:ns,key:current.id,incarnation:current.id,boundRevision:current.revision,ancestors:[]});
      }
      const cardDescriptor={kind:'card',...identity,namespace:ns,key:card.id,incarnation:card.id,boundRevision:card.revision,bodyRevision:card.bodyRevision,
        ancestors:[{kind:'submitted-note',...identity,namespace:ns,key:note.sourceId,incarnation:note.sourceId,boundRevision:note.revision,
          contentIdentity:note.contentIdentity,ancestors:[]}]};
      const read=async(method,input)=>invoke(method,()=>pull[method](ns.ownerId,descriptors,input,credential));
      const results=await pages('isSuppressed',{expected:{owner:ns.ownerId,...identity,epoch:'0'},limit:1},'results',read);
      assert.equal(results.length,descriptors.length);assert.ok(results.every(result=>!result.suppressed));
      // Revision zero cannot establish a negative Card answer, even with its
      // complete submitted-note closure. Preserve that archived refusal too.
      await invoke('isSuppressed',()=>pull.isSuppressed(ns.ownerId,[cardDescriptor],{expected:{owner:ns.ownerId,...identity,epoch:'0'}},credential),
        {error:'evidence_unavailable'});
    }finally{await pull.close();}
    if(base===33){
      const {openRawCaptureCore}=await import(pathToFileURL(join(source,'core/raw-capture.mjs')));
      const {contextRead,...rawCoreOptions}=options;
      let rawCore;
      await invoke('openRawCaptureCore',()=>{rawCore=openRawCaptureCore(rawCoreOptions,{...rawOptions,sources:true});return {ok:true};});
      try{
        const read=on('openRawCaptureCore',rawCore);
        await read('getConversation',{namespace:ns,conversationId:raw.raw.conversationId});
        const text='Synthetic direct Raw continuation source.';
        const captured=await read('captureRaw',{namespace:ns,client:'claude-code',sessionId:'synthetic-direct-raw',eventId:'direct-raw-event',
          messages:[1,2].map(ordinal=>({id:'direct-message-'+ordinal,role:'user',content:text,occurredAt:null,messageOrdinal:ordinal,
            part:{index:0,start:0,totalUnits:text.length,totalBytes:Buffer.byteLength(text)}}))});
        await pages('getConversation',{namespace:ns,conversationId:captured.raw.conversationId,limit:1},'messages',read);
        await pages('listRawConversations',{namespace:ns,client:'claude-code',limit:1},'conversations',read);
      }finally{rawCore.close();}
    }
  }
}
stopTrace();
const db=new DatabaseSync(path);
try {
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,cell,'workload retains its physical family');
  if(cell>=52)assert.equal(db.prepare('SELECT card_lineage_revision FROM content_safety_control').get().card_lineage_revision,0);
  const dump=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(({name})=>[
    name,db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all().map(row=>JSON.stringify(row)).sort()]);
  // JavaScript UUIDs above are controlled before execution. SQLite's trigger
  // randomblob IDs are independent: alpha-bind only those opaque effect IDs
  // to their full causal row. No SQL, semantic field or database byte changes.
  const effects=dump.find(([name])=>name==='card_effects')[1].map(row=>JSON.parse(row)),ids=new Map();
  for(const row of [...effects,...effectWitnesses])if(/^[0-9a-f]{32}$/.test(row.effect_id)) {
    assert.equal(row.kind,'evidence_invalidated');assert.equal(row.entity_type,'card');
    assert.ok(row.action_id==='delete-raw'||row.action_id.startsWith('memory-revision-'));
    const {effect_id,...cause}=row;
    const bound=crypto.createHash('sha256').update(JSON.stringify(['synthetic-sql-effect-v1',cause])).digest('hex').slice(0,32);
    if(ids.has(effect_id))assert.equal(ids.get(effect_id),bound,'one effect ID has one complete causal row');
    ids.set(effect_id,bound);
  }
  assert.equal(new Set(ids.values()).size,ids.size);
  function bindEffects(value) {
    if(!value||typeof value!=='object')return;
    if(typeof value.effectId==='string'&&ids.has(value.effectId))value.effectId=ids.get(value.effectId);
    for(const child of Object.values(value))bindEffects(child);
  }
  bindEffects(calls);
  // The argument trace also observes the existing safety validator's lookup
  // of a trigger-created effect. Bind this exact PK parameter to the same
  // complete causal row; leave every other query and argument untouched.
  for(const [sql,method,args] of statements)if(sql==='SELECT * FROM "card_effects" WHERE "effect_id" IS ?'&&ids.has(args[0])) {
    assert.equal(method,'get');assert.equal(args.length,1);args[0]=ids.get(args[0]);
  }
  for(const row of effects)if(ids.has(row.effect_id))row.effect_id=ids.get(row.effect_id);
  dump.find(([name])=>name==='card_effects')[1]=effects.map(row=>JSON.stringify(row)).sort();
  const witnesses=effectWitnesses.map(({effect_id,...cause})=>({effect_id:ids.get(effect_id),...cause}));
  const record=JSON.stringify({calls,statements,dump,effectWitnesses:witnesses});
  for(const id of ids.keys())assert.equal(record.includes(id),false,'unhandled random effect reference');
  process.stdout.write(record);
} finally {db.close();}
