// Synthetic external orchestration only. Every application action imports the
// inspected offline installation in a cold process. Native ancestry is a fixture,
// not evidence that a real native client executed a provider-backed hook.
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import fs from 'node:fs';
import promises from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname,join,relative } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { register,syncBuiltinESMExports } from 'node:module';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { buildArtifact,command,packageName } from '../../build.mjs';
import { installedImportClosure } from './installed-import-closure.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const self=fileURLToPath(import.meta.url),preload=fileURLToPath(new URL('./local-host-child.mjs',import.meta.url));
const sha=value=>createHash('sha256').update(value).digest('hex');
export const rows=path=>fs.existsSync(path)?fs.readFileSync(path,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
const walk=(path,prefix='')=>fs.readdirSync(path,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(join(path,entry.name),prefix+entry.name+'/'):[prefix+entry.name]).sort();
export async function installedSetupFixture(t,client='claude-code'){
  const workspace=createTestWorkspace(t,{prefix:'installed-local-setup-'}),base=workspace.path;
  const home=join(base,'operator-home'),native=join(base,'native'),sourceRoot=join(base,'sources'),usageRoot=join(base,'usage'),pluginRoot=join(base,'plugin'),qroot=join(base,'codex-install');
  for(const path of [home,native,sourceRoot,usageRoot,pluginRoot,qroot,join(qroot,'qualification')])fs.mkdirSync(path,{mode:0o700});
  const artifact=buildArtifact(),graph=installedImportClosure(root,['integrations/client/raw/local-setup-cli.mjs','adapters/local/cli.mjs']);
  fs.writeFileSync(join(base,'package.json'),JSON.stringify({name:'synthetic-installed-setup',version:'0.0.0',private:true}),{mode:0o600});
  command('npm',['install','--prefix',base,'--offline','--ignore-scripts','--no-audit','--no-fund',artifact.artifactPath],base,artifact.userconfig);
  const installed=join(base,'node_modules',packageName),executable=join(base,'node_modules/.bin/cairn-memory');
  const archive=command('tar',['-tzf',artifact.artifactPath],base,artifact.userconfig).trim().split('\n').map(path=>path.slice(8)).sort();
  assert.deepEqual(archive,[...JSON.parse(fs.readFileSync(join(installed,'package.json'))).files].sort());assert.deepEqual(walk(installed),archive);
  for(const path of graph.required)assert.ok(archive.includes(path),path);
  for(const[path,hash]of Object.entries(artifact.sourceHashes))assert.equal(sha(fs.readFileSync(join(installed,path))),hash,path);
  const qualification=await import('../../../integrations/codex/qualification.mjs');
  const binary=join(base,'codex');fs.writeFileSync(binary,'synthetic native binary',{mode:0o700});
  const identity=await qualification.binaryIdentity(binary),qualificationConfigPath=join(qroot,'installation.json');
  fs.writeFileSync(qualificationConfigPath,'{}',{mode:0o600});fs.writeFileSync(join(qroot,'qualification',identity+'.json'),JSON.stringify({identity,
    policy:sha(qualification.canonical(qualification.KNOWN_FORMATS)),version:'0.162.0',status:'qualified',fingerprint:qualification.KNOWN_FORMATS[1]}),{mode:0o600});
  const installationDirectory=join(base,'installation'),databasePath=join(base,'memory.sqlite'),clientConfigPath=join(native,client==='codex'?'hooks.json':'settings.json');
  fs.writeFileSync(clientConfigPath,JSON.stringify({theme:'untouched',hooks:{Notification:[{hooks:[{type:'prompt',prompt:'unrelated'},
    {type:'mcp_tool',server_name:'unrelated',tool_name:'inert'}]}]}}),{mode:0o600});
  const request={version:'local-raw-setup-request-v1',installationDirectory,databasePath,namespace:{ownerId:'synthetic-installed-setup',scope:'personal',projectId:null},
    client,sourceRoot,clientConfigPath,usageRoot,installation:client==='claude-code'?{pluginRoot}:{qualificationConfigPath},rawMode:'local-plain-v1',rawCapBytes:1000000,
    dailyCap:20,providerApiKeyEnv:'CAIRN_SYNTHETIC_API_KEY',interpretationConsent:true,plaintextRawConsent:true,foregroundConsent:true};
  const requestPath=join(base,'request.json'),configPath=join(installationDirectory,'capture.json'),profilePath=join(installationDirectory,'host-profile.json');
  const save=()=>fs.writeFileSync(requestPath,JSON.stringify(request),{mode:0o600});save();
  const sourcePath=join(sourceRoot,'selected.jsonl'),sessionId='11111111-1111-4111-8111-111111111111';
  fs.writeFileSync(sourcePath,(client==='codex'?JSON.stringify({type:'session_meta',payload:{id:sessionId,cli_version:'0.162.0',history_mode:'paginated',source:'cli',originator:'codex-tui'}})+'\n':'') ,{mode:0o600});
  let row=0;function append(text){const id='native-'+row++;const value=client==='claude-code'?{type:'user',uuid:id,timestamp:null,promptSource:'typed',message:{content:[{type:'text',text}]}}:
    {type:'event_msg',timestamp:null,payload:{type:'item_completed',thread_id:sessionId,turn_id:id,item:{type:'UserMessage',id,content:[{type:'text',text}]}}};fs.appendFileSync(sourcePath,JSON.stringify(value)+'\n');}
  append('Historical source must never be backfilled.');
  const environment={PATH:dirname(process.execPath)+':/usr/bin:/bin',HOME:home,TMPDIR:base,TMP:base,TEMP:base,NODE_NO_WARNINGS:'1',NODE_DISABLE_COMPILE_CACHE:'1'};
  const scaffold={...environment,SYNTHETIC_INSTALLED:installed,SYNTHETIC_CONFIG:configPath,SYNTHETIC_USAGE:usageRoot,SYNTHETIC_TRACE:join(base,'http.jsonl'),
    SYNTHETIC_CORE:join(installed,'core/index.mjs'),SYNTHETIC_READY:join(base,'ready'),SYNTHETIC_RELEASE:join(base,'release')};
  let sequence=0;const receipts=[],traces=[];
  function launch(action,args=[],{key=false,mode='memory',event='Stop',payload,exec=false,missing=false,deadlineMs}={}){
    const trace=join(base,'driver-'+sequence+++'.jsonl'),settings=trace+'.settings.json';traces.push(trace);
    fs.writeFileSync(settings,JSON.stringify({installed,trace,action,args,request,profilePath,scaffold,preload,syntheticBinary:binary,mode,exec,missing,deadlineMs,
      event,payload:payload??{hook_event_name:event,session_id:sessionId,transcript_path:sourcePath,cwd:base,model:'synthetic',turn_id:'synthetic-turn',permission_mode:'default',
        ...(event==='Stop'?{last_assistant_message:null,stop_hook_active:false}:{}),...(event==='PreCompact'?{trigger:'manual'}:{}),...(event==='SessionStart'?{source:'startup'}:{}),...(event==='UserPromptSubmit'?{prompt:'synthetic prompt'}:{})}}),{mode:0o600});
    const child=cp.spawn(process.execPath,[self,'--driver',settings],{cwd:base,stdio:['ignore','pipe','pipe'],env:{...environment,...(key?{CAIRN_SYNTHETIC_API_KEY:'synthetic_key_secret'}:{})}});
    let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=chunk;if(Buffer.byteLength(stdout)>262144)child.kill('SIGTERM')});child.stderr.on('data',chunk=>{stderr+=chunk;if(Buffer.byteLength(stderr)>65536)child.kill('SIGTERM')});
    const timer=setTimeout(()=>child.kill('SIGTERM'),20000);
    const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal,stdout,stderr}))}).finally(()=>clearTimeout(timer));
    workspace.defer(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await done;});return{child,done,trace};
  }
  async function invoke(action,args=[],options={},expected=0){const launched=launch(action,args,options),outcome=await launched.done;
    assert.equal(outcome.code,expected,outcome.stderr+' '+outcome.stdout);assert.equal(outcome.signal,null);assert.doesNotMatch(outcome.stdout+outcome.stderr,/synthetic_key_secret/);
    const trace=rows(launched.trace),spawned=trace.filter(value=>value.kind==='spawn'),closed=trace.filter(value=>value.kind==='close');
    assert.deepEqual(closed.map(value=>value.pid).sort(),spawned.map(value=>value.pid).sort());receipts.push({action,code:outcome.code,signal:outcome.signal,children:closed});
    if(action==='hook'){assert.equal(outcome.stdout,'');return trace;}return JSON.parse(outcome.stdout);
  }
  const setup=()=>invoke('cli',['setup','--request',requestPath]);
  const activate=()=>invoke('cli',['activate','--installation',installationDirectory]);
  const cursor=()=>{const directory=join(installationDirectory,'state/sessions');return JSON.parse(fs.readFileSync(join(directory,fs.readdirSync(directory).find(name=>name.endsWith('.json')&&!name.endsWith('.rearm.json')&&!name.endsWith('.claim.json')))))};
  const inspect=()=>invoke('inspect');
  function exact(event){const config=JSON.parse(fs.readFileSync(clientConfigPath)),command=config.hooks[event].flatMap(group=>group.hooks).find(hook=>hook.type==='command').command;
    const argv=[...command.matchAll(/'([^']*)'/g)].map(match=>match[1]);assert.deepEqual(argv,['/usr/bin/env','-u','NODE_OPTIONS','-u','NODE_PATH',process.execPath,
      join(installed,'integrations/client/raw/local-setup-cli.mjs'),'hook','--installation',installationDirectory,'--event',event]);
    const outcome=cp.spawnSync('/bin/sh',['-c',command],{cwd:base,encoding:'utf8',timeout:12000,input:JSON.stringify({hook_event_name:event,session_id:sessionId,transcript_path:sourcePath}),env:environment});
    assert.equal(outcome.error,undefined);assert.equal(outcome.status,0,outcome.stderr);assert.equal(outcome.signal,null);assert.equal(outcome.stdout,'');receipts.push({action:'exact-generated-'+event,code:outcome.status,signal:outcome.signal});return argv;
  }
  const observed=()=>{const seen=new Set();for(const name of fs.readdirSync(base).filter(name=>/^(driver-|child-).*\.jsonl$/.test(name)))for(const row of rows(join(base,name)))if(row.path?.startsWith(installed+'/'))seen.add(relative(installed,row.path));return [...seen].sort()};
  return{workspace,base,installed,executable,artifact,graph,request,requestPath,save,sourcePath,sessionId,append,profilePath,configPath,clientConfigPath,scaffold,invoke,launch,setup,activate,cursor,inspect,exact,observed,receipts,traces};
}

async function driver(path){
  const settings=JSON.parse(fs.readFileSync(path)),{installed,trace,scaffold}=settings;
  for(const key of['OPENAI_API_KEY','ANTHROPIC_API_KEY','NODE_OPTIONS','NODE_PATH'])assert.equal(process.env[key],undefined);
  fs.writeFileSync(trace,'',{flag:'wx',mode:0o600});const note=value=>fs.appendFileSync(trace,JSON.stringify(value)+'\n');
  const deny=()=>{throw Error('synthetic_setup_network_forbidden')};globalThis.fetch=deny;
  for(const name of['node:http','node:https','node:net']){const api=(await import(name)).default;for(const method of['request','get','connect','createConnection'])if(api[method])api[method]=deny;if(api.Socket)api.Socket.prototype.connect=deny;}
  for(const api of[fs,promises])for(const method of['readFileSync','readFile'])if(typeof api[method]==='function'){const original=api[method];api[method]=function(value,...args){const path=value instanceof URL?fileURLToPath(value):String(value);if(path.startsWith(installed+'/'))note({kind:'asset',path});return original.call(this,value,...args)}}
  const children=new Set(),spawn=cp.spawn;let sequence=0;
  cp.spawn=function(executable,args,options){assert.equal(executable,process.execPath);assert.equal(options.shell,false);assert.equal(options.detached,false);
    if(args.length===1&&args[0]==='--version')return spawn(executable,args,options);
    assert.equal(args.length,5);assert.equal(args[0],join(installed,'adapters/local/cli.mjs'));assert.equal(args[1],'--config');assert.equal(args[2],scaffold.SYNTHETIC_CONFIG);assert.equal(args[3],'--config-digest');
    assert.equal(options.env.HOME,join(settings.request.installationDirectory,'home'));assert.equal(options.env.NODE_OPTIONS,undefined);assert.equal(options.env.NODE_PATH,undefined);
    const child=spawn(executable,['--import',settings.preload,...args],{...options,env:{...options.env,...scaffold,SYNTHETIC_MODE:settings.mode,
      SYNTHETIC_IMPORT_TRACE:join(dirname(trace),'child-'+process.pid+'-'+sequence+++'.jsonl')}});children.add(child);note({kind:'spawn',pid:child.pid});
    child.once('close',(code,signal)=>{children.delete(child);note({kind:'close',pid:child.pid,code,signal})});return child;};
  syncBuiltinESMExports();
  register('data:text/javascript,'+encodeURIComponent(`import{appendFileSync}from'node:fs';import{fileURLToPath}from'node:url';let data;export function initialize(value){data=value}
export async function resolve(specifier,context,next){const result=await next(specifier,context);if(result.url.startsWith('file:')){const path=fileURLToPath(result.url);if(!path.startsWith(data.allowed+'/'))throw Error('installed_setup_source_fallback');appendFileSync(data.trace,JSON.stringify({kind:'module',path})+'\\n')}return result}
export async function load(url,context,next){const result=await next(url,context);const names=url.endsWith('/integrations/codex/source.mjs')?['openSource','source']:url.endsWith('/integrations/client/raw/local-worker.mjs')?['createLocalRawWorker','worker']:null;if(!names)return result;const[name,kind]=names;let source=String(result.source).replace('export async function '+name+'(','async function observed_'+name+'(').replace('export function '+name+'(','function observed_'+name+'(');source+='\\nexport function '+name+'(...args){globalThis[Symbol.for("cairn.setup.observe")]?.('+JSON.stringify(kind)+');return observed_'+name+'(...args)}';return{...result,source}}`),{parentURL:import.meta.url,data:{allowed:dirname(installed),trace}});
  globalThis[Symbol.for('cairn.setup.observe')]=kind=>note({kind});
  const {withLocalHostDependencies,createLocalRawHost}=await import(pathToFileURL(join(installed,'integrations/client/raw/local-host.mjs')));
  const {runLocalSetupCli}=await import(pathToFileURL(join(installed,'integrations/client/raw/local-setup-cli.mjs')));
  const qualification=await import(pathToFileURL(join(installed,'integrations/codex/qualification.mjs')));
  const detectHost=async()=>settings.missing?undefined:{binaryPath:settings.syntheticBinary,identity:await qualification.binaryIdentity(settings.syntheticBinary),kind:'cli',...(settings.exec?{execSession:true}:{})};
  await withLocalHostDependencies({detectHost,...(settings.deadlineMs?{deadlineMs:settings.deadlineMs}:{})},async()=>{
    if(settings.action==='cli')process.exitCode=await runLocalSetupCli(settings.args);
    else if(settings.action==='hook'){
      const {Readable}=await import('node:stream');process.exitCode=await runLocalSetupCli(['hook','--installation',settings.request.installationDirectory,'--event',settings.event],{stdin:Readable.from([JSON.stringify(settings.payload)])});
    }else if(settings.action==='rearm'){
      const host=createLocalRawHost({profilePath:settings.profilePath}),status=await host.rearmStatus();const result=await host.rearm({expectedRevision:status.revision,actionId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        sessionId:settings.payload.session_id,sourcePath:settings.payload.transcript_path});console.log(JSON.stringify(result));
    }else if(settings.action==='inspect'){
      const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(settings.request.databasePath,{readOnly:true});try{
        const parts=db.prepare('SELECT sealed,saved FROM raw_parts ORDER BY rowid').all().map(part=>({saved:part.saved,text:Buffer.from(part.sealed??[]).toString()}));
        console.log(JSON.stringify({parts,memories:db.prepare('SELECT count(*) n FROM memories WHERE deleted=0').get().n,events:db.prepare('SELECT count(*) n FROM raw_events').get().n,
          control:db.prepare('SELECT target_id,revision,automatic_capture_enabled,consent_generation,raw_notice_version FROM local_capture_controls WHERE owner_id=? AND scope=? AND project_id=? AND client=?')
            .get(settings.request.namespace.ownerId,settings.request.namespace.scope,settings.request.namespace.projectId??'',settings.request.client)??null,
          usage:db.prepare('SELECT cap_bytes FROM raw_owner_usage WHERE owner_id=?').get(settings.request.namespace.ownerId)??null}));
      }finally{db.close()}
    }else throw Error('invalid_fixture_action');
  });assert.equal(children.size,0,'all actual B4a children close before CLI returns');
}
if(process.argv[2]==='--driver')await driver(process.argv[3]);
