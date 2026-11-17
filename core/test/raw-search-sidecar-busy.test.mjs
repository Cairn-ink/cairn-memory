import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { sourceFixture, savedSource, ns, ok, request, splitRaw } from '../testing/raw-source-fixtures.mjs';
import { searchFixture, broker } from '../testing/raw-search-fixtures.mjs';
import { installRawSearchTestClock, rawSearchTestWait } from '../testing/raw-search-clock.mjs';
import { openRawSearch } from '../raw-search-index.mjs';
import { createLocalRawSearch } from '../local-raw-search.mjs';
import { isStorageBusy } from '../database.mjs';
import { createFakeEmbedder } from '../context-read-embedder.mjs';

// Real clocks supervise children; only operation clocks are accelerated.
const nativeTimeout=globalThis.setTimeout;
const pause=ms=>new Promise(resolve=>nativeTimeout(resolve,ms));
const syncPause=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
const sentinel='Synthetic copper telescope.';
const policy={family:'local',maxBatchDocuments:1,maxRequests:1000,maxConcurrent:1,maxUsd:0};
test.beforeEach(installRawSearchTestClock);
test.beforeEach(t=>{
  const limit=Error.stackTraceLimit;Error.stackTraceLimit=50;
  t.after(()=>{Error.stackTraceLimit=limit;});
});

const childSource=`
import {DatabaseSync} from 'node:sqlite';
import {existsSync,writeFileSync} from 'node:fs';
const [path,mode,control]=process.argv.slice(1);
const db=new DatabaseSync(path);
try {
  db.exec('PRAGMA busy_timeout=0');
  if(mode==='shared') {db.exec('BEGIN');db.prepare('SELECT * FROM header').all();}
  else db.exec(mode==='writer'?'BEGIN IMMEDIATE':'BEGIN EXCLUSIVE');
  writeFileSync(control+'.ready','locked');
  const until=Date.now()+20000;
  while(!existsSync(control+'.release')){
    if(Date.now()>=until)throw Error('lock gate expired');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,2);
  }
} finally {if(db.isTransaction)db.exec('ROLLBACK');db.close();writeFileSync(control+'.done','released');}
`;
let lockSerial=0;
function startLock(f,path,mode='exclusive') {
  const control=join(f.workspace.path,'lock-control-'+ ++lockSerial);
  const child=spawn(process.execPath,['--input-type=module','--eval',childSource,path,mode,control],{stdio:['ignore','ignore','pipe']});
  let stderr='',exited=false;
  child.stderr.on('data',part=>{stderr+=part;});
  const completion=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>{exited=true;resolve({code,signal});});});
  const release=()=>{
    writeFileSync(control+'.release','release');
    const until=Date.now()+5000;
    while(!existsSync(control+'.done')&&!exited){assert.ok(Date.now()<until,'lock release gate bounded');syncPause(2);}
  };
  const cleanup=async()=>{release();const outcome=await completion;assert.equal(outcome.code,0,stderr);assert.equal(outcome.signal,null);};
  f.workspace.defer(cleanup);
  return {release,cleanup,control,ready:()=>existsSync(control+'.ready'),waitSync(){
    const until=Date.now()+10000;
    while(!existsSync(control+'.ready')){assert.ok(Date.now()<until,'child must acquire lock');syncPause(2);}
  }};
}
async function lock(f,path,mode='exclusive') {
  const gate=startLock(f,path,mode),until=Date.now()+10000;
  while(!gate.ready()){assert.ok(Date.now()<until,'child must acquire lock');await pause(5);}
  return gate;
}
function sidecar(directory){return join(directory,readdirSync(directory).find(name=>name.endsWith('.sqlite')));}
async function fixture(t,{embedded=false,two=false}={}) {
  const f=sourceFixture(t);await savedSource(f,sentinel);
  if(two)ok(await f.core.captureRaw(request(splitRaw('Synthetic copper continuation.',{id:'second',ordinal:2})[0],{eventId:'second'})));
  const embedder=embedded?createFakeEmbedder():undefined;
  const s=await searchFixture(f,embedder?{embedder,policy}:{});
  await s.maintain();
  if(embedded){await s.tick({embeddings:true});await s.tick();}
  await s.reopen();return {f,s,path:sidecar(s.directory)};
}
// Observe prepare, step, iterator and exec failures without replacing SQLite.
// Every rollback and failed opening handle can be checked at the retry boundary.
function observe(t,{onBusy=()=>{},inject=()=>null,intercept=(_input,work)=>work()}={}) {
  const prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;
  const connections=new Set(),busy=[];
  function invoke(db,sql,method,work){
    connections.add(db);
    try{const failure=inject({db,sql,method});if(failure)throw failure;return intercept({db,sql,method},work);}
    catch(error){if(isStorageBusy(error)){busy.push({db,sql,method,error});onBusy(busy.at(-1));}throw error;}
  }
  DatabaseSync.prototype.exec=function(sql){return invoke(this,sql,'exec',()=>exec.call(this,sql));};
  DatabaseSync.prototype.prepare=function(sql){
    const db=this,statement=invoke(db,sql,'prepare',()=>prepare.call(db,sql));
    for(const method of ['get','all','run','iterate']){
      const native=statement[method];
      statement[method]=function(...args){
        const value=invoke(db,sql,method,()=>native.apply(this,args));
        if(method==='iterate'){
          const next=value.next;value.next=function(...args){return invoke(db,sql,'next',()=>next.apply(this,args));};
        }
        return value;
      };
    }
    return statement;
  };
  const restore=()=>{DatabaseSync.prototype.prepare=prepare;DatabaseSync.prototype.exec=exec;};
  t.after(restore);
  return {busy,connections,restore,clean(){for(const db of connections)if(db.isOpen)assert.equal(db.isTransaction,false,'no transaction at retry boundary');}};
}
function retries(t,observer,{held=false,release=()=>{},opening=false}={}) {
  const original=globalThis.setTimeout,now=performance.now;
  let elapsed=0,waits=0;
  Object.defineProperty(performance,'now',{configurable:true,value:()=>now.call(performance)+elapsed});
  globalThis.setTimeout=(work,ms,...args)=>{
    if(ms===25){
      waits++;assert.ok(observer.busy.length,'retry must follow observed native BUSY');
      if(waits===1)assert.equal(observer.busy.length,1,'no second sidecar read before the first backoff');
      observer.clean();
      if(opening)for(const db of observer.connections)assert.equal(db.isOpen,false,'every failed opening handle disposed before wait');
      if(!held)release();elapsed+=ms;return nativeTimeout(work,0,...args);
    }
    return original(work,ms,...args);
  };
  t.after(()=>{globalThis.setTimeout=original;Object.defineProperty(performance,'now',{configurable:true,value:now});});
  return {get elapsed(){return elapsed;},get waits(){return waits;}};
}
function freezeIdleChecks(t) {
  t.mock.timers.enable({apis:['setInterval']});let service;
  t.after(async()=>{try{await service?.close();}finally{t.mock.timers.reset();}});
  return opened=>{service=opened;};
}
function partial(value){assert.equal(value.candidates.length,0);assert.equal(value.coverage.status,'partial');assert.deepEqual(value.coverage.causes,['deadline']);}

for(const canonical of [false,true])for(const held of [false,true])test(`opening ${canonical?'canonical preflight':'sidecar admission'} ${held?'exhausts original deadline':'recovers same invocation and shared promise'}`,async t=>{
  const {f,s,path}=await fixture(t);await s.service.close();
  const gate=await lock(f,canonical?f.path:path),seen=observe(t);
  const timing=retries(t,seen,{held,release:gate.release,opening:true});
  if(held)await assert.rejects(openRawSearch(s.options),{code:'raw_search_unavailable'});
  else {const opening=openRawSearch(s.options),[a,b]=await Promise.all([opening,opening]);assert.equal(a,b);
    try{assert.equal((await a.search({query:'copper'},s.host.token)).candidates.length,1);}finally{await a.close();}}
  assert.ok(seen.busy.length);assert.ok(timing.waits>0);assert.ok(timing.elapsed<=1000);seen.clean();
  gate.release();
});

for(const area of ['search','cached search','prepare','batch','status','purge commit','purge vacuum'])for(const held of [false,true])test(`${area}: child sidecar lock ${held?'held through original bound':'released after BUSY succeeds in same invocation'}`,async t=>{
  const attach=area==='cached search'?freezeIdleChecks(t):null;
  const {f,s,path}=await fixture(t,{embedded:area==='cached search',two:area==='batch'});attach?.(s.service);
  let candidate,candidates;
  if(['prepare','batch','cached search'].includes(area)){
    const found=await s.search({query:'copper'});candidates=found.candidates;candidate=candidates[0];assert.ok(candidate);
    if(area==='cached search')assert.equal(found.semantic.state,'ready');
  }
  const gate=area==='purge vacuum'?null:await lock(f,path,area.startsWith('purge')?'shared':'exclusive');
  let vacuumGate;
  const seen=observe(t,{inject({sql,method}){
    if(area==='purge vacuum'&&sql==='VACUUM'&&method==='exec'&&!vacuumGate){
      vacuumGate=startLock(f,path,'shared');vacuumGate.waitSync();
    }
    return null;
  }});
  const timing=retries(t,seen,{held,release:()=>{gate?.release();vacuumGate?.release();}});
  const callbacks=[];
  let operation;
  if(area==='search'||area==='cached search')operation=s.search({query:'copper'});
  else if(area==='prepare')operation=s.prepare(candidate);
  else if(area==='batch')operation=s.service.prepareMany(candidates,{onPrepared:(h,i)=>callbacks.push([h,i])},s.host.token);
  else if(area==='status')operation=s.service.status();
  else operation=s.service.purge();
  if(held&&area==='prepare')await assert.rejects(operation,{code:'raw_search_unavailable'});
  else if(held&&area.startsWith('purge'))await assert.rejects(operation,{code:'raw_search_unavailable'});
  else {
    const result=await operation;
    if(area.includes('search')){if(held)partial(result);else assert.equal(result.candidates.length,1);}
    else if(area==='prepare')assert.ok(result.value.ranges[0].text.includes('copper'));
    else if(area==='batch'){
      assert.equal(result.complete,!held);assert.equal(result.handles.length,held?0:candidates.length);
      assert.deepEqual(callbacks.map(([,i])=>i),held?[]:candidates.map((_,i)=>i));
      if(!held)assert.deepEqual(result.handles.map(h=>h.value.messageId),candidates.map(c=>c.messageId));
    }else if(area==='status')assert.equal(result.state,held?'unavailable':'unknown');
    else assert.equal(result,undefined);
  }
  assert.ok(seen.busy.length);assert.ok(timing.waits>0);
  if(area==='purge commit')assert.equal(seen.busy[0].sql,'COMMIT');
  if(area==='purge vacuum')assert.equal(seen.busy[0].sql,'VACUUM');
  assert.ok(timing.elapsed<=1000);seen.clean();gate?.release();vacuumGate?.release();
  if(area.startsWith('purge')&&!held)assert.equal(s.indexCount(),0);
});

// Enumerate the admitted schema so new payload tables cannot escape purge
// coverage. Header and attestation are the retained admission metadata.
function sidecarTables(path) {
  const db=new DatabaseSync(path);
  try {
    return Object.fromEntries(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
      .map(({name})=>[name,db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'" ORDER BY rowid').all()]));
  } finally {db.close();}
}

test('owner purge retry redoes deletes rolled back after a VACUUM failure',async t=>{
  const {f,s,path}=await fixture(t);
  const otherNamespace={...ns,ownerId:'synthetic-other-owner'};
  ok(await f.core.captureRaw(request(splitRaw('Synthetic untouched silver telescope.')[0],
    {namespace:otherNamespace,eventId:'other-owner'})));
  const other=await openRawSearch({...s.options,ownerId:otherNamespace.ownerId,readSet:[otherNamespace]});
  f.workspace.defer(()=>other.close());
  for(let turn=0;turn<8;turn++){await other.maintain({},s.host.token);await rawSearchTestWait(1010);}
  const otherPath=join(s.directory,readdirSync(s.directory).find(name=>name.endsWith('.sqlite')&&join(s.directory,name)!==path));
  const untouched=sidecarTables(otherPath);assert.ok(untouched.segments.length);
  const before=sidecarTables(path);assert.ok(before.segments.length);
  let target,failed=false,deletes=0,restored=false;
  // Deliberately retain the deletion transaction until VACUUM. This fault
  // forces the guarded ROLLBACK to undo the deletes, rather than merely
  // exercising the normal post-commit VACUUM failure.
  const seen=observe(t,{intercept({db,sql,method},work){
    if(method==='exec'&&!failed){
      if(sql==='BEGIN IMMEDIATE'){
        target??=db;if(db===target&&db.isTransaction)return;
      }
      if(db===target&&sql==='COMMIT')return;
    }
    return work();
  },inject({db,sql,method}){
    if(db===target&&method==='run'&&sql.startsWith('DELETE FROM segments'))deletes++;
    if(db===target&&sql==='VACUUM'&&method==='exec'&&!failed){
      assert.equal(db.isTransaction,true);assert.equal(db.prepare('SELECT count(*) n FROM segments').get().n,0);
      failed=true;return Object.assign(new Error('Synthetic VACUUM contention'),{code:'ERR_SQLITE_ERROR',errcode:5});
    }
    return null;
  }});
  const timing=retries(t,seen,{release(){
    assert.equal(target.isTransaction,false);
    assert.equal(target.prepare('SELECT count(*) n FROM segments').get().n,before.segments.length,'ROLLBACK restored deleted payload');
    restored=true;
  }});
  assert.equal(await s.service.purge(),undefined);
  assert.equal(failed,true);assert.equal(restored,true);assert.equal(timing.waits,1);
  assert.ok(deletes>=4,'the retry must rerun both deletion passes, not only VACUUM');seen.clean();
  const after=sidecarTables(path);
  assert.deepEqual(Object.keys(after),Object.keys(before));
  for(const [name,rows] of Object.entries(after)){
    if(name==='header'){
      assert.equal(rows.length,1);assert.equal(rows[0].binding,before.header[0].binding);
      assert.deepEqual(JSON.parse(rows[0].checkpoint),{after:['','',-1],sweep:0,cycles:0});
    }else if(name==='product_attestation')assert.equal(rows.length,1);
    else assert.equal(rows.length,0,'zero owner payload rows in '+name);
    assert.equal(JSON.stringify(rows).includes(sentinel),false,'no retained source text in '+name);
  }
  assert.deepEqual(sidecarTables(otherPath),untouched,'all other-owner tables untouched');
  await s.reopen();assert.equal(sidecarTables(path).segments.length,0,'retained metadata admits an empty sidecar');
});

test('owner purge never reports success when every bounded attempt is locked',async t=>{
  const {f,s,path}=await fixture(t),before=sidecarTables(path);
  const gate=await lock(f,path,'writer'),seen=observe(t);
  const timing=retries(t,seen,{held:true});
  // This is the outermost existing purge API: local-raw-search exposes only
  // search/status/maintenance and context ports, with no erasure/purge route.
  let completed=false;
  await assert.rejects(s.service.purge().then(value=>{completed=true;return value;}),{code:'raw_search_unavailable'});
  assert.equal(completed,false);assert.ok(seen.busy.length>1);assert.ok(seen.busy.length<=40);
  assert.ok(timing.waits>0);assert.ok(timing.elapsed<=1000);seen.clean();
  gate.release();assert.deepEqual(sidecarTables(path),before,'failed purge leaves owner payload present');
});

// Interrupt a later item after an earlier callback: retries must retain the
// exact prepared prefix and caller cutoff, including partial exhaustion.
for(const held of [false,true])test(`batch prefix and callback order survive ${held?'deadline exhaustion':'a later interruption'}`,async t=>{
  const {f,s,path}=await fixture(t,{two:true}),candidates=(await s.search({query:'copper'})).candidates;
  assert.equal(candidates.length,2);
  let gate;const seen=observe(t);
  const timing=retries(t,seen,{held,release:()=>gate?.release()}),calls=[];
  const at=performance.now()+250;
  const result=await s.service.prepareMany(candidates,{deadlineAt:at,onPrepared(h,i){
    calls.push([h,i]);if(i===0){
      gate=startLock(f,path);gate.waitSync();
      const reader=new DatabaseSync(path);
      try{reader.prepare('SELECT * FROM header').all();}finally{reader.close();}
    }
  }},s.host.token);
  assert.equal(result.complete,!held);assert.deepEqual(calls.map(([,i])=>i),held?[0]:[0,1]);
  assert.equal(result.handles[0],calls[0][0]);assert.ok(timing.elapsed<=250);
  gate?.release();seen.clean();
});

for(const mode of ['writer','shared','exclusive'])for(const held of [false,true])test(`maintenance ${mode} contention ${held?'defers boundedly without no-progress':'leaves suspended scheduled reader valid'}`,async t=>{
  const f=sourceFixture(t);await savedSource(f,sentinel);
  let unblock,arrive,armed=false;
  const arrived=new Promise(resolve=>{arrive=resolve;}),suspended=new Promise(resolve=>{unblock=resolve;});
  const open=f.port.openRaw;f.port.openRaw=async input=>{if(armed){armed=false;arrive();await suspended;}return open(input);};
  const original=globalThis.setTimeout;let scheduled;
  globalThis.setTimeout=(work,ms,...args)=>{
    if(new Error().stack.includes('at arm (')&&new Error().stack.includes('local-raw-search')){
      scheduled=work;return {unref(){}};
    }
    return original(work,ms,...args);
  };
  t.after(()=>{globalThis.setTimeout=original;unblock();});
  const manager=createLocalRawSearch(f.path,f.port);f.workspace.defer(()=>manager.close());f.workspace.defer(()=>unblock());
  const port=manager.contextPort([ns]);
  ok(await manager.methods.maintainRawSearch({namespace:ns}));
  const found=await port.search({query:'copper'});assert.equal(found.candidates.length,1);
  const existing=await port.prepare(found.candidates[0]);
  const directory=join(f.path+'.raw-search',readdirSync(f.path+'.raw-search')[0]),path=sidecar(directory);
  await rawSearchTestWait(1010);
  armed=true;const reading=port.prepare(found.candidates[0]);reading.catch(()=>{});await arrived;
  ok(await f.core.captureRaw(request(splitRaw('Synthetic copper continuation.',{id:'second',ordinal:2})[0],{eventId:'second'})));
  const gate=await lock(f,path,mode),seen=observe(t);
  assert.equal(typeof scheduled,'function');scheduled();
  const until=Date.now()+5000;
  while(!seen.busy.length){assert.ok(Date.now()<until,'scheduled maintenance must hit native BUSY');await pause(5);}
  for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));
  seen.clean();
  if(mode!=='exclusive'){
    const beforeDeferred=seen.busy.length;
    const deferred=ok(await manager.methods.maintainRawSearch({namespace:ns}));
    assert.equal(deferred.maintenance.phase,'idle');assert.equal(deferred.maintenance.noProgress,0);
    assert.equal(seen.busy.length,beforeDeferred,'maintenance admission respects the 25 ms contention backoff');
  }
  if(held){
    for(let i=0;i<4;i++){
      await rawSearchTestWait(26);
      const outcome=ok(await manager.methods.maintainRawSearch({namespace:ns}));
      assert.equal(outcome.maintenance.phase,'idle');assert.equal(outcome.maintenance.noProgress,0);assert.equal(outcome.error,null);
    }
  }
  assert.ok(seen.busy.some(row=>mode==='writer'?row.sql==='BEGIN IMMEDIATE':mode==='shared'?row.sql==='COMMIT':true));
  assert.equal(port.revalidate([existing])[0].ranges[0].text,sentinel,'existing reader remains valid while the sidecar lock is held');
  gate.release();unblock();
  const handle=await reading;
  const valid=port.revalidate([existing,handle]);assert.equal(valid.length,2);
  assert.ok(valid.every(value=>value.ranges[0].text===sentinel));
  await rawSearchTestWait(1010);
  const recovered=ok(await manager.methods.maintainRawSearch({namespace:ns}));
  assert.equal(recovered.maintenance.phase,'idle');assert.equal(recovered.maintenance.noProgress,0);
  assert.equal((await port.search({query:'copper'})).candidates.length,2);
});

for(const mode of ['writer','shared','locked','extended'])for(const held of [false,true])test(`reservation ${mode} ${held?'defers repeated bounded turns':'recovers next opportunity'} without provider failure or early dispatch`,async t=>{
  const f=sourceFixture(t);await savedSource(f,sentinel);
  let gate,reservation=false,calls=0,blocked=true;
  const fake=createFakeEmbedder(),embedder={...fake,async embed(texts,controls){calls++;assert.ok(reservation,'provider follows committed reservation');return fake.embed(texts,controls);}};
  let admissions=0;const originalBroker=broker();
  const maintenanceTurn={...originalBroker,createTurn(...args){admissions++;return originalBroker.createTurn(...args);}};
  const s=await searchFixture(f,{embedder,policy,maintenanceTurn});await s.maintain();
  // Let lexical discovery settle before targeting reservation alone.
  const seen=observe(t,{inject({db,sql,method}){
    if(sql==='BEGIN IMMEDIATE'&&method==='exec'&&new Error().stack.includes('Object.embed')&&blocked){
      if(mode==='locked'||mode==='extended')return Object.assign(Error('native contention'),{code:'ERR_SQLITE_ERROR',errcode:mode==='locked'?6:517});
      if(!gate){gate=startLock(f,sidecar(s.directory),mode);gate.waitSync();}
    }
    return null;
  }});
  const observedExec=DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec=function(sql){const value=observedExec.call(this,sql);
    if(sql==='COMMIT'&&new Error().stack.includes('Object.embed'))reservation=true;
    return value;
  };
  for(let turn=0;turn<8&&!seen.busy.length;turn++)await s.tick({embeddings:true});
  assert.ok(seen.busy.length,'reservation must encounter real native BUSY');assert.equal(calls,0);seen.clean();
  const status=await s.service.status();assert.equal(status.error,null);assert.equal(status.maintenance.phase,'idle');
  const beforeDeferred=admissions;
  const deferred=await s.maintain({embeddings:true});
  assert.equal(deferred.maintenance.phase,'idle');assert.equal(deferred.error,null);assert.equal(calls,0);
  assert.equal(admissions,beforeDeferred,'reservation contention defers admission for the existing 25 ms backoff');
  if(held){
    for(let i=0;i<4;i++){await s.tick({embeddings:true});assert.equal(calls,0);assert.equal((await s.service.status()).error,null);}
  }
  blocked=false;gate?.release();
  // Inspect persisted retry data only through SQLite, with no raw DB reads.
  const db=new DatabaseSync(sidecar(s.directory));
  try{for(const row of db.prepare('SELECT data FROM segments').all()){
    assert.equal(row.data.includes('provider_error'),false);
    const data=JSON.parse(row.data),retry=Array.isArray(data)?data.at(-1):data.retry;
    assert.equal(retry.attempts,0,'failed reservation records no possible provider attempt');
  }}
  finally{db.close();}
  for(let i=0;i<12&&calls===0;i++)await s.tick({embeddings:true});
  assert.equal(calls,1);
  for(let i=0;i<4;i++)await s.tick();
  assert.equal((await s.search({query:'copper'})).semantic.state,'ready');
});

for(const errcode of [6,5|(2<<8)])for(const phase of ['opening','search','publication','maintenance'])test(`native-shaped ${errcode} at ${phase} retains transient classification`,async t=>{
  const {f,s}=await fixture(t),path=sidecar(s.directory);let injected=false;
  if(phase==='opening')await s.service.close();
  const candidate=(phase==='publication')?(await s.search({query:'copper'})).candidates[0]:null;
  const seen=observe(t,{inject({sql,method}){
    const match=phase==='opening'?sql==='PRAGMA busy_timeout=0'&&method==='exec':
      phase==='maintenance'?sql==='SELECT * FROM header WHERE singleton=1'&&method==='prepare':
      sql==='SELECT * FROM header WHERE singleton=1'&&method==='prepare';
    if(match&&!injected){injected=true;return Object.assign(Error('native contention'),{code:'ERR_SQLITE_ERROR',errcode});}
    return null;
  }});
  retries(t,seen,{opening:phase==='opening'});
  if(phase==='opening'){
    const service=await openRawSearch(s.options);try{assert.equal((await service.search({query:'copper'},s.host.token)).candidates.length,1);}finally{await service.close();}
  }else if(phase==='maintenance'){
    await s.tick();assert.equal((await s.service.status()).maintenance.phase,'idle');await s.tick();
  }else if(phase==='publication')assert.ok(await s.prepare(candidate));
  else assert.equal((await s.search({query:'copper'})).candidates.length,1);
  assert.equal(injected,true);assert.ok(seen.busy.some(row=>row.error.errcode===errcode));seen.clean();
});

for(const held of [false,true])test(`local concurrent opening callers share one ${held?'bounded failure':'recovered service'}`,async t=>{
  const f=sourceFixture(t);await savedSource(f,sentinel);
  const seed=createLocalRawSearch(f.path,f.port);
  try{ok(await seed.methods.maintainRawSearch({namespace:ns}));}finally{await seed.close();}
  const root=f.path+'.raw-search',path=sidecar(join(root,readdirSync(root)[0]));
  const gate=await lock(f,path),sidecars=new Set();
  const seen=observe(t,{inject({db,sql}){if(sql==='SELECT * FROM header WHERE singleton=1')sidecars.add(db);return null;}});
  const timing=retries(t,seen,{held,release:gate.release,opening:true});
  const manager=createLocalRawSearch(f.path,f.port);f.workspace.defer(()=>manager.close());
  const results=await Promise.all(Array.from({length:3},()=>manager.methods.getRawSearchStatus({namespace:ns})));
  for(const result of results){
    assert.equal(result.ok,!held);
    if(held)assert.equal(result.error.code,'raw_search_unavailable');else assert.equal(result.value.state,'unknown');
  }
  assert.equal([...sidecars].filter(db=>db.isOpen).length,held?0:1,'one service admitted for all callers');
  assert.ok(seen.busy.length);assert.ok(timing.elapsed<=1000);gate.release();seen.clean();
});

for(const stage of ['pragma','prepare','step','commit'])test(`opening native LOCKED at ${stage} disposes and revalidates before retry`,async t=>{
  const {s}=await fixture(t);await s.service.close();let injected=false;
  const seen=observe(t,{inject({sql,method}){
    const matches=stage==='pragma'?sql==='PRAGMA busy_timeout=0'&&method==='exec':
      stage==='prepare'?sql==='PRAGMA journal_mode'&&method==='prepare':
      stage==='step'?sql==='PRAGMA journal_mode'&&method==='get':
      sql==='COMMIT'&&method==='exec'&&new Error().stack.includes('raw-search-storage');
    if(matches&&!injected){injected=true;return Object.assign(Error('locked'),{code:'ERR_SQLITE_ERROR',errcode:6});}
    return null;
  }});
  retries(t,seen,{opening:true});
  const service=await openRawSearch(s.options);
  try{assert.equal((await service.search({query:'copper'},s.host.token)).candidates.length,1);}finally{await service.close();}
  assert.equal(injected,true);seen.clean();
});

test('failed sidecar rollback is discarded and never retried as native BUSY',async t=>{
  const {s}=await fixture(t);let poisoned,fail=true;
  const seen=observe(t,{inject({db,sql,method}){
    if(fail&&sql==='SELECT * FROM header WHERE singleton=1'&&method==='prepare'){poisoned=db;return Object.assign(Error('busy'),{code:'ERR_SQLITE_ERROR',errcode:5});}
    if(fail&&db===poisoned&&sql==='ROLLBACK'){fail=false;return Object.assign(Error('rollback locked'),{code:'ERR_SQLITE_ERROR',errcode:6});}
    return null;
  }});
  const timing=retries(t,seen);
  await assert.rejects(s.search({query:'copper'}),{code:'raw_search_unavailable'});
  assert.equal(poisoned.isOpen,false);assert.equal(timing.waits,0);
});

test('constructor LOCKED retry covers a cold sidecar and disposes the canonical attempt',()=>{
  const url=name=>new URL(name,import.meta.url).href;
  const script=`
    import assert from 'node:assert/strict';
    import {registerHooks} from 'node:module';
    import {DatabaseSync} from 'node:sqlite';
    import {performance} from 'node:perf_hooks';
    const cleanups=[],t={after(work){cleanups.push(work);}};
    let failures=0,closed=0,time=100,waits=0;
    Object.defineProperty(performance,'now',{configurable:true,value:()=>time});
    const timeout=globalThis.setTimeout,close=DatabaseSync.prototype.close;
    DatabaseSync.prototype.close=function(){const result=close.call(this);closed++;assert.equal(this.isOpen,false);return result;};
    globalThis.setTimeout=(work,ms,...args)=>{if(ms===25){waits++;time+=ms;assert.ok(closed>0);return timeout(work,0,...args);}return timeout(work,ms,...args);};
    const hook=registerHooks({load(url,context,next){const result=next(url,context);
      if(!url.endsWith('/core/raw-search-storage.mjs'))return result;
      const source=String(result.source),before="import { DatabaseSync } from 'node:sqlite';";
      assert.equal(source.split(before).length,2,'constructor transform must match once');
      return {...result,source:source.replace(before,
        "import { DatabaseSync as NativeDatabaseSync } from 'node:sqlite'; const DatabaseSync=new Proxy(NativeDatabaseSync,{construct(target,args){if(args[0]!==':memory:'&&!globalThis.constructorBusy++){throw Object.assign(Error('locked'),{code:'ERR_SQLITE_ERROR',errcode:6});}return Reflect.construct(target,args);}});")};
    }});
    globalThis.constructorBusy=0;
    try {
      const {sourceFixture,savedSource}=await import(${JSON.stringify(url('../testing/raw-source-fixtures.mjs'))});
      const {searchFixture}=await import(${JSON.stringify(url('../testing/raw-search-fixtures.mjs'))});
      const f=sourceFixture(t);await savedSource(f,'Synthetic copper telescope.');const s=await searchFixture(f);
      assert.equal(waits,1);assert.ok(closed>0);await s.maintain();assert.equal((await s.search({query:'copper'})).candidates.length,1);
    } finally {for(const cleanup of cleanups.reverse())await cleanup();hook.deregister();}
  `;
  const child=spawnSync(process.execPath,['--input-type=module','--eval',script],{encoding:'utf8',timeout:20000});
  assert.equal(child.status,0,child.stderr);assert.equal(child.signal,null);
});

test('canonical preflight disposal failure cannot authorize another opening attempt',async t=>{
  const {s}=await fixture(t);await s.service.close();
  let connection,closes=0;
  const close=DatabaseSync.prototype.close;
  const seen=observe(t,{inject({db,sql,method}){
    if(sql==='PRAGMA query_only'&&method==='prepare'){
      connection=db;return Object.assign(Error('busy'),{code:'ERR_SQLITE_ERROR',errcode:5});
    }
    return null;
  }});
  const timing=retries(t,seen,{opening:true});
  DatabaseSync.prototype.close=function(){
    if(this===connection){closes++;throw Object.assign(Error('close locked'),{code:'ERR_SQLITE_ERROR',errcode:6});}
    return close.call(this);
  };
  try{
    await assert.rejects(openRawSearch(s.options),{code:'raw_search_unavailable'});
    assert.equal(timing.waits,0);assert.equal(closes,2,'outer attempt verifies inner preflight disposal');
  }finally{DatabaseSync.prototype.close=close;if(connection?.isOpen)connection.close();}
});

for(const held of [false,true])test(`optional maintenance cache check ${held?'defers under a held lock':'recovers after release'} without a second sidecar read`,async t=>{
  const attach=freezeIdleChecks(t),{f,s,path}=await fixture(t,{embedded:true});attach(s.service);
  const found=await s.search({query:'copper'});assert.equal(found.semantic.state,'ready');
  const handle=await s.prepare(found.candidates[0]);
  const gate=await lock(f,path),seen=observe(t);
  const status=await s.maintain();
  assert.equal(status.maintenance.phase,'idle');assert.equal(status.maintenance.noProgress,0);assert.equal(status.error,null);
  assert.equal(seen.busy.length,1,'cache contention must defer admission before another sidecar read');seen.clean();
  if(held)for(let i=0;i<4;i++){
    await rawSearchTestWait(26);const next=await s.maintain();
    assert.equal(next.maintenance.phase,'idle');assert.equal(next.maintenance.noProgress,0);assert.equal(next.error,null);
  }
  assert.equal(s.service.revalidate([handle])[0].ranges[0].text,sentinel);
  gate.release();await rawSearchTestWait(26);
  assert.equal((await s.maintain()).maintenance.phase,'idle');
  assert.equal((await s.search({query:'copper'})).candidates.length,1);
});
