import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, chmod, stat, copyFile, utimes, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { privateWrite, withWriteObserver } from '../../client/private-state.mjs';
import { hostedTargetId } from '../../client/transport-hosted.mjs';
import { createRuntimeGuard } from '../../client/runtime-usage.mjs';
import { setPaused } from '../../client/control-state.mjs';
import { captureStopNotice, readLastCapture, recordLastCapture, writeCredential } from '../installed-state.mjs';
import { runInstalled, currentHost } from '../installed.mjs';
import { binaryIdentity, qualifyBinary, finishQualification } from '../qualification.mjs';
import { runWorker } from '../worker.mjs';
import { fixture as workerFixture, header, item } from './helpers.mjs';
import { formatFixture } from './format-fixtures.mjs';

const time = new Date(2026,10,4,17,42).getTime();
const input = {hook_event_name:'SessionStart',session_id:'synthetic',cwd:'/synthetic',transcript_path:null};
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
  assert.equal((await stat(join(f.directory,'capture-stop-notice.json'))).mode&0o777,0o600);
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
test('concurrent starts cannot print twice',async t=>{
  const f=await fixture(t);
  const outputs=await Promise.all([f.notice(),f.notice(),f.notice(),f.notice()]);
  assert.equal(outputs.filter(Boolean).length,1);
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
    await assert.rejects(readFile(join(f.directory,'capture-stop-notice.json')),{code:'ENOENT'});
  });
for (const scenario of ['unreadable','malformed','unwritable','busy']) test(`quiet when notice state is ${scenario}`,async t=>{
  const f=await fixture(t), path=join(f.directory,'capture-stop-notice.json');
  if(scenario==='unreadable') {await privateWrite(path,'{}');await chmod(path,0o644);}
  if(scenario==='malformed') await privateWrite(path,'{}');
  if(scenario==='unwritable') await mkdir(path,{mode:0o700});
  if(scenario==='busy') {
    await privateWrite(path+'.lock','');
    await utimes(path+'.lock',new Date(time),new Date(time));
  }
  assert.equal(await f.notice(),'');
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
test('pending first observation is quiet; active attempt stays quiet; finished or expired attempt reports',async t=>{
  // Qualification scheduling uses Date.now too; keep both clocks in the same
  // fixed domain so wall-clock time cannot expire the synthetic active marker.
  t.mock.method(Date,'now',()=>time);
  const f=await fixture(t);
  await copyFile(process.execPath,f.config.codex);await chmod(f.config.codex,0o700);
  const host={identity:await binaryIdentity(f.config.codex),binaryPath:f.config.codex,kind:'cli'};
  let launches=0;
  const observe=()=>currentHost(f.path,{detect:async()=>host,launch:async()=>{launches++;},now:()=>time});
  const first=await observe();assert.equal(first.pendingFinished,true);
  assert.equal(await f.notice(first),'');assert.equal(launches,1);
  await utimes(join(f.directory,'qualification',host.identity+'.pending'),new Date(time),new Date(time));
  const second=await observe();assert.equal(second.pendingFinished,false);assert.equal(await f.notice(second),'');
  await finishQualification(f.path,host);
  const finished=await observe();assert.equal(finished.pendingFinished,true);
  assert.ok(await f.notice(finished));assert.equal(launches,2);
  // A newly observed binary also gets its own first-run grace period.
  const g=await fixture(t);
  const pending={status:'pending',host,pendingFinished:false};assert.equal(await g.notice(pending),'');
  await writeFile(join(f.directory,'qualification',host.identity+'.pending'),'');
  const old=new Date(time-120001);
  await utimes(join(f.directory,'qualification',host.identity+'.pending'),old,old);
  const expired=await observe();assert.equal(expired.pendingFinished,true);
  assert.ok(await g.notice(expired));
});
test('failed background probe returns pending again and reports on the next SessionStart',async t=>{
  const f=await fixture(t);
  await copyFile(process.execPath,f.config.codex);await chmod(f.config.codex,0o700);
  const host={identity:await binaryIdentity(f.config.codex),binaryPath:f.config.codex,kind:'cli'};
  const observe=()=>currentHost(f.path,{detect:async()=>host,launch:async()=>{},now:()=>time});
  assert.equal(await f.notice(await observe()),'');
  assert.equal((await qualifyBinary(f.path,host,{collect:async()=>{throw Error('synthetic_failure');}})).status,'unavailable');
  await finishQualification(f.path,host);
  assert.ok(await f.notice(await observe()));
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
  await unlink(join(f.directory,'capture-stop-notice.json'));
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
  assert.equal(await f.notice({status:'pending',host,pendingFinished:true}),'');
  await writeCredential(f.path,f.config.endpoint,'synthetic');
  assert.equal(await f.notice({status:'qualified'}),'');
  const state=JSON.parse(await readFile(join(f.directory,'capture-stop-notice.json'),'utf8'));
  assert.equal(state.day,null);
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
    env:{HOME:f.home,PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8'},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
  const exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  assert.equal(exitCode,0);assert.equal(stderr,'');
  assert.equal(stdout,JSON.stringify({systemMessage:'Cairn automatic memory is paused: Codex 0.999.0 is not supported yet. Check: npx @cairn-ink/memory status --client codex'}));
});

for (const age of [60001,60000,59999,0]) test(`SessionStart notice lease age ${age}ms`,async t=>{
  const f=await fixture(t), path=join(f.directory,'capture-stop-notice.json.lock');
  await privateWrite(path,''); await utimes(path,new Date(time-age),new Date(time-age));
  const before=await stat(path);
  const output=await f.notice();
  assert.equal(Boolean(output),age>=60000);
  if(age<60000) assert.equal((await stat(path)).mtimeMs,before.mtimeMs);
});
test('concurrent SessionStarts recover a stale lease with exactly one notice',async t=>{
  const f=await fixture(t), path=join(f.directory,'capture-stop-notice.json.lock');
  await privateWrite(path,''); await utimes(path,new Date(time-60001),new Date(time-60001));
  const outputs=await Promise.all([f.notice(),f.notice(),f.notice(),f.notice()]);
  assert.equal(outputs.filter(Boolean).length,1);
  assert.equal(await f.notice(),'');
});
for (const age of [60001,60000,59999,0]) test(`acknowledged capture lease age ${age}ms`,async t=>{
  const f=await workerFixture(t,{text:header()+item('capture text')});
  // An old successful record must advance only after the new acknowledgement.
  await recordLastCapture(f.root,time-120000,1,{now:()=>time-120000});
  const path=join(f.root,'codex-last-capture.json.lock');
  await privateWrite(path,''); await utimes(path,new Date(time-age),new Date(time-age));
  const before=await stat(path);
  const result=await runWorker(f.binding,{guard:f.guard,transport:f.transport,mode:'hosted',now:()=>time});
  assert.ok(result.state.submittedUnits>0);
  assert.equal((await readLastCapture(f.root)).at,age>=60000?time:time-120000);
  if(age<60000) assert.equal((await stat(path)).mtimeMs,before.mtimeMs);
});
test('concurrent stale capture-lease recovery keeps the newest acknowledged time',async t=>{
  const f=await fixture(t), path=join(f.root,'codex-last-capture.json.lock');
  await privateWrite(path,''); await utimes(path,new Date(time-60001),new Date(time-60001));
  await Promise.all([1,2,3,4].map(count=>recordLastCapture(f.root,time,count,{now:()=>time})));
  assert.equal((await readLastCapture(f.root)).at,time);
  await recordLastCapture(f.root,time-1,1,{now:()=>time});
  assert.equal((await readLastCapture(f.root)).at,time);
});

test('a killed stale-lock reaper expires without freezing future SessionStarts',async t=>{
  const f=await fixture(t), path=join(f.directory,'capture-stop-notice.json.lock');
  await privateWrite(path,''); await utimes(path,new Date(time-60001),new Date(time-60001));
  const old=await stat(path);
  const election=`${path}.reap-${old.dev}-${old.ino}-${old.mtimeMs}-${Math.floor(time/60000)}`;
  await privateWrite(election,''); await utimes(election,new Date(time),new Date(time));
  assert.equal(await f.notice(),'');
  assert.ok(await f.notice(changed,{}, {now:()=>time+60000}));
});
test('diagnostic release preserves a successor lease',async t=>{
  const f=await fixture(t), path=join(f.directory,'capture-stop-notice.json');
  const successor='new owner';
  const output=await withWriteObserver(async event=>{
    if(event.path===path) await privateWrite(path+'.lock',successor);
  },()=>f.notice());
  assert.ok(output);
  assert.equal(await readFile(path+'.lock','utf8'),successor);
});

test('stale notice recovery across adjacent clock intervals emits at most once',async t=>{
  const f=await fixture(t), path=join(f.directory,'capture-stop-notice.json.lock');
  await privateWrite(path,''); await utimes(path,new Date(time-120000),new Date(time-120000));
  const boundary=Math.ceil(time/60000)*60000;
  const outputs=await Promise.all([f.notice(changed,{}, {now:()=>boundary-1}),
    f.notice(changed,{}, {now:()=>boundary+1})]);
  assert.ok(outputs.filter(Boolean).length<=1);
  if(!outputs.some(Boolean)) assert.ok(await f.notice(changed,{}, {now:()=>boundary+1}));
});
