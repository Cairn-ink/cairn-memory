import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fork} from 'node:child_process';
import {createTestWorkspace} from '../../../tools/testing/workspace.mjs';
import {observeHostedPause,withHostedPauseGate,deferHostedPauseStatus} from '../hosted-pause.mjs';
import {hostedTargetId} from '../transport-hosted.mjs';
import {readControlState,startIfActive} from '../control-state.mjs';
import {stateLock} from '../state-lock.mjs';
import {withWriteObserver,privateWrite} from '../private-state.mjs';
async function fixture(t){
 const root=join(createTestWorkspace(t).path,'state');await mkdir(root,{mode:0o700});
 const config={root,endpoint:'http://127.0.0.1:1'};let remote={generation:0,paused:false,enforced:true};
 t.mock.method(globalThis,'fetch',async()=>Response.json(remote));
 const observe=()=>deferHostedPauseStatus(config,'synthetic-token').observe();await observe();
 return {root,config,observe,set:v=>{remote={...v,enforced:true};},file:join(root,'hosted-pause',hostedTargetId(config)+'.json')};
}
async function marker(f,generation,paused){
 const path=join(f.root,'hosted-pause-pending',`${hostedTargetId(f.config)}.${generation}.${paused}.json`);
 await privateWrite(path,JSON.stringify({generation,paused}));return path;
}

test('publisher crash after durable marker: next holder replays before any send',{timeout:20000},async t=>{
 const f=await fixture(t),local=await readControlState(f.root);
 const held=Promise.withResolvers(),release=Promise.withResolvers();
 const old=stateLock(join(f.root,'hosted-pause.gate'),async()=>{held.resolve();await release.promise;});
 await held.promise;
 const child=fork(new URL('./fixtures/pause-marker-crash.mjs',import.meta.url),[f.root],{stdio:['ignore','ignore','pipe','ipc']});
 let stderr='';child.stderr.on('data',v=>{stderr+=v;});
 const done=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
 t.after(async()=>{release.resolve();if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await Promise.allSettled([old,done]);});
 const event=await Promise.race([new Promise(resolve=>child.once('message',resolve)),done.then(()=>{throw Error('publisher_exited_before_marker:'+stderr);})]);
 assert.equal(event.kind,'pending','durable_pending_marker_required');
 const pendingAt=performance.now();
 const pending=join(f.root,'hosted-pause-pending',`${hostedTargetId(f.config)}.1.true.json`);
 assert.deepEqual(JSON.parse(await readFile(pending,'utf8')),{generation:1,paused:true},'marker_is_content_free');
 assert.deepEqual(JSON.parse(await readFile(f.file,'utf8')),{generation:0,paused:false,enforced:true},'no_outside_gate_commit');
 child.kill('SIGKILL');assert.equal((await done).signal,'SIGKILL');release.resolve();await old;
 let starts=0;
 await assert.rejects(withHostedPauseGate(f.config,0,guard=>startIfActive(f.root,local.generation,()=>{starts++;},{guard})),/pause_unavailable/);
 const replayMs=performance.now()-pendingAt;
 assert.equal(starts,0,'nothing_paused_sent');
 assert.deepEqual(JSON.parse(await readFile(f.file,'utf8')),{generation:1,paused:true,enforced:true},'next_holder_replayed_pause');
 assert.notEqual((await readControlState(f.root)).generation,local.generation,'replay_rotated');
 assert.deepEqual(await readdir(join(f.root,'hosted-pause-pending')),[],'replayed_marker_retired');
 f.set({generation:1,paused:false});await f.observe();await withHostedPauseGate(f.config,1,()=>{starts++;});
 assert.equal(starts,1,'resume_reopens');
 t.diagnostic(JSON.stringify({crash:true,pendingToReplayMs:replayMs,pendingToReopenMs:performance.now()-pendingAt}));
});

test('stale pending pause cannot undo a later validated resume',{timeout:10000},async t=>{
 const f=await fixture(t);f.set({generation:2,paused:false});await f.observe();
 await marker(f,1,true);
 await withHostedPauseGate(f.config,2,()=>{});
 assert.deepEqual(await readdir(join(f.root,'hosted-pause-pending')),[],'stale_marker_retired');
 assert.deepEqual(JSON.parse(await readFile(f.file,'utf8')),{generation:2,paused:false,enforced:true},'newer_resume_preserved');
});

test('pause then marker then resume at the same generation reopens only after publication',{timeout:10000},async t=>{
 const f=await fixture(t);f.set({generation:1,paused:true});await f.observe();
 await marker(f,1,true);
 f.set({generation:1,paused:false});await f.observe();
 let starts=0;await withHostedPauseGate(f.config,1,()=>{starts++;});
 assert.equal(starts,1,'same_generation_resume_reopens');
 assert.deepEqual(await readdir(join(f.root,'hosted-pause-pending')),[],'same_generation_marker_retired');
});

test('warm unchanged contention fails closed without writing a pending marker',{timeout:10000},async t=>{
 const f=await fixture(t),held=Promise.withResolvers(),release=Promise.withResolvers();
 const holder=stateLock(join(f.root,'hosted-pause.gate'),async()=>{held.resolve();await release.promise;});
 t.after(async()=>{release.resolve();await holder;});await held.promise;
 await assert.rejects(f.observe(),/state_busy/,'unchanged_observation_does_not_bypass_gate');
 await assert.rejects(readdir(join(f.root,'hosted-pause-pending')),{code:'ENOENT'},'unchanged_observation_does_not_write_marker');
 release.resolve();await holder;
});


test('publisher budget ends after marker: durable knowledge survives the abort',{timeout:10000},async t=>{
 const f=await fixture(t),held=Promise.withResolvers(),release=Promise.withResolvers();
 const holder=stateLock(join(f.root,'hosted-pause.gate'),async()=>{held.resolve();await release.promise;});
 t.after(async()=>{release.resolve();await holder;});await held.promise;
 f.set({generation:1,paused:true});const controller=new AbortController();let marked=false;
 await assert.rejects(withWriteObserver(({path,kind})=>{
  if(kind==='write'&&path.includes('/hosted-pause-pending/')){marked=true;controller.abort();}
 },()=>observeHostedPause(f.config,'synthetic-token',controller.signal)));
 assert.equal(marked,true,'budget_expiration_retains_marker');
 assert.equal(JSON.parse(await readFile(f.file,'utf8')).generation,0,'aborted_publisher_did_not_commit_outside_gate');
 release.resolve();await holder;
 await assert.rejects(withHostedPauseGate(f.config,0,()=>assert.fail('paused_send')),/pause_unavailable/);
 assert.equal(JSON.parse(await readFile(f.file,'utf8')).generation,1,'next_holder_replayed_after_abort');
});
