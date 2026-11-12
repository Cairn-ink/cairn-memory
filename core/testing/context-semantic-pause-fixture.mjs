import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fixture, ns, ok } from './context-read-fixture.mjs';
import { card } from './context-product-owner-fixture.mjs';
import { createExclusiveSqliteFile } from '../sqlite-journal-probe.mjs';
import { provisionSemanticOwner } from '../context-semantic-ledger.mjs';
import { canonicalJson } from '../context-product-validation.mjs';
import { credentialDigest, PRODUCT_PROFILE } from '../context-product-control.mjs';
import { openContextSemanticCoordinator, openContextIndexMaintainer, openContextProductReader, createContextReadSupervisor } from '../index.mjs';
export { ns, ok };
export const personal={...ns,scope:'personal',projectId:null};
export function control(db,namespace,{paused=0,enabled=1}={}) {
  db.prepare('INSERT INTO episode_controls(owner_id,scope,project_id,generation,paused,enabled) VALUES(?,?,?,?,?,?) ON CONFLICT(owner_id,scope,project_id) DO UPDATE SET paused=excluded.paused,enabled=excluded.enabled')
    .run(namespace.ownerId,namespace.scope,namespace.projectId??'','synthetic',paused,enabled);
}
const hostUrl=new URL('./context-semantic-host.mjs',import.meta.url).href;
export async function semanticFixture(t,readSet=[ns],configuration={}) {
  globalThis[Symbol.for('context-read-product-p2e-v1/physical-policy')]?.clear();
  const f=fixture(t,{cards:true});
  const memories=readSet.map(namespace=>f.admit('lexical needle',namespace));
  for(const namespace of readSet)card(f,namespace,'needle','synthetic body');
  f.core.close();
  if(configuration.transmissionSnapshot){const db=new DatabaseSync(f.path);try{assert.equal(db.prepare('PRAGMA journal_mode=WAL').get().journal_mode,'wal');}finally{db.close();}}
  const supervisor=createContextReadSupervisor();f.workspace.defer(()=>supervisor.close());
  const state=new SharedArrayBuffer(64),view=new Int32Array(state);view[0]=1;
  const anchorPath=join(f.workspace.path,'authority.sqlite'),ledgerPath=join(f.workspace.path,'ledger.sqlite');
  createExclusiveSqliteFile(anchorPath);const authority=new DatabaseSync(anchorPath);
  authority.exec('CREATE TABLE anchors(owner TEXT PRIMARY KEY,anchor TEXT NOT NULL) STRICT;CREATE TABLE enrollments(owner TEXT PRIMARY KEY) STRICT;');
  f.workspace.defer(()=>authority.close());
  const ledgerIdentity={accountingDomainId:'synthetic-accounting',ledgerId:'synthetic-ledger'};
  await provisionSemanticOwner({path:ledgerPath,identity:ledgerIdentity,ownerId:ns.ownerId,deadlineAt:Number(process.hrtime.bigint())/1e6+5000,
    enrollment:{authorizeNeverBound:owner=>!authority.prepare('SELECT 1 FROM enrollments WHERE owner=?').get(owner),createIfNeverBound(a){authority.exec('BEGIN IMMEDIATE');try{authority.prepare('INSERT INTO enrollments VALUES(?)').run(a.ownerId);authority.prepare('INSERT INTO anchors VALUES(?,?)').run(a.ownerId,canonicalJson(a));authority.exec('COMMIT');return true;}catch{authority.exec('ROLLBACK');return false;}}}});
  const token={opaque:randomUUID()},binding={kind:'semantic-service',serviceId:randomUUID(),credentialBindingId:randomUUID(),credentialExpiresUtcMs:null,credentialDigest:credentialDigest(token),ownerId:ns.ownerId,scope:'owner',issuedAt:0,
    methods:['setOwnerSemantic','getOwnerSemanticStatus','validateOwnerSemanticCoverage','purgeOwnerVectors'],...ledgerIdentity,ledgerEpoch:1,bindingRevision:1};
  const now=Date.now(),priceTable={authorityId:'synthetic-price',revision:'one',sequence:1,effectiveFromUtcMs:now-1000,effectiveUntilUtcMs:now+3600000,usdPerMillionInputTokens:{'text-embedding-3-small':'0.02'}};
  const selection={provider:'openai',model:'text-embedding-3-small',dimensions:1536,normalization:'l2',requestTimeoutMs:3000,maxBatchDocuments:64};
  const types=['memory','card'];
  const coordinator=await openContextSemanticCoordinator({version:'context-read-product-p2e-v1',supervisor,ledgerPath,ledgerIdentity,provider:selection,
    refreshCaps:{steady:{maxItemsPerUtcDay:2000,maxUsdPerUtcDay:'0.05'},backfill:{maxItemsPerUtcDay:20000,maxUsdPerUtcDay:'0.50',maxUsdTotal:'5'}},backfillTargets:[{canonicalPath:f.path,readSet,types,intents:['current','history']}],priceTable,
    host:{moduleUrl:new URL('./context-semantic-pause-host.mjs',import.meta.url).href,configuration:{semanticServiceBinding:binding,anchorPath,state,priceTable,pausePath:f.path,pauseNamespace:readSet.at(-1),...configuration}}});
  f.workspace.defer(()=>coordinator.close());
  ok(await coordinator.setOwnerSemantic({ownerId:ns.ownerId,semantic:true,expectedRevision:0},token));
  function configure(service) {
    const credential={opaque:randomUUID()},ids={requestId:randomUUID(),handleId:randomUUID(),credentialBindingId:randomUUID(),credentialExpiresUtcMs:null};
    const ownerCoverage={policy:'recent-projects-v1',selectionRevision:'synthetic',requestedNamespaces:readSet.length,selectedNamespaces:readSet.length,omittedNamespaces:0};
    const binding={kind:service?'service':'request',...(service?{serviceId:randomUUID(),credentialBindingId:ids.credentialBindingId,credentialExpiresUtcMs:null}:ids),credentialDigest:credentialDigest(credential),ownerId:ns.ownerId,namespaces:{readSet,ownerCoverage},issuedAt:0};
    return {credential,options:{supervisor,path:f.path,...(configuration.transmissionSnapshot?{wal:true}:{}),version:'context-read-v1',profile:PRODUCT_PROFILE,readSet,ownerCoverage,
      ...(service?{sidecarJournalMode:'DELETE'}:{requestControl:{...ids,requestMaxMs:5000}}),semanticConfig:{version:'context-read-product-p2e-v1',coordinator,...(service?{}:{queryEmbeddingMaxMs:3000,finalizeReserveMs:1000})},
      host:{moduleUrl:hostUrl,configuration:{[service?'serviceBinding':'requestBinding']:binding,state,...(service?{}:{requestReservation:new SharedArrayBuffer(4)})}}}};
  }
  const maintenance=configure(true),maintainer=await openContextIndexMaintainer(maintenance.options);f.workspace.defer(()=>maintainer.close());
  const projection={readSet,types,intent:'current'};
  async function refresh(mode='embeddings') {return ok(await maintainer.refreshContextIndex({...projection,mode,budget:{maxItems:1024,maxMs:5000,...(mode==='embeddings'?{maxUsd:'0.50'}:{})}},maintenance.credential));}
  await refresh('lexical');assert.equal((await refresh()).status,'complete');
  return {f,view,memories,refresh,ledgerPath,async query(raw=false){const r=configure(false),reader=await openContextProductReader(r.options);f.workspace.defer(()=>reader.close());const result=await reader.contextRead({...projection,query:'needle',semantic:true,deadlineMs:5000,budget:{maxTokens:4000,maxItems:12}},r.credential);return raw?result:ok(result);}};
}

export function reservations(s) {
  const db=new DatabaseSync(s.ledgerPath,{readOnly:true});
  try{return Object.keys(JSON.parse(db.prepare('SELECT state FROM semantic_owners WHERE owner_id=?').get(ns.ownerId).state).reservations).sort();}
  finally{db.close();}
}
