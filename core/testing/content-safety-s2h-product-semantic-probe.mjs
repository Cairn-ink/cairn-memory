// Count gates share one deterministic clock across the native Workers.
import './context-product-test-clock.mjs';
import { assertCostGateCases } from './content-safety-s2h-cost-inventory.mjs';
import { safetyFixture } from './content-safety-s2h-fixture.mjs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ns,ok } from './context-read-fixture.mjs';
import { createExclusiveSqliteFile } from '../sqlite-journal-probe.mjs';
import { provisionSemanticOwner } from '../context-semantic-ledger.mjs';
import { canonicalJson } from '../context-product-validation.mjs';
import { credentialDigest, PRODUCT_PROFILE } from '../context-product-control.mjs';
import { openMemoryCore,openContextSemanticCoordinator,openContextIndexMaintainer,openContextProductReader,createContextReadSupervisor } from '../index.mjs';

const hostUrl=new URL('./content-safety-s2h-semantic-host.mjs',import.meta.url).href;
const selection={provider:'openai',model:'text-embedding-3-small',dimensions:1536,normalization:'l2',requestTimeoutMs:3000,maxBatchDocuments:64};
const coverage={policy:'recent-projects-v1',selectionRevision:'synthetic',requestedNamespaces:1,selectedNamespaces:1,omittedNamespaces:0};
export async function setupProductSemantic(t,{localRuntime=false,open=true,expectedCleanupFailure=false,host={},safety=false,caps:capPatch,corpus,readSet=[ns],version=18,canonicalMode='DELETE',sidecarMode='DELETE',coordinatorHost=hostUrl}={}) {
  // Each fixture is an independent process-policy universe. Never reset while
  // a coordinator is live; same-test duplicate-file probes share the binding.
  if(!globalThis[Symbol.for('context-read-product-p2e-v1/coordinators')]?.size)
    globalThis[Symbol.for('context-read-product-p2e-v1/physical-policy')]?.clear();
  const f=safetyFixture(t,version),types=['memory'];
  const writer=openMemoryCore({path:f.path});
  for(let i=0;i<corpus;i++)ok(writer.admit({namespace:ns,memory:{content:'semantic probecommon synthetic evidence '+String(i).padStart(4,'0'),kind:'fact'},receipts:[{client:'synthetic',sessionId:'probe',eventId:String(i),role:'user',excerpt:'synthetic receipt '+i}]}));
  writer.close();if(safety)await f.migrate();
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
  const time=host.utcClock?Number(new BigInt64Array(host.utcClock)[0]):Date.now(),priceTable={authorityId:host.priceAuthorityId??'synthetic-price',revision:'one',sequence:1,effectiveFromUtcMs:time-1000,effectiveUntilUtcMs:time+3600000,usdPerMillionInputTokens:{'text-embedding-3-small':host.priceRate??'0.02'}};
  const options={version:'context-read-product-p2e-v1',supervisor,ledgerPath,ledgerIdentity,provider:selection,
    refreshCaps:{steady:{maxItemsPerUtcDay:2000,maxUsdPerUtcDay:'0.05'},backfill:{maxItemsPerUtcDay:20000,maxUsdPerUtcDay:'0.50',maxUsdTotal:'5'}},backfillTargets:[{canonicalPath:f.path,readSet,types,intents:['current','history']}],priceTable,
    host:{moduleUrl:coordinatorHost,configuration:{semanticServiceBinding:b,anchorPath,state,priceTable,localRuntime,canonicalPath:f.path,...host}}};
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


export { ns, ok };

// Native product and semantic Workers share atomic meters; host-owned anchor
// SQL is measured separately from engine SQL. Setup is outside each cell.
export async function productSemanticCells(t,{base,n,safety=false,facts=0,group='scoped-empty',intent='current',coldOnly=false}={}) {
  const semanticMeter=new SharedArrayBuffer(64),meter=new Int32Array(semanticMeter),records=[];
  const s=await setupProductSemantic(t,{version:base,safety,corpus:group==='empty'?0:n,host:{semanticMeter,counterDivisor:1000}});
  const physical=new DatabaseSync(s.f.path);
  try {
    assert.equal(physical.prepare('PRAGMA user_version').get().user_version,safety?({18:34,23:38,33:48}[base]):base);
    if(facts)transaction(physical,()=>{for(let i=0;i<facts;i++)writeContentSuppressionInside(physical,{
      namespace:group==='same-namespace'?ns:{...ns,scope:'project',projectId:'unrelated'},kind:'memory',key:'unrelated-'+i,reason:'purge',actionId:'fact-'+i});});
    if(safety)assert.equal(physical.prepare('SELECT count(*) n FROM content_suppressions WHERE owner_id=?').get(ns.ownerId).n,facts,'control: actual owner fact population');
    assert.equal(physical.prepare('SELECT count(*) n FROM memories').get().n,group==='empty'?0:n,'control: actual canonical corpus');
  } finally {physical.close();}
  ok(await s.coordinator.setOwnerSemantic({ownerId:ns.ownerId,semantic:true,expectedRevision:0},s.token));
  const m=s.configure(true);Object.assign(m.options.host.configuration,{semanticMeter,counterDivisor:1000});
  const h=await openContextIndexMaintainer(m.options);s.f.workspace.defer(()=>h.close());
  const input={readSet:[ns],types:['memory'],intent};
  ok(await h.refreshContextIndex({...input,mode:'lexical',budget:{maxItems:1024,maxMs:5000}},m.credential));
  async function measure(method,variant,call){
    for(let i=0;i<meter.length;i++)Atomics.store(meter,i,0);Atomics.store(meter,0,1);
    let result;try{result=await call();}finally{Atomics.store(meter,0,0);}
    const v=Array.from(meter),row={node:process.version,base,cell:safety?({18:34,23:38,33:48}[base]):base,safety,facts,n,corpus:group==='empty'?0:n,limit:12,semantic:true,group,intent,method,variant,
      statements:v[1],begin:v[2],hostSQL:v[3],hostBEGIN:v[4],e1:v[5]+v[6]+v[7],counterCalls:v[5],providerCalls:v[6],awaitedLedgerCalls:v[7],hostInvocations:v[8],epochSelects:v[9],headerSelects:v[10],
      ok:result?.ok,error:result?.error?.code,state:result?.value?.channels?.semantic?.state??result?.value?.diagnostics?.candidates?.channels?.semantic?.state,
      items:result?.value?.items?.length??result?.value?.metered?.items?.length};
    records.push(row);
    if(process.env.CAIRN_S2H_CELL_REPORT==='1')console.log(JSON.stringify({tag:'S2H_PRODUCT_CELL',...row}));
    assert.equal(result.ok,true,JSON.stringify(result));
    if(method==='refreshContextIndex')assert.equal(result.value.status,'complete','control: completed native refresh certificate');
    return result;
  }
  await measure('refreshContextIndex','enabled-cold',()=>h.refreshContextIndex({...input,mode:'embeddings',budget:{maxItems:1024,maxMs:5000,maxUsd:'0.50'}},m.credential));
  if(!coldOnly){
    await measure('refreshContextIndex','enabled-repeat',()=>h.refreshContextIndex({...input,mode:'embeddings',budget:{maxItems:1024,maxMs:5000,maxUsd:'0.50'}},m.credential));
    const r=s.configure(false);Object.assign(r.options.host.configuration,{semanticMeter,counterDivisor:1000});
    const reader=await openContextProductReader(r.options);s.f.workspace.defer(()=>reader.close());
    for(const variant of ['hit','semantic-only']){
      const query={...input,query:variant==='hit'?'semantic':'absentterm',semantic:true,deadlineMs:5000};
      const found=await measure('findCandidates',variant,()=>reader.findCandidates({...query,limit:12},r.credential));
      if(variant==='hit'&&n===24&&group!=='empty'){
        assert.equal(typeof found.value.nextCursor,'string','control: native candidate continuation exists');
        await measure('findCandidates','hit-cursor',()=>reader.findCandidates({...query,limit:12,cursor:found.value.nextCursor},r.credential));
      }
      await measure('contextRead',variant,()=>reader.contextRead({...query,budget:{maxTokens:4000,maxItems:12}},r.credential));
    }
    await reader.close();
  }
  await h.close();await s.coordinator.close();await s.supervisor.close();if(!coldOnly){assertCostGateCases('product-semantic-native',records.filter(r=>r.variant!=='hit-cursor'));const cursors=records.filter(r=>r.variant==='hit-cursor');if(cursors.length)assertCostGateCases('product-semantic-cursor',cursors);}return records;
}
