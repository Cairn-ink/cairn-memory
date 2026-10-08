import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, lstat, readdir, symlink, unlink, cp, chmod } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { hookCommand } from '../lib/codex-runtime.mjs';
import { policyPath } from '../../../integrations/client/automatic-policy.mjs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { fakeAuthServer, secret } from './fake-auth-server.mjs';
import { wireChild } from './http-wire.mjs';
import { readInstallation } from '../runtime/integrations/codex/installed-state.mjs';
import { runInstalled } from '../../../integrations/codex/installed.mjs';
import { resolveClient,clientProjectId,opaqueProjectId } from '../../../integrations/client/pairing.mjs';
import { readControlState,setPaused } from '../../../integrations/client/control-state.mjs';
import { hash } from '../../../integrations/client/common-profile.mjs';
import { cursorPath,readCursor } from '../../../integrations/codex/cursor.mjs';
import { hostedTargetId } from '../../../integrations/client/transport-hosted.mjs';
import { PassThrough } from 'node:stream';

const mcpSecret = 'synthetic-MCP-PAT-different-from-hook-token';
const session = '11111111-1111-4111-8111-111111111111';
const mainURL = new URL('../lib/setup.mjs',import.meta.url).href;
const transportURL = new URL('../lib/transport.mjs',import.meta.url).href;
const wireURL = new URL('./http-wire.mjs',import.meta.url).href;

async function fixture(t,{answers=['100',''],args,config='',hooks,paired=false,claudePolicy=true,claudeInstalled=true,claudeEnabled=true,claudeConfigureFailOnce=false,auth={},state={},
  cliModule=mainURL,nativeBinary,networkSandbox}={}) {
  const ws = createTestWorkspace(t,{prefix:'cx5-install-'});
  const bin = join(ws.path,'bin');await mkdir(bin);
  const home = join(ws.path,'home');await mkdir(home,{mode:0o700});
  const codexHome = join(home,'custom-codex');await mkdir(codexHome,{mode:0o700});
  await writeFile(join(codexHome,'config.toml'),config,{mode:0o600});
  if (hooks) await writeFile(join(codexHome,'hooks.json'),JSON.stringify(hooks),{mode:0o600});
  const statePath = join(ws.path,'state.json'),calls = join(ws.path,'calls.jsonl');
  await writeFile(statePath,JSON.stringify({version:'0.160.1',recordEnv:true,token:mcpSecret,...state}));
  await writeFile(calls,'');
  const source = await readFile(new URL('./fake-codex.mjs',import.meta.url),'utf8');
  const command=nativeBinary ? `import{spawn}from'node:child_process';const child=spawn(${JSON.stringify(networkSandbox)},[${JSON.stringify(nativeBinary)},...process.argv.slice(2)],{stdio:'inherit'});child.on('close',code=>{process.exitCode=code;});` :
    `process.env.FAKE_STATE=${JSON.stringify(statePath)};process.env.FAKE_CALLS=${JSON.stringify(calls)};\n${source}`;
  await writeFile(join(bin,'codex'),`#!${process.execPath}\n${command}`,{mode:0o755});
  const profileRoot = join(home,'.claude/plugins/data/cairn-memory-cairn-memory');
  let originalProjectId;
  if (paired) {
    await mkdir(profileRoot,{recursive:true,mode:0o700});
    // Exercise adoption of Claude's existing (not newly minted) identity.
    originalProjectId=await opaqueProjectId(profileRoot,'/synthetic/project',{home});
    await writeFile(join(bin,'claude'),`#!${process.execPath}\nimport{readFileSync,writeFileSync,writeSync,existsSync,appendFileSync}from'node:fs';
      const args=process.argv.slice(2),path=${JSON.stringify(join(ws.path,'claude-options.json'))};
      appendFileSync(${JSON.stringify(join(ws.path,'claude-calls.jsonl'))},JSON.stringify(args)+'\\n');
      const values=readFileSync(0,'utf8');if(values) {
        writeFileSync(path,values);
        const marker=path+'.configure-failed';if(${claudeConfigureFailOnce} && !existsSync(marker)){writeFileSync(marker,'yes');process.exitCode=1;}
      }
      if(args[1]==='list' && args.includes('--json'))writeSync(1,JSON.stringify(${claudeInstalled}?[{id:'cairn-memory@cairn-memory',scope:'user',enabled:${claudeEnabled},version:${JSON.stringify(claudePolicy?'0.3.2':'0.3.1')}}]:[]));
      else if(args.includes('--json'))writeSync(1,JSON.stringify({configured:['api_token','api_endpoint','pairing_record'],unconfigured:[]}));
    `,{mode:0o755});
  }
  const server = await fakeAuthServer(t,auth);
  const harness = join(ws.path,'harness.mjs');
  const screens = [];
  await writeFile(harness,`const{main}=await import(process.env.CX5_TEST_CLI_MODULE);
    import{requestJSON}from${JSON.stringify(transportURL)};
    import{installChildWire}from${JSON.stringify(wireURL)};
    const disconnect=installChildWire();let clock=0;const answers=${JSON.stringify(answers)};
    process.exitCode=await main(process.argv.slice(2),{interactive:true,prompt:async(_q,o)=>{
      process.stdout.write(JSON.stringify({prompt:true,secret:Boolean(o?.secret)})+'\\n');return answers.shift()??'';},
      browse:async()=>{},authOptions:{now:()=>clock,sleep:async ms=>{clock+=ms;},
        request:(url,options)=>requestJSON(url,{...options,env:{}}),copy:async()=>false,progress:()=>()=>{}}});disconnect();`);
  const env = {HOME:home,CODEX_HOME:codexHome,PATH:bin,LANG:'en_US.UTF-8',TMPDIR:process.env.TMPDIR};
  async function run(flags,{executable=process.execPath,module=cliModule}={}) {
    const child = spawn(executable,[harness,...flags],{cwd:ws.path,env:{...env,CX5_TEST_CLI_MODULE:module},stdio:['ignore','pipe','pipe','ipc']});
    wireChild(child,server.server);
    let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
    const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
    assert.ok(!(stdout+stderr).includes(secret));assert.ok(!(stdout+stderr).includes(mcpSecret));
    screens.push(stdout+stderr);
    return {code,stdout,stderr};
  }
  const result = await run(args??['setup','--client','codex','--endpoint',server.endpoint,'--no-browser','--no-clipboard']);
  const installation = join(codexHome,'cairn/installation.json');
  let installed;try{installed=await readInstallation(installation);}catch{/*failed/read-only install*/}
  const records=()=>readFile(calls,'utf8').then(text=>text.trim().split('\n').filter(Boolean).map(JSON.parse));
  assert.ok(!(await readFile(calls,'utf8')).includes(secret));
  assert.ok(!(await readFile(calls,'utf8')).includes(mcpSecret));
  return {...result,ws,home,codexHome,installation,installed,server,env,bin,profileRoot,originalProjectId,run,records,statePath,screens};
}

test('CX-5 browser credential is saved before ACK; OAuth MCP, private stable runtime and four user hooks',async t=>{
  const unrelated={hooks:{Stop:[{hooks:[{type:'command',command:'echo unrelated'}]}]},other:'keep'};
  const f=await fixture(t,{config:'# preserved\nmodel = "synthetic"\n',hooks:unrelated});
  assert.equal(f.code,0,f.stdout);assert.equal(f.server.grant.state,'delivered');
  assert.equal(f.installed.enabled,true);
  assert.match(f.installed.runtime,/custom-codex\/cairn\/runtime\/0\.3\.0-/);
  const config=await readFile(join(f.codexHome,'config.toml'),'utf8');
  assert.match(config,/^# preserved/);assert.match(config,/\[mcp_servers.cairn\]/);assert.ok(!config.includes(secret));
  assert.ok(!config.includes('Authorization'));assert.match(f.stdout,/codex mcp login cairn/);
  const hooks=JSON.parse(await readFile(join(f.codexHome,'hooks.json'),'utf8'));
  assert.equal(hooks.other,'keep');assert.equal(hooks.hooks.Stop[0].hooks[0].command,'echo unrelated');
  for(const event of ['SessionStart','UserPromptSubmit','Stop','PreCompact']) {
    assert.match(hooks.hooks[event].at(-1).hooks[0].command,/cairn\/runtime/);
    assert.ok(!JSON.stringify(hooks).includes(secret));
  }
  assert.equal((await lstat(join(f.codexHome,'cairn'))).mode&0o777,0o700);
  assert.equal((await lstat(join(f.codexHome,'cairn/credential.json'))).mode&0o777,0o600);
  assert.equal((await lstat(join(f.installed.runtime,'integrations/client/pairing.mjs'))).mode&0o777,0o600);
});

test('CX-5 re-run keeps grant, config, runtime and unrelated hooks; disable/uninstall retain identity and MCP',async t=>{
  const f=await fixture(t);assert.equal(f.code,0,f.stdout);
  const key=await readFile(join(f.installed.root,'project-key'));
  const before=await readFile(join(f.codexHome,'hooks.json'));
  const again=await f.run(['setup','--client','codex','--no-browser']);assert.equal(again.code,0,again.stdout);
  assert.equal(f.server.polls,1);assert.deepEqual(await readFile(join(f.codexHome,'hooks.json')),before);
  const status=await f.run(['status','--client','codex']);assert.equal(status.code,0);assert.match(status.stdout,/registered/);
  const disabled=await f.run(['disable','--client','codex']);assert.equal(disabled.code,0,disabled.stdout);
  assert.equal((await readInstallation(f.installation)).enabled,false);
  assert.deepEqual(JSON.parse(await readFile(join(f.codexHome,'hooks.json'),'utf8')).hooks,{});
  assert.equal((await f.run(['uninstall','--client','codex'])).code,0);
  assert.equal((await f.run(['uninstall','--client','codex'])).code,0);
  assert.deepEqual(await readFile(join(f.installed.root,'project-key')),key);
  assert.match(await readFile(join(f.codexHome,'config.toml'),'utf8'),/mcp_servers.cairn/);
});

test('CX-5 explicit MCP PAT stays separate from memory-scoped hook credential',async t=>{
  const f=await fixture(t,{answers:['100','pat',mcpSecret]});assert.equal(f.code,0,f.stdout);
  const config=await readFile(join(f.codexHome,'config.toml'),'utf8');assert.ok(config.includes(mcpSecret));assert.ok(!config.includes(secret));
  const credential=await readFile(join(f.codexHome,'cairn/credential.json'),'utf8');assert.ok(credential.includes(secret));assert.ok(!credential.includes(mcpSecret));
});

test('CX-5 paired installer adopts Claude key, delivers record and gives both clients the same project id',async t=>{
  const f=await fixture(t,{paired:true,answers:['yes','100','']});assert.equal(f.code,0,f.stdout);
  assert.equal(f.installed.root,f.profileRoot);
  const options=JSON.parse(await readFile(join(f.ws.path,'claude-options.json'),'utf8'));
  assert.equal(options.pairing_record,f.installed.pairingRecord);assert.equal(Object.hasOwn(options,'automatic_memory_policy'),false);
  assert.ok(!Object.hasOwn(options,'api_endpoint'));assert.ok(!Object.hasOwn(options,'api_token'));
  const codex={client:'codex',home:f.home,usesClaude:true,pairingRecord:f.installed.pairingRecord,env:{HOME:f.home}};
  const claude={client:'claude',home:f.home,pairingRecord:f.installed.pairingRecord,env:{HOME:f.home,CLAUDE_PLUGIN_DATA:f.profileRoot}};
  assert.equal((await resolveClient(codex)).enabled,true);assert.equal((await resolveClient(claude)).enabled,true);
  assert.equal(await clientProjectId(codex,'/synthetic/project'),f.originalProjectId);
  assert.equal(await clientProjectId(claude,'/synthetic/project'),f.originalProjectId);
  const again=await f.run(['setup','--client','codex','--no-browser']);assert.equal(again.code,0,again.stdout);
  assert.equal(f.server.polls,1);assert.deepEqual(JSON.parse(await readFile(join(f.ws.path,'claude-options.json'),'utf8')),options);
});
for (const options of [{claudePolicy:false},{claudeInstalled:false},{claudeEnabled:false}]) {
  test('CX-5 missing/old/disabled Claude plugin chooses standalone without changing Claude '+JSON.stringify(options),async t=>{
    const f=await fixture(t,{paired:true,...options});
    assert.equal(f.code,0,f.stdout);assert.equal(f.installed.usesClaude,false);assert.equal(f.installed.pairingRecord,null);
    assert.match(f.stdout,/standalone/);assert.equal(f.installed.root,join(f.codexHome,'cairn-standalone'));
    const claude={client:'claude',home:f.home,env:{HOME:f.home,CLAUDE_PLUGIN_DATA:f.profileRoot}};
    assert.equal((await resolveClient(claude)).enabled,true);
    assert.equal(await clientProjectId(claude,'/synthetic/project'),f.originalProjectId);
    await assert.rejects(readFile(join(f.ws.path,'claude-options.json')),error=>error.code==='ENOENT');
    const calls=(await readFile(join(f.ws.path,'claude-calls.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(!calls.some(args=>args.includes('update') || args.includes('enable') || args.includes('--values-stdin')));
    assert.equal((await f.run(['setup','--client','codex','--no-browser'])).code,0);
  });
}

async function upgradedModule(f) {
  const packageDir=join(f.ws.path,'upgraded-package');await cp(new URL('../',import.meta.url),packageDir,{recursive:true});
  const entry=join(packageDir,'runtime/integrations/codex/entry.mjs');
  await writeFile(entry,(await readFile(entry,'utf8'))+'\n// synthetic upgraded digest\n');
  const manifestFile=join(packageDir,'runtime/manifest.json');const manifest=JSON.parse(await readFile(manifestFile,'utf8'));
  manifest.files['integrations/codex/entry.mjs']=createHash('sha256').update(await readFile(entry)).digest('hex');
  await writeFile(manifestFile,JSON.stringify(manifest,null,2)+'\n');
  return pathToFileURL(join(packageDir,'lib/setup.mjs')).href;
}

for (const upgrade of ['node','runtime']) {
  test('CX-5 failed '+upgrade+' reauthorization retains old installation; uninstall removes all Cairn digests',async t=>{
    const auth={};const f=await fixture(t,{auth});assert.equal(f.code,0,f.stdout);
    const before=await readFile(f.installation);auth.createStatus=404;
    let module=mainURL,executable=process.execPath;
    if (upgrade==='node') executable=process.execPath.includes('v22.')?
      '/home/chichieh/.nvm/versions/node/v24.15.0/bin/node':'/home/chichieh/.nvm/versions/node/v22.16.0/bin/node';
    else module=await upgradedModule(f);
    const failed=await f.run(['setup','--client','codex','--no-browser','--reauthorize'],{module,executable});
    assert.equal(failed.code,1,failed.stdout);assert.deepEqual(await readFile(f.installation),before);
    // Include stale handlers from earlier registrations, with a different runtime
    // and node path. A current-config-only cleanup would leave these behind.
    const hookFile=join(f.codexHome,'hooks.json');const hooks=JSON.parse(await readFile(hookFile,'utf8'));
    for(const event of ['SessionStart','UserPromptSubmit','Stop','PreCompact']) {
      hooks.hooks[event].push({hooks:[{type:'command',command:hookCommand({...f.installed,node:'/synthetic/old-node',
        runtime:'/synthetic/older-runtime-digest'},f.installation,event),statusMessage:'Cairn automatic memory'}]});
    }
    hooks.hooks.Stop.push({hooks:[{type:'command',command:'echo unrelated'}]});await writeFile(hookFile,JSON.stringify(hooks),{mode:0o600});
    assert.equal((await f.run(['uninstall','--client','codex'])).code,0);
    assert.deepEqual(JSON.parse(await readFile(hookFile,'utf8')).hooks,{Stop:[{hooks:[{type:'command',command:'echo unrelated'}]}]});
    await assert.rejects(readFile(policyPath(f.installed.root,f.installed.endpoint)),error=>error.code==='ENOENT');
  });
}

test('CX-5 successful new digest replaces every old registration and rerun remains idempotent',async t=>{
  const f=await fixture(t);assert.equal(f.code,0,f.stdout);
  const hookFile=join(f.codexHome,'hooks.json');const hooks=JSON.parse(await readFile(hookFile,'utf8'));
  for(const event of ['SessionStart','UserPromptSubmit','Stop','PreCompact']) {
    hooks.hooks[event].push({hooks:[{type:'command',command:hookCommand({...f.installed,node:'/synthetic/old-node',
      runtime:'/synthetic/older-runtime-digest'},f.installation,event)}]});
  }
  await writeFile(hookFile,JSON.stringify(hooks),{mode:0o600});
  const module=await upgradedModule(f);
  assert.equal((await f.run(['setup','--client','codex','--no-browser'],{module})).code,0);
  assert.notEqual((await readInstallation(f.installation)).runtime,f.installed.runtime);
  const actual=JSON.parse(await readFile(hookFile,'utf8'));
  for(const event of ['SessionStart','UserPromptSubmit','Stop','PreCompact']) assert.equal(actual.hooks[event].length,1);
  assert.equal((await f.run(['setup','--client','codex','--no-browser'],{module})).code,0);
  assert.deepEqual(JSON.parse(await readFile(hookFile,'utf8')),actual);
});

for(const content of ['{',JSON.stringify({version:2,dailyCap:100,concurrency:2})]) {
  test('CX-5 Codex pause/status remain available with a malformed or future policy '+content,async t=>{
    const f=await fixture(t);assert.equal(f.code,0,f.stdout);
    await writeFile(policyPath(f.installed.root,f.installed.endpoint),content,{mode:0o600});
    const paused=await f.run(['pause','--client','codex']);assert.equal(paused.code,0,paused.stdout);
    assert.equal((await readControlState(f.installed.root)).paused,true);
    const status=await f.run(['status','--client','codex']);assert.equal(status.code,0);assert.match(status.stdout,/policy_invalid_or_unreadable/);
    assert.equal((await f.run(['uninstall','--client','codex'])).code,0);
    await assert.rejects(readFile(policyPath(f.installed.root,f.installed.endpoint)),error=>error.code==='ENOENT');
  });
}

for(const args of [['status','--client','codex'],['setup','--client','codex','--dry-run']]) {
  test('CX-5 '+args.join(' ')+' is offline and does not authorize or install hooks',async t=>{
    const f=await fixture(t,{args});assert.equal(f.code,0,f.stdout);assert.equal(f.server.requests.length,0);
    assert.equal(f.installed,undefined);assert.equal(await readFile(join(f.codexHome,'config.toml'),'utf8'),'');
  });
}
test('CX-5 unsupported browser auth never falls back to a broad PAT for hooks',async t=>{
  const f=await fixture(t,{auth:{createStatus:404}});assert.equal(f.code,1);assert.equal(f.installed,undefined);
  assert.match(f.stdout,/memory-scoped browser/);assert.equal(f.server.polls,0);
});

async function memoryRuntime(t,options={}) {
  const f=await fixture(t,options);assert.equal(f.code,0,f.stdout);
  const path=join(f.ws.path,'synthetic.jsonl');
  const text=await readFile(new URL('../../../integrations/codex/test/fixtures/primary-0.160.1.jsonl',import.meta.url),'utf8');
  await writeFile(path,text);
  const project='/synthetic/project',requests=[];
  const projectId=await clientProjectId({client:'codex',home:f.home,root:f.installed.root,
    usesClaude:f.installed.usesClaude,pairingRecord:f.installed.pairingRecord??undefined,env:{HOME:f.home}},project);
  let pause={paused:false,generation:0,enforced:true},capture={duplicate:false,memoryCount:1},recall={memories:[]},delay;
  const original=globalThis.fetch;
  globalThis.fetch=async(url,wire)=>{
    assert.equal(wire.headers.authorization,'Bearer '+secret);assert.equal(wire.redirect,'error');
    assert.ok(!JSON.stringify(process.env).includes(secret));
    const route=new URL(url).pathname;
    const body=wire.body?JSON.parse(wire.body):null;
    requests.push({route,body});
    if(delay)await delay(route,wire);
    if(route.endsWith('pause-state'))return Response.json(pause);
    if(route.endsWith('capture'))return Response.json(capture,{status:capture.error?429:200});
    if(route.endsWith('recall'))return Response.json(recall);
    assert.fail('unapproved route '+route);
  };
  f.ws.defer(()=>{globalThis.fetch=original;});
  let handoff;
  const invoke=async(event,extras={},launch)=>{
    const stream=new PassThrough();stream.end(JSON.stringify(event==='worker'?handoff:{hook_event_name:event,
      session_id:session,cwd:project,transcript_path:path,...extras}));
    return runInstalled(f.installation,event,stream,{signal:AbortSignal.timeout(event==='worker'?60000:2000),
      contextQualification:()=>true, // exercise the port; production A7 remains closed
      launch:launch??(async(_p,_c,content)=>{handoff=JSON.parse(content);})});
  };
  return {...f,path,project,projectId,requests,invoke,handoff:()=>handoff,pause:value=>{pause=value;},
    capture:value=>{capture=value;},recall:value=>{recall=value;},delay:value=>{delay=value;},
    cursor:()=>readCursor(cursorPath(f.installed.root,hostedTargetId(f.installed),session))};
}

test('CX-5 fake host lifecycle: Stop/PreCompact capture canonical redacted text, never mirrors/tools/hooks/summary',async t=>{
  const f=await memoryRuntime(t);
  assert.equal(await f.invoke('Stop'),'{}');assert.ok(f.handoff());
  assert.ok(!JSON.stringify(f.handoff()).includes('Prefer diagrams'));assert.ok(!JSON.stringify(f.handoff()).includes(secret));
  await f.invoke('worker');
  const captures=f.requests.filter(r=>r.route.endsWith('/capture'));assert.equal(captures.length,1);
  assert.equal(captures[0].body.client,'codex');assert.equal(captures[0].body.session_id,hash('wire-session-v1','codex',session));
  assert.deepEqual(captures[0].body.messages.map(m=>m.content),['Prefer diagrams.','Understood.']);
  assert.ok(!JSON.stringify(captures).includes('CANARY'));assert.ok(!(await f.cursor()).pending);
  const user={type:'event_msg',payload:{type:'item_completed',thread_id:session,turn_id:'turn-2',
    item:{type:'UserMessage',id:'user-2',content:[{type:'text',text:'Prefer tests. sk-'+ 'x'.repeat(36),text_elements:[]}]}}};
  await writeFile(f.path,JSON.stringify(user)+'\n',{flag:'a'});
  await f.invoke('PreCompact');await f.invoke('worker');
  assert.equal(f.requests.filter(r=>r.route.endsWith('/capture')).length,2);
  assert.ok(!JSON.stringify(f.requests).includes('sk-'+ 'x'.repeat(36)));
});

test('CX-5 prompt recall injects receipt framing and shares project identity without reading transcript',async t=>{
  const f=await memoryRuntime(t);
  f.recall({memories:[{id:'12345678-1234-4234-8234-123456789abc',content:'Prefer diagrams.',kind:'preference',
    scope:'project',projectId:f.projectId,origin:'explicit',confidence:1,createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',
    receipts:[{client:'claude-code',sessionId:'s',eventId:'e',role:'user',excerpt:'I prefer diagrams.',createdAt:'2026-10-01T00:00:00Z'}]}]});
  const output=await f.invoke('UserPromptSubmit',{prompt:'Recall my preference sk-'+ 'x'.repeat(36),transcript_path:null});
  const context=JSON.parse(output).hookSpecificOutput;
  assert.equal(context.hookEventName,'UserPromptSubmit');assert.match(context.additionalContext,/untrusted source-attributed recollections/);
  assert.match(context.additionalContext,/"client":"claude-code"/);assert.match(context.additionalContext,/"receipts":/);
  const recall=f.requests.find(r=>r.route.endsWith('/recall'));assert.ok(recall);assert.ok(!recall.body.query.includes('sk-'));
  assert.equal(recall.body.session_id,hash('wire-session-v1','codex',session));
  assert.equal(await f.cursor(),null);
});

test('CX-5 host upgrade refuses before fetching pause state or reading capture source',async t=>{
  const f=await memoryRuntime(t);
  const state=JSON.parse(await readFile(f.statePath,'utf8'));state.version='0.160.2';await writeFile(f.statePath,JSON.stringify(state));
  assert.equal(await f.invoke('Stop'),'');assert.equal(f.requests.length,0);assert.equal(await f.cursor(),null);
});

test('CX-5 hosted pause/resume generation sets durable EOF; local pause is preserved',async t=>{
  const f=await memoryRuntime(t);
  await f.invoke('Stop');await f.invoke('worker');
  f.pause({paused:true,generation:1,enforced:true});assert.equal(await f.invoke('Stop'),'{}');await f.invoke('worker');
  f.pause({paused:false,generation:1,enforced:true});
  await f.invoke('SessionStart');const boundary=await f.cursor();assert.equal(boundary.status,'pause_boundary');
  assert.equal(boundary.offset,(await lstat(f.path)).size);
  await setPaused(f.installed.root,true);
  f.pause({paused:false,generation:2,enforced:true});await f.invoke('SessionStart');
  assert.equal((await readControlState(f.installed.root)).paused,true);
  assert.equal(f.requests.filter(r=>r.route.endsWith('/capture')).length,1);
});

test('CX-5 missing/unenforced/regressing hosted pause state and unknown transcript fail closed',async t=>{
  const f=await memoryRuntime(t);f.pause({paused:false,generation:0,enforced:false});
  await f.invoke('Stop');await assert.rejects(()=>f.invoke('worker'),/pause_unavailable/);assert.ok((await f.cursor()).pending);
  f.pause({paused:false,generation:0,enforced:true});
  const text=await readFile(f.path,'utf8');await writeFile(f.path,text.replace('"cli_version":"0.160.1"','"cli_version":"0.160.2"'));
  await f.invoke('Stop');assert.equal((await f.cursor()).status,'unsupported_format');
  assert.equal(f.requests.filter(r=>r.route.endsWith('/capture')).length,0);
});

test('CX-5 processing/quota preserve the frozen range and never acknowledge text',async t=>{
  const f=await memoryRuntime(t);f.capture({duplicate:false,memoryCount:0,processing:true});
  await f.invoke('Stop');await f.invoke('worker');const processing=await f.cursor();assert.ok(processing.pending);
  const first=f.requests.find(r=>r.route.endsWith('/capture')).body;
  f.capture({error:'quota_reached'});await f.invoke('worker');const refused=await f.cursor();assert.ok(refused.pending);
  assert.equal(refused.status,'quota_reached');
  const captures=f.requests.filter(r=>r.route.endsWith('/capture'));assert.deepEqual(captures[1].body,first);
});

test('CX-5 production launcher sends only closed stdin handoff; child env and discarded streams contain no hook token',async t=>{
  const f=await memoryRuntime(t);
  const poisoned=['CLAUDE_PLUGIN_OPTION_API_TOKEN','NODE_OPTIONS','HTTPS_PROXY'];
  const inheritedSecret='synthetic-foreign-host-environment-secret';
  const prior=Object.fromEntries(poisoned.map(key=>[key,process.env[key]]));
  for(const key of poisoned)process.env[key]=inheritedSecret;
  f.ws.defer(()=>{for(const key of poisoned){if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}});
  // A fake worker records the actual launcher pipe/environment, then emits
  // hostile stdout/stderr. Parent output must remain the Stop schema's {}.
  const runtime=join(f.ws.path,'fake-worker');await mkdir(join(runtime,'integrations/codex'),{recursive:true});
  const record=join(f.ws.path,'worker.json');
  await writeFile(join(runtime,'integrations/codex/entry.mjs'),`import{readFileSync,writeFileSync}from'node:fs';
    const input=readFileSync(0,'utf8');writeFileSync(${JSON.stringify(record)},JSON.stringify({args:process.argv,env:process.env,input}));
    process.stdout.write(${JSON.stringify(secret)});process.stderr.write(${JSON.stringify(secret)});`);
  await writeFile(f.installation,JSON.stringify({...f.installed,runtime}),{mode:0o600});
  const stream=new PassThrough();stream.end(JSON.stringify({hook_event_name:'Stop',session_id:session,cwd:f.project,transcript_path:f.path,
    last_assistant_message:secret,irrelevant:secret}));
  assert.equal(await runInstalled(f.installation,'Stop',stream,{signal:AbortSignal.timeout(2000)}),'{}');
  let value;
  for(let i=0;i<40;i++) {try{value=JSON.parse(await readFile(record,'utf8'));break;}catch{await new Promise(r=>setTimeout(r,25));}}
  assert.ok(value);assert.ok(!JSON.stringify(value).includes(secret));assert.ok(!JSON.stringify(value).includes(inheritedSecret));
  assert.deepEqual(Object.keys(JSON.parse(value.input)).sort(),['byteEnd','client','cwd','endIntent','generation','parser','path','sessionId'].sort());
  assert.ok(!value.env.NODE_OPTIONS);assert.ok(!value.env.CLAUDE_PLUGIN_OPTION_API_TOKEN);
  assert.ok(!value.env.HTTPS_PROXY);
});

test('CX-5 entry exits 0 with no stderr for missing config',async t=>{
  for(const event of ['Stop','UserPromptSubmit']) {
    const entry=new URL('../../../integrations/codex/entry.mjs',import.meta.url);
    const child=spawn(process.execPath,[entry.pathname,'/synthetic/missing-installation.json',event],{
      env:{PATH:process.env.PATH,HOME:process.env.TMPDIR??'/tmp'},stdio:['pipe','pipe','pipe']});
    let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);
    const code=await new Promise(resolve=>child.on('close',resolve));assert.equal(code,0);assert.equal(err,'');
    assert.equal(out,event==='Stop'?'{}':'');
  }
});

test('CX-5 installed entry bounds an open stdin pipe with no input and exits 0',async t=>{
  const f=await fixture(t);assert.equal(f.code,0,f.stdout);
  const entry=join(f.installed.runtime,'integrations/codex/entry.mjs');
  const started=performance.now();
  const child=spawn(process.execPath,[entry,f.installation,'Stop'],{
    env:f.env,stdio:['pipe','pipe','pipe']});
  let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);
  const code=await new Promise(resolve=>child.on('close',resolve));
  assert.equal(code,0);assert.equal(out,'{}');assert.equal(err,'');assert.ok(performance.now()-started<1200);
});
test('CX-5 registered command clears inherited secrets and Node preloads before the first Node process',async t=>{
  const f=await fixture(t);assert.equal(f.code,0,f.stdout);
  const state=JSON.parse(await readFile(f.statePath,'utf8'));state.version='0.160.2';await writeFile(f.statePath,JSON.stringify(state));
  const marker=join(f.ws.path,'preload-ran'),preload=join(f.ws.path,'host-preload.mjs');
  await writeFile(preload,`import{writeFileSync,writeSync}from'node:fs';writeFileSync(${JSON.stringify(marker)},'ran');writeSync(1,'PRELOAD_CANARY');`);
  const hooks=JSON.parse(await readFile(join(f.codexHome,'hooks.json'),'utf8'));
  const command=hooks.hooks.Stop[0].hooks[0].command;
  const child=spawn('/bin/sh',['-c',command],{env:{...f.env,NODE_OPTIONS:'--import='+preload,
    CLAUDE_PLUGIN_OPTION_API_TOKEN:'foreign-environment-secret',HTTPS_PROXY:'foreign-proxy-secret'},stdio:['pipe','pipe','pipe']});
  let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);
  child.stdin.end('{}');assert.equal(await new Promise(resolve=>child.on('close',resolve)),0);
  assert.equal(out,'{}');assert.equal(err,'');
  await assert.rejects(readFile(marker),error=>error.code==='ENOENT');
  const version=(await f.records()).at(-1);assert.ok(!version.env.NODE_OPTIONS);assert.ok(!version.env.HTTPS_PROXY);
  assert.ok(!version.env.CLAUDE_PLUGIN_OPTION_API_TOKEN);
});
test('CX-5 cached host handler stays silent and exits 0 after its runtime entry is uninstalled',async t=>{
  const f=await fixture(t);assert.equal(f.code,0,f.stdout);
  const hooks=JSON.parse(await readFile(join(f.codexHome,'hooks.json'),'utf8'));
  await unlink(join(f.installed.runtime,'integrations/codex/entry.mjs'));
  const child=spawn('/bin/sh',['-c',hooks.hooks.Stop[0].hooks[0].command],{env:f.env,stdio:['pipe','pipe','pipe']});
  let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.stdin.end('{}');
  assert.equal(await new Promise(resolve=>child.on('close',resolve)),0);assert.equal(out,'');assert.equal(err,'');
});
test('CX-5 default installed prompt hook keeps A7 closed even with valid context schema',async t=>{
  const f=await memoryRuntime(t);
  const stream=new PassThrough();stream.end(JSON.stringify({hook_event_name:'UserPromptSubmit',session_id:session,
    cwd:f.project,transcript_path:null,prompt:'Preferences?',contextQualification:true}));
  assert.equal(await runInstalled(f.installation,'UserPromptSubmit',stream,{signal:AbortSignal.timeout(2000)}),'');
  assert.equal(f.requests.length,0);
});

test('CX-5 remote generation change between recall fetch and injection withholds context',async t=>{
  const f=await memoryRuntime(t);
  f.recall({memories:[{id:'12345678-1234-4234-8234-123456789abc',content:'Prefer diagrams.',kind:'preference',
    scope:'personal',projectId:null,origin:'explicit',confidence:1,createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',
    receipts:[{client:'claude-code',sessionId:'s',eventId:'e',role:'user',excerpt:'I prefer diagrams.',createdAt:'2026-10-01T00:00:00Z'}]}]});
  f.delay(async route=>{if(route.endsWith('/recall'))f.pause({paused:false,generation:1,enforced:true});});
  assert.equal(await f.invoke('UserPromptSubmit',{prompt:'Preferences?',transcript_path:null}),'');
  assert.equal(f.requests.filter(r=>r.route.endsWith('/recall')).length,1);
  f.pause({paused:false,generation:0,enforced:true});
  await assert.rejects(f.invoke('SessionStart'),/pause_unavailable/);
  assert.equal(f.requests.filter(r=>r.route.endsWith('/capture')).length,0);
});

test('CX-5 slow recall consumes one 2 second budget and never injects late context',async t=>{
  const f=await memoryRuntime(t);
  f.delay(async(route,wire)=>{
    if(route.endsWith('/recall'))await new Promise((resolve,reject)=>{
      const timeout=setTimeout(resolve,3000);
      wire.signal.addEventListener('abort',()=>{clearTimeout(timeout);reject(wire.signal.reason);},{once:true});
    });
  });
  const started=performance.now();
  assert.equal(await f.invoke('UserPromptSubmit',{prompt:'Preferences?',transcript_path:null}),'');
  assert.ok(performance.now()-started<2400);
  assert.equal(f.requests.filter(r=>r.route.endsWith('/recall')).length,1);
});

if(process.env.CX5_PACKED_PACKAGE) test('CX-5 packed installer installs with no repository-relative runtime imports',async t=>{
  const cliModule=pathToFileURL(join(process.env.CX5_PACKED_PACKAGE,'lib/setup.mjs')).href;
  const f=await fixture(t,{cliModule});assert.equal(f.code,0,f.stdout);assert.equal(f.installed.enabled,true);
  const status=await f.run(['status','--client','codex']);assert.equal(status.code,0);assert.match(status.stdout,/registered/);
});

if(process.env.CX5_NATIVE_BINARY && process.env.CX5_NETWORK_SANDBOX) test('CX-5 real 0.160.1 offline installer and native user hook registry',async t=>{
  const f=await fixture(t,{nativeBinary:process.env.CX5_NATIVE_BINARY,networkSandbox:process.env.CX5_NETWORK_SANDBOX});
  assert.equal(f.code,0,f.stdout);assert.equal(f.installed.enabled,true);
  const child=spawn(process.env.CX5_NETWORK_SANDBOX,[process.env.CX5_NATIVE_BINARY,'app-server'],{
    cwd:f.home,env:f.env,stdio:['pipe','pipe','pipe']});
  f.ws.defer(()=>{child.kill('SIGKILL');});
  const waiters=new Map();let text='',sequence=0,stderr='';
  child.stderr.on('data',chunk=>{stderr+=chunk;if(stderr.length>65536)child.kill('SIGKILL');});
  child.stdout.on('data',chunk=>{
    text+=chunk;let boundary;
    while((boundary=text.indexOf('\n'))!==-1){const item=JSON.parse(text.slice(0,boundary));text=text.slice(boundary+1);
      const waiter=waiters.get(item.id);if(waiter){waiters.delete(item.id);item.error?waiter.reject(new Error('native_rpc_error')):waiter.resolve(item.result);}}
  });
  const request=(method,params)=>new Promise((resolve,reject)=>{
    const id=++sequence;const timer=setTimeout(()=>reject(new Error('native_rpc_timeout')),7000);
    waiters.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
    child.stdin.write(JSON.stringify({id,method,params})+'\n');
  });
  await request('initialize',{clientInfo:{name:'cx5-offline-installer','version':'1'},capabilities:{experimentalApi:true}});
  child.stdin.write('{"method":"initialized"}\n');
  const result=await request('hooks/list',{cwds:[f.home]});
  const hooks=result.data[0].hooks;
  assert.deepEqual(hooks.map(hook=>hook.eventName).sort(),['preCompact','sessionStart','stop','userPromptSubmit']);
  for(const hook of hooks){assert.equal(hook.source,'user');assert.equal(hook.enabled,true);assert.equal(hook.trustStatus,'untrusted');
    assert.equal(hook.statusMessage,'Cairn automatic memory');assert.ok(!hook.command.includes(secret));
    assert.equal(hook.timeoutSec,['stop','preCompact'].includes(hook.eventName)?1:3);
    if(['sessionStart','userPromptSubmit'].includes(hook.eventName))assert.equal(hook.additionalContextLimit,0);
  }
  if(process.env.CX5_NATIVE_EVIDENCE)await writeFile(process.env.CX5_NATIVE_EVIDENCE,JSON.stringify(result,null,2)+'\n',{mode:0o600});
  child.stdin.end();const exit=await new Promise(resolve=>child.on('close',resolve));assert.equal(exit,0);
  assert.ok(!stderr.includes(secret));
});

for (const event of ['Stop','PreCompact']) test('CX-5 '+event+' launches without waiting for slow hosted pause; worker keeps pending cursor',async t=>{
  const f=await memoryRuntime(t);
  f.delay(async(route,wire)=>{if(route.endsWith('/pause-state')) await new Promise((resolve,reject)=>{
    const timer=setTimeout(resolve,1100);wire.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(wire.signal.reason);},{once:true});
  });});
  const started=performance.now();assert.equal(await f.invoke(event),'{}');assert.ok(performance.now()-started<750);
  assert.equal(f.requests.length,0);assert.ok(f.handoff());assert.ok((await f.cursor()).pending);
  f.pause({paused:false,generation:0,enforced:false});
  await assert.rejects(f.invoke('worker'),/pause_unavailable/);
  assert.equal(f.requests.filter(r=>r.route.endsWith('/capture')).length,0);assert.ok((await f.cursor()).pending);
});


test('CX-5 first paired browser failure never publishes an identity or changes Claude memory',async t=>{
  const f=await fixture(t,{paired:true,answers:['yes','100'],auth:{createStatus:404}});
  assert.equal(f.code,1);assert.equal(f.installed,undefined);
  await assert.rejects(readFile(join(f.ws.path,'claude-options.json')),error=>error.code==='ENOENT');
  const claude={client:'claude',home:f.home,env:{HOME:f.home,CLAUDE_PLUGIN_DATA:f.profileRoot}};
  assert.equal((await resolveClient(claude)).enabled,true);
  assert.equal(await clientProjectId(claude,'/synthetic/project'),f.originalProjectId);
  await assert.rejects(readFile(join(f.home,'.cairn-memory-clients/pairing.json')),error=>error.code==='ENOENT');
});

test('CX-5 partial native pairing delivery is visible and a rerun finishes the same identity',async t=>{
  const f=await fixture(t,{paired:true,answers:['yes','100',''],claudeConfigureFailOnce:true});
  assert.equal(f.code,1);assert.match(f.stdout,/pairing is pending/);assert.equal(f.installed.enabled,false);
  const options=JSON.parse(await readFile(join(f.ws.path,'claude-options.json'),'utf8'));
  const claude={client:'claude',home:f.home,pairingRecord:options.pairing_record,env:{HOME:f.home,CLAUDE_PLUGIN_DATA:f.profileRoot}};
  assert.equal((await resolveClient(claude)).enabled,false);
  const again=await f.run(['setup','--client','codex','--no-browser']);assert.equal(again.code,0,again.stdout);
  assert.equal((await resolveClient(claude)).enabled,true);
  assert.equal(await clientProjectId(claude,'/synthetic/project'),f.originalProjectId);
  assert.equal((await readInstallation(f.installation)).pairingRecord,f.installed.pairingRecord);
});


test('CX-5 fresh standalone Codex never claims a future Claude default root',async t=>{
  const f=await fixture(t);assert.equal(f.code,0,f.stdout);
  assert.equal(f.installed.root,join(f.codexHome,'cairn-standalone'));
  const codex={client:'codex',home:f.home,root:f.installed.root,isolatedCodex:true,usesClaude:false,env:{HOME:f.home}};
  const before=await clientProjectId(codex,'/synthetic/project');
  const claude={client:'claude',home:f.home,env:{HOME:f.home}};
  const resolved=await resolveClient(claude);assert.equal(resolved.enabled,true);assert.notEqual(resolved.root,f.installed.root);
  assert.notEqual(await clientProjectId(claude,'/synthetic/project'),before);
  assert.equal((await f.run(['setup','--client','codex','--no-browser'])).code,0);
  assert.equal(await clientProjectId(codex,'/synthetic/project'),before);
});
