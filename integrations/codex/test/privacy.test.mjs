import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { testServer, wireChild, childEnvironment } from './http-harness.mjs';
import { spawn } from 'node:child_process';
import { writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture,header,item,jsonl,session } from './helpers.mjs';
import { runWorker } from '../worker.mjs';
import { captureSnapshot } from '../../../core/capture-input.mjs';
import { normalizeBlocks, preflight } from '../../client/common-profile.mjs';

test('A1 actual hook → worker → loopback body, output and private state exclude canaries',async t=>{
  const secret='sk-'+'A'.repeat(32);
  const exclusions=[
    {type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'CWD_CANARY SANDBOX_CANARY INSTRUCTIONS_CANARY'}]}},
    {type:'response_item',payload:{type:'reasoning',summary:[{text:'REASONING_CANARY'}]}},
    {type:'turn_context',payload:{cwd:'/synthetic/CWD_CANARY',sandbox_root:'/SANDBOX_CANARY'}},
    ...['HookPrompt','Reasoning','CommandExecution','FunctionCallOutput','ContextCompaction','ImageView'].map(type=>
      ({type:'event_msg',payload:{type:'item_completed',thread_id:session,turn_id:'turn',item:{type,id:type,text:type+'_CANARY'}}})),
    {type:'event_msg',payload:{type:'user_message',message:'MIRROR_CANARY'}},
    {type:'compacted',payload:{message:'COMPACTION_CANARY'}},
  ].map(jsonl).join('');
  const spanning=JSON.parse(item('Prefer notes. sk-'+'B'.repeat(20),2));
  spanning.payload.item.content.push({type:'text',text:'SPLIT_SECRET_CANARY',text_elements:[]});
  const text=header()+exclusions+JSON.stringify(spanning)+'\n'+item(`Prefer diagrams. ${secret}`)+item('Understood.',1,'assistant',
    {phase:'final_answer',memory_citation:{text:'CITATION_CANARY'}});
  const f=await fixture(t,{text});
  const bodies=[];
  const server=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req) raw+=chunk;
    bodies.push(JSON.parse(raw));res.setHeader('content-type','application/json');
    res.end(JSON.stringify({status:'complete',eventId:bodies.at(-1).event_id}));
  });
  const http=await testServer(server,f.ws);
  const cfg=join(f.ws.path,'stub-config.json');
  // The real hook process runs on the virtual lock clock: a cold first hook on a
  // slow or busy host must not expire its budget and skip the asserted delivery.
  await writeFile(cfg,JSON.stringify({clientOptions:{home:f.home,root:f.root,usesClaude:false,env:{}},
    targetId:f.binding.targetId,endpoint:http.endpoint,wire:http.wire,
    virtualLockClock:true,lockClockResult:join(f.ws.path,'hook-clock.json')}),{mode:0o600});
  const child=spawn(process.execPath,[new URL('./process-stub.mjs',import.meta.url).pathname,'hook',cfg],{stdio:['pipe','pipe','pipe',...(http.wire?['ipc']:[])],env:childEnvironment()});
  if(http.wire)wireChild(child,server);
  let output='',stderr='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>stderr+=x);
  child.stdin.end(JSON.stringify({hook_event_name:'Stop',session_id:session,cwd:'/synthetic/CWD_CANARY',transcript_path:f.path,
    last_assistant_message:'HOOK_ASSISTANT_CANARY',expanded_input:'HOOK_CONTEXT_CANARY',token:secret}));
  const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  assert.equal(exit,0);assert.equal(output,'{}');assert.equal(stderr,'');assert.equal(bodies.length,1);
  assert.deepEqual(bodies[0].messages.map(x=>x.content),['Prefer diagrams. [REDACTED]','Understood.']);
  const state=[];
  for(const dir of ['codex-cursors','usage']) for(const name of await readdir(join(f.root,dir)))
    state.push(await readFile(join(f.root,dir,name),'utf8'));
  const delivered=JSON.stringify([bodies,state,output,stderr]);
  for(const canary of [secret,'CANARY',session,f.path]) assert.ok(!delivered.includes(canary),canary);
  assert.ok(!(await readdir(f.root)).includes('sessions'));
});

test('A1 NFKC expansion, code points, cutoff tail and qualifiers remain visibly incomplete',async t=>{
  for(const text of ['x'.repeat(4000)+' cancel A, use B', 'x'.repeat(3999)+'😀except on Friday', '\uFDFA'.repeat(500)]) {
    const f=await fixture(t,{text:header()+item(text)});
    await runWorker(f.binding,{transport:f.transport,guard:f.guard});
    const state=await f.cursor();assert.equal(state.truncated,1);assert.equal(state.unconfirmedTail,true);
    const body=[...f.receiver.values()][0];assert.ok(body.messages[0].content.isWellFormed());
    assert.ok(body.messages[0].content.length<=4000);
    const snap=captureSnapshot({namespace:{ownerId:'synthetic',scope:'project',projectId:body.project_id},
      client:body.client,eventId:body.event_id,sessionId:body.session_id,messages:body.messages});
    assert.deepEqual(snap.messages,body.messages);
  }
});

test('A1 rejects NUL, malformed Unicode, empty and redaction-only strings; joins before redaction',()=>{
  for(const text of ['\0','\ud800',' ','sk-'+'X'.repeat(24),'sk-'+'X'.repeat(24)+' sk-'+'Y'.repeat(24)])
    assert.equal(normalizeBlocks([text]).reason,'invalid_text');
  assert.equal(normalizeBlocks(['Prefer notes. sk-','Z'.repeat(30)]).content,'Prefer notes. [REDACTED]');
  assert.equal(normalizeBlocks(['Prefer notes. sk-'+'Z'.repeat(20),'SPLIT_SECRET_CANARY']).reason,'invalid_text');
});

test('A1 exact serialized JSON byte bound splits before the canonical unit bound',async t=>{
  const f=await fixture(t,{text:header()+Array.from({length:6},(_,i)=>item('\u0001'.repeat(3999),i)).join('')});
  await runWorker(f.binding,{transport:f.transport,guard:f.guard});
  assert.equal(f.receiver.size,3);
  for(const body of f.receiver.values()) {assert.ok(Buffer.byteLength(JSON.stringify(body))<=65536);preflight(body);}
});
