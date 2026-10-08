import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { privateWrite } from '../lib/private-state.mjs';
import { policyPath, automaticGuard } from '../../../integrations/client/automatic-policy.mjs';
import { observeHostedPause } from '../../../integrations/client/hosted-pause.mjs';
import { readControlState } from '../lib/control-state.mjs';
import { opaqueProjectId } from '../lib/pairing.mjs';

const hook = new URL('../scripts/hook.mjs',import.meta.url).pathname;
const endpoint = 'https://synthetic.invalid';
async function fixture(t) {
  const ws = createTestWorkspace(t);const home=join(ws.path,'home'),root=join(ws.path,'data');
  await mkdir(home,{mode:0o700});await mkdir(root,{mode:0o700});
  await opaqueProjectId(root,'/project',{home});
  const calls=join(ws.path,'calls.jsonl'),preload=join(ws.path,'memory-preload.mjs');await writeFile(calls,'');
  // In-memory fetch only. Actual hook/payload validators and cursor I/O run.
  await writeFile(preload,`import {appendFileSync,readFileSync,writeSync} from 'node:fs';
    import {PassThrough} from 'node:stream';
    // Use the actual closed pipe bytes with synchronous I/O before module load;
    // this sandbox's async child stdio can drop data. No host credential/env read.
    const stream=new PassThrough();stream.end(readFileSync(0));Object.defineProperty(process,'stdin',{value:stream});
    process.stdout.write=(value,_encoding,callback)=>{writeSync(1,value);if(typeof _encoding==='function')_encoding();else callback?.();return true;};
    globalThis.fetch=async(url,options)=>{const path=new URL(url).pathname;
      if(path.endsWith('/pause-state'))throw new Error('Claude must never require the Codex pause gate');
      appendFileSync(${JSON.stringify(calls)},JSON.stringify({path,body:JSON.parse(options.body)})+'\\n');
      return Response.json(path.endsWith('/recall')?{memories:[{
        id:'12345678-1234-4234-8234-123456789abc',content:'Memory still works.',kind:'preference',scope:'personal',projectId:null,
        origin:'explicit',confidence:1,createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',
        receipts:[{client:'claude-code',sessionId:'s',eventId:'e',role:'user',excerpt:'Remember useful tests.',createdAt:'2026-10-01T00:00:00Z'}]
      }]}:{duplicate:false,memoryCount:1});};`);
  const env={HOME:home,PATH:process.env.PATH,TMPDIR:process.env.TMPDIR,
    ...(process.env.CAIRN_TEST_REAL_HOME ? {NODE_OPTIONS:'--import='+new URL('../../../integrations/client/testing/home-guard.mjs',import.meta.url).href,CAIRN_TEST_REAL_HOME:process.env.CAIRN_TEST_REAL_HOME} : {}),
    CLAUDE_PLUGIN_DATA:root,CLAUDE_PLUGIN_OPTION_API_ENDPOINT:endpoint,
    CLAUDE_PLUGIN_OPTION_API_TOKEN:'synthetic-Claude-token',CLAUDE_PLUGIN_OPTION_TELEMETRY:'false'};
  async function run(action,input={},extraEnv={}) {
    const child=spawn(process.execPath,['--import',pathToFileURL(preload).href,hook,action],{
      cwd:ws.path,env:{...env,...extraEnv},stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
    child.stdin.end(JSON.stringify(input));const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
    return {code,stdout,stderr};
  }
  return {ws,root,home,run,calls,policyFile:policyPath(root,endpoint)};
}

for(const state of ['absent','malformed','future','unreadable']) test('Claude preserves released capture/recall/pause/resume with '+state+' Codex policy',async t=>{
  const f=await fixture(t);
  if(state!=='absent') {
    await privateWrite(f.policyFile,state==='malformed'?'{':JSON.stringify({version:state==='future'?2:1,dailyCap:1,concurrency:2}));
    if(state==='unreadable')await chmod(f.policyFile,0o644); // strict private read refuses unsafe permissions
  }
  const initial=await f.run('status');assert.equal(initial.code,0,initial.stderr);assert.match(initial.stdout,/memory: active/);
  const transcript=join(f.ws.path,'transcript.jsonl');
  await writeFile(transcript,JSON.stringify({type:'user',uuid:'u',message:{content:'Prefer useful tests.'}})+'\n');
  for(const [action,input] of [['capture',{hook_event_name:'Stop',session_id:'s',cwd:'/project',transcript_path:transcript}],
    ['recall',{hook_event_name:'UserPromptSubmit',session_id:'s',cwd:'/project',prompt:'Preferences?'}],['pause',{}],['resume',{}]]) {
    const result=await f.run(action,input);assert.equal(result.code,0,result.stderr);assert.equal(result.stderr,'');
    if(action==='recall')assert.match(result.stdout,/Memory still works/);
  }
  const requests=(await readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(requests.map(r=>r.path),['/api/memory/capture','/api/memory/recall']);
  const status=await f.run('status');assert.equal(status.code,0,status.stderr);
  if(state==='absent') assert.ok(!status.stdout.includes('Codex policy'));
  else assert.match(status.stdout,/Codex policy invalid or unreadable/);
  assert.equal((await readControlState(f.root)).paused,false);
});

for(const value of ['rel-data','']) test('Claude legacy '+JSON.stringify(value)+' data path keeps pause/status working without private-policy dependency',async t=>{
  const f=await fixture(t);
  const transcript=join(f.ws.path,'transcript.jsonl');await writeFile(transcript,JSON.stringify({type:'user',uuid:'u',message:{content:'Legacy memory works.'}})+'\n');
  // Empty plugin-data has released control semantics; do not invent new recall
  // behavior for that legacy path. A relative data path also exercises capture.
  const memoryCalls=value ? [['capture',{hook_event_name:'Stop',session_id:'s',cwd:'/project',transcript_path:transcript}],
    ['recall',{hook_event_name:'UserPromptSubmit',session_id:'s',cwd:'/project',prompt:'Remember?'}]] : [];
  for(const [action,input] of [...memoryCalls,['pause',{}],['status',{}],['resume',{}]]) {
    const result=await f.run(action,input, {CLAUDE_PLUGIN_DATA:value});assert.equal(result.code,0,result.stderr);assert.equal(result.stderr,'');
    if(action==='recall')assert.match(result.stdout,/Memory still works/);
  }
  assert.deepEqual((await readFile(f.calls,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse).map(x=>x.path),
    value ? ['/api/memory/capture','/api/memory/recall'] : []);
});

for(const response of [()=>Response.json({error:'missing'},{status:404}),()=>Response.json({paused:false,generation:0,enforced:false})]) {
  test('Claude keeps working when shared pause gate is unavailable; status reports it; Codex cap never limits Claude',async t=>{
    const f=await fixture(t),policy={version:1,dailyCap:1,concurrency:2};await privateWrite(f.policyFile,JSON.stringify(policy));
    const guard=automaticGuard(f.root,endpoint,policy);const permit=await guard.reserve();assert.equal(permit.ok,true);
    await guard.dispatch(permit.id,()=>({started:true,operation:Promise.resolve()}));await guard.release(permit.id,{terminated:true,accepted:true});
    assert.equal((await guard.reserve()).code,'daily_cap_reached');
    const original=globalThis.fetch;globalThis.fetch=response;
    try {await assert.rejects(observeHostedPause({root:f.root,endpoint},'synthetic-Codex-token',AbortSignal.timeout(2000)),/pause_unavailable/);}
    finally {globalThis.fetch=original;}
    const transcript=join(f.ws.path,'transcript.jsonl');await writeFile(transcript,JSON.stringify({type:'user',uuid:'u',message:{content:'Memory still works.'}})+'\n');
    const capture=await f.run('capture',{hook_event_name:'Stop',session_id:'s',cwd:'/project',transcript_path:transcript});
    const recall=await f.run('recall',{hook_event_name:'UserPromptSubmit',session_id:'s',cwd:'/project',prompt:'Remember?'});
    assert.equal(capture.code,0);assert.equal(recall.code,0);assert.match(recall.stdout,/Memory still works/);
    assert.deepEqual((await readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse).map(x=>x.path),['/api/memory/capture','/api/memory/recall']);
    const status=await f.run('status');assert.equal(status.code,0);assert.match(status.stdout,/shared pause gate unavailable/);
    assert.match(status.stdout,/Codex daily cap applies only to Codex/);
    assert.equal((await guard.status()).state.used,1); // Claude never reserves/charges the local Codex guard.
  });
}
