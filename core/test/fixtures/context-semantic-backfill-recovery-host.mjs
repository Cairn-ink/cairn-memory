import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { createContextReadHost as offlineHost } from '../../testing/context-semantic-host.mjs';
import { fixture, ns, ok } from '../../testing/context-read-fixture.mjs';
import { openContextIndexMaintainer, openContextSemanticCoordinator } from '../../index.mjs';
import { createSupervisorRegistry } from '../../context-read-supervisor.mjs';
import { canonicalJson, digest, signedRecord } from '../../context-product-validation.mjs';
import { credentialDigest, PRODUCT_PROFILE } from '../../context-product-control.mjs';
import { PRODUCT_SIDECAR_SUFFIX } from '../../context-product-admission.mjs';
import { semanticHandle } from '../../context-semantic-coordinator.mjs';
import { provisionSemanticOwner, stateBytes, stateDigest } from '../../context-semantic-ledger.mjs';
import { createExclusiveSqliteFile } from '../../sqlite-journal-probe.mjs';
import { dollars, usd } from '../../context-semantic-input.mjs';

export { ns, ok };
export const capability='context-semantic-backfill-recovery-v1', method='grantOwnerBackfillRecovery';
export const checkpoint={beforePrepare:1,afterPrepare:2,afterNative:3,afterSeal:4,afterAudit:5,holdPrepare:6,holdAudit:7,holdLoad:8,throwPrepare:9,throwSeal:10};
const index={checkpoint:0,sequence:1,reached:2,resume:3,revoked:4,approval:5,expiry:6,auditDown:7,disposed:8,disabled:9};
const corpus=['synthetic alpha','synthetic beta'];
export const balance='0.00000122';
const encoder=value=>String(usd(value));
const identity={accountingDomainId:'synthetic-accounting',ledgerId:'synthetic-ledger'};
const ordinaryMethods=['setOwnerSemantic','getOwnerSemanticStatus','validateOwnerSemanticCoverage','purgeOwnerVectors'];
const target={readSet:[ns],types:['memory']};
const coverage={policy:'recent-projects-v1',selectionRevision:'synthetic',requestedNamespaces:1,selectedNamespaces:1,omittedNamespaces:0};
const ownerId=ns.ownerId;

export async function createContextReadHost(c) {
  const host=await offlineHost(c);
  if(!c.semanticServiceBinding)return host;
  const control=new Int32Array(c.control), issued=new WeakSet(), base=host.semanticLedgerAuthority;
  const audit=c.resourceOwner.sqlitePolicy.open(new DatabaseSync(c.anchorPath),c.anchorPath).db;
  async function hold() {
    Atomics.store(control,index.reached,1);
    while(!Atomics.load(control,index.resume))await Atomics.waitAsync(control,index.resume,0).value;
  }
  const approval=new Int32Array(c.approval), bytes=new Uint8Array(c.approval,4);
  return {...host,
    authorize(query,credential) {
      if(query.method==='setOwnerSemantic'&&!query.input.semantic)Atomics.store(control,index.disabled,1);
      return host.authorize(query,credential);
    },
    close(){audit.close();host.close();},
    semanticLedgerAuthority:{...base,async load(owner) {
      if(Atomics.compareExchange(control,index.checkpoint,checkpoint.holdLoad,0)===checkpoint.holdLoad)await hold();
      return base.load(owner);
    },confirmDisposed:()=>Atomics.load(control,index.disposed)===1,
    async compareAndSwap(previous,next) {
      const seq=next.pending?.sequence??next.sequence;
      if(seq!==Atomics.load(control,index.sequence))return base.compareAndSwap(previous,next);
      const mode=Atomics.load(control,index.checkpoint);
      if(next.pending&&mode===checkpoint.beforePrepare||!next.pending&&mode===checkpoint.afterNative)process.exit(1);
      const changed=base.compareAndSwap(previous,next);
      if(changed&&(next.pending&&mode===checkpoint.throwPrepare||!next.pending&&mode===checkpoint.throwSeal)) {
        Atomics.store(control,index.checkpoint,0);
        throw Error('synthetic anchor I/O fault');
      }
      if(changed&&(next.pending&&mode===checkpoint.afterPrepare||!next.pending&&mode===checkpoint.afterSeal))process.exit(1);
      if(changed&&next.pending&&mode===checkpoint.holdPrepare)await hold();
      return changed;
    }},
    ...(c.noPort?{}:{backfillRecoveryAuthority:{
      authorize(query,credential) {
        if(credentialDigest(credential)!==c.admin.credentialDigest||query.method!==method||query.credentialBindingId!==c.admin.credentialBindingId)return null;
        const binding={...c.admin};issued.add(binding);return binding;
      },
      isCurrent(binding,query){return issued.has(binding)&&query.ownerId===binding.ownerId&&!Atomics.load(control,index.revoked);},
      verifyApproval(query) {
        if(!Atomics.load(approval,0)||Atomics.load(control,index.approval))return null;
        const expected=JSON.parse(Buffer.from(bytes.subarray(0,Atomics.load(approval,0))).toString());
        if(canonicalJson(expected.query)!==canonicalJson(query))return null;
        return {...expected.value,expiresUtcMs:Atomics.load(control,index.expiry)?Date.now()-1:expected.value.expiresUtcMs};
      },
      async appendAudit(event) {
        if(Atomics.load(control,index.auditDown))return false;
        const serialized=canonicalJson(event), insert=audit.prepare('INSERT OR IGNORE INTO audits VALUES(?,?)').run(event.grantId,serialized);
        assert.equal(audit.prepare('SELECT event FROM audits WHERE id=?').get(event.grantId).event,serialized);
        if(insert.changes&&Atomics.load(control,index.checkpoint)===checkpoint.afterAudit)process.exit(1);
        if(Atomics.load(control,index.checkpoint)===checkpoint.holdAudit)await hold();
        return true;
      }
    }}),
    contextEmbedding:{...host.contextEmbedding,embedder:{...host.contextEmbedding.embedder,embed(texts,controls) {
      return host.contextEmbedding.embedder.embed(texts,{...controls,settleInputTokens:usage=>controls.settleInputTokens(usage+16*texts.length)});
    }}},
  };
}

function dbWork(path,work,readOnly=false) {
  const db=new DatabaseSync(path,{readOnly});
  try{return work(db);}finally{db.close();}
}
export async function until(predicate) {
  const cutoff=performance.now()+4000;
  while(!predicate()){assert.ok(performance.now()<cutoff,'synthetic checkpoint was reached');await delay(2);}
}
export async function scenario(t,{base='5',enabled=true,journal='DELETE',noPort=false,safety=false,grantMaximum='0.5',lifetimeMaximum='0.75'}={}) {
  const f=fixture(t,safety?{coreOptions:{contentSafety:'s2h-v1'}}:undefined);
  const memories=corpus.map(text=>f.admit(text));f.core.close();
  const state=new Int32Array(new SharedArrayBuffer(64));
  let supervisor=createSupervisorRegistry().supervisor();
  const control=new Int32Array(new SharedArrayBuffer(48)), approval=new Int32Array(new SharedArrayBuffer(8192));
  state[0]=1;
  const anchorPath=join(f.workspace.path,'authority.sqlite'), ledgerPath=join(f.workspace.path,'ledger.sqlite');
  createExclusiveSqliteFile(anchorPath);
  dbWork(anchorPath,db=>db.exec('CREATE TABLE anchors(owner TEXT PRIMARY KEY,anchor TEXT NOT NULL) STRICT;CREATE TABLE audits(id TEXT PRIMARY KEY,event TEXT NOT NULL) STRICT;'));
  await provisionSemanticOwner({path:ledgerPath,identity,ownerId,deadlineAt:Number(process.hrtime.bigint())/1e6+5000,enrollment:{
    authorizeNeverBound:()=>true,
    createIfNeverBound:a=>dbWork(anchorPath,db=>db.prepare('INSERT INTO anchors VALUES(?,?)').run(ownerId,canonicalJson(a)).changes===1)
  }});
  const token={opaque:randomUUID()}, adminToken={opaque:randomUUID()};
  const binding={kind:'semantic-service',...identity,ownerId,ledgerEpoch:1,bindingRevision:1,scope:'owner',issuedAt:0,methods:ordinaryMethods,
    serviceId:randomUUID(),credentialBindingId:randomUUID(),credentialDigest:credentialDigest(token),credentialExpiresUtcMs:null};
  const admin={kind:'backfill-recovery-service',version:1,...identity,ownerId,ledgerEpoch:1,bindingRevision:1,methods:[method],
    serviceId:randomUUID(),credentialBindingId:randomUUID(),credentialDigest:credentialDigest(adminToken),expiresUtcMs:Date.now()+60000};
  const policy={revision:1,maxGrantUnits:encoder(grantMaximum),maxLifetimeGrantUnits:encoder(lifetimeMaximum)};
  const now=Date.now(), priceTable={authorityId:'synthetic-price',revision:'one',sequence:1,effectiveFromUtcMs:now-1000,
    effectiveUntilUtcMs:now+600000,usdPerMillionInputTokens:{'text-embedding-3-small':'0.02'}};
  let coordinator, maintainer;
  const unpause=()=>{Atomics.store(control,index.resume,1);Atomics.notify(control,index.resume);Atomics.store(state,11,1);Atomics.notify(state,11);};
  f.workspace.defer(async()=>{unpause();await maintainer?.close().catch(()=>{});await coordinator?.close().catch(()=>{});await supervisor.close().catch(()=>{});});
  globalThis[Symbol.for('context-read-product-p2e-v1/physical-policy')]?.clear();
  const host={moduleUrl:import.meta.url,configuration:{semanticServiceBinding:binding,priceTable,anchorPath,state:state.buffer,
    admin,control:control.buffer,approval:approval.buffer,semanticSidecarJournalMode:journal,noPort}};
  const open=(options={})=>{
    if(options.credentialTtlMs!==undefined)admin.expiresUtcMs=Date.now()+options.credentialTtlMs;
    const cap=options.base??base, recovery={version:1,binding:admin,policy};
    return openContextSemanticCoordinator({version:'context-read-product-p2e-v1',supervisor,ledgerPath,ledgerIdentity:identity,host,
      provider:{provider:'openai',model:'text-embedding-3-small',dimensions:1536,normalization:'l2',requestTimeoutMs:3000,maxBatchDocuments:64},
      refreshCaps:{steady:{maxItemsPerUtcDay:100,maxUsdPerUtcDay:usd(cap)>=usd('0.5')?'0.05':cap},
        backfill:{maxItemsPerUtcDay:100,maxUsdPerUtcDay:usd(cap)>=usd('0.5')?'0.5':cap,maxUsdTotal:cap}},
      backfillTargets:[{canonicalPath:f.path,...target,intents:['current','history']}],priceTable,
      ...((options.enabled??enabled)?{backfillRecovery:recovery}:{})});
  };
  const maintainerCredential={opaque:randomUUID()};
  const maintainerOptions=()=>({supervisor,path:f.path,version:'context-read-v1',profile:PRODUCT_PROFILE,readSet:target.readSet,sidecarJournalMode:journal,wal:journal==='WAL',ownerCoverage:coverage,
    semanticConfig:{version:'context-read-product-p2e-v1',coordinator},
    host:{moduleUrl:import.meta.url,configuration:{state:state.buffer,serviceBinding:{kind:'service',ownerId,serviceId:randomUUID(),
      credentialBindingId:randomUUID(),credentialExpiresUtcMs:null,credentialDigest:credentialDigest(maintainerCredential),namespaces:{readSet:[ns],ownerCoverage:coverage},issuedAt:0}}}});
  const refresh=(intent='current',mode='embeddings',maxUsd='0.5')=>maintainer.refreshContextIndex({...target,intent,mode,budget:{maxItems:64,maxMs:4500,
    ...(mode==='embeddings'?{maxUsd}:{})}},maintainerCredential);
  coordinator=await open();
  const set=(semantic,expectedRevision)=>coordinator.setOwnerSemantic({ownerId,semantic,expectedRevision},token);
  ok(await set(true,0));
  maintainer=await openContextIndexMaintainer(maintainerOptions());
  for(const intent of ['current','history'])ok(await refresh(intent,'lexical'));
  const row=()=>dbWork(ledgerPath,db=>({...db.prepare('SELECT sequence,state_digest,state FROM semantic_owners').get()}),true);
  const read=()=>JSON.parse(row().state);
  const anchor=()=>dbWork(anchorPath,db=>JSON.parse(db.prepare('SELECT anchor FROM anchors').get().anchor),true);
  const audits=()=>dbWork(anchorPath,db=>db.prepare('SELECT event FROM audits ORDER BY id').all().map(x=>JSON.parse(x.event)),true);
  function seed(change) {
    const s=read();change(s);const hash=stateDigest(s);
    dbWork(ledgerPath,db=>db.prepare('UPDATE semantic_owners SET state=?,state_digest=?').run(stateBytes(s),hash));
    dbWork(anchorPath,db=>db.prepare('UPDATE anchors SET anchor=?').run(canonicalJson({...anchor(),stateDigest:hash})));
  }
  function latch(amount='5') {
    seed(s=>{s.blocked=true;s.reservations[randomUUID()]={kind:'refresh',phase:'backfill',status:'settled',items:1,day:0,cost:encoder(amount)};});
  }
  function intent(extra={}) {
    const s=read();
    return {ownerId,idempotencyKey:randomUUID(),approvalId:randomUUID(),reason:'settled_latch',ticket:'CASE/123.ok',additionalUsd:'0.25',
      expected:{ledgerEpoch:s.ledgerEpoch,bindingRevision:s.bindingRevision,sequence:s.sequence,policyRevision:s.policy.revision,purgeEpoch:s.policy.purgeEpoch,
        targetSetDigest:s.targetSetDigest,embedderDigest:digest(semanticHandle(coordinator).providerIdentity),recoveryPolicyRevision:policy.revision},...extra};
  }
  function approve(input) {
    const {deadlineMs,...normalized}=input;
    normalized.additionalUsd=dollars(usd(normalized.additionalUsd));
    const requestDigest=digest([capability,identity.accountingDomainId,identity.ledgerId,normalized]);
    const query={ownerId,...identity,credentialBindingId:admin.credentialBindingId,requestDigest,approvalId:input.approvalId,ticket:input.ticket};
    const data=Buffer.from(JSON.stringify({query,value:{approvalId:input.approvalId,principalId:'approved-principal',operatorId:'approved-operator',
      expiresUtcMs:Date.now()+30000,requestDigest}}));
    const bytes=new Uint8Array(approval.buffer,4);Atomics.store(approval,0,0);bytes.set(data);Atomics.store(approval,0,data.length);
  }
  function arm(mode,input) {
    Atomics.store(control,index.sequence,(input?.expected.sequence??read().sequence)+1);Atomics.store(control,index.resume,0);
    Atomics.store(control,index.reached,0);Atomics.store(control,index.checkpoint,mode);
  }
  async function restart(options={}) {
    unpause();await maintainer?.close().catch(()=>{});maintainer=null;await coordinator.close().catch(()=>{});
    await supervisor.close().catch(()=>{});
    supervisor=createSupervisorRegistry().supervisor();
    Atomics.store(control,index.checkpoint,0);
    coordinator=await open(options);maintainer=await openContextIndexMaintainer(maintainerOptions());
  }
  const sidecar=(work,readOnly=false)=>dbWork(f.path+PRODUCT_SIDECAR_SUFFIX,work,readOnly);
  function overCapacity() {
    const secret=f.db.prepare('SELECT cursor_secret FROM store_metadata').get().cursor_secret;
    sidecar(db=>{
      const g=db.prepare("SELECT g.* FROM publications p JOIN generations g ON g.id=p.generation JOIN selections s ON s.projection=p.projection WHERE s.intent='history'").get();
      const verify=JSON.parse(g.verify);
      verify.counts.byType.memory={eligible:20001,indexed:20001};verify.counts.documents=20001;
      const incarnation=digest({seed:g.seed,id:g.id,projection:g.projection,sequence:g.sequence,baseSequence:g.base_sequence,kind:g.kind,access:g.access,
        fences:JSON.parse(g.fences),phase:g.phase,lastKey:g.last_key,verify});
      const {mac,...record}=JSON.parse(db.prepare('SELECT record FROM validation_records WHERE generation=?').get(g.id).record);
      record.generation.incarnation=incarnation;record.counts=verify.counts;
      db.prepare('UPDATE generations SET verify=?,incarnation=? WHERE id=?').run(JSON.stringify(verify),incarnation,g.id);
      db.prepare('UPDATE validation_records SET record=? WHERE generation=?').run(signedRecord(secret,'validation',record),g.id);
    });
  }
  return {f,memories,state,get coordinator(){return coordinator;},get credentialExpiresUtcMs(){return admin.expiresUtcMs;},
    row,read,anchor,audits,seed,latch,intent,approve,arm,restart,refresh,sidecar,overCapacity,set,
    settings:(key,value)=>value===undefined?Atomics.load(control,index[key]):Atomics.store(control,index[key],value),unpause,
    grant:async (input,credential=adminToken,options)=>{assert.equal(typeof coordinator[method],'function','the recovery capability is negotiated');return coordinator[method](input,credential,options);},
    ordinary:token,status:async()=>ok(await coordinator.getOwnerSemanticStatus({ownerId},token)),
    purge:()=>coordinator.purgeOwnerVectors({ownerId,budget:{maxItems:100,maxMs:4500}},token),
    validate:()=>coordinator.validateOwnerSemanticCoverage({ownerId,expectedTargetDigest:read().targetSetDigest,budget:{maxTargets:2,maxMs:4500}},token)};
}
