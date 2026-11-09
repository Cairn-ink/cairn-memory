import { workspaceSnapshot } from './local-workspace-snapshot.mjs';
import assert from 'node:assert/strict';
import { mkdirSync,writeFileSync,readFileSync,readdirSync,lstatSync,appendFileSync } from 'node:fs';
import { join,relative } from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { createTestWorkspace } from '../../../../tools/testing/workspace.mjs';
import { openMemoryCore } from '../../../../core/index.mjs';
import { binaryIdentity,canonical,KNOWN_FORMATS } from '../../../codex/qualification.mjs';
import { withLocalHostDependencies } from '../../raw/local-host.mjs';
import { setupLocalRaw,createLocalRawSetup } from '../../raw/local-setup.mjs';
import { runLocalRawHook } from '../../raw/local-hook.mjs';
import { claude,codex,sessionId } from './raw-fixtures.mjs';

export const ok = outcome => { assert.equal(outcome.ok,true,JSON.stringify(outcome)); return outcome.value; };
const sha = value => createHash('sha256').update(value).digest('hex');
export async function setupFixture(t,{ client='claude-code' } = {}) {
  const workspace=createTestWorkspace(t,{ prefix:'local-setup-' }),root=workspace.path;
  const sourceRoot=join(root,'sources'),native=join(root,'native'),pluginRoot=join(root,'plugin'),usageRoot=join(root,'usage');
  const qroot=join(root,'codex-install'),qdir=join(qroot,'qualification');
  for(const path of [sourceRoot,native,pluginRoot,usageRoot,qroot,qdir])mkdirSync(path,{mode:0o700});
  const databasePath=join(root,'memory.sqlite'),clientConfigPath=join(native,'settings.json'),qualificationConfigPath=join(qroot,'installation.json');
  writeFileSync(clientConfigPath,JSON.stringify({theme:'untouched',hooks:{Notification:[{matcher:'x',hooks:[{type:'prompt',prompt:'unrelated'}]}]}}),{mode:0o600});
  writeFileSync(qualificationConfigPath,'{}',{mode:0o600});
  const binary=join(root,'codex');writeFileSync(binary,'synthetic native binary',{mode:0o700});
  const identity=await binaryIdentity(binary);
  writeFileSync(join(qdir,identity+'.json'),JSON.stringify({identity,policy:sha(canonical(KNOWN_FORMATS)),version:'0.162.0',status:'qualified',fingerprint:KNOWN_FORMATS[1]}),{mode:0o600});
  const core=openMemoryCore({path:databasePath,rawConversations:{mode:'off',readPolicy:()=>({generation:'synthetic',reason:null})}});
  workspace.defer(()=>core.close());
  const request={version:'local-raw-setup-request-v1',installationDirectory:join(root,'installation'),databasePath,
    namespace:{ownerId:'synthetic-setup',scope:'personal',projectId:null},client,sourceRoot,clientConfigPath,usageRoot,
    installation:client==='claude-code'?{pluginRoot}:{qualificationConfigPath},rawMode:'local-plain-v1',rawCapBytes:1000000,
    dailyCap:20,providerApiKeyEnv:'CAIRN_SYNTHETIC_API_KEY',interpretationConsent:true,plaintextRawConsent:true,foregroundConsent:true};
  const sourcePath=join(sourceRoot,'session.jsonl');
  writeFileSync(sourcePath,(client==='codex'?JSON.stringify({type:'session_meta',payload:{id:sessionId,cli_version:'0.162.0',history_mode:'paginated',source:'cli',originator:'codex-tui'}})+'\n':'')+
    JSON.stringify(client==='codex'?codex('synthetic_source_secret'):claude('synthetic_source_secret'))+'\n',{mode:0o600});
  let exec=false,present=true;
  const dependencies={detectHost:async()=>present?{binaryPath:binary,identity,kind:'cli',...(exec?{execSession:true}:{})}:undefined};
  const scoped=work=>withLocalHostDependencies(dependencies,work);
  const setup=()=>scoped(()=>setupLocalRaw(request));
  const api=createLocalRawSetup({installationDirectory:request.installationDirectory});
  const invoke=action=>scoped(()=>api[action]());
  const hook=(event='SessionStart',changes={})=>scoped(()=>runLocalRawHook({installationDirectory:request.installationDirectory,event,
    payload:{hook_event_name:event,session_id:sessionId,transcript_path:sourcePath,...changes}}));
  const control=()=>ok(core.getLocalCaptureControl({namespace:request.namespace,client}));
  const snapshot=(path=root)=>workspaceSnapshot(path,databasePath);
  return {workspace,root,request,core,binary,dependencies,sourcePath,clientConfigPath,api,setup,invoke,hook,control,snapshot,scoped,
    setExec:value=>{exec=value},setPresent:value=>{present=value}};
}

// Full lifecycle with synthetic transcripts and actual keyless Raw transport.
export async function lazyFixture(t,client) {
  const f = await setupFixture(t,{client}); f.request.interpretationConsent = false;
  assert.equal((await f.setup()).status,'prepared');
  assert.equal((await f.invoke('activate')).status,'active');
  const directory = join(f.request.installationDirectory,'state/sessions');
  const cursorPath = () => join(directory,readdirSync(directory).find(name => /^[a-f0-9]{64}\.json$/.test(name)));
  const cursor = () => JSON.parse(readFileSync(cursorPath()));
  function append(text,{path=f.sourcePath,at=new Date().toISOString(),nativeSessionId=sessionId}={}) {
    const row = client === 'codex' ? codex(text):claude(text), id = randomUUID(); row.timestamp = at;
    if (client === 'codex') { row.payload.item.id = id; row.payload.turn_id = id; row.payload.thread_id = nativeSessionId; }
    else row.uuid = id;
    appendFileSync(path,JSON.stringify(row)+'\n');
  }
  return { ...f,directory,cursorPath,cursor,append };
}
