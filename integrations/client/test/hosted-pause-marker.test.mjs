import { deferred } from '../../../tools/testing/deferred.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {join} from 'node:path';
import {fork} from 'node:child_process';
import {createServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {createTestWorkspace} from '../../../tools/testing/workspace.mjs';
import {observeHostedPause,withHostedPauseGate} from '../hosted-pause.mjs';
import {readControlState,startIfActive} from '../control-state.mjs';
import {stateLock} from '../state-lock.mjs';
for(const sink of ['request','output'])test(`cross-process publication after final synchronous read fences ${sink}`,{timeout:20000},async t=>{
 const workspace=createTestWorkspace(t);
 const root=join(workspace.path,'state');await fs.mkdir(root,{mode:0o700});
 const a={root,endpoint:'http://127.0.0.1:1'},b={root,endpoint:'http://127.0.0.1:2'};
 const nativeFetch=globalThis.fetch;
 t.mock.method(globalThis,'fetch',async url=>Response.json({paused:false,generation:url.startsWith(a.endpoint+'/')?1:0,enforced:true}));
 await observeHostedPause(a,'synthetic-token');await observeHostedPause(b,'synthetic-token');
 const local=await readControlState(root);
 let delivered=false;const finish=deferred();
 const before=await withHostedPauseGate(b,0,guard=>startIfActive(root,local.generation,()=>finish.promise.then(()=>{delivered=true;}),{guard}));
 assert.equal(before.started,true);
 let published=false,wireStarts=0,wireBody='';
 const server=createServer(async(req,res)=>{wireStarts++;for await(const bytes of req)wireBody+=bytes;res.end('ok');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const endpoint='http://127.0.0.1:'+server.address().port;
 const children=[];
 function launch(role){
  const child=fork(new URL('./fixtures/pause-postread.mjs',import.meta.url),[role,root,sink,local.generation,endpoint],{stdio:['ignore','pipe','pipe','ipc']});
  const messages=new Map(),waiting=new Map();let stdout='',stderr='';
  child.stdout.on('data',v=>{stdout+=v;});child.stderr.on('data',v=>{stderr+=v;});
  const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
  child.on('message',m=>{messages.set(m.kind,m);waiting.get(m.kind)?.resolve(m);if(m.kind==='failed')waiting.forEach(v=>v.reject(Error(m.error)));});
  const event=kind=>{if(messages.has(kind))return Promise.resolve(messages.get(kind));const p=deferred();waiting.set(kind,p);return Promise.race([p.promise,done.then(()=>{throw Error('child_closed_before_'+kind+':'+JSON.stringify([...messages.values()])+stderr);})]);};
  const result={child,done,event,send:(kind,time)=>child.send({kind,time}),stdout:()=>stdout,stderr:()=>stderr};children.push(result);return result;
 }
 const held=deferred(),release=deferred();
 const old=stateLock(join(root,'hosted-pause.gate'),async()=>{held.resolve();await release.promise;});
 workspace.defer(async()=>{release.resolve();finish.resolve();await fs.writeFile(join(root,'release-sender'),'go',{mode:0o600});for(const c of children)if(c.child.exitCode===null&&c.child.signalCode===null)c.child.kill('SIGKILL');await Promise.allSettled([old,...children.map(c=>c.done)]);await new Promise(resolve=>server.close(resolve));globalThis.fetch=nativeFetch;});
 await held.promise;
 const publisher=launch('publisher');await publisher.event('waiter');release.resolve();await old;
 const sender=launch('sender');
 const until=Date.now()+10000;
 while(!await fs.stat(join(root,'sender-after-read')).then(()=>true,()=>false)){if(Date.now()>until)throw Error('postread_not_reached');await delay(2);}
 publisher.send('release-waiter',251);
 const publication=await Promise.race([publisher.event('pending'),publisher.event('durable')]);
 const pendingAt=performance.now();
 published=publication.kind==='durable';
 if(published)await fs.writeFile(join(root,'committed'),'yes',{mode:0o600});
 assert.equal((await readControlState(root)).generation,local.generation,'root_rotation_blocked_by_sender');
 await fs.writeFile(join(root,'release-sender'),'go',{mode:0o600});
 const result=await sender.event('done');
 if(published)publisher.send('continue-publisher',251);
 else {await publisher.event('durable');publisher.send('continue-publisher',251);}
 await publisher.event('done');
 finish.resolve();await before.operation;assert.equal(delivered,true,'earlier_operation_completed_after_commit');
 let postCommitStarts=0;
 const afterCommit=await withHostedPauseGate(b,0,guard=>startIfActive(root,local.generation,()=>{postCommitStarts++;},{guard}));
 assert.equal(afterCommit.started,false,'old_local_generation_revoked_after_commit');
 assert.equal(postCommitStarts,0,'zero_starts_after_commit');
 t.diagnostic(JSON.stringify({crash:false,pendingToCommitMs:performance.now()-pendingAt}));
 for(const child of children){assert.deepEqual(await child.done,{code:0,signal:null});assert.equal(child.stderr(),'');}
 t.diagnostic(JSON.stringify({sink,starts:result.starts,wireStarts,wireBody,stdout:sender.stdout(),publication:publication.kind,earlierOperationCompleted:delivered}));
 assert.equal(result.afterCommit,0,'no_start_after_cross_process_durable_publication');
 assert.equal(publication.kind,'pending','contended_publisher_queues_instead_of_committing');
 assert.equal(result.starts,1,'holder_admitted_before_commit_can_finish');
 if(sink==='request'){assert.equal(wireStarts,1);assert.equal(wireBody,'synthetic paused-period text');}
 else assert.equal(sender.stdout(),'synthetic recalled context');
});


test('hosted resume supplies a stable active local generation and the next pause revokes it', async t => {
  const root = join(createTestWorkspace(t).path, 'state'); await fs.mkdir(root, { mode: 0o700 });
  const config = { root, endpoint: 'http://127.0.0.1:1' };
  let remote = { paused: true, generation: 1, enforced: true };
  t.mock.method(globalThis, 'fetch', async () => Response.json(remote));
  await observeHostedPause(config, 'synthetic-token');
  assert.notEqual((await readControlState(root)).generation, 'initial');
  await assert.rejects(withHostedPauseGate(config, 1, () => assert.fail('paused_send')), /pause_unavailable/);
  remote = { ...remote, paused: false, generation: 2 }; await observeHostedPause(config, 'synthetic-token');
  const start = await readControlState(root);
  assert.equal(start.valid, true); assert.equal(start.paused, false); assert.notEqual(start.generation, 'initial');
  await observeHostedPause(config, 'synthetic-token');
  assert.deepEqual(await readControlState(root), start);
  remote = { ...remote, paused: true, generation: 3 }; await observeHostedPause(config, 'synthetic-token');
  remote = { ...remote, paused: false, generation: 4 }; await observeHostedPause(config, 'synthetic-token');
  assert.notEqual((await readControlState(root)).generation, start.generation);
});
