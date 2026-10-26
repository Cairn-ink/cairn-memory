import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,existsSync,readdirSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { installedSetupFixture,rows } from './fixtures/local-setup.mjs';
import { redactSecrets } from '../../integrations/client/redact.mjs';

for(const client of ['claude-code','codex'])test(`A1–A6/A8/A9 installed ${client}: explicit setup/quiet hooks/capture/replay/disable/rearm`,{timeout:120000},async t=>{
  const f=await installedSetupFixture(t,client);
  const guidePath='docs/raw-local-journal.md';
  assert.ok(f.artifact.files.includes(guidePath),'archive contains the advertised operator guide');
  const guide=readFileSync(join(f.installed,guidePath),'utf8');
  for(const field of ['local-raw-setup-request-v1','interpretationConsent','plaintextRawConsent','foregroundConsent','usageRoot'])assert.ok(guide.includes(field),field);
  const help=spawnSync(process.execPath,[f.executable,'local','--help'],{encoding:'utf8',timeout:10000,cwd:f.base,
    env:{PATH:'/usr/bin:/bin',HOME:join(f.base,'operator-home'),TMPDIR:f.base,NODE_NO_WARNINGS:'1',NODE_DISABLE_COMPILE_CACHE:'1'}});
  assert.equal(help.error,undefined);assert.equal(help.status,0,help.stderr);assert.equal(help.signal,null);
  assert.ok(help.stdout.includes(guidePath),'installed help advertises the archived guide path');
  assert.equal((await f.invoke('cli',['init','--database',f.request.databasePath])).status,'initialized');
  assert.equal((await f.inspect()).usage,null);assert.equal((await f.setup()).status,'prepared');assert.equal((await f.activate()).status,'active');
  const native=JSON.parse(readFileSync(f.clientConfigPath));assert.equal(native.theme,'untouched');assert.equal(native.hooks.Notification[0].hooks[1].type,'mcp_tool');
  const key=readFileSync(join(f.request.installationDirectory,'identity.key'),'utf8');
  // Exact shell command executes the installed CLI. Outside a real Codex host,
  // its quiet refusal is expected; subsequent ancestry is explicitly synthetic.
  f.exact('SessionStart');if(client==='claude-code')assert.equal(f.cursor().issuedOrdinal,0);
  await f.invoke('hook',[],{event:client==='codex'?'UserPromptSubmit':'SessionStart'});assert.equal(f.cursor().issuedOrdinal,0);
  const text='x'.repeat(3995)+' sk-'+'a'.repeat(32)+'\n Ａ🙂 e\u0301 '.repeat(700);f.append(text);
  await f.invoke('hook',[],{event:'PreCompact',key:true});const cursor=f.cursor();assert.equal(cursor.issuedOrdinal,1);assert.equal(cursor.pending,null);
  const stored=await f.inspect();assert.equal(stored.memories,1);assert.ok(stored.parts.length>1);assert.equal(stored.parts.map(part=>part.text).join(''),redactSecrets(text));
  assert.equal(stored.usage.cap_bytes,f.request.rawCapBytes);const calls=rows(f.scaffold.SYNTHETIC_TRACE).length;
  // The other client installs only after actual first-client usage exists.
  // Setup must reuse the descriptor/target without touching that ledger.
  const usageDirectory=join(f.request.usageRoot,'usage'),usageFiles=readdirSync(usageDirectory).sort();
  assert.equal(usageFiles.filter(name=>name.endsWith('.json')).length,1);
  const usageBefore=Object.fromEntries(usageFiles.map(name=>[name,readFileSync(join(usageDirectory,name),'utf8')]));
  const ledger=JSON.parse(usageBefore[usageFiles.find(name=>name.endsWith('.json'))]);assert.ok(ledger.used>0);
  const descriptorPath=join(f.request.usageRoot,'local-setup-budget.json'),descriptorBefore=readFileSync(descriptorPath,'utf8');
  const originalConfig=JSON.parse(readFileSync(f.configPath));
  const secondClient=client==='codex'?'claude-code':'codex',second={...f.request,client:secondClient,
    installationDirectory:join(f.base,'second-installation'),clientConfigPath:join(f.base,'native/second.json'),
    installation:secondClient==='codex'?{qualificationConfigPath:join(f.base,'codex-install/installation.json')}:{pluginRoot:join(f.base,'plugin')}};
  writeFileSync(second.clientConfigPath,'{}',{mode:0o600});const secondRequest=join(f.base,'second-request.json');writeFileSync(secondRequest,JSON.stringify(second),{mode:0o600});
  assert.equal((await f.invoke('cli',['setup','--request',secondRequest])).status,'prepared');
  const secondConfig=JSON.parse(readFileSync(join(second.installationDirectory,'capture.json')));
  assert.equal(secondConfig.authority.targetId,originalConfig.authority.targetId);assert.equal(secondConfig.usage.root,originalConfig.usage.root);
  assert.equal(readFileSync(descriptorPath,'utf8'),descriptorBefore);assert.deepEqual(readdirSync(usageDirectory).sort(),usageFiles);
  for(const name of usageFiles)assert.equal(readFileSync(join(usageDirectory,name),'utf8'),usageBefore[name]);
  assert.equal(rows(f.scaffold.SYNTHETIC_TRACE).length,calls,'second-client setup performs no model work');
  await f.invoke('hook');assert.deepEqual(f.cursor(),cursor);assert.equal(rows(f.scaffold.SYNTHETIC_TRACE).length,calls);
  assert.equal((await f.invoke('cli',['disable','--installation',f.request.installationDirectory])).status,'disabled');f.append('paused content never captured');
  const refused=await f.invoke('hook');assert.equal(refused.filter(row=>row.kind==='source'||row.kind==='worker'||row.kind==='spawn').length,0);
  assert.equal((await f.invoke('cli',['activate','--installation',f.request.installationDirectory],{},1)).reason,'rearm_required');
  const rearmed=await f.invoke('rearm');assert.equal(rearmed.status,'ready',JSON.stringify(rearmed));assert.equal((await f.activate()).status,'active');
  assert.equal(readFileSync(join(f.request.installationDirectory,'identity.key'),'utf8'),key);assert.equal(f.cursor().issuedOrdinal,1);
  await f.invoke('hook');assert.equal(rows(f.scaffold.SYNTHETIC_TRACE).length,calls);f.append('new after explicit rearm');
  await f.invoke('hook',[],{key:true,mode:'empty'});assert.equal(f.cursor().issuedOrdinal,2);assert.equal(f.cursor().pending,null);
  const after=await f.inspect();assert.doesNotMatch(after.parts.map(part=>part.text).join(''),/Historical source|paused content/);
  assert.deepEqual(f.observed(),f.graph.eager);t.diagnostic(JSON.stringify({client,required:f.graph.required.length,eager:f.graph.eager.length,archive:f.artifact.files.length,
    actualGeneratedCommand:true,providerCapture:'installed trusted-code HTTP/ancestry instrumentation',processes:f.receipts}));
  await f.workspace.cleanup();assert.equal(existsSync(f.workspace.path),false);
});
for(const client of ['claude-code','codex'])test(`A5 installed ${client}: closed event/source/host refusals dispatch nothing`,{timeout:120000},async t=>{
  const f=await installedSetupFixture(t,client);await f.invoke('cli',['init','--database',f.request.databasePath]);await f.setup();await f.activate();
  const payload={hook_event_name:'SessionStart',session_id:f.sessionId,transcript_path:f.sourcePath};
  for(const changes of [{hook_event_name:'Stop'},{transcript_path:f.request.databasePath},{namespace:f.request.namespace},{transcript_path:null}]){
    const trace=await f.invoke('hook',[],{event:'SessionStart',payload:{...payload,...changes}});assert.equal(trace.filter(row=>['source','worker','spawn'].includes(row.kind)).length,0);
  }
  if(client==='codex')for(const flags of [{exec:true},{missing:true}]){const trace=await f.invoke('hook',[],{event:'SessionStart',...flags});assert.equal(trace.filter(row=>['source','worker','spawn'].includes(row.kind)).length,0);}
  assert.equal((await f.inspect()).events,0);await f.workspace.cleanup();assert.equal(existsSync(f.workspace.path),false);
});
test('A7 installed foreground cancellation awaits actual B4a close and quiet hook emits no context',{timeout:120000},async t=>{
  const f=await installedSetupFixture(t);await f.invoke('cli',['init','--database',f.request.databasePath]);await f.setup();await f.activate();await f.invoke('hook',[],{event:'SessionStart'});
  f.append('synthetic foreground cancellation source');const launched=f.launch('hook',[],{key:true,mode:'hold'});
  for(let attempt=0;attempt<1000&&!existsSync(f.scaffold.SYNTHETIC_READY);attempt++)await delay(10);
  assert.equal(existsSync(f.scaffold.SYNTHETIC_READY),true,'actual provider entered');assert.equal(launched.child.kill('SIGTERM'),true);
  const outcome=await launched.done;assert.equal(outcome.code,0,outcome.stderr);assert.equal(outcome.signal,null);assert.equal(outcome.stdout,'');
  const trace=rows(launched.trace);assert.deepEqual(trace.filter(row=>row.kind==='spawn').map(row=>row.pid),trace.filter(row=>row.kind==='close').map(row=>row.pid));assert.equal(f.cursor().pending.attempts,1);
  const ledger=JSON.parse(readFileSync(join(f.request.usageRoot,'usage',readdirSync(join(f.request.usageRoot,'usage')).find(name=>name.endsWith('.json')))));
  assert.equal(ledger.used,1);assert.equal(ledger.reservations.length,1);assert.equal(ledger.reservations[0].started,true);
  assert.throws(()=>process.kill(ledger.reservations[0].pid,0),{code:'ESRCH'});
  // A killed provider cannot acknowledge settlement. Keep its started usage
  // debit and dead-owner reservation; the existing guard reaps that slot only
  // on a later explicit reserve/resume, not during status. Do not invent new
  // work or refund usage merely to make this cancellation check pass.
  const closed=trace.filter(row=>row.kind==='close');assert.equal(closed.length,1);
  assert.equal(ledger.reservations[0].pid,closed[0].pid);
  t.diagnostic(JSON.stringify({cancelled:'SIGTERM',childClosed:true,startedUsageRetained:ledger.used,
    deadOwnerReservationRetained:true,automaticRetry:false}));
  await f.workspace.cleanup();assert.equal(existsSync(f.workspace.path),false);
});
test('A7 installed SIGHUP cooperatively waits for owned B4a child termination',{timeout:120000},async t=>{
  const f=await installedSetupFixture(t);await f.invoke('cli',['init','--database',f.request.databasePath]);await f.setup();await f.activate();await f.invoke('hook',[],{event:'SessionStart'});
  f.append('synthetic foreground SIGHUP source');const launched=f.launch('hook',[],{key:true,mode:'hold'});
  for(let attempt=0;attempt<1000&&!existsSync(f.scaffold.SYNTHETIC_READY);attempt++)await delay(10);
  assert.equal(existsSync(f.scaffold.SYNTHETIC_READY),true);launched.child.kill('SIGHUP');const outcome=await launched.done;
  assert.equal(outcome.signal,null);assert.equal(outcome.code,0);assert.equal(outcome.stdout,'');
  const trace=rows(launched.trace);assert.deepEqual(trace.filter(row=>row.kind==='spawn').map(row=>row.pid),trace.filter(row=>row.kind==='close').map(row=>row.pid));
});
for(const client of ['claude-code','codex'])test(`A3 installed ${client} repeated setup observes missing/changed hook drift without repair`,{timeout:120000},async t=>{
  const f=await installedSetupFixture(t,client);await f.invoke('cli',['init','--database',f.request.databasePath]);await f.setup();await f.activate();
  const nativeText=readFileSync(f.clientConfigPath,'utf8'),control=(await f.inspect()).control;
  const paths=['installation.json','identity.key','capture.json','host-profile.json','host-profile.json.prepared.json'];
  const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
  const before=Object.fromEntries(paths.map(path=>[path,hash(join(f.request.installationDirectory,path))]));
  for(const change of ['missing','changed']){
    const native=JSON.parse(nativeText);if(change==='missing')delete native.hooks.Stop;else native.hooks.Stop[0].hooks[0].command+=' --unexpected';
    const text=JSON.stringify(native);writeFileSync(f.clientConfigPath,text);
    assert.equal((await f.invoke('cli',['status','--installation',f.request.installationDirectory],{},1)).status,'blocked');
    const outcome=await f.invoke('cli',['setup','--request',f.requestPath],{},1);assert.equal(outcome.reason,'configuration_changed');
    assert.equal(readFileSync(f.clientConfigPath,'utf8'),text);assert.deepEqual((await f.inspect()).control,control);
    assert.deepEqual(Object.fromEntries(paths.map(path=>[path,hash(join(f.request.installationDirectory,path))])),before);
    assert.deepEqual(JSON.parse(readFileSync(f.clientConfigPath)).hooks.Notification,JSON.parse(nativeText).hooks.Notification);
    assert.equal(rows(f.scaffold.SYNTHETIC_TRACE).length,0);writeFileSync(f.clientConfigPath,nativeText);
  }
  await f.workspace.cleanup();assert.equal(existsSync(f.workspace.path),false);
});
for(const client of ['claude-code','codex'])test(`A2/A3 installed ${client} matcher/modifier drift refuses every active CLI observation`,{timeout:120000},async t=>{
  const f=await installedSetupFixture(t,client);await f.invoke('cli',['init','--database',f.request.databasePath]);await f.setup();await f.activate();
  const nativeText=readFileSync(f.clientConfigPath,'utf8'),control=(await f.inspect()).control;
  const paths=['installation.json','identity.key','capture.json','host-profile.json','host-profile.json.prepared.json'];
  const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
  const identity=Object.fromEntries(paths.map(path=>[path,hash(join(f.request.installationDirectory,path))]));
  for(const change of ['matcher','hook-once']){
    const native=JSON.parse(nativeText),group=native.hooks.SessionStart[0];
    if(change==='matcher')group.matcher='resume';else group.hooks[0].once=true;
    const text=JSON.stringify(native);writeFileSync(f.clientConfigPath,text);
    for(const args of [['status','--installation',f.request.installationDirectory],['setup','--request',f.requestPath],['activate','--installation',f.request.installationDirectory]]){
      const outcome=await f.invoke('cli',args,{},1);assert.equal(outcome.status,'blocked');assert.equal(outcome.reason,'configuration_changed');
      assert.equal(readFileSync(f.clientConfigPath,'utf8'),text);assert.deepEqual((await f.inspect()).control,control);
      assert.deepEqual(Object.fromEntries(paths.map(path=>[path,hash(join(f.request.installationDirectory,path))])),identity);
    }
  }
  const native=JSON.parse(nativeText);native.hooks.SessionStart[0].hooks.push({type:'command',command:'printf synthetic-unrelated',timeout:1});
  native.hooks.SessionStart.push({matcher:'resume',hooks:[{type:'command',command:'printf synthetic-other',timeout:1}]});
  const text=JSON.stringify(native);writeFileSync(f.clientConfigPath,text);
  for(const args of [['status','--installation',f.request.installationDirectory],['setup','--request',f.requestPath],['activate','--installation',f.request.installationDirectory]])assert.equal((await f.invoke('cli',args)).status,'active');
  assert.equal(readFileSync(f.clientConfigPath,'utf8'),text);assert.deepEqual((await f.inspect()).control,control);
  assert.deepEqual(Object.fromEntries(paths.map(path=>[path,hash(join(f.request.installationDirectory,path))])),identity);
  for(const trace of f.traces)assert.equal(rows(trace).filter(row=>['source','worker','spawn'].includes(row.kind)).length,0);
  assert.equal(rows(f.scaffold.SYNTHETIC_TRACE).length,0);
  await f.workspace.cleanup();assert.equal(existsSync(f.workspace.path),false);
});
