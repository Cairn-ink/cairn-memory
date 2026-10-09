import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, appendFile, mkdir, lstat, readdir, symlink, unlink, cp, chmod } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { translator } from '../lib/messages.mjs';
import { supportsClaudePairing, CLAUDE_PAIRING_MINIMUM } from '../lib/codex-runtime.mjs';
import { hookCommand } from '../lib/codex-runtime.mjs';
import { policyPath, rotateAutomaticBoundary } from '../../../integrations/client/automatic-policy.mjs';
import { recallContext } from '../../../integrations/codex/hosted-lifecycle.mjs';
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
import { binaryIdentity } from '../../../integrations/codex/qualification.mjs';
import { fileURLToPath } from 'node:url';

const mcpSecret = 'synthetic-MCP-PAT-different-from-hook-token';
const session = '11111111-1111-4111-8111-111111111111';
const mainURL = new URL('../lib/setup.mjs',import.meta.url).href;
const transportURL = new URL('../lib/transport.mjs',import.meta.url).href;
const wireURL = new URL('./http-wire.mjs',import.meta.url).href;

async function fixture(t,{answers=['100',''],args,config='',hooks,paired=false,claudePolicy=true,claudeInstalled=true,claudeEnabled=true,claudeConfigureFailOnce=false,claudeVersion,auth={},state={},
  cliModule=mainURL,nativeBinary,networkSandbox}={}) {
  const ws = createTestWorkspace(t,{prefix:'cx5-install-'});
  const bin = join(ws.path,'bin');await mkdir(bin);
  const home = join(ws.path,'home');await mkdir(home,{mode:0o700});
  const codexHome = join(home,'custom-codex');await mkdir(codexHome,{mode:0o700});
  await writeFile(join(codexHome,'config.toml'),config,{mode:0o600});
  if (hooks) await writeFile(join(codexHome,'hooks.json'),JSON.stringify(hooks),{mode:0o600});
  const statePath = join(ws.path,'state.json'),calls = join(ws.path,'calls.jsonl');
  await writeFile(statePath,JSON.stringify({version:'0.160.1',formatEvidence:fileURLToPath(new URL('../../../integrations/codex/test/fixtures/',import.meta.url)),recordEnv:true,token:mcpSecret,...state}));
  await writeFile(calls,'');
  const source = await readFile(new URL('./fake-codex.mjs',import.meta.url),'utf8');
  const command=nativeBinary ? `import{spawn}from'node:child_process';const child=spawn(${JSON.stringify(networkSandbox)},[${JSON.stringify(nativeBinary)},...process.argv.slice(2)],{stdio:'inherit'});child.on('close',code=>{process.exitCode=code;});` :
    `process.env.FAKE_STATE=${JSON.stringify(statePath)};process.env.FAKE_CALLS=${JSON.stringify(calls)};\n${source}`;
  // Freeze native-shaped schema/serde strings in this fake executable so the
  // production format collector (rather than a version-only seam) decides.
  const evidence=JSON.parse(await readFile(new URL('../../../integrations/codex/test/fixtures/binary-0.160.1/format.json',import.meta.url)));
  const embedded='\n/*\n'+Object.values(evidence.hooks).map(value=>JSON.stringify(value,null,2)).join('\n')+'\n'+evidence.serdeMarkers.join('\n')+'\n*/\n';
  await writeFile(join(bin,'codex'),`#!${process.execPath}\n${command}${nativeBinary?'':embedded}`,{mode:0o755});
  const profileRoot = join(home,'.claude/plugins/data/cairn-memory-cairn-memory');
  let originalProjectId;const claudeState=join(ws.path,'claude-state.json');
  await writeFile(claudeState,JSON.stringify({installed:claudeInstalled,enabled:claudeEnabled,version:claudeVersion??(claudePolicy?'0.3.2':'0.1.1')}));
  if (paired) {
    await mkdir(profileRoot,{recursive:true,mode:0o700});
    // Exercise adoption of Claude's existing (not newly minted) identity.
    originalProjectId=await opaqueProjectId(profileRoot,'/synthetic/project',{home});
    await writeFile(join(bin,'claude'),`#!${process.execPath}\nimport{readFileSync,writeFileSync,writeSync,existsSync,appendFileSync}from'node:fs';
      const args=process.argv.slice(2),path=${JSON.stringify(join(ws.path,'claude-options.json'))};
      appendFileSync(${JSON.stringify(join(ws.path,'claude-calls.jsonl'))},JSON.stringify(args)+'\\n');
      const state=JSON.parse(readFileSync(${JSON.stringify(claudeState)},'utf8'));
      const values=readFileSync(0,'utf8');if(values) {
        writeFileSync(path,values);
        const marker=path+'.configure-failed';if(${claudeConfigureFailOnce} && !existsSync(marker)){writeFileSync(marker,'yes');process.exitCode=1;}
      }
      if(args[1]==='list' && args.includes('--json'))writeSync(1,JSON.stringify(state.installed?[{id:'cairn-memory@cairn-memory',scope:'user',enabled:state.enabled,version:state.version}]:[]));
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
  async function run(flags,{executable=process.execPath,module=cliModule,envOverrides={}}={}) {
    const child = spawn(executable,[harness,...flags],{cwd:ws.path,env:{...env,...envOverrides,CX5_TEST_CLI_MODULE:module},stdio:['ignore','pipe','pipe','ipc']});
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
  const host={identity:await binaryIdentity(join(bin,'codex')),binaryPath:join(bin,'codex'),kind:'cli'};
  const detectHost=async()=>host;
  return {...result,detectHost,host,ws,home,codexHome,installation,installed,server,env,bin,profileRoot,originalProjectId,run,records,statePath,claudeState,screens};
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
    if (upgrade==='node') {
      // CI needs only the running Node. The second executable has a genuinely
      // different execPath, using a fake node shim that preserves IPC/stdio.
      executable=join(f.ws.path,'second-node');
      await writeFile(executable,`#!${process.execPath}\nimport{pathToFileURL}from'node:url';import{writeFileSync}from'node:fs';
        Object.defineProperty(process,'execPath',{value:import.meta.filename});
        writeFileSync(${JSON.stringify(join(f.ws.path,'second-node-used'))},process.execPath);
        process.argv.splice(1,1);await import(pathToFileURL(process.argv[1]).href);`,{mode:0o700});
    }
    else module=await upgradedModule(f);
    const failed=await f.run(['setup','--client','codex','--no-browser','--reauthorize'],{module,executable});
    assert.equal(failed.code,1,failed.stdout);assert.deepEqual(await readFile(f.installation),before);
    if(upgrade==='node')assert.equal(await readFile(join(f.ws.path,'second-node-used'),'utf8'),executable);
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
      detectHost:f.detectHost, // fixture process ancestry; production format cache decides
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
  const state=JSON.parse(await readFile(f.statePath,'utf8'));state.version='0.162.0';await writeFile(f.statePath,JSON.stringify(state));
  await appendFile(f.host.binaryPath,'\n// binary upgraded\n');f.host.identity=await binaryIdentity(f.host.binaryPath);
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
  const cursor=await f.cursor();await f.invoke('Stop');assert.deepEqual(await f.cursor(),cursor);
  // Missing creator qualification is retryable and preserves the frozen range.
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
  assert.equal(await runInstalled(f.installation,'Stop',stream,{signal:AbortSignal.timeout(2000),detectHost:f.detectHost}),'{}');
  let value;
  for(let i=0;i<40;i++) {try{value=JSON.parse(await readFile(record,'utf8'));break;}catch{await new Promise(r=>setTimeout(r,25));}}
  assert.ok(value);assert.ok(!JSON.stringify(value).includes(secret));assert.ok(!JSON.stringify(value).includes(inheritedSecret));
  assert.deepEqual(Object.keys(JSON.parse(value.input)).sort(),['byteEnd','client','cwd','endIntent','generation','host','parser','path','sessionId'].sort());
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
test('CX-5 default installed prompt hook injects on the A7-qualified host; the kill switch withholds recall',async t=>{
  const f=await memoryRuntime(t);
  f.recall({memories:[{id:'12345678-1234-4234-8234-123456789abc',content:'Prefer diagrams.',kind:'preference',
    scope:'personal',projectId:null,origin:'explicit',confidence:1,createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',
    receipts:[{client:'claude-code',sessionId:'s',eventId:'e',role:'user',excerpt:'I prefer diagrams.',createdAt:'2026-10-01T00:00:00Z'}]}]});
  // Only ancestry is synthetic; production schema qualification decides. Hook JSON cannot change it.
  const prompt=()=>{const stream=new PassThrough();stream.end(JSON.stringify({hook_event_name:'UserPromptSubmit',session_id:session,
    cwd:f.project,transcript_path:null,prompt:'Preferences?',contextQualification:false}));
    return runInstalled(f.installation,'UserPromptSubmit',stream,{signal:AbortSignal.timeout(2000),detectHost:f.detectHost});};
  assert.match(JSON.parse(await prompt()).hookSpecificOutput.additionalContext,/untrusted source-attributed recollections/);
  assert.equal(f.requests.filter(r=>r.route.endsWith('/recall')).length,1);
  const switchPath=join(f.codexHome,'cairn/prompt-recall.json');
  const off=await f.run(['prompt-recall-off','--client','codex']);assert.equal(off.code,0,off.stdout);
  assert.equal((await lstat(switchPath)).mode&0o777,0o600);
  const status=await f.run(['status','--client','codex']);assert.match(status.stdout,/prompt recall injection \(UserPromptSubmit\): off/i);
  const count=f.requests.length;
  assert.equal(await prompt(),'');assert.equal(f.requests.length,count);
  // An unreadable, unsafe or malformed switch fails closed rather than re-enabling.
  for(const [text,mode] of [['{"version":1,"enabled":true}',0o644],['{"enabled":true}',0o600],['nope',0o600]]){
    await writeFile(switchPath,text);await chmod(switchPath,mode);
    assert.equal(await prompt(),'');assert.equal(f.requests.length,count);
  }
  await chmod(switchPath,0o600);
  const on=await f.run(['prompt-recall-on','--client','codex']);assert.equal(on.code,0,on.stdout);
  assert.match((await f.run(['status','--client','codex'])).stdout,/prompt recall injection \(UserPromptSubmit\): on/i);
  assert.notEqual(await prompt(),'');assert.equal(f.requests.filter(r=>r.route.endsWith('/recall')).length,2);
  // Disable/uninstall remain the coarse switches; uninstall removes the switch with the install directory.
  assert.equal((await f.run(['uninstall','--client','codex'])).code,0);
  await assert.rejects(lstat(switchPath),{code:'ENOENT'});
});

test('CX-5 switching prompt recall off during an in-flight recall injects nothing',async t=>{
  const f=await memoryRuntime(t);
  f.recall({memories:[{id:'12345678-1234-4234-8234-123456789abc',content:'Prefer diagrams.',kind:'preference',
    scope:'personal',projectId:null,origin:'explicit',confidence:1,createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',
    receipts:[{client:'claude-code',sessionId:'s',eventId:'e',role:'user',excerpt:'I prefer diagrams.',createdAt:'2026-10-01T00:00:00Z'}]}]});
  const switchPath=join(f.codexHome,'cairn/prompt-recall.json');
  // The switch is on when the hook starts and flips off while the recall reply is in flight.
  f.delay(async route=>{if(route.endsWith('/recall'))await writeFile(switchPath,'{"version":1,"enabled":false}',{mode:0o600});});
  const stream=new PassThrough();stream.end(JSON.stringify({hook_event_name:'UserPromptSubmit',session_id:session,
    cwd:f.project,transcript_path:null,prompt:'Preferences?'}));
  assert.equal(await runInstalled(f.installation,'UserPromptSubmit',stream,{signal:AbortSignal.timeout(2000),detectHost:f.detectHost}),'');
  assert.equal(f.requests.filter(r=>r.route.endsWith('/recall')).length,1);
  assert.equal(JSON.parse(await readFile(switchPath,'utf8')).enabled,false);
});

test('CX-5 pause, generation change or cancellation during the final kill-switch read withholds context',async t=>{
  const f=await memoryRuntime(t);
  f.recall({memories:[{id:'12345678-1234-4234-8234-123456789abc',content:'Prefer diagrams.',kind:'preference',
    scope:'personal',projectId:null,origin:'explicit',confidence:1,createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',
    receipts:[{client:'claude-code',sessionId:'s',eventId:'e',role:'user',excerpt:'I prefer diagrams.',createdAt:'2026-10-01T00:00:00Z'}]}]});
  const input={hook_event_name:'UserPromptSubmit',session_id:session,cwd:f.project,transcript_path:null,prompt:'Preferences?'};
  const run=async during=>{
    const controller=new AbortController();let reads=0;
    const output=await recallContext(input,f.installed,secret,f.projectId,controller.signal,async()=>{
      reads++;await during(controller);return true;});
    return {output,reads};
  };
  // Control: nothing changes during the read, so context is returned.
  const control=await run(async()=>{});
  assert.equal(control.reads,1);assert.match(control.output,/untrusted source-attributed recollections/);
  for(const [name,during] of [
    ['pause and generation increment',async()=>{await setPaused(f.installed.root,true,{rotate:true});}],
    ['generation increment',async()=>{await rotateAutomaticBoundary(f.installed.root);}],
    ['cancellation',async controller=>{controller.abort();}],
  ]){
    const result=await run(during);
    assert.equal(result.reads,1,name);assert.equal(result.output,'',name);
    if((await readControlState(f.installed.root)).paused)await setPaused(f.installed.root,false);
  }
  // A missing switch reader fails closed before any recall request.
  const before=f.requests.length;
  assert.equal(await recallContext(input,f.installed,secret,f.projectId,AbortSignal.timeout(2000)),'');
  assert.equal(f.requests.length,before);
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


test('CX-5 pairing compatibility is a same-major capability range tied to current plugin metadata',async()=>{
  const metadata=JSON.parse(await readFile(new URL('../../../plugins/cairn-memory/.claude-plugin/plugin.json',import.meta.url),'utf8'));
  assert.ok(metadata.userConfig.pairing_record);assert.ok(supportsClaudePairing(metadata.version));
  assert.ok(supportsClaudePairing(CLAUDE_PAIRING_MINIMUM));
  for(const version of ['0.3.1','0.3.2','0.3.3','0.4.0','0.99.0'])assert.ok(supportsClaudePairing(version),version);
  for(const version of ['0.1.1','1.0.0','0.3.3-alpha','v0.3.3','0.03.3','unknown',null])assert.equal(supportsClaudePairing(version),false,String(version));
});
for(const claudeVersion of ['0.3.1','0.3.3'])test('CX-5 released/future compatible Claude '+claudeVersion+' pairs successfully',async t=>{
  const f=await fixture(t,{paired:true,claudeVersion,answers:['yes','100','']});assert.equal(f.code,0,f.stdout);
  assert.equal(f.installed.usesClaude,true);
  assert.equal(await clientProjectId({client:'claude',home:f.home,pairingRecord:f.installed.pairingRecord,
    env:{HOME:f.home,CLAUDE_PLUGIN_DATA:f.profileRoot}},'/synthetic/project'),f.originalProjectId);
});
test('CX-5 both locales describe identity-only consent and a Codex-only daily cap',()=>{
  for(const locale of ['zh','en']) {
    const t=translator(locale);
    assert.match(t('codex_cap_prompt'),locale==='zh'?/僅適用 Codex/:/Codex-only/);
    assert.ok(!/updating|scopes|更新|共用的每日/u.test(t('codex_sharing')+t('codex_cap_prompt')));
    assert.match(t('codex_sharing'),/pairing record/);
  }
});
for(const pending of [false,true])test('CX-5 uninstall unpairs '+(pending?'pending':'completed')+' identity and restores actual Claude pause',async t=>{
  const f=await fixture(t,{paired:true,answers:['yes','100',''],claudeConfigureFailOnce:pending});
  assert.equal(f.code,pending?1:0,f.stdout);
  const key=await readFile(join(f.profileRoot,'project-key'));
  const removed=await f.run(['uninstall','--client','codex']);assert.equal(removed.code,0,removed.stdout);
  const native=JSON.parse(await readFile(join(f.ws.path,'claude-options.json'),'utf8'));assert.equal(native.pairing_record,'');
  const claude={client:'claude',home:f.home,env:{HOME:f.home,CLAUDE_PLUGIN_DATA:f.profileRoot,CLAUDE_PLUGIN_OPTION_PAIRING_RECORD:native.pairing_record}};
  assert.equal((await resolveClient(claude)).enabled,true);
  assert.equal(await clientProjectId(claude,'/synthetic/project'),f.originalProjectId);
  assert.deepEqual(await readFile(join(f.profileRoot,'project-key')),key);
  assert.equal((await readControlState(f.profileRoot)).paused,false);
  const hook=new URL('../../../plugins/cairn-memory/scripts/hook.mjs',import.meta.url).pathname;
  const child=spawn(process.execPath,[hook,'pause'],{env:{...claude.env,PATH:f.bin,
    CLAUDE_PLUGIN_OPTION_API_ENDPOINT:f.server.endpoint,CLAUDE_PLUGIN_OPTION_TELEMETRY:'false'},stdio:'ignore'});
  assert.equal(await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);}),0);
  assert.equal((await readControlState(f.profileRoot)).paused,true);
  await assert.rejects(readFile(f.installation),error=>error.code==='ENOENT');
  await assert.rejects(readFile(join(f.codexHome,'cairn/credential.json')),error=>error.code==='ENOENT');
  assert.equal((await f.run(['uninstall','--client','codex'])).code,0);
});
test('CX-5 unpair failure never reports uninstall success; removes credential/state and retry restores Claude',async t=>{
  const f=await fixture(t,{paired:true,answers:['yes','100',''],claudeConfigureFailOnce:true});assert.equal(f.code,1);
  const native=join(f.bin,'claude'),backup=native+'-saved';await cp(native,backup);await unlink(native);
  const failed=await f.run(['uninstall','--client','codex']);assert.equal(failed.code,1);assert.match(failed.stdout,/recovery could not be verified/);
  assert.ok(!failed.stdout.includes('memory: uninstalled'));
  await assert.rejects(readFile(f.installation),error=>error.code==='ENOENT');
  await assert.rejects(readFile(join(f.codexHome,'cairn/credential.json')),error=>error.code==='ENOENT');
  await cp(backup,native);
  const retry=await f.run(['uninstall','--client','codex']);assert.equal(retry.code,0,retry.stdout);
  const claude={client:'claude',home:f.home,env:{HOME:f.home,CLAUDE_PLUGIN_DATA:f.profileRoot}};
  assert.equal((await resolveClient(claude)).enabled,true);
  assert.equal(await clientProjectId(claude,'/synthetic/project'),f.originalProjectId);
});
for(const unsafe of ['permissions','symlink'])test('CX-5 unsafe policy '+unsafe+' cannot retain hook credential/installation',async t=>{
  const f=await fixture(t);assert.equal(f.code,0,f.stdout);
  const dir=join(f.installed.root,'automatic-policy');
  if(unsafe==='permissions')await chmod(dir,0o755);
  else {
    const target=join(f.ws.path,'foreign-policy');await mkdir(target,{mode:0o700});
    await writeFile(join(target,'canary'),'untouched');
    await cp(dir,join(f.ws.path,'retained-policy'),{recursive:true});
    const {rm}=await import('node:fs/promises');await rm(dir,{recursive:true});await symlink(target,dir);
  }
  const result=await f.run(['uninstall','--client','codex']);assert.equal(result.code,0,result.stdout);assert.match(result.stdout,/policy directory\/file is unsafe/);
  await assert.rejects(readFile(f.installation),error=>error.code==='ENOENT');
  await assert.rejects(readFile(join(f.codexHome,'cairn/credential.json')),error=>error.code==='ENOENT');
  if(unsafe==='symlink')assert.equal(await readFile(join(f.ws.path,'foreign-policy/canary'),'utf8'),'untouched');
});
test('CX-5 standalone rerun discloses new pairing capability and preserves old memory target',async t=>{
  const f=await fixture(t,{paired:true,claudeInstalled:false});assert.equal(f.code,0,f.stdout);
  const before=await readFile(f.installation);
  await writeFile(f.claudeState,JSON.stringify({installed:true,enabled:true,version:'0.3.3'}));
  const again=await f.run(['setup','--client','codex','--no-browser']);assert.equal(again.code,0,again.stdout);
  assert.match(again.stdout,/keeps the existing Codex standalone target/);assert.match(again.stdout,/uninstall --client codex/);
  assert.deepEqual(await readFile(f.installation),before);
});

test('CX-5 uninstall from another CODEX_HOME cannot unpair a successful installation',async t=>{
  const f=await fixture(t,{paired:true,answers:['yes','100','']});assert.equal(f.code,0,f.stdout);
  const options=await readFile(join(f.ws.path,'claude-options.json'));
  const record=await readFile(f.installed.pairingRecord);
  const other=join(f.home,'other-codex');await mkdir(other,{mode:0o700});
  const result=await f.run(['uninstall','--client','codex'],{envOverrides:{CODEX_HOME:other}});
  assert.equal(result.code,0,result.stdout);
  assert.deepEqual(await readFile(join(f.ws.path,'claude-options.json')),options);
  assert.deepEqual(await readFile(f.installed.pairingRecord),record);
  assert.equal((await readInstallation(f.installation)).enabled,true);
});

test('CX-5 unpair never mints a lost Claude key or exits successfully with disabled memory',async t=>{
  const f=await fixture(t,{paired:true,answers:['yes','100',''],claudeConfigureFailOnce:true});assert.equal(f.code,1);
  const path=join(f.profileRoot,'project-key'),key=await readFile(path);await unlink(path);
  const failed=await f.run(['uninstall','--client','codex']);assert.equal(failed.code,1,failed.stdout);
  assert.match(failed.stdout,/recovery could not be verified/);
  await assert.rejects(readFile(path),error=>error.code==='ENOENT');
  await assert.rejects(readFile(f.installation),error=>error.code==='ENOENT');
  await assert.rejects(readFile(join(f.codexHome,'cairn/credential.json')),error=>error.code==='ENOENT');
  await writeFile(path,key,{mode:0o600}); // only original-key repair, never a replacement identity
  const retry=await f.run(['uninstall','--client','codex']);assert.equal(retry.code,0,retry.stdout);
  const claude={client:'claude',home:f.home,env:{HOME:f.home,CLAUDE_PLUGIN_DATA:f.profileRoot}};
  assert.equal((await resolveClient(claude)).enabled,true);
  assert.equal(await clientProjectId(claude,'/synthetic/project'),f.originalProjectId);
});


for(const version of ['0.161.0','0.162.0','0.999.0'])test('CX-5 status qualifies known format and enables capture/recall for '+version,async t=>{
  const f=await memoryRuntime(t,{state:{version}});
  assert.equal(f.installed.hostVersion,version);
  const status=await f.run(['status','--client','codex']);
  assert.equal(status.code,0,status.stdout);assert.ok(status.stdout.includes(`Codex ${version}: format qualified.`));
  if(version==='0.162.0') {
    f.host.kind='app-server'; // actual hook host may differ from install-time CLI kind
    await writeFile(f.path,await readFile(new URL('../../../integrations/codex/test/fixtures/partial-final-0.162.0.jsonl',import.meta.url),'utf8'));
  } else await writeFile(f.path,(await readFile(f.path,'utf8')).replace('0.160.1',version));
  assert.equal(await f.invoke('Stop'),'{}');await f.invoke('worker');
  assert.equal(f.requests.filter(row=>row.route.endsWith('/capture')).length,1);
  assert.deepEqual(f.requests.find(row=>row.route.endsWith('/capture')).body.messages.map(row=>row.content),
    version==='0.162.0'?['Synthetic question.','First stable section.','Second terminal section.']:['Prefer diagrams.','Understood.']);
  f.recall({memories:[{id:'12345678-1234-4234-8234-123456789abc',content:'Prefer diagrams.',kind:'preference',
    scope:'personal',projectId:null,origin:'explicit',confidence:1,createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',
    receipts:[{client:'claude-code',sessionId:'s',eventId:'e',role:'user',excerpt:'I prefer diagrams.',createdAt:'2026-10-01T00:00:00Z'}]}]});
  assert.match(JSON.parse(await f.invoke('UserPromptSubmit',{prompt:'Preferences?'})).hookSpecificOutput.additionalContext,/untrusted source-attributed recollections/);
  assert.equal(f.requests.filter(row=>row.route.endsWith('/recall')).length,1);
});

test('CX-5 app-server format verdict controls recall independently of install-time CLI and status names the refused host',async t=>{
  const f=await memoryRuntime(t);
  // Install-time CLI stays 0.160.1; observed app-server has different evidence.
  const daemon=join(f.ws.path,'daemon-codex');
  await cp(f.host.binaryPath,daemon);await chmod(daemon,0o700);
  const daemonHost={identity:await binaryIdentity(daemon),binaryPath:daemon,kind:'app-server'};
  const {qualifyBinary,observeHost}=await import('../../../integrations/codex/qualification.mjs');
  const changed=JSON.parse(await readFile(new URL('../../../integrations/codex/test/fixtures/binary-0.162.0/format.json',import.meta.url)));
  changed.appServer.MessagePhase.oneOf.push({type:'string',enum:['future_answer']});
  await qualifyBinary(f.installation,daemonHost,{collect:async()=>({version:'0.163.0',evidence:changed,binarySha256:'a'.repeat(64)})});
  await observeHost(f.installation,daemonHost);
  const stream=new PassThrough();stream.end(JSON.stringify({hook_event_name:'UserPromptSubmit',session_id:session,cwd:f.project,
    transcript_path:null,prompt:'Preferences?',host:f.host}));
  assert.equal(await runInstalled(f.installation,'UserPromptSubmit',stream,{signal:AbortSignal.timeout(2000),detectHost:async()=>daemonHost}),'');
  assert.equal(f.requests.length,0);
  const status=await f.run(['status','--client','codex']);assert.equal(status.code,0,status.stdout);
  assert.match(status.stdout,/app-server: Codex 0\.163\.0: format not yet verified; capture and recall are paused\./);
  assert.match(status.stdout,/Prompt recall injection \(UserPromptSubmit\): per host \(qualified: on; unqualified: off\)/);
});

test('CX-5 pending host in installed entry respects 2s budget and does not read the transcript',async t=>{
  const f=await fixture(t);assert.equal(f.code,0,f.stdout);
  const entry=join(f.installed.runtime,'integrations/codex/entry.mjs');
  const start=performance.now(),child=spawn(process.execPath,[entry,f.installation,'UserPromptSubmit'],{env:f.env,stdio:['pipe','pipe','pipe']});
  let out='',err='';child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>err+=chunk);
  // No Codex ancestor: there is no fallback to the qualified install-time CLI.
  child.stdin.end(JSON.stringify({hook_event_name:'UserPromptSubmit',session_id:session,cwd:'/synthetic/project',transcript_path:'/not-authorized'}));
  assert.equal(await new Promise(resolve=>child.on('close',resolve)),0);
  assert.equal(out,'');assert.equal(err,'');assert.ok(performance.now()-start<2000);
});


test('CX-5 status reports app-server separately even when it shares the qualified CLI executable',async t=>{
  const f=await fixture(t);assert.equal(f.code,0,f.stdout);
  const {observeHost}=await import('../../../integrations/codex/qualification.mjs');
  await observeHost(f.installation,{...f.host,kind:'app-server'});
  const status=await f.run(['status','--client','codex']);assert.equal(status.code,0,status.stdout);
  assert.match(status.stdout,/cli: Codex 0\.160\.1: format qualified/);
  assert.match(status.stdout,/last observed app-server: Codex 0\.160\.1: format qualified/);
});

test('CX-5 creator 0.163.0 keeps capturing across daemon 0.164.0, switch back, and CLI 0.160.1',async t=>{
  const f=await memoryRuntime(t,{state:{version:'0.163.0'}});
  const {qualifyBinary}=await import('../../../integrations/codex/qualification.mjs');
  const {item}=await import('../../../integrations/codex/test/helpers.mjs');
  await writeFile(f.path,(await readFile(f.path,'utf8')).replace('0.160.1','0.163.0'));
  f.host.kind='app-server';
  await f.invoke('Stop');await f.invoke('worker');
  for(const [version,kind,text] of [['0.164.0','app-server','Updated daemon.'],['0.163.0','app-server','Switched back.'],['0.160.1','cli','CLI resumed.']]) {
    const state=JSON.parse(await readFile(f.statePath,'utf8'));state.version=version;
    await writeFile(f.statePath,JSON.stringify(state));await appendFile(f.host.binaryPath,'\n// next host '+version+'\n');
    f.host.identity=await binaryIdentity(f.host.binaryPath);f.host.kind=kind;
    assert.equal((await qualifyBinary(f.installation,f.host)).status,'qualified');
    await appendFile(f.path,item(text,version));
    assert.equal(await f.invoke('Stop'),'{}');await f.invoke('worker');
    assert.notEqual((await f.cursor()).status,'unsupported_format');
  }
  const captures=f.requests.filter(row=>row.route.endsWith('/capture'));
  assert.equal(captures.length,4);
  assert.deepEqual(captures.flatMap(row=>row.body.messages.map(m=>m.content)),
    ['Prefer diagrams.','Understood.','Updated daemon.','Switched back.','CLI resumed.']);
});

test('CX-5 status without installation leaves CODEX_HOME unchanged and does not generate schemas',async t=>{
  const f=await fixture(t,{args:['status','--client','codex']});
  assert.equal(f.code,0,f.stdout);assert.equal(f.installed,undefined);
  assert.deepEqual(await readdir(f.codexHome),['config.toml']);
  assert.ok(!(await f.records()).some(row=>row.args.includes('generate-json-schema')));
  assert.match(f.stdout,/Codex 0\.160\.1: format not yet verified; capture and recall are paused\./);
  const zh=await f.run(['status','--client','codex','--lang','zh']);
  assert.equal(zh.code,0,zh.stdout);assert.match(zh.stdout,/Codex 0\.160\.1 的格式還沒驗證，先暫停/);
  assert.deepEqual(await readdir(f.codexHome),['config.toml']);
});

test('A7 disposable install primes an identity-bound verdict before its first prompt without patching runtime',async t=>{
  const f=await fixture(t);
  const codexHome=join(f.home,'a7-codex');await mkdir(codexHome,{mode:0o700});
  const script=fileURLToPath(new URL('../../../evaluation/codex-a7/install.mjs',import.meta.url));
  const child=spawn(process.execPath,[script,JSON.stringify({codexHome,endpoint:'https://synthetic.invalid',token:secret,
    codex:f.host.binaryPath,hostVersion:'0.160.1'})],{cwd:f.ws.path,env:{...f.env,CODEX_HOME:codexHome},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);
  assert.equal(await new Promise(r=>child.on('close',r)),0,stderr);
  const installation=join(codexHome,'cairn/installation.json');
  const config=await readInstallation(installation);
  const installed={installation,runtime:config.runtime};
  if(stdout.trim())assert.equal(JSON.parse(stdout).forced,false);
  const {cachedQualification}=await import('../../../integrations/codex/qualification.mjs');
  assert.equal((await cachedQualification(installed.installation,f.host)).status,'qualified');
  for(const path of ['parser.mjs','qualification.mjs'])assert.deepEqual(
    await readFile(join(installed.runtime,'integrations/codex',path)),
    await readFile(new URL('../../../integrations/codex/'+path,import.meta.url)));
  const original=globalThis.fetch;let recalls=0;t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async(url)=>{
    if(new URL(url).pathname.endsWith('/recall')){recalls++;return Response.json({memories:[]});}
    return Response.json({paused:false,generation:0,enforced:true});
  };
  const stream=new PassThrough();stream.end(JSON.stringify({hook_event_name:'UserPromptSubmit',session_id:session,
    cwd:'/synthetic/project',transcript_path:null,prompt:'First prompt preference?'}));
  await runInstalled(installed.installation,'UserPromptSubmit',stream,{signal:AbortSignal.timeout(2000),detectHost:async()=>f.host});
  assert.equal(recalls,1);
});
