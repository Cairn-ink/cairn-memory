import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { provisionSemanticOwner } from '../context-semantic-ledger.mjs';
import { createExclusiveSqliteFile } from '../sqlite-journal-probe.mjs';
import { credentialDigest } from '../context-product-control.mjs';
import { canonicalJson } from '../context-product-validation.mjs';
import { readFileSync } from 'node:fs';
import * as api from '../index.mjs';
import * as preflight from '../content-safety-preflight.mjs';
import * as safetyCLI from '../../adapters/mcp/safety-command.mjs';
import * as safetyMigrationCLI from '../../adapters/mcp/safety-migrate-command.mjs';
import { createPrivateCardFacade } from '../private-card-facade.mjs';
import { createMethodPackageFacade } from '../method-package-facade.mjs';
import { createAssetFacade } from '../asset-facade.mjs';
import { createRoleProfileFacade } from '../role-profile-facade.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { transaction } from '../database.mjs';
import { suppressOwnerInside, writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { safetyFixture, ns, ok } from '../testing/content-safety-s2h-fixture.mjs';
import { configured } from '../testing/context-product-owner-fixture.mjs';
import { suppressionFixture } from '../testing/content-suppression-fixture.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';

const inventory = JSON.parse(readFileSync(new URL('./fixtures/content-safety-facades.json',import.meta.url),'utf8'));
const methods = handle => {
  if(Array.isArray(handle)||ArrayBuffer.isView(handle))return [];
  const names=new Set();
  for(let object=handle;object&&object!==Object.prototype;object=Object.getPrototypeOf(object))for(const key of Reflect.ownKeys(object)){
    if(key==='constructor'&&object!==handle)continue;
    const d=Object.getOwnPropertyDescriptor(object,key);
    if(typeof d.value==='function'||d.get||d.set||d.value instanceof Promise){assert.equal(typeof key,'string','unclassified symbol method');names.add(key);}
  }
  return [...names].sort();
};
const semanticPorts=new WeakMap();
function options(path) {
  const grants=new WeakMap(),authority={authorize(request){const grant={};const {input,...binding}=request;grants.set(grant,binding);return grant;},isCurrent(grant){return {...grants.get(grant),accessGeneration:1};}};
  return {path,model:rationaleModel(),privateCards:{version:'private-cards-local-v1',source:'submitted-note-v1',storage:'local-plain-v1',disclosure:'explicit-submitted-note-v1',authority,currentDependencies:{version:'card-current-dependencies-v1'}},
    methodPackages:{version:'method-packages-local-v1',storage:'local-plain-v1',authority},assets:{version:'assets-local-v1',storage:'sqlite-blob-v1',authority},
    roleProfiles:{version:'role-profiles-local-v1',storage:'local-plain-v1',authority,attribution:{actorId:'synthetic',agentId:'synthetic'}},
    rawConversations:{mode:'off',readPolicy:()=>({generation:'synthetic',reason:null})},
    contextRead:{version:'context-read-v1',authority,counter:{id:'synthetic',countTokens:()=>1}}};
}
async function semanticCoordinator(t,f,supervisor) {
  if(!globalThis[Symbol.for('context-read-product-p2e-v1/coordinators')]?.size)
    globalThis[Symbol.for('context-read-product-p2e-v1/physical-policy')]?.clear();
  const anchorPath=join(f.workspace.path,'authority.sqlite'),ledgerPath=join(f.workspace.path,'ledger.sqlite');
  createExclusiveSqliteFile(anchorPath);
  const authority=new DatabaseSync(anchorPath,{timeout:5000});t.after(()=>authority.close());
  authority.exec('CREATE TABLE anchors(owner TEXT PRIMARY KEY,anchor TEXT NOT NULL) STRICT; CREATE TABLE enrollments(owner TEXT PRIMARY KEY) STRICT;');
  const ledgerIdentity={accountingDomainId:'synthetic-accounting',ledgerId:'synthetic-ledger'};
  await provisionSemanticOwner({path:ledgerPath,identity:ledgerIdentity,ownerId:ns.ownerId,deadlineAt:Number(process.hrtime.bigint())/1e6+5000,
    enrollment:{authorizeNeverBound:owner=>!authority.prepare('SELECT 1 FROM enrollments WHERE owner=?').get(owner),createIfNeverBound(anchor){
      transaction(authority,()=>{authority.prepare('INSERT INTO enrollments VALUES(?)').run(anchor.ownerId);authority.prepare('INSERT INTO anchors VALUES(?,?)').run(anchor.ownerId,canonicalJson(anchor));});return true;
    }}});
  const token={opaque:randomUUID()},binding={kind:'semantic-service',serviceId:randomUUID(),credentialBindingId:randomUUID(),credentialExpiresUtcMs:null,
    credentialDigest:credentialDigest(token),ownerId:ns.ownerId,scope:'owner',issuedAt:0,
    methods:['setOwnerSemantic','getOwnerSemanticStatus','validateOwnerSemanticCoverage','purgeOwnerVectors'],...ledgerIdentity,ledgerEpoch:1,bindingRevision:1};
  const priceTable={authorityId:'synthetic-price',revision:'one',sequence:1,effectiveFromUtcMs:Date.now()-1000,effectiveUntilUtcMs:Date.now()+3600000,usdPerMillionInputTokens:{'text-embedding-3-small':'0.02'}};
  const state=new SharedArrayBuffer(64);new Int32Array(state)[0]=1;
  const handle=await api.openContextSemanticCoordinator({version:'context-read-product-p2e-v1',supervisor,ledgerPath,ledgerIdentity,
    provider:{provider:'openai',model:'text-embedding-3-small',dimensions:1536,normalization:'l2',requestTimeoutMs:3000,maxBatchDocuments:64},
    refreshCaps:{steady:{maxItemsPerUtcDay:2000,maxUsdPerUtcDay:'0.05'},backfill:{maxItemsPerUtcDay:20000,maxUsdPerUtcDay:'0.50',maxUsdTotal:'5'}},
    backfillTargets:[{canonicalPath:f.path,readSet:[ns],types:['memory'],intents:['current','history']}],priceTable,
    host:{moduleUrl:new URL('../testing/context-semantic-host.mjs',import.meta.url).href,configuration:{semanticServiceBinding:binding,anchorPath,state,priceTable,localRuntime:false}}});
  semanticPorts.set(handle,{token});t.after(()=>handle.close());return handle;
}
for(const mode of ['owner','namespace'])test(`r2 mechanical facade inventory and every scoped method deny pending ${mode} erasure`,async t=>{
  for(const entries of Object.values(inventory))for(const c of Object.values(entries)){assert.ok(['gated','no-owner-content'].includes(c.kind));if(c.kind==='no-owner-content')assert.ok(c.reason?.length>10);}
  const f=safetyFixture(t,33);await f.migrate();const db=f.connect();t.after(()=>db.close());
  const config=options(f.path),core=api.openMemoryCore(config);t.after(()=>core.close());
  const {contextRead,rawConversations,model,...runtimeOptions}=config;
  const runtime=createMemoryRuntime(runtimeOptions);t.after(()=>runtime.close());
  const store=api.openMemoryStore({path:f.path});t.after(()=>store.close());
  const context=api.openContextReader({path:f.path,contextRead});t.after(()=>context.close());
  const topic=api.openMemoryReader({path:f.path,ownerId:ns.ownerId});t.after(()=>topic.close());
  const productConfig=configured(t,f.path,[ns]),product=await productConfig.open();
  const maintenanceConfig=configured(t,f.path,[ns],{service:true}),maintainer=await maintenanceConfig.open();
  const pullFixture=await suppressionFixture(t),pull=(await pullFixture.reader()).handle;
  const supervisor=api.createContextReadSupervisor();t.after(()=>supervisor.close());
  const pool=api.createContextReaderPool();t.after(()=>pool.close());
  assert.ok(Object.isFrozen(pool));assert.deepEqual(methods(pool),['close']);
  const cards=createPrivateCardFacade(runtime.privateCards,config.privateCards,runtime.ready,{prepare(){assert.fail('erased scope reached the Raw source port');}}),methodsFacade=createMethodPackageFacade(runtime.methodPackages,config.methodPackages,runtime.ready,config.assets),assets=createAssetFacade(runtime.assets,config.assets,runtime.ready),roles=createRoleProfileFacade(runtime.roleProfiles,config.roleProfiles,{path:f.path,context:contextRead,assets:config.assets});
  const semantic=await semanticCoordinator(t,f,supervisor);
  // Enumerate both real return profiles of the exported factory, including its
  // Promise-valued completion member. Close before any scheduled work starts.
  const at=Number(process.hrtime.bigint())/1e6,pumpOptions={...maintenanceConfig.options,supervisor};
  const pumpInput={supervisor,id:randomUUID(),window:{id:randomUUID(),endsAtMonoMs:Math.floor(at)+60000,usedItems:1,usedMs:0},
    budgets:{maxItems:1,maxMs:1000},quantum:{maxItems:1,maxMs:100},pollMs:1000,renewalMs:1000,
    serviceCredential:maintenanceConfig.token,projections:[{options:pumpOptions,types:['memory']}]};
  const pumpLexical=api.renewContextMaintenancePump(pumpInput);
  const semanticConfig={version:'context-read-product-p2e-v1',coordinator:semantic};
  const pumpSemantic=api.renewContextMaintenancePump({...pumpInput,id:randomUUID(),semanticConfig,
    semanticServiceCredential:semanticPorts.get(semantic).token,firstCoverageValidation:{maxTargets:1,maxMs:100},
    window:{...pumpInput.window,id:randomUUID(),usedUsd:'0'},budgets:{...pumpInput.budgets,maxUsd:'0.01'},
    quantum:{...pumpInput.quantum,maxUsd:'0.01'},projections:[{options:{...pumpOptions,semanticConfig},types:['memory']}]});
  await Promise.all([pumpLexical.close(),pumpSemantic.close()]);
  const handles={pumpLexical,pumpSemantic,semantic,core,runtime,cards,methods:methodsFacade,assets,roles,legacy:store,scope:store.scope({ownerId:ns.ownerId,projectId:ns.projectId}),context,topic,product,maintainer,pull,supervisor,pool,preflight,safetyCLI,safetyMigrationCLI};
  // Factory returns form a tree (exports -> handles -> scope/pump returns).
  // Recurse containers and compare every discovered handle, never synthesize
  // its method list from the classification fixture.
  const internalPorts=new Set(['runtime.privateCards','runtime.methodPackages','runtime.assets','runtime.roleProfiles']);
  // Runtime storage ports are implementation inputs to the separately tested
  // Card/Method/Asset/Role facades, not exported owner-facing handle factories.
  async function enumerate(tree,out={},prefix='',seen=new Set()){
    if(!tree||typeof tree!=='object'||seen.has(tree))return out;
    seen.add(tree);
    for(const [name,original]of Object.entries(tree)){
      const path=prefix?prefix+'.'+name:name;
      if(internalPorts.has(path))continue;
      const value=original instanceof Promise?await original:original;
      if(!value||typeof value!=='object')continue;
      const entries=methods(value);
      if(entries.length){out[path]=entries;await enumerate(value,out,path,seen);}
      else await enumerate(value,out,prefix,seen);
    }
    return out;
  }
  const actual=await enumerate({publicFactories:handles});
  actual.exports=Object.keys(api).sort();
  t.diagnostic('FACADE_INVENTORY '+JSON.stringify(actual));
  assert.deepEqual(actual,Object.fromEntries(Object.entries(inventory).map(([name,entries])=>[name,Object.keys(entries).sort()])),'new facade/export/method requires explicit classification');
  for(let i=0;i<3;i++)ok(core.admit({namespace:ns,memory:{content:'Synthetic populated inventory '+i,kind:'fact'},receipts:[{client:'synthetic',sessionId:'inventory',eventId:String(i),role:'user',excerpt:'Synthetic inventory'}]}));
  transaction(db,()=>mode==='owner'?suppressOwnerInside(db,{ownerId:ns.ownerId,reason:'account_erasure',actionId:'erase'}):writeContentSuppressionInside(db,{namespace:ns,kind:'namespace',matchMode:'namespace',reason:'privacy_erase',actionId:'erase'}));
  const request={namespace:ns,readSet:[ns],ownerId:ns.ownerId};
  const requestFor = (name, method) => {
    if(name==='topic')return method==='readTopicMembers'?{namespace:ns,selection:{type:'unfiled'},accessRevision:'synthetic'}:{namespace:ns};
    if(name==='product'||name==='context'||name==='maintainer') {
      const base={readSet:[ns],types:['memory'],intent:'current'};
      if(method==='findCandidates')return {...base,query:'synthetic'};
      if(method==='contextRead')return {...base,query:'synthetic',budget:{maxTokens:4000,maxItems:4}};
      if(method==='fetchCandidateEvidence')return {readSet:[ns],refs:[{type:'memory',namespace:ns,memoryId:'synthetic-id',revision:1}],intent:'current'};
      if(method==='getContextIndexStatus')return base;
      return {...base,...(name==='maintainer'?{mode:'lexical'}:{}),budget:{maxItems:1024,maxMs:5000}};
    }
    return request;
  };
  for(const [name,handle]of Object.entries(handles))for(const method of methods(handle)){
    const classification=inventory[name][method];assert.ok(['gated','no-owner-content'].includes(classification.kind));
    if(classification.kind==='no-owner-content'){assert.ok(classification.reason?.length>10);continue;}
    let result,error;
    try{result=await handle[method](name==='runtime'?{...ns}:name==='scope'?(method==='get'?'synthetic-id':method==='search'?'synthetic':{}):requestFor(name,method), name==='product'?productConfig.token:name==='maintainer'?maintenanceConfig.token:{});}catch(e){error=e;}
    if(name==='scope'&&['get','list','search'].includes(method))assert.deepEqual(result,method==='get'?null:[],name+'.'+method);
    else assert.ok(['memory_not_found','evidence_unavailable','moc_not_found','index_unavailable'].includes(error?.code??result?.error?.code),name+'.'+method+' '+JSON.stringify(result??{error:error?.code}));
  }
});
