import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { register, syncBuiltinESMExports } from 'node:module';
import { performance } from 'node:perf_hooks';
import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

register('data:text/javascript,'+encodeURIComponent(`
export async function load(url,context,next) {
  const result = await next(url,context);
  if (url.endsWith('/raw/local-transport.mjs')) {
    const source = String(result.source).replace('export function createLocalCaptureTransport(', 'function actualTransport(');
    return {...result,source:source+'\\nexport function createLocalCaptureTransport(...args) { const transport=actualTransport(...args); return {capture:(...call)=>globalThis[Symbol.for("resume.capture")]?.(transport,...call) ?? transport.capture(...call)}; }'};
  }
  if (url.endsWith('/raw/local-host.mjs')) {
    const source = String(result.source).replace('export function createLocalRawHost(', 'function actualHost(');
    return {...result,source:source+'\\nexport function createLocalRawHost(...args) { const host=actualHost(...args); return {...host,run:async (selection,options)=>{ const observe=globalThis[Symbol.for("resume.run")]; return observe ? observe(host,selection,options):host.run(selection,options); }}; }'};
  }
  if (url.endsWith('/raw/local-host-rearm.mjs')) {
    const source = String(result.source).replace('export async function lazyRearm(', 'async function actualLazy(');
    return {...result,source:source+'\\nexport function lazyRearm(...args) { globalThis[Symbol.for("resume.lazy")]?.(); return actualLazy(...args); }'};
  }
  return result;
}`),import.meta.url);
const { lazyFixture, ok } = await import('./fixtures/local-setup-workspace.mjs');
const { runLocalRawHook } = await import('../raw/local-hook.mjs');
const { readHostProfile, readHostConfiguration } = await import('../raw/local-host-profile.mjs');
const { withSessionIdentity, selectLocalResume } = await import('../raw/local-session-fence.mjs');
const { keyed, refreshResumeHint, chooseResumeHint } = await import('../raw/local-worker-state.mjs');
const { stateLock } = await import('../state-lock.mjs');
const { hostFixture } = await import('./fixtures/local-host-workspace.mjs');
const { workerOperation } = await import('../raw/local-worker-input.mjs');
const { FORMAT } = await import('../../codex/parser.mjs');
const { LocalCaptureTransportError } = await import('../raw/local-process.mjs');
const { withWriteObserver } = await import('../private-state.mjs');
const { sessionId } = await import('./fixtures/raw-fixtures.mjs');
const captureKey = Symbol.for('resume.capture'), runKey = Symbol.for('resume.run'), lazyKey = Symbol.for('resume.lazy');
const read = path => JSON.parse(fs.readFileSync(path,'utf8'));
const write = (path,value) => fs.writeFileSync(path,JSON.stringify(value),{mode:0o600});
const hints = f => fs.existsSync(f.resume) ? fs.readdirSync(f.resume).sort():[];
const age = (f,ms=600001) => { for (const name of hints(f)) { const path=join(f.resume,name),hint=read(path); hint.updatedAt=Date.now()-ms; write(path,hint); } };
const rows = f => { const db=new DatabaseSync(f.request.databasePath,{readOnly:true}); try {
  return {events:db.prepare('SELECT event_id FROM raw_capture_events ORDER BY event_id').all().map(row=>row.event_id),parts:db.prepare('SELECT count(*) n FROM raw_parts').get().n};
} finally { db.close(); } };
async function setup(t,client='claude-code') {
  const f=await lazyFixture(t,client); await f.hook();
  const aPath=f.cursorPath(),bPath=join(f.request.sourceRoot,'second.jsonl'),bId='synthetic-second-session';
  const text=fs.readFileSync(f.sourcePath,'utf8').replaceAll(sessionId,bId);
  fs.writeFileSync(bPath,text,{mode:0o600});
  const b=(event='Stop',options={})=>f.scoped(()=>runLocalRawHook({installationDirectory:f.request.installationDirectory,event,
    payload:{hook_event_name:event,session_id:bId,transcript_path:bPath}},options));
  await b('SessionStart');
  const profile=await readHostProfile(join(f.request.installationDirectory,'host-profile.json')),config=await readHostConfiguration(profile);
  t.after(()=>{delete globalThis[captureKey];delete globalThis[runKey];delete globalThis[lazyKey];});
  return {...f,aPath,bPath,b,profile,config,resume:join(profile.stateRoot,'resume'),a:()=>read(aPath),
    identity:work=>withSessionIdentity(profile,config,{sessionId},work)};
}
async function failCapture(f,uncertain=false) {
  f.append('Synthetic deferred final reply');
  globalThis[captureKey]=async(transport,...args)=>{if(uncertain)await transport.capture(...args);throw new LocalCaptureTransportError(uncertain,'synthetic');};
  await f.hook('Stop'); delete globalThis[captureKey];
  assert.equal(f.a().pending.state,uncertain?'uncertain':'unavailable'); assert.equal(hints(f).length,1);
}
function observeSweep(t,work) {
  let sweeps=0;
  globalThis[runKey]=async(host,selection,options)=>{
    if (!options?.sweep) return host.run(selection,options);
    sweeps++; assert.ok(options.deadlineMs<=15000); assert.ok(options.deadlineMs>0);
    globalThis[lazyKey]=()=>assert.fail('a sweep invoked lazy rearm');
    try { return await work(host,selection,options); } finally { delete globalThis[lazyKey]; }
  };
  return ()=>sweeps;
}
for (const client of ['claude-code','codex']) test(`killed dispatch is saved by a later Stop (${client})`,async t=>{
  const f=await setup(t,client); f.append('Synthetic final reply before abrupt termination');
  const settings=join(f.root,'synthetic-killed-worker.json');
  write(settings,{action:'run',options:{stateRoot:f.profile.stateRoot,identityKeyPath:f.profile.identityKeyPath,
    nodeExecutable:process.execPath,runtimeRoot:resolve(fileURLToPath(new URL('../../../',import.meta.url))),configPath:f.profile.configPath,
    expectedAuthority:f.config.authority,home:f.profile.home},context:{sessionId,sourcePath:f.sourcePath,
    pluginRoot:client==='claude-code'?f.profile.installation.pluginRoot:null,
    formatAuthority:client==='codex'?{format:FORMAT,sessionId,creatorVersion:'0.162.0',qualifiedCreatorVersion:'0.162.0'}:null}});
  // Deliver to the actual Raw core, then kill the worker before it can observe
  // the reply or advance its dispatched cursor. No provider participates.
  const preload=join(f.root,'synthetic-delivered-kill.mjs');
  const loader=`export async function load(url,context,next) {
    const result=await next(url,context);if(!url.endsWith('/raw/local-transport.mjs'))return result;
    const code=String(result.source).replace('export function createLocalCaptureTransport(', 'function actualTransport(');
    return {...result,source:code+'\\nexport function createLocalCaptureTransport(...args) { const transport=actualTransport(...args); return {capture:async(...call)=>{const result=await transport.capture(...call);process.kill(process.pid,\"SIGKILL\");return result;}}; }'};
  }`;
  fs.writeFileSync(preload,'import {register} from \"node:module\";register('+JSON.stringify('data:text/javascript,'+encodeURIComponent(loader))+',import.meta.url);',{mode:0o600});
  const death=spawnSync(process.execPath,['--import',preload,fileURLToPath(new URL('./fixtures/local-worker-driver.mjs',import.meta.url)),settings],
    {encoding:'utf8',timeout:30000});
  assert.equal(death.status,null,death.stderr); assert.equal(death.signal,'SIGKILL'); assert.equal(death.stdout,'');
  const pending=f.a().pending; assert.equal(pending.state,'dispatched'); assert.equal(hints(f).length,1);
  assert.deepEqual(rows(f),{events:[pending.projection.eventId],parts:1},'the killed sender already delivered exactly one Raw row');
  const hint=read(join(f.resume,hints(f)[0]));
  assert.deepEqual(Object.keys(hint).sort(),['iv','sealed','tag','updatedAt','version']);
  assert.equal(fs.statSync(join(f.resume,hints(f)[0])).mode&0o777,0o600);
  assert.ok(!JSON.stringify(hint).includes(f.sourcePath)); assert.ok(!JSON.stringify(hint).includes(sessionId));
  const now=Date.now(); t.mock.method(Date,'now',()=>now+600001);
  const count=observeSweep(t,async(host,selection,options)=>{const result=await host.run(selection,options);assert.equal(result.status,'progress',JSON.stringify(result));return result;});
  assert.deepEqual(await f.b(),{version:'local-raw-hook-v1',status:'ready',reason:null});
  assert.equal(count(),1); assert.equal(f.a().pending,null); assert.equal(hints(f).length,0);
  assert.deepEqual(rows(f),{events:[pending.projection.eventId],parts:1});
  await f.b(); assert.deepEqual(rows(f),{events:[pending.projection.eventId],parts:1});
});
for (const uncertain of [false,true]) test(`later Stop recovers ${uncertain?'uncertain':'unavailable'} with its frozen event`,async t=>{
  const f=await setup(t); await failCapture(f,uncertain); const pending=f.a().pending; age(f);
  if (uncertain) {
    assert.deepEqual(rows(f),{events:[pending.projection.eventId],parts:1},'the uncertain send was delivered before its acknowledgement was lost');
    let sends=0; globalThis[captureKey]=async()=>{sends++;assert.fail('resent before 125 seconds');};
    await f.b(); assert.equal(sends,0); assert.equal(f.a().pending.projection.eventId,pending.projection.eventId);
    delete globalThis[captureKey];
    const now=Date.now();t.mock.method(Date,'now',()=>now+125001);age(f);
  }
  await f.b(); assert.equal(f.a().pending,null); assert.equal(hints(f).length,0);
  assert.deepEqual(rows(f),{events:[pending.projection.eventId],parts:1});
});
test('work limit without a pending batch is continued one session per Stop',async t=>{
  const f=await setup(t);
  for(let n=0;n<33;n++) f.append('Synthetic bounded record '+n);
  const own=await f.hook('Stop'); assert.equal(own.reason,'work_limit'); assert.equal(f.a().pending,null); assert.equal(hints(f).length,1);
  age(f); const count=observeSweep(t,(host,selection,options)=>host.run(selection,options));
  assert.equal((await f.b()).status,'ready'); assert.equal(count(),1); assert.equal(rows(f).parts,33); assert.equal(hints(f).length,0);
});
test('own Stop and sweep contend on the same session lock, with one admission and one hint removal',{timeout:20000},async t=>{
  const f=await setup(t); await failCapture(f); age(f); const event=f.a().pending.projection.eventId;
  let entered,release;const started=new Promise(resolve=>{entered=resolve}),gate=new Promise(resolve=>{release=resolve});
  let sends=0,removals=0;
  globalThis[captureKey]=async(transport,...args)=>{sends++;entered();await gate;return transport.capture(...args);};
  const unlink=fsp.unlink;t.mock.method(fsp,'unlink',async function(path,...args){if(path===join(f.resume,hints(f)[0]??''))removals++;return unlink.call(this,path,...args);});syncBuiltinESMExports();
  const sweeping=f.b(); await started;
  try {
    assert.equal((await f.hook('Stop')).reason,'state_busy'); assert.equal(sends,1);
  } finally {release();}
  assert.equal((await sweeping).status,'ready'); assert.equal(sends,1); assert.equal(hints(f).length,0); assert.equal(removals,1);
  assert.deepEqual(rows(f),{events:[event],parts:1});
});
// fd- and FileHandle-aware observation, matching the headless regression spy.
function sourceSpy(t,root) {
  const accesses=[],inside=value=>{const path=Buffer.isBuffer(value)?value.toString():value instanceof URL?fileURLToPath(value):value;
    return typeof path==='string'&&(path===root||path.startsWith(root+'/')||path==='/proc/self/fd'||path.startsWith('/proc/self/fd/'));};
  for(const [module,names] of [[fsp,['open','stat','lstat','realpath','readFile','readdir']],[fs,['openSync','statSync','lstatSync','realpathSync','readFileSync','readdirSync']]])for(const name of names){
    const original=module[name];t.mock.method(module,name,function(...args){
      if(args.some(inside))accesses.push({name,path:String(args.find(inside))});
      const result=Reflect.apply(original,this,args);if(module!==fsp||name!=='open')return result;
      return result.then(handle=>{
        if(inside(args[0]))accesses.push({name:'opened',path:fs.readlinkSync('/proc/self/fd/'+handle.fd),fd:handle.fd});
        for(const method of ['read','readFile','stat','readv']){const actual=handle[method];t.mock.method(handle,method,function(...values){
        if(inside(args[0]))accesses.push({name:'FileHandle.'+method,path:String(args[0]),fd:handle.fd});return Reflect.apply(actual,this,values);});}return handle;});
    });
  }
  syncBuiltinESMExports();return accesses;
}
for(const kind of ['fork','forget','correct','deleted-episode','rearm','stale-authority'])test(`${kind} drops the hint before any source metadata or bytes`,async t=>{
  const f=await setup(t); await failCapture(f); age(f);
  await f.identity(async identity=>{
    if(kind==='fork')ok(f.core.fenceSession({namespace:f.request.namespace,client:'claude-code',sessionId:identity.wireSessionId}));
    else if(kind==='rearm') {const cursor=f.a();cursor.rearmRevision=1;write(f.aPath,cursor);}
    else if(kind==='stale-authority') {const cursor=f.a();cursor.authorityCommitment='0'.repeat(64);write(f.aPath,cursor);}
    else if(kind==='deleted-episode') {
      // Use the core's actual episode deletion path on a synthetic episode.
      const { openMemoryCore }=await import('../../../core/index.mjs');
      const { options }=await import('../../../core/testing/episode-helpers.mjs');
      const { model }=await import('../../../core/testing/episode-capture-helpers.mjs');
      const core=openMemoryCore({path:f.request.databasePath,...options,model:model()});
      try {
        const result=ok(await core.capture({namespace:f.request.namespace,client:'claude-code',sessionId:identity.wireSessionId,
          eventId:'synthetic-episode-event',episodeContext:{clientLabel:'Synthetic',generation:'initial',origin:'ordinary'},
          messages:[{id:'synthetic-episode-message',role:'user',content:'Synthetic episode'}]}));
        const episode=ok(core.getEpisode({namespace:f.request.namespace,episodeId:result.episode.id})).episode;
        ok(core.forgetEpisode({namespace:f.request.namespace,episodeId:episode.id,expectedRevision:episode.revision}));
      } finally {await core.close();}
    } else {
      const { openMemoryCore }=await import('../../../core/index.mjs');
      const core=openMemoryCore({path:f.request.databasePath,raw:true,rawSearch:false});
      try {
      const memory=ok(core.admit({namespace:f.request.namespace,memory:{content:'Synthetic remembered statement',kind:'fact'},
        receipts:[{client:'claude-code',sessionId:identity.wireSessionId,eventId:'synthetic-memory-event',role:'user',excerpt:'Synthetic statement'}]})).memory;
      const input={namespace:f.request.namespace,memoryId:memory.id,expectedRevision:memory.revision};
      ok(kind==='forget'?core.forget(input):core.correct({...input,content:'Synthetic corrected statement',kind:'fact',receipt:{client:'manual',sessionId:'explicit',eventId:'synthetic-correction',role:'user',excerpt:'Synthetic correction'}}));
      } finally {await core.close();}
    }
  });
  const accesses=sourceSpy(t,f.request.sourceRoot);
  try {assert.equal(await selectLocalResume(f.profile.profilePath),null);assert.deepEqual(accesses,[]);assert.equal(hints(f).length,0);}
  finally {t.mock.restoreAll();syncBuiltinESMExports();}
});
test('sweep opens only its selected transcript, including fd-relative opens and handle reads',async t=>{
  const f=await setup(t);await failCapture(f);age(f);
  const other=join(f.request.sourceRoot,'unrelated.jsonl');fs.writeFileSync(other,'Synthetic unrelated data',{mode:0o600});
  let observed;
  observeSweep(t,async(host,selection,options)=>{const accesses=sourceSpy(t,f.request.sourceRoot);
    try {const result=await host.run(selection,options);observed=[...accesses];return result;}
    finally {t.mock.restoreAll();syncBuiltinESMExports();}});
  await f.b();assert.ok(observed.some(row=>row.name==='FileHandle.read'));
  assert.ok(observed.some(row=>row.name==='open'&&row.path.startsWith('/proc/self/fd/')));
  assert.ok(observed.some(row=>row.path.endsWith('/session.jsonl')));
  assert.ok(observed.every(row=>!row.path.endsWith('/unrelated.jsonl')&&!row.path.endsWith('/second.jsonl')));
  assert.deepEqual([...new Set(observed.filter(row=>row.name==='opened'&&row.path.endsWith('.jsonl')).map(row=>row.path))],[f.sourcePath]);
  assert.ok(observed.every(row=>!['readdir','readdirSync'].includes(row.name)),'no source directory scan');
});
for(const kind of ['basename','ciphertext','name'])test(`invalid ${kind} fails closed and is deleted without source access`,async t=>{
  const f=await setup(t);await failCapture(f);age(f);const original=join(f.resume,hints(f)[0]),hint=read(original);
  if(kind==='name')fs.renameSync(original,join(f.resume,'bad.json'));
  if(kind==='ciphertext'){hint.sealed=(hint.sealed.startsWith('00')?'ff':'00')+hint.sealed.slice(2);write(original,hint);}
  if(kind==='basename')await f.identity(identity=>{
    const name='0'.repeat(64),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',keyed(identity.key,'resume-hint',null).digest(),iv);
    cipher.setAAD(Buffer.from(name));const sealed=Buffer.concat([cipher.update(JSON.stringify({sessionId,sourcePath:f.sourcePath})),cipher.final()]);
    fs.unlinkSync(original);write(join(f.resume,name+'.json'),{...hint,iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),sealed:sealed.toString('hex')});
  });
  const accesses=sourceSpy(t,f.request.sourceRoot);
  try {await selectLocalResume(f.profile.profilePath).catch(error=>assert.equal(error.reason,'state_invalid'));assert.deepEqual(accesses,[]);assert.equal(hints(f).length,0);}
  finally {t.mock.restoreAll();syncBuiltinESMExports();}
});
test('capture disable clears hints; activation and Stop never rearm the abandoned session',async t=>{
  const f=await setup(t);await failCapture(f);age(f);assert.equal((await f.invoke('disable')).status,'disabled');assert.deepEqual(hints(f),[]);
  assert.equal((await f.invoke('activate')).status,'active');
  const accesses=sourceSpy(t,f.request.sourceRoot);
  try {assert.equal(await selectLocalResume(f.profile.profilePath),null);assert.deepEqual(accesses,[]);}
  finally {t.mock.restoreAll();syncBuiltinESMExports();}
});
test('headless Stop neither refreshes nor sweeps an existing hint',async t=>{
  const f=await setup(t);await failCapture(f);age(f);const path=join(f.resume,hints(f)[0]),before=fs.readFileSync(path);
  const accesses=sourceSpy(t,f.request.sourceRoot);
  try {assert.equal((await f.b('Stop',{headless:true})).reason,'headless_skipped');assert.deepEqual(accesses,[]);assert.deepEqual(fs.readFileSync(path),before);}
  finally {t.mock.restoreAll();syncBuiltinESMExports();}
});
for(const event of ['Stop','PreCompact','SessionStart'])test(`idle and event bounds (${event})`,async t=>{
  const f=await setup(t);await failCapture(f);age(f,599000);const now=Date.now();t.mock.method(Date,'now',()=>now);let sweeps=0;
  globalThis[runKey]=async(host,selection,options)=>{if(options?.sweep)sweeps++;return host.run(selection,options);};
  await f.b(event);assert.equal(sweeps,0);assert.equal(hints(f).length,1);
  age(f);await f.b(event);assert.equal(sweeps,event==='Stop'?1:0);
});
test('hook budget starts before own work: below 20 seconds skips; 15 seconds propagates and stops worker',async t=>{
  const f=await setup(t);await failCapture(f);age(f);let elapsed=0,sweeps=0;
  t.mock.method(performance,'now',()=>elapsed);
  globalThis[runKey]=async(host,selection,options)=>{
    if(!options?.sweep){elapsed=135001;return {status:'ready'};}
    sweeps++;assert.fail('swept below the budget floor');
  };
  await f.b();assert.equal(sweeps,0);
  elapsed=0;
  globalThis[runKey]=async(host,selection,options)=>{
    if(!options?.sweep)return {status:'ready'};
    sweeps++;assert.equal(options.deadlineMs,15000);return host.run(selection,options);
  };
  globalThis[captureKey]=async()=>{elapsed+=15001;throw new LocalCaptureTransportError(false,'synthetic deadline');};
  assert.equal((await f.b()).status,'ready');assert.equal(sweeps,1);assert.ok(f.a().pending);
  const operation=workerOperation({deadlineMs:15000});elapsed+=15001;assert.throws(()=>operation.check(),{reason:'work_limit'});operation.close();
});
test('oldest selection, 64 hint cap, expiry, and at most one candidate',async t=>{
  const f=await setup(t);await failCapture(f);
  await f.identity(async identity=>{
    for(let n=0;n<65;n++)await refreshResumeHint({...identity,sessionKey:n.toString(16).padStart(64,'0')},
      {sessionId:'synthetic-'+n,sourcePath:f.sourcePath},{pending:{state:'prepared'}},false,f.config);
    assert.equal(hints(f).length,64);
    const names=hints(f);assert.ok(!names.includes('0'.repeat(64)+'.json'));
    for(const name of names){const hint=read(join(f.resume,name));hint.updatedAt=Date.now()-7*24*60*60*1000-1;write(join(f.resume,name),hint);}
    assert.equal(await chooseResumeHint({},identity,{check(){}}),null);assert.equal(hints(f).length,0);
  });
});
for(const progress of [false,true])test(`sweep failure preserves the own ${progress?'progress':'ready'} outcome and emits no stdout`,async t=>{
  const f=await setup(t);await failCapture(f);age(f);if(progress)f.append('Synthetic own saved reply',{path:f.bPath,nativeSessionId:'synthetic-second-session'});let output='';
  t.mock.method(process.stdout,'write',chunk=>{output+=chunk;return true;});
  globalThis[runKey]=async(host,selection,options)=>{if(options?.sweep)throw Error('synthetic sweep failure');return host.run(selection,options);};
  const result=await f.b();t.mock.restoreAll();assert.deepEqual(result,{version:'local-raw-hook-v1',status:progress?'progress':'ready',reason:null});assert.equal(output,'');
});

test('the oldest of two eligible sessions is the only one swept',async t=>{
  const f=await setup(t);await failCapture(f);age(f,700000);
  const cId='synthetic-third-session',cPath=join(f.request.sourceRoot,'third.jsonl');
  fs.writeFileSync(cPath,fs.readFileSync(f.sourcePath,'utf8').replaceAll(sessionId,cId),{mode:0o600});
  const c=event=>f.scoped(()=>runLocalRawHook({installationDirectory:f.request.installationDirectory,event,
    payload:{hook_event_name:event,session_id:cId,transcript_path:cPath}}));
  await c('SessionStart');f.append('Synthetic third final reply',{path:cPath,nativeSessionId:cId});
  globalThis[captureKey]=async()=>{throw new LocalCaptureTransportError(false,'synthetic');};
  await c('Stop');delete globalThis[captureKey];
  assert.equal(hints(f).length,2);
  const aKey=f.a().sessionKey;
  for(const name of hints(f))if(name!==aKey+'.json'){const path=join(f.resume,name),hint=read(path);hint.updatedAt=Date.now()-600001;write(path,hint);}
  const count=observeSweep(t,(host,selection,options)=>{assert.equal(selection.sessionId,sessionId);return host.run(selection,options);});
  await f.b();assert.equal(count(),1);assert.equal(f.a().pending,null);assert.equal(hints(f).length,1);
});

test('own Stop wins the lock after a later Stop selects its hint',{timeout:20000},async t=>{
  const f=await setup(t);await failCapture(f);age(f);const event=f.a().pending.projection.eventId;
  let selected,continueSweep,dispatched,completeOwn;
  const selectionReady=new Promise(resolve=>{selected=resolve}),sweepGate=new Promise(resolve=>{continueSweep=resolve});
  const ownReady=new Promise(resolve=>{dispatched=resolve}),ownGate=new Promise(resolve=>{completeOwn=resolve});
  let sweptResult,sends=0,removed=0;
  globalThis[runKey]=async(host,selection,options)=>{
    if(!options?.sweep)return host.run(selection,options);
    selected();await sweepGate;sweptResult=await host.run(selection,options);return sweptResult;
  };
  globalThis[captureKey]=async(transport,...args)=>{sends++;dispatched();await ownGate;return transport.capture(...args);};
  const hintPath=join(f.resume,f.a().sessionKey+'.json'),unlink=fsp.unlink;
  t.mock.method(fsp,'unlink',async function(path,...args){if(path===hintPath)removed++;return unlink.call(this,path,...args);});syncBuiltinESMExports();
  const sweeping=f.b();await selectionReady;const own=f.hook('Stop');await ownReady;
  try {
    continueSweep();assert.equal((await sweeping).status,'ready');assert.equal(sweptResult.status,'busy');assert.equal(sends,1);
  } finally {continueSweep();completeOwn();}
  assert.equal((await own).status,'progress');assert.equal(hints(f).length,0);assert.equal(removed,1);
  assert.deepEqual(rows(f),{events:[event],parts:1});
  t.mock.restoreAll();syncBuiltinESMExports();
});

for (const phase of ['selection','source proof']) test(`preparation deadline stops slow ${phase} at the real hook budget`,async t=>{
  const f=await setup(t);await failCapture(f);age(f);
  if(phase==='selection')fs.copyFileSync(join(f.resume,hints(f)[0]),join(f.resume,'f'.repeat(64)+'.json'));
  const before=hints(f);
  let elapsed=0,crossed=false,crossIndex=0,sweeps=0,hintReads=0,lateHintReads=0;
  t.mock.method(performance,'now',()=>elapsed);
  globalThis[runKey]=async(host,selection,options)=>{
    if(options?.sweep){sweeps++;return {status:'ready'};}
    elapsed=134000;return {status:'ready'};
  };
  const accesses=sourceSpy(t,f.request.sourceRoot);
  const cross=()=>{elapsed+=2000;crossed=true;crossIndex=accesses.length;};
  const open=fsp.open;
  t.mock.method(fsp,'open',async function(path,...args){
    const handle=await open.call(this,path,...args);
    if(String(path).startsWith(f.resume+'/')){
      const readFile=handle.readFile;
      t.mock.method(handle,'readFile',async function(...values){
        if(crossed)lateHintReads++;
        const result=await readFile.apply(this,values);hintReads++;
        if(phase==='selection'&&!crossed)cross();
        return result;
      });
    }
    return handle;
  });
  for(const method of ['lstat','realpath']){
    const original=fsp[method];
    t.mock.method(fsp,method,async function(path,...args){
      const inside=path===f.request.sourceRoot||String(path).startsWith(f.request.sourceRoot+'/');
      if(crossed&&inside)elapsed+=9000;
      const result=await original.call(this,path,...args);
      if(phase==='source proof'&&elapsed===134000&&method==='lstat'&&path===f.request.sourceRoot)cross();
      return result;
    });
  }
  syncBuiltinESMExports();
  try {
    assert.deepEqual(await f.b(),{version:'local-raw-hook-v1',status:'ready',reason:null});
    assert.equal(crossed,true,'the synthetic helper crossed 135 seconds');
    assert.deepEqual(accesses.slice(crossIndex),[],'no source metadata or bytes after crossing');
    assert.equal(lateHintReads,0,'no next hint read after crossing');
    assert.ok(elapsed<155000+9000,`returned at ${elapsed} ms`);
    assert.equal(sweeps,0,'no swept host.run after crossing');
    assert.deepEqual(hints(f),before,'deadline preserves unproven hints');
    if(phase==='selection')assert.equal(hintReads,1);
  } finally {t.mock.restoreAll();syncBuiltinESMExports();}
});

test('disable race: an in-flight worker cannot publish after revoke and clear',async t=>{
  const f=await setup(t);f.append('Synthetic deferred response');
  let entered,release;
  const ready=new Promise(resolve=>{entered=resolve}),gate=new Promise(resolve=>{release=resolve});
  globalThis[captureKey]=async()=>{entered();await gate;throw new LocalCaptureTransportError(false,'synthetic');};
  const worker=f.hook('Stop');await ready;
  try {assert.equal((await f.invoke('disable')).status,'disabled');assert.equal(hints(f).length,0);}
  finally {release();}
  await worker;delete globalThis[captureKey];assert.equal(hints(f).length,0);
  assert.equal((await f.invoke('activate')).status,'active');
  assert.equal(await selectLocalResume(f.profile.profilePath),null);assert.equal(hints(f).length,0);
});

test('disable race: clear waits for a publisher holding the resume lock',async t=>{
  const f=await setup(t);
  let entered,release,disabling=false,paused=false,contended=false;
  const ready=new Promise(resolve=>{entered=resolve}),gate=new Promise(resolve=>{release=resolve});
  const open=fsp.open,link=fsp.link,readdir=fsp.readdir;
  t.mock.method(fsp,'open',async function(path,flags,...args){
    if(!paused&&flags==='wx'&&String(path).startsWith(f.resume+'/')){paused=true;entered();await gate;}
    return open.call(this,path,flags,...args);
  });
  t.mock.method(fsp,'link',async function(from,to,...args){
    try {return await link.call(this,from,to,...args);}
    catch(error){if(disabling&&to===join(f.profile.stateRoot,'.resume.lock')){contended=true;release();}throw error;}
  });
  t.mock.method(fsp,'readdir',async function(path,...args){
    const names=await readdir.call(this,path,...args);
    // Without the clear lock this lists before publication; release only AFTER
    // taking that snapshot, so the mutation deterministically leaves a hint.
    if(disabling&&path===f.resume)release();
    return names;
  });
  syncBuiltinESMExports();
  try {
    const publish=f.identity(identity=>stateLock(identity.lockPath,()=>refreshResumeHint(identity,
      {sessionId,sourcePath:f.sourcePath},f.a(),true,f.config)));
    await ready;disabling=true;
    const disabled=await f.invoke('disable');await publish;
    assert.equal(disabled.status,'disabled');assert.equal(hints(f).length,0);assert.equal(contended,true);
    assert.equal((await f.invoke('activate')).status,'active');assert.equal(await selectLocalResume(f.profile.profilePath),null);
  } finally {release();t.mock.restoreAll();syncBuiltinESMExports();}
});

test('disable race: publish before disable is removed by the clear',async t=>{
  const f=await setup(t);await failCapture(f);assert.equal(hints(f).length,1);
  assert.equal((await f.invoke('disable')).status,'disabled');assert.equal(hints(f).length,0);
});

for(const mode of ['explicit','lazy'])test(`${mode} rearm drops only its own session hint`,async t=>{
  if(mode==='lazy'){
    const f=await setup(t);await f.invoke('disable');await f.invoke('activate');
    const own=f.a().sessionKey+'.json',other=fs.readdirSync(f.directory).find(name=>/^[a-f0-9]{64}\.json$/.test(name)&&name!==own);
    fs.mkdirSync(f.resume,{recursive:true,mode:0o700});write(join(f.resume,own),{});write(join(f.resume,other),{});
    assert.equal((await f.hook('SessionStart')).status,'ready');
    assert.equal(fs.existsSync(join(f.resume,own)),false);assert.equal(fs.existsSync(join(f.resume,other)),true);
  }else{
    const f=await hostFixture(t);assert.equal((await f.call('prepare')).status,'ready');assert.equal((await f.call('initialize')).status,'ready');
    const cursor=read(join(f.stateRoot,'sessions',fs.readdirSync(join(f.stateRoot,'sessions')).find(name=>/^[a-f0-9]{64}\.json$/.test(name))));
    const resume=join(f.stateRoot,'resume'),own=cursor.sessionKey+'.json',other='0'.repeat(64)+'.json';
    fs.mkdirSync(resume,{mode:0o700});write(join(resume,own),{});write(join(resume,other),{});
    f.disable();const control=ok(f.core.getLocalCaptureControl({namespace:f.namespace,client:f.client}));
    ok(f.core.setLocalCaptureControl({namespace:f.namespace,client:f.client,targetId:control.targetId,expectedStoreId:control.storeId,
      expectedRevision:control.revision,automaticCaptureEnabled:true,rawNoticeVersion:control.rawNoticeVersion}));
    const result=await f.call('rearm',{...f.selection,expectedRevision:0,actionId:randomUUID()});
    assert.equal(result.status,'ready',JSON.stringify(result));
    assert.equal(fs.existsSync(join(resume,own)),false);assert.equal(fs.existsSync(join(resume,other)),true);
  }
});

test('conversation deletion drops its hint with zero transcript access',async t=>{
  const f=await setup(t);f.append('Synthetic captured response');assert.equal((await f.hook('Stop')).status,'progress');
  await failCapture(f);age(f);
  const conversation=ok(f.core.listRawConversations({namespace:f.request.namespace,client:'claude-code'})).conversations[0];
  assert.ok(conversation);ok(f.core.deleteConversation({namespace:f.request.namespace,conversationId:conversation.id,
    expectedRevision:conversation.revision,actionId:randomUUID()}));
  const accesses=sourceSpy(t,f.request.sourceRoot);
  try {assert.equal(await selectLocalResume(f.profile.profilePath),null);assert.deepEqual(accesses,[]);assert.equal(hints(f).length,0);}
  finally {t.mock.restoreAll();syncBuiltinESMExports();}
});

test('selection reports its deadline as a typed outcome before reading the profile',async()=>{
  assert.deepEqual(await selectLocalResume('/synthetic-unused-profile',{check:()=>false}),{status:'deadline'});
});
