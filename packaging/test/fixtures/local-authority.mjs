// Trusted synthetic local adapter. Imports must resolve only inside this install.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import promises from 'node:fs/promises';
import { register,syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { join,dirname } from 'node:path';
import { pathToFileURL,fileURLToPath } from 'node:url';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

const [phase,installed,path,statePath,client,trace]=process.argv.slice(2);
assert.ok(['grant','capture','revoke','reopen','deliberate-failure'].includes(phase));
assert.ok(['claude-code','codex'].includes(client));
let modelCalls=0,networkCalls=0;
const forbidden=()=>{networkCalls++;assert.fail('synthetic installed authority forbids network');};
globalThis.fetch=forbidden;
http.request=http.get=https.request=https.get=net.connect=net.createConnection=net.Socket.prototype.connect=forbidden;
for(const key of ['OPENAI_API_KEY','ANTHROPIC_API_KEY','NODE_OPTIONS','npm_config_userconfig'])assert.equal(process.env[key],undefined);
fs.writeFileSync(trace,'',{flag:'wx',mode:0o600});
const append=row=>fs.appendFileSync(trace,JSON.stringify(row)+'\n');
for(const api of [fs,promises])for(const method of ['readFileSync','readFile']) {
  if(typeof api[method]!=='function')continue;const original=api[method];
  api[method]=function(value,...args){const file=value instanceof URL?fileURLToPath(value):String(value);
    if(file.startsWith(installed+'/'))append({kind:'asset',path:file});return original.call(this,value,...args);};
}
syncBuiltinESMExports();
const loader=`import {appendFileSync} from 'node:fs';import {fileURLToPath} from 'node:url';
let data;export function initialize(value){data=value}
export async function resolve(specifier,context,next){const result=await next(specifier,context);
if(result.url.startsWith('file:')){const path=fileURLToPath(result.url);
if(!path.startsWith(data.allowed+'/'))throw Error('installed_fixture_source_fallback');
appendFileSync(data.trace,JSON.stringify({kind:'module',path})+'\\n');}return result}`;
register('data:text/javascript,'+encodeURIComponent(loader),{parentURL:import.meta.url,data:{allowed:dirname(installed),trace}});
const importedCore=join(installed,'core/index.mjs'),{openMemoryCore}=await import(pathToFileURL(importedCore));
const namespace={ownerId:'synthetic-installed-authority',scope:'project',projectId:'synthetic-project'};
const readPolicy=()=>({generation:'synthetic-policy',reason:null});
const control=openMemoryCore({path,rawConversations:{mode:'off',readPolicy}});
const db=new DatabaseSync(path);let worker;
const ok=result=>{assert.equal(result.ok,true,JSON.stringify(result));return result.value;};
const denied=(result,code)=>{assert.equal(result.ok,false,JSON.stringify(result));assert.equal(result.error.code,code);};
const get=()=>ok(control.getLocalCaptureControl({namespace,client}));
const set=enabled=>{const before=get();return ok(control.setLocalCaptureControl({namespace,client,targetId:'synthetic-installed-target',
  expectedStoreId:before.storeId,expectedRevision:before.revision,automaticCaptureEnabled:enabled,rawNoticeVersion:'local-plain-v1'}));};
const text='Synthetic installed local authority source.';
const request={namespace,client,sessionId:'synthetic-session',eventId:'synthetic-event',messages:[{
  id:'source',role:'user',occurredAt:null,messageOrdinal:1,content:text,
  part:{index:0,start:0,totalUnits:text.length,totalBytes:Buffer.byteLength(text)},
}]};
const snapshot=value=>({version:'local-capture-authority-v1',targetId:value.targetId,storeId:value.storeId,namespace,client,
  expectedControlRevision:value.revision,expectedConsentGeneration:value.consentGeneration,
  expectedNamespaceGeneration:'initial',expectedRawRevision:0});
const createWorker=authority=>openMemoryCore({path,model:{contextWindow:8192,countTokens:()=>1,
  extract:({input})=>{modelCalls++;return {items:[{content:input.messages[0].content,kind:'context',confidence:.5,sourceIndices:[0]}]};},
  classify:({input})=>({items:input.memories.map(memory=>({memoryId:memory.id,parentIds:[]}))})},
  rawConversations:{mode:'raw-v1',capBytes:1000000,readPolicy,localAuthority:authority,
    port:{version:'raw-seal-v1',sealRaw:({text})=>({format:'local-plain-v1',keyVersion:null,sealed:Buffer.from(text)}),
      openRaw:({sealed})=>({text:Buffer.from(sealed).toString()})}}});
try {
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,29);
  assert.equal(control.getPrivateCardCapabilities,undefined);
  if(phase==='grant') {
    assert.equal(get().revision,0);assert.equal(db.prepare('SELECT count(*) n FROM local_capture_controls').get().n,0);
    const grant=set(true);fs.writeFileSync(statePath,JSON.stringify({grant,authority:snapshot(grant)}),{flag:'wx',mode:0o600});
  } else {
    const state=JSON.parse(fs.readFileSync(statePath,'utf8'));
    if(phase==='capture') {
      assert.deepEqual(get(),state.grant);worker=createWorker(state.authority);
      const result=ok(await worker.captureRaw(request));ok(result.interpretation);assert.equal(result.raw.parts[0].saved,true);
      assert.equal(db.prepare('SELECT count(*) n FROM memories WHERE deleted=0').get().n,1);
      const calls=modelCalls;ok(await worker.captureRaw(request));assert.equal(modelCalls,calls);
      fs.writeFileSync(statePath,JSON.stringify({...state,raw:result.raw}),{mode:0o600});
    } else if(phase==='revoke') {const revoked=set(false);assert.notEqual(revoked.consentGeneration,state.grant.consentGeneration);}
    else if(phase==='reopen') {
      assert.equal(get().automaticCaptureEnabled,false);worker=createWorker(state.authority);
      denied(await worker.captureRaw(request),'capture_disabled');assert.equal(modelCalls,0);
      assert.deepEqual(JSON.parse(db.prepare('SELECT result FROM raw_events').get().result),state.raw);
      assert.equal(db.prepare('SELECT count(*) n FROM memories WHERE deleted=0').get().n,1);
    } else {
      worker=createWorker(state.authority);denied(await worker.captureRaw({...request,messages:[]}), 'invalid_input');
      throw Error('synthetic_installed_deliberate_failure');
    }
  }
  process.stdout.write(JSON.stringify({phase,client,pid:process.pid,importedCore,modelCalls,networkCalls}));
} finally {worker?.close();db.close();control.close();}
