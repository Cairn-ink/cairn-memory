import './fixtures/local-host-observer.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,existsSync,unlinkSync,symlinkSync,mkdirSync,lstatSync,readdirSync } from 'node:fs';
import { join } from 'node:path';
const { setupFixture,ok } = await import('./fixtures/local-setup-workspace.mjs');
const { setupLocalRaw,createLocalRawSetup } = await import('../raw/local-setup.mjs');
const { runLocalSetupCli } = await import('../raw/local-setup-cli.mjs');
import { withWriteObserver } from '../private-state.mjs';
import { hookCommand } from '../raw/local-setup-files.mjs';
import { initLocalRawStore } from '../raw/local-setup-init.mjs';
import { DatabaseSync } from 'node:sqlite';
const { createLocalRawHost } = await import('../raw/local-host.mjs');
const { lazyFixture } = await import('./fixtures/local-setup-workspace.mjs');
import { localPlainPort } from '../../../core/testing/raw-capture-fixtures.mjs';
import { searchFixture } from '../../../core/testing/raw-search-fixtures.mjs';
import { installRawSearchTestClock } from '../../../core/testing/raw-search-clock.mjs';
import { openMemoryCore } from '../../../core/index.mjs';

for (const client of ['claude-code','codex']) for (const action of ['forget','correct']) for (const match of ['window','named'])
test(`lazy ${client} ${action} ${match} fence survives off/on in current and history search; control resumes`,async t => {
  installRawSearchTestClock(t);
  const f = await lazyFixture(t,client),namespace = f.request.namespace; await f.hook();
  const now = Date.now(),at = new Date(now-(match === 'named' ? 86400000:0)).toISOString();
  f.append('copper fenced session',{at}); assert.equal((await f.hook('Stop')).status,'progress');
  const selected = f.cursor(),controlPath = join(f.request.sourceRoot,'control.jsonl'),controlId = '22222222-2222-4222-8222-222222222222';
  writeFileSync(controlPath,client === 'codex' ? JSON.stringify({type:'session_meta',payload:{id:controlId,cli_version:'0.162.0',history_mode:'paginated',source:'cli',originator:'codex-tui'}})+'\n':'',{mode:0o600});
  const changes = {session_id:controlId,transcript_path:controlPath},controlAt = new Date(now-172800000).toISOString();
  assert.equal((await f.hook('SessionStart',changes)).status,'ready');
  f.append('copper unfenced control',{path:controlPath,at:controlAt,nativeSessionId:controlId}); assert.equal((await f.hook('Stop',changes)).status,'progress');
  const privacyCore = openMemoryCore({path:f.request.databasePath,raw:true,rawSearch:false}); f.workspace.defer(()=>privacyCore.close());
  const memory = ok(privacyCore.admit({namespace,memory:{content:'Synthetic private fact',kind:'fact'},receipts:[{client,
    sessionId:match === 'named' ? selected.wireSessionId:'explicit-unrelated-tool',eventId:'memory-event',role:'user',excerpt:'Synthetic private fact'}]})).memory;
  const db = new DatabaseSync(f.request.databasePath); f.workspace.defer(()=>db.close());
  const search = await searchFixture({workspace:f.workspace,db,path:f.request.databasePath,port:localPlainPort()},
    {ownerId:namespace.ownerId,readSet:[namespace]}); await search.maintain();
  for (const intent of ['current','history']) assert.equal((await search.search({query:'copper',intent})).candidates.length,2);
  ok(privacyCore[action]({namespace,memoryId:memory.id,expectedRevision:memory.revision,...(action === 'correct' ? {content:'Synthetic replacement fact',kind:'fact',
    receipt:{client,sessionId:'explicit-correction',eventId:'correct-event',role:'user',excerpt:'Synthetic replacement fact'}}:{})}));
  const tables = ['raw_session_fences','local_raw_hide_windows','local_raw_session_ranges'];
  const privacy = () => tables.map(table => db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all());
  const protectedRows = privacy(); assert.ok(protectedRows[0].length>0); assert.ok(protectedRows[1].length>0);
  await f.invoke('disable'); f.append('copper paused fenced',{at}); f.append('copper paused control',{path:controlPath,at:controlAt,nativeSessionId:controlId});
  assert.equal((await f.invoke('activate')).status,'active'); assert.deepEqual(privacy(),protectedRows);
  const parts = db.prepare('SELECT count(*) n FROM raw_parts WHERE sealed IS NOT NULL').get().n;
  for (const event of (client === 'codex' ? ['Stop','UserPromptSubmit','SessionStart']:['Stop','SessionStart'])) assert.equal((await f.hook(event)).status,'blocked');
  assert.deepEqual(privacy(),protectedRows); assert.equal(db.prepare('SELECT count(*) n FROM raw_parts WHERE sealed IS NOT NULL').get().n,parts);
  assert.equal((await f.hook('Stop',changes)).status,'ready');
  f.append('copper control resumed',{path:controlPath,at:controlAt,nativeSessionId:controlId}); assert.equal((await f.hook('Stop',changes)).status,'progress');
  assert.ok(db.prepare('SELECT sealed FROM raw_parts WHERE sealed IS NOT NULL').all()
    .every(row=>!Buffer.from(row.sealed).toString('utf8').includes('copper paused')),'no off-period content is stored, even behind a fence');
  // Advance the indexed discovery cadence before requiring the newly resumed
  // turn; an immediate maintain may legitimately reuse the prior publication.
  await search.tick();
  for (const intent of ['current','history']) {
    const hits = (await search.search({query:'copper',intent})).candidates; assert.ok(hits.length>0);
    const texts=[];
    for (const hit of hits) {
      const source = (await search.prepare(hit,intent)).validate();
      // Match whole words: "unfenced control" is the positive control.
      assert.ok(source.ranges.every(range => !/\b(?:fenced|paused)\b/.test(range.text)));
      texts.push(...source.ranges.map(range=>range.text));
    }
    assert.match(texts.join('\n'),/copper unfenced control/);
    assert.match(texts.join('\n'),/copper control resumed/);
  }
});

for (const client of ['claude-code','codex']) for (const stage of ['pending','config','profile','preparation','ready'])
test(`lazy ${client} activation crash at ${stage} resumes repinning before hooks become active`,async t => {
  const f = await setupFixture(t,{client}); await f.setup(); await f.invoke('activate'); await f.invoke('disable');
  const root = f.request.installationDirectory,key = readFileSync(join(root,'identity.key')); let fired = false;
  const failed = await withWriteObserver(({path}) => {
    const name = path.slice(root.length+1);
    const selected = name === 'host-profile.json.activation.json' ? JSON.parse(readFileSync(path)).phase
      : ({'capture.json':'config','host-profile.json':'profile','host-profile.json.prepared.json':'preparation'})[name];
    if (!fired && selected === stage) { fired = true; throw Error('synthetic activation interruption'); }
  },() => f.invoke('activate'));
  assert.equal(fired,true); assert.equal(failed.status,'blocked'); assert.equal((await f.hook('Stop')).status,'blocked');
  assert.equal((await f.setup()).status,'active'); assert.equal((await f.invoke('status')).status,'active');
  assert.deepEqual(readFileSync(join(root,'identity.key')),key); assert.equal((await f.hook()).status,'ready');
});

function observe(t){let source=0,worker=0;globalThis[Symbol.for('cairn.host.observe')]=kind=>{if(kind==='source')source++;else worker++};
  t.after(()=>delete globalThis[Symbol.for('cairn.host.observe')]);return ()=>({source,worker});}
function privateResult(f,value){const text=JSON.stringify(value);for(const secret of [f.root,'synthetic_source_secret','synthetic_key_secret'])assert.equal(text.includes(secret),false);}
for (const client of ['claude-code','codex']) for (const route of ['activate','setup','legacy'])
test(`lazy ${client} no-history ${route} restores hooks and host without an ancestor or new identity`,async t => {
  const f = await setupFixture(t,{client}); await f.setup(); await f.invoke('activate');
  const keyPath = join(f.request.installationDirectory,'identity.key'), key = readFileSync(keyPath), before = f.control();
  await f.invoke('disable'); assert.equal(JSON.parse(readFileSync(f.clientConfigPath)).hooks.SessionStart,undefined);
  if (route === 'legacy') {
    const current = f.control(); ok(f.core.setLocalCaptureControl({namespace:f.request.namespace,client,targetId:current.targetId,
      expectedStoreId:current.storeId,expectedRevision:current.revision,automaticCaptureEnabled:true,rawNoticeVersion:current.rawNoticeVersion}));
    const path = join(f.request.installationDirectory,'installation.json'),record = JSON.parse(readFileSync(path));
    writeFileSync(path,JSON.stringify({...record,phase:'rearm_required'}));
  }
  f.setPresent(false); const counts = observe(t);
  assert.equal((await (route === 'setup' ? f.setup():f.invoke('activate'))).status,'active');
  assert.equal((await f.invoke('status')).status,'active');
  assert.equal((await createLocalRawHost({profilePath:join(f.request.installationDirectory,'host-profile.json')}).status()).status,'ready');
  assert.deepEqual(counts(),{source:0,worker:0});
  assert.deepEqual(readFileSync(keyPath),key); assert.equal(f.control().storeId,before.storeId);assert.equal(f.control().targetId,before.targetId);
  assert.ok(JSON.parse(readFileSync(f.clientConfigPath)).hooks.Stop);
  assert.deepEqual(readdirSync(join(f.request.installationDirectory,'state/sessions')),[]);
  f.setPresent(true); assert.equal((await f.hook()).status,'ready');
  const directory = join(f.request.installationDirectory,'state/sessions');
  const cursor = JSON.parse(readFileSync(join(directory,readdirSync(directory).find(name=>/^[a-f0-9]{64}\.json$/.test(name)))));
  assert.equal(cursor.issuedOrdinal,0); assert.equal(cursor.rearmRevision,undefined);
});
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
for(const consent of ['plaintextRawConsent','foregroundConsent'])test(`A1 declined ${consent} makes no grant or files`,async t=>{
  const f=await setupFixture(t);f.request[consent]=false;const before=f.snapshot();
  assert.equal((await f.setup()).status,'declined');assert.deepEqual(f.snapshot(),before);assert.equal(f.control().targetId,null);
});
for (const interpretationConsent of [false,true]) for (const rawMode of ['off','local-plain-v1'])
for (const plaintextRawConsent of [false,true]) for (const foregroundConsent of [false,true])
test(`local setup consent matrix ${JSON.stringify({interpretationConsent,rawMode,plaintextRawConsent,foregroundConsent})}`, async t => {
  const f = await setupFixture(t);
  Object.assign(f.request,{interpretationConsent,rawMode,plaintextRawConsent,foregroundConsent});
  const accepted = foregroundConsent && (interpretationConsent || rawMode === 'local-plain-v1') && (rawMode === 'off' || plaintextRawConsent);
  const result = await f.setup(); assert.equal(result.status,accepted ? 'prepared' : 'declined',JSON.stringify(result));
  if (accepted) {
    const config = JSON.parse(readFileSync(join(f.request.installationDirectory,'capture.json')));
    assert.equal(config.interpretation,interpretationConsent ? undefined : 'raw-only');
    assert.equal((await f.invoke('activate')).status,'active');
    // Changing the mode in place is a configuration conflict, even when valid.
    f.request.interpretationConsent = !interpretationConsent;
    if (rawMode === 'local-plain-v1') assert.equal((await f.setup()).status,'blocked');
  } else assert.equal(f.control().targetId,null);
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
  assert.equal((await f.invoke('activate')).status,'active');assert.equal((await f.invoke('status')).status,'active');
  assert.equal(readFileSync(join(f.request.installationDirectory,'identity.key'),'utf8'),key);assert.equal((await f.hook('Stop')).status,'ready');
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
  assert.equal((await f.hook('Stop',{background_tasks:[{command:'inert',profilePath:'/forged'}]})).status,'ready');
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

for (const nested of [false,true]) test(`Claude delayed transcript (${nested?'missing parents':'missing file'}) captures first turns from zero`,async t=>{
  const f=await lazyFixture(t,'claude-code');
  const path=nested?join(f.request.sourceRoot,'new','nested','session.jsonl'):f.sourcePath;
  if(!nested)unlinkSync(path);
  const changes={transcript_path:path};
  assert.equal((await f.hook('SessionStart',changes)).status,'ready');
  const starts=join(f.request.installationDirectory,'state','starts'),names=readdirSync(starts);
  assert.equal(names.length,1); assert.equal(lstatSync(join(starts,names[0])).mode&0o777,0o600);
  assert.doesNotMatch(readFileSync(join(starts,names[0]),'utf8'),/session\.jsonl|synthetic_source_secret/);
  if(nested)mkdirSync(join(f.request.sourceRoot,'new','nested'),{recursive:true,mode:0o700});
  writeFileSync(path,'',{mode:0o600});f.append('first copper turn',{path});f.append('second copper turn',{path});
  assert.equal((await f.hook('Stop',changes)).status,'progress');
  const db=new DatabaseSync(f.request.databasePath);t.after(()=>db.close());
  assert.equal(db.prepare('SELECT count(*) n FROM raw_messages').get().n,2);
  assert.deepEqual(db.prepare('SELECT sealed FROM raw_parts ORDER BY rowid').all().map(row=>Buffer.from(row.sealed).toString()),['first copper turn','second copper turn']);
});

test('Claude marker is cleared on disable; absent cursor stays refused until a new SessionStart',async t=>{
  const f=await lazyFixture(t,'claude-code');unlinkSync(f.sourcePath);await f.hook();
  const starts=join(f.request.installationDirectory,'state','starts');assert.equal(readdirSync(starts).length,1);
  await f.invoke('disable');assert.deepEqual(readdirSync(starts),[]);
  writeFileSync(f.sourcePath,'',{mode:0o600});f.append('off period secret');await f.invoke('activate');
  assert.equal((await f.hook('Stop')).status,'blocked');
  assert.equal((await f.hook()).status,'ready'); // Existing file -> EOF, never marker/zero.
  f.append('on period copper');assert.equal((await f.hook('Stop')).status,'progress');
  const db=new DatabaseSync(f.request.databasePath);t.after(()=>db.close());
  assert.deepEqual(db.prepare('SELECT sealed FROM raw_parts').all().map(row=>Buffer.from(row.sealed).toString()),['on period copper']);
});

for (const unsafe of ['symlink','writable','no-start']) test(`Claude delayed observation refuses ${unsafe} without a marker`,async t=>{
  const f=await lazyFixture(t,'claude-code');
  if(unsafe==='symlink'){unlinkSync(f.sourcePath);symlinkSync(join(f.request.sourceRoot,'missing'),f.sourcePath);}
  if(unsafe==='writable') {const {chmodSync}=await import('node:fs');chmodSync(f.sourcePath,0o660);}
  assert.equal((await f.hook(unsafe==='no-start'?'Stop':'SessionStart')).status,'blocked');
  assert.equal(existsSync(join(f.request.installationDirectory,'state','starts')),false);
});

test('Codex native fork source is terminal before any transcript exists and survives off/on',async t=>{
  installRawSearchTestClock(t);
  const f=await lazyFixture(t,'codex');unlinkSync(f.sourcePath);
  assert.equal((await f.hook('SessionStart',{source:'fork'})).status,'blocked');
  writeFileSync(f.sourcePath,JSON.stringify({type:'session_meta',payload:{id:'11111111-1111-4111-8111-111111111111',cli_version:'0.162.0',history_mode:'paginated',source:'cli',originator:'codex-tui'}})+'\n',{mode:0o600});
  f.append('copper fork secret');
  for(const event of ['UserPromptSubmit','Stop','PreCompact','SessionStart'])assert.equal((await f.hook(event)).status,'blocked');
  await f.invoke('disable');await f.invoke('activate');f.append('copper resumed fork secret');
  for(const event of ['UserPromptSubmit','Stop','PreCompact'])assert.equal((await f.hook(event)).status,'blocked');
  const controlId='22222222-2222-4222-8222-222222222222',path=join(f.request.sourceRoot,'control.jsonl');
  writeFileSync(path,JSON.stringify({type:'session_meta',payload:{id:controlId,cli_version:'0.162.0',history_mode:'paginated',source:'cli',originator:'codex-tui'}})+'\n',{mode:0o600});
  const changes={session_id:controlId,transcript_path:path};assert.equal((await f.hook('UserPromptSubmit',changes)).status,'ready');
  f.append('copper control',{path,nativeSessionId:controlId});assert.equal((await f.hook('Stop',changes)).status,'progress');
  const db=new DatabaseSync(f.request.databasePath);t.after(()=>db.close());assert.equal(db.prepare('SELECT count(*) n FROM raw_messages').get().n,1);
  const {createHmac}=await import('node:crypto'),config=JSON.parse(readFileSync(join(f.request.installationDirectory,'capture.json')));
  const key=Buffer.from(readFileSync(join(f.request.installationDirectory,'identity.key'),'utf8').trim(),'hex'),ns=f.request.namespace;
  const wire='localv2_'+createHmac('sha256',key).update(JSON.stringify(['local-raw-worker-v1','wire-session',[config.authority.storeId,config.authority.targetId,{ownerId:ns.ownerId,scope:ns.scope,projectId:''},'codex','11111111-1111-4111-8111-111111111111']])).digest('hex');
  const secret=Buffer.from(db.prepare('SELECT secret FROM episode_identity WHERE singleton=1').get().secret,'hex');
  const expected='s1:'+createHmac('sha256',secret).update(JSON.stringify(['episode-v1',ns.ownerId,ns.scope,'','codex',wire])).digest('hex');
  assert.equal(db.prepare('SELECT session_key FROM raw_session_fences').get().session_key,expected,'the native fork fence uses the actual worker identity');
  const search=await searchFixture({workspace:f.workspace,db,path:f.request.databasePath,port:localPlainPort()},{ownerId:f.request.namespace.ownerId,readSet:[f.request.namespace]});await search.maintain();
  for(const intent of ['current','history']) {const hits=(await search.search({query:'copper',intent})).candidates;assert.equal(hits.length,1);assert.match((await search.prepare(hits[0],intent)).validate().ranges[0].text,/control/);}
});

test('Codex header fork refusal remains independent of native source',async t=>{
  const f=await lazyFixture(t,'codex');const rows=readFileSync(f.sourcePath,'utf8').trim().split('\n').map(JSON.parse);
  rows[0].payload.forked_from_id='synthetic-parent';writeFileSync(f.sourcePath,rows.map(JSON.stringify).join('\n')+'\n');
  assert.equal((await f.hook()).status,'blocked');assert.equal((await f.hook('UserPromptSubmit')).status,'blocked');
});

test('failed first Codex qualification installs waiting hooks, then captures after background success',async t=>{
  const f=await setupFixture(t,{client:'codex'});f.request.interpretationConsent=false;
  const cache=join(f.root,'codex-install','qualification');for(const name of readdirSync(cache))unlinkSync(join(cache,name));
  assert.equal((await f.setup()).status,'prepared');assert.equal((await f.invoke('activate')).status,'active');
  let queued=null,launches=0;f.dependencies.launchQualification=async(path,host)=>{queued={path,host};launches++;};
  assert.equal((await f.hook('UserPromptSubmit')).status,'blocked');assert.equal(launches,1);
  const before=await f.invoke('status');assert.equal(before.qualification.status,'pending');assert.match(before.qualification.message,/rerun setup/);
  const {runLocalQualification}=await import('../raw/local-codex-qualification.mjs');const {formatFixture}=await import('../../codex/test/format-fixtures.mjs');
  await runLocalQualification(queued.path,queued.host,{collect:async()=>({version:'0.162.0',evidence:await formatFixture('0.160.1'),binarySha256:'a'.repeat(64)})});
  assert.equal((await f.invoke('status')).qualification.status,'qualified');
  assert.equal((await f.hook('UserPromptSubmit')).status,'ready');
  const {appendFileSync}=await import('node:fs');const {codex}=await import('./fixtures/raw-fixtures.mjs');const row=codex('copper first qualified turn');row.timestamp=new Date().toISOString();row.payload.item.id='new-id';
  appendFileSync(f.sourcePath,JSON.stringify(row)+'\n');assert.equal((await f.hook('Stop')).status,'progress');
  const db=new DatabaseSync(f.request.databasePath);t.after(()=>db.close());assert.equal(db.prepare('SELECT count(*) n FROM raw_messages').get().n,1);
  const snapshot=f.snapshot();await f.invoke('status');assert.deepEqual(f.snapshot(),snapshot,'status only reads cached evidence');
});

test('a restored stale Claude start marker cannot authorize a new authority',async t=>{
  const f=await lazyFixture(t,'claude-code');unlinkSync(f.sourcePath);await f.hook();
  const starts=join(f.request.installationDirectory,'state','starts'),name=readdirSync(starts)[0],text=readFileSync(join(starts,name));
  await f.invoke('disable');await f.invoke('activate');writeFileSync(join(starts,name),text,{mode:0o600});
  writeFileSync(f.sourcePath,'',{mode:0o600});f.append('off period old marker');assert.equal((await f.hook('Stop')).status,'blocked');
});

for(const unsafe of ['writable-parent','foreign-parent'])test(`Claude missing file below ${unsafe} never writes a marker`,async t=>{
  const f=await lazyFixture(t,'claude-code'),parent=join(f.request.sourceRoot,'unsafe');mkdirSync(parent,{mode:0o700});
  const fs=await import('node:fs');const {syncBuiltinESMExports}=await import('node:module');const original=fs.promises.lstat;
  if(unsafe==='writable-parent')fs.chmodSync(parent,0o770);
  else {fs.promises.lstat=async(path,...args)=>{const value=await original(path,...args);if(path===parent)value.uid=process.getuid()+1;return value;};syncBuiltinESMExports();}
  try {assert.equal((await f.hook('SessionStart',{transcript_path:join(parent,'missing.jsonl')})).status,'blocked');}
  finally {fs.promises.lstat=original;syncBuiltinESMExports();}
  assert.equal(existsSync(join(f.request.installationDirectory,'state','starts')),false);
});

for (const client of ['claude-code','codex']) for (const mode of [0o700,0o750,0o755]) test(`${client} native lock accepts safe client directory ${mode.toString(8)}`,async t => {
  const f = await setupFixture(t,{client});
  const { dirname } = await import('node:path');
  const { chmod, lstat } = await import('node:fs/promises');
  const { stateLock } = await import('../state-lock.mjs');
  const parent = dirname(f.clientConfigPath), lock = f.clientConfigPath+'.cairn-local.lock';
  await chmod(parent,mode);
  assert.equal((await f.setup()).status,'prepared');
  assert.equal((await f.invoke('activate')).status,'active');
  assert.equal((await f.invoke('status')).status,'active');
  assert.equal((await f.invoke('disable')).status,'disabled');
  assert.equal((await f.invoke('status')).status,'disabled');
  assert.equal((await f.invoke('activate')).status,'active');
  assert.equal((await lstat(parent)).mode & 0o777,mode);
  // Unspecified callers still require a private parent.
  if (mode !== 0o700) await assert.rejects(stateLock(lock,()=>assert.fail('private lock entered')),/state_permissions/);
});
