import '../testing/context-product-test-clock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { setupProductSemantic, ns, ok } from '../testing/content-safety-s2h-product-semantic-probe.mjs';
import { openContextIndexMaintainer, openContextSemanticCoordinator } from '../index.mjs';
import { admitMaintenance, maintenanceAdmissionReceipt } from '../context-product-admission.mjs';
import { productFile, PRODUCT_SIDECAR_SUFFIX } from '../context-product-sidecar.mjs';
import { semanticMaintenance } from '../context-semantic-maintenance.mjs';
import { STORAGE_BUSY_TIMEOUT_MS } from '../database.mjs';

const input={readSet:[ns],types:['memory'],intent:'current'};
const budget={maxItems:32,maxMs:5000};
const replacementHost=new URL('./fixtures/context-semantic-handle-host.mjs',import.meta.url).href;
function database(path, work) {
  const db=new DatabaseSync(path);
  try{db.exec('PRAGMA busy_timeout='+STORAGE_BUSY_TIMEOUT_MS);return work(db);}finally{db.close();}
}
function ledger(s) {
  return database(s.ledgerPath,db=>JSON.parse(db.prepare('SELECT state FROM semantic_owners WHERE owner_id=?').get(ns.ownerId).state));
}
function inventory(s) {
  return database(s.f.path+PRODUCT_SIDECAR_SUFFIX,db=>{
    const direct={};
    for(const table of ['semantic_vectors','vector_generations','vector_publications','vector_validation_records'])
      direct[table]=db.prepare('SELECT count(*) n FROM '+table+' WHERE owner=?').get(ns.ownerId).n;
    direct.vector_rows=db.prepare('SELECT count(*) n FROM vector_rows r JOIN vector_generations g ON g.storage_id=r.generation WHERE g.owner=?').get(ns.ownerId).n;
    const independent={};
    for(const table of ['semantic_vectors','vector_generations','vector_publications','vector_validation_records'])
      independent[table]=db.prepare('SELECT * FROM '+table).all().filter(row=>row.owner===ns.ownerId).length;
    const generations=new Set(db.prepare('SELECT * FROM vector_generations').all().filter(row=>row.owner===ns.ownerId).map(row=>row.storage_id));
    independent.vector_rows=db.prepare('SELECT * FROM vector_rows').all().filter(row=>generations.has(row.generation)).length;
    assert.deepEqual(direct,independent,'two independent owner inventories cover five tables');
    return direct;
  });
}
function empty(s) {
  const counts=inventory(s);
  assert.equal(Object.keys(counts).length,5);
  for(const [table,count] of Object.entries(counts))assert.equal(count,0,table+' must be empty for the owner');
}
async function build(s,coordinator) {
  const m=s.configure(true);m.options.semanticConfig.coordinator=coordinator;
  const h=await openContextIndexMaintainer(m.options);s.f.workspace.defer(()=>h.close());
  try {
    for(const mode of ['lexical','embeddings']) {
      const result=ok(await h.refreshContextIndex({...input,mode,budget:{...budget,...(mode==='embeddings'?{maxUsd:'0.50'}:{})}},m.credential));
      assert.equal(result.status,'complete');
    }
  }finally{await h.close();}
  for(const count of Object.values(inventory(s)))assert.ok(count>0,'maintenance populated owner vectors and certificates');
}
async function populated(t) {
  const s=await setupProductSemantic(t,{corpus:2});
  ok(await s.coordinator.setOwnerSemantic({ownerId:ns.ownerId,semantic:true,expectedRevision:0},s.token));
  await build(s,s.coordinator);return s;
}
async function replaced(t,{staleFirst}={}) {
  const s=await populated(t),sidePath=s.f.path+PRODUCT_SIDECAR_SUFFIX;
  assert.equal(Object.keys(ledger(s).catalog).length,1);
  let coordinator=s.coordinator;
  // Digests depend on real file identities. If the desired order is absent,
  // retain every retired entry and replace again, rather than fabricating keys.
  for(let attempt=0;attempt<16;attempt++) {
    const old=ledger(s).catalog,before=productFile(sidePath);
    // Drain all owned handles, then use the existing damaged-metadata trigger
    // and native replacement observer. Never swap the file in the test.
    await coordinator.close();
    database(sidePath,db=>db.exec("UPDATE product_metadata SET store_id='damaged'"));
    const m=s.configure(true);delete m.options.semanticConfig;
    const control=new SharedArrayBuffer(16);
    m.options.host={moduleUrl:replacementHost,configuration:{...m.options.host.configuration,replacementControl:control}};
    const h=await openContextIndexMaintainer(m.options);s.f.workspace.defer(()=>h.close());
    try {
      const admitted=await admitMaintenance(h,{...input,mode:'lexical',budget},m.credential);
      ok(admitted);assert.equal(maintenanceAdmissionReceipt(admitted),'admitted');
      assert.equal(new Int32Array(control)[0],1,'engine invoked its whole-cache replacement helper');
    }finally{await h.close();}
    assert.notDeepEqual(productFile(sidePath),before,'engine replaced the physical file');
    for(const suffix of ['-journal','-wal','-shm'])assert.equal(productFile(sidePath+suffix,true),null);
    const aliases=readdirSync(s.f.workspace.path).filter(name=>{
      const stat=lstatSync(join(s.f.workspace.path,name),{bigint:true});
      return String(stat.dev)===before.device&&String(stat.ino)===before.inode;
    });
    assert.deepEqual(aliases,[],'replacement retained no reachable old inode in its directory');
    coordinator=await openContextSemanticCoordinator(s.options);
    const currentCoordinator=coordinator;s.f.workspace.defer(()=>currentCoordinator.close());
    await build(s,coordinator);
    const state=ledger(s),liveId=Object.keys(state.catalog).find(id=>!Object.hasOwn(old,id));
    assert.ok(liveId,'semantic maintenance cataloged the replacement');
    assert.equal(Object.keys(state.catalog).length,Object.keys(old).length+1);
    const oldId=Object.keys(old).find(id=>staleFirst===undefined||(Buffer.compare(Buffer.from(id),Buffer.from(liveId))<0)===staleFirst);
    if(!oldId)continue;
    t.diagnostic('actual digest order: '+(Buffer.compare(Buffer.from(oldId),Buffer.from(liveId))<0?'stale before live':'live before stale')+'; replacement cycles: '+(attempt+1));
    ok(await coordinator.setOwnerSemantic({ownerId:ns.ownerId,semantic:false,expectedRevision:1},s.token));
    return {...s,coordinator,oldId,liveId};
  }
  assert.fail('required digest order not observed in sixteen real replacements');
}

test('public disable purge completes after real engine replacement and permits re-enable',{timeout:30000},async t=>{
  const s=await replaced(t);
  let result;
  for(let n=0;n<8;n++) {
    result=ok(await s.coordinator.purgeOwnerVectors({ownerId:ns.ownerId,budget:{maxItems:1,maxMs:5000}},s.token));
    if(result.status==='complete')break;
  }
  assert.equal(result.status,'complete');empty(s);
  const state=ledger(s);
  for(const entry of Object.values(state.catalog))assert.deepEqual({epoch:entry.purge.epoch,complete:entry.purge.complete},{epoch:state.policy.purgeEpoch,complete:true});
  ok(await s.coordinator.setOwnerSemantic({ownerId:ns.ownerId,semantic:true,expectedRevision:2},s.token));
});

function localPurge(t,state) {
  const maintenance=semanticMaintenance({c:{host:{configuration:{}}},identity:()=>null});
  t.after(()=>maintenance.close());
  const current=async()=>({state});
  const change=async fn=>{const next=structuredClone(state);fn(next);state=next;return {state};};
  return {state:()=>state,run:()=>maintenance.purge({input:{budget},operation:{operationCutoffMonoNs:String(process.hrtime.bigint()+5000000000n)},current,change})};
}
for(const staleFirst of [true,false])test('purge visits real replaced entries in '+(staleFirst?'stale-before-live':'live-before-stale')+' order',{timeout:30000},async t=>{
  const s=await replaced(t,{staleFirst});await s.coordinator.close();
  const state=ledger(s),old=state.catalog[s.oldId];
  assert.equal(Buffer.compare(Buffer.from(s.oldId),Buffer.from(s.liveId))<0,staleFirst);
  old.purge={epoch:state.policy.purgeEpoch,deleted:7,complete:false};state.purge.deletedVectors=7;
  const p=localPurge(t,state),result=await p.run();
  assert.equal(result.status,'complete');empty(s);
  assert.deepEqual(p.state().catalog[s.oldId].purge,{epoch:state.policy.purgeEpoch,deleted:7,complete:true});
  assert.ok(p.state().purge.deletedVectors>7,'live vectors were deleted after visiting the gone entry');
});

test('null vector progress keeps a present matching file pending and retries honestly',{timeout:30000},async t=>{
  const s=await populated(t);
  ok(await s.coordinator.setOwnerSemantic({ownerId:ns.ownerId,semantic:false,expectedRevision:1},s.token));
  await s.coordinator.close();
  const state=ledger(s),before=inventory(s),p=localPurge(t,state),prepare=DatabaseSync.prototype.prepare;
  let refused=0;
  const hook=t.mock.method(DatabaseSync.prototype,'prepare',function(sql){
    const statement=Reflect.apply(prepare,this,[sql]);
    if(sql==="SELECT 1 FROM sqlite_schema WHERE name='vector_publications' AND type='table'") {
      refused++;return {get:()=>undefined};
    }
    return statement;
  });
  let result;
  try{result=await p.run();}finally{hook.mock.restore();}
  assert.equal(refused,1,'real storage.vectors returned null');
  assert.equal(result.status,'partial');assert.equal(p.state().purge.state,'pending');
  assert.ok(Object.values(p.state().catalog).every(entry=>!entry.purge?.complete));
  assert.deepEqual(inventory(s),before,'no deletion or invented completion on null progress');
  assert.equal((await p.run()).status,'complete');empty(s);
});
