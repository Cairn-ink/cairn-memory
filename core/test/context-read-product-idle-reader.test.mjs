import { testClock } from '../testing/context-product-test-clock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { lstatSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { productSidecar } from '../context-product-sidecar.mjs';
import { attestCopiedSidecar } from '../testing/context-product-attested-copy-fixture.mjs';
import { openMemoryCore } from '../index.mjs';
import { configured, personal } from '../testing/context-product-owner-fixture.mjs';
import { admitMaintenance, refreshMaintenance, maintenanceAdmissionReceipt, PRODUCT_SIDECAR_SUFFIX } from '../context-product-admission.mjs';
import { createMaintenancePumpRuntime, maintenancePumpDiagnostic } from '../context-product-pump.mjs';

const input={readSet:[personal],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:32,maxMs:1000}};
async function copied(t,{idleProjection=false}={}) {
  const workspace=createTestWorkspace(null,{prefix:'idle-reader-'}),owned=lstatSync(workspace.path),closing=[];
  const owner={after:fn=>closing.push(fn)};
  t.after(async()=>{
    for(const close of closing.reverse())await close();
    const cleanup=spawnSync(process.execPath,['--input-type=module','-e',`import {lstatSync,rmSync} from 'node:fs';import assert from 'node:assert/strict';const p=process.argv[1],s=lstatSync(p);assert.equal(String(s.dev),process.argv[2]);assert.equal(String(s.ino),process.argv[3]);assert.ok(s.isDirectory()&&!s.isSymbolicLink());rmSync(p,{recursive:true});`,workspace.path,String(owned.dev),String(owned.ino)],{encoding:'utf8'});
    assert.equal(cleanup.status,0,cleanup.stderr);
  });
  const original=join(workspace.path,'core.sqlite');
  const core=openMemoryCore({path:original});
  try{assert.equal(core.admit({namespace:personal,memory:{content:'idle reader canary',kind:'fact'},receipts:[{client:'synthetic',sessionId:'idle',eventId:'idle',role:'user',excerpt:'idle'}]}).ok,true);}finally{core.close();}
  const source=configured(owner,original,[personal],{service:true}),builder=await source.open();
  assert.equal((await builder.refreshContextIndex(input,source.token)).value.status,'complete');
  await builder.close();await source.supervisor.close();
  const path=join(workspace.path,'copy','core.sqlite');
  // Copy only after the source's connections close, and only in a child.
  const copy=spawnSync(process.execPath,['--input-type=module','-e',`import {mkdirSync,copyFileSync} from 'node:fs';import {dirname} from 'node:path';mkdirSync(dirname(process.argv[2]),{mode:0o700});for(const suffix of ['',process.argv[3],process.argv[3]+'.lifecycle-lock.sqlite'])copyFileSync(process.argv[1]+suffix,process.argv[2]+suffix);`,original,path,PRODUCT_SIDECAR_SUFFIX],{encoding:'utf8'});
  assert.equal(copy.status,0,copy.stderr);
  attestCopiedSidecar(path);
  const control=new Int32Array(new SharedArrayBuffer(16)),service=configured(owner,path,[personal],{service:true}),request=configured(owner,path,[personal]);
  for(const c of [service,request])c.options.host={moduleUrl:new URL('./fixtures/context-product-idle-reader-host.mjs',import.meta.url).href,
    configuration:{...c.options.host.configuration,idleControl:control.buffer}};
  const reader=await request.open();
  // The copied cache has only current published. Observing absent history
  // retains a real idle handle without inspecting the foreign publication.
  const status=await reader.getContextIndexStatus({readSet:[personal],types:['memory'],intent:idleProjection?'history':'current',deadlineMs:5000},request.token);
  assert.equal(status.ok,true,JSON.stringify(status));
  assert.equal(status.value.lexical.reason,idleProjection?'missing':'validation_invalid');
  return {reader,request,service,control,after:owner.after};
}

test('real Worker: invalidated idle reader closes before replacement and reopens on its next read',async t=>{
  const {reader,request,service,control}=await copied(t),maintainer=await service.open();
  const openAfterInvalidation=control[0];
  const admitted=await admitMaintenance(maintainer,input,service.token);
  assert.equal(maintenanceAdmissionReceipt(admitted),'admitted',JSON.stringify(admitted));
  console.log(JSON.stringify({replacementCalls:control[1],sidecarConnectionsOpenAtReplacement:control[2],openAfterInvalidation,openAfterAdmission:control[0]}));
  assert.equal(control[1],1);
  assert.equal(control[2],0,'replacement must wait until every sidecar connection closes');
  assert.equal(openAfterInvalidation,0,'read-only validation_invalid disposes before returning');
  assert.equal((await refreshMaintenance(maintainer,input,service.token)).value.status,'complete');
  const opens=control[3],next=await reader.getContextIndexStatus({readSet:[personal],types:['memory'],intent:'current',deadlineMs:5000},request.token);
  assert.equal(next.ok,true,JSON.stringify(next));assert.equal(next.value.lexical.state,'ready');
  assert.equal(control[3],opens+1,'the next read reopens through ordinary connection admission');
  await reader.close();await maintainer.close();assert.equal(control[0],0);
});

for(const release of [false,true])test(`real Worker: retained idle handle ${release?'closes before the bound and repair converges':'prevents every replacement through terminal no-progress'}`,async t=>{
  const {reader,service,control,after}=await copied(t,{idleProjection:true});assert.equal(control[0],1);
  const timers=new Map();let serial=0,required=0,observations=0,checkedFirst=false;
  const runtime=createMaintenancePumpRuntime({now:testClock.now,
    setTimer:(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:testClock.now()+ms});return id;},clearTimer:id=>timers.delete(id),
    admit:async(...args)=>{const r=await admitMaintenance(...args);if(maintenanceAdmissionReceipt(r)==='required')required++;return r;},
    work:async(...args)=>{const r=await refreshMaintenance(...args);if(r.value?.status==='complete')observations++;return r;}});
  const pump=runtime({supervisor:service.supervisor,id:randomUUID(),serviceCredential:service.token,
    window:{id:randomUUID(),endsAtMonoMs:Math.floor(testClock.now())+60000,usedItems:0,usedMs:0},budgets:{maxItems:2048,maxMs:60000},
    quantum:{maxItems:32,maxMs:1000},pollMs:25,renewalMs:60000,projections:[{options:service.options,types:['memory']}]});
  after(()=>pump.close());
  for(let turn=0;turn<20&&pump.getStatus().state==='active';turn++){
    const [id,timer]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];timers.delete(id);
    await testClock.advance(timer.at-testClock.now());await timer.fn();
    if(required===1&&!checkedFirst){
      checkedFirst=true;
      assert.equal(pump.getStatus().state,'active');
      const d=maintenancePumpDiagnostic(pump.getStatus());
      assert.equal(d.admission.find(x=>x?.count===1)?.cause,'admission_no_progress');
      assert.equal(control[1],0,'first refusal never invokes replacement');
      if(release)await reader.close();
    }
    if(release&&observations>=2)break;
  }
  if(release){assert.equal(pump.getStatus().error,null);assert.ok(observations>=2,'both lanes converge');assert.equal(control[1],1);assert.equal(control[2],0);assert.ok(required<3);assert.ok(maintenancePumpDiagnostic(pump.getStatus()).admission.every(x=>x?.cause!=='admission_no_progress'),'accepted observations reset each lane');}
  else{
    const status=await pump.completion,d=maintenancePumpDiagnostic(status);
    assert.equal(status.state,'failed');assert.equal(status.error,'reader_failed');
    assert.equal(d.lastFailure.cause,'admission_no_progress');assert.equal(d.lastFailure.count,3);assert.equal(d.lastFailure.lane,0);
    assert.equal(control[1],0,'a retained handle never permits replacement');assert.equal(control[0],1);
  }
  console.log(JSON.stringify({release,required,replacementCalls:control[1],observations,lastFailure:maintenancePumpDiagnostic(pump.getStatus()).lastFailure}));
  await pump.close();await reader.close();assert.equal(control[0],0);
});


test('real Worker: a repeated direct close cannot erase a newer retained handle',async t=>{
  const {reader,service,control,after}=await copied(t,{idleProjection:true});
  assert.equal(control[0],1);
  const facade=openContextProductFacade(service.options.path,{});
  after(()=>facade.close());
  const make=()=>productSidecar({path:service.options.path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features});
  const retired=make();after(()=>retired.close());
  assert.equal(retired.prepareObservation(),null);retired.close();
  const retained=make();after(()=>retained.close());
  assert.equal(retained.prepareObservation(),null);
  let held;retained.vectors(db=>{held=db;return null;});assert.equal(held.isOpen,true);
  retired.close(); // This slot has been released and reused by retained.
  await reader.close();assert.equal(control[0],0);
  const maintainer=await service.open();
  const refused=await admitMaintenance(maintainer,input,service.token);
  assert.equal(maintenanceAdmissionReceipt(refused),'required',JSON.stringify(refused));
  assert.equal(held.isOpen,true);assert.equal(control[1],0);
  retained.close();assert.equal(held.isOpen,false);
  assert.equal(maintenanceAdmissionReceipt(await admitMaintenance(maintainer,input,service.token)),'admitted');
  assert.equal(control[1],1);assert.equal(control[2],0);
  console.log(JSON.stringify({repeatedClose:true,replacementCalls:control[1],retainedClosed:!held.isOpen}));
  await maintainer.close();assert.equal(control[0],0);
});
