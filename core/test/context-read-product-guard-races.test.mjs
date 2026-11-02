import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { Worker } from 'node:worker_threads';
import fs, { writeFileSync,unlinkSync,renameSync,chmodSync,symlinkSync,existsSync,linkSync } from 'node:fs';
import { dirname } from 'node:path';
import { fixture,ns,ok } from '../testing/context-read-fixture.mjs';
import { configured,descriptor } from '../testing/context-product-owner-fixture.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { productSidecar,PRODUCT_SIDECAR_SUFFIX } from '../context-product-sidecar.mjs';
import { accessDigest } from '../context-product-validation.mjs';
import { assertContextReadCanonicalDelete,contextReadDeleteJournal } from '../context-read-sidecar.mjs';
import { createProductReaderRuntime } from '../context-product-reader.mjs';
import { nativeObserver } from '../context-product-telemetry.mjs';

const other={...ns,ownerId:'synthetic-guard-writer'};
const input={readSet:[ns],types:['memory'],intent:'current',deadlineMs:5000};
const p={readSet:[ns],types:['memory'],intent:'current',ownerCoverage:descriptor([ns])};
const refresh={readSet:[ns],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:1024,maxMs:5000}};
const nativeSpawn=childProcess.spawnSync;
function intercept(t,work) {
  t.mock.method(childProcess,'spawnSync',function(...args) {
    if(args[1]?.[2]?.includes('header[18]'))return work(args,()=>Reflect.apply(nativeSpawn,this,args));
    return Reflect.apply(nativeSpawn,this,args);
  });syncBuiltinESMExports();
  t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
}
function setup(t,kind) {
  const f=fixture(t);f.admit('guard race needle');
  if(kind==='canonical')return {path:f.path,check:()=>assertContextReadCanonicalDelete(f.path)};
  const facade=openContextProductFacade(f.path,{}),access=accessDigest({ownerId:ns.ownerId,namespaces:{readSet:[ns]}});
  const options={path:f.path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features};
  const writer=productSidecar({...options,writable:true});
  try {let complete=false;for(let i=0;i<100;i++){writer.refresh(p,access,{maxItems:1024,maxMs:5000});if(writer.observe(p,access).publication){complete=true;break;}}assert.equal(complete,true);}
  finally {writer.close();}
  const storage=productSidecar(options);t.after(()=>{storage.close();facade.close();});
  return {path:f.path+PRODUCT_SIDECAR_SUFFIX,check:()=>{
    const observed=storage.observe(p,access);
    if(observed.dto.lexical.state==='unavailable')throw Object.assign(Error('index_unavailable'),{code:'index_unavailable',reason:observed.dto.lexical.reason});
    return observed;
  }};
}
for(const kind of ['canonical','sidecar'])for(const race of ['journal removed','journal replaced','replacement mode','replacement hard link','replacement symlink','replacement with wal','journal mode','journal symlink','wal appears','shm appears','opened inode swapped'])
test(`guard proof: ${kind}, ${race}`,t=>{
  const s=setup(t,kind),journal=s.path+'-journal';writeFileSync(journal,'synthetic protected journal',{mode:0o600});
  let reached=false;
  intercept(t,(args,run)=>{
    reached=true;
    if(race==='opened inode swapped') {
      const copy=nativeSpawn(process.execPath,[new URL('./fixtures/context-product-wal-process.mjs',import.meta.url).pathname,'copy',s.path,s.path+'.replacement'],{env:{},encoding:'utf8',timeout:5000,maxBuffer:1024});
      assert.equal(copy.status,0,copy.stderr);renameSync(s.path,s.path+'.original');renameSync(s.path+'.replacement',s.path);
      try{return run();}finally{renameSync(s.path,s.path+'.replacement');renameSync(s.path+'.original',s.path);}
    }
    const result=run();
    if(race==='journal removed')unlinkSync(journal);
    if(race==='journal replaced'||race.startsWith('replacement ')) {
      renameSync(journal,journal+'.old');
      if(race==='replacement hard link') {
        writeFileSync(journal+'.linked','replacement',{mode:0o600});linkSync(journal+'.linked',journal);
      } else if(race==='replacement symlink')symlinkSync(journal+'.old',journal);
      else writeFileSync(journal,'replacement',{mode:race==='replacement mode'?0o644:0o600});
      if(race==='replacement with wal')writeFileSync(s.path+'-wal','synthetic companion',{mode:0o600});
    }
    if(race==='journal mode')chmodSync(journal,0o644);
    if(race==='journal symlink'){unlinkSync(journal);symlinkSync(s.path,journal);}
    if(race==='wal appears'||race==='shm appears')writeFileSync(s.path+(race==='wal appears'?'-wal':'-shm'),'synthetic companion',{mode:0o600});
    return result;
  });
  try {
    const busy=race==='journal removed'||race==='journal replaced';
    const reason=kind==='sidecar'?'storage_unavailable':
      race==='journal mode'?'unsafe_file':'auxiliary_file';
    assert.throws(s.check,busy?{code:'storage_busy'}:{code:'index_unavailable',reason},
      race==='journal replaced'?'protected replacement stays contention':
        kind==='canonical'&&['replacement mode','replacement symlink','journal symlink'].includes(race)?'replacement recheck failures use auxiliary_file':
        'passing control: disappearance stays contention and unsafe replacements retain their refusal');
    assert.equal(reached,true,'mutation occurs across the actual header child');
  } finally {for(const suffix of ['-journal','-wal','-shm'])if(existsSync(s.path+suffix))unlinkSync(s.path+suffix);}
});

for(const kind of ['canonical','sidecar'])test(`guard replacement recheck: ${kind}, second replacement refuses`,t=>{
  const s=setup(t,kind),journal=s.path+'-journal';writeFileSync(journal,'first',{mode:0o600});
  const native=fs.lstatSync;let afterChild=false,samples=0;
  intercept(t,(args,run)=>{
    const result=run();renameSync(journal,journal+'.old');writeFileSync(journal,'replacement',{mode:0o600});
    afterChild=true;return result;
  });
  t.mock.method(fs,'lstatSync',function(path,...args){
    const value=Reflect.apply(native,this,[path,...args]);
    if(afterChild&&path===journal&&++samples===1) {
      renameSync(journal,journal+'.replacement');writeFileSync(journal,'second replacement',{mode:0o600});
    }
    return value;
  });syncBuiltinESMExports();
  try {
    assert.throws(s.check,{code:'index_unavailable',reason:kind==='canonical'?'auxiliary_file':'storage_unavailable'},
      'passing control: a second replacement retains the old refusal');
    assert.equal(samples,2,'replacement recheck takes exactly one final journal lstat');
  } finally {if(existsSync(journal))unlinkSync(journal);}
});

for(const kind of ['canonical','sidecar'])test(`guard replacement recheck: ${kind}, no in-process opens`,t=>{
  const s=setup(t,kind),journal=s.path+'-journal';writeFileSync(journal,'first',{mode:0o600});
  let opens=0;
  intercept(t,(args,run)=>{
    const result=run();renameSync(journal,journal+'.old');writeFileSync(journal,'replacement',{mode:0o600});
    for(const method of ['open','openSync']) {
      const native=fs[method];t.mock.method(fs,method,function(path,...rest){
        if(path===journal||path===s.path){opens++;throw Error('unexpected in-process database or journal open');}
        return Reflect.apply(native,this,[path,...rest]);
      });
    }
    syncBuiltinESMExports();return result;
  });
  try {
    assert.throws(s.check,{code:'storage_busy'},'metadata-only protected replacement remains contention');
    assert.equal(opens,0,'passing control: recheck opens neither the journal nor the database');
  } finally {if(existsSync(journal))unlinkSync(journal);}
});

for(const kind of ['canonical','sidecar'])test(`guard proof: ${kind}, real writer replaces journal during header child`,async t=>{
  const s=setup(t,kind),journal=s.path+'-journal',signal=s.path+'.rollover',completed=s.path+'.held';
  async function child(name,args) {
    const c=childProcess.fork(new URL('./fixtures/'+name,import.meta.url),args,{env:{},execArgv:[],stdio:['ignore','ignore','pipe','ipc']});
    let stderr='';c.stderr.on('data',b=>{stderr+=b;});
    const exited=once(c,'exit');let ended=false;c.once('exit',()=>{ended=true;});
    t.after(async()=>{if(!ended){c.kill();await exited;}});
    const ready=await once(c,'message');
    return {c,ready:ready[0],async close(command){c.send(command);assert.equal((await exited)[0],0,'passing control: child exits cleanly: '+stderr);}};
  }
  const writer=await child('context-product-journal-rollover.mjs',[s.path,kind,signal,completed]);
  assert.equal(writer.ready.held,true,'passing control: real writer holds its first transaction');
  const pin=await child('context-product-wal-process.mjs',['pin-journal',s.path]);
  assert.equal(pin.ready.ready,true,'passing control: isolated pin prevents journal inode reuse');
  const before=fs.lstatSync(journal,{bigint:true});let reached=false;
  intercept(t,(args,run)=>{
    const result=run();reached=true;writeFileSync(signal,'commit and begin',{mode:0o600});
    const deadline=Date.now()+5000;
    while(!existsSync(completed)) {
      assert.ok(Date.now()<deadline,'passing control: writer completes rollover inside the child window');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5);
    }
    assert.notEqual(fs.lstatSync(journal,{bigint:true}).ino,before.ino,'passing control: next real transaction has a new journal inode');
    return result;
  });
  assert.throws(s.check,{code:'storage_busy'},'real DELETE commit and next write remain contention, never index_unavailable');
  assert.equal(reached,true,'passing control: rollover occurs across the actual header child');
  await writer.close('close');await pin.close({id:1,command:'close'});
});

for(const kind of ['canonical','sidecar'])for(const race of ['main mode','main link','main replacement','directory mode','directory symlink'])
test(`guard caller baseline: ${kind}, ${race}`,t=>{
  const s=setup(t,kind),journal=s.path+'-journal',directory=dirname(s.path),original=directory+'.original';s.check();
  if(race==='main replacement') {
    const copy=nativeSpawn(process.execPath,[new URL('./fixtures/context-product-wal-process.mjs',import.meta.url).pathname,'copy',s.path,s.path+'.replacement'],{env:{},encoding:'utf8',timeout:5000,maxBuffer:1024});
    assert.equal(copy.status,0,copy.stderr);
  }
  writeFileSync(journal,'synthetic protected journal',{mode:0o600});const native=fs.lstatSync;let changed=false;
  t.mock.method(fs,'lstatSync',function(path,...args){
    if(!changed&&path===s.path&&new Error().stack.includes('contextReadDeleteJournal')) {
      changed=true;
      if(race==='main mode')chmodSync(s.path,0o644);
      if(race==='main link')linkSync(s.path,s.path+'.link');
      if(race==='main replacement'){renameSync(s.path,s.path+'.original');renameSync(s.path+'.replacement',s.path);}
      if(race==='directory mode')chmodSync(directory,0o755);
      if(race==='directory symlink'){renameSync(directory,original);symlinkSync(original,directory);}
    }
    return Reflect.apply(native,this,[path,...args]);
  });syncBuiltinESMExports();
  try {
    assert.throws(s.check,{code:'index_unavailable',reason:kind==='canonical'?'auxiliary_file':'storage_unavailable'},'helper samples must retain the caller protection proof');
    assert.equal(changed,true);
  } finally {
    t.mock.restoreAll();syncBuiltinESMExports();
    if(race==='directory symlink'&&changed){unlinkSync(directory);renameSync(original,directory);}
    if(race==='main replacement'&&changed){renameSync(s.path,s.path+'.replacement');renameSync(s.path+'.original',s.path);unlinkSync(s.path+'.replacement');}
    chmodSync(directory,0o700);chmodSync(s.path,0o600);
    if(existsSync(s.path+'.link'))unlinkSync(s.path+'.link');if(existsSync(journal))unlinkSync(journal);
  }
});

test('guard child timeout: remaining cutoff bounds spawn and timeout refuses',t=>{
  const f=fixture(t);let timeout;
  intercept(t,args=>{timeout=args[2].timeout;return {status:null,error:Object.assign(Error('synthetic timeout'),{code:'ETIMEDOUT'})};});
  assert.throws(()=>contextReadDeleteJournal(f.path,{journalRemainingMs:()=>37.9}),{code:'read_timeout'},'child timeout remains an operation refusal');
  assert.equal(timeout,37,'the child cannot retain the fixed maximum past the cutoff');
});
test('guard child timeout: expired cutoff does not spawn',t=>{
  const f=fixture(t);let calls=0;intercept(t,()=>{calls++;throw Error('unexpected spawn');});
  assert.throws(()=>contextReadDeleteJournal(f.path,{journalRemainingMs:()=>0}),{code:'read_timeout'});
  assert.equal(calls,0);
});
test('guard child timeout control: absent supplier retains capped refusal probe',t=>{
  const f=fixture(t);let timeout;intercept(t,(args,run)=>{timeout=args[2].timeout;return run();});
  assert.equal(contextReadDeleteJournal(f.path),true);assert.equal(timeout,5000);
});
test('guard residual control: in-place WAL switch after header read refuses on the next retry',t=>{
  const s=setup(t,'canonical'),journal=s.path+'-journal';writeFileSync(journal,'synthetic protected journal',{mode:0o600});
  let changed=false;
  intercept(t,(args,run)=>{
    const result=run();unlinkSync(journal);
    const change=nativeSpawn(process.execPath,[new URL('./fixtures/context-product-wal-process.mjs',import.meta.url).pathname,'mode',s.path,'WAL'],{env:{},encoding:'utf8',timeout:5000,maxBuffer:1024});
    assert.equal(change.status,0,change.stderr);changed=true;return result;
  });
  assert.throws(s.check,{code:'storage_busy'},'passing control: sampled journal still refuses after an in-place header change');
  assert.equal(changed,true);assert.equal(existsSync(journal),false);
  assert.throws(s.check,{code:'index_unavailable',reason:'auxiliary_file'},'passing control: retry without a journal reaches the WAL-header refusal');
});

const instrumented=maintenance=>createProductReaderRuntime({maintenance,spawnWorker:data=>new Worker(new URL('./fixtures/context-product-guard-race-worker.mjs',import.meta.url),{workerData:data,env:{},execArgv:[]})});
for(const kind of ['canonical','sidecar'])test(`guard commit sampling: ${kind} real writer commit cannot break the reader`,async t=>{
  const f=fixture(t);f.admit('commit race needle');f.admit('foreign writer needle',other);
  const seed=configured(t,f.path,[ns],{service:true}),builder=await seed.open();
  let complete=false;for(let i=0;i<100;i++)if(ok(await builder.refreshContextIndex(refresh,seed.token)).status==='complete'){complete=true;break;}
  assert.equal(complete,true);await builder.close();
  const state=new SharedArrayBuffer(8),view=new Int32Array(state),c=configured(t,f.path,[ns]);
  c.options.host.configuration.guardRace={path:(kind==='canonical'?f.path:f.path+PRODUCT_SIDECAR_SUFFIX)+'-journal',state};
  const h=await instrumented(false)(c.options);t.after(()=>h.close());ok(await h.getContextIndexStatus(input,c.token));
  const writer=new Worker(new URL('./fixtures/context-product-journal-writer.mjs',import.meta.url),{workerData:{path:f.path,namespace:other,kind,state},env:{},execArgv:[]});
  const exited=once(writer,'exit');exited.catch(()=>{});t.after(async()=>{Atomics.store(view,0,1);Atomics.notify(view,0);await writer.terminate();await exited.catch(()=>{});});
  assert.equal((await once(writer,'message'))[0].held,true);
  const result=await h.getContextIndexStatus(input,c.token);
  assert.deepEqual(result,{ok:false,error:{code:'storage_busy',retryable:true}},'commit after the validated sample must stay retryable, never reader_failed');
  assert.equal((await exited)[0],0);assert.equal((await h.getContextIndexStatus(input,c.token)).ok,true,'same reader stays usable after the foreign commit');await h.close();
});
for(const kind of ['canonical','sidecar'])test(`guard Worker cutoff supplier reaches ${kind} header child`,async t=>{
  const f=fixture(t);f.admit('deadline plumbing');
  const c=configured(t,f.path,[ns],{service:true}),state=new SharedArrayBuffer(4);c.options.host.configuration.guardTimeout=state;
  const h=await instrumented(true)(c.options);t.after(()=>h.close());
  for(let i=0;i<100;i++)if(ok(await h.refreshContextIndex(refresh,c.token)).status==='complete')break;
  const journal=(kind==='canonical'?f.path:f.path+PRODUCT_SIDECAR_SUFFIX)+'-journal';writeFileSync(journal,'synthetic protected journal',{mode:0o600});
  try {
    const result=await h.getContextIndexStatus({...input,deadlineMs:250},c.token),timeout=Atomics.load(new Int32Array(state),0);
    assert.ok(timeout>0&&timeout<=250,'Worker must pass remaining operation cutoff to its header child');
    assert.deepEqual(result,{ok:false,error:{code:'read_timeout',retryable:false}},'timed-out child never admits the status read');
  } finally {unlinkSync(journal);await h.close();}
});

for(const method of ['fetchCandidateEvidence','findCandidates','contextRead','getContextIndexStatus','refreshContextIndex'])
test(`guard timeout mapping: real Worker ${method}`,async t=>{
  const f=fixture(t),memory=f.admit('timeout mapping needle'),maintenance=method==='refreshContextIndex';
  const c=configured(t,f.path,[ns],{service:maintenance}),state=new SharedArrayBuffer(4);c.options.host.configuration.guardTimeout=state;
  const h=await instrumented(maintenance)(c.options);t.after(()=>h.close());
  const journal=f.path+'-journal';writeFileSync(journal,'synthetic protected journal',{mode:0o600});
  try {
    const payload=method==='fetchCandidateEvidence'?{readSet:[ns],intent:'current',deadlineMs:250,refs:[{type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision}]}:
      method==='refreshContextIndex'?{...refresh,budget:{maxItems:1024,maxMs:250}}:
      {...input,deadlineMs:250,...(method!=='getContextIndexStatus'?{query:'needle'}:{}),...(method==='contextRead'?{budget:{maxItems:8,maxTokens:2000}}:{})};
    const result=await h[method](payload,c.token);assert.ok(Atomics.load(new Int32Array(state),0)>0,'actual Worker guard reaches the header child seam');
    assert.deepEqual(result,{ok:false,error:{code:'read_timeout',retryable:false}},'every product method preserves the guard timeout');
  } finally {unlinkSync(journal);await h.close();}
});
test('guard timeout mapping: facade exact fetch preserves expired supplier',t=>{
  const f=fixture(t),memory=f.admit('expired guard'),observer=nativeObserver();observer.journalRemainingMs=()=>0;
  const facade=openContextProductFacade(f.path,{observer});writeFileSync(f.path+'-journal','synthetic protected journal',{mode:0o600});
  try {assert.deepEqual(facade.fetchCandidateEvidence({readSet:[ns],intent:'current',refs:[{type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision}]},{}),
    {ok:false,error:{code:'read_timeout',retryable:false}});}
  finally {unlinkSync(f.path+'-journal');facade.close();}
});
test('guard timeout mapping control: unrelated facade timeout remains storage_error',t=>{
  const f=fixture(t),memory=f.admit('non-guard timeout'),facade=openContextProductFacade(f.path,{authorize(){throw Object.assign(Error('synthetic host timeout'),{code:'read_timeout'});}});
  try {assert.deepEqual(facade.fetchCandidateEvidence({readSet:[ns],intent:'current',refs:[{type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision}]},{}),
    {ok:false,error:{code:'storage_error',retryable:false}});}
  finally {facade.close();}
});
