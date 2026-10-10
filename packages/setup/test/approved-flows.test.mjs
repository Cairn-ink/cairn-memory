import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir, lstat, chmod } from 'node:fs/promises';
import {join} from 'node:path';
import {fixture,assertPaired} from './clients.test.mjs';
import {readInstallation} from '../runtime/integrations/codex/installed-state.mjs';
import {opaqueProjectId,clientProjectId,probeClaudeFacts,resolveClaudeBinding} from '../runtime/integrations/client/pairing.mjs';
import {privateRead,privateWrite} from '../runtime/integrations/client/private-state.mjs';
import {readControlState} from '../runtime/integrations/client/control-state.mjs';
import {DEFAULT_CODEX_DAILY_CAP,PRIVACY_URL} from '../lib/constants.mjs';
import {selectEndpoint,parseOptions} from '../lib/options.mjs';
import {translator,messages} from '../lib/messages.mjs';
import {columns,wrapLine} from '../lib/output.mjs';

const backupFiles=async root=>(await readdir(root)).filter(name=>name.startsWith('project-key.backup-'));
const conf=async(f,url)=>writeFile(join(f.codexHome,'config.toml'),`[mcp_servers.cairn]\nurl = ${JSON.stringify(url+'/api/mcp')}\n`,{mode:0o600});
async function twoKeys(t,options={}) {
  const f=await fixture(t,{legacyKey:true,...options});
  const other=join(f.home,'.cairn-memory');await mkdir(other,{mode:0o700});
  await opaqueProjectId(other,'/synthetic/project',{home:f.home});
  return {...f,other,oldKey:await readFile(join(other,'project-key'))};
}

const displayScreen = result => result.stdout.split('\n').map(line=>line.startsWith('{"prompt":')?JSON.parse(line).prompt:line).join('\n');
function screen(result) {
  return displayScreen(result).replace(/[ \t]+$/gmu,'').replace(/127\.0\.0\.1:\d+/gu,'cairn.ink').replace(/https?:\/\/cairn\.ink/gu,'https://cairn.ink')
    .replace(/\d{1,2}\/\d{1,2}\/\d{4}/gu,'<date>').replace(/\d{4}\/\d{1,2}\/\d{1,2}/gu,'<date>')
    .replace(/(project-key\.backup-[\w-]+)\n  ([\w-]+)/gu,'$1$2')
    .replace(/project-key\.backup-[\w-]+/gu,'project-key.backup-<stamp>');
}
function checkScreen(result,lang) {
  for(const line of displayScreen(result).split('\n'))assert.ok(columns(line)<=80,`${columns(line)} columns: ${line}`);
  if(lang==='en')assert.doesNotMatch(displayScreen(result),/\p{Script=Han}|[「」，。：；（）]/u);
  if(lang==='zh')assert.doesNotMatch(displayScreen(result),/\b(?:registered|active|open|unknown|last observed|cli:|format qualified|not_installed_or_unsafe)\b/u);
}
async function snapshot(t,id,lang,result) {
  assert.equal(result.code,0,result.stdout);checkScreen(result,lang);
  const text=screen(result);
  const url=new URL(`./snapshots/flow-${id}-${lang}.txt`,import.meta.url);
  if(process.env.UPDATE_SETUP_SNAPSHOTS==='1') {await mkdir(new URL('./snapshots/',import.meta.url),{recursive:true});await writeFile(url,text);}
  assert.equal(text,await readFile(url,'utf8'));
}

for(const lang of ['zh','en']) {
  test(`approved flow snapshots (${lang})`,async t=>{
    const f=await fixture(t); const args=['setup','--lang',lang];
    const fresh=await f.run({args});await snapshot(t,1,lang,fresh);
    assert.equal((await readInstallation(f.installation)).dailyCap,DEFAULT_CODEX_DAILY_CAP);
    assert.equal(fresh.prompts.some(p=>/daily|每日|每天|OAuth|endpoint/.test(p.prompt)),false);
    assert.equal(fresh.stdout.split(PRIVACY_URL).length-1,1);
    const single=await fixture(t,{codex:false});await snapshot(t,2,lang,await single.run({args}));
    await single.addCodex();await snapshot(t,3,lang,await single.run({args}));
    await snapshot(t,4,lang,await f.run({args:[...args,'--reauthorize']}));
    await f.setClaudeState({...await f.claudeState(),endpoint:'https://staging.cairn.ink'});
    const credential=await readFile(join(f.codexHome,'cairn/credential.json'));
    const grants=f.server.requests.filter(r=>r.route==='device-authorizations').length;
    await snapshot(t,5,lang,await f.run({args,choices:{endpointChoice:'1'}}));
    assert.deepEqual(await readFile(join(f.codexHome,'cairn/credential.json')),credential);
    assert.equal(f.server.requests.filter(r=>r.route==='device-authorizations').length,grants);
    const keys=await twoKeys(t);await snapshot(t,6,lang,await keys.run({args,choices:{keyChoice:'yes'}}));
    await assertPaired(keys);assert.equal((await backupFiles(keys.other)).length,1);
    assert.deepEqual(await readFile(join(keys.other,(await backupFiles(keys.other))[0])),keys.oldKey);
    const denied=await fixture(t,{auth:{sequence:['access_denied']}});
    const failure=await denied.run({args});assert.equal(failure.code,1);checkScreen(failure,lang);
    const url=new URL(`./snapshots/flow-7-${lang}.txt`,import.meta.url),text=screen(failure);
    if(process.env.UPDATE_SETUP_SNAPSHOTS==='1')await writeFile(url,text);
    assert.equal(text,await readFile(url,'utf8'));
    await snapshot(t,8,lang,await f.run({args:['status','--lang',lang],interactive:false}));
    await snapshot(t,9,lang,await f.run({args:['pause','--lang',lang]}));
    const installed=await readInstallation(f.installation),claude=resolveClaudeBinding(await probeClaudeFacts({client:'claude',home:f.home,pairingRecord:installed.pairingRecord,env:{HOME:f.home,CLAUDE_PLUGIN_DATA:f.profileRoot}}));
    assert.equal(claude.root,installed.root);assert.equal((await readControlState(claude.root)).paused,true);
    assert.equal((await f.run({args:['resume','--lang',lang]})).code,0);
    await snapshot(t,10,lang,await f.run({args:['uninstall','--client','codex','--lang',lang]}));
  });
}

test('fresh default endpoint has no prompt; cap flags reject invalid values before host calls',async()=>{
  let calls=0;
  assert.equal(await selectEndpoint({prompt:()=>{calls++;},write:()=>{},t:translator('en')}),'https://cairn.ink');
  assert.equal(calls,0);
  for(const value of ['abc','0','100001','-1','1.5','',undefined])assert.throws(()=>parseOptions(['setup','--codex-daily-cap',value]),{key:'invalid_cap',code:2});
});
for(const cap of [1,347,100000])test(`D6 setup flag ${cap}, stored cap on rerun, config and status`,async t=>{
  const f=await fixture(t,{claude:false});
  const fresh=await f.run({args:['setup','--codex-daily-cap',String(cap)]});assert.equal(fresh.code,0,fresh.stdout);
  assert.equal((await readInstallation(f.installation)).dailyCap,cap);
  assert.equal((await f.run()).code,0);assert.equal((await readInstallation(f.installation)).dailyCap,cap);
  const changed=await f.run({args:['config','--codex-daily-cap','201']});assert.equal(changed.code,0,changed.stdout);
  assert.equal((await readInstallation(f.installation)).dailyCap,201);
  const status=await f.run({args:['status','--lang','zh']});assert.match(status.stdout,/今日 0 \/ 201/);checkScreen(status,'zh');
});
for(const answer of ['', '1','2'])test(`endpoint conflict answer ${JSON.stringify(answer)}`,async t=>{
  const f=await fixture(t);assert.equal((await f.run()).code,0);
  // Native metadata cannot expose a Claude token. Only endpoint changes in this fixture.
  await f.setClaudeState({...await f.claudeState(),endpoint:answer==='2'?f.server.endpoint:'https://staging.cairn.ink'});
  if(answer==='2') {
    await conf(f,'https://old.example');
    const credential=JSON.parse(await readFile(join(f.codexHome,'cairn/credential.json'),'utf8'));
    credential.endpoint='https://old.example';await writeFile(join(f.codexHome,'cairn/credential.json'),JSON.stringify(credential),{mode:0o600});
    const installed=await readInstallation(f.installation);await privateWrite(f.installation,JSON.stringify({...installed,endpoint:'https://old.example'}));
  }
  const before=await readFile(join(f.codexHome,'config.toml'));
  const result=await f.run({choices:{endpointChoice:answer}});
  assert.equal(result.code,answer?0:2,result.stdout);
  if(!answer)assert.deepEqual(await readFile(join(f.codexHome,'config.toml')),before);
  if(answer==='2')assert.match(await readFile(join(f.codexHome,'config.toml'),'utf8'),new RegExp(f.server.endpoint));
});
test('non-interactive conflicts change no settings and print exact rerun command',async t=>{
  const f=await fixture(t);assert.equal((await f.run()).code,0);await f.setClaudeState({...await f.claudeState(),endpoint:'https://staging.cairn.ink'});
  const config=await readFile(join(f.codexHome,'config.toml')),credential=await readFile(join(f.codexHome,'cairn/credential.json'));
  const result=await f.run({interactive:false});assert.equal(result.code,2);assert.equal(result.prompts.length,0);
  assert.match(result.stdout,/npx @cairn-ink\/memory setup/);
  assert.deepEqual(await readFile(join(f.codexHome,'config.toml')),config);assert.deepEqual(await readFile(join(f.codexHome,'cairn/credential.json')),credential);
  const keys=await twoKeys(t);const no=await keys.run({interactive:false});assert.equal(no.code,2,no.stdout);
  assert.equal((await backupFiles(keys.other)).length,0);assert.equal((await keys.claudeState()).installed,undefined);
});
for(const otherKey of ['yes','no'])test(`two IDs: no then ${otherKey}`,async t=>{
  const f=await twoKeys(t);const result=await f.run({choices:{keyChoice:'no',otherKey}});assert.equal(result.code,0,result.stdout);
  if(otherKey==='no'){await assert.rejects(readFile(f.installation),{code:'ENOENT'});assert.deepEqual(await readFile(join(f.other,'project-key')),f.oldKey);}
  else {assert.equal((await readInstallation(f.installation)).root,f.other);assert.equal((await backupFiles(f.profileRoot)).length,1);}
});
for(const sequence of [['access_denied'],[503]])test(`backup never moves a key before successful sign-in (${sequence})`,async t=>{
  const f=await twoKeys(t,{auth:sequence[0]===503?{createStatus:503}:{sequence}});
  const result=await f.run();assert.equal(result.code,1,result.stdout);assert.equal((await backupFiles(f.other)).length,0);
  assert.deepEqual(await readFile(join(f.other,'project-key')),f.oldKey);
});
test('hosts no then yes proceeds; Ctrl+C before consent changes nothing',async t=>{
  const f=await fixture(t);const result=await f.run({choices:{stopped:['no','yes']}});assert.equal(result.code,0,result.stdout);
  assert.equal(result.prompts.filter(p=>p.prompt.includes('Are both closed')).length,2);
  const cancelled=await fixture(t);const no=await cancelled.run({choices:{stopCancel:true}});assert.equal(no.code,130,no.stdout);
  assert.equal((await cancelled.claudeState()).installed,undefined);await assert.rejects(readFile(cancelled.installation),{code:'ENOENT'});
});
test('snapshot change during answers aborts before first host write',async t=>{
  const f=await fixture(t);await mkdir(f.codexHome,{mode:0o700});await conf(f,f.server.endpoint);
  const result=await f.run({choices:{changeConfig:true}});assert.equal(result.code,2,result.stdout);
  assert.equal((await f.claudeState()).installed,undefined);assert.equal(f.server.requests.length,0);
});
test('lock error is actionable and retains existing settings',async t=>{
  const f=await fixture(t,{claude:false});await mkdir(f.codexHome,{mode:0o700});await writeFile(join(f.codexHome,'.cairn-setup.lock'),'other',{mode:0o600});
  const result=await f.run();assert.equal(result.code,2,result.stdout);assert.match(result.stdout,/Another Cairn setup is running/);
  assert.equal(f.server.requests.length,0);
});
for(const client of ['claude','codex'])test(`pause/resume without --client with only ${client}`,async t=>{
  const f=await fixture(t,{claude:client==='claude',codex:client==='codex'});assert.equal((await f.run()).code,0);
  for(const action of ['pause','resume']) {const result=await f.run({args:[action]});assert.equal(result.code,0,result.stdout);assert.doesNotMatch(result.stdout,/Unknown command/);}
});
test('proposal column script covers catalog and long dynamic values; English has no CJK',()=>{
  let lines=0;
  for(const [id,translations]of Object.entries(messages))for(const [lang,text]of Object.entries(translations)) {
    if(lang==='en')assert.doesNotMatch(text,/\p{Script=Han}/u,id);
    for(const line of text.split('\n'))for(const wrapped of wrapLine(line.replaceAll('{host}','a'.repeat(130)))){lines++;assert.ok(columns(wrapped)<=80,`${id}: ${wrapped}`);}
  }
  assert.ok(lines>400);
});

test('a failed native pairing delivery restores the exact backup key names and bytes',async t=>{
  const f=await twoKeys(t);await f.setClaudeState({...await f.claudeState(),failPairing:true});
  const selected=await readFile(join(f.profileRoot,'project-key'));
  const result=await f.run();assert.equal(result.code,2,result.stdout);
  assert.deepEqual(await readFile(join(f.other,'project-key')),f.oldKey);
  assert.deepEqual(await readFile(join(f.profileRoot,'project-key')),selected);
  assert.equal((await backupFiles(f.other)).length,0);
  assert.equal((await readInstallation(f.installation)).enabled,false);
});
test('MCP candidate validation failure leaves both identity names untouched',async t=>{
  const f=await twoKeys(t);await f.setCodexState({failValidation:true});
  const result=await f.run();assert.notEqual(result.code,0,result.stdout);
  assert.deepEqual(await readFile(join(f.other,'project-key')),f.oldKey);
  assert.equal((await backupFiles(f.other)).length,0);
});
test('an identity changed during consent is refused before sign-in or native writes',async t=>{
  const f=await twoKeys(t);
  const result=await f.run({choices:{changeKey:join(f.other,'project-key'),keyBytes:'unsafe replacement'}});
  assert.equal(result.code,2,result.stdout);assert.equal((await backupFiles(f.other)).length,0);
  assert.equal(f.server.requests.length,0);
});
for(const reason of ['auth-fields','unverified-version'])test(`endpoint migration refuses ${reason} before authorization`,async t=>{
  const f=await fixture(t);assert.equal((await f.run()).code,0);
  await f.setClaudeState({...await f.claudeState(),endpoint:'https://new.example'});
  if(reason==='auth-fields')await writeFile(join(f.codexHome,'config.toml'),`[mcp_servers.cairn]\nurl = ${JSON.stringify(f.server.endpoint+'/api/mcp')}\nbearer_token_env_var = "OWN_TOKEN"\n`,{mode:0o600});
  else await f.setCodexState({version:'0.161.0'});
  const before=await readFile(join(f.codexHome,'config.toml')),grants=f.server.requests.length;
  const result=await f.run({choices:{endpointChoice:'2'}});assert.equal(result.code,2,result.stdout);
  assert.match(result.stdout,/codex mcp logout cairn/);assert.equal(f.server.requests.length,grants);
  assert.deepEqual(await readFile(join(f.codexHome,'config.toml')),before);
});

test('an existing binding prevents backing up its key',async t=>{
  const f=await fixture(t,{claude:false});assert.equal((await f.run()).code,0);
  const installed=await readInstallation(f.installation),old=await readFile(join(installed.root,'project-key'));
  await f.addClaude();await mkdir(f.profileRoot,{recursive:true,mode:0o700});
  await opaqueProjectId(f.profileRoot,'/synthetic/project',{home:f.home});
  const result=await f.run();assert.equal(result.code,2,result.stdout);
  assert.deepEqual(await readFile(join(installed.root,'project-key')),old);
  assert.equal((await backupFiles(installed.root)).length,0);
});
test('backup rechecks key fingerprints while the pairing setup lock is held',async t=>{
  const {identitySnapshot,backupIdentity}=await import('../lib/identity-choice.mjs');
  const {stateLock}=await import('../runtime/integrations/client/state-lock.mjs');
  const f=await twoKeys(t),options={home:f.home,setup:true,standardClaudeOrigin:true};
  const snapshot=await identitySnapshot(options),plan={options,snapshot,root:f.profileRoot,others:[f.other],home:f.home,backups:[]};
  const replacement=f.oldKey.toString().replace(/[a-f0-9]/u,c=>c==='a'?'b':'a');
  await mkdir(snapshot.detected.locations.coordination,{recursive:true,mode:0o700});
  await stateLock(join(snapshot.detected.locations.coordination,'setup.lock'),async()=>{
    await privateWrite(join(f.other,'project-key'),replacement);
    await assert.rejects(backupIdentity(plan),{key:'identity_changed',code:2});
  });
  assert.equal((await backupFiles(f.other)).length,0);
  assert.equal(await readFile(join(f.other,'project-key'),'utf8'),replacement);
});
test('status shows actual daily usage and the reached-cap explanation in Chinese',async t=>{
  const {automaticGuard}=await import('../runtime/integrations/client/automatic-policy.mjs');
  const {hostedTargetId}=await import('../runtime/integrations/client/transport-hosted.mjs');
  const f=await fixture(t,{claude:false});assert.equal((await f.run()).code,0);
  const installed=await readInstallation(f.installation);
  const guard=automaticGuard(installed.root,installed.endpoint,{dailyCap:200,concurrency:2});
  const {state}=await guard.status(),path=join(installed.root,'usage',hostedTargetId(installed)+'.json');
  await privateWrite(path,JSON.stringify({...state,used:12}));
  const status=await f.run({args:['status','--lang','zh']});assert.equal(status.code,0);assert.match(status.stdout,/今日 12 \/ 200/);checkScreen(status,'zh');
  await privateWrite(path,JSON.stringify({...state,used:200}));
  const reached=await f.run({args:['status','--lang','zh']});assert.match(reached.stdout,/今日 200 \/ 200/);assert.match(reached.stdout,/明天|隔天/u);checkScreen(reached,'zh');
});

test('wrapped shell commands remain executable and preserve long arguments',async()=>{
  const {spawn}=await import('node:child_process');
  const argument='x'.repeat(180),command="node -e 'require(\"fs\").writeSync(1,process.argv[1])' "+argument;
  const lines=wrapLine(command);assert.ok(lines.every(line=>columns(line)<=80));
  const child=spawn('sh',['-c',lines.join('\n')],{stdio:['ignore','pipe','pipe']});
  let stdout='';child.stdout.on('data',data=>stdout+=data);child.stderr.resume();
  assert.equal(await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);}),0);
  assert.equal(stdout.trim(),argument);
});

test('cap changes stage the next daily limit without resetting existing usage',async t=>{
  const {automaticGuard}=await import('../runtime/integrations/client/automatic-policy.mjs');
  const {createRuntimeGuard}=await import('../runtime/integrations/client/runtime-usage.mjs');
  const {hostedTargetId}=await import('../runtime/integrations/client/transport-hosted.mjs');
  const f=await fixture(t,{claude:false});assert.equal((await f.run()).code,0);
  const installed=await readInstallation(f.installation),targetId=hostedTargetId(installed);
  const {state}=await automaticGuard(installed.root,installed.endpoint,{dailyCap:200,concurrency:2}).status();
  const path=join(installed.root,'usage',targetId+'.json');await privateWrite(path,JSON.stringify({...state,used:12}));
  const result=await f.run({args:['config','--codex-daily-cap','300']});assert.equal(result.code,0,result.stdout);
  let usage=JSON.parse(await privateRead(path));assert.equal(usage.used,12);assert.equal(usage.cap,200);assert.equal(usage.pendingPolicy.cap,300);
  const status=await f.run({args:['status','--lang','zh']});assert.match(status.stdout,/今日 12 \/ 200/);assert.match(status.stdout,/新上限 300.*下次每日重置/u);checkScreen(status,'zh');
  assert.equal((await f.run({args:['setup','--codex-daily-cap','100']})).code,0);
  usage=JSON.parse(await privateRead(path));assert.equal(usage.used,12);assert.equal(usage.cap,200);assert.equal(usage.pendingPolicy.cap,100);
  const next=await createRuntimeGuard({root:installed.root,targetId,client:'shared',mode:'hosted',dailyCap:100,concurrency:2,now:()=>Date.now()+86400000}).status();
  assert.equal(next.state.used,0);assert.equal(next.state.cap,100);assert.equal(next.state.pendingPolicy,null);
});

for(const lang of ['zh','en'])test(`exec opt-in config, setup preservation, disclosure and status (${lang})`,async t=>{
  const f=await fixture(t,{claude:false});
  const setup=await f.run({args:['setup','--lang',lang]});assert.equal(setup.code,0,setup.stdout);checkScreen(setup,lang);
  assert.match(setup.stdout,lang==='zh'?/Codex 用 exec 自動執行的工作不會記下。/:/Automated codex exec runs are not saved\./);
  assert.equal((await readInstallation(f.installation)).captureExec,false);
  const statusArgs=['status','--lang',lang];
  assert.doesNotMatch((await f.run({args:statusArgs})).stdout,/exec/);
  // A non-interactive config command has an explicit choice and needs no prompt.
  const on=await f.run({args:['config','--codex-capture-exec','on','--lang',lang],interactive:false});
  assert.equal(on.code,0,on.stdout);checkScreen(on,lang);assert.equal(on.prompts.length,0);
  let installed=await readInstallation(f.installation);assert.equal(installed.captureExec,true);assert.equal(installed.dailyCap,200);
  const status=await f.run({args:statusArgs});assert.match(status.stdout,/exec/);checkScreen(status,lang);
  const rerun=await f.run({args:['setup','--lang',lang]});assert.equal(rerun.code,0,rerun.stdout);checkScreen(rerun,lang);
  assert.doesNotMatch(rerun.stdout,lang==='zh'?/工作不會記下/:/runs are not saved/);
  assert.equal((await readInstallation(f.installation)).captureExec,true);
  const cap=await f.run({args:['config','--codex-daily-cap','347','--lang',lang]});assert.equal(cap.code,0,cap.stdout);
  installed=await readInstallation(f.installation);assert.equal(installed.captureExec,true);assert.equal(installed.dailyCap,347);
  const off=await f.run({args:['config','--codex-capture-exec','off','--lang',lang]});assert.equal(off.code,0,off.stdout);checkScreen(off,lang);
  installed=await readInstallation(f.installation);assert.equal(installed.captureExec,false);assert.equal(installed.dailyCap,347);
  assert.doesNotMatch((await f.run({args:statusArgs})).stdout,/exec/);
});

test('exec option validates on/off, command and client; setup can opt in without a new question',async t=>{
  for(const value of ['yes','1','true','ON','',undefined])assert.throws(()=>parseOptions(['config','--codex-capture-exec',value]),{key:'invalid_exec_setting',code:2});
  assert.throws(()=>parseOptions(['config','--codex-capture-exec','off','--codex-capture-exec','on']),{key:'invalid_exec_setting',code:2});
  assert.throws(()=>parseOptions(['status','--codex-capture-exec','on']),{key:'invalid_exec_setting',code:2});
  const f=await fixture(t);
  const setup=await f.run({args:['setup','--codex-capture-exec','on','--codex-daily-cap','347']});assert.equal(setup.code,0,setup.stdout);
  assert.equal((await readInstallation(f.installation)).captureExec,true);assert.equal((await readInstallation(f.installation)).dailyCap,347);
  assert.equal(setup.prompts.some(p=>/exec/.test(p.prompt)),false);
  assert.equal((await f.run({args:['config','--client','claude','--codex-capture-exec','on']})).code,2);
  assert.equal((await f.run({args:['config']})).code,2);
});
