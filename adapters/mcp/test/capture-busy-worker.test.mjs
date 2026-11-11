import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { readFileSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { workerFixture } from '../../../integrations/client/test/fixtures/local-worker-workspace.mjs';
import { createLocalRawWorker } from '../../../integrations/client/raw/local-worker.mjs';
import { openMemoryCore } from '../../../core/index.mjs';
import { captureLocal } from '../../local/capture.mjs';
import { configuration } from '../../local/configuration.mjs';

const root=new URL('../../../',import.meta.url).pathname;
function fixture(t) {
  const f=workerFixture(t);f.config.interpretation='raw-only';f.save();
  const worker=createLocalRawWorker({...f.options,env:{}});
  const installed=openMemoryCore({path:f.databasePath,raw:true,rawSearch:false});installed.close();
  const db=new DatabaseSync(f.databasePath);f.workspace.defer(()=>db.close());
  return {...f,worker,db};
}
const rows=db=>db.prepare('SELECT count(*) n FROM raw_capture_events').get().n;

async function seed(f,total) {
  const core=openMemoryCore({path:f.databasePath,raw:true,rawSearch:false});f.workspace.defer(()=>core.close());
  const input=f.request('deletion','Synthetic deletion source.');input.session_id='deletion-session';
  const reply=await captureLocal(configuration(f.config),input,{env:{}});assert.equal(reply.status,200);
  const id=reply.body.raw.conversationId,row=f.db.prepare('SELECT * FROM raw_messages WHERE conversation_id=?').get(id),keys=Object.keys(row);
  const insert=f.db.prepare('INSERT INTO raw_messages('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')');
  f.db.exec('BEGIN');
  try{for(let n=2;n<=total;n++)insert.run(...keys.map(key=>key==='message_id'?'synthetic-delete-'+n:key==='ordinal'?n:row[key]));f.db.exec('COMMIT');}
  catch(error){f.db.exec('ROLLBACK');throw error;}
  return id;
}
function deleting(f,id,preload) {
  const child=spawn(process.execPath,[...(preload?['--import',preload]:[]),join(root,'adapters/mcp/cli.mjs'),'raw','delete','--db',f.databasePath,'--owner',f.namespace.ownerId,'--conversation',id,'--yes'],
    {stdio:['ignore','pipe','pipe'],env:{NODE_NO_WARNINGS:'1'}});
  let stdout='',stderr='',ready;const progress=new Promise(resolve=>{ready=resolve;});
  child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>{stderr+=b;if(stderr.includes('prepared'))ready();});
  const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal,stdout,stderr}));});
  f.workspace.defer(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await done;});
  // An import failure or any other early exit must reject immediately, even
  // when another child would otherwise keep the test alive until its timeout.
  return {child,done,progress:Promise.race([progress,done.then(result=>{
    throw new Error('delete child exited before preparation: '+JSON.stringify(result));
  })])};
}

test('concurrent captureLocal defers with busy during a thousand-message CLI deletion and resends every request', {timeout:60000},async t=>{
  const f=fixture(t),id=await seed(f,1008),script=join(f.workspace.path,'concurrent.mjs');
  const trace=join(f.workspace.path,'uuid-trace.jsonl'),preload=join(f.workspace.path,'uuid-trace.mjs'),release=join(f.workspace.path,'release-concurrent-delete');
  const session=f.db.prepare('SELECT session_key FROM raw_conversations WHERE id=?').get(id).session_key;
  // Observe durable completion in either writer, never the rolled-back probe.
  // hrtime is the same monotonic clock across these processes. Record API
  // returns separately from process close, which includes unrelated teardown.
  writeFileSync(preload,`
    import {DatabaseSync} from 'node:sqlite';import {appendFileSync,existsSync} from 'node:fs';import {registerHooks} from 'node:module';
    const trace=${JSON.stringify(trace)},session=${JSON.stringify(session)},exec=DatabaseSync.prototype.exec;let uuidComplete=false;
    const record=value=>appendFileSync(trace,JSON.stringify({...value,pid:process.pid,at:process.hrtime.bigint().toString()})+'\\n');
    DatabaseSync.prototype.exec=function(sql,...args){
      let complete=false;
      if(sql==='COMMIT'&&this.isTransaction&&this.prepare("SELECT 1 FROM sqlite_schema WHERE name='local_raw_uuid_jobs'").get())complete=this.prepare('SELECT complete FROM local_raw_uuid_jobs WHERE session_key=?').get(session)?.complete===1;
      const result=exec.call(this,sql,...args);
      if(complete){uuidComplete=true;record({kind:'uuid-complete-commit'});}
      return result;
    };
    // Keep UUID work pending through three explicit busy replies. The separate
    // final-delete regression below deterministically crosses its epoch commit.
    const writeDelete=process.stderr.write;let heldDelete=false;
    process.stderr.write=function(chunk,...args){const result=writeDelete.call(this,chunk,...args);
      if(!heldDelete&&String(chunk).includes('prepared')){heldDelete=true;
        while(!existsSync(${JSON.stringify(release)}))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
      }return result;};
    globalThis.recordUuidApiReturn=kind=>record({kind,uuidComplete});
    registerHooks({load(url,context,next){const result=next(url,context);
      if(url.endsWith('/core/index.mjs'))return {...result,source:result.source.toString().replace(
        'export { openMemoryCore } from "./contract.mjs";',
        'import {openMemoryCore as original} from "./contract.mjs"; export function openMemoryCore(...args) {const core=original(...args);return {...core,deleteConversation(...input){const result=core.deleteConversation(...input);globalThis.recordUuidApiReturn("delete-api-return");return result;},async captureRaw(...input){const result=await core.captureRaw(...input);globalThis.recordUuidApiReturn("capture-api-return");return result;}};}')};
      return result;}});
  `);
  // A different process uses the real captureLocal adapter and reports every
  // attempt, including uncaught errors, then resends each refused batch only
  // after the deletion process has exited. Keep a refused request unchanged
  // until acknowledged before issuing the next ordinal, just like the worker.
  writeFileSync(script,`
    import {captureLocal} from ${JSON.stringify(new URL('../../local/capture.mjs',import.meta.url).href)};
    import {configuration} from ${JSON.stringify(new URL('../../local/configuration.mjs',import.meta.url).href)};
    import {setTimeout as delay} from 'node:timers/promises';
    const config=configuration(JSON.parse(process.argv[2])),base=JSON.parse(process.argv[3]);process.send({ready:true});
    process.once('message',async()=>{let i=0,pending,finish;const deferred=[];
      const stopped=new Promise(resolve=>finish=resolve);process.once('message',()=>finish());
      for(let attempt=0;attempt<3;attempt++){if(!pending){pending=structuredClone(base);pending.session_id='concurrent-session';pending.event_id='concurrent-'+i;pending.messages[0].id='concurrent-'+i;pending.messages[0].message_ordinal=i+1;}
        const body=pending;
        let result;try{result=await captureLocal(config,body,{env:{}});}catch(error){result={thrown:{code:error.code,errcode:error.errcode}};}
        process.send({result,eventId:body.event_id,at:process.hrtime.bigint().toString()});if(result.status===409&&result.body?.error==='storage_busy')deferred.push(body);
        if(result.status===200){pending=undefined;i++;}
        await delay(250);
      }
      process.send({paused:true});await stopped;
      // After deletion drains, check successful delivery and replay every
      // deferred request. Final-commit overlap has its own deterministic case.
      const result=await captureLocal(config,pending,{env:{}});
      process.send({result,eventId:pending.event_id,at:process.hrtime.bigint().toString()});
      const replay=[];
      for(const body of deferred){const result=await captureLocal(config,body,{env:{}});replay.push({eventId:body.event_id,result,at:process.hrtime.bigint().toString()});}
      process.send({replay});process.disconnect();});
  `);
  const capture=spawn(process.execPath,['--import',preload,script,JSON.stringify(f.config),JSON.stringify(f.request())],{stdio:['ignore','ignore','pipe','ipc']});
  let errors='';capture.stderr.on('data',b=>errors+=b);const results=[];let replay;
  let pause;const paused=new Promise(resolve=>pause=resolve);
  const ready=new Promise(resolve=>capture.once('message',resolve));capture.on('message',m=>{if(m.result)results.push({result:m.result,eventId:m.eventId,at:m.at});if(m.replay)replay=m.replay;if(m.paused)pause();});
  const closed=new Promise((resolve,reject)=>{capture.once('error',reject);capture.once('close',(code,signal)=>resolve({code,signal}));});
  f.workspace.defer(async()=>{if(capture.exitCode===null&&capture.signalCode===null)capture.kill('SIGTERM');await closed;});
  await ready;const deletion=deleting(f,id,preload);await deletion.progress;capture.send({start:true});
  try {await Promise.race([paused,closed.then(result=>{throw Error('capture exited before attempts: '+JSON.stringify({result,errors}));})]);}
  finally {writeFileSync(release,'release');}
  const result=await deletion.done;capture.send({stop:true});assert.equal(result.code,0,JSON.stringify(result));assert.equal(result.signal,null);
  assert.deepEqual(await closed,{code:0,signal:null},errors);
  const events=readFileSync(trace,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  const complete=events.filter(e=>e.kind==='uuid-complete-commit').reduce((a,b)=>BigInt(a.at)<BigInt(b.at)?a:b);
  t.diagnostic(JSON.stringify({attempts:results.length,outcomes:results,uuidCompleteAt:complete.at,events,deferredResent:replay?.length}));
  assert.equal(results.length,4);assert.ok(results.length>0);assert.ok(events.some(e=>e.kind==='delete-api-return'));
  const completedApi=events.find(e=>e.uuidComplete&&e.kind.endsWith('api-return'));
  assert.ok(completedApi,'durable UUID completion observed at an API return');
  let refused=0;
  for(const {result,at} of results) {
    if(result.status===409) {
      assert.deepEqual(result,{status:409,body:{error:'storage_busy'}});
      assert.ok(BigInt(at)<BigInt(complete.at),'409 returned while UUID work pending');refused++;
    } else {
      assert.equal(result.status,200,JSON.stringify(result));
      assert.ok(BigInt(at)>=BigInt(complete.at),'200 returned after durable UUID completion');
    }
  }
  assert.equal(refused,3);assert.ok(refused>0);assert.equal(replay.length,refused);
  for(const row of replay) {
    assert.ok(BigInt(row.at)>BigInt(events.filter(e=>e.kind==='delete-api-return').at(-1).at),'resend after deletion API loop');
    assert.equal(row.result.status,200,JSON.stringify(row));
    assert.equal(f.db.prepare('SELECT count(*) n FROM raw_capture_events WHERE event_id=?').get(row.eventId).n,1);
  }
  const capturedEvents=new Set([...results.filter(r=>r.result.status===200).map(r=>r.eventId),...replay.map(r=>r.eventId)]);
  assert.equal(rows(f.db),capturedEvents.size,'replays store each event exactly once');
  assert.equal(f.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
});

test('a real worker capture started during a thousand-message CLI deletion catches up after completion', {timeout:60000},async t=>{
  const f=fixture(t),id=await seed(f,1008);await f.worker.initialize({...f.context,start:'beginning'});
  const preload=join(f.workspace.path,'hold-delete.mjs'),release=join(f.workspace.path,'release-delete');
  // Hold the actual deleter between committed passes until this worker returns.
  // The prepared reply is caused by durable pending work, independent of load.
  writeFileSync(preload,`
    import {existsSync} from 'node:fs';
    const write=process.stderr.write;let held=false;
    process.stderr.write=function(chunk,...args){const result=write.call(this,chunk,...args);
      if(!held&&String(chunk).includes('prepared')){held=true;
        while(!existsSync(${JSON.stringify(release)}))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
      }return result;};
  `);
  const deletion=deleting(f,id,preload);await deletion.progress;
  let during;
  try {during=await f.worker.run(f.context);}
  finally {writeFileSync(release,'release');}
  assert.equal(during.status,'waiting',JSON.stringify(during));
  const pending=f.cursor().pending;assert.equal(pending.state,'prepared');assert.equal(pending.attempts,0);
  const ended=await deletion.done;assert.equal(ended.code,0,ended.stderr);
  assert.equal((await f.worker.run(f.context)).status,'progress');
  assert.equal(f.db.prepare('SELECT event_id FROM raw_capture_events').get().event_id,pending.projection.eventId);
  assert.equal(f.cursor().pending,null);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_conversations WHERE id=?').get(id).n,0);
  assert.equal(rows(f.db),1,'the other worker session was captured');
  assert.equal(f.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
});

test('delete helper reports an early child exit with its code and output',async t=>{
  const f=fixture(t),preload=join(f.workspace.path,'early-exit.mjs');
  writeFileSync(preload,"process.stdout.write('synthetic stdout\\n');process.stderr.write('synthetic stderr\\n');process.exit(23);\n");
  const deletion=deleting(f,'synthetic-missing',preload);
  await assert.rejects(deletion.progress,error=>{
    assert.match(error.message,/^delete child exited before preparation: /);
    const result=JSON.parse(error.message.slice(error.message.indexOf('{')));
    assert.deepEqual(result,{code:23,signal:null,stdout:'synthetic stdout\n',stderr:'synthetic stderr\n'});
    return true;
  });
  assert.equal((await deletion.done).code,23);
});

test('capture prepared before another conversation final CLI delete saves after its epoch advance', {timeout:60000}, async t => {
  const f = fixture(t), id = await seed(f,1);
  let seals = 0;
  // Run the real CLI to completion inside the first asynchronous seal. The
  // capture therefore commits strictly after the final delete advanced epoch.
  const core = openMemoryCore({path:f.databasePath,rawSearch:false,rawConversations:{mode:'raw-v1',capBytes:200000000,interpretation:'host',
    port:{version:'raw-seal-v1',async sealRaw({text}) {
      if (++seals === 1) {
        const child = spawn(process.execPath,[join(root,'adapters/mcp/cli.mjs'),'raw','delete','--db',f.databasePath,'--owner',f.namespace.ownerId,'--conversation',id,'--yes'],{stdio:['ignore','pipe','pipe']});
        let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
        const ended=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
        assert.equal(ended.code,0,JSON.stringify({ended,stdout,stderr}));assert.equal(ended.signal,null);
      }
      return {format:'local-plain-v1',keyVersion:null,sealed:Buffer.from(text)};
    },async openRaw({sealed}) {return {text:Buffer.from(sealed).toString()};}},readPolicy:()=>({generation:'synthetic',reason:null})}});
  f.workspace.defer(()=>core.close());
  const input={namespace:f.namespace,client:'claude-code',sessionId:'other-session',eventId:'final-delete-race',messages:[{
    id:'other-message',role:'user',occurredAt:'2020-01-01T00:00:00.000Z',messageOrdinal:1,content:'Synthetic concurrent capture',
    part:{index:0,start:0,totalUnits:28,totalBytes:28}}]};
  input.messages[0].part.totalUnits=input.messages[0].content.length;input.messages[0].part.totalBytes=Buffer.byteLength(input.messages[0].content);
  const result=await core.captureRaw(input);
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.value.raw.parts[0].saved,true);assert.equal(seals,2);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_conversations WHERE id=?').get(id).n,0);
  assert.equal(rows(f.db),1);assert.equal(f.db.prepare('SELECT count(*) n FROM raw_parts').get().n,1);
  assert.deepEqual((await core.captureRaw(input)).value.raw,result.value.raw);assert.equal(rows(f.db),1);
  const deleted={...input,sessionId:'deletion-session',eventId:'deleted-session',messages:[{...input.messages[0],id:'late-delete',messageOrdinal:2}]};
  assert.deepEqual(await core.captureRaw(deleted),{ok:false,error:{code:'conversation_deleted',retryable:false}});
  assert.equal(seals,2,'deleted session is refused before sealing');assert.equal(rows(f.db),1);
});
