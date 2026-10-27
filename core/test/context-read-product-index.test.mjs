import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { createProductReaderRuntime } from '../context-product-reader.mjs';
import assert from 'node:assert/strict';
import { createHash,createHmac,randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync,existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openContextProductReader,openContextIndexMaintainer,createContextReadSupervisor } from '../index.mjs';
import { fixture,ns,ok,readTransaction } from '../testing/context-read-fixture.mjs';
import { installOverviewLayout } from '../testing/topic-overview-raw29-fixture.mjs';
import { credentialDigest,PRODUCT_PROFILE } from '../context-product-control.mjs';
import { productSidecar,PRODUCT_SIDECAR_SUFFIX } from '../context-product-sidecar.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { accessDigest,canonicalJson,verifiedRecord } from '../context-product-validation.mjs';
import { openDatabase } from '../database.mjs';
import { migrateMethodPrerequisites } from '../method-package-migration.mjs';
import { installAssets } from '../asset-schema.mjs';
import { installRoleProfiles } from '../role-profile-schema.mjs';
import { installCardCurrentDependencies } from '../card-current-schema.mjs';
import { mutateProcess } from '../testing/context-read-core-fixture.mjs';
import { fixture as dependencyFixture, ns as dependencyNamespace, child as dependencyChild, adopt } from './card-current-fixture.mjs';
import { ManifestHash } from '../context-product-manifest.mjs';

const hostUrl=new URL('../testing/context-product-index-host.mjs',import.meta.url).href;
const coverage={policy:'recent-projects-v1',selectionRevision:'fixture',requestedNamespaces:1,selectedNamespaces:1,omittedNamespaces:0};
const input={readSet:[ns],types:['memory'],intent:'current',deadlineMs:5000};
const refresh={readSet:[ns],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:1024,maxMs:5000}};
function configured(t,path,service=false,ownerGeneration) {
  const supervisor=createContextReadSupervisor();t.after(()=>supervisor.close());
  const token={opaque:randomUUID()},ids={requestId:randomUUID(),handleId:randomUUID(),credentialBindingId:randomUUID(),credentialExpiresUtcMs:null};
  const b={kind:service?'service':'request',...(service?{serviceId:randomUUID(),credentialBindingId:ids.credentialBindingId,credentialExpiresUtcMs:null}:ids),
    credentialDigest:credentialDigest(token),ownerId:ns.ownerId,namespaces:{readSet:[ns],ownerCoverage:coverage},issuedAt:0,...(ownerGeneration?{ownerGeneration}:{})};
  const state=new SharedArrayBuffer(32),view=new Int32Array(state);view[0]=1;view[3]=ownerGeneration??1;
  const options={supervisor,path,version:'context-read-v1',profile:PRODUCT_PROFILE,readSet:[ns],ownerCoverage:coverage,
    ...(service?{sidecarJournalMode:'DELETE'}:{requestControl:{...ids,requestMaxMs:5000}}),diagnostics:true,
    host:{moduleUrl:hostUrl,configuration:{[service?'serviceBinding':'requestBinding']:b,state,...(!service?{requestReservation:new SharedArrayBuffer(4)}:{})}}};
  return {options,token,view,b,supervisor,async open(){const h=await (service?openContextIndexMaintainer:openContextProductReader)(options);t.after(()=>h.close());return h;}};
}
async function build(h,token,patch={}) {
  for(let i=0;i<100;i++){const r=ok(await h.refreshContextIndex({...refresh,...patch},token));if(r.status==='complete')return r;}
  assert.fail('build did not complete');
}
const denied=(r,code)=>assert.equal(r.error?.code,code,JSON.stringify(r));
function scalarStatus(state,reason,progress=null,counts=null,freshness='unverified') {
  return {profile:PRODUCT_PROFILE,lexical:{state,reason,progress},semantic:{state:'disabled',reason:'not_enabled'},
    coverage:{status:state==='ready'?'complete':'unavailable',freshness,byType:{memory:{eligible:counts,indexed:counts,embedded:null}},namespaces:coverage}};
}
function local(f,extra={}) {
  const facade=openContextProductFacade(f.path,{}),p={...input,ownerCoverage:coverage};
  const storage=productSidecar({path:f.path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,writable:true,...extra});
  return {storage,facade,p,access:accessDigest({ownerId:ns.ownerId,namespaces:{readSet:[ns]}}),close(){storage.close();facade.close();}};
}
function independentWrite(path) {
  const child=spawnSync(process.execPath,['--input-type=module','-e',`
    import {DatabaseSync} from 'node:sqlite';
    const d=new DatabaseSync(process.argv[1]);d.exec('PRAGMA busy_timeout=5000;BEGIN IMMEDIATE');
    d.prepare('UPDATE namespace_epochs SET epoch=epoch+1 WHERE owner_id=?').run(process.argv[2]);
    d.exec('COMMIT');d.close();`,path,ns.ownerId],{encoding:'utf8',env:{},timeout:10000});
  assert.equal(child.status,0,child.stderr);return child.status;
}

test('checkpointable manifest is standard SHA-256 over exact ordered UTF-8 tuple bytes',()=>{
  for(const n of [0,1,55,56,63,64,65,127,128,10000]){
    const value='漢'.repeat(n),hash=new ManifestHash();
    const bytes=Buffer.from(value);for(let i=0;i<bytes.length;i+=17){hash.update(bytes.subarray(i,i+17));const resumed=new ManifestHash(hash.state());assert.equal(resumed.digest(),hash.digest());}
    assert.equal(hash.digest(),createHash('sha256').update(value).digest('base64url'));
  }
});

for(const version of [18,23,33])test(`P2-04/05/08/12/15/18/26 physical v${version}: production build -> fresh HTTP candidates/assembly`,async t=>{
  const f=fixture(t),memory=f.admit('production lexical needle');f.core.close();
  if(version<30)installOverviewLayout(f.path,version);
  else {const db=openDatabase(f.path);try{migrateMethodPrerequisites(db);installAssets(db);installRoleProfiles(db);installCardCurrentDependencies(db);db.exec('PRAGMA user_version=33');}finally{db.close();}}
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,version);
  const before=f.db.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY name').all();
  const service=configured(t,f.path,true),h=await service.open();
  assert.deepEqual(ok(await h.getContextIndexStatus(input,service.token)),scalarStatus('absent','missing'));
  assert.equal(service.view[1],2);
  const complete=await build(h,service.token);assert.equal(complete.status,'complete');
  assert.equal(service.view[1]%2,0);assert.equal(service.view[5],0);
  await h.close();
  const request=configured(t,f.path),reader=await request.open();
  const dto=ok(await reader.getContextIndexStatus(input,request.token));
  assert.deepEqual(dto,scalarStatus('ready',null,{phase:4,checkpoint:5,sequence:1,baseSequence:0},1,'current'));
  const c=ok(await reader.findCandidates({...input,query:'needle'},request.token));assert.equal(c.items[0].ref.memoryId,memory.id);
  const {timings,...identityTrace}=c.trace;assert.deepEqual(identityTrace,{requested:'lexical',effective:'lexical',family:'local',preset:'rrf-k60-d12',embedder:null,tokenizer:'hr1-t1-v1',representation:'candidate-text-v1'});
  assert.deepEqual(Object.keys(timings),['maintenanceMs','lexicalMs','semanticPreflightMs','embeddingMs','fusionMs']);assert.equal(c.coverage.omitted.lexical,0);
  const assembly=ok(await reader.contextRead({...input,query:'needle',budget:{maxTokens:4000,maxItems:12}},request.token));
  assert.equal(assembly.metered.items[0].body,'production lexical needle');assert.ok(request.view[4]>0);assert.equal(request.view[5],0);
  const fetched=ok(await reader.fetchCandidateEvidence({readSet:[ns],snapshot:assembly.snapshot,deadlineMs:5000},request.token));assert.equal(fetched.items[0].content,'production lexical needle');
  assert.equal(request.view[1],8);
  const disabled=ok(await reader.findCandidates({...input,query:'needle',semantic:true},request.token));assert.deepEqual(disabled.items,c.items);
  assert.equal(disabled.channels.semantic.state,'disabled');assert.equal(disabled.trace.requested,'hybrid');assert.equal(disabled.trace.effective,'lexical');assert.equal(request.view[5],0);
  if(version===18)denied(await reader.findCandidates({...input,types:['card'],query:'needle'},request.token),'invalid_input');
  await reader.close();
  assert.deepEqual(f.db.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY name').all(),before);
  assert.equal(existsSync(f.path+'.context-read-v1.sqlite'),false);
});

test('P2-18 initial and delta durable progress survive close/reopen with exact closed goldens',async t=>{
  const f=fixture(t);for(let i=0;i<3;i++)f.admit('checkpoint needle '+i);
  let service=configured(t,f.path,true),h=await service.open();
  const initial=ok(await h.refreshContextIndex({...refresh,budget:{maxItems:1,maxMs:5000}},service.token));
  assert.equal(initial.status,'rebuilding');const checkpoint={phase:0,checkpoint:1,sequence:1,baseSequence:0};assert.deepEqual(initial.progress.lexical,checkpoint);
  assert.deepEqual(ok(await h.getContextIndexStatus(input,service.token)),scalarStatus('building','initial_build',checkpoint));
  await h.close();service=configured(t,f.path,true);h=await service.open();
  assert.deepEqual(ok(await h.getContextIndexStatus(input,service.token)),scalarStatus('building','initial_build',checkpoint));
  await build(h,service.token);f.admit('delta needle A');f.admit('delta needle B');
  const delta=ok(await h.refreshContextIndex({...refresh,budget:{maxItems:1,maxMs:5000}},service.token));
  assert.deepEqual(delta.progress.lexical,{phase:0,checkpoint:1,sequence:2,baseSequence:1});await h.close();
  const r=configured(t,f.path),reader=await r.open();
  assert.deepEqual(ok(await reader.getContextIndexStatus(input,r.token)),scalarStatus('catching_up','resume_pending',delta.progress.lexical,null,'stale'));
  denied(await reader.findCandidates({...input,query:'needle'},r.token),'index_unavailable');
});

test('P2-21 DELETE publication race certifies E but fresh postcommit status/read stays stale until explicit catch-up',t=>{
  const f=fixture(t);f.admit('race needle');let writes=0;
  const expected=createHash('sha256').update(JSON.stringify([{memory:f.db.prepare('SELECT epoch FROM namespace_epochs WHERE owner_id=? AND scope=? AND project_id=?').get(ns.ownerId,ns.scope,ns.projectId).epoch}])).digest('base64url');
  const a=local(f,{rendezvous(point){if(point==='precommit' && !writes++){independentWrite(f.path);}}});t.after(()=>a.close());
  a.storage.refresh(a.p,a.access,refresh.budget);
  const observed=readTransaction(a.facade.port.db,()=>a.storage.observe(a.p,a.access));
  assert.equal(observed.dto.lexical.state,'stale');assert.equal(observed.dto.lexical.reason,'fence_changed');
  assert.equal(observed.dto.coverage.byType.memory.eligible,null);
  const side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX,{readOnly:true});
  const record=JSON.parse(side.prepare('SELECT record FROM validation_records').get().record);side.close();
  assert.equal(record.canonicalFenceDigest,expected);
  verifiedRecord(a.facade.port.identity.cursorSecret,'validation',canonicalJson(record));
  a.storage.refresh(a.p,a.access,refresh.budget);
  assert.equal(readTransaction(a.facade.port.db,()=>a.storage.observe(a.p,a.access)).dto.lexical.state,'ready');
});

test('P2-21 no-op refresh independently rechecks after its last work',t=>{
  const f=fixture(t);f.admit('noop needle');let enabled=false;
  const a=local(f,{rendezvous(point){if(enabled&&point==='noop')independentWrite(f.path);}});t.after(()=>a.close());
  a.storage.refresh(a.p,a.access,refresh.budget);enabled=true;a.storage.refresh(a.p,a.access,refresh.budget);
  assert.equal(readTransaction(a.facade.port.db,()=>a.storage.observe(a.p,a.access)).dto.lexical.state,'stale');
});

test('P2-15 ownerGeneration certificates are stable across request identity, stale under a newly valid generation',async t=>{
  const f=fixture(t);f.admit('generation needle');const s=configured(t,f.path,true,1),h=await s.open();await build(h,s.token);await h.close();
  const r=configured(t,f.path,false,2),reader=await r.open();
  const dto=ok(await reader.getContextIndexStatus(input,r.token));assert.equal(dto.lexical.state,'stale');assert.equal(dto.lexical.reason,'access_changed');
});

for(const [change,reason] of [
  ["DELETE FROM validation_records",'validation_missing'],
  ["UPDATE validation_records SET record=replace(record,'context-index-validation-v1','context-index-validation-v2')",'validation_invalid'],
  ["UPDATE publications SET publication='missing'",'validation_missing'],
  ["UPDATE generations SET checkpoint=checkpoint+1 WHERE published=1",'validation_invalid'],
  ["PRAGMA user_version=99",'incompatible'],
  ["UPDATE generations SET manifest='invalid' WHERE published=1",'validation_invalid'],
  ["UPDATE generations SET projection='invalid' WHERE published=1",'validation_invalid'],
  ["UPDATE product_metadata SET incarnation='changed'",'validation_invalid'],
  ["PRAGMA schema_version=999",'validation_invalid'],
  ["UPDATE validation_records SET record='{}'",'validation_invalid'],
  ["CREATE TABLE extra(x)",'incompatible'],
  ["UPDATE product_metadata SET store_id='other'",'wrong_store'],
  ["UPDATE product_metadata SET store_id='other'; PRAGMA user_version=99",'wrong_store'],
])test('P2-08/15 closed refusal '+reason+' '+change,async t=>{
  const f=fixture(t);f.admit('matrix needle');const s=configured(t,f.path,true),h=await s.open();await build(h,s.token);await h.close();
  const side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX);
  if(change==='PRAGMA schema_version=999' && typeof side.enableDefensive==='function')side.enableDefensive(false);
  side.exec(change);if(change==='PRAGMA schema_version=999')assert.equal(side.prepare('PRAGMA schema_version').get().schema_version,999);side.close();
  const r=configured(t,f.path),reader=await r.open();const dto=ok(await reader.getContextIndexStatus(input,r.token));
  assert.deepEqual(dto,scalarStatus('unavailable',reason));denied(await reader.findCandidates({...input,query:'needle'},r.token),'index_unavailable');
});

test('P2-20 copied canonical and sidecar certificates refuse until explicit production rebuild',async t=>{
  const f=fixture(t);f.admit('restore needle');const s=configured(t,f.path,true),h=await s.open();await build(h,s.token);await h.close();
  const restored=join(f.workspace.path,'restored.sqlite');copyFileSync(f.path,restored);copyFileSync(f.path+PRODUCT_SIDECAR_SUFFIX,restored+PRODUCT_SIDECAR_SUFFIX);
  const r=configured(t,restored),reader=await r.open();assert.equal(ok(await reader.getContextIndexStatus(input,r.token)).lexical.state,'unavailable');await reader.close();
  const rebuild=configured(t,restored,true),maintainer=await rebuild.open();await build(maintainer,rebuild.token);await maintainer.close();
  const fresh=configured(t,restored),rr=await fresh.open();assert.equal(ok(await rr.getContextIndexStatus(input,fresh.token)).lexical.state,'ready');
});

test('P2-22/26 service/request separation and two samples for maintenance/status envelopes',async t=>{
  const f=fixture(t);f.admit('authority needle');const req=configured(t,f.path);
  await assert.rejects(openContextIndexMaintainer({...req.options,sidecarJournalMode:'DELETE',requestControl:undefined}),{code:'authority_required'});
  const s=configured(t,f.path,true),h=await s.open();
  denied(await h.refreshContextIndex(refresh,req.token),'authority_required');assert.equal(s.view[1],0);
  s.view[2]=2;denied(await h.refreshContextIndex(refresh,s.token),'scope_changed');assert.equal(s.view[1],2);
  s.view[0]=1;s.view[2]=0;await build(h,s.token);assert.equal(s.view[1],4);
  s.view[2]=6;denied(await h.getContextIndexStatus(input,s.token),'scope_changed');assert.equal(s.view[1],6);
});

function instrumented(maintenance=false,dependencies={}) {
  return createProductReaderRuntime({maintenance,...dependencies,spawnWorker:data=>new Worker(new URL('./fixtures/context-product-index-worker.mjs',import.meta.url),
    {workerData:data,env:{},execArgv:[],stdout:true,stderr:true})});
}

test('P2-08 fresh reader traps every writable open, mutation, repair and deep statistics scan',async t=>{
  const f=fixture(t);f.admit('trapped needle');const s=configured(t,f.path,true),h=await s.open();await build(h,s.token);await h.close();
  const r=configured(t,f.path);r.options.host.configuration.trapReads=true;const reader=await instrumented()(r.options);t.after(()=>reader.close());
  assert.equal(ok(await reader.getContextIndexStatus(input,r.token)).lexical.state,'ready');
  assert.equal(ok(await reader.findCandidates({...input,query:'needle'},r.token)).items.length,1);
  assert.equal(ok(await reader.contextRead({...input,query:'needle',budget:{maxTokens:4000,maxItems:12}},r.token)).metered.items.length,1);
  const service=configured(t,f.path,true);service.options.host.configuration.trapReads=true;
  const observer=await instrumented(true)(service.options);t.after(()=>observer.close());
  assert.equal(ok(await observer.getContextIndexStatus(input,service.token)).lexical.state,'ready');await observer.close();
});

test('P2-21 actual maintenance envelope uses post-COMMIT snapshot after independent E+1 writer',async t=>{
  const f=fixture(t);f.admit('envelope race needle');const s=configured(t,f.path,true);s.options.host.configuration.publicationRace=true;
  const h=await instrumented(true)(s.options);t.after(()=>h.close());
  const r=ok(await h.refreshContextIndex(refresh,s.token));assert.equal(r.status,'rebuilding');assert.equal(r.coverage.freshness,'stale');
  assert.equal(r.coverage.byType.memory.indexed,null);assert.equal(s.view[6],1);assert.equal(s.view[1],2);
  assert.equal(ok(await h.getContextIndexStatus(input,s.token)).lexical.state,'stale');await h.close();
  const s2=configured(t,f.path,true),catchup=await s2.open();await build(catchup,s2.token);await catchup.close();
  const fresh=configured(t,f.path),reader=await fresh.open();assert.equal(ok(await reader.findCandidates({...input,query:'needle'},fresh.token)).items.length,1);
});

test('P2-21 timeout after durable publication discards envelope, keeps certified artifact for a fresh reader',async t=>{
  const f=fixture(t);f.admit('timeout needle');
  const service=configured(t,f.path,true);let clock;
  const open=createProductReaderRuntime({maintenance:true,now:()=>clock??process.hrtime.bigint(),spawnWorker:data=>{
    const w=new Worker(new URL('./fixtures/context-product-index-worker.mjs',import.meta.url),{workerData:data,env:{},execArgv:[],stdout:true,stderr:true});
    w.on('message',m=>{if(Atomics.load(service.view,7) && m.result)clock=BigInt(m.operation.operationCutoffMonoNs);});return w;
  }});
  const maintainer=await open(service.options);t.after(()=>maintainer.close());
  assert.deepEqual(await maintainer.refreshContextIndex(refresh,service.token),{ok:false,error:{code:'read_timeout',retryable:false}});
  await maintainer.close();const fresh=configured(t,f.path),reader=await fresh.open();
  assert.equal(ok(await reader.getContextIndexStatus(input,fresh.token)).lexical.state,'ready');
});

test('P2-04 production maintenance preserves v18 logical and DELETE file hashes and old-pin reopen',async t=>{
  const f=fixture(t);f.admit('old physical needle');f.core.close();
  function fingerprint(){
    const child=spawnSync(process.execPath,['--input-type=module','-e',`
      import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
      const d=new DatabaseSync(process.argv[1],{readOnly:true});const schema=d.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name').all();
      const rows=schema.filter(r=>r.type==='table').map(r=>[r.name,d.prepare('SELECT * FROM "'+r.name+'"').all()]);
      const logical=createHash('sha256').update(JSON.stringify({schema,rows,version:d.prepare('PRAGMA user_version').get()})).digest('hex');d.close();
      console.log(JSON.stringify({logical,file:createHash('sha256').update(readFileSync(process.argv[1])).digest('hex')}));`,f.path],{encoding:'utf8',env:{}});
    assert.equal(child.status,0,child.stderr);return JSON.parse(child.stdout);
  }
  const before=fingerprint(),s=configured(t,f.path,true),h=await s.open();await build(h,s.token);await build(h,s.token,{intent:'history'});await h.close();
  assert.deepEqual(fingerprint(),before);
  const {openDatabase:oldOpen}=await import('./fixtures/topic-overview-b2513501/core/database.mjs');const old=oldOpen(f.path);
  try{assert.equal(old.prepare('PRAGMA user_version').get().user_version,18);}finally{old.close();}
  assert.deepEqual(fingerprint(),before);
});

test('P2-05 real v23 mixed projections preserve Card eligibility and both intents',async t=>{
  const f=fixture(t,{cards:true});f.admit('mixed needle');
  const draft=ok(f.host.call(f.core,'createCardDraft',{namespace:ns,actionId:'draft',drafting:'authored',input:{title:'mixed needle Card',body:'Canonical Card body',authoredInput:{text:'Card support',occurredAt:null}}}));
  const confirmed=ok(f.host.call(f.core,'confirmCardDraft',{namespace:ns,cardId:draft.id,expectedRevision:draft.revision,actionId:'confirm',applicability:'current'}));
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,23);f.core.close();
  const s=configured(t,f.path,true),h=await s.open();for(const intent of ['current','history'])await build(h,s.token,{types:['memory','card'],intent});await h.close();
  for(const intent of ['current','history']){
    const r=configured(t,f.path),reader=await r.open(),p={...input,types:['memory','card'],intent};
    const dto=ok(await reader.getContextIndexStatus(p,r.token));assert.deepEqual(dto.coverage.byType,{memory:{eligible:1,indexed:1,embedded:null},card:{eligible:1,indexed:1,embedded:null}});
    const candidates=ok(await reader.findCandidates({...p,query:'needle'},r.token));assert.equal(candidates.items.length,2);assert.ok(candidates.items.some(i=>i.ref.cardId===confirmed.id));
    const assembly=ok(await reader.contextRead({...p,query:'needle',budget:{maxTokens:4000,maxItems:12}},r.token));assert.equal(assembly.metered.items.length,2);
    await reader.close();
  }
});

test('P2-09 checkpoint rendezvous independent writer invalidates target without retokenizing unchanged text',t=>{
  const f=fixture(t);f.admit('unchanged needle');let mutated=false;
  const a=local(f,{rendezvous(point){if(point==='checkpoint'&&!mutated){mutated=true;independentWrite(f.path);}}});t.after(()=>a.close());
  a.storage.refresh(a.p,a.access,{maxItems:1,maxMs:5000});
  assert.equal(readTransaction(a.facade.port.db,()=>a.storage.observe(a.p,a.access)).dto.lexical.state,'stale');
  a.storage.refresh(a.p,a.access,refresh.budget);
  const noOp=a.storage.refresh(a.p,a.access,refresh.budget);assert.equal(noOp.textRows,0);
});

test('P2-21 actual no-op refresh changes no publication and returns rebuilding after the final fresh snapshot',async t=>{
  const f=fixture(t);f.admit('noop envelope');const s=configured(t,f.path,true);s.options.host.configuration.mutateAtSample=4;s.options.host.configuration.canonicalPath=f.path;
  const h=await s.open();await build(h,s.token);const result=ok(await h.refreshContextIndex(refresh,s.token));
  assert.equal(result.status,'rebuilding');assert.equal(result.coverage.freshness,'stale');assert.equal(s.view[1],4);
  const side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX,{readOnly:true});try{assert.equal(side.prepare('SELECT count(*) AS n FROM validation_records').get().n,1);}finally{side.close();}
});

for(const delta of [false,true])test(`P2-18 real Worker crash after durable ${delta?'delta':'initial'} checkpoint reopens without liveness claims`,async t=>{
  const f=fixture(t);f.admit('crash needle');f.admit('crash needle two');
  if(delta){const s=configured(t,f.path,true),h=await s.open();await build(h,s.token);await h.close();f.admit('delta crash needle');}
  const s=configured(t,f.path,true);s.options.host.configuration.crashAfterCheckpoint=true;
  const h=await instrumented(true)(s.options);t.after(()=>h.close());denied(await h.refreshContextIndex({...refresh,budget:{maxItems:1,maxMs:5000}},s.token),'reader_failed');await h.close();
  const r=configured(t,f.path),reader=await r.open(),dto=ok(await reader.getContextIndexStatus(input,r.token));
  assert.deepEqual(dto,scalarStatus(delta?'catching_up':'building',delta?'resume_pending':'initial_build',{phase:0,checkpoint:0,sequence:delta?2:1,baseSequence:delta?1:0},null,delta?'stale':'unverified'));
  assert.equal(dto.lexical.progress.baseSequence>0,delta);await reader.close();
  const resume=configured(t,f.path,true),maintainer=await resume.open();await build(maintainer,resume.token);
});

test('P2-16 failed maintainer bootstrap after resource registration is supervised without a returned handle',async t=>{
  const f=fixture(t),s=configured(t,f.path,true);s.options.host.configuration.throwAfterResource=true;let error;
  await s.open().catch(e=>{error=e;});assert.equal(error.code,'reader_failed');assert.ok(error.cleanupId);
  const drained=await s.supervisor.drain(error.cleanupId);assert.equal(drained.state,'complete');assert.equal(drained.leasesReleased,true);assert.equal(s.view[6],1);
});

test('P2-12 embeddings-only quantum never creates storage or calls a provider; DELETE-only capability is explicit',async t=>{
  const f=fixture(t),s=configured(t,f.path,true),h=await s.open();
  const result=ok(await h.refreshContextIndex({...refresh,mode:'embeddings'},s.token));assert.equal(result.status,'rebuilding');assert.equal(result.channels.semantic.state,'disabled');
  assert.equal(existsSync(f.path+PRODUCT_SIDECAR_SUFFIX),false);assert.equal(s.view[5],0);
  await assert.rejects(openContextIndexMaintainer({...s.options,sidecarJournalMode:'WAL'}),{code:'index_unavailable'});
  assert.deepEqual(ok(await h.getContextReadCapabilities()).sidecarJournals,['DELETE']);
});

test('P2-15 certificate JSON, HMAC domain, projection and stable access binding have independent known answers',async t=>{
  const f=fixture(t);f.admit('certificate needle');const s=configured(t,f.path,true),h=await s.open();await build(h,s.token);await h.close();
  const side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX,{readOnly:true});
  let record;try{record=JSON.parse(side.prepare('SELECT record FROM validation_records').get().record);}finally{side.close();}
  function sorted(v){return Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))).map(k=>[k,sorted(v[k])])):v;}
  const hash=v=>createHash('sha256').update(JSON.stringify(sorted(v))).digest('base64url');
  const {mac,...body}=record;
  const secret=f.db.prepare('SELECT cursor_secret FROM store_metadata WHERE singleton=1').get().cursor_secret;
  assert.equal(mac,createHmac('sha256',secret).update(PRODUCT_PROFILE+'/validation\n'+JSON.stringify(sorted(body))).digest('base64url'));
  assert.equal(record.projectionDigest,hash({profile:PRODUCT_PROFILE,readSet:[ns],types:['memory'],intent:'current'}));
  assert.equal(record.accessDigest,hash({profile:PRODUCT_PROFILE,ownerId:ns.ownerId,readSet:[ns],ownerGeneration:null}));
  assert.equal(record.canonicalFenceDigest,hash([{memory:f.db.prepare('SELECT epoch FROM namespace_epochs WHERE owner_id=? AND scope=? AND project_id=?').get(ns.ownerId,ns.scope,ns.projectId).epoch}]));
  assert.equal(record.dependencyFenceDigest,hash([{}]));assert.equal(record.counts.byType.memory.eligible,1);
  const encoded=JSON.stringify(sorted(record));assert.equal(encoded.includes(ns.ownerId),false);assert.equal(encoded.includes('certificate needle'),false);
});

test('P2-08 explicit maintenance repairs wrong-store sidecar into a fresh rebuild incarnation',async t=>{
  const f=fixture(t);for(let i=0;i<3;i++)f.admit('repair needle '+i);
  const s=configured(t,f.path,true),h=await s.open();await build(h,s.token);await h.close();
  const side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX);side.exec("UPDATE product_metadata SET store_id='wrong'");side.close();
  const repair=configured(t,f.path,true),maintainer=await repair.open();
  const partial=ok(await maintainer.refreshContextIndex({...refresh,budget:{maxItems:1,maxMs:5000}},repair.token));
  assert.equal(partial.status,'rebuilding');const dto=ok(await maintainer.getContextIndexStatus(input,repair.token));
  assert.deepEqual(dto,scalarStatus('building','rebuild',partial.progress.lexical));await build(maintainer,repair.token);
});

test('P2-09 feature-off independent correction and deletion catch up with only changed text transformed',t=>{
  const f=fixture(t),a=f.admit('unchanged needle'),b=f.admit('changed needle'),c=f.admit('deleted needle');
  const index=local(f);t.after(()=>index.close());index.storage.refresh(index.p,index.access,refresh.budget);
  mutateProcess(f,{method:'correct',input:{namespace:ns,memoryId:b.id,expectedRevision:b.revision,content:'corrected needle',kind:'fact',receipt:{client:'synthetic',sessionId:'delta',eventId:'changed',role:'user',excerpt:'corrected needle'}}},{sync:true});
  mutateProcess(f,{method:'forget',input:{namespace:ns,memoryId:c.id,expectedRevision:c.revision}},{sync:true});
  assert.equal(readTransaction(index.facade.port.db,()=>index.storage.observe(index.p,index.access)).dto.lexical.state,'stale');
  const delta=index.storage.refresh(index.p,index.access,refresh.budget);assert.equal(delta.textRows,1);
  const current=readTransaction(index.facade.port.db,()=>index.storage.observe(index.p,index.access));assert.equal(current.dto.coverage.byType.memory.eligible,2);
  const refs=index.storage.lexical(index.p,current.publication,'needle').rows.map(r=>r.ref);
  assert.ok(refs.some(r=>r.memoryId===a.id));assert.ok(refs.some(r=>r.memoryId===b.id&&r.revision===b.revision+1));assert.equal(refs.some(r=>r.memoryId===c.id),false);
});

test('P2-09 v33 mandatory dependency fences catch feature-off independent method adoption without Card epoch changes',t=>{
  const f=dependencyFixture(t),ref=f.card(),index=local(f);t.after(()=>index.close());
  index.p={...index.p,readSet:[dependencyNamespace],types:['card']};index.access=accessDigest({ownerId:dependencyNamespace.ownerId,namespaces:{readSet:[dependencyNamespace]}});
  index.storage.refresh(index.p,index.access,refresh.budget);
  const before=readTransaction(index.facade.port.db,()=>index.storage.observe(index.p,index.access));assert.equal(before.dto.coverage.byType.card.eligible,1);
  const changed=dependencyChild(f,{method:'adoptMethodVersion',input:adopt(f.v2,'independent-adopt',null,dependencyNamespace,1,[dependencyNamespace])});assert.equal(changed.ok,true,JSON.stringify(changed));
  const stale=readTransaction(index.facade.port.db,()=>index.storage.observe(index.p,index.access));assert.equal(stale.dto.lexical.reason,'dependency_changed');
  index.storage.refresh(index.p,index.access,refresh.budget);
  const current=readTransaction(index.facade.port.db,()=>index.storage.observe(index.p,index.access));assert.equal(current.dto.lexical.state,'ready');assert.equal(current.dto.coverage.byType.card.eligible,0);
  assert.equal(index.storage.lexical(index.p,current.publication,'finance').rows.length,0);
  index.p.intent='history';index.storage.refresh(index.p,index.access,refresh.budget);
  const history=readTransaction(index.facade.port.db,()=>index.storage.observe(index.p,index.access));assert.equal(history.dto.coverage.byType.card.eligible,1);
  assert.equal(index.storage.lexical(index.p,history.publication,'finance').rows[0].ref.cardId,ref.cardId);
});

for(const method of ['findCandidates','contextRead'])test('P2-27 '+method+' data-bearing not-ready error samples currentness before delivery',async t=>{
  const f=fixture(t),r=configured(t,f.path);r.view[2]=2;const reader=await r.open();
  assert.deepEqual(await reader[method]({...input,query:'missing'},r.token),{ok:false,error:{code:'scope_changed',retryable:false}});
  assert.equal(r.view[1],2);assert.equal(existsSync(f.path+PRODUCT_SIDECAR_SUFFIX),false);
});

test('P2-15/18 resumable verification state is committed by the signed checkpoint incarnation',async t=>{
  const f=fixture(t);f.admit('checkpoint integrity');f.admit('checkpoint integrity second');const s=configured(t,f.path,true),h=await s.open();
  ok(await h.refreshContextIndex({...refresh,budget:{maxItems:1,maxMs:5000}},s.token));await h.close();
  const side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX);try{
    const g=side.prepare('SELECT id,verify FROM generations').get(),v=JSON.parse(g.verify);v.hash.h[0]^=1;
    side.prepare('UPDATE generations SET verify=? WHERE id=?').run(JSON.stringify(v),g.id);
  }finally{side.close();}
  const r=configured(t,f.path),reader=await r.open();assert.deepEqual(ok(await reader.getContextIndexStatus(input,r.token)),scalarStatus('unavailable','validation_invalid'));await reader.close();
  const repair=configured(t,f.path,true),maintainer=await repair.open();await build(maintainer,repair.token);
});

test('P2-08 complete empty search keeps frozen zero-population fractions and exhausted-match counts',async t=>{
  const f=fixture(t),s=configured(t,f.path,true),h=await s.open();await build(h,s.token);await h.close();
  const r=configured(t,f.path),reader=await r.open(),c=ok(await reader.findCandidates({...input,query:'needle'},r.token));
  assert.deepEqual(c.items,[]);assert.equal(c.nextCursor,null);assert.equal(c.coverage.status,'complete');assert.equal(c.coverage.freshness,'current');
  assert.deepEqual(c.coverage.byType.memory,{eligible:0,indexed:0,embedded:null,scanned:0,embeddedFraction:null,scannedFraction:1});
  assert.deepEqual(c.coverage.omitted,{lexical:0,semantic:null,horizon:0});
});

test('P2b personal plus one project uses one certified projection and canonical compact mapping across input permutations',async t=>{
  const f=fixture(t),personal={ownerId:ns.ownerId,scope:'personal',projectId:null};
  const projectMemory=f.admit('two namespace project needle'),personalMemory=f.admit('two namespace personal needle',personal);
  f.admit('two namespace foreign needle',{...ns,projectId:'unauthorized'});
  const readSet=[ns,personal],ownerCoverage={...coverage,requestedNamespaces:2,selectedNamespaces:2};
  function configure(service){
    const c=configured(t,f.path,service);c.options.readSet=readSet;c.options.ownerCoverage=ownerCoverage;c.b.namespaces={readSet,ownerCoverage};return c;
  }
  const s=configure(true),h=await s.open();
  for(const intent of ['current','history'])await build(h,s.token,{readSet, intent});await h.close();
  const r=configure(false),reader=await r.open(),p={...input,readSet:[personal,ns],query:'two needle'};
  const candidates=ok(await reader.findCandidates(p,r.token));assert.deepEqual(candidates.items.map(i=>i.ref.memoryId),[personalMemory.id,projectMemory.id]);
  assert.equal(candidates.coverage.byType.memory.eligible,2);assert.equal(candidates.coverage.byType.memory.indexed,2);
  const assembled=ok(await reader.contextRead({...p,budget:{maxTokens:4000,maxItems:12}},r.token));
  assert.deepEqual(assembled.metered.items.map(i=>i.ref.ns),[0,1]);
  const fetched=ok(await reader.fetchCandidateEvidence({readSet,snapshot:assembled.snapshot,deadlineMs:5000},r.token));assert.deepEqual(fetched.items.map(i=>i.ref.memoryId),[personalMemory.id,projectMemory.id]);
});

test('P2-15/17 native corruption status is closed, records one failed open and never retries within the operation',async t=>{
  const f=fixture(t);f.admit('corruption needle');const s=configured(t,f.path,true),h=await s.open();await build(h,s.token);await h.close();
  const r=configured(t,f.path);r.options.host.configuration.syntheticCorrupt=true;const reader=await instrumented()(r.options);t.after(()=>reader.close());
  assert.deepEqual(ok(await reader.getContextIndexStatus(input,r.token)),scalarStatus('unavailable','corrupt'));assert.equal(r.view[6],1);assert.equal(r.view[1],2);
  await reader.close();const frames=await r.supervisor.drain();const failures=frames.flatMap(f=>f.diagnostics.records??[]);assert.equal(failures.filter(f=>f.sqlite.code===11).length,1);
});


for(const [change,reason] of [["DELETE FROM validation_records",'validation_missing'],["UPDATE validation_records SET record='{}'",'validation_invalid']])
test('Fix1 P2-15/P2-18 delta progress cannot mask publication '+reason,async t=>{
  const f=fixture(t);for(let i=0;i<3;i++)f.admit('combined needle '+i);
  const s=configured(t,f.path,true),h=await s.open();await build(h,s.token);f.admit('delta combined needle');
  const delta=ok(await h.refreshContextIndex({...refresh,budget:{maxItems:1,maxMs:5000}},s.token));await h.close();
  assert.equal(delta.progress.lexical.baseSequence,1);
  const side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX);side.exec(change);side.close();
  const r=configured(t,f.path),reader=await r.open();
  assert.deepEqual(ok(await reader.getContextIndexStatus(input,r.token)),scalarStatus('unavailable',reason));
  denied(await reader.findCandidates({...input,query:'needle'},r.token),'index_unavailable');
});

test('Fix1 P2-09 killed uncommitted document/posting/statistics batch rolls back and replays after checkpoint > 0',async t=>{
  const f=fixture(t);for(let i=0;i<4;i++)f.admit('interrupted needle '+i);
  const s=configured(t,f.path,true),h=await s.open();
  ok(await h.refreshContextIndex({...refresh,budget:{maxItems:1,maxMs:5000}},s.token));await h.close();
  const snapshot=()=>{const d=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX);try{return Object.fromEntries(['generations','documents','postings','statistics','progress_records','work','publications','validation_records'].map(table=>[table,d.prepare('SELECT * FROM '+table+' ORDER BY 1,2').all()]));}finally{d.close();}};
  const before=snapshot();assert.equal(before.generations[0].checkpoint,1);assert.equal(before.documents.length,1);assert.ok(before.postings.length>0);
  const crash=configured(t,f.path,true);crash.options.host.configuration.crashBeforeBatchCommit=true;
  const worker=await instrumented(true)(crash.options);t.after(()=>worker.close());
  denied(await worker.refreshContextIndex({...refresh,budget:{maxItems:1,maxMs:5000}},crash.token),'reader_failed');await worker.close();
  assert.equal(crash.view[6],1);assert.deepEqual(snapshot(),before);
  const resume=configured(t,f.path,true),next=await resume.open();
  assert.deepEqual(ok(await next.getContextIndexStatus(input,resume.token)),scalarStatus('building','initial_build',{phase:0,checkpoint:1,sequence:1,baseSequence:0}));
  const replay=ok(await next.refreshContextIndex({...refresh,budget:{maxItems:1,maxMs:5000}},resume.token));assert.equal(replay.progress.transformed,1);assert.equal(replay.progress.lexical.checkpoint,2);
  await build(next,resume.token);await next.close();
  const after=snapshot();assert.equal(after.documents.length,4);assert.equal(new Set(after.documents.map(r=>r.identity)).size,4);
  const pub=JSON.parse(after.validation_records[0].record);assert.equal(pub.counts.documents,4);assert.equal(pub.counts.byType.memory.indexed,4);
  const r=configured(t,f.path),reader=await r.open();assert.equal(ok(await reader.findCandidates({...input,query:'needle'},r.token)).items.length,4);
});

test('Fix1 P2-21 writer after final snapshot leaves completion at E complete and subsequent reads stale',async t=>{
  const f=fixture(t);f.admit('late writer needle');
  const expected=createHash('sha256').update(JSON.stringify([{memory:f.db.prepare('SELECT epoch FROM namespace_epochs WHERE owner_id=? AND scope=? AND project_id=?').get(ns.ownerId,ns.scope,ns.projectId).epoch}])).digest('base64url');
  const s=configured(t,f.path,true);s.options.host.configuration.afterSnapshotRace=true;
  const h=await instrumented(true)(s.options);t.after(()=>h.close());
  const completed=ok(await h.refreshContextIndex(refresh,s.token));assert.equal(completed.status,'complete');assert.equal(s.view[6],1);
  const side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX,{readOnly:true});try{assert.equal(JSON.parse(side.prepare('SELECT record FROM validation_records').get().record).canonicalFenceDigest,expected);}finally{side.close();}
  assert.deepEqual(ok(await h.getContextIndexStatus(input,s.token)),scalarStatus('stale','fence_changed',completed.progress.lexical,null,'stale'));await h.close();
  const r=configured(t,f.path),reader=await r.open();denied(await reader.findCandidates({...input,query:'needle'},r.token),'index_unavailable');
});
