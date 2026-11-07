import { testClock } from '../testing/context-product-test-clock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { openMemoryCore } from '../index.mjs';
import { configured, personal } from '../testing/context-product-owner-fixture.mjs';
import { admitMaintenance, refreshMaintenance, maintenanceAdmissionReceipt, PRODUCT_SIDECAR_SUFFIX } from '../context-product-admission.mjs';
import { maintenanceObservation, maintenanceFailureDiagnostic } from '../context-product-reader.mjs';
import { createMaintenancePumpRuntime, maintenancePumpDiagnostic } from '../context-product-pump.mjs';
import { randomUUID } from 'node:crypto';
import { attestCopiedSidecar } from '../testing/context-product-attested-copy-fixture.mjs';
const input={readSet:[personal],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:32,maxMs:1000}};
function child(code,...args){
  const r=spawnSync(process.execPath,['--input-type=module','-e',code,...args],{encoding:'utf8'});
  assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr);return r.stdout.trim();
}
function inspect(path){return JSON.parse(child(`import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync(process.argv[1],{readOnly:true});try{console.log(JSON.stringify({metadata:d.prepare('SELECT * FROM product_metadata').get(),publications:d.prepare('SELECT COUNT(*) AS n FROM publications').get().n,work:d.prepare('SELECT COUNT(*) AS n FROM work').get().n,vectors:d.prepare('SELECT COUNT(*) AS n FROM semantic_vectors').get().n,version:d.prepare('PRAGMA user_version').get().user_version,quick:d.prepare('PRAGMA quick_check').get().quick_check}));}finally{d.close();}`,path+PRODUCT_SIDECAR_SUFFIX));}
async function copied(t,{checkpoint=false,mutate=''}={}){
  const workspace=createTestWorkspace(null,{prefix:'foreign-binding-'}),owned=lstatSync(workspace.path),closing=[];
  workspace.onCleanup=fn=>closing.push(fn);
  t.after(async()=>{
    for(const close of closing.reverse())await close();
    child(`import {lstatSync,rmSync} from 'node:fs';import assert from 'node:assert/strict';const p=process.argv[1],s=lstatSync(p);assert.ok(s.isDirectory()&&!s.isSymbolicLink());assert.equal(String(s.dev),process.argv[2]);assert.equal(String(s.ino),process.argv[3]);rmSync(p,{recursive:true});`,workspace.path,String(owned.dev),String(owned.ino));
  });
  const original=join(workspace.path,'canonical.sqlite');
  const core=openMemoryCore({path:original});
  try{for(const text of ['first foreign-binding canary','second foreign-binding canary'])assert.equal(core.admit({namespace:personal,memory:{content:text,kind:'fact'},receipts:[{client:'synthetic',sessionId:'binding',eventId:text,role:'user',excerpt:text}]}).ok,true);}finally{core.close();}
  const source=configured(t,original,[personal],{service:true});workspace.onCleanup(()=>source.supervisor.close());const builder=await source.open();
  try{const r=await builder.refreshContextIndex({...input,budget:{...input.budget,maxItems:checkpoint?1:32}},source.token);assert.equal(r.ok,true);assert.equal(r.value.status,checkpoint?'rebuilding':'complete');}finally{await builder.close();await source.supervisor.close();}
  // All canonical and sidecar engine connections have closed. File operations
  // and independent database inspection run only in children.
  const directory=join(workspace.path,'copy');mkdirSync(directory,{mode:0o700});
  child(`import {execFileSync} from 'node:child_process';execFileSync('cp',process.argv.slice(1));`,original,original+PRODUCT_SIDECAR_SUFFIX,directory);
  const path=join(directory,'canonical.sqlite');
  child(`import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync(process.argv[1]);try{d.exec("INSERT INTO semantic_vectors VALUES(1,1,'synthetic','identity',1,'item',1,1,'representation',x'00',x'01')");${mutate}}finally{d.close();}`,path+PRODUCT_SIDECAR_SUFFIX);
  attestCopiedSidecar(path);
  const before=inspect(path),service=configured(t,path,[personal],{service:true}),control=new Int32Array(new SharedArrayBuffer(64));
  workspace.onCleanup(()=>service.supervisor.close());
  service.options.host={moduleUrl:new URL('./fixtures/context-product-foreign-binding-host.mjs',import.meta.url).href,configuration:{...service.options.host.configuration,bindingControl:control.buffer}};
  return {path,before,service,control,workspace};
}
for(const checkpoint of [false,true])test(`real Worker: foreign ${checkpoint?'checkpoint':'publication'} is replaced before zero-observation admission`,async t=>{
  const {path,before,service,control}=await copied(t,{checkpoint}),h=await service.open();
  for(let i=0;i<8;i++)Atomics.store(control,i,0);
  const admitted=await admitMaintenance(h,input,service.token);assert.equal(admitted.ok,true,JSON.stringify(admitted));
  assert.equal(maintenanceAdmissionReceipt(admitted),'admitted');assert.equal(maintenanceObservation(admitted),undefined);
  assert.equal(control[2],0);assert.equal(control[3],0);assert.equal(control[14],2,'old and replacement opens each read the seal');assert.equal(control[4],2,'old and replacement writable opens belong only to admission');
  assert.ok(control[7]>20,'replacement child SQL is included in the census');
  console.log('FOREIGN_BINDING_ADMISSION_COUNTS '+JSON.stringify({checkpoint,statements:control[0]+control[1]+control[7],workerExecuted:control[0],workerExecStatements:control[1],childExecutedCalls:control[6],childStatements:control[7],quick:control[2],foreignKey:control[3],writableOpens:control[4],certificateQueries:control[5]}));
  // Close before inspecting files, then use a fresh admission to test later work.
  await h.close();const empty=inspect(path);
  assert.notEqual(empty.metadata.incarnation,before.metadata.incarnation);assert.equal(empty.publications,0);assert.equal(empty.work,0);assert.equal(empty.vectors,0);assert.equal(empty.version,before.version);assert.equal(empty.quick,'ok');
  const next=await service.open();assert.equal((await admitMaintenance(next,input,service.token)).ok,true);
  const opens=control[4],work=await refreshMaintenance(next,input,service.token);
  assert.equal(work.ok,true);assert.equal(work.value.status,'complete');assert.equal(control[4],opens,'work performs no fresh writable open');assert.equal(maintenanceObservation(work),testClock.now());
  await next.close();
});
for(const fault of [1,2])test(`real Worker: repaired cache refuses ${fault===1?'a malformed seal':'an invalid stamp'}`,async t=>{
  const {service,control}=await copied(t);control[8]=fault;const h=await service.open();
  const r=await admitMaintenance(h,input,service.token);assert.equal(r.ok,false);assert.equal(r.error.code,'index_unavailable');assert.equal(maintenanceAdmissionReceipt(r),undefined);assert.equal(maintenanceObservation(r),undefined);
  assert.equal(maintenanceFailureDiagnostic(r)?.reason,'other','seal rejection is attestation_invalid (private diagnostic: other), never wrong_store');
  assert.equal(control[2],0);assert.equal(control[3],0);assert.equal(control[14],2);assert.equal(control[4],2);await h.close();
});
for(const checkpoint of [false,true])test(`real Worker: authentication refuses tampered ${checkpoint?'progress':'publication'} before replacement`,async t=>{
  const table=checkpoint?'progress_records':'validation_records';
  const {path,before,service,control}=await copied(t,{checkpoint,mutate:`d.exec("UPDATE ${table} SET record=replace(record,'mac','bad')");`});
  const h=await service.open(),r=await admitMaintenance(h,input,service.token);
  assert.equal(r.ok,false);assert.equal(r.error.code,'index_unavailable');assert.equal(maintenanceAdmissionReceipt(r),undefined);assert.equal(control[4],1);
  await h.close();assert.equal(inspect(path).metadata.incarnation,before.metadata.incarnation,'unauthenticated metadata never authorizes replacement');
});
for(const fault of ['cutoff','authority'])test('real Worker: foreign repair retains original '+fault,async t=>{
  const {path,before,service,control}=await copied(t);control[fault==='cutoff'?9:10]=1;const h=await service.open();
  const r=await admitMaintenance(h,input,service.token);assert.equal(r.ok,false);assert.equal(r.error.code,fault==='cutoff'?'read_timeout':'scope_changed');
  assert.equal(maintenanceAdmissionReceipt(r),undefined);assert.equal(maintenanceObservation(r),undefined);await h.close();
  if(fault==='cutoff')assert.equal(inspect(path).metadata.incarnation,before.metadata.incarnation,'expired admission cannot replace');
});

for(const protection of ['companion','journal'])test('real Worker: foreign repair preserves '+protection+' refusal',async t=>{
  const {path,before,service,control}=await copied(t);
  if(protection==='companion')child("import {symlinkSync} from 'node:fs';symlinkSync('missing',process.argv[1]+'-wal');",path+PRODUCT_SIDECAR_SUFFIX);
  else {service.options.wal=true;child("import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync(process.argv[1]);try{d.exec('PRAGMA journal_mode=WAL');}finally{d.close();}",path+PRODUCT_SIDECAR_SUFFIX);}
  const h=await service.open(),r=await admitMaintenance(h,input,service.token);
  assert.equal(r.ok,false);assert.equal(r.error.code,'index_unavailable');assert.equal(maintenanceAdmissionReceipt(r),undefined);assert.ok(control[4]<=1);
  await h.close();
  if(protection==='companion')child("import {unlinkSync} from 'node:fs';unlinkSync(process.argv[1]+'-wal');",path+PRODUCT_SIDECAR_SUFFIX);
  assert.equal(inspect(path).metadata.incarnation,before.metadata.incarnation);
});

test('real Worker: lifecycle exclusion prevents foreign replacement until the lock is released',async t=>{
  const {path,before,service}=await copied(t),lock=path+PRODUCT_SIDECAR_SUFFIX+'.lifecycle-lock.sqlite';
  const blocker=spawn(process.execPath,['--input-type=module','-e',`import {DatabaseSync} from 'node:sqlite';import {chmodSync} from 'node:fs';const d=new DatabaseSync(process.argv[1]);chmodSync(process.argv[1],0o600);d.exec('BEGIN EXCLUSIVE');process.once('message',()=>{d.close();process.disconnect();});process.send('locked');`,lock],{stdio:['ignore','ignore','inherit','ipc']});
  const exited=new Promise((resolve,reject)=>{blocker.once('error',reject);blocker.once('exit',(code,signal)=>resolve({code,signal}));});
  await Promise.race([new Promise(resolve=>blocker.once('message',resolve)),exited.then(r=>{throw Error('lock child exited early '+JSON.stringify(r));})]);
  try{const h=await service.open(),r=await admitMaintenance(h,input,service.token);assert.equal(r.ok,false);assert.equal(r.error.code,'storage_busy');await h.close();}
  finally{blocker.send('release');assert.deepEqual(await exited,{code:0,signal:null});}
  assert.equal(inspect(path).metadata.incarnation,before.metadata.incarnation);
  const h=await service.open();assert.equal(maintenanceAdmissionReceipt(await admitMaintenance(h,input,service.token)),'admitted');await h.close();assert.notEqual(inspect(path).metadata.incarnation,before.metadata.incarnation);
});

test('real Worker: repeated resident invalidation fails at three while history observes',async t=>{
  const {service,control,workspace}=await copied(t),timers=new Map();let serial=0,history=0,required=0;
  const runtime=createMaintenancePumpRuntime({now:testClock.now,
    setTimer:(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:testClock.now()+ms});return id;},clearTimer:id=>timers.delete(id),
    work:async(h,input,...args)=>{
      Atomics.store(control,11,Number(input.intent==='current'));
      try{
        const r=await refreshMaintenance(h,input,...args);
        if(maintenanceAdmissionReceipt(r)==='required')required++;
        if(input.intent==='history'&&Number.isFinite(maintenanceObservation(r)))history++;
        return r;
      }finally{Atomics.store(control,11,0);}
    }});
  const p=runtime({supervisor:service.supervisor,id:randomUUID(),serviceCredential:service.token,
    window:{id:randomUUID(),endsAtMonoMs:Math.floor(testClock.now())+60000,usedItems:0,usedMs:0},
    budgets:{maxItems:2048,maxMs:60000},quantum:{maxItems:32,maxMs:1000},pollMs:25,renewalMs:60000,
    projections:[{options:service.options,types:['memory']}]});workspace.onCleanup(()=>p.close());
  for(let n=0;n<20&&p.getStatus().state==='active';n++){
    const [id,timer]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];timers.delete(id);
    await testClock.advance(timer.at-testClock.now());await timer.fn();
    if(required===1){const s=p.getStatus();assert.equal(s.state,'active');assert.deepEqual(maintenancePumpDiagnostic(s).admission[0].noProgress,{lane:0,count:1});}
  }
  const status=await p.completion,d=maintenancePumpDiagnostic(status);
  assert.equal(status.state,'failed');assert.equal(status.error,'reader_failed');assert.equal(required,3);assert.ok(history>=2);
  assert.equal(d.lastFailure.cause,'admission_no_progress');assert.equal(d.lastFailure.lane,0);assert.equal(d.lastFailure.count,3);
});

test('real Worker: foreign publication cannot bypass authentication of a later progress certificate',async t=>{
  const {path,before,service,control}=await copied(t,{mutate:`d.exec("INSERT INTO work SELECT projection,generation FROM publications; INSERT OR REPLACE INTO progress_records SELECT generation,'{}' FROM work");`});
  const h=await service.open(),r=await admitMaintenance(h,input,service.token);
  assert.equal(r.ok,false);assert.equal(r.error.code,'index_unavailable');assert.equal(maintenanceAdmissionReceipt(r),undefined);assert.equal(control[4],1);
  await h.close();assert.equal(inspect(path).metadata.incarnation,before.metadata.incarnation);
});

for(const proof of [1,2])test(`real Worker: lifecycle replacement refuses ${proof===1?'changed':'missing'} authenticated certificate basis`,async t=>{
  const {path,before,service,control}=await copied(t);control[12]=proof;
  const h=await service.open(),r=await admitMaintenance(h,input,service.token);
  assert.equal(r.ok,false);assert.equal(r.error.code,'index_unavailable');assert.equal(maintenanceAdmissionReceipt(r),undefined);
  assert.equal(control[13],1);assert.equal(control[4],1,'refused replacement cannot reopen a successor');
  await h.close();assert.equal(inspect(path).metadata.incarnation,before.metadata.incarnation);
});

for(const checkpoint of [false,true])test(`real Worker: retained foreign ${checkpoint?'progress':'publication'} certificate repairs even without a live pointer`,async t=>{
  const {path,before,service}=await copied(t,{checkpoint,mutate:`d.exec('DELETE FROM publications; DELETE FROM work');`});
  assert.equal(before.publications,0);assert.equal(before.work,0);assert.equal(before.vectors,1);
  const h=await service.open(),r=await admitMaintenance(h,input,service.token);
  assert.equal(r.ok,true,JSON.stringify(r));assert.equal(maintenanceAdmissionReceipt(r),'admitted');assert.equal(maintenanceObservation(r),undefined);
  await h.close();const after=inspect(path);
  assert.notEqual(after.metadata.incarnation,before.metadata.incarnation);assert.equal(after.vectors,0);assert.equal(after.publications,0);assert.equal(after.work,0);
});
