import { installedImportClosure } from './fixtures/installed-import-closure.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn,spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync } from 'node:fs';
import { dirname,join,relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { buildArtifact,command,packageName } from '../build.mjs';
import { redactSecrets } from '../../integrations/client/redact.mjs';
import { binaryIdentity,canonical,KNOWN_FORMATS } from '../../integrations/codex/qualification.mjs';
import { installedSetupFixture } from './fixtures/local-setup.mjs';

for (const client of ['claude-code','codex']) for (const event of (client === 'codex' ? ['Stop','UserPromptSubmit']:['Stop']))
test(`installed ${client} real ${event} route lazily adopts fresh authority without changing session identity`,{timeout:120000},async t => {
  const f = await installedSetupFixture(t,client); f.request.interpretationConsent = false; f.save();
  await f.invoke('cli',['init','--database',f.request.databasePath]); await f.setup(); await f.activate();
  await f.invoke('hook',[],{event:'SessionStart'}); f.append('copper original capture'); await f.invoke('hook');
  const before = f.cursor(),key = readFileSync(join(f.request.installationDirectory,'identity.key'));
  await f.invoke('cli',['disable','--installation',f.request.installationDirectory]); f.append('copper OFF never captured');
  assert.equal((await f.activate()).status,'active'); f.append('copper first reenabled turn');
  await f.invoke('hook',[],{event});
  for (const field of ['sessionKey','wireSessionId','issuedOrdinal']) assert.equal(f.cursor()[field],before[field]);
  const receiptPath = join(f.request.installationDirectory,'state/sessions',before.sessionKey+'.rearm.json');
  const receipt = JSON.parse(readFileSync(receiptPath)); assert.equal(receipt.phase,'committed'); assert.equal(receipt.revision,1);
  assert.equal(receipt.replacementCursor.offset,f.cursor().offset);
  f.append('copper resumed capture'); await f.invoke('hook');
  assert.equal(f.cursor().issuedOrdinal,before.issuedOrdinal+1); assert.deepEqual(readFileSync(join(f.request.installationDirectory,'identity.key')),key);
  assert.equal((await f.inspect()).parts.map(part=>part.text).join(''),'copper original capturecopper resumed capture');
  assert.equal(rows(f.scaffold.SYNTHETIC_TRACE).length,0);
});

const root=fileURLToPath(new URL('../../',import.meta.url)),preload=fileURLToPath(new URL('./fixtures/local-oneshot.mjs',import.meta.url));
const childPreload=fileURLToPath(new URL('./fixtures/local-host-child.mjs',import.meta.url));
const driver=fileURLToPath(new URL('./fixtures/local-host.mjs',import.meta.url));
const sha=value=>createHash('sha256').update(value).digest('hex');

for (const client of ['claude-code','codex']) test(`installed ${client} Raw-only host acknowledges multipart capture with a configured key`,{timeout:120000},async t => {
  const f = await installedFixture(t,client);
  f.config.interpretation = 'raw-only'; f.config.usage.dailyCap = 1;
  const profile = JSON.parse(readFileSync(f.profilePath));
  writeFileSync(profile.configPath,JSON.stringify(f.config),{mode:0o600}); profile.configDigest = sha(readFileSync(profile.configPath));
  writeFileSync(f.profilePath,JSON.stringify(profile),{mode:0o600});
  f.source('Synthetic copper '.repeat(600));
  assert.equal((await f.invoke('prepare')).status,'ready'); assert.equal((await f.initializeCapture()).status,'ready');
  const result = await f.invoke('run',{key:true,mode:'provider-error'}); assert.equal(result.worker.hasPending,false);
  assert.equal(f.cursor().pending,null); assert.equal(f.inspect().memories,0); assert.ok(f.inspect().parts.length>1);
  assert.equal(rows(f.scaffold.SYNTHETIC_TRACE).length,0);
});
function sourceClosure() {
  return installedImportClosure(root, ["adapters/local/cli.mjs","integrations/client/raw/local-host-cli.mjs"]);
}
function rows(path){return existsSync(path)?readFileSync(path,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[]}

async function installedFixture(t,client){
  const workspace=createTestWorkspace(t,{prefix:'installed-local-host-'}),home=join(workspace.path,'home'),usage=join(workspace.path,'usage');
  mkdirSync(home,{mode:0o700});mkdirSync(usage,{mode:0o700});
  const artifact=buildArtifact(),{ required:closure, eager:eagerClosure } = sourceClosure();
  writeFileSync(join(workspace.path,'package.json'),JSON.stringify({name:'synthetic-local-host',version:'0.0.0',private:true}),{mode:0o600});
  command('npm',['install','--prefix',workspace.path,'--offline','--ignore-scripts','--no-audit','--no-fund',artifact.artifactPath],workspace.path,artifact.userconfig);
  const installed=join(workspace.path,'node_modules',packageName),configPath=join(workspace.path,'config.json'),database=join(workspace.path,'memory.sqlite');
  for(const path of closure){assert.ok(artifact.files.includes(path),path);assert.deepEqual(readFileSync(join(root,path)),readFileSync(join(installed,path)))}
  const scaffold={PATH:dirname(process.execPath),HOME:home,TMPDIR:workspace.path,TMP:workspace.path,TEMP:workspace.path,NODE_DISABLE_COMPILE_CACHE:'1',NODE_NO_WARNINGS:'1',
    SYNTHETIC_INSTALLED:installed,SYNTHETIC_CLIENT:client,SYNTHETIC_DATABASE:database,SYNTHETIC_CONFIG:configPath,SYNTHETIC_USAGE:usage,
    SYNTHETIC_TRACE:join(workspace.path,'http.jsonl'),SYNTHETIC_CORE:join(installed,'core/index.mjs'),SYNTHETIC_MODE:'memory',
    SYNTHETIC_READY:join(workspace.path,'ready'),SYNTHETIC_RELEASE:join(workspace.path,'release')};
  const prepared=spawnSync(process.execPath,[preload,'prepare'],{encoding:'utf8',timeout:15000,env:{NODE_TEST_CONTEXT:'child-v8',...scaffold,SYNTHETIC_IMPORT_TRACE:join(workspace.path,'prepare-imports.jsonl')}});
  assert.equal(prepared.error,undefined);assert.equal(prepared.status,0,prepared.stderr);assert.equal(prepared.signal,null);
  const config=JSON.parse(readFileSync(configPath));config.provider.apiKeyEnv='CAIRN_SYNTHETIC_API_KEY';writeFileSync(configPath,JSON.stringify(config));
  const pluginRoot=join(workspace.path,'plugin'),qroot=join(workspace.path,'codex-install'),qdir=join(qroot,'qualification');
  mkdirSync(pluginRoot,{mode:0o700});mkdirSync(qroot,{mode:0o700});mkdirSync(qdir,{mode:0o700});
  const qualificationConfigPath=join(qroot,'installation.json');writeFileSync(qualificationConfigPath,'{}',{mode:0o600});
  const binary=join(workspace.path,'codex');writeFileSync(binary,'synthetic native binary',{mode:0o700});
  const identity=await binaryIdentity(binary);writeFileSync(join(qdir,identity+'.json'),JSON.stringify({policy:sha(canonical(KNOWN_FORMATS)),identity,version:'0.162.0',status:'qualified',fingerprint:KNOWN_FORMATS[1]}),{mode:0o600});
  const stateRoot=join(workspace.path,'state'),identityKeyPath=join(workspace.path,'identity-key'),profilePath=join(workspace.path,'profile.json');
  writeFileSync(profilePath,JSON.stringify({version:'local-raw-host-profile-v1',configPath,configDigest:sha(readFileSync(configPath)),stateRoot,identityKeyPath,home,
    installation:client==='claude-code'?{client,pluginRoot}:{client,qualificationConfigPath}}),{mode:0o600});
  const sourcePath=join(workspace.path,'selected-source.jsonl'),sessionId='11111111-1111-4111-8111-111111111111';
  function source(text){
    const header=client==='codex'?JSON.stringify({type:'session_meta',payload:{id:sessionId,cli_version:'0.162.0',history_mode:'paginated',source:'cli',originator:'codex-tui'}})+'\n':'';
    const row=client==='claude-code'?{type:'user',uuid:'synthetic-message',timestamp:null,promptSource:'typed',message:{content:[{type:'text',text}]}}:
      {type:'event_msg',timestamp:null,payload:{type:'item_completed',thread_id:sessionId,turn_id:'synthetic-turn',item:{type:'UserMessage',id:'native-message',content:[{type:'text',text}]}}};
    writeFileSync(sourcePath,header+JSON.stringify(row)+'\n',{mode:0o600});
  }
  source('Synthetic installed host source.');let invocation=0;
  const traces=[];
  function launch(action,{key=true,mode='memory',clock,start,deadlineMs,args,abortAfterDispatch=false}={}){
    const index=invocation++,settings=join(workspace.path,'settings-'+index+'.json'),trace=join(workspace.path,'host-'+index+'.jsonl');traces.push(trace);
    const selected=['initialize','run'].includes(action)?['--session',sessionId,'--source',sourcePath,...(start?['--start',start]:[])]:[];
    writeFileSync(settings,JSON.stringify({installed,profilePath,args:args??[action,...selected],trace,scaffold,mode,clock,deadlineMs,abortAfterDispatch,
      syntheticBinary:binary,preload:childPreload}),{mode:0o600});
    const child=spawn(process.execPath,[driver,settings],{stdio:['ignore','pipe','pipe'],cwd:workspace.path,
      env:{NODE_TEST_CONTEXT:'child-v8',PATH:dirname(process.execPath),HOME:home,TMPDIR:workspace.path,TMP:workspace.path,TEMP:workspace.path,NODE_NO_WARNINGS:'1',NODE_DISABLE_COMPILE_CACHE:'1',
        ...(key?{CAIRN_SYNTHETIC_API_KEY:'synthetic_key_secret'}:{})}});
    let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=chunk;if(Buffer.byteLength(stdout)>262144)child.kill('SIGTERM')});
    child.stderr.on('data',chunk=>{stderr+=chunk;if(Buffer.byteLength(stderr)>65536)child.kill('SIGTERM')});
    const timer=setTimeout(()=>child.kill('SIGTERM'),20000);
    const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal,stdout,stderr}))}).finally(()=>clearTimeout(timer));
    workspace.defer(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await done;
      const traceRows=rows(trace),spawned=traceRows.filter(row=>row.kind==='spawn').map(row=>row.pid),closed=traceRows.filter(row=>row.kind==='close').map(row=>row.pid);
      assert.deepEqual(closed.sort(),spawned.sort(),'all owned B4a children closed before fixture cleanup')});
    return {child,done,trace};
  }
  async function invoke(action,options={},expected=0){const result=await launch(action,options).done;assert.equal(result.signal,null);assert.equal(result.code,expected,result.stderr+' '+result.stdout);
    assert.doesNotMatch(result.stdout+result.stderr,/synthetic_source_secret|synthetic_key_secret/);assert.equal(result.stdout.trim().split('\n').length,1);return JSON.parse(result.stdout)}
  async function initializeCapture(){
    if(client==='claude-code')return invoke('initialize',{start:'beginning'});
    const text=readFileSync(sourcePath,'utf8'),header=text.slice(0,text.indexOf('\n')+1);
    writeFileSync(sourcePath,header,{mode:0o600});
    const result=await invoke('initialize',{start:'eof'});
    writeFileSync(sourcePath,text,{mode:0o600});return result;
  }
  function cursor(){return JSON.parse(readFileSync(join(stateRoot,'sessions',readdirSync(join(stateRoot,'sessions')).find(name=>name.endsWith('.json')&&!name.endsWith('.claim.json')))))}
  function inspect(){const db=new DatabaseSync(database,{readOnly:true});try{return {parts:db.prepare('SELECT sealed,saved FROM raw_parts ORDER BY part_index').all(),
    memories:db.prepare('SELECT count(*) n FROM memories WHERE deleted=0').get().n,events:db.prepare('SELECT count(*) n FROM raw_events').get().n}}finally{db.close()}}
  function observedClosure(){const observed=new Set();for(const name of readdirSync(workspace.path).filter(name=>/^(prepare-imports|host-\d+|child-\d+-\d+)\.jsonl$/.test(name)))
    for(const row of rows(join(workspace.path,name)))if(row.path?.startsWith(installed+'/'))observed.add(relative(installed,row.path));return [...observed].sort()}
  return {workspace,scaffold,installed,config,sourcePath,source,initializeCapture,profilePath,stateRoot,identityKeyPath,invoke,launch,cursor,inspect,closure,eagerClosure,observedClosure,traces,artifact};
}

for(const client of ['claude-code','codex'])test(`B4c installed ${client}: actual CLI/worker/core recover lost ACK keylessly and preserve archive closure`,{timeout:120000},async t=>{
  const f=await installedFixture(t,client),text='x'.repeat(3995)+' sk-'+'a'.repeat(32)+'\n Ａ🙂 e\u0301 '.repeat(700);f.source(text);
  assert.equal((await f.invoke('status',{},2)).reason,'preparation_required');assert.equal((await f.invoke('prepare')).reason,'prepared');
  assert.equal((await f.initializeCapture()).reason,'initialized');
  assert.equal((await f.invoke('run',{mode:'drop-ack'},3)).reason,'uncertain');const pending=f.cursor().pending;assert.equal(pending.attempts,1);
  const calls=rows(f.scaffold.SYNTHETIC_TRACE).length;
  assert.equal((await f.invoke('run',{key:false,clock:pending.nextEligibleAt-1},3)).worker.dispatchedParts,0);
  const replay=await f.invoke('run',{key:false,clock:pending.nextEligibleAt+1,abortAfterDispatch:true},143);
  assert.equal(replay.status,'progress');assert.equal(replay.worker.completedParts,1);
  assert.equal(rows(f.scaffold.SYNTHETIC_TRACE).length,calls);
  await f.invoke('run',{key:false,clock:pending.nextEligibleAt+1});assert.equal(f.cursor().pending,null);
  assert.equal((await f.invoke('run',{key:false})).status,'ready');assert.equal(f.cursor().issuedOrdinal,1);
  const stored=f.inspect();assert.ok(stored.parts.length>1);assert.equal(stored.events,stored.parts.length);assert.equal(stored.memories,1);
  assert.equal(Buffer.concat(stored.parts.map(part=>Buffer.from(part.sealed))).toString(),redactSecrets(text));assert.equal(stored.parts.every(part=>part.saved===1),true);
  const ledger=JSON.parse(readFileSync(join(f.scaffold.SYNTHETIC_USAGE,'usage',readdirSync(join(f.scaffold.SYNTHETIC_USAGE,'usage')).find(name=>name.endsWith('.json')))));
  assert.equal(ledger.used,3);assert.deepEqual(ledger.reservations,[]);assert.equal(calls,6);
  assert.deepEqual(f.observedClosure(),f.eagerClosure);t.diagnostic(JSON.stringify({client,sourceDerivedClosure:f.closure.length,observedArchiveClosure:f.observedClosure().length,archiveFiles:f.artifact.files.length,
    parts:stored.parts.length,providerPortUsage:ledger.used,hostAncestry:'synthetic',actualInstalledCore:true}));
  await f.workspace.cleanup();assert.equal(existsSync(f.workspace.path),false);
});

for(const client of ['claude-code','codex'])test(`B4c installed ${client}: later SQL revocation prevents stale Memory while Raw prefix remains`,{timeout:120000},async t=>{
  const f=await installedFixture(t,client);await f.invoke('prepare');await f.initializeCapture();
  const result=await f.invoke('run',{mode:'revoke'},2);assert.equal(result.reason,'interpretation_incomplete');assert.equal(result.worker.completedParts,0);assert.equal(result.worker.hasPending,true);
  assert.equal(f.inspect().memories,0);assert.equal(f.inspect().parts.length,1);assert.equal(f.cursor().blockedReason,'interpretation_incomplete');
  assert.equal((await f.invoke('run',{key:false},2)).reason,'capture_disabled');await f.workspace.cleanup();assert.equal(existsSync(f.workspace.path),false);
});

for(const signal of ['SIGINT','SIGTERM','SIGHUP','deadline'])test(`B4c installed foreground ${signal} waits for actual child close and preserves pending`,{timeout:120000},async t=>{
  const f=await installedFixture(t,'claude-code');await f.invoke('prepare');await f.initializeCapture();
  const launched=f.launch('run',{mode:'hold',...(signal==='deadline'?{deadlineMs:5000}:{})});
  for(let attempt=0;attempt<1000&&!existsSync(f.scaffold.SYNTHETIC_READY);attempt++)await delay(10);
  assert.equal(existsSync(f.scaffold.SYNTHETIC_READY),true,'real B3 child reached synthetic provider');
  const before=f.cursor();assert.equal(before.pending.attempts,1);
  if(signal!=='deadline')assert.equal(launched.child.kill(signal),true);
  const outcome=await launched.done;assert.equal(outcome.signal,null);assert.equal(outcome.code,signal==='deadline'?2:{SIGINT:130,SIGTERM:143,SIGHUP:129}[signal],outcome.stderr);
  const result=JSON.parse(outcome.stdout);assert.equal(result.reason,signal==='deadline'?'work_limit':'cancelled');
  const trace=rows(launched.trace),spawned=trace.filter(row=>row.kind==='spawn'),closed=trace.filter(row=>row.kind==='close');assert.equal(spawned.length,1);assert.equal(closed.length,1);
  assert.equal(closed[0].pid,spawned[0].pid);assert.equal(f.cursor().issuedOrdinal,before.issuedOrdinal);
  assert.equal(f.cursor().pending.projection.eventId,before.pending.projection.eventId);assert.ok(f.cursor().pending.nextEligibleAt>Date.now());
  assert.equal((await f.invoke('run',{key:false},3)).worker.dispatchedParts,0);
  await f.workspace.cleanup();assert.equal(existsSync(f.workspace.path),false);
});

test('installed Claude delayed transcript captures its first turn through the native hook route',{timeout:120000},async t=>{
  const f=await installedSetupFixture(t,'claude-code');f.request.interpretationConsent=false;f.save();
  await f.invoke('cli',['init','--database',f.request.databasePath]);await f.setup();await f.activate();
  const {unlinkSync}=await import('node:fs');unlinkSync(f.sourcePath);
  await f.invoke('hook',[],{event:'SessionStart'});writeFileSync(f.sourcePath,'',{mode:0o600});f.append('copper first delayed turn');
  await f.invoke('hook');assert.equal((await f.inspect()).parts.map(part=>part.text).join(''),'copper first delayed turn');
});

test('installed Codex fork source is terminal across off/on and never creates a cursor', {timeout:120000},async t=>{
  const f=await installedSetupFixture(t,'codex');f.request.interpretationConsent=false;f.save();
  await f.invoke('cli',['init','--database',f.request.databasePath]);await f.setup();await f.activate();
  await f.invoke('hook',[],{event:'SessionStart',payload:{hook_event_name:'SessionStart',session_id:f.sessionId,transcript_path:f.sourcePath,source:'fork'}});
  f.append('copper fork secret');await f.invoke('hook',[],{event:'UserPromptSubmit'});await f.invoke('hook');
  await f.invoke('cli',['disable','--installation',f.request.installationDirectory]);await f.activate();await f.invoke('hook',[],{event:'PreCompact'});
  assert.deepEqual((await f.inspect()).parts,[]);assert.deepEqual(readdirSync(join(f.request.installationDirectory,'state/sessions')),[]);
});
