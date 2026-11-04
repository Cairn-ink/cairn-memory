import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdir, readFile, chmod, stat, copyFile, utimes, unlink, readdir, symlink } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { privateWrite, withWriteObserver } from '../../client/private-state.mjs';
import { hostedTargetId } from '../../client/transport-hosted.mjs';
import { createRuntimeGuard } from '../../client/runtime-usage.mjs';
import { setPaused } from '../../client/control-state.mjs';
import { captureStopNotice, readLastCapture, recordLastCapture, recordQualificationAttempt, writeCredential } from '../installed-state.mjs';
import { runInstalled, currentHost } from '../installed.mjs';
import { binaryIdentity, qualifyBinary, finishQualification } from '../qualification.mjs';
import { runWorker } from '../worker.mjs';
import { fixture as workerFixture, header, item } from './helpers.mjs';
import { formatFixture } from './format-fixtures.mjs';

const time = new Date(2026,10,4,17,42).getTime();
const input = {hook_event_name:'SessionStart',session_id:'synthetic',cwd:'/synthetic',transcript_path:null};
const claimName = 'capture-stop-notice-2026-11-04.claim';
const changed = {status:'changed',version:'0.999.0'};
async function fixture(t) {
  const ws = createTestWorkspace(t,{prefix:'cx-notice-'});
  const home = join(ws.path,'home'), root = join(ws.path,'root'), directory = join(home,'cairn');
  await mkdir(directory,{recursive:true,mode:0o700}); await mkdir(root,{mode:0o700});
  const path = join(directory,'installation.json');
  const config = {version:1,enabled:true,hostVersion:'0.166.0',codex:join(ws.path,'codex'),
    node:process.execPath,home,root,pairingRecord:null,usesClaude:false,endpoint:'https://example.invalid',
    runtime:ws.path,dailyCap:200,captureExec:false};
  await privateWrite(path,JSON.stringify(config));
  const notice = (qualification=changed, extras={}, options={}) => captureStopNotice(path,config,
    {...input,...extras},qualification,{now:()=>time,env:{LANG:'en_US.UTF-8'},...options});
  return {ws,home,root,directory,path,config,notice};
}

for (const status of ['changed','unavailable']) test(`R1 ${status} prints only a fixed one-line systemMessage`,async t=>{
  const f=await fixture(t), output=await f.notice({status,version:'0.999.0',reason:'SERVER_TOKEN_CANARY'});
  assert.deepEqual(JSON.parse(output),{systemMessage:'Cairn automatic memory is paused: Codex 0.999.0 is not supported yet. Check: npx @cairn-ink/memory status --client codex'});
  assert.ok(!output.includes('CANARY'));assert.ok(!output.includes(f.ws.path));assert.ok(!output.includes('\n'));
  assert.equal((await stat(join(f.directory,claimName))).mode&0o777,0o600);
});
for (const reason of ['missing','unreadable','malformed']) test(`R2 ${reason} credential is decided locally`,async t=>{
  const f=await fixture(t);
  if(reason!=='missing') await writeCredential(f.path,f.config.endpoint,'TOKEN_CANARY');
  if(reason==='unreadable') await chmod(join(f.directory,'credential.json'),0o644);
  if(reason==='malformed') await privateWrite(join(f.directory,'credential.json'),'{}');
  const output=await f.notice({status:'qualified'});
  assert.deepEqual(JSON.parse(output),{systemMessage:'Cairn automatic memory is off: not signed in. Fix: npx @cairn-ink/memory setup'});
});
test('all reasons share one receipt per local day, reset at local midnight and isolate installations',async t=>{
  const f=await fixture(t), g=await fixture(t);
  assert.ok(await f.notice());
  assert.equal(await f.notice({status:'qualified'}),'');
  assert.equal(await f.notice({status:'unavailable'}),'');
  assert.ok(await g.notice());
  const next = new Date(2026,10,5,0,0).getTime();
  assert.ok(await f.notice({status:'qualified'},{},{now:()=>next}));
  assert.equal(await f.notice(changed,{}, {now:()=>next}),'');
});
function deferred() { let resolve; const promise = new Promise(r=>resolve=r); return {promise,resolve}; }
function intercept(t, name, replacement) {
  const original=fs[name];fs[name]=replacement(original);syncBuiltinESMExports();
  t.after(()=>{fs[name]=original;syncBuiltinESMExports();});
}
test('two SessionStarts rendezvous before exclusive creates and exactly one claims',async t=>{
  const f=await fixture(t), gate=deferred();let arrivals=0;
  intercept(t,'open',original=>async(path,...args)=>{
    if(path===join(f.directory,claimName) && args[0]==='wx') {
      if(++arrivals===2) gate.resolve();
      await gate.promise;
    }
    return original(path,...args);
  });
  const outputs=await Promise.all([f.notice(),f.notice()]);
  assert.equal(arrivals,2);assert.equal(outputs.filter(Boolean).length,1);
});
test('a paused claim holder cannot duplicate a successor notice after a clock advance',async t=>{
  const f=await fixture(t), reached=deferred(), resume=deferred();let first=true;
  intercept(t,'open',original=>async(path,...args)=>{
    const handle=await original(path,...args);
    if(path===join(f.directory,claimName) && first) {
      first=false;reached.resolve();await resume.promise;
    }
    return handle;
  });
  const a=f.notice();await reached.promise;
  const b=await f.notice(changed,{}, {now:()=>time+60001});
  resume.resolve();assert.equal([await a,b].filter(Boolean).length,1);
});
test('midnight interleaving preserves the newer day claim while an older pruner resumes',async t=>{
  const f=await fixture(t), reached=deferred(), resume=deferred();let first=true;
  const before=new Date(2026,10,4,23,59,59,950).getTime();
  const after=new Date(2026,10,5,0,0,0,50).getTime();
  const newer=join(f.directory,'capture-stop-notice-2026-11-05.claim');
  // Pruning now precedes claiming, so pause A at its pre-claim pruning step.
  intercept(t,'readdir',original=>async(path,...args)=>{
    if(path===f.directory && first) {first=false;reached.resolve();await resume.promise;}
    return original(path,...args);
  });
  const a=f.notice(changed,{}, {now:()=>before});await reached.promise;
  let b;
  try { b=await f.notice(changed,{}, {now:()=>after});assert.ok(b); }
  finally { resume.resolve(); }
  assert.ok(await a);
  const winner=await fs.lstat(newer);
  const c=await f.notice(changed,{}, {now:()=>after+100});
  assert.equal([b,c].filter(Boolean).length,1);assert.equal(c,'');
  assert.equal((await fs.lstat(newer)).ino,winner.ino);
});
test('date revisits retain seven prior days; a larger reversal may notify again',async t=>{
  const f=await fixture(t);
  const at=day=>new Date(2026,10,day,12).getTime();
  assert.ok(await f.notice());
  assert.ok(await f.notice(changed,{}, {now:()=>at(5)}));
  assert.equal(await f.notice(),'');
  assert.ok(await f.notice(changed,{}, {now:()=>at(11)}));
  assert.equal(await f.notice(),'','exactly seven days back remains claimed');
  assert.ok(await f.notice(changed,{}, {now:()=>at(12)}));
  await assert.rejects(readFile(join(f.directory,claimName)),{code:'ENOENT'});
  assert.ok(await f.notice(),'eight days back may notify after its claim was pruned');
});
for (const scenario of ['healthy','local-pause','hosted-pause','disabled','subagent-id','subagent-type','cap','cancelled'])
  test(`quiet when ${scenario}`,async t=>{
    const f=await fixture(t); let qualification=changed, extras={}, options={};
    if(scenario==='healthy') {await writeCredential(f.path,f.config.endpoint,'synthetic');qualification={status:'qualified'};}
    if(scenario==='local-pause') await setPaused(f.root,true);
    if(scenario==='hosted-pause') await privateWrite(join(f.root,'hosted-pause',hostedTargetId(f.config)+'.json'),JSON.stringify({paused:true,generation:1,enforced:true}));
    if(scenario==='disabled') f.config.enabled=false;
    if(scenario==='subagent-id') extras.agent_id='agent';
    if(scenario==='subagent-type') extras.agent_type='agent';
    if(scenario==='cancelled') options.signal=AbortSignal.abort();
    if(scenario==='cap') {
      const guard=createRuntimeGuard({root:f.root,targetId:hostedTargetId(f.config),mode:'hosted',dailyCap:1,now:()=>time});
      assert.equal((await guard.reserve()).ok,true);
    }
    assert.equal(await f.notice(qualification,extras,options),'');
    await assert.rejects(readFile(join(f.directory,claimName)),{code:'ENOENT'});
  });
for (const scenario of ['foreign-file','symlink','directory','unwritable-directory'])
  test(`existing claim ${scenario} suppresses notice without touching entry`,async t=>{
    const f=await fixture(t), path=join(f.directory,claimName), target=join(f.ws.path,'target');
    if(scenario==='symlink') {await privateWrite(target,'canary');await symlink(target,path);}
    if(scenario==='directory') await mkdir(path,{mode:0o700});
    if(scenario==='foreign-file') {await privateWrite(path,'foreign canary');await chmod(path,0o644);}
    if(scenario==='unwritable-directory') await chmod(f.directory,0o500);
    const before=await fs.lstat(scenario==='unwritable-directory'?f.directory:path);
    assert.equal(await f.notice(),'');
    const after=await fs.lstat(scenario==='unwritable-directory'?f.directory:path);
    assert.equal(after.ino,before.ino);assert.equal(after.mode,before.mode);
    if(scenario==='foreign-file') assert.equal(await readFile(path,'utf8'),'foreign canary');
    if(scenario==='symlink') assert.equal(await readFile(target,'utf8'),'canary');
    if(scenario==='unwritable-directory') await chmod(f.directory,0o700);
  });
test('claim pruning touches only strict matching names and at most 32 entries',async t=>{
  const f=await fixture(t), matches=Array.from({length:40},(_,i)=>`capture-stop-notice-2025-01-${String(i).padStart(2,'0')}.claim`);
  const keep=['capture-stop-notice-2025-1-01.claim','capture-stop-notice-2025-01-01.claim.extra','other.claim','capture-stop-notice.json.lock.owner-old'];
  for(const name of [...matches,...keep]) await privateWrite(join(f.directory,name),'canary');
  assert.ok(await f.notice());
  const names=await readdir(f.directory);
  assert.equal(matches.filter(name=>names.includes(name)).length,8);
  for(const name of keep) assert.equal(await readFile(join(f.directory,name),'utf8'),'canary');
});
for(const operation of ['readdir','unlink'])
  test(`claim pruning ignores ${operation} errors and bounds unlink attempts`,async t=>{
    const f=await fixture(t);let attempts=0;
    for(let day=1;day<=40;day++)
      await privateWrite(join(f.directory,`capture-stop-notice-2025-01-${String(day).padStart(2,'0')}.claim`),'canary');
    intercept(t,operation,original=>async(path,...args)=>{
      if(operation==='readdir' ? path===f.directory : path.startsWith(join(f.directory,'capture-stop-notice-'))) {
        attempts++;throw Object.assign(new Error('injected pruning error'),{code:'EACCES'});
      }
      return original(path,...args);
    });
    assert.ok(await f.notice());assert.equal(attempts,operation==='unlink'?32:1);
  });
test('pruning on an already-claimed day preserves its seven-day window and future dates',async t=>{
  const f=await fixture(t), stale='capture-stop-notice-2026-10-27.claim';
  const keep=['capture-stop-notice-2026-10-28.claim','capture-stop-notice-2026-11-03.claim',
    claimName,'capture-stop-notice-2026-11-05.claim','capture-stop-notice-2027-01-01.claim',
    'capture-stop-notice-2026-1-01.claim','capture-stop-notice-2026-10-27.claim.extra','other.claim'];
  for(const name of [stale,...keep]) await privateWrite(join(f.directory,name),'canary');
  assert.equal(await f.notice(),'');
  await assert.rejects(readFile(join(f.directory,stale)),{code:'ENOENT'});
  for(const name of keep) assert.equal(await readFile(join(f.directory,name),'utf8'),'canary');
  assert.ok(await f.notice(changed,{}, {now:()=>new Date(2027,0,9,12).getTime()}));
  await assert.rejects(readFile(join(f.directory,'capture-stop-notice-2027-01-01.claim')),{code:'ENOENT'});
});
test('many simulated local days keep exactly the last eight local dates',async t=>{
  const f=await fixture(t);
  for(let day=0;day<70;day++) {
    const at=new Date(2026,10,4+day,12).getTime();
    assert.ok(await f.notice(changed,{}, {now:()=>at}));
    assert.equal(await f.notice(changed,{}, {now:()=>at}),'');
    const claims=(await readdir(f.directory)).filter(name=>/^capture-stop-notice-\d{4}-\d{2}-\d{2}\.claim$/u.test(name));
    assert.equal(claims.length,Math.min(day+1,8));
  }
});
for(const [env,zh] of [[{LANG:'zh_TW.UTF-8'},true],[{LC_MESSAGES:'zh_TW',LANG:'en'},true],
  [{LC_ALL:'en_US',LC_MESSAGES:'zh_TW',LANG:'zh'},false],[{LC_ALL:'',LC_MESSAGES:'',LANG:'zh'},true],
  [{LC_ALL:'ZH_TW',LANG:'zh'},false],[{},false]])
  test(`locale precedence ${JSON.stringify(env)}`,async t=>{
    const f=await fixture(t);
    assert.equal(JSON.parse(await f.notice(changed,{}, {env})).systemMessage.includes('自動記憶'),zh);
  });

// These exact output objects use only the schema's root object and string leaf.
// Validate all applicable constraints; reject extra keys and the wrong leaf type.
function validateNotice(schema,value) {
  assert.equal(schema.type,'object');assert.equal(schema.additionalProperties,false);
  assert.ok(value && typeof value==='object' && !Array.isArray(value));
  for(const key of schema.required??[]) assert.ok(Object.hasOwn(value,key));
  for(const [key,leaf] of Object.entries(value)) {
    assert.ok(Object.hasOwn(schema.properties,key));
    assert.equal(schema.properties[key].type,typeof leaf);
  }
}
for(const version of ['0.163.0','0.164.0','0.165.0','0.166.0']) test(`SessionStart output conforms to recorded ${version} schema`,async t=>{
  const format=JSON.parse(await readFile(new URL(`./fixtures/binary-${version}/format.json`,import.meta.url)));
  const schema=format.hooks['session-start.command.output'];
  assert.equal(schema.properties.systemMessage.type,'string');
  for(const verdict of [changed,{status:'unavailable'},{status:'qualified'}]) {
    const f=await fixture(t),value=JSON.parse(await f.notice(verdict));
    assert.deepEqual(Object.keys(value),['systemMessage']); validateNotice(schema,value);
  }
  assert.throws(()=>validateNotice(schema,{systemMessage:3}));
  assert.throws(()=>validateNotice(schema,{systemMessage:'fixed',extra:true}));
});
async function pendingFixture(t) {
  t.mock.method(Date,'now',()=>time);
  const f=await fixture(t);
  await copyFile(process.execPath,f.config.codex);await chmod(f.config.codex,0o700);
  const host={identity:await binaryIdentity(f.config.codex),binaryPath:f.config.codex,kind:'cli'};
  const marker=join(f.directory,'qualification',host.identity+'.pending');
  let launches=0;
  const observe=()=>currentHost(f.path,{detect:async()=>host,launch:async()=>{launches++;},now:()=>time});
  return {...f,host,marker,observe,launches:()=>launches};
}
test('genuinely first pending attempt stays quiet, including active later SessionStarts',async t=>{
  const f=await pendingFixture(t);
  assert.equal(await f.notice(await f.observe()),'');assert.equal(f.launches(),1);
  await utimes(f.marker,new Date(time),new Date(time));
  assert.equal(await f.notice(await f.observe()),'');
  assert.equal(await f.notice(await f.observe()),'');
});
test('earlier non-SessionStart probe finishes without verdict; active retry cannot hide it',async t=>{
  const f=await pendingFixture(t);
  await f.observe(); // A Stop/UserPromptSubmit launched the first probe.
  // Exercise the actual qualify branch with a bound binary whose probe fails.
  // The Node executable is not Codex and cannot return its format evidence.
  const stream=new PassThrough();stream.end(JSON.stringify(f.host));
  assert.equal(await runInstalled(f.path,'qualify',stream,{
    signal:new AbortController().signal,noticeOptions:{now:()=>time}}),'');
  const attempt=JSON.parse(await readFile(join(f.directory,'codex-qualification-attempt.json'),'utf8'));
  assert.deepEqual(attempt,{version:1,identity:f.host.identity,finishedAt:time});
  assert.equal((await stat(join(f.directory,'codex-qualification-attempt.json'))).mode&0o777,0o600);
  const first=await f.notice(await f.observe());
  await utimes(f.marker,new Date(time),new Date(time));
  const second=await f.notice(await f.observe());
  assert.equal([first,second].filter(Boolean).length,1);assert.ok(first);
});
for(const age of [599999,600000,600001]) test(`pending marker age ${age}ms without finished history`,async t=>{
  const f=await pendingFixture(t);await f.observe();
  await utimes(f.marker,new Date(time-age),new Date(time-age));
  assert.equal(Boolean(await f.notice(await f.observe())),age>=600000);
});
for(const scenario of ['mode','symlink','foreign-owner','directory','malformed-marker','malformed-attempt','unsafe-attempt','symlink-attempt'])
  test(`pending ${scenario} read suppresses even finished history`,async t=>{
    const f=await pendingFixture(t);await f.observe();
    await recordQualificationAttempt(f.path,f.host,{now:()=>time});
    const attempt=join(f.directory,'codex-qualification-attempt.json');
    if(scenario==='mode') await chmod(f.marker,0o644);
    if(scenario==='symlink') {await unlink(f.marker);await symlink(attempt,f.marker);}
    if(scenario==='directory') {await unlink(f.marker);await mkdir(f.marker,{mode:0o700});}
    if(scenario==='foreign-owner') intercept(t,'lstat',original=>async(path,...args)=>{
      const info=await original(path,...args);
      if(path===f.marker) info.uid=process.getuid()+1;
      return info;
    });
    if(scenario==='malformed-marker') await privateWrite(f.marker,'not empty');
    if(scenario==='malformed-attempt') await privateWrite(attempt,'{');
    if(scenario==='unsafe-attempt') await chmod(attempt,0o644);
    if(scenario==='symlink-attempt') {await unlink(attempt);await symlink(f.marker,attempt);}
    // Unsafe history must suppress even when marker age independently qualifies.
    if(scenario.endsWith('attempt')) await utimes(f.marker,new Date(time-600001),new Date(time-600001));
    assert.equal(await f.notice(await f.observe()),'');
  });
test('finished attempt for another identity does not end first-run grace',async t=>{
  const f=await pendingFixture(t);await f.observe();
  await recordQualificationAttempt(f.path,{identity:'b'.repeat(64)},{now:()=>time});
  assert.equal(await f.notice(await f.observe()),'');
});
test('attempt write failure stays silent and does not change qualification cache',async t=>{
  const f=await pendingFixture(t);await f.observe();
  await mkdir(join(f.directory,'codex-qualification-attempt.json'),{mode:0o700});
  await finishQualification(f.path,f.host);await recordQualificationAttempt(f.path,f.host,{now:()=>time});
  assert.equal((await f.observe()).status,'pending');assert.equal(await f.notice(await f.observe()),'');
});
test('runInstalled routes unqualified SessionStart and credential rejection into notice, other hooks stay silent',async t=>{
  const f=await fixture(t);
  await copyFile(process.execPath,f.config.codex);await chmod(f.config.codex,0o700);
  const host={identity:await binaryIdentity(f.config.codex),binaryPath:f.config.codex,kind:'cli'};
  const evidence=structuredClone(await formatFixture('0.166.0'));
  evidence.hooks['session-start.command.output'].properties.systemMessage.type='array';
  await qualifyBinary(f.path,host,{collect:async()=>({version:'0.999.0',evidence,binarySha256:'a'.repeat(64)})});
  const invoke=(event,extras={})=>{
    const stream=new PassThrough();stream.end(JSON.stringify({...input,hook_event_name:event,...extras}));
    return runInstalled(f.path,event,stream,{signal:new AbortController().signal,detectHost:async()=>host,
      noticeOptions:{now:()=>time,env:{LANG:'en'}}});
  };
  assert.equal(await invoke('SessionStart',{agent_id:'child'}),'');
  assert.equal(await invoke('Stop'),'');
  assert.ok(JSON.parse(await invoke('SessionStart')).systemMessage.includes('not supported yet'));
  await unlink(join(f.directory,claimName));
  // Replace the changed cache with the current-policy qualified verdict.
  const qualified=await qualifyBinary(f.path,host,{cache:false,collect:async()=>({version:'0.166.0',evidence:await formatFixture('0.166.0'),binarySha256:'a'.repeat(64)})});
  await privateWrite(join(f.directory,'qualification',host.identity+'.json'),JSON.stringify(qualified));
  assert.ok(JSON.parse(await invoke('SessionStart')).systemMessage.includes('not signed in'));
});

for(const status of ['complete','duplicate','empty','processing','invalid','refused','throws'])
  test(`last capture records only acknowledged submitted units: ${status}`,async t=>{
    const f=await workerFixture(t,{text:header()+item('capture text')});
    const transport={terminated:()=>true,capture:async body=>{
      if(status==='throws') throw Error('synthetic');
      if(status==='invalid') return {status:'complete',eventId:'mismatched'};
      if(status==='refused') return {status:'refused',code:'quota_reached'};
      return {status,eventId:body.event_id};
    }};
    await runWorker(f.binding,{guard:f.guard,transport,mode:'hosted',now:()=>time});
    const value=await readLastCapture(f.root), cursor=await f.cursor();
    if(['complete','duplicate','empty'].includes(status)) {
      assert.ok(cursor.submittedUnits>0);
      assert.deepEqual(value,{version:1,at:time,count:cursor.submittedUnits});
      assert.equal((await stat(join(f.root,'codex-last-capture.json'))).mode&0o777,0o600);
    } else {assert.equal(value,null);assert.equal(cursor.submittedUnits,0);}
  });
test('failed last-capture publication leaves worker accounting and result unchanged',async t=>{
  const f=await workerFixture(t,{text:header()+item('capture text')});
  await mkdir(join(f.root,'codex-last-capture.json'),{mode:0o700});
  const result=await runWorker(f.binding,{guard:f.guard,transport:f.transport,mode:'hosted',now:()=>time});
  assert.equal(result.status,'idle');assert.ok(result.state.submittedUnits>0);assert.equal(await readLastCapture(f.root),null);
});
test('excluded records and non-hosted stubs never create a success record',async t=>{
  const f=await workerFixture(t,{text:header()});
  await runWorker(f.binding,{guard:f.guard,transport:f.transport,mode:'hosted',now:()=>time});
  assert.equal(await readLastCapture(f.root),null);
  const g=await workerFixture(t,{text:header()+item('capture text')});
  await runWorker(g.binding,{guard:g.guard,transport:g.transport,mode:'hosted-stub',now:()=>time});
  assert.equal(await readLastCapture(g.root),null);
});
test('healthy notice never reads or writes diagnostic state',async t=>{
  const f=await fixture(t);await writeCredential(f.path,f.config.endpoint,'synthetic');
  const writes=[];
  assert.equal(await withWriteObserver(event=>writes.push(event),()=>f.notice({status:'qualified'})),'');
  assert.deepEqual(writes,[]);
});

test('not-signed-in template also follows the Traditional Chinese locale rule',async t=>{
  const f=await fixture(t);
  assert.deepEqual(JSON.parse(await f.notice({status:'qualified'},{},{env:{LC_ALL:'zh_TW.UTF-8'}})),
    {systemMessage:'Cairn 自動記憶沒有在記：還沒登入。修正：npx @cairn-ink/memory setup'});
});
test('a transient pending host that qualifies never gets a notice',async t=>{
  const f=await fixture(t), host={identity:'a'.repeat(64)};
  assert.equal(await f.notice({status:'pending',host,pendingNotice:false}),'');
  await writeCredential(f.path,f.config.endpoint,'synthetic');
  assert.equal(await f.notice({status:'qualified'}),'');
  await assert.rejects(readFile(join(f.directory,claimName)),{code:'ENOENT'});
});
test('installed entry emits exactly the SessionStart notice object and still exits zero',async t=>{
  const f=await fixture(t);
  await copyFile(process.execPath,f.config.codex);await chmod(f.config.codex,0o700);
  const host={identity:await binaryIdentity(f.config.codex),binaryPath:f.config.codex,kind:'cli'};
  const evidence=structuredClone(await formatFixture('0.166.0'));
  evidence.hooks['session-start.command.output'].properties.systemMessage.type='array';
  await qualifyBinary(f.path,host,{collect:async()=>({version:'0.999.0',evidence,binarySha256:'a'.repeat(64)})});
  // This owned native-shaped ancestor is the only Codex host involved.
  const entry=fileURLToPath(new URL('../entry.mjs',import.meta.url));
  const code=`import{spawn}from'node:child_process';
    const child=spawn(${JSON.stringify(process.execPath)},['--import',
      ${JSON.stringify('data:text/javascript,Date.now=()=>'+time)},${JSON.stringify(entry)},
      ${JSON.stringify(f.path)},'SessionStart'],{stdio:['pipe','inherit','inherit']});
    child.stdin.end(${JSON.stringify(JSON.stringify(input))});
    child.on('close',code=>{process.exitCode=code;});`;
  const child=spawn(f.config.codex,['--input-type=module','-e',code],{
    env:{HOME:f.home,PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8',TMPDIR:process.env.TMPDIR},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
  const exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  assert.equal(exitCode,0);assert.equal(stderr,'');
  assert.equal(stdout,JSON.stringify({systemMessage:'Cairn automatic memory is paused: Codex 0.999.0 is not supported yet. Check: npx @cairn-ink/memory status --client codex'}));
});

test('newer then older or equal capture publication preserves the newer record',async t=>{
  const f=await fixture(t);
  await recordLastCapture(f.root,time,2);
  await recordLastCapture(f.root,time-1,1);
  await recordLastCapture(f.root,time,3);
  assert.deepEqual(await readLastCapture(f.root),{version:1,at:time,count:2});
});
for(const invalid of ['{','{}',JSON.stringify({version:1,at:-1,count:1})])
  test(`invalid existing capture record is replaced: ${invalid}`,async t=>{
    const f=await fixture(t);await privateWrite(join(f.root,'codex-last-capture.json'),invalid);
    await recordLastCapture(f.root,time,1);
    assert.deepEqual(await readLastCapture(f.root),{version:1,at:time,count:1});
  });
test('symlinked capture diagnostic never changes its target',async t=>{
  const f=await fixture(t), target=join(f.ws.path,'target');await privateWrite(target,'private canary');
  await symlink(target,join(f.root,'codex-last-capture.json'));
  await recordLastCapture(f.root,time,1);
  assert.equal(await readLastCapture(f.root),null);assert.equal(await readFile(target,'utf8'),'private canary');
});
test('simultaneous compare/rename race is diagnostic only; next capture repairs it',async t=>{
  const f=await fixture(t), reached=deferred(), resume=deferred();let first=true;
  intercept(t,'rename',original=>async(from,to)=>{
    if(to===join(f.root,'codex-last-capture.json') && first) {
      first=false;reached.resolve();await resume.promise;
    }
    return original(from,to);
  });
  const a=recordLastCapture(f.root,time,1);await reached.promise;
  await recordLastCapture(f.root,time+1,2);resume.resolve();await a;
  // Accepted read/rename race: diagnostic can briefly show the earlier time.
  assert.equal((await readLastCapture(f.root)).at,time);
  await recordLastCapture(f.root,time+2,3);
  assert.equal((await readLastCapture(f.root)).at,time+2);
});
test('consecutive crash-only days consume each day and retain at most eight claims',async t=>{
  const f=await fixture(t), stateURL=new URL('../installed-state.mjs',import.meta.url).href;
  for(let day=0;day<24;day++) {
    const clock=new Date(2026,10,4+day,12).getTime();
    const code=`import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';
      const original=fs.open;fs.open=async(path,...args)=>{
        const handle=await original(path,...args);if(path.endsWith('.claim'))process.exit(77);return handle;};
      syncBuiltinESMExports();const {captureStopNotice}=await import(${JSON.stringify(stateURL)});
      await captureStopNotice(${JSON.stringify(f.path)},${JSON.stringify(f.config)},${JSON.stringify(input)},
        ${JSON.stringify(changed)},{now:()=>${clock},env:{LANG:'en'}});`;
    const child=spawn(process.execPath,['--input-type=module','-e',code],{
      env:{HOME:f.home,PATH:'/usr/bin:/bin',TMPDIR:process.env.TMPDIR},stdio:'ignore'});
    const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
    assert.equal(exit,77);
    // No fixture deletion or successful next-day claim between crash cycles.
    const names=await readdir(f.directory);
    const claims=names.filter(name=>/^capture-stop-notice-\d{4}-\d{2}-\d{2}\.claim$/u.test(name));
    const expected=Array.from({length:Math.min(day+1,8)},(_,offset)=>{
      const date=new Date(2026,10,4+day-offset,12);
      return `capture-stop-notice-${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}.claim`;
    });
    assert.deepEqual(claims.sort(),expected.sort());assert.ok(claims.length<=8);
    assert.equal(names.filter(name=>name.includes('.owner-') || name.includes('.reap-')).length,0);
    assert.equal(await f.notice(changed,{}, {now:()=>clock}),'');
    assert.deepEqual((await readdir(f.directory)).filter(name=>name.endsWith('.claim')).sort(),expected);
  }
});
