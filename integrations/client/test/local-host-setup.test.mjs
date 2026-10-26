import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,existsSync,unlinkSync,symlinkSync,mkdirSync,lstatSync } from 'node:fs';
import { join } from 'node:path';
import { setupFixture,ok } from './fixtures/local-setup-workspace.mjs';
import { setupLocalRaw,createLocalRawSetup } from '../raw/local-setup.mjs';
import { runLocalSetupCli } from '../raw/local-setup-cli.mjs';
import { withWriteObserver } from '../private-state.mjs';
import { hookCommand } from '../raw/local-setup-files.mjs';
import { initLocalRawStore } from '../raw/local-setup-init.mjs';
import { DatabaseSync } from 'node:sqlite';

function observe(t){let source=0,worker=0;globalThis[Symbol.for('cairn.host.observe')]=kind=>{if(kind==='source')source++;else worker++};
  t.after(()=>delete globalThis[Symbol.for('cairn.host.observe')]);return ()=>({source,worker});}
function privateResult(f,value){const text=JSON.stringify(value);for(const secret of [f.root,'synthetic_source_secret','synthetic_key_secret'])assert.equal(text.includes(secret),false);}
for(const client of ['claude-code','codex'])test(`A1/A3 ${client} keyless setup/status/activation preserve identity and opaque unrelated handlers`,async t=>{
  const f=await setupFixture(t,{client}),counts=observe(t);
  assert.equal((await f.invoke('status')).reason,'not_installed');
  const prepared=await f.setup();assert.equal(prepared.status,'prepared',JSON.stringify(prepared));privateResult(f,prepared);
  const control=f.control();assert.equal(control.automaticCaptureEnabled,true);assert.equal(control.rawNoticeVersion,'local-plain-v1');
  const key=readFileSync(join(f.request.installationDirectory,'identity.key'),'utf8'),before=f.snapshot(f.request.installationDirectory);
  assert.equal((await f.setup()).status,'prepared');assert.deepEqual(f.snapshot(f.request.installationDirectory),before);
  assert.equal((await f.invoke('activate')).status,'active');assert.equal((await f.invoke('activate')).status,'active');
  assert.equal(readFileSync(join(f.request.installationDirectory,'identity.key'),'utf8'),key);assert.deepEqual(f.control(),control);
  const config=JSON.parse(readFileSync(f.clientConfigPath));assert.equal(config.theme,'untouched');
  assert.deepEqual(config.hooks.Notification,[{matcher:'x',hooks:[{type:'prompt',prompt:'unrelated'}]}]);
  const names=client==='codex'?['SessionStart','UserPromptSubmit','Stop','PreCompact']:['SessionStart','Stop','PreCompact'];
  for(const event of names)assert.deepEqual(config.hooks[event],[{hooks:[{type:'command',command:hookCommand(f.request.installationDirectory,event),timeout:160}]}]);
  assert.equal(config.hooks.SessionEnd,undefined);assert.deepEqual(counts(),{source:0,worker:0});
  assert.equal((await f.invoke('status')).status,'active');
});
for(const consent of ['interpretationConsent','plaintextRawConsent','foregroundConsent'])test(`A1 declined ${consent} makes no grant or files`,async t=>{
  const f=await setupFixture(t);f.request[consent]=false;const before=f.snapshot();
  assert.equal((await f.setup()).status,'declined');assert.deepEqual(f.snapshot(),before);assert.equal(f.control().targetId,null);
});
test('A1 closed own-data input, canaries, help and absent status never read a key',async t=>{
  const f=await setupFixture(t);let reads=0;
  const bad={...f.request};Object.defineProperty(bad,'databasePath',{get(){reads++;throw Error('synthetic_key_secret')}});
  assert.equal((await setupLocalRaw(bad)).reason,'invalid_input');assert.equal(reads,0);
  assert.equal((await setupLocalRaw({...f.request,key:'synthetic_key_secret'})).reason,'invalid_input');
  let output='';assert.equal(await runLocalSetupCli(['--help'],{stdout:{write:text=>{output+=text}}}),0);assert.match(output,/foreground/);
  output='';assert.equal(await runLocalSetupCli(['status','--installation',f.request.installationDirectory],{stdout:{write:text=>{output+=text}}}),1);
  assert.equal(JSON.parse(output).reason,'not_installed');assert.equal(existsSync(f.request.installationDirectory),false);
  const proxy=new Proxy(new AbortController().signal,{get(){reads++;throw Error()}});
  assert.equal((await setupLocalRaw(f.request,{signal:proxy})).reason,'invalid_input');assert.equal(reads,0);
});
for(const conflict of ['hosted-command','plugin','duplicate','symlink','overlap','target'])test(`A2 ${conflict} refuses before consent`,async t=>{
  const f=await setupFixture(t);
  if(conflict==='hosted-command')writeFileSync(f.clientConfigPath,JSON.stringify({hooks:{Stop:[{hooks:[{type:'command',command:'node /synthetic/cairn-memory/capture.mjs'}]}]}}));
  if(conflict==='plugin')writeFileSync(f.clientConfigPath,JSON.stringify({enabledPlugins:{'cairn-memory@cairn-memory':true}}));
  if(conflict==='duplicate')writeFileSync(f.clientConfigPath,'{"hooks":{},"hooks":{}}');
  if(conflict==='symlink'){const actual=f.clientConfigPath+'.actual';writeFileSync(actual,'{}',{mode:0o600});unlinkSync(f.clientConfigPath);symlinkSync(actual,f.clientConfigPath);}
  if(conflict==='overlap')f.request.sourceRoot=f.request.usageRoot;
  if(conflict==='target'){const c=f.control();ok(f.core.setLocalCaptureControl({namespace:f.request.namespace,client:f.request.client,targetId:'foreign',
    expectedStoreId:c.storeId,expectedRevision:c.revision,automaticCaptureEnabled:false,rawNoticeVersion:null}));}
  const previous=f.control();assert.equal((await f.setup()).status,'blocked');assert.deepEqual(f.control(),previous);assert.equal(existsSync(f.request.installationDirectory),false);
});
test('A2 native configuration CAS rejects concurrent changes without active publication',async t=>{
  const f=await setupFixture(t);assert.equal((await f.setup()).status,'prepared');
  const outcome=await withWriteObserver(({path,kind})=>{if(path===f.clientConfigPath&&kind==='native-before-publication')writeFileSync(path,'{"foreign":"concurrent"}\n');},()=>f.invoke('activate'));
  assert.equal(outcome.reason,'configuration_changed');assert.equal(JSON.parse(readFileSync(f.clientConfigPath)).foreign,'concurrent');
  assert.equal((await f.invoke('status')).reason,'recovery_required');assert.equal(JSON.parse(readFileSync(join(f.request.installationDirectory,'installation.json'))).phase,'activation_pending');
});
test('A3 two clients reuse one shared target/usage descriptor; wrong root or cap cannot fork quota',async t=>{
  const f=await setupFixture(t);assert.equal((await f.setup()).status,'prepared');
  const qroot=join(f.root,'codex-install');const second={...f.request,client:'codex',installationDirectory:join(f.root,'second'),installation:{qualificationConfigPath:join(qroot,'installation.json')}};
  assert.equal((await setupLocalRaw(second)).status,'prepared');const c=ok(f.core.getLocalCaptureControl({namespace:f.request.namespace,client:'codex'}));assert.equal(c.targetId,f.control().targetId);
  const config=JSON.parse(readFileSync(join(second.installationDirectory,'capture.json')));assert.equal(config.usage.root,f.request.usageRoot);
  const other=join(f.root,'wrong-usage');mkdirSync(other,{mode:0o700});
  assert.equal((await setupLocalRaw({...second,installationDirectory:join(f.root,'third'),usageRoot:other})).reason,'authority_bound');
  assert.equal((await setupLocalRaw({...second,installationDirectory:join(f.root,'fourth'),dailyCap:21})).reason,'authority_bound');
});
for(const loss of ['key','marker','record'])test(`A3 missing ${loss} cannot regenerate or activate`,async t=>{
  const f=await setupFixture(t);await f.setup();const paths={key:'identity.key',marker:'host-profile.json.prepared.json',record:'installation.json'};
  unlinkSync(join(f.request.installationDirectory,paths[loss]));const before=f.snapshot();
  assert.equal((await f.invoke('activate')).status,'blocked');assert.equal((await f.setup()).status,'blocked');assert.deepEqual(f.snapshot(),before);
});
for(const client of ['claude-code','codex'])test(`A4/A6 ${client} EOF/prompt replay, disable-first and reenable preserve paused identity`,async t=>{
  const f=await setupFixture(t,{client});assert.equal((await f.setup()).status,'prepared');assert.equal((await f.invoke('activate')).status,'active');
  assert.equal((await f.hook()).status,'ready');const before=f.snapshot(f.request.installationDirectory);
  if(client==='codex')assert.equal((await f.hook('UserPromptSubmit')).status,'ready');else assert.equal((await f.hook('SessionStart')).status,'ready');
  assert.deepEqual(f.snapshot(f.request.installationDirectory),before);
  const key=readFileSync(join(f.request.installationDirectory,'identity.key'),'utf8');
  assert.equal((await f.invoke('disable')).status,'disabled');assert.equal(f.control().automaticCaptureEnabled,false);
  const counts=observe(t);assert.equal((await f.hook('Stop')).status,'blocked');assert.deepEqual(counts(),{source:0,worker:0});
  assert.equal((await f.invoke('activate')).reason,'rearm_required');assert.equal((await f.invoke('status')).reason,'rearm_required');
  assert.equal(readFileSync(join(f.request.installationDirectory,'identity.key'),'utf8'),key);assert.equal((await f.hook('Stop')).status,'blocked');
});
for(const refusal of ['forged','outside','symlink','disabled','exec','unqualified'])test(`A5 ${refusal} refuses before worker/source contents where permission disallows`,async t=>{
  const f=await setupFixture(t,{client:'codex'});await f.setup();await f.invoke('activate');const counts=observe(t);let changes={};
  if(refusal==='forged')changes.hook_event_name='Stop';
  if(refusal==='outside')changes.transcript_path=f.request.databasePath;
  if(refusal==='symlink'){const link=join(f.request.sourceRoot,'alias');symlinkSync(f.sourcePath,link);changes.transcript_path=link;}
  if(refusal==='disabled')await f.invoke('disable');if(refusal==='exec')f.setExec(true);if(refusal==='unqualified')f.setPresent(false);
  assert.equal((await f.hook('SessionStart',changes)).status,'blocked');assert.deepEqual(counts(),{source:0,worker:0});
});
test('A6 disable SQL survives native cleanup failure and hook stdout stays empty',async t=>{
  const f=await setupFixture(t);await f.setup();await f.invoke('activate');
  const outcome=await withWriteObserver(({path,kind})=>{if(path===f.clientConfigPath&&kind==='native-before-publication')throw Error('synthetic_key_secret')},()=>f.invoke('disable'));
  assert.equal(outcome.status,'blocked');assert.equal(f.control().automaticCaptureEnabled,false);assert.equal((await f.invoke('status')).status,'disabled');
  let output='';const {Readable}=await import('node:stream');
  assert.equal(await runLocalSetupCli(['hook','--installation',f.request.installationDirectory,'--event','Stop'],{
    stdin:Readable.from([JSON.stringify({hook_event_name:'Stop',session_id:'synthetic',transcript_path:f.sourcePath})]),stdout:{write:text=>{output+=text}}}),0);
  assert.equal(output,'');privateResult(f,outcome);
});
test('A9 brand-new init creates only schema29; ordinary setup binds the selected cap without a fake event',async t=>{
  const f=await setupFixture(t),path=join(f.root,'brand-new.sqlite');
  assert.deepEqual(await initLocalRawStore({databasePath:path}),{version:'local-raw-init-v1',status:'initialized',reason:null});
  const db=new DatabaseSync(path,{readOnly:true});try{assert.equal(db.prepare('PRAGMA user_version').get().user_version,29);
    for(const table of ['raw_owner_usage','local_capture_controls','raw_conversations','raw_events'])assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
  }finally{db.close()}
  f.request.databasePath=path;assert.equal((await f.setup()).status,'prepared');
  assert.equal(JSON.parse(readFileSync(join(f.request.installationDirectory,'capture.json'))).raw.capBytes,f.request.rawCapBytes);
});
test('A9 every existing path including empty file and symlink is refused byte-for-byte',async t=>{
  const f=await setupFixture(t),path=join(f.root,'existing.sqlite');
  for(const contents of ['', 'synthetic unrelated bytes']){writeFileSync(path,contents,{mode:0o600});
    assert.equal((await initLocalRawStore({databasePath:path})).status,'blocked');assert.equal(readFileSync(path,'utf8'),contents);}
  const link=join(f.root,'link.sqlite');symlinkSync(path,link);assert.equal((await initLocalRawStore({databasePath:link})).status,'blocked');
  assert.equal(readFileSync(path,'utf8'),'synthetic unrelated bytes');
});
test('A9 invalid init has no filesystem effect or grant',async t=>{
  const f=await setupFixture(t),before=f.snapshot();
  assert.equal((await initLocalRawStore({databasePath:join(f.root,'bad.sqlite'),owner:'not-supported'})).reason,'invalid_input');
  assert.equal((await initLocalRawStore({databasePath:'relative'})).reason,'invalid_input');assert.deepEqual(f.snapshot(),before);assert.equal(f.control().targetId,null);
});
test('A5 full frozen Codex native payloads carry inert required turn and optional agent metadata',async t=>{
  const f=await setupFixture(t,{client:'codex'});await f.setup();await f.invoke('activate');
  for(const [event,name]of [['SessionStart','session-start'],['UserPromptSubmit','user-prompt-submit'],['Stop','stop'],['PreCompact','pre-compact']]){
    const schema=JSON.parse(readFileSync(new URL(`../../codex/test/fixtures/binary-0.162.0/${name}.command.input.json`,import.meta.url)));
    const values={cwd:f.root,hook_event_name:event,model:'synthetic',permission_mode:'default',session_id:'11111111-1111-4111-8111-111111111111',
      transcript_path:f.sourcePath,turn_id:'synthetic-turn',stop_hook_active:false,last_assistant_message:null,prompt:'synthetic prompt',trigger:'manual',source:'startup'};
    const payload=Object.fromEntries(schema.required.map(key=>[key,values[key]]));
    for(const key of ['agent_id','agent_type'])if(schema.properties[key])payload[key]='synthetic-agent';
    const outcome=await f.hook(event,payload);assert.equal(outcome.status,'ready',JSON.stringify({event,outcome}));
  }
  assert.equal((await f.hook('Stop',{transcript_path:null,turn_id:'synthetic-turn'})).status,'blocked');
});
test('A5 official Claude full event fields remain inert, including background task descriptions',async t=>{
  const f=await setupFixture(t);await f.setup();await f.invoke('activate');
  assert.equal((await f.hook('SessionStart',{cwd:f.root,source:'startup',model:'synthetic',agent_type:'synthetic',session_title:'synthetic'})).status,'ready');
  assert.equal((await f.hook('Stop',{cwd:f.root,permission_mode:'default',stop_hook_active:false,last_assistant_message:'inert',
    background_tasks:[{id:'synthetic',type:'shell',status:'running',description:'inert',command:'never execute'}],
    session_crons:[{id:'synthetic',schedule:'0 * * * *',recurring:true,prompt:'never interpret'}]})).status,'ready');
  assert.equal((await f.hook('PreCompact',{cwd:f.root,trigger:'manual',custom_instructions:null})).status,'ready');
  assert.equal((await f.hook('Stop',{background_tasks:[{command:'inert',profilePath:'/forged'}]})).status,'blocked');
});
test('A1 readonly status creates no transient setup lock or installation-directory mutation',async t=>{
  const f=await setupFixture(t);await f.setup();const before=lstatSync(f.request.installationDirectory,{bigint:true}).mtimeNs;
  assert.equal((await f.invoke('status')).status,'prepared');assert.equal(lstatSync(f.request.installationDirectory,{bigint:true}).mtimeNs,before);
});
test('A10 coordinated concurrent client setup shares one target and never publishes active capture',async t=>{
  const f=await setupFixture(t),second={...f.request,client:'codex',installationDirectory:join(f.root,'second'),
    clientConfigPath:join(f.root,'native/second.json'),installation:{qualificationConfigPath:join(f.root,'codex-install/installation.json')}};
  writeFileSync(second.clientConfigPath,'{}',{mode:0o600});
  const records=new Set([join(f.request.installationDirectory,'installation.json'),join(second.installationDirectory,'installation.json')]),seen=new Set();
  let release;const barrier=new Promise(resolve=>{release=resolve});
  const outcomes=await withWriteObserver(async({path})=>{
    if(!records.has(path)||seen.has(path))return;seen.add(path);if(seen.size===2)release();
    let timer;try{await Promise.race([barrier,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('concurrent setup barrier timeout')),3000)})]);}finally{clearTimeout(timer)}
  },()=>Promise.all([f.setup(),setupLocalRaw(second)]));
  assert.equal(seen.size,2,'both setup intents overlap before either grant');
  for(const outcome of outcomes)assert.ok(outcome.status==='prepared'||outcome.status==='busy'||outcome.status==='blocked'&&outcome.reason==='recovery_required',JSON.stringify(outcome));
  const controls=['claude-code','codex'].map(client=>ok(f.core.getLocalCaptureControl({namespace:f.request.namespace,client}))),bound=controls.filter(value=>value.targetId!==null);
  assert.ok(bound.length>=1);assert.equal(new Set(bound.map(value=>value.targetId)).size,1);
  const descriptor=JSON.parse(readFileSync(join(f.request.usageRoot,'local-setup-budget.json')));assert.equal(descriptor.targetId,bound[0].targetId);
  for(const request of[f.request,second]){const record=JSON.parse(readFileSync(join(request.installationDirectory,'installation.json')));assert.notEqual(record.phase,'active');
    assert.equal(JSON.stringify(JSON.parse(readFileSync(request.clientConfigPath))).includes('local-setup-cli.mjs'),false);}
});
for(const client of ['claude-code','codex'])for(const change of ['missing','changed'])
test(`A3 repeated ${client} setup refuses ${change} owned hook without repairing authority or identity`,async t=>{
  const f=await setupFixture(t,{client});assert.equal((await f.setup()).status,'prepared');assert.equal((await f.invoke('activate')).status,'active');
  const control=f.control(),native=JSON.parse(readFileSync(f.clientConfigPath));
  if(change==='missing')delete native.hooks.Stop;
  else native.hooks.Stop[0].hooks[0].command+=' --unexpected';
  writeFileSync(f.clientConfigPath,JSON.stringify(native));
  assert.equal((await f.invoke('status')).status,'blocked');const before=f.snapshot();
  const outcome=await f.setup();assert.equal(outcome.status,'blocked',JSON.stringify(outcome));assert.equal(outcome.reason,'configuration_changed');
  assert.deepEqual(f.control(),control);assert.deepEqual(f.snapshot(),before);
  assert.deepEqual(JSON.parse(readFileSync(f.clientConfigPath)),native);
  assert.deepEqual(native.hooks.Notification,[{matcher:'x',hooks:[{type:'prompt',prompt:'unrelated'}]}]);
});
for(const client of ['claude-code','codex'])for(const change of ['matcher','group-once','hook-once','hook-async'])
test(`A2/A3 ${client} refuses owned ${change} semantics on status/setup/activate without mutation`,async t=>{
  const f=await setupFixture(t,{client});assert.equal((await f.setup()).status,'prepared');assert.equal((await f.invoke('activate')).status,'active');
  const control=f.control(),native=JSON.parse(readFileSync(f.clientConfigPath)),group=native.hooks.SessionStart[0];
  if(change==='matcher')group.matcher='resume';
  if(change==='group-once')group.once=true;
  if(change==='hook-once')group.hooks[0].once=true;
  if(change==='hook-async')group.hooks[0].async=false;
  writeFileSync(f.clientConfigPath,JSON.stringify(native));const before=f.snapshot(),counts=observe(t);
  for(const action of ['status','setup','activate']){
    const outcome=await(action==='setup'?f.setup():f.invoke(action));
    assert.equal(outcome.status,'blocked',JSON.stringify({action,outcome}));assert.equal(outcome.reason,'configuration_changed');
    assert.deepEqual(f.control(),control);assert.deepEqual(f.snapshot(),before);privateResult(f,outcome);
  }
  assert.deepEqual(counts(),{source:0,worker:0});
});
for(const client of ['claude-code','codex'])
test(`A2/A3 ${client} unchanged owned registration permits unrelated hooks and matcher groups`,async t=>{
  const f=await setupFixture(t,{client});await f.setup();await f.invoke('activate');
  const native=JSON.parse(readFileSync(f.clientConfigPath));
  native.hooks.SessionStart[0].hooks.push({type:'command',command:'printf synthetic-unrelated',timeout:1});
  native.hooks.SessionStart.push({matcher:'resume',hooks:[{type:'command',command:'printf synthetic-other',timeout:1}]});
  writeFileSync(f.clientConfigPath,JSON.stringify(native));const control=f.control(),before=f.snapshot();
  for(const action of ['status','setup','activate']){
    const outcome=await(action==='setup'?f.setup():f.invoke(action));assert.equal(outcome.status,'active',JSON.stringify({action,outcome}));
    assert.deepEqual(f.control(),control);assert.deepEqual(f.snapshot(),before);
  }
});
