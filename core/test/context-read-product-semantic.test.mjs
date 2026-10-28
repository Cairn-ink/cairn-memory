import test from 'node:test';
import assert from 'node:assert/strict';
import { card } from '../testing/context-product-owner-fixture.mjs';
import { openDatabase } from '../database.mjs';
import { migrateMethodPrerequisites } from '../method-package-migration.mjs';
import { installAssets } from '../asset-schema.mjs';
import { installRoleProfiles } from '../role-profile-schema.mjs';
import { installCardCurrentDependencies } from '../card-current-schema.mjs';
import { DatabaseSync } from 'node:sqlite';
import { createHash,createHmac,randomUUID } from 'node:crypto';
import { copyFileSync,linkSync,unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fixture,ns,ok } from '../testing/context-read-fixture.mjs';
import { createExclusiveSqliteFile } from '../sqlite-journal-probe.mjs';
import { provisionSemanticOwner } from '../context-semantic-ledger.mjs';
import { createMaintenancePumpRuntime } from '../context-product-pump.mjs';
import { supervisorOwner } from '../context-read-supervisor.mjs';
import { semanticHandle } from '../context-semantic-coordinator.mjs';
import { queryEmbeddingCutoff,tokenCost,usd,dollars } from '../context-semantic-input.mjs';
import { canonicalJson } from '../context-product-validation.mjs';
import { credentialDigest, PRODUCT_PROFILE } from '../context-product-control.mjs';
import { openMemoryCore,openContextSemanticCoordinator,openContextIndexMaintainer,openContextProductReader,createContextReadSupervisor } from '../index.mjs';

const hostUrl=new URL('../testing/context-semantic-host.mjs',import.meta.url).href;
const selection={provider:'openai',model:'text-embedding-3-small',dimensions:1536,normalization:'l2',requestTimeoutMs:3000,maxBatchDocuments:64};
const coverage={policy:'recent-projects-v1',selectionRevision:'synthetic',requestedNamespaces:1,selectedNamespaces:1,omittedNamespaces:0};
const query={readSet:[ns],types:['memory'],intent:'current',query:'semantic',deadlineMs:5000,semantic:true};
async function setup(t,{localRuntime=false,open=true,expectedCleanupFailure=false,host={},caps:capPatch,corpus,readSet=[ns],version=18,canonicalMode='DELETE',sidecarMode='DELETE'}={}) {
  const f=fixture(t,{cards:version>=23}),types=version>=23?['memory','card']:['memory'];for(const [text,namespace] of corpus??[['lexical needle',ns],['semantic match',ns]])f.admit(text,namespace);
  if(version>=23)for(const namespace of readSet)card(f,namespace,'semantic','beta');f.core.close();
  if(version===33){const db=openDatabase(f.path);try{migrateMethodPrerequisites(db);installAssets(db);installRoleProfiles(db);installCardCurrentDependencies(db);db.exec('PRAGMA user_version=33');}finally{db.close();}}
  if(canonicalMode==='WAL'){const db=new DatabaseSync(f.path);try{db.exec('PRAGMA journal_mode=WAL');}finally{db.close();}}
  const supervisor=createContextReadSupervisor();f.workspace.defer(()=>supervisor.close().catch(error=>{if(!expectedCleanupFailure)throw error;assert.equal(error.code,'reader_failed');}));
  const state=new SharedArrayBuffer(64),view=new Int32Array(state);view[0]=1;
  const anchorPath=join(f.workspace.path,'authority.sqlite'),ledgerPath=join(f.workspace.path,'ledger.sqlite');createExclusiveSqliteFile(anchorPath);
  const authority=new DatabaseSync(anchorPath);authority.exec('CREATE TABLE anchors(owner TEXT PRIMARY KEY,anchor TEXT NOT NULL) STRICT;CREATE TABLE enrollments(owner TEXT PRIMARY KEY) STRICT;');
  f.workspace.defer(()=>authority.close());
  const ledgerIdentity={accountingDomainId:'synthetic-accounting',ledgerId:'synthetic-ledger'};
  await provisionSemanticOwner({path:ledgerPath,identity:ledgerIdentity,ownerId:ns.ownerId,deadlineAt:Number(process.hrtime.bigint())/1e6+5000,
    enrollment:{authorizeNeverBound:owner=>!authority.prepare('SELECT 1 FROM enrollments WHERE owner=?').get(owner),createIfNeverBound(a){authority.exec('BEGIN IMMEDIATE');try{authority.prepare('INSERT INTO enrollments VALUES(?)').run(a.ownerId);authority.prepare('INSERT INTO anchors VALUES(?,?)').run(a.ownerId,canonicalJson(a));authority.exec('COMMIT');return true;}catch{authority.exec('ROLLBACK');return false;}}}});
  const token={opaque:randomUUID()},b={kind:'semantic-service',serviceId:randomUUID(),credentialBindingId:randomUUID(),credentialExpiresUtcMs:null,credentialDigest:credentialDigest(token),ownerId:ns.ownerId,scope:'owner',issuedAt:0,
    methods:['setOwnerSemantic','getOwnerSemanticStatus','validateOwnerSemanticCoverage','purgeOwnerVectors'],...ledgerIdentity,ledgerEpoch:1,bindingRevision:1};
  const time=host.utcClock?Number(new BigInt64Array(host.utcClock)[0]):Date.now(),priceTable={authorityId:'synthetic-price',revision:'one',sequence:1,effectiveFromUtcMs:time-1000,effectiveUntilUtcMs:time+3600000,usdPerMillionInputTokens:{'text-embedding-3-small':host.priceRate??'0.02'}};
  const options={version:'context-read-product-p2e-v1',supervisor,ledgerPath,ledgerIdentity,provider:selection,
    refreshCaps:{steady:{maxItemsPerUtcDay:2000,maxUsdPerUtcDay:'0.05'},backfill:{maxItemsPerUtcDay:20000,maxUsdPerUtcDay:'0.50',maxUsdTotal:'5'}},backfillTargets:[{canonicalPath:f.path,readSet,types,intents:['current','history']}],priceTable,
    host:{moduleUrl:hostUrl,configuration:{semanticServiceBinding:b,anchorPath,state,priceTable,localRuntime,...host}}};
  if(capPatch)options.refreshCaps=capPatch;
  const coordinator=open?await openContextSemanticCoordinator(options):null;if(coordinator)f.workspace.defer(()=>coordinator.close().catch(error=>{if(!expectedCleanupFailure)throw error;assert.equal(error.code,'reader_failed');}));
  function configure(service,selected=readSet) {
    const credential={opaque:randomUUID()},ids={requestId:randomUUID(),handleId:randomUUID(),credentialBindingId:randomUUID(),credentialExpiresUtcMs:null};
    const binding={kind:service?'service':'request',...(service?{serviceId:randomUUID(),credentialBindingId:ids.credentialBindingId,credentialExpiresUtcMs:null}:ids),credentialDigest:credentialDigest(credential),ownerId:ns.ownerId,namespaces:{readSet:selected,ownerCoverage:{...coverage,requestedNamespaces:selected.length,selectedNamespaces:selected.length}},issuedAt:0};
    const o={supervisor,path:f.path,version:'context-read-v1',profile:PRODUCT_PROFILE,readSet:selected,ownerCoverage:{...coverage,requestedNamespaces:selected.length,selectedNamespaces:selected.length},
      wal:canonicalMode==='WAL'||sidecarMode==='WAL',...(service?{sidecarJournalMode:sidecarMode}:{requestControl:{...ids,requestMaxMs:5000}}),semanticConfig:{version:'context-read-product-p2e-v1',coordinator,...(service?{}:{queryEmbeddingMaxMs:3000,finalizeReserveMs:1000})},
      host:{moduleUrl:hostUrl,configuration:{[service?'serviceBinding':'requestBinding']:binding,state,...(service?{}:{requestReservation:new SharedArrayBuffer(4)})}}};
    return {options:o,credential};
  }
  return {f,coordinator,token,state,view,configure,options,supervisor,authority,readSet,types,ledgerPath,anchorPath};
}
test('P2e-01 hosted owner defaults off; explicit enable, lexical prebuild, missing vectors degrade',async t=>{
  const s=await setup(t),m=s.configure(true),h=await openContextIndexMaintainer(m.options);s.f.workspace.defer(()=>h.close());
  for(const intent of ['current','history'])ok(await h.refreshContextIndex({readSet:[ns],types:['memory'],intent,mode:'lexical',budget:{maxItems:1024,maxMs:5000}},m.credential));
  assert.equal(s.view[4],0);
  assert.equal(ok(await s.coordinator.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token)).owner.semantic,false);
  ok(await s.coordinator.setOwnerSemantic({ownerId:ns.ownerId,semantic:true,expectedRevision:0},s.token));
  const r=s.configure(false),reader=await openContextProductReader(r.options);s.f.workspace.defer(()=>reader.close());
  const result=ok(await reader.findCandidates(query,r.credential));assert.equal(result.trace.effective,'lexical');assert.equal(result.trace.semantic.degradedReason,'missing_vectors');assert.equal(s.view[4],0);
});
test('P2e-02/07 public refresh certificates permit one query and public first-coverage latch',async t=>{
  const s=await setup(t),m=s.configure(true),h=await openContextIndexMaintainer(m.options);s.f.workspace.defer(()=>h.close());
  ok(await s.coordinator.setOwnerSemantic({ownerId:ns.ownerId,semantic:true,expectedRevision:0},s.token));
  for(const intent of ['current','history']) {
    ok(await h.refreshContextIndex({readSet:[ns],types:['memory'],intent,mode:'lexical',budget:{maxItems:1024,maxMs:5000}},m.credential));
    const value=ok(await h.refreshContextIndex({readSet:[ns],types:['memory'],intent,mode:'embeddings',budget:{maxItems:1024,maxMs:5000,maxUsd:'0.50'}},m.credential));assert.equal(value.status,'complete');
  }
  const status=ok(await s.coordinator.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token));
  const validated=ok(await s.coordinator.validateOwnerSemanticCoverage({ownerId:ns.ownerId,expectedTargetDigest:status.firstCoverage.targetSetDigest,budget:{maxTargets:64,maxMs:5000}},s.token));assert.equal(validated.status,'complete');
  const after=ok(await s.coordinator.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token));assert.equal(after.refresh.phase,'steady');
  const r=s.configure(false),reader=await openContextProductReader(r.options);s.f.workspace.defer(()=>reader.close());
  const before=s.view[4],result=ok(await reader.findCandidates(query,r.credential));assert.equal(s.view[4],before+1);assert.equal(result.trace.effective,'hybrid');assert.equal(result.trace.semantic.queryEmbeddingAttempts,1);
});

async function prepared(s,{latch=true,maxUsd='0.50'}={}) {
  ok(await s.coordinator.setOwnerSemantic({ownerId:ns.ownerId,semantic:true,expectedRevision:0},s.token));
  const m=s.configure(true),h=await openContextIndexMaintainer(m.options);s.f.workspace.defer(()=>h.close());
  for(const intent of ['current','history']) {
    const input={readSet:s.readSet,types:s.types,intent};
    ok(await h.refreshContextIndex({...input,mode:'lexical',budget:{maxItems:1024,maxMs:5000}},m.credential));
    ok(await h.refreshContextIndex({...input,mode:'embeddings',budget:{maxItems:1024,maxMs:5000,maxUsd}},m.credential));
  }
  if(latch) {
    const status=ok(await s.coordinator.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token));
    ok(await s.coordinator.validateOwnerSemanticCoverage({ownerId:ns.ownerId,expectedTargetDigest:status.firstCoverage.targetSetDigest,budget:{maxTargets:64,maxMs:5000}},s.token));
    ok(await s.coordinator.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token));
  }
  return {...m,h};
}
async function candidate(s,patch={}) {
  const r=s.configure(false),reader=await openContextProductReader(r.options);s.f.workspace.defer(()=>reader.close());
  return {r,reader,result:await reader.findCandidates({...query,readSet:s.readSet,types:s.types,...patch},r.credential)};
}
const bare=code=>({ok:false,error:{code,retryable:false}});
const scrub=value=>JSON.parse(JSON.stringify(value,(key,v)=>key==='timings'?{}:v));
function sidecar(s) {const db=new DatabaseSync(s.f.path+'.context-read-product-v1.1.sqlite');s.f.workspace.defer(()=>db.close());return db;}

// Revision 2: validation runs before coordinator/SQLite/provider construction.
test('P2e-01/10/13 Revision 2 refuses local selection and local runtime; no provider or observer effects',async t=>{
  const s=await setup(t,{open:false});
  for(const provider of [{provider:'local',model:'bge-m3',dimensions:1024,normalization:'l2'}, {...selection,normalization:'none'},{...selection,dimensions:1024}])
    await assert.rejects(openContextSemanticCoordinator({...s.options,provider}),{code:'invalid_input'});
  await assert.rejects(openContextSemanticCoordinator({...s.options,host:{...s.options.host,configuration:{...s.options.host.configuration,localRuntime:true}}}),{code:'invalid_input'});
  assert.equal(s.view[4],0);assert.equal(s.view[8],0);
  assert.equal(s.authority.prepare('SELECT count(*) n FROM anchors WHERE json_extract(anchor,\'$.sequence\')=0').get().n,1);
});

test('P2e-01/14/17 exact owner authority and capabilities; final revocation suppresses private status',async t=>{
  const s=await setup(t);
  let effects=0;const malformed=s.configure(false);
  const accessor={...malformed.options.requestControl};Object.defineProperty(accessor,'requestMaxMs',{enumerable:true,get(){effects++;return 5000;}});
  for(const requestControl of [accessor,new Proxy(malformed.options.requestControl,{get(){effects++;return 5000;}})])
    await assert.rejects(openContextProductReader({...malformed.options,requestControl}),{code:'invalid_input'});
  const semantic=semanticHandle(s.coordinator),attach=semantic.attach;
  semantic.attach=()=>{effects++;throw Object.assign(Error('unexpected_attachment'),{code:'invalid_input'});};
  try {
    for(const patch of [{queryEmbeddingMaxMs:undefined},{queryEmbeddingMaxMs:0},{queryEmbeddingMaxMs:5001},{finalizeReserveMs:undefined}])
      await assert.rejects(openContextProductReader({...malformed.options,semanticConfig:{...malformed.options.semanticConfig,...patch}}),{code:'invalid_input'});
    const missing={...malformed.options.semanticConfig};delete missing.queryEmbeddingMaxMs;
    await assert.rejects(openContextProductReader({...malformed.options,semanticConfig:missing}),{code:'invalid_input'});
  }finally{semantic.attach=attach;}
  assert.equal(effects,0);assert.equal(s.view[1],0);
  for(const token of [undefined,{opaque:'request-canary'},s.configure(true).credential])assert.deepEqual(await s.coordinator.getOwnerSemanticStatus({ownerId:ns.ownerId},token),bare('authority_required'));
  assert.deepEqual(await s.coordinator.getOwnerSemanticStatus({ownerId:'wrong-owner'},s.token),bare('authority_required'));
  assert.deepEqual(await s.coordinator.setOwnerSemantic({ownerId:ns.ownerId,semantic:true,expectedRevision:1},s.token),bare('revision_conflict'));
  assert.deepEqual(await s.coordinator.setOwnerSemantic({ownerId:ns.ownerId,semantic:true,expectedRevision:0,extra:true},s.token),bare('invalid_input'));
  const r=s.configure(false),reader=await openContextProductReader(r.options);s.f.workspace.defer(()=>reader.close());
  assert.deepEqual(await reader.getContextReadCapabilities(),bare('authority_required'));
  const c=ok(await reader.getContextReadCapabilities({},r.credential));
  assert.deepEqual(c.channels.semantic,{configured:true,enabled:false});
  assert.deepEqual(c.semanticExtension,{version:'context-read-product-p2e-v1',ownerVectorPurge:true,queryEmbeddingMaximum:1,completeCoverageRequired:true,durableOwnerLedger:true,refreshBudgetDimensions:['maxItems','maxMs','maxUsd']});
  s.view[2]=s.view[1]+2;
  assert.deepEqual(await s.coordinator.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token),bare('scope_changed'));s.view[2]=0;
  assert.equal(s.view[4],0);
});

test('P2e-01/17/21 semantic:false traps coordinator calls and preserves the complete lexical envelope',async t=>{
  const s=await setup(t);await prepared(s);
  const r=s.configure(false),reader=await openContextProductReader(r.options);s.f.workspace.defer(()=>reader.close());
  const l=s.configure(false);delete l.options.semanticConfig;const lexical=await openContextProductReader(l.options);s.f.workspace.defer(()=>lexical.close());
  const expected=await lexical.findCandidates({...query,semantic:false},l.credential),before=s.view[4];
  // Closing the shared service makes every accidental RPC observable as failure.
  await s.coordinator.close();
  const actual=await reader.findCandidates({...query,semantic:false},r.credential);
  assert.deepEqual(scrub(actual),scrub(expected));assert.equal(s.view[4],before);assert.equal(actual.value.trace.semantic,undefined);
});

for(const [mode,reason] of [[1,'provider_error'],[2,'rate_limited'],[4,'dimension_mismatch'],[5,'provider_unavailable']])
test(`P2e-03/08/14/20 ${reason} preserves lexical results and sanitized diagnostics`,async t=>{
  const s=await setup(t);await prepared(s);s.view[7]=mode;
  const {result}=await candidate(s);const value=ok(result);
  assert.equal(value.trace.effective,'lexical');assert.equal(value.trace.semantic.degradedReason,reason);assert.equal(value.trace.semantic.coverage,'complete');assert.equal(value.trace.semantic.queryEmbeddingAttempts,1);
  assert.ok(!JSON.stringify(result).includes('canary'));assert.ok(!JSON.stringify(result).includes('credential'));
  const status=ok(await s.coordinator.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token));assert.equal(status.refresh.itemsCharged,2);
});

test('P2e-06/08/15 unknown usage, price denial and zero quantum USD retain durable exposure',async t=>{
  const clock=new SharedArrayBuffer(8);new BigInt64Array(clock)[0]=BigInt(Date.now());
  const s=await setup(t,{host:{utcClock:clock}});s.view[7]=3;
  await prepared(s);const before=ok(await s.coordinator.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token));
  assert.equal(before.refresh.itemsCharged,2);assert.equal(before.refresh.usdReserved,'0');assert.ok(usd(before.refresh.usdCharged)>0n);
  s.view[9]=1;
  const {result}=await candidate(s);assert.equal(ok(result).trace.semantic.degradedReason,'price_unavailable');assert.equal(result.value.trace.semantic.queryEmbeddingAttempts,0);
  s.view[9]=0;s.view[7]=6;
  const denied=await candidate(s);assert.equal(ok(denied.result).trace.semantic.degradedReason,'price_unavailable');assert.equal(denied.result.value.trace.semantic.queryEmbeddingAttempts,1);
  assert.equal(s.view[6],1);
  await s.coordinator.close();
  const reopened=await openContextSemanticCoordinator(s.options);s.f.workspace.defer(()=>reopened.close());
  const after=ok(await reopened.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token));assert.equal(after.refresh.usdCharged,before.refresh.usdCharged);
});

test('P2e-07/13 mandatory hints block sends and maxTargets1 latches only after both targets',async t=>{
  const s=await setup(t),m=await prepared(s,{latch:false});
  const before=s.view[4],status=ok(await s.coordinator.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token));
  assert.equal(status.refresh.phase,'backfill');assert.equal(status.firstCoverage.state,'validating');
  const q=ok((await candidate(s)).result);assert.equal(q.trace.semantic.degradedReason,'budget_denied');assert.equal(s.view[4],before);
  const input={ownerId:ns.ownerId,expectedTargetDigest:status.firstCoverage.targetSetDigest,budget:{maxTargets:1,maxMs:5000}};
  assert.equal(ok(await s.coordinator.validateOwnerSemanticCoverage(input,s.token)).status,'partial');
  await s.coordinator.close();const next=await openContextSemanticCoordinator(s.options);s.f.workspace.defer(()=>next.close());
  assert.equal(ok(await next.validateOwnerSemanticCoverage(input,s.token)).status,'complete');
  const final=ok(await next.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token));assert.equal(final.refresh.phase,'steady');assert.equal(final.refresh.itemLimit,2000);assert.equal(final.refresh.usdLimit,'0.05');assert.equal(final.refresh.itemsCharged,2);assert.equal(s.view[4],before);
});

test('P2e-05/16 copied or empty ledger and repeated enrollment cannot reset owner allowances',async t=>{
  const s=await setup(t);await prepared(s);await s.coordinator.close();
  const copy=join(s.f.workspace.path,'copied.sqlite');copyFileSync(s.ledgerPath,copy);
  await assert.rejects(openContextSemanticCoordinator({...s.options,ledgerPath:copy}),{code:'index_unavailable'});
  const empty=join(s.f.workspace.path,'empty.sqlite');createExclusiveSqliteFile(empty);
  await assert.rejects(openContextSemanticCoordinator({...s.options,ledgerPath:empty}),{code:'index_unavailable'});
  await assert.rejects(provisionSemanticOwner({path:s.ledgerPath,identity:s.options.ledgerIdentity,ownerId:ns.ownerId,enrollment:{authorizeNeverBound:()=>false}}),{code:'authority_required'});
  const next=await openContextSemanticCoordinator(s.options);s.f.workspace.defer(()=>next.close());
  assert.equal(ok(await next.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token)).refresh.phase,'steady');
});

test('P2e-02 shared deadline arithmetic never renews the caller or finalize reserve',()=>{
  const ms=n=>BigInt(n)*1000000n;
  for(const window of [2000,5000]) {
    assert.equal(queryEmbeddingCutoff({now:ms(700),cutoff:ms(window),maxMs:3000,timeoutMs:4000,finalizeReserveMs:1000}),ms(window===2000?1000:3700));
    assert.equal(queryEmbeddingCutoff({now:ms(window),cutoff:ms(window),maxMs:3000,timeoutMs:4000,finalizeReserveMs:1000}),ms(window-1000));
  }
  assert.equal(tokenCost(1,'0.000000000001'),1n);assert.equal(dollars(usd('0.0500')),'0.05');
});

test('P2e-09/21 bounded owner purge preserves lexical bytes, other owner, latch and charges across restart',async t=>{
  const s=await setup(t);await prepared(s);const db=sidecar(s);
  const lexicalBefore=db.prepare('SELECT record FROM validation_records ORDER BY publication').all();
  const copied=db.prepare('SELECT * FROM semantic_vectors LIMIT 1').get();
  db.prepare('INSERT INTO semantic_vectors VALUES(?,?,?,?,?,?,?,?,?)').run('other-owner',copied.identity,copied.epoch,copied.item,copied.revision,copied.body_revision,copied.representation,copied.vector,copied.sort_key);
  const expected=db.prepare('SELECT count(*) n FROM semantic_vectors WHERE owner=?').get(ns.ownerId).n+
    db.prepare('SELECT count(*) n FROM vector_rows r JOIN vector_generations g ON g.id=r.generation WHERE g.owner=? AND vector IS NOT NULL').get(ns.ownerId).n;
  const before=s.view[4];
  ok(await s.coordinator.setOwnerSemantic({ownerId:ns.ownerId,semantic:false,expectedRevision:1},s.token));
  assert.deepEqual(await s.coordinator.setOwnerSemantic({ownerId:ns.ownerId,semantic:true,expectedRevision:2},s.token),bare('read_in_progress'));
  let result=ok(await s.coordinator.purgeOwnerVectors({ownerId:ns.ownerId,budget:{maxItems:1,maxMs:5000}},s.token));
  assert.equal(result.status,'partial');assert.equal(result.purge.remainingVectors,null);assert.equal(result.purge.deletedVectors,1);
  await s.coordinator.close();const next=await openContextSemanticCoordinator(s.options);s.f.workspace.defer(()=>next.close());
  for(let n=0;n<20&&result.status!=='complete';n++)result=ok(await next.purgeOwnerVectors({ownerId:ns.ownerId,budget:{maxItems:1,maxMs:5000}},s.token));
  assert.equal(result.status,'complete');assert.equal(result.purge.deletedVectors,expected);assert.equal(result.purge.remainingVectors,0);
  const routeA=db.prepare('SELECT item FROM semantic_vectors WHERE owner=? UNION ALL SELECT r.item FROM vector_rows r JOIN vector_generations g ON g.id=r.generation WHERE g.owner=?').all(ns.ownerId,ns.ownerId);
  const routeB=[...db.prepare('SELECT owner FROM semantic_vectors').all().filter(r=>r.owner===ns.ownerId),...db.prepare('SELECT r.generation,g.owner FROM vector_rows r LEFT JOIN vector_generations g ON g.id=r.generation').all().filter(r=>r.owner===ns.ownerId)];
  assert.deepEqual(routeA,routeB);assert.equal(routeA.length,0,'two independent inventories: 0 owner vectors');
  assert.equal(db.prepare('SELECT count(*) n FROM semantic_vectors WHERE owner=?').get('other-owner').n,1);
  assert.deepEqual(db.prepare('SELECT record FROM validation_records ORDER BY publication').all(),lexicalBefore);assert.equal(s.view[4],before);
  ok(await next.setOwnerSemantic({ownerId:ns.ownerId,semantic:true,expectedRevision:2},s.token));
  const status=ok(await next.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token));assert.equal(status.refresh.phase,'steady');assert.equal(status.refresh.itemsCharged,2);
});

const independentCanonical=value=>Array.isArray(value)?'['+value.map(independentCanonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))).map(k=>JSON.stringify(k)+':'+independentCanonical(value[k])).join(',')+'}':JSON.stringify(value);
const independentDigest=value=>createHash('sha256').update(independentCanonical(value)).digest('base64url');
test('P2e-04/10/18 independent canonical manifest, HMAC and pointer oracle; invalid evidence prevents query',async t=>{
  const s=await setup(t);await prepared(s);const db=sidecar(s),secret=s.f.db.prepare('SELECT cursor_secret FROM store_metadata').get().cursor_secret;
  const records=db.prepare('SELECT record FROM vector_validation_records ORDER BY publication').all();
  for(const row of records) {
    const {mac,...body}=JSON.parse(row.record);
    const expected=createHmac('sha256',secret).update('context-read-product-v1.1/context-vector-validation-p2e-v1\0').update(independentCanonical(body)).digest('base64url');
    assert.equal(mac,expected);assert.equal(row.record,independentCanonical({...body,mac}));
    const rows=db.prepare('SELECT * FROM vector_rows WHERE generation=? ORDER BY sort_key').all(body.generation.id).map(r=>{
      const [ownerId,scope,projectId,type,id]=JSON.parse(r.item),bytes=Buffer.from(r.vector);
      assert.equal(bytes.length,6144);assert.equal([...new Float32Array(bytes.buffer,bytes.byteOffset,1536)].filter(n=>n!==0).length,1);
      return {item:{ownerId,scope,projectId:projectId||null,type,id},revision:r.revision,bodyRevision:type==='memory'?null:r.body_revision,representation:r.representation,vector:{encoding:'f32le',dimensions:1536,bytes:bytes.toString('base64url')}};
    });
    const manifest={version:'context-vector-manifest-p2e-v1',counts:body.counts,identity:body.identity,lexicalValidationDigest:body.lexical.validationDigest,purgeEpoch:body.purgeEpoch,representation:body.representation,rows};
    assert.equal(body.manifestDigest,independentDigest(manifest));
    const pointer=JSON.parse(db.prepare('SELECT pointer FROM vector_publications WHERE projection=?').get(body.projectionDigest).pointer);
    assert.equal(pointer.validationDigest,independentDigest({...body,mac}));assert.equal(pointer.identityDigest,independentDigest(body.identity));
  }
  assert.equal(ok((await candidate(s)).result).trace.effective,'hybrid');
  db.exec('UPDATE vector_generations SET published=2 WHERE published=1');
  const beforeInvalidGeneration=s.view[4],invalidGeneration=ok((await candidate(s)).result);assert.equal(invalidGeneration.trace.semantic.degradedReason,'validation_invalid');assert.equal(s.view[4],beforeInvalidGeneration);
  db.exec('UPDATE vector_generations SET published=1 WHERE published=2');
  const saved=db.prepare("SELECT v.publication,v.record FROM vector_validation_records v JOIN vector_publications p ON json_extract(p.pointer,'$.publicationId')=v.publication JOIN publications l ON l.projection=p.projection JOIN generations g ON g.id=l.generation WHERE json_extract(g.fences,'$.intent')='current' LIMIT 1").get()??db.prepare('SELECT publication,record FROM vector_validation_records LIMIT 1').get(),record=JSON.parse(saved.record),lexical=db.prepare('SELECT record FROM validation_records ORDER BY publication').all();
  for(const bad of [' '+saved.record,saved.record.replace('"mac":"','"mac":"A'),independentCanonical({...record,extra:0}),saved.record.slice(0,-1)+',"mac":"'+record.mac+'"}']) {
    db.prepare('UPDATE vector_validation_records SET record=?').run(bad);
    const before=s.view[4],{result}=await candidate(s);const value=ok(result);
    assert.equal(value.trace.semantic.degradedReason,'validation_invalid');assert.equal(value.trace.semantic.queryEmbeddingAttempts,0);assert.equal(s.view[4],before);
  }
  db.prepare('UPDATE vector_validation_records SET record=?').run('{"invalid":true}');
  const before=s.view[4],{result}=await candidate(s);assert.equal(ok(result).trace.semantic.degradedReason,'validation_invalid');assert.equal(s.view[4],before);
  assert.deepEqual(db.prepare('SELECT record FROM validation_records ORDER BY publication').all(),lexical);
});

test('P2e-05/13 SQLite-managed ledger, authority and owner-lock probes preserve cross-process locks',async t=>{
  const s=await setup(t);
  const locked=(path,sql)=>{
    const run=spawnSync(process.execPath,['--input-type=module','-e',`import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);try{db.exec(process.argv[2]);console.log('unexpected');}catch(e){console.log(e.errcode&255);}finally{if(db.isTransaction)db.exec('ROLLBACK');db.close();}`,path,sql],{encoding:'utf8',timeout:10000});
    assert.equal(run.status,0,run.stderr);assert.equal(run.signal,null);assert.equal(run.stdout.trim(),'5');
  };
  const authority=s.authority;authority.exec('BEGIN IMMEDIATE');
  try {
    locked(s.anchorPath,'BEGIN IMMEDIATE');
    ok(await s.coordinator.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token));
    locked(s.anchorPath,'BEGIN IMMEDIATE');
  }finally{authority.exec('ROLLBACK');}
  const ledger=new DatabaseSync(s.ledgerPath);s.f.workspace.defer(()=>ledger.close());ledger.exec('BEGIN IMMEDIATE');
  try{locked(s.ledgerPath,'BEGIN IMMEDIATE');ok(await s.coordinator.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token));locked(s.ledgerPath,'BEGIN IMMEDIATE');}finally{ledger.exec('ROLLBACK');}
  const name=s.ledgerPath+'.semantic-owner-'+independentDigest(ns.ownerId)+'.lock.sqlite';
  locked(name,'BEGIN EXCLUSIVE');ok(await s.coordinator.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token));locked(name,'BEGIN EXCLUSIVE');
});

test('P2e-06/07/08 daily cap shrinks batch, unknown charges survive UTC rollover and steady latch',async t=>{
  const clock=new SharedArrayBuffer(8),utc=new BigInt64Array(clock);utc[0]=BigInt(Math.floor(Date.now()/86400000)*86400000+86399500);
  const caps={steady:{maxItemsPerUtcDay:1,maxUsdPerUtcDay:'0.0001'},backfill:{maxItemsPerUtcDay:1,maxUsdPerUtcDay:'0.0001',maxUsdTotal:'0.001'}};
  const s=await setup(t,{host:{utcClock:clock},caps});s.view[7]=3;const m=await prepared(s,{latch:false});
  assert.equal(s.view[5],1);const first=ok(await s.coordinator.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token));assert.equal(first.refresh.itemsCharged,1);
  utc[0]+=1000n;
  for(const intent of ['current','history'])ok(await m.h.refreshContextIndex({readSet:[ns],types:['memory'],intent,mode:'embeddings',budget:{maxItems:10,maxMs:5000,maxUsd:'0.50'}},m.credential));
  assert.equal(s.view[5],2);const second=ok(await s.coordinator.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token));
  assert.equal(second.refresh.itemsCharged,1);assert.ok(usd(second.refresh.backfillUsdCharged)>=usd(first.refresh.backfillUsdCharged));
  ok(await s.coordinator.validateOwnerSemanticCoverage({ownerId:ns.ownerId,expectedTargetDigest:second.firstCoverage.targetSetDigest,budget:{maxTargets:64,maxMs:5000}},s.token));
  const final=ok(await s.coordinator.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token));assert.equal(final.refresh.phase,'steady');assert.equal(final.refresh.itemLimit,1);assert.equal(final.refresh.itemsCharged,1);
  utc[0]-=1000n;const {result}=await candidate(s);assert.equal(ok(result).trace.semantic.degradedReason,'budget_denied');assert.equal(s.view[5],2);
});

test('P2e-19 query allowance denial is repeatable lexical success',async t=>{
  const s=await setup(t,{host:{maxRequests:1}});await prepared(s);
  for(let i=0;i<2;i++){const {result}=await candidate(s);assert.equal(ok(result).trace.semantic.degradedReason,'budget_denied');assert.equal(result.value.trace.semantic.queryEmbeddingAttempts,0);}
  assert.equal(s.view[4],1);
});

test('P2e-07/13 pump validates complete initial targets even with exhausted embedding item and USD budgets',async t=>{
  const s=await setup(t),m=await prepared(s,{latch:false});await m.h.close();
  let now=0,next=0;const timers=new Map();
  const renew=createMaintenancePumpRuntime({now:()=>now,setTimer:f=>{timers.set(++next,f);return next;},clearTimer:id=>timers.delete(id)});
  const c={supervisor:s.supervisor,id:randomUUID(),semanticConfig:m.options.semanticConfig,semanticServiceCredential:s.token,firstCoverageValidation:{maxTargets:1,maxMs:500},
    serviceCredential:m.credential,projections:[{options:m.options,types:['memory'],modes:['lexical','embeddings']}],window:{id:randomUUID(),endsAtMonoMs:60000,usedItems:2,usedMs:0,usedUsd:'0.50'},
    budgets:{maxItems:2,maxMs:10000,maxUsd:'0.50'},quantum:{maxItems:1,maxMs:500,maxUsd:'0'},pollMs:500,renewalMs:60000};
  assert.throws(()=>renew({...c,semanticServiceCredential:{narrow:true}}),{code:'authority_required'});
  const pump=renew(c);s.f.workspace.defer(()=>pump.close());const before=s.view[4];
  for(let i=0;i<4&&timers.size;i++){const [id,fn]=timers.entries().next().value;timers.delete(id);now+=500;await fn();}
  assert.equal(pump.getStatus().error,null);const status=ok(await s.coordinator.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token));
  assert.equal(status.refresh.phase,'steady');assert.equal(s.view[4],before);assert.equal(pump.getStatus().usedItems,2);assert.equal(pump.getStatus().usedUsd,'0.5');
});

test('P2e-02/11/12 one pooled four-namespace semantic list and independent k10 numeric oracle',async t=>{
  const readSet=[{ownerId:ns.ownerId,scope:'personal',projectId:null},...['a','b','c'].map(projectId=>({...ns,projectId}))];
  const corpus=readSet.flatMap(n=>[['語意 alpha',n],['semantic beta',n],['lexical gamma',n]]),s=await setup(t,{readSet,corpus,version:23});await prepared(s);
  const permutations=rows=>rows.length?rows.flatMap((row,i)=>permutations(rows.filter((_,j)=>i!==j)).map(rest=>[row,...rest])):[[]];
  for(const intent of ['current','history'])for(const selected of permutations(readSet)) {
    const r=s.configure(false,selected),reader=await openContextProductReader(r.options);s.f.workspace.defer(()=>reader.close());
    const before=s.view[4],value=ok(await reader.findCandidates({...query,readSet:selected,types:s.types,intent,limit:24},r.credential));assert.equal(s.view[4],before+1);
    assert.equal(value.trace.effective,'hybrid');assert.equal(value.trace.preset,'rrf-k10');
    const key=ref=>[ref.namespace.ownerId,ref.namespace.scope,ref.namespace.projectId??'',ref.type,ref.memoryId??ref.cardId].join('\0');
    const eligible=s.f.db.prepare("SELECT owner_id,scope,project_id,id,content,'memory' type FROM memories UNION ALL SELECT owner_id,scope,project_id,id,title||char(10)||body content,'card' type FROM private_cards WHERE state='confirmed'").all().map(r=>({key:[r.owner_id,r.scope,r.project_id,r.type,r.id].join('\0'),semantic:/語意|semantic/.test(r.content)?1:0,lexical:r.content.includes('semantic')}));
    const rawCompare=(a,b)=>Buffer.compare(Buffer.from(a.key),Buffer.from(b.key));
    const lexical=eligible.filter(r=>r.lexical).sort(rawCompare),semantic=[...eligible].sort((a,b)=>b.semantic-a.semantic||rawCompare(a,b));
    const fused=eligible.map(r=>({...r,score:(lexical.findIndex(x=>x.key===r.key)<0?0:.5/(11+lexical.findIndex(x=>x.key===r.key)))+.5/(11+semantic.findIndex(x=>x.key===r.key))})).sort((a,b)=>b.score-a.score||rawCompare(a,b));
    assert.deepEqual(value.items.map(r=>key(r.ref)),fused.map(r=>r.key));
    for(const [i,item] of value.items.entries()) {
      const rowKey=key(item.ref),lexicalRank=lexical.findIndex(r=>r.key===rowKey),semanticRank=semantic.findIndex(r=>r.key===rowKey);
      assert.equal(item.fusionScore,fused[i].score);assert.equal(item.channels.semantic.rank,semanticRank+1);assert.equal(item.channels.semantic.rawScore,semantic[semanticRank].semantic);
      if(lexicalRank<0)assert.equal(item.channels.lexical,null);
      else{assert.equal(item.channels.lexical.rank,lexicalRank+1);assert.ok(Math.abs(item.channels.lexical.rawScore-Math.log(2))<1e-15);}
    }
    await reader.close();
  }
});

for(const phase of ['prepare','seal'])for(const stage of ['before','after'])
test(`P2e-05/16 actual process crash ${stage} ${phase} CAS recovers only exact anchored state`,async t=>{
  const s=await setup(t,{open:false}),options={...s.options,supervisor:undefined};
  const child=spawnSync(process.execPath,[new URL('../testing/context-semantic-process.mjs',import.meta.url).pathname],{input:JSON.stringify({options,token:s.token,crash:{killCAS:{stage,phase,sequence:1}}}),encoding:'utf8',timeout:15000});
  assert.equal(child.error,undefined,child.stderr);assert.equal(child.status,null,child.stderr);assert.equal(child.signal,'SIGKILL');
  if(stage==='after'&&phase==='prepare'||stage==='before'&&phase==='seal')await refusedOpen(s,'index_unavailable');
  const next=await openContextSemanticCoordinator({...s.options,host:{...s.options.host,configuration:{...s.options.host.configuration,recovery:true}}});s.f.workspace.defer(()=>next.close());
  const status=ok(await next.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token));
  assert.equal(status.owner.semantic,phase==='seal');assert.equal(status.refresh.itemsCharged,0);assert.equal(s.view[4],0);
});

test('P2e-05/08 crash after possible send retains unknown charge and never replays provider execution',async t=>{
  const s=await setup(t,{open:false}),m=s.configure(true);delete m.options.semanticConfig;
  const child=spawnSync(process.execPath,[new URL('../testing/context-semantic-process.mjs',import.meta.url).pathname],{input:JSON.stringify({options:{...s.options,supervisor:undefined},token:s.token,maintainer:m,crash:{killAfterSend:true}}),encoding:'utf8',timeout:15000});
  assert.equal(child.error,undefined,child.stderr);assert.equal(child.signal,'SIGKILL');assert.equal(child.status,null);
  await refusedOpen(s,'read_in_progress');
  const next=await openContextSemanticCoordinator({...s.options,host:{...s.options.host,configuration:{...s.options.host.configuration,recovery:true}}});s.f.workspace.defer(()=>next.close());
  const status=ok(await next.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token));assert.equal(status.refresh.itemsCharged,2);assert.equal(status.refresh.itemsReserved,0);assert.ok(usd(status.refresh.usdCharged)>0n);assert.equal(s.view[4],0);
});

test('P2e-08/20 over-bound usage keeps full charge, blocks identity and publishes no query result',async t=>{
  const s=await setup(t);await prepared(s);s.view[7]=8;
  const {result}=await candidate(s);assert.equal(ok(result).trace.semantic.degradedReason,'provider_error');assert.equal(result.value.trace.semantic.queryEmbeddingAttempts,1);
  const before=s.view[4],next=await candidate(s);assert.equal(ok(next.result).trace.semantic.degradedReason,'provider_error');assert.equal(next.result.value.trace.semantic.queryEmbeddingAttempts,0);assert.equal(s.view[4],before);
});

async function refusedOpen(s,code) {
  try{await openContextSemanticCoordinator(s.options);assert.fail('opening must refuse');}catch(error){assert.equal(error.code,code);assert.ok(error.cleanupId);const cleanup=await s.supervisor.drain(error.cleanupId);assert.equal(cleanup.state,'complete');}
}

test('P2e-02/05/20 query subdeadline degrades while actual provider ownership remains pinned',async t=>{
  const s=await setup(t);await prepared(s);s.view[7]=7;s.f.workspace.defer(()=>{Atomics.store(s.view,11,1);Atomics.notify(s.view,11);});
  const r=s.configure(false);r.options.semanticConfig.queryEmbeddingMaxMs=2000;
  const reader=await openContextProductReader(r.options);s.f.workspace.defer(()=>reader.close());
  // A rendezvous, rather than elapsed timing, establishes the underlying send.
  const pending=reader.findCandidates(query,r.credential);
  while(Atomics.load(s.view,10)===0)await Promise.race([Atomics.waitAsync(s.view,10,0).value,pending.then(()=>assert.equal(Atomics.load(s.view,10),1,'provider must have entered'))]);
  const value=ok(await pending);assert.equal(value.trace.effective,'lexical');assert.equal(value.trace.semantic.degradedReason,'timeout');assert.equal(value.trace.semantic.queryEmbeddingAttempts,1);
  const {owner}=supervisorOwner(s.supervisor),record=[...owner.records].find(r=>r.domain==='context-read-product-p2e-v1/coordinator'&&r.expiresAt===null);
  const closing=s.coordinator.close();assert.equal(s.supervisor.getCleanupStatus(record.id).providersSettled,false);
  Atomics.store(s.view,11,1);Atomics.notify(s.view,11);await closing;
  assert.equal(s.supervisor.getCleanupStatus(record.id).providersSettled,true);
});

for(const [version,canonicalMode,sidecarMode] of [[18,'DELETE','WAL'],[18,'WAL','DELETE'],[18,'WAL','WAL'],[23,'DELETE','DELETE'],[33,'WAL','WAL']])
test(`P2e-04/09/13 physical v${version} ${canonicalMode}/${sidecarMode} hosted coverage, read and purge`,async t=>{
  const s=await setup(t,{version,canonicalMode,sidecarMode});await prepared(s);
  const {result}=await candidate(s);assert.equal(ok(result).trace.effective,'hybrid');
  const before=s.view[4];ok(await s.coordinator.setOwnerSemantic({ownerId:ns.ownerId,semantic:false,expectedRevision:1},s.token));
  let resultPurge;for(let n=0;n<20;n++){resultPurge=ok(await s.coordinator.purgeOwnerVectors({ownerId:ns.ownerId,budget:{maxItems:2,maxMs:5000}},s.token));if(resultPurge.status==='complete')break;}
  assert.equal(resultPurge.status,'complete');assert.equal(s.view[4],before);
  const db=sidecar(s);assert.equal(db.prepare('SELECT count(*) n FROM semantic_vectors').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM vector_rows').get().n,0);
});

test('P2e-06/07/19 USD-first smaller batches hit a durable backfill ceiling without reset',async t=>{
  const caps={steady:{maxItemsPerUtcDay:2,maxUsdPerUtcDay:'0.01'},backfill:{maxItemsPerUtcDay:3,maxUsdPerUtcDay:'0.034',maxUsdTotal:'0.034'}};
  const s=await setup(t,{host:{priceRate:'1000'},caps,corpus:[['a',ns],['b',ns],['c',ns]]});s.view[7]=3;
  const m=await prepared(s,{latch:false});const status=ok(await s.coordinator.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token));
  assert.equal(status.refresh.itemsCharged,2);assert.equal(status.refresh.usdCharged,'0.034');assert.equal(status.refresh.phase,'blocked');
  const before=s.view[4],{result}=await candidate(s);assert.equal(ok(result).trace.semantic.degradedReason,'backfill_ceiling');assert.equal(result.value.trace.semantic.queryEmbeddingAttempts,0);assert.equal(s.view[4],before);
  await s.coordinator.close();const next=await openContextSemanticCoordinator(s.options);s.f.workspace.defer(()=>next.close());assert.equal(ok(await next.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token)).refresh.phase,'blocked');
});

test('P2e-02/03/18/20 assembly sends one query and preserves metered lexical bytes on provider failure',async t=>{
  const s=await setup(t);await prepared(s);
  const input={...query,budget:{maxTokens:4000,maxItems:24}};
  const a=s.configure(false),lex=await openContextProductReader(a.options);s.f.workspace.defer(()=>lex.close());
  const lexical=ok(await lex.contextRead({...input,semantic:false},a.credential));
  const r=s.configure(false),reader=await openContextProductReader(r.options);s.f.workspace.defer(()=>reader.close());
  const before=s.view[4],hybrid=ok(await reader.contextRead(input,r.credential));assert.equal(s.view[4],before+1);assert.equal(hybrid.diagnostics.candidates.trace.effective,'hybrid');
  const b=s.configure(false),failed=await openContextProductReader(b.options);s.f.workspace.defer(()=>failed.close());s.view[7]=1;
  const value=ok(await failed.contextRead(input,b.credential));assert.equal(s.view[4],before+2);assert.deepEqual(value.metered,lexical.metered);assert.equal(value.diagnostics.candidates.trace.semantic.degradedReason,'provider_error');
});

test('P2e-13/21 canonical forget during query settlement cannot return the forbidden revision',async t=>{
  const s=await setup(t);await prepared(s);s.view[7]=7;s.f.workspace.defer(()=>{Atomics.store(s.view,11,1);Atomics.notify(s.view,11);});
  const r=s.configure(false),reader=await openContextProductReader(r.options);s.f.workspace.defer(()=>reader.close());const pending=reader.findCandidates(query,r.credential);
  while(Atomics.load(s.view,10)===0)await Promise.race([Atomics.waitAsync(s.view,10,0).value,pending.then(()=>assert.equal(Atomics.load(s.view,10),1))]);
  const row=s.f.db.prepare("SELECT id,revision FROM memories WHERE content='semantic match'").get(),writer=openMemoryCore({path:s.f.path});
  try{ok(writer.forget({namespace:ns,memoryId:row.id,expectedRevision:row.revision}));}finally{writer.close();}
  Atomics.store(s.view,11,1);Atomics.notify(s.view,11);
  const result=await pending;assert.equal(result.ok,false);assert.equal(result.error.code,'index_unavailable');assert.equal(result.value,undefined);
});

for(const stage of ['before','after'])test(`P2e-09 actual ${stage} sidecar purge COMMIT crash resumes authenticated checkpoint exactly once`,async t=>{
  const s=await setup(t);await prepared(s);await s.coordinator.close();
  const db=sidecar(s),expected=db.prepare('SELECT count(*) n FROM semantic_vectors').get().n+db.prepare('SELECT count(*) n FROM vector_rows').get().n;
  const child=spawnSync(process.execPath,[new URL('../testing/context-semantic-process.mjs',import.meta.url).pathname],{input:JSON.stringify({options:{...s.options,supervisor:undefined},token:s.token,purge:true,crash:{killCommit:{stage,ordinal:1}}}),encoding:'utf8',timeout:15000});
  assert.equal(child.error,undefined,child.stderr);assert.equal(child.status,null,child.stderr);assert.equal(child.signal,'SIGKILL');
  const next=await openContextSemanticCoordinator({...s.options,host:{...s.options.host,configuration:{...s.options.host.configuration,recovery:true}}});s.f.workspace.defer(()=>next.close());
  let result;for(let n=0;n<20;n++){result=ok(await next.purgeOwnerVectors({ownerId:ns.ownerId,budget:{maxItems:1,maxMs:5000}},s.token));if(result.status==='complete')break;}
  assert.equal(result.status,'complete');assert.equal(result.purge.deletedVectors,expected);assert.equal(db.prepare('SELECT count(*) n FROM vector_rows').get().n,0);assert.equal(s.view[4],1);
});

test('P2e-15 accepted price sequence survives restart and rejects rollback or equal-sequence changed digest',async t=>{
  const s=await setup(t);await prepared(s);const first=s.options.priceTable;await s.coordinator.close();
  const second={...first,revision:'two',sequence:2,usdPerMillionInputTokens:{'text-embedding-3-small':'0.03'}};
  const options=table=>({...s.options,priceTable:table,host:{...s.options.host,configuration:{...s.options.host.configuration,priceTable:table}}});
  const next=await openContextSemanticCoordinator(options(second));s.f.workspace.defer(()=>next.close());
  async function readWith(coordinator){const r=s.configure(false);r.options.semanticConfig.coordinator=coordinator;const h=await openContextProductReader(r.options);s.f.workspace.defer(()=>h.close());return ok(await h.findCandidates(query,r.credential));}
  assert.equal((await readWith(next)).trace.effective,'hybrid');await next.close();const sends=s.view[6];
  for(const stale of [first,{...second,usdPerMillionInputTokens:{'text-embedding-3-small':'0.04'}}]) {
    const old=await openContextSemanticCoordinator(options(stale));s.f.workspace.defer(()=>old.close());
    const value=await readWith(old);assert.equal(value.trace.semantic.degradedReason,'price_unavailable');assert.equal(value.trace.semantic.queryEmbeddingAttempts,0);assert.equal(s.view[6],sends);await old.close();
  }
});

test('P2e-01/17 zero-call continuation, fetch, status, capabilities and lexical maintenance',async t=>{
  const s=await setup(t),m=await prepared(s),r=s.configure(false),reader=await openContextProductReader(r.options);s.f.workspace.defer(()=>reader.close());
  const page=ok(await reader.findCandidates({...query,limit:1},r.credential)),before=s.view[4];assert.ok(page.nextCursor);
  const next=ok(await reader.findCandidates({...query,limit:1,cursor:page.nextCursor},r.credential));assert.equal(next.trace.semantic,undefined);
  ok(await reader.fetchCandidateEvidence({readSet:[ns],intent:'current',refs:[page.items[0].ref]},r.credential));
  const status=ok(await reader.getContextIndexStatus({readSet:[ns],types:['memory'],intent:'current'},r.credential));
  const forbidden=new Set(['refresh','purge','firstCoverage','itemsCharged','usdCharged','deletedVectors']);
  const inspect=value=>{if(value&&typeof value==='object')for(const [key,v] of Object.entries(value)){assert.ok(!forbidden.has(key),key);inspect(v);}};inspect(status);
  ok(await reader.getContextReadCapabilities({},r.credential));
  ok(await m.h.refreshContextIndex({readSet:[ns],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:1024,maxMs:5000}},m.credential));
  assert.equal(s.view[4],before);
});

test('P2e-01/13 off-owner pump turns remain lexical and consume no provider/document allowance',async t=>{
  const s=await setup(t),m=s.configure(true);let next=0,now=0;const timers=new Map();
  const renew=createMaintenancePumpRuntime({now:()=>now,setTimer:fn=>{timers.set(++next,fn);return next;},clearTimer:id=>timers.delete(id)});
  const pump=renew({supervisor:s.supervisor,id:randomUUID(),semanticConfig:m.options.semanticConfig,semanticServiceCredential:s.token,firstCoverageValidation:{maxTargets:1,maxMs:500},serviceCredential:m.credential,
    projections:[{options:m.options,types:['memory'],modes:['lexical','embeddings']}],window:{id:randomUUID(),endsAtMonoMs:60000,usedItems:0,usedMs:0,usedUsd:'0'},budgets:{maxItems:2,maxMs:10000,maxUsd:'0'},quantum:{maxItems:1,maxMs:500,maxUsd:'0'},pollMs:500,renewalMs:60000});
  s.f.workspace.defer(()=>pump.close());for(let n=0;n<5&&timers.size;n++){const [id,fn]=timers.entries().next().value;timers.delete(id);now+=500;await fn();}
  assert.equal(pump.getStatus().error,null);assert.equal(s.view[4],0);const owner=ok(await s.coordinator.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token));assert.equal(owner.owner.semantic,false);assert.equal(owner.refresh.itemsCharged,0);assert.equal(owner.refresh.usdCharged,'0');
});

test('P2e-17/21 staged 26-namespace scope excludes foreign canaries and public purge leaves zero owner rows',async t=>{
  const readSet=[{ownerId:ns.ownerId,scope:'personal',projectId:null},...Array.from({length:25},(_,i)=>({...ns,projectId:'p'+i}))];
  const corpus=[...readSet.map(n=>['semantic selected',n]),['semantic omitted canary',{...ns,projectId:'omitted'}],['semantic owner canary',{ownerId:'foreign-owner',scope:'personal',projectId:null}]];
  const s=await setup(t,{readSet,corpus});await prepared(s);const {result}=await candidate(s),value=ok(result);
  assert.equal(value.trace.effective,'hybrid');assert.equal(value.coverage.byType.memory.eligible,26);assert.equal(value.coverage.byType.memory.embedded,26);
  assert.ok(value.items.every(item=>readSet.some(n=>JSON.stringify(n)===JSON.stringify(item.ref.namespace))));
  ok(await s.coordinator.setOwnerSemantic({ownerId:ns.ownerId,semantic:false,expectedRevision:1},s.token));
  const purge=ok(await s.coordinator.purgeOwnerVectors({ownerId:ns.ownerId,budget:{maxItems:1024,maxMs:5000}},s.token));assert.equal(purge.status,'complete');
  const db=sidecar(s);assert.equal(db.prepare('SELECT count(*) n FROM semantic_vectors WHERE owner=?').get(ns.ownerId).n,0);assert.equal(db.prepare('SELECT count(*) n FROM vector_rows').get().n,0);
});


test('P2e-05/14 fatal service Worker exit pins unknown resources and close reports failure without waiting for another exit',async t=>{
  const s=await setup(t,{expectedCleanupFailure:true});await prepared(s);s.view[7]=12;
  const {owner}=supervisorOwner(s.supervisor),record=[...owner.records].find(r=>r.domain==='context-read-product-p2e-v1/coordinator'&&r.expiresAt===null);
  const value=ok((await candidate(s)).result);assert.equal(value.trace.effective,'lexical');assert.equal(value.trace.semantic.degradedReason,'ledger_unavailable');
  assert.deepEqual(await s.coordinator.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token),bare('store_closed'));
  await assert.rejects(s.coordinator.close(),{code:'reader_failed'});const status=s.supervisor.getCleanupStatus(record.id);assert.equal(status.state,'failed');assert.equal(status.workerStopped,true);assert.equal(status.providersSettled,false);
});


test('P2e-07 maximum 32 configured projections freeze 64 targets through the public owner API without a provider call',async t=>{
  const s=await setup(t,{open:false}),personal={ownerId:ns.ownerId,scope:'personal',projectId:null},projects=Array.from({length:32},(_,i)=>({...ns,projectId:'p'+i}));
  s.options.backfillTargets=projects.map((_,i)=>({canonicalPath:s.f.path,readSet:[personal,...projects.filter((_,j)=>j!==i)],types:['memory'],intents:['current','history']}));
  const coordinator=await openContextSemanticCoordinator(s.options);s.f.workspace.defer(()=>coordinator.close());
  ok(await coordinator.setOwnerSemantic({ownerId:ns.ownerId,semantic:true,expectedRevision:0},s.token));
  const value=ok(await coordinator.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token));assert.equal(value.firstCoverage.totalTargets,64);assert.equal(value.firstCoverage.state,'pending');assert.equal(s.view[4],0);
});
