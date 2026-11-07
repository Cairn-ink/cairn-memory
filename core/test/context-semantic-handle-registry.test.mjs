import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { setupProductSemantic, ns, ok } from '../testing/content-safety-s2h-product-semantic-probe.mjs';
import { openContextIndexMaintainer, openContextSemanticCoordinator } from '../index.mjs';
import { semanticHandle } from '../context-semantic-coordinator.mjs';
import { semanticClient } from '../context-semantic-client.mjs';
import { admitMaintenance, maintenanceAdmissionReceipt } from '../context-product-admission.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { canonicalProductIdentity, productFile, PRODUCT_SIDECAR_SUFFIX } from '../context-product-sidecar.mjs';
import { digest } from '../context-product-validation.mjs';

const hostUrl=new URL('./fixtures/context-semantic-handle-host.mjs',import.meta.url).href;
async function bounded(promise,label) {
  const abort=new AbortController();
  try{return await Promise.race([promise,delay(15000,undefined,{signal:abort.signal}).then(()=>{throw Error('rendezvous timed out: '+label);})]);}
  finally{abort.abort();}
}
async function until(predicate,label) {
  let done=false;
  try{await bounded((async()=>{while(!done&&!predicate())await delay(2);})(),label);}
  finally{done=true;}
}
const inode=path=>String(statSync(path,{bigint:true}).ino);
async function fixture(t,{twoStores=false}={}) {
  const s=await bounded(setupProductSemantic(t,{open:false,corpus:1}),'fixture');
  // Build a genuine signed lexical publication, then copy it to a new inode.
  // Its authenticated record has a foreign physical binding, requiring repair.
  const configured=s.configure(true);delete configured.options.semanticConfig;
  const builder=await bounded(openContextIndexMaintainer(configured.options),'builder');
  s.f.workspace.defer(()=>builder.close());
  ok(await bounded(builder.refreshContextIndex({readSet:[ns],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:32,maxMs:5000}},configured.credential),'publication'));
  await bounded(builder.close(),'builder close');
  const paths=[s.f.path];
  if(twoStores){
    const second=join(s.f.workspace.path,'second.sqlite');copyFileSync(s.f.path,second);
    for(const suffix of [PRODUCT_SIDECAR_SUFFIX,PRODUCT_SIDECAR_SUFFIX+'.lifecycle-lock.sqlite'])copyFileSync(s.f.path+suffix,second+suffix);
    paths.push(second);
  }
  const side=s.f.path+PRODUCT_SIDECAR_SUFFIX,temporary=side+'.copy';copyFileSync(side,temporary);renameSync(temporary,side);
  s.options.backfillTargets=paths.map(canonicalPath=>({canonicalPath,readSet:[ns],types:['memory'],intents:['current','history']}));
  const coordinator=await bounded(openContextSemanticCoordinator(s.options),'coordinator');s.f.workspace.defer(()=>coordinator.close());
  ok(await bounded(coordinator.setOwnerSemantic({ownerId:ns.ownerId,semantic:true,expectedRevision:0},s.token),'enable'));
  const handle=semanticHandle(coordinator),port=handle.attach({ownerId:ns.ownerId,path:s.f.path,readSet:[ns],maintenance:true});
  // Catalog each store through its own authenticated attachment, as product
  // readers do; neither catalog nor target description opens a sidecar.
  port.close();
  for(const path of paths) {
    const channel=handle.attach({ownerId:ns.ownerId,path,readSet:[ns],maintenance:true});s.f.workspace.defer(()=>channel.close());
    const client=semanticClient(channel,{ownerState:handle.ownerState,writer:'0'},()=>({operationId:randomUUID(),operationCutoffMonoNs:String(process.hrtime.bigint()+5000000000n)}));
    const facade=openContextProductFacade(path,{});
    let entry;
    try {
      const storeId=facade.port.identity.storeId,canonicalIdentity=canonicalProductIdentity(path,facade.port.db),sidecarIdentity=productFile(path+PRODUCT_SIDECAR_SUFFIX);
      entry={canonicalPath:path,ownerId:ns.ownerId,storeId,canonicalIdentity,sidecarIdentity,sidecarJournalMode:'DELETE',catalogId:digest({storeId,canonicalIdentity,sidecarIdentity})};
    }finally{facade.close();}
    await bounded(client.call('catalog',entry),'catalog');
  }
  ok(await bounded(coordinator.setOwnerSemantic({ownerId:ns.ownerId,semantic:false,expectedRevision:1},s.token),'disable'));
  async function lexical(path,control) {
    const c=s.configure(true);delete c.options.semanticConfig;c.options.path=path;
    c.options.host={moduleUrl:hostUrl,configuration:{...c.options.host.configuration,replacementControl:control}};
    const h=await bounded(openContextIndexMaintainer(c.options),'lexical open');s.f.workspace.defer(()=>h.close());
    return {h,admit:()=>bounded(admitMaintenance(h,{readSet:[ns],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:32,maxMs:5000}},c.credential),'lexical admission')};
  }
  const purge=()=>bounded(coordinator.purgeOwnerVectors({ownerId:ns.ownerId,budget:{maxItems:32,maxMs:5000}},s.token),'purge');
  return {...s,coordinator,paths,lexical,purge};
}

test('idle writable semantic views block lexical foreign-binding repair in every store domain',async t=>{
  const s=await fixture(t,{twoStores:true});ok(await s.purge());
  for(const path of s.paths) {
    const buffer=new SharedArrayBuffer(16),state=new Int32Array(buffer),side=path+PRODUCT_SIDECAR_SUFFIX,before=inode(side);
    const lexical=await s.lexical(path,buffer),result=await lexical.admit();
    t.diagnostic(JSON.stringify({receipt:maintenanceAdmissionReceipt(result),replacementHelpers:state[0],sameInode:inode(side)===before}));
    assert.notEqual(maintenanceAdmissionReceipt(result),'admitted','repair must defer while the semantic view is idle and open');
    assert.equal(state[0],0,'no native replacement helper, hence zero renames');assert.equal(inode(side),before,'the original sidecar inode remains');
    await bounded(lexical.h.close(),'lexical close');
  }
  await bounded(s.coordinator.close(),'semantic close');
  // Proven Worker exit reclaims reservations; repair is possible afterwards.
  const buffer=new SharedArrayBuffer(16),lexical=await s.lexical(s.paths[0],buffer);
  assert.equal(maintenanceAdmissionReceipt(await lexical.admit()),'admitted');assert.equal(new Int32Array(buffer)[0],1);
});

test('semantic opening refuses while the lexical Worker holds replacement exclusion',async t=>{
  const s=await fixture(t),buffer=new SharedArrayBuffer(16),state=new Int32Array(buffer);state[1]=1;
  // Always release the native helper even when an assertion fails.
  s.f.workspace.defer(()=>{Atomics.store(state,3,1);Atomics.notify(state,3);});
  const lexical=await s.lexical(s.paths[0],buffer),repair=lexical.admit();
  await until(()=>Atomics.load(state,2)===1,'replacement exclusion');
  try {
    const result=await s.purge();
    t.diagnostic(JSON.stringify({purgeOk:result.ok,error:result.error?.code,exclusionHeld:Atomics.load(state,3)===0}));
    assert.equal(result.ok,false,'opening must refuse before a sidecar native connection is opened');
    assert.equal(Atomics.load(state,3),0,'lexical exclusion remains held throughout opening');
  }finally{Atomics.store(state,3,1);Atomics.notify(state,3);}
  assert.equal(maintenanceAdmissionReceipt(await repair),'admitted');assert.equal(state[0],1);
});
