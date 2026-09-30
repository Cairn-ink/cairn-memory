import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile,writeFile,symlink,chmod,mkdir,readFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { join } from 'node:path';
import { fixture,header,item,session } from './helpers.mjs';
import { runWorker,prepareCapture,resetCapture } from '../worker.mjs';
import { readHookInput,handleHook,workerFromHandoff } from '../hook.mjs';
import { withSourceReadObserver } from '../source.mjs';
import { setPaused,readControlState } from '../../client/control-state.mjs';
import { cursorPath,validateCursor,publishCursor } from '../cursor.mjs';

test('A4 partial lines and appends preserve frozen IDs and coverage',async t=>{
  const first=header()+Array.from({length:50},(_,i)=>item(`Human ${i}`,i)).join('');
  const f=await fixture(t,{text:first});
  await prepareCapture(f.binding);f.fail('timeout');
  await runWorker(f.binding,{transport:f.transport,guard:f.guard});
  const frozen=f.calls[0];
  const partial=item('After the frozen window',60);
  await appendFile(f.path,partial.slice(0,-10));f.clear();
  await runWorker(f.binding,{transport:f.transport,guard:f.guard});
  assert.deepEqual(f.calls[1],frozen);assert.equal((await f.cursor()).offset,Buffer.byteLength(first));
  assert.equal((await runWorker(f.binding,{transport:f.transport,guard:f.guard})).status,'partial_tail');
  await appendFile(f.path,partial.slice(-10));
  await runWorker(f.binding,{transport:f.transport,guard:f.guard});
  const messages=[...f.receiver.values()].flatMap(x=>x.messages);
  assert.equal(messages.length,51);assert.equal(new Set(messages.map(x=>x.id)).size,51);
});

test('A4 oversized multi-window stream discard is bounded and resumes after its newline',async t=>{
  const f=await fixture(t,{text:header()+'x'.repeat(2100000)});
  for(let i=0;i<4;i++) {
    let bytes=0;
    await withSourceReadObserver(({start,end})=>bytes+=end-start,
      ()=>runWorker(f.binding,{transport:f.transport,guard:f.guard}));
    assert.ok(bytes<=1048576,`read ${bytes}`);
  }
  await appendFile(f.path,'\n'+item('Fresh text after oversized line'));
  await runWorker(f.binding,{transport:f.transport,guard:f.guard});
  assert.equal(f.receiver.size,1);assert.ok((await f.cursor()).skipped.oversized>=2100001);
});

test('A2/A4 pause, restart, unseen session and split-line barriers never backfill',async t=>{
  const f=await fixture(t);
  const run=()=>runWorker(f.binding,{transport:f.transport,guard:f.guard});
  await run();
  const split=item('Text spanning pause');await appendFile(f.path,split.slice(0,-10));await run();
  await setPaused(f.root,true);await appendFile(f.path,split.slice(-10,-4));
  let bytes=0;await withSourceReadObserver(({start,end})=>bytes+=end-start,run);assert.equal(bytes,0);
  await setPaused(f.root,false);assert.equal((await run()).status,'pause_boundary');
  await appendFile(f.path,split.slice(-4)+item('Fresh after resume'));await run();
  assert.deepEqual([...f.receiver.values()].flatMap(x=>x.messages.map(m=>m.content)),['Fresh after resume']);
  const next='22222222-2222-4222-8222-222222222222',path=f.path+'.unseen';
  await writeFile(path,(header()+item('Unseen spanning history')).replaceAll(session,next));
  const result=await runWorker({...f.binding,path,sessionId:next},{transport:f.transport,guard:f.guard});
  assert.equal(result.status,'pause_boundary');assert.equal(f.receiver.size,1);
});

test('A4 single writer rejects backwards cursors and misspelled or corrupt facts; explicit reset records EOF',async t=>{
  const f=await fixture(t,{text:header()+item('Human')});
  await runWorker(f.binding,{transport:f.transport,guard:f.guard});
  const state=await f.cursor(),path=cursorPath(f.root,f.binding.targetId,session);
  assert.throws(()=>validateCursor({...state,offest:0}),/cursor_state_invalid/);
  await assert.rejects(publishCursor(path,{...state,offset:0,accepted:0,
    skipped:Object.fromEntries(Object.keys(state.skipped).map(x=>[x,0]))},state),/cursor_backwards/);
  await resetCapture(f.binding,{hostsStopped:true,confirm:true});
  assert.equal((await f.cursor()).skipped.state_reset,state.offset);
  await writeFile(path,'{corrupt');await assert.rejects(runWorker(f.binding,{transport:f.transport,guard:f.guard}),/cursor_state_invalid/);
});

test('A5 bounded stalled/oversized/malformed stdin and successful fail-open hook outputs',async()=>{
  const stalled=new PassThrough();const began=performance.now();
  await assert.rejects(readHookInput(stalled,{deadlineMs:30}),/invalid_hook_input/);
  assert.ok(performance.now()-began<500);
  for(const bytes of ['x'.repeat(65537),'{bad']) {
    const stream=new PassThrough();const read=readHookInput(stream);stream.end(bytes);await assert.rejects(read);
  }
  for(const input of [{}, {hook_event_name:'Stop'},
    {hook_event_name:'Stop',session_id:session,cwd:'/synthetic',transcript_path:null}]) {
    const result=await handleHook(input);assert.ok(['','{}'].includes(result.output));
  }
});

test('A5 spawn, binding, source, permissions and unknown replies fail without stale dispatch',async t=>{
  const f=await fixture(t,{text:header()+item('Human')});
  const input={hook_event_name:'Stop',session_id:session,cwd:'/synthetic',transcript_path:f.path};
  const config={clientOptions:{home:f.home,root:f.root,usesClaude:false,env:{}},targetId:f.binding.targetId,
    launch:()=>{throw new Error('spawn failed');}};
  const result=await handleHook(input,config);assert.equal(result.output,'{}');assert.equal(result.status,'capture_unavailable');
  const badBinding=await handleHook(input,{...config,clientOptions:{home:f.home,root:f.root,env:{}}});
  assert.equal(badBinding.output,'{}');assert.equal(f.calls.length,0);
  const linked=f.path+'.link';await symlink(f.path,linked);
  assert.equal((await runWorker({...f.binding,path:linked},{guard:f.guard,transport:f.transport})).status,'source_unavailable');
  await setPaused(f.root,true);const control=await readControlState(f.root);
  await setPaused(f.root,false);
  assert.equal((await workerFromHandoff({client:'codex',parser:'codex-0.157.1-paginated-v1',sessionId:session,
    path:f.path,cwd:'/synthetic',generation:'initial',byteEnd:10,endIntent:false},{...config,guard:f.guard,transport:f.transport})).status,'paused');
  assert.notEqual(control.generation,'initial');
});

test('A5 local uncertainty fences 125 seconds and preserves event identity; termination uncertainty retains permit',async t=>{
  const f=await fixture(t,{text:header()+item('Human')});let clock=1000000;
  f.fail('lost');const options={guard:f.guard,transport:f.transport,mode:'local-stub',now:()=>clock};
  await runWorker(f.binding,options);const event=f.calls[0].event_id;
  assert.equal((await f.cursor()).notBefore,clock+125000);f.clear();
  await runWorker(f.binding,options);assert.equal(f.calls.length,1);
  clock+=125000;await runWorker(f.binding,options);assert.equal(f.calls[1].event_id,event);assert.equal(f.receiver.size,1);
  const other=await fixture(t,{text:header()+item('Unknown child')});
  const transport={terminated:()=>false,capture:()=>new Promise(()=>{})};
  await runWorker(other.binding,{guard:other.guard,transport,requestMs:30,overallMs:100});
  assert.equal((await other.guard.status()).state.reservations.length,1);
  assert.equal((await other.cursor()).accepted,0);
});

test('A5 local scripted success beyond 30 seconds stays within the unchanged local budget',async t=>{
  const f=await fixture(t,{text:header()+item('Slow scripted local success')});
  const began=performance.now();
  const transport={terminated:()=>true,capture:async body=>{
    await new Promise(r=>setTimeout(r,31000));return {status:'complete',eventId:body.event_id};
  }};
  const result=await runWorker(f.binding,{guard:f.guard,transport,mode:'local-stub'});
  assert.ok(performance.now()-began>=30000);assert.equal(result.status,'idle');assert.ok(result.state.accepted>0);
});
