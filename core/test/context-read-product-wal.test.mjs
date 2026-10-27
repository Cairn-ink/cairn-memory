import test from 'node:test';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { fork, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, renameSync, symlinkSync, mkdirSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { fixture, ns, ok, readTransaction } from '../testing/context-read-fixture.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { installOverviewLayout } from '../testing/topic-overview-raw29-fixture.mjs';
import { openMemoryCore, openContextProductReader, openContextIndexMaintainer, createContextReadSupervisor } from '../index.mjs';
import { supervisorOwner } from '../context-read-supervisor.mjs';
import { createProductReaderRuntime } from '../context-product-reader.mjs';
import { credentialDigest, PRODUCT_PROFILE } from '../context-product-control.mjs';
import { createProductSqlitePolicy, productSqliteFiles } from '../context-product-sqlite.mjs';
import { nativeObserver, nativeTelemetry, sealNative, drainNative } from '../context-product-telemetry.mjs';
import { TOPIC_WAL_WAIT_MS, TOPIC_WAL_REPLY_RESERVE_MS } from '../topic-reader-sqlite.mjs';
import { productSidecar, PRODUCT_SIDECAR_SUFFIX } from '../context-product-sidecar.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { accessDigest, verifiedRecord, canonicalJson } from '../context-product-validation.mjs';

const processFixture = new URL('./fixtures/context-product-wal-process.mjs',import.meta.url);
const hostUrl = new URL('../testing/context-product-index-host.mjs',import.meta.url).href;
const coverage = {policy:'recent-projects-v1',selectionRevision:'wal-fixture',requestedNamespaces:1,selectedNamespaces:1,omittedNamespaces:0};
const input = {readSet:[ns],types:['memory'],intent:'current',deadlineMs:5000};
const refresh = {readSet:[ns],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:1024,maxMs:5000}};
function run(role,path,mode) {
  const r=spawnSync(process.execPath,[processFixture.pathname,role,path,...(mode?[mode]:[])],{env:{},encoding:'utf8',timeout:10000,maxBuffer:8*1024*1024});
  assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);return r.stdout.trim()?JSON.parse(r.stdout):null;
}
async function writer(t,path,mode='WAL') {
  const c=fork(processFixture,[ 'writer',path,mode ],{env:{},execArgv:[],stdio:['ignore','ignore','pipe','ipc']});
  let stderr='';c.stderr.on('data',b=>{stderr+=b;});
  const exited=once(c,'exit');let ended=false;c.once('exit',()=>{ended=true;});
  t.after(async()=>{if(!ended){c.kill();await exited;}});
  assert.equal((await once(c,'message'))[0].ready,true,stderr);
  let sequence=0;
  return {pid:c.pid,async call(command){const id=++sequence,pending=once(c,'message');c.send({id,command});const [r]=await pending;assert.equal(r.id,id);assert.equal(r.ok,true,JSON.stringify(r));if(command==='close'){const [code]=await exited;assert.equal(code,0,stderr);}return r;}};
}
function setup(t,mode='WAL',version=18) {
  const workspace=createTestWorkspace(t),path=join(workspace.path,'canonical.sqlite');
  // Create the physical v18 file using the frozen old pin, in its own process.
  run('old-pin',path);
  const core=openMemoryCore({path});
  const admit=content=>ok(core.admit({namespace:ns,memory:{content,kind:'fact'},receipts:[{client:'synthetic',sessionId:'wal',eventId:randomUUID(),role:'user',excerpt:content}]})).memory;
  let memory;try{memory=admit('wal production needle');admit('other needle');}finally{core.close();}
  if(version!==18)installOverviewLayout(path,version);
  run('mode',path,mode);return {path,workspace,memory};
}
function configured(t,path,{service=false,sideMode='WAL',wal=true,spawnWorker}={}) {
  const supervisor=createContextReadSupervisor();t.after(()=>supervisor.close());
  const token={opaque:randomUUID()},ids={requestId:randomUUID(),handleId:randomUUID(),credentialBindingId:randomUUID(),credentialExpiresUtcMs:null};
  const binding={kind:service?'service':'request',...(service?{serviceId:randomUUID(),credentialBindingId:ids.credentialBindingId,credentialExpiresUtcMs:null}:ids),
    credentialDigest:credentialDigest(token),ownerId:ns.ownerId,namespaces:{readSet:[ns],ownerCoverage:coverage},issuedAt:0};
  const state=new SharedArrayBuffer(32);new Int32Array(state)[0]=1;
  const options={supervisor,path,version:'context-read-v1',profile:PRODUCT_PROFILE,readSet:[ns],ownerCoverage:coverage,wal,diagnostics:true,
    ...(service?{sidecarJournalMode:sideMode}:{requestControl:{...ids,requestMaxMs:5000}}),
    host:{moduleUrl:hostUrl,configuration:{[service?'serviceBinding':'requestBinding']:binding,state,...(!service?{requestReservation:new SharedArrayBuffer(4)}:{})}}};
  return {options,token,supervisor,state,async open(){const open=spawnWorker?createProductReaderRuntime({maintenance:service,spawnWorker}):service?openContextIndexMaintainer:openContextProductReader;
    const h=await open(options);t.after(()=>h.close());return h;}};
}
async function build(h,token,patch={}) {
  for(let i=0;i<100;i++){const r=ok(await h.refreshContextIndex({...refresh,...patch},token));if(r.status==='complete')return r;}
  assert.fail('build did not finish');
}
function local(t,f,extra={}) {
  const sqlite=createProductSqlitePolicy();sqlite.start(Infinity);
  const facade=openContextProductFacade(f.path,{sqlite});
  const storage=productSidecar({path:f.path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,sqlite,writable:true,sidecarJournalMode:'WAL',...extra});
  t.after(()=>{storage.close();facade.close();});
  return {storage,facade,sqlite,p:{...input,ownerCoverage:coverage},access:accessDigest({ownerId:ns.ownerId,namespaces:{readSet:[ns]}})};
}

for(const canonical of ['DELETE','WAL'])for(const sideMode of ['DELETE','WAL'])
test(`P2-10/08 canonical ${canonical} × sidecar ${sideMode}: initialization, live companions, ready-only Worker reads`,async t=>{
  const f=setup(t,canonical);
  assert.equal(existsSync(f.path+'-wal'),false,'checkpointed canonical has no companions before the mode probe');
  const s=configured(t,f.path,{service:true,sideMode}),h=await s.open();
  await build(h,s.token);await h.close();
  assert.equal(run('logical',f.path).journal,canonical.toLowerCase());
  const d=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX,{readOnly:true});
  assert.equal(d.prepare('PRAGMA journal_mode').get().journal_mode,sideMode.toLowerCase());d.close();
  const w=await writer(t,f.path,canonical);await w.call('write');
  const catchup=configured(t,f.path,{service:true,sideMode}),m=await catchup.open();await build(m,catchup.token);await m.close();
  const sideWriter=await writer(t,f.path+PRODUCT_SIDECAR_SUFFIX,sideMode);
  const request=configured(t,f.path,{spawnWorker:data=>new Worker(new URL('./fixtures/context-product-index-worker.mjs',import.meta.url),{workerData:data,env:{},execArgv:[]})});
  request.options.host.configuration.trapReads=true;
  const reader=await request.open();
  assert.deepEqual(ok(await reader.getContextReadCapabilities()).journals,['DELETE','WAL']);
  assert.equal(ok(await reader.getContextIndexStatus(input,request.token)).lexical.state,'ready');
  assert.equal(ok(await reader.findCandidates({...input,query:'needle'},request.token)).items.length,2);
  assert.equal(ok(await reader.contextRead({...input,query:'needle',budget:{maxTokens:4000,maxItems:12}},request.token)).metered.items.length,2);
  assert.equal(ok(await reader.fetchCandidateEvidence({readSet:[ns],intent:'current',deadlineMs:5000,refs:[{type:'memory',namespace:ns,memoryId:f.memory.id,revision:1}]},request.token)).items[0].content,'wal production needle');
  await reader.close();await sideWriter.call('close');await w.call('close');
  const diagnostics=await request.supervisor.drain();assert.ok(diagnostics.every(r=>r.telemetry==='complete'));
  assert.ok(diagnostics.every(r=>r.diagnostics.busy===0));
});

test('P2-10 checkpointed WAL without companions supports read-only canonical and sidecar opens',async t=>{
  const f=setup(t);assert.equal(existsSync(f.path+'-wal'),false);assert.equal(existsSync(f.path+'-shm'),false);
  const s=configured(t,f.path,{service:true}),h=await s.open();await build(h,s.token);await h.close();
  // A writable SQLite close cleans up companions created by read-only opens.
  for(const p of [f.path,f.path+PRODUCT_SIDECAR_SUFFIX])run('mode',p,'WAL');
  for(const p of [f.path,f.path+PRODUCT_SIDECAR_SUFFIX]){assert.equal(existsSync(p+'-wal'),false);assert.equal(existsSync(p+'-shm'),false);}
  const r=configured(t,f.path),reader=await r.open();assert.equal(ok(await reader.findCandidates({...input,query:'needle'},r.token)).items.length,2);await reader.close();
});

test('P2-10 shared mock-clock window precedes first statement; cached steps, rollback and DELETE stay bounded',t=>{
  const ws=createTestWorkspace(t);let now=10;
  const policy=createProductSqlitePolicy({now:()=>now});policy.start(5000);
  function connection(name,mode){
    const path=join(ws.path,name);writeFileSync(path,'fixture',{mode:0o600});
    const events=[];let timeout=0;
    const native={exec(sql){events.push([sql,timeout]);if(sql.startsWith('PRAGMA busy_timeout='))timeout=Number(sql.split('=').at(-1));},
      prepare(sql){events.push([sql,timeout]);return {get(){events.push(['get',timeout]);return sql==='PRAGMA journal_mode'?{journal_mode:mode}:timeout;},
        iterate(){return {next(){return {done:false,value:timeout};},return(){return {done:true};},[Symbol.iterator](){return this;}};}};}};
    return {...policy.open(native,path),events};
  }
  const a=connection('canonical','wal');assert.deepEqual(a.events.slice(0,3),[['PRAGMA busy_timeout=0',0],['PRAGMA journal_mode',0],['get',0]]);
  const s=a.db.prepare('SELECT metadata');assert.equal(s.get(),TOPIC_WAL_WAIT_MS-TOPIC_WAL_REPLY_RESERVE_MS);
  now=110;const b=connection('sidecar','wal');assert.equal(b.db.prepare('SELECT metadata').get(),880);
  now=210;assert.equal(s.get(),780);const iterator=s.iterate();now=310;assert.equal(iterator.next().value,680);
  now=990;a.db.exec('ROLLBACK');assert.deepEqual(a.events.at(-1),['ROLLBACK',0]);iterator.return();
  now=1000;const c=connection('delete','delete');assert.equal(c.db.prepare('SELECT metadata').get(),0);assert.ok(c.events.every(e=>e[1]===0));
  assert.equal(b.db.prepare('SELECT metadata').get(),0,'later connection cannot restart the window');
});

for(const suffix of ['-wal','-shm','-journal'])for(const kind of ['unsafe','symlink','replacement'])
test(`P2-10 companion ${suffix} ${kind} refuses before SQLite access`,t=>{
  const w=createTestWorkspace(t),path=join(w.path,'safe.sqlite');writeFileSync(path,'fixture',{mode:0o600});
  if(kind==='unsafe')writeFileSync(path+suffix,'fixture',{mode:0o644});
  if(kind==='symlink')symlinkSync(path,path+suffix);
  if(kind==='replacement')writeFileSync(path+suffix,'fixture',{mode:0o600});
  if(kind==='replacement'){
    const check=productSqliteFiles(path);renameSync(path+suffix,path+suffix+'.old');writeFileSync(path+suffix,'new',{mode:0o600});
    assert.throws(check,{code:'index_unavailable'});
  }else assert.throws(()=>productSqliteFiles(path),{code:'index_unavailable'});
});
test('P2-10 main identity and private directory protection are checked after the opening probe',t=>{
  const f=setup(t),native=new DatabaseSync(f.path,{readOnly:true});
  const p=createProductSqlitePolicy();p.start(Infinity);const {db}=p.open(native,f.path);
  renameSync(f.path,f.path+'.old');run('copy',f.path+'.old',f.path);
  assert.throws(()=>db.prepare('PRAGMA application_id'),{code:'index_unavailable'});db.close();
  chmodSync(f.workspace.path,0o755);assert.throws(()=>productSqliteFiles(f.path),{code:'index_unavailable'});chmodSync(f.workspace.path,0o700);
});
test('P2-10 fresh independent WAL writer close rendezvous covers the first mode statement',async t=>{
  const f=setup(t),w=await writer(t,f.path);await w.call('exclusive');
  let close,queries=0,now=0;const events=[];
  const observer={database(native){
    return new Proxy(native,{get(object,key){
      if(key==='prepare')return sql=>{
        if(sql==='PRAGMA journal_mode'){
          queries++;assert.equal(object.prepare('PRAGMA busy_timeout').get().timeout,980);
          events.push('first-statement-during-close');close=w.call('close');
        }
        return object.prepare(sql);
      };
      const value=Reflect.get(object,key,object);return typeof value==='function'?value.bind(object):value;
    }});
  }};
  const p=createProductSqlitePolicy({observer,now:()=>now});p.start(5000);
  const native=new DatabaseSync(f.path,{readOnly:true});
  const opened=p.open(native,f.path);assert.equal(opened.mode,'WAL');assert.equal(queries,1);assert.deepEqual(events,['first-statement-during-close']);
  opened.db.close();await close;
});
for(const [mode,empty] of [['DELETE',false],['DELETE',true],['WAL',false]])test(`P2-10 ${mode}${empty?' prewrite fallback':''} deterministic exclusive exhaustion is truthful native BUSY, without traversal retries`,async t=>{
  const f=setup(t,mode),w=await writer(t,f.path,mode);await w.call(empty?'exclusiveEmpty':'exclusive');
  const frame=nativeTelemetry('exhaustion-'+mode,1),observed=nativeObserver(frame);
  const p=createProductSqlitePolicy({observer:observed,now:()=>100});p.start(100); // Exhausted without sleeping.
  const native=observed.invoke('open','connection',()=>new DatabaseSync(f.path,{readOnly:true}));
  assert.throws(()=>p.open(native,f.path),e=>e.code==='ERR_SQLITE_ERROR' && (e.errcode&255)===5);
  sealNative(frame);const d=drainNative(frame,true);assert.equal(d.coverage,'complete');assert.ok(d.busy>0);
  assert.ok(d.records.every(r=>['journal_mode'].includes(r.statement)));
  assert.equal(d.records.length,empty?2:1,'only the no-journal zero-wait opening may retry once');
  await w.call('close');
});
for(const mode of ['DELETE','WAL'])test(`P2-10 lock regression: ${mode} metadata checks, opening, traversal and close retain same-process writer locks`,t=>{
  const f=setup(t,mode),writerDb=new DatabaseSync(f.path);writerDb.exec('BEGIN IMMEDIATE');
  const contender=()=>{
    const r=spawnSync(process.execPath,['--input-type=module','-e',`import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync(process.argv[1]);try{d.exec('BEGIN IMMEDIATE');console.log('ok');}catch(e){console.log(e.errcode&255);}finally{d.close();}`,f.path],{env:{},encoding:'utf8',timeout:5000});
    assert.equal(r.status,0,r.stderr);return r.stdout.trim();
  };
  try{
    assert.equal(contender(),'5');const p=createProductSqlitePolicy();p.start(Infinity);
    const {db}=p.open(new DatabaseSync(f.path,{readOnly:true}),f.path);
    db.exec('BEGIN');for(const r of db.prepare('SELECT id FROM memories').iterate())assert.ok(r.id);db.exec('ROLLBACK');
    assert.equal(contender(),'5');db.close();assert.equal(contender(),'5');
    writerDb.exec('ROLLBACK');assert.equal(contender(),'ok');
  }finally{if(writerDb.isTransaction)writerDb.exec('ROLLBACK');writerDb.close();}
});

for(const readerMode of ['native','product'])test(`P2-04 physical v18 WAL ${readerMode}: native-control cold SHM qualification, warm equality and old-pin reopen`,async t=>{
  const f=setup(t),w=await writer(t,f.path);await w.call('write');
  const before=run('bytes',f.path),logical=run('logical',f.path);
  async function read(){
    if(readerMode==='native')run('native',f.path);
    else {const s=configured(t,f.path,{service:true}),h=await s.open();await build(h,s.token);await h.close();
      const r=configured(t,f.path),reader=await r.open();assert.equal(ok(await reader.findCandidates({...input,query:'needle'},r.token)).items.length,2);await reader.close();}
  }
  await read();const cold=run('bytes',f.path);
  assert.equal(cold[''],before['']);assert.equal(cold['-wal'],before['-wal']);
  const a=Buffer.from(before['-shm'],'base64'),b=Buffer.from(cold['-shm'],'base64');assert.equal(a.length,b.length);
  const offsets=[...a.keys()].filter(i=>a[i]!==b[i]);assert.ok(offsets.every(i=>i>=100 && i<120),JSON.stringify(offsets));
  assert.deepEqual(run('logical',f.path),logical);await read();assert.deepEqual(run('bytes',f.path),cold);
  const {openDatabase}=await import('./fixtures/topic-overview-b2513501/core/database.mjs');const old=openDatabase(f.path);
  try{assert.equal(old.prepare('PRAGMA user_version').get().user_version,18);}finally{old.close();}
  assert.deepEqual(run('logical',f.path),logical);await w.call('close');
  t.diagnostic(`native-control=${readerMode}; cold permitted SHM offsets=${offsets.join(',')}; warmed equality=true; independent file observer exit=0`);
});

for(const boundary of ['precommit','noop','published'])test(`P2-21 WAL publication/currentness ${boundary}: independent digest and later catch-up`,async t=>{
  const f=setup(t);let enabled=boundary!=='noop',writes=0;
  const native=new DatabaseSync(f.path,{readOnly:true});
  const epoch=native.prepare('SELECT epoch FROM namespace_epochs WHERE owner_id=?').get(ns.ownerId).epoch;native.close();
  const expected=createHash('sha256').update(JSON.stringify([{memory:epoch}])).digest('base64url');
  const a=local(t,f,{rendezvous(point){if(enabled && point===boundary && writes++===0){runWrite(f.path);}}});
  a.storage.refresh(a.p,a.access,refresh.budget);
  if(boundary==='noop'){enabled=true;a.storage.refresh(a.p,a.access,refresh.budget);}
  const observed=readTransaction(a.facade.port.db,()=>a.storage.observe(a.p,a.access));assert.equal(observed.dto.lexical.state,'stale');
  assert.equal(observed.dto.lexical.reason,'fence_changed');assert.equal(observed.dto.coverage.byType.memory.eligible,null);
  const side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX,{readOnly:true});
  const record=JSON.parse(side.prepare('SELECT record FROM validation_records').get().record);side.close();
  assert.equal(record.canonicalFenceDigest,expected);verifiedRecord(a.facade.port.identity.cursorSecret,'validation',canonicalJson(record));
  const r=configured(t,f.path),reader=await r.open();assert.equal((await reader.findCandidates({...input,query:'needle'},r.token)).error.code,'index_unavailable');await reader.close();
  enabled=false;a.storage.refresh(a.p,a.access,refresh.budget);assert.equal(readTransaction(a.facade.port.db,()=>a.storage.observe(a.p,a.access)).dto.lexical.state,'ready');
});
function runWrite(path){
  const r=spawnSync(process.execPath,['--input-type=module','-e',`import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync(process.argv[1]);d.exec('PRAGMA busy_timeout=0;BEGIN IMMEDIATE;UPDATE namespace_epochs SET epoch=epoch+1;COMMIT');d.close();`,path],{env:{},encoding:'utf8',timeout:5000});
  assert.equal(r.status,0,r.stderr);
}
for(const version of [18,23])test(`P2-20 v${version} canonical-only WAL restore stays unavailable until quiescent explicit rebuild`,async t=>{
  const f=setup(t,'WAL',version),s=configured(t,f.path,{service:true}),h=await s.open();await build(h,s.token);await h.close();
  assert.ok((await s.supervisor.drain()).every(r=>r.telemetry==='complete'));
  // Writable close checkpoints through SQLite after all clients and maintenance
  // have stopped; copying only canonical is valid at this quiescent boundary.
  run('mode',f.path,'WAL');assert.equal(existsSync(f.path+'-wal'),false);
  const restored=join(f.workspace.path,'restored.sqlite');run('copy',f.path,restored);
  const logical=run('logical',f.path);assert.deepEqual(run('logical',restored),logical);
  const a=configured(t,restored),reader=await a.open();assert.equal((await reader.findCandidates({...input,query:'needle'},a.token)).error.code,'index_unavailable');await reader.close();
  const service=configured(t,restored,{service:true}),maintainer=await service.open();await build(maintainer,service.token);await maintainer.close();
  const fresh=configured(t,restored),exposed=await fresh.open();assert.equal(ok(await exposed.findCandidates({...input,query:'needle'},fresh.token)).items.length,2);await exposed.close();
});

test('P2-09 WAL sidecar committed checkpoint survives Worker crash and independent canonical writer',async t=>{
  const f=setup(t),first=configured(t,f.path,{service:true}),begin=await first.open();
  const initial=ok(await begin.refreshContextIndex({...refresh,budget:{maxItems:1,maxMs:5000}},first.token));
  assert.equal(initial.progress.lexical.checkpoint,1);await begin.close();
  const s=configured(t,f.path,{service:true,spawnWorker:data=>new Worker(new URL('./fixtures/context-product-index-worker.mjs',import.meta.url),{workerData:data,env:{},execArgv:[]})});
  s.options.host.configuration.crashBeforeBatchCommit=true;
  const h=await s.open();assert.equal((await h.refreshContextIndex({...refresh,budget:{maxItems:1,maxMs:5000}},s.token)).error.code,'reader_failed');await h.close();
  const r=configured(t,f.path),reader=await r.open();const progress=ok(await reader.getContextIndexStatus(input,r.token));
  assert.equal(progress.lexical.state,'building');assert.equal(progress.lexical.progress.checkpoint,1);await reader.close();
  const w=await writer(t,f.path);await w.call('write');await w.call('close');
  const next=configured(t,f.path,{service:true}),maintainer=await next.open();await build(maintainer,next.token);await maintainer.close();
  const fresh=configured(t,f.path),ready=await fresh.open();assert.equal(ok(await ready.getContextIndexStatus(input,fresh.token)).lexical.state,'ready');await ready.close();
});

for(const service of [false,true])for(const behavior of ['busy5','busy6','inflight','snapshot'])
test(`P2-17/cancellation WAL ${service?'maintainer':'reader'} ${behavior}: settlement, native drain and writer progress rendezvous`,async t=>{
  const {MessageChannel}=await import('node:worker_threads');
  const f=setup(t),builder=configured(t,f.path,{service:true}),initial=await builder.open();await build(initial,builder.token);await initial.close();
  const {port1,port2}=new MessageChannel(),gate=new SharedArrayBuffer(4),view=new Int32Array(gate);
  t.after(()=>{Atomics.store(view,0,1);Atomics.notify(view,0);port1.close();});
  let releaseTermination,terminationStarted,terminate,worker,offset=0n;const timers=new Set();
  const terminationGate=new Promise(resolve=>{releaseTermination=resolve;});
  const started=new Promise(resolve=>{terminationStarted=resolve;});
  const c=configured(t,f.path,{service});
  const runtime=createProductReaderRuntime({maintenance:service,now:()=>process.hrtime.bigint()+offset,
    setTimer(fn,ms){const timer={fn,ms,unref(){}};timers.add(timer);return timer;},clearTimer(timer){timers.delete(timer);},
    spawnWorker(data){worker=new Worker(new URL('./fixtures/context-product-wal-worker.mjs',import.meta.url),{
      workerData:{...data,walTestControl:{port:port2,gate,behavior}},transferList:[port2],env:{},execArgv:[]});
      terminate=worker.terminate.bind(worker);worker.terminate=()=>terminationGate.then(()=>{const result=terminate();terminationStarted();return result;});return worker;}});
  const h=await runtime(c.options);t.after(()=>h.close());const controller=new AbortController();
  const entered=once(port1,'message');
  const pending=service?h.refreshContextIndex(refresh,c.token,{signal:controller.signal}):h.getContextIndexStatus(input,c.token,{signal:controller.signal});
  assert.equal((await entered)[0],behavior.startsWith('busy')?'failure-committed':'entered-native');
  if(behavior==='snapshot')controller.abort();
  else {offset=6000000000n;for(const timer of [...timers])if(timer.ms<60000)timer.fn();}
  assert.deepEqual(await pending,{ok:false,error:{code:behavior==='snapshot'?'read_cancelled':'read_timeout',retryable:false}});
  assert.ok([...supervisorOwner(c.supervisor).owner.records].some(r=>r.cleaning && r.state==='pending'));
  // Termination acknowledgement is intentionally withheld. An ordinary WAL
  // commit must succeed even while the canceled native read snapshot is live.
  const w=await writer(t,f.path);await w.call('write');await w.call('close');
  releaseTermination();await started;Atomics.store(view,0,1);Atomics.notify(view,0);await h.close();
  const records=await c.supervisor.drain();
  if(behavior.startsWith('busy')){
    const record=records.find(r=>r.diagnostics.busy>0);assert.ok(record);assert.equal(record.telemetry,'complete');
    assert.equal(record.diagnostics.records[0].sqlite.code,behavior==='busy5'?5:6);
    assert.doesNotMatch(JSON.stringify(record),/synthetic private/);
  }else assert.ok(records.some(r=>r.telemetry==='incomplete'),'unreturned native outcome cannot claim zero busy');
});

for(const [flag,status] of [['publicationRace','rebuilding'],['afterSnapshotRace','complete']])
test(`P2-21 WAL actual maintainer ${flag} has correct completion and fresh-reader currentness`,async t=>{
  const f=setup(t),s=configured(t,f.path,{service:true,spawnWorker:data=>new Worker(new URL('./fixtures/context-product-index-worker.mjs',import.meta.url),{workerData:data,env:{},execArgv:[]})});
  s.options.host.configuration[flag]=true;
  const h=await s.open();assert.equal(ok(await h.refreshContextIndex(refresh,s.token)).status,status);assert.equal(new Int32Array(s.state)[6],1);await h.close();
  const fresh=configured(t,f.path),reader=await fresh.open();assert.equal(ok(await reader.getContextIndexStatus(input,fresh.token)).lexical.state,'stale');
  assert.equal((await reader.findCandidates({...input,query:'needle'},fresh.token)).error.code,'index_unavailable');await reader.close();
});

test('P2-01/10 WAL opt-in is strict, default refusal and capability bytes stay identical',async t=>{
  const f=setup(t,'DELETE'),a=configured(t,f.path,{wal:false}),b=configured(t,f.path,{wal:false});delete a.options.wal;
  const first=await a.open(),second=await b.open();
  // Frozen P2b capability/assembly bytes, with P2c's approved 32-namespace
  // maximum as the sole delta. Both default spellings must match every byte;
  // preserve the original P2b fixture as independent historical evidence.
  const golden=readFileSync(new URL('./fixtures/context-product-capabilities-p2b.json',import.meta.url),'utf8').trimEnd()
    .replace('"readSetMaximum":2,','"readSetMaximum":32,');
  assert.equal(JSON.parse(golden).value.readSetMaximum,32);
  assert.equal(JSON.stringify(await first.getContextReadCapabilities()),golden);
  assert.equal(JSON.stringify(await second.getContextReadCapabilities()),golden);
  assert.deepEqual(ok(await first.getContextReadCapabilities()).journals,['DELETE']);await first.close();await second.close();
  run('mode',f.path,'WAL');const refused=configured(t,f.path,{wal:false});await assert.rejects(refused.open(),{code:'index_unavailable'});
  const service=configured(t,f.path,{service:true,wal:false});await assert.rejects(service.open(),{code:'index_unavailable'});
  for(const wal of [null,1,'WAL',{}]){const c=configured(t,f.path);c.options.wal=wal;await assert.rejects(c.open(),{code:'invalid_input'});}
});
test('P2-10 product policy has no raw data descriptors, application retry, sleep or companion deletion',()=>{
  const policy=readFileSync(new URL('../context-product-sqlite.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(policy,/\b(?:openSync|readFileSync|writeFileSync|unlinkSync|setTimeout|setInterval|immutable|wal_checkpoint)\s*\(/);
  const sidecar=readFileSync(new URL('../context-product-sidecar.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(sidecar,/PRAGMA journal_mode\s*=/i);
});

test('P2-10 native BUSY wins over a companion refusal during cleanup; unsupported opening keeps numeric telemetry',t=>{
  const ws=createTestWorkspace(t),path=join(ws.path,'fake.sqlite');writeFileSync(path,'fixture',{mode:0o600});
  const fault=Object.assign(Error('private'),{code:'ERR_SQLITE_ERROR',errcode:261});let closes=0,reads=0;
  const native={isOpen:true,isTransaction:false,
    exec(sql){if(sql==='BEGIN')this.isTransaction=true;if(['COMMIT','ROLLBACK'].includes(sql))this.isTransaction=false;},
    close(){closes++;this.isOpen=false;},prepare(sql){return {get(){
      if(sql==='PRAGMA journal_mode')return {journal_mode:'wal'};
      if(sql==='PRAGMA query_only')return {query_only:0};
      reads++;writeFileSync(path+'-wal','unsafe',{mode:0o644});throw fault;
    }};}};
  const policy=createProductSqlitePolicy({now:()=>0});policy.start(5000);const {db}=policy.open(native,path);
  assert.throws(()=>readTransaction(db,()=>db.prepare('SELECT busy').get()),e=>e===fault);
  assert.equal(reads,1);assert.equal(native.isTransaction,false);db.close();assert.equal(closes,1);unlinkSync(path+'-wal');
  const frame=nativeTelemetry('unsupported-arrangement',1),observed=nativeObserver(frame),p=createProductSqlitePolicy({observer:observed});p.start(Infinity);
  const unavailable=Object.assign(Error('private CANTOPEN'),{code:'ERR_SQLITE_ERROR',errcode:14});
  native.isOpen=true;native.prepare=()=>{throw unavailable;};
  assert.throws(()=>p.open(native,path),{code:'index_unavailable'});sealNative(frame);
  const d=drainNative(frame,true);assert.equal(d.coverage,'complete');assert.equal(d.busy,0);assert.equal(d.records[0].statement,'journal_mode');assert.equal(d.records[0].sqlite.code,14);
});

test('P2-21 WAL timeout after committed publication discards reply while a fresh request sees durable ready state',async t=>{
  const {MessageChannel}=await import('node:worker_threads');const f=setup(t),c=configured(t,f.path,{service:true});
  const {port1,port2}=new MessageChannel(),gate=new SharedArrayBuffer(4),view=new Int32Array(gate);let offset=0n;
  const timers=new Set();t.after(()=>{Atomics.store(view,0,1);Atomics.notify(view,0);port1.close();});
  const runtime=createProductReaderRuntime({maintenance:true,now:()=>process.hrtime.bigint()+offset,
    setTimer(fn,ms){const timer={fn,ms,unref(){}};timers.add(timer);return timer;},clearTimer(timer){timers.delete(timer);},
    spawnWorker:data=>new Worker(new URL('./fixtures/context-product-wal-worker.mjs',import.meta.url),{
      workerData:{...data,walTestControl:{port:port2,gate,behavior:'reply'}},transferList:[port2],env:{},execArgv:[]})});
  const h=await runtime(c.options);t.after(()=>h.close());const entered=once(port1,'message'),pending=h.refreshContextIndex(refresh,c.token);
  assert.equal((await entered)[0],'failure-committed');offset=6000000000n;for(const timer of [...timers])if(timer.ms<60000)timer.fn();
  assert.equal((await pending).error.code,'read_timeout');Atomics.store(view,0,1);Atomics.notify(view,0);await h.close();
  const fresh=configured(t,f.path),reader=await fresh.open();assert.equal(ok(await reader.getContextIndexStatus(input,fresh.token)).lexical.state,'ready');await reader.close();
});

for(const safe of [true,false])test(`P2-10 opening probe adopts SQLite-recreated companions only when protected (${safe})`,t=>{
  const ws=createTestWorkspace(t),path=join(ws.path,'probe.sqlite');writeFileSync(path,'fixture',{mode:0o600});
  writeFileSync(path+'-wal','old',{mode:0o600});
  const native={exec(){},close(){},prepare(sql){return {get(){
    if(sql==='PRAGMA journal_mode'){
      renameSync(path+'-wal',path+'-wal.old');writeFileSync(path+'-wal','new',{mode:safe?0o600:0o644});return {journal_mode:'wal'};
    }return 1;
  }};}};
  const p=createProductSqlitePolicy({now:()=>0});p.start(5000);
  if(!safe)assert.throws(()=>p.open(native,path),{code:'index_unavailable'});
  else {
    const {db}=p.open(native,path);assert.equal(db.prepare('SELECT metadata').get(),1);
    renameSync(path+'-wal',path+'-wal.replaced');writeFileSync(path+'-wal','uncoordinated',{mode:0o600});
    assert.throws(()=>db.prepare('SELECT metadata'),{code:'index_unavailable'});db.close();
  }
});


test('P2-08/09 mixed physical v23 WAL sidecar remains ready-only after independent writer catch-up',async t=>{
  const f=fixture(t,{cards:true}),memory=f.admit('mixed wal needle');
  const draft=ok(f.host.call(f.core,'createCardDraft',{namespace:ns,actionId:'wal-draft',drafting:'authored',input:{title:'mixed wal needle Card',body:'Canonical Card body',authoredInput:{text:'Card support',occurredAt:null}}}));
  const card=ok(f.host.call(f.core,'confirmCardDraft',{namespace:ns,cardId:draft.id,expectedRevision:draft.revision,actionId:'wal-confirm',applicability:'current'}));
  f.core.close();run('mode',f.path,'WAL');
  const service=configured(t,f.path,{service:true}),h=await service.open();
  for(const intent of ['current','history'])await build(h,service.token,{types:['memory','card'],intent});await h.close();
  const w=await writer(t,f.path);await w.call('write');
  const next=configured(t,f.path,{service:true}),maintainer=await next.open();
  for(const intent of ['current','history'])await build(maintainer,next.token,{types:['memory','card'],intent});await maintainer.close();
  const request=configured(t,f.path,{spawnWorker:data=>new Worker(new URL('./fixtures/context-product-index-worker.mjs',import.meta.url),{workerData:data,env:{},execArgv:[]})});
  request.options.host.configuration.trapReads=true;
  const reader=await request.open();
  for(const intent of ['current','history']){
    const p={...input,types:['memory','card'],intent};
    const result=ok(await reader.findCandidates({...p,query:'needle'},request.token));
    assert.equal(result.items.length,2);assert.ok(result.items.some(r=>r.ref.cardId===card.id));assert.ok(result.items.some(r=>r.ref.memoryId===memory.id));
    const assembled=ok(await reader.contextRead({...p,query:'needle',budget:{maxTokens:4000,maxItems:12}},request.token));assert.equal(assembled.metered.items.length,2);
  }
  await reader.close();await w.call('close');
});


test('P2-10 opted-in canonical DELETE permits a safe active journal with zero wait and refuses hot recovery untouched',async t=>{
  const f=setup(t,'DELETE'),w=await writer(t,f.path,'DELETE');
  const held=new DatabaseSync(f.path);held.exec('BEGIN IMMEDIATE; UPDATE namespace_epochs SET epoch=epoch+1');
  assert.equal(existsSync(f.path+'-journal'),true);
  const p=createProductSqlitePolicy();p.start(Infinity);const facade=openContextProductFacade(f.path,{sqlite:p});
  assert.equal(facade.port.db.prepare('PRAGMA busy_timeout').get().timeout,0);facade.close();held.exec('ROLLBACK');held.close();await w.call('close');
  run('hot',f.path);assert.equal(existsSync(f.path+'-journal'),true);
  const before=run('bytes',f.path),request=configured(t,f.path);
  await assert.rejects(request.open(),{code:'index_unavailable'});
  assert.deepEqual(run('bytes',f.path),before,'canonical read-only opening never recovers or edits a hot journal');
});


for(const target of ['canonical','side'])test(`P2-10 actual product ${target} opening adopts coordinated fresh-writer-close companions`,async t=>{
  const {MessageChannel}=await import('node:worker_threads');
  const f=setup(t),service=configured(t,f.path,{service:true}),h=await service.open();await build(h,service.token);await h.close();
  const path=target==='canonical'?f.path:f.path+PRODUCT_SIDECAR_SUFFIX;
  const w=await writer(t,path);await w.call('exclusiveEmpty');assert.equal(existsSync(path+'-shm'),true);
  const {port1,port2}=new MessageChannel(),gate=new SharedArrayBuffer(4),view=new Int32Array(gate);
  t.after(()=>{Atomics.store(view,0,1);Atomics.notify(view,0);port1.close();});
  const request=configured(t,f.path,{spawnWorker:data=>new Worker(new URL('./fixtures/context-product-wal-worker.mjs',import.meta.url),{
    workerData:{...data,walTestControl:{port:port2,gate,behavior:target+'-close'}},transferList:[port2],env:{},execArgv:[]})});
  let reader,pending;const entered=once(port1,'message');
  if(target==='canonical')pending=request.open();
  else{reader=await request.open();pending=reader.getContextIndexStatus(input,request.token);}
  assert.equal((await entered)[0],'opening-mode-entered');await w.call('close');
  Atomics.store(view,0,1);Atomics.notify(view,0);
  if(target==='canonical')reader=await pending;else assert.equal(ok(await pending).lexical.state,'ready');
  assert.equal(ok(await reader.getContextIndexStatus(input,request.token)).lexical.state,'ready');await reader.close();
});

test('P2-10 actual canonical opening retains the identity pinned before native construction',t=>{
  const f=setup(t);let replaced=false;
  const observer={database(native){
    if(!replaced){replaced=true;renameSync(f.path,f.path+'.old');run('copy',f.path+'.old',f.path);}
    return native;
  }};
  const sqlite=createProductSqlitePolicy({observer});sqlite.start(Infinity);
  assert.throws(()=>openContextProductFacade(f.path,{sqlite}),{code:'index_unavailable'});
});


for(const target of ['lifecycle','side'])for(const code of [5,14])
test(`P2d fix round 1 failed ${target} admission SQLite ${code} recovers on a distinct operation and closes once`,t=>{
  const f=setup(t),builder=local(t,f);builder.storage.refresh(builder.p,builder.access,refresh.budget);builder.storage.close();
  let contended=true;const connections=[],fault=Object.assign(Error('private opening fault'),{code:'ERR_SQLITE_ERROR',errcode:code});
  const policy=createProductSqlitePolicy({now:()=>0});policy.start(0);
  const sqlite={...policy,open(native,path){
    const record={path,closes:0};connections.push(record);
    const wrapped=new Proxy(native,{get(object,key){
      if(key==='close')return ()=>{record.closes++;return object.close();};
      if(key==='prepare')return sql=>{
        if(contended && sql==='PRAGMA journal_mode' && (target==='lifecycle'?path.endsWith('.lifecycle-lock.sqlite'):path.endsWith(PRODUCT_SIDECAR_SUFFIX)))throw fault;
        return object.prepare(sql);
      };
      const value=Reflect.get(object,key,object);return typeof value==='function'?value.bind(object):value;
    }});
    return policy.open(wrapped,path);
  }};
  const a=local(t,f,{sqlite});
  if(code===5)assert.throws(()=>a.storage.prepareObservation(),e=>e===fault);
  else assert.equal(a.storage.prepareObservation(),'storage_unavailable');
  assert.equal(connections.filter(c=>c.closes===1).length,1);
  contended=false;sqlite.start(5000);
  assert.doesNotThrow(()=>a.storage.refresh(a.p,a.access,refresh.budget));
  assert.equal(a.storage.observe(a.p,a.access).dto.lexical.state,'ready');
  a.storage.close();a.storage.close();assert.ok(connections.every(c=>c.closes===1),JSON.stringify(connections));
});

test('P2d fix round 1 repeated configured-mode refusal discards writable connections',t=>{
  const f=setup(t),builder=local(t,f);builder.storage.refresh(builder.p,builder.access,refresh.budget);builder.storage.close();
  const a=local(t,f,{sidecarJournalMode:'DELETE'});
  for(let i=0;i<2;i++)assert.throws(()=>a.storage.refresh(a.p,a.access,refresh.budget),{code:'index_unavailable',reason:'storage_unavailable'});
});

for(const boundary of ['open','mode','execute','close'])
test(`P2d fix round 1 initialization ${boundary} failure reaches the supervisor with its native boundary`,async t=>{
  const f=setup(t),s=configured(t,f.path,{service:true,spawnWorker:data=>new Worker(new URL('./fixtures/context-product-wal-worker.mjs',import.meta.url),{
    workerData:{...data,walTestControl:{behavior:'init-'+boundary+'-14'}},env:{},execArgv:[]})});
  const h=await s.open();assert.equal((await h.refreshContextIndex(refresh,s.token)).error.code,'index_unavailable');
  // Child failure did not poison lifecycle ownership: a distinct refresh works.
  assert.equal(ok(await h.refreshContextIndex(refresh,s.token)).status,'complete');await h.close();
  const records=await s.supervisor.drain(),record=records.find(r=>r.diagnostics?.records.some(d=>d.sqlite.code===14));assert.ok(record);
  assert.equal(record.telemetry,'complete');
  const native=record.diagnostics.records.find(d=>d.sqlite.code===14);
  assert.equal(native.stage,{open:'open',mode:'configure',execute:'begin',close:'close'}[boundary]);
  assert.equal(native.statement,boundary==='mode'?'journal_mode':boundary==='execute'?'transaction':'connection');
  assert.doesNotMatch(JSON.stringify(records),/private initialization/);
});

for(const code of [8,10,13,5])test(`P2d fix round 1 staged companion initialization SQLite ${code} maps through refresh`,async t=>{
  const f=setup(t),s=configured(t,f.path,{service:true,spawnWorker:data=>new Worker(new URL('./fixtures/context-product-wal-worker.mjs',import.meta.url),{
    workerData:{...data,walTestControl:{behavior:'init-mode-'+code}},env:{},execArgv:[]})});
  const h=await s.open();assert.equal((await h.refreshContextIndex(refresh,s.token)).error.code,code===5?'storage_busy':'index_unavailable');await h.close();
  const records=await s.supervisor.drain();assert.ok(records.some(r=>r.telemetry==='complete' && r.diagnostics.records.some(d=>d.sqlite.code===code && d.statement==='journal_mode')));
});

for(const boundary of ['truncated','omitted','truncatedbusy'])test(`P2d fix round 1 ${boundary} initialization transcript cannot claim complete coverage`,async t=>{
  const f=setup(t),s=configured(t,f.path,{service:true,spawnWorker:data=>new Worker(new URL('./fixtures/context-product-wal-worker.mjs',import.meta.url),{
    workerData:{...data,walTestControl:{behavior:'init-'+boundary+(boundary==='truncatedbusy'?'-5':'')}},env:{},execArgv:[]})});
  const h=await s.open();assert.equal((await h.refreshContextIndex(refresh,s.token)).error.code,boundary==='truncatedbusy'?'storage_busy':'index_unavailable');await h.close();
  assert.ok((await s.supervisor.drain()).some(r=>r.telemetry==='incomplete'));
});

for(const code of [5,14,13])test(`P2d fix round 2 repair terminal SQLite ${code} controls public refresh after handled corruption`,async t=>{
  const f=setup(t,'DELETE'),side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX);
  side.exec('CREATE TABLE damaged_cache(id)');side.close();chmodSync(f.path+PRODUCT_SIDECAR_SUFFIX,0o600);
  const s=configured(t,f.path,{service:true,sideMode:'DELETE',spawnWorker:data=>new Worker(new URL('./fixtures/context-product-wal-worker.mjs',import.meta.url),{
    workerData:{...data,walTestControl:{behavior:'init-repair-'+code}},env:{},execArgv:[]})});
  const h=await s.open(),result=await h.refreshContextIndex(refresh,s.token);
  assert.equal(result.error.code,code===5?'storage_busy':'index_unavailable');
  assert.equal(result.error.retryable,code===5);
  assert.equal(ok(await h.refreshContextIndex(refresh,s.token)).status,'complete');await h.close();
  const records=await s.supervisor.drain(),record=records.find(r=>r.diagnostics?.records.some(d=>d.sqlite.code===11));
  assert.ok(record);assert.equal(record.telemetry,'complete');
  assert.deepEqual(record.diagnostics.records.map(d=>[d.stage,d.statement,d.sqlite.code]),[
    ['prepare','context_evidence',1],
    ['prepare','schema_metadata',11],['configure','journal_mode',code],
  ]);
  assert.doesNotMatch(JSON.stringify(records),/private incumbent|private initialization/);
});

for(const finish of ['next','other-iterator','helper','helper-observed','reentrant-statement','return','for-of','close','dispose'])
test(`P2d fix round 2 DELETE journal replacement tracks native activity through ${finish}`,t=>{
  const ws=createTestWorkspace(t),path=join(ws.path,'iterator.sqlite');
  const setup=new DatabaseSync(path);setup.exec('CREATE TABLE probe(id); INSERT INTO probe VALUES(1),(2),(3)');setup.close();chmodSync(path,0o600);
  // Synthetic protected companions never enter SQLite: journal metadata is
  // supplied separately while all statement/iterator semantics are native.
  let journal=1n;
  const original=fs.lstatSync;
  t.mock.method(fs,'lstatSync',(entry,options)=>{
    if(entry!==path+'-journal')return original(entry,options);
    const stat=original(path,options),ino=journal;
    return new Proxy(stat,{get(object,key){
      if(key==='ino')return ino;
      const value=Reflect.get(object,key,object);return typeof value==='function'?value.bind(object):value;
    }});
  });syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
  const policy=createProductSqlitePolicy({observer:finish==='helper-observed'?nativeObserver():undefined});policy.start(Infinity);
  const native=new DatabaseSync(path,{readOnly:true}),{db}=policy.open(native,path);
  t.after(()=>{if(native.isOpen)db.close();});
  if(finish==='reentrant-statement'){
    native.function('replace_journal',()=>{journal++;db.prepare('SELECT 1').get();return 1;});
    assert.throws(()=>db.prepare('SELECT replace_journal()').get(),{code:'index_unavailable'});
    db.close();return;
  }
  const statement=db.prepare('SELECT id FROM probe'),iterator=statement.iterate();
  assert.equal(iterator.next().value.id,1);assert.equal(native.isTransaction,false);
  if(['next','other-iterator','helper','helper-observed'].includes(finish)){
    const pending=finish.startsWith('helper')?iterator.map(row=>row):finish==='next'?iterator:db.prepare('SELECT id FROM probe').iterate();
    if(finish==='other-iterator'){assert.equal(pending.next().value.id,1);iterator.return();}
    journal++;assert.throws(()=>pending.next(),{code:'index_unavailable'});
    assert.throws(()=>db.prepare('SELECT 1'),{code:'index_unavailable'});
    // Cancellation must still release native resources after guard refusal.
    // A helper is already done after its source throws; close the source itself.
    assert.throws(()=>(finish.startsWith('helper')?iterator:pending).return(),{code:'index_unavailable'});
  }else if(finish==='return')iterator.return();
  else if(finish==='for-of'){for(const row of iterator){assert.equal(row.id,2);break;}}
  else if(finish==='close')db.close();
  else db[Symbol.dispose]();
  if(native.isOpen){
    if(!['next','other-iterator','helper','helper-observed'].includes(finish))journal++;
    assert.equal(statement.get().id,1,'completed/cancelled cursors allow legitimate recreation');
    const completed=statement.iterate();assert.equal([...completed].length,3);
    journal++;assert.equal(statement.get().id,1,'exhaustion releases iterator tracking');
    const disposable=statement.iterate();disposable.next();
    if(typeof disposable[Symbol.dispose]==='function')disposable[Symbol.dispose]();else disposable.return();
    journal++;assert.equal(statement.get().id,1,'iterator disposal releases tracking when supported');
    db.close();
  }else assert.equal(native.isOpen,false);
});


test('P2d fix round 1 DELETE journal recreation between released snapshots preserves locks and availability',async t=>{
  const f=setup(t,'DELETE'),w=await writer(t,f.path,'DELETE');await w.call('journal');
  const old=productSqliteFiles(f.path);old();
  const pin=fork(processFixture,['pin-journal',f.path],{env:{},execArgv:[],stdio:['ignore','ignore','pipe','ipc']});
  const exited=once(pin,'exit');let ended=false;pin.once('exit',()=>{ended=true;});
  t.after(async()=>{if(!ended){pin.kill();await exited;}});
  assert.equal((await once(pin,'message'))[0].ready,true);
  const p=createProductSqlitePolicy();p.start(Infinity);const {db}=p.open(new DatabaseSync(f.path,{readOnly:true}),f.path);t.after(()=>{if(db.isOpen)db.close();});
  readTransaction(db,()=>db.prepare('SELECT epoch FROM namespace_epochs').all());
  await w.call('commit');await w.call('journal');
  // The checker never observed absence: the next protected journal has a new
  // pinned inode. A bare continuous-identity check confirms the test precondition.
  assert.throws(()=>old(),{code:'index_unavailable'});
  db.exec('BEGIN');db.prepare('SELECT epoch FROM namespace_epochs').all();
  await w.call('commitBlocked'); // Guard stats and child raw close never release this snapshot's lock.
  const ack=once(pin,'message');pin.send({id:1,command:'close'});assert.equal((await ack)[0].ok,true);assert.equal((await exited)[0],0);
  await w.call('commitBlocked');db.exec('ROLLBACK');await w.call('release');
  await w.call('write');await w.call('close');db.close();
});

for(const kind of ['mode','symlink','type','owner','during-statement'])
test(`P2d fix round 1 journal lifecycle exception still refuses ${kind}`,t=>{
  const ws=createTestWorkspace(t),path=join(ws.path,'journal.sqlite');writeFileSync(path,'fixture',{mode:0o600});
  writeFileSync(path+'-journal','old',{mode:0o600});let transaction=false,replacing=false;
  const native={get isTransaction(){return transaction;},exec(sql){if(sql==='BEGIN')transaction=true;if(sql==='ROLLBACK')transaction=false;},close(){},prepare(sql){return {get(){
    if(sql==='PRAGMA journal_mode')return {journal_mode:'delete'};
    if(sql==='PRAGMA query_only')return {query_only:0};
    if(replacing){renameSync(path+'-journal',path+'-journal.old');writeFileSync(path+'-journal','replacement',{mode:0o600});}
    return 1;
  }};}};
  const p=createProductSqlitePolicy();p.start(Infinity);const {db}=p.open(native,path);
  if(kind==='during-statement'){
    replacing=true;assert.throws(()=>db.prepare('SELECT metadata').get(),{code:'index_unavailable'});
  }else{
    renameSync(path+'-journal',path+'-journal.old');
    if(kind==='symlink')symlinkSync(path,path+'-journal');
    else if(kind==='type')mkdirSync(path+'-journal',{mode:0o700});
    else writeFileSync(path+'-journal','new',{mode:kind==='mode'?0o644:0o600});
    if(kind==='owner'){
      // Owner-only permissions are insufficient: exercise metadata rejection
      // without requiring root/chown on a shared machine.
      const original=fs.lstatSync;
      t.mock.method(fs,'lstatSync',(entry,options)=>{
        const stat=original(entry,options);
        if(entry!==path+'-journal')return stat;
        return new Proxy(stat,{get(object,key){
          if(key==='uid')return object.uid+1n;
          const value=Reflect.get(object,key,object);return typeof value==='function'?value.bind(object):value;
        }});
      });syncBuiltinESMExports();
      t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
    }
    assert.throws(()=>db.prepare('SELECT metadata'),{code:'index_unavailable'});
  }
  db.close();
});
