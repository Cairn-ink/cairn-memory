import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { readFileSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { workerFixture } from '../../../integrations/client/test/fixtures/local-worker-workspace.mjs';
import { createLocalRawWorker } from '../../../integrations/client/raw/local-worker.mjs';
import { localCaptureReply } from '../../../integrations/client/raw/local-reply.mjs';
import { openMemoryCore } from '../../../core/index.mjs';
import { captureLocal } from '../capture.mjs';
import { configuration } from '../configuration.mjs';

const root=new URL('../../../',import.meta.url).pathname;
function fixture(t) {
  const f=workerFixture(t);f.config.interpretation='raw-only';f.save();
  const worker=createLocalRawWorker({...f.options,env:{}});
  const installed=openMemoryCore({path:f.databasePath,raw:true,rawSearch:false});installed.close();
  const db=new DatabaseSync(f.databasePath);f.workspace.defer(()=>db.close());
  return {...f,worker,db};
}
const snapshot=db=>db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all()
  .map(({name})=>[name,db.prepare('SELECT * FROM "'+name+'"').all().map(row=>JSON.stringify(row)).sort()]);
const rows=db=>db.prepare('SELECT count(*) n FROM raw_capture_events').get().n;
// The trusted synthetic executable loads an error injection before the actual
// capture child. The worker/transport/reply/state machinery is unmodified.
function inject(f,stage,code=14) {
  const preload=join(f.workspace.path,'inject.mjs'),trace=join(f.workspace.path,'injection.jsonl');
  writeFileSync(preload,`
    import {registerHooks} from 'node:module';
    registerHooks({load(url,context,next){const result=next(url,context);
      if(url.endsWith('/core/index.mjs'))return {...result,source:result.source.toString().replace(
        'export { openMemoryCore } from "./contract.mjs";',
        'import {openMemoryCore as original} from "./contract.mjs"; export function openMemoryCore(...args) {'+
        ${JSON.stringify(stage==='open'?`throw Object.assign(Error('synthetic opener'),{code:'ERR_SQLITE_ERROR',errcode:${code},errstr:'synthetic'});`:
          `const core=original(...args);return {...core,captureRaw(){throw Object.assign(Error('synthetic later'),{code:'ERR_SQLITE_ERROR',errcode:${code},errstr:'database is locked'});}};`)}+'}')};
      return result;}});
  `);
  const executable=join(f.workspace.path,'injected-node.mjs');
  writeFileSync(executable,`#!${process.execPath}
    import {spawn} from 'node:child_process';import {appendFileSync} from 'node:fs';
    if(process.argv[2]==='--version')process.stdout.write(process.version+'\\n');
    else {const child=spawn(${JSON.stringify(process.execPath)},['--import',${JSON.stringify(preload)},...process.argv.slice(2)],{stdio:'inherit',env:process.env});
    for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
    child.once('close',(code,signal)=>{appendFileSync(${JSON.stringify(trace)},JSON.stringify({code,signal})+'\\n');process.exitCode=code??1;});}
  `,{mode:0o700});
  return {worker:createLocalRawWorker({...f.options,nodeExecutable:executable,env:{}}),trace,preload};
}

test('opener busy timeout is an accepted 409 and the worker resends its identical prepared batch', {timeout:30000},async t=>{
  const f=fixture(t);await f.worker.initialize({...f.context,start:'beginning'});
  f.db.exec('BEGIN IMMEDIATE');const before=snapshot(f.db),start=performance.now();let outcome;
  try {
    // Exercise the exact reply through captureLocal too, retaining the native
    // 5-second timeout and no writes while this separate connection holds WAL.
    const reply=await captureLocal(configuration(f.config),f.request(),{env:{}});
    assert.deepEqual(reply,{status:409,body:{error:'storage_busy'}});
    assert.deepEqual(localCaptureReply(Buffer.from(JSON.stringify(reply)+'\n'),f.request()),reply);
    outcome=await f.worker.run(f.context);
    assert.equal(outcome.status,'waiting');assert.equal(outcome.reason,'processing');
    assert.ok(performance.now()-start>=10000,'both openers waited for the actual busy timeout');
    assert.deepEqual(snapshot(f.db),before);
    const pending=f.cursor().pending;assert.equal(pending.state,'prepared');assert.equal(pending.attempts,0);
    assert.equal(pending.lastAttemptAt,null);assert.equal(pending.nextEligibleAt,null);assert.equal(f.cursor().offset,0);
  }finally{f.db.exec('ROLLBACK');}
  const prepared=f.cursor().pending;
  // The next child receives the same durable event/ordinal; its capture event
  // provides independent proof beyond the cursor's final empty state.
  const result=await f.worker.run(f.context);assert.equal(result.status,'progress');assert.equal(result.completedParts,1);
  assert.equal(f.cursor().pending,null);assert.equal(rows(f.db),1);
  const captured=f.db.prepare('SELECT event_id FROM raw_capture_events').get();
  assert.equal(captured.event_id,prepared.projection.eventId);
  assert.equal(f.db.prepare('SELECT ordinal FROM raw_messages').get().ordinal,prepared.projection.messageOrdinal);
});
for(const stage of ['open','capture'])test(`${stage} non-mapped failure exits child 1 and keeps worker uncertain for 125 seconds`,async t=>{
  const f=fixture(t),injected=inject(f,stage,stage==='open'?14:5);
  await injected.worker.initialize({...f.context,start:'beginning'});
  const before=snapshot(f.db),clock=Date.now(),now=Date.now;let result;
  try {Date.now=()=>clock;result=await injected.worker.run(f.context);}finally{Date.now=now;}
  const pending=f.cursor().pending;
  assert.equal(result.status,'waiting');assert.equal(result.reason,'uncertain');
  assert.equal(pending.state,'uncertain');assert.equal(pending.attempts,1);
  assert.equal(pending.nextEligibleAt-pending.lastAttemptAt,125000);
  assert.deepEqual(JSON.parse(readFileSync(injected.trace,'utf8').trim()),{code:1,signal:null});
  assert.deepEqual(snapshot(f.db),before);
});

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
  return {child,done,progress};
}

test('concurrent captureLocal defers with busy during a thousand-message CLI deletion and resends every request', {timeout:60000},async t=>{
  const f=fixture(t),id=await seed(f,1008),script=join(f.workspace.path,'concurrent.mjs');
  const trace=join(f.workspace.path,'uuid-trace.jsonl'),preload=join(f.workspace.path,'uuid-trace.mjs');
  const session=f.db.prepare('SELECT session_key FROM raw_conversations WHERE id=?').get(id).session_key;
  // Observe durable completion in either writer, never the rolled-back probe.
  // hrtime is the same monotonic clock across these processes. Record API
  // returns separately from process close, which includes unrelated teardown.
  writeFileSync(preload,`
    import {DatabaseSync} from 'node:sqlite';import {appendFileSync} from 'node:fs';import {registerHooks} from 'node:module';
    const trace=${JSON.stringify(trace)},session=${JSON.stringify(session)},exec=DatabaseSync.prototype.exec;let uuidComplete=false;
    const record=value=>appendFileSync(trace,JSON.stringify({...value,pid:process.pid,at:process.hrtime.bigint().toString()})+'\\n');
    DatabaseSync.prototype.exec=function(sql,...args){
      let complete=false;
      if(sql==='COMMIT'&&this.isTransaction&&this.prepare("SELECT 1 FROM sqlite_schema WHERE name='local_raw_uuid_jobs'").get())complete=this.prepare('SELECT complete FROM local_raw_uuid_jobs WHERE session_key=?').get(session)?.complete===1;
      const result=exec.call(this,sql,...args);
      if(complete){uuidComplete=true;record({kind:'uuid-complete-commit'});}
      return result;
    };
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
    import {captureLocal} from ${JSON.stringify(new URL('../capture.mjs',import.meta.url).href)};
    import {configuration} from ${JSON.stringify(new URL('../configuration.mjs',import.meta.url).href)};
    import {setTimeout as delay} from 'node:timers/promises';
    const config=configuration(JSON.parse(process.argv[2])),base=JSON.parse(process.argv[3]);process.send({ready:true});
    process.once('message',async()=>{let i=0,stop=false,pending;const deferred=[];process.once('message',()=>stop=true);
      do {if(!pending){pending=structuredClone(base);pending.session_id='concurrent-session';pending.event_id='concurrent-'+i;pending.messages[0].id='concurrent-'+i;pending.messages[0].message_ordinal=i+1;}
        const body=pending;
        let result;try{result=await captureLocal(config,body,{env:{}});}catch(error){result={thrown:{code:error.code,errcode:error.errcode}};}
        process.send({result,eventId:body.event_id,at:process.hrtime.bigint().toString()});if(result.status===409&&result.body?.error==='storage_busy')deferred.push(body);
        if(result.status===200){pending=undefined;i++;}
        await delay(250);
      }while(!stop);
      const replay=[];
      for(const body of deferred){const result=await captureLocal(config,body,{env:{}});replay.push({eventId:body.event_id,result,at:process.hrtime.bigint().toString()});}
      process.send({replay});process.disconnect();});
  `);
  const capture=spawn(process.execPath,['--import',preload,script,JSON.stringify(f.config),JSON.stringify(f.request())],{stdio:['ignore','ignore','pipe','ipc']});
  let errors='';capture.stderr.on('data',b=>errors+=b);const results=[];let replay;
  const ready=new Promise(resolve=>capture.once('message',resolve));capture.on('message',m=>{if(m.result)results.push({result:m.result,eventId:m.eventId,at:m.at});if(m.replay)replay=m.replay;});
  const closed=new Promise((resolve,reject)=>{capture.once('error',reject);capture.once('close',(code,signal)=>resolve({code,signal}));});
  f.workspace.defer(async()=>{if(capture.exitCode===null&&capture.signalCode===null)capture.kill('SIGTERM');await closed;});
  await ready;const deletion=deleting(f,id,preload);await deletion.progress;capture.send({start:true});
  const result=await deletion.done;capture.send({stop:true});assert.equal(result.code,0,JSON.stringify(result));assert.equal(result.signal,null);
  assert.deepEqual(await closed,{code:0,signal:null},errors);
  const events=readFileSync(trace,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  const complete=events.filter(e=>e.kind==='uuid-complete-commit').reduce((a,b)=>BigInt(a.at)<BigInt(b.at)?a:b);
  t.diagnostic(JSON.stringify({attempts:results.length,outcomes:results,uuidCompleteAt:complete.at,events,deferredResent:replay?.length}));
  assert.ok(results.length>0);assert.ok(events.some(e=>e.kind==='delete-api-return'));
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
  assert.ok(refused>0);assert.equal(replay.length,refused);
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
  const deletion=deleting(f,id);await deletion.progress;
  const during=await f.worker.run(f.context);
  assert.equal(during.status,'waiting',JSON.stringify(during));
  const pending=f.cursor().pending;assert.equal(pending.state,'prepared');assert.equal(pending.attempts,0);
  const ended=await deletion.done;assert.equal(ended.code,0,ended.stderr);
  assert.equal((await f.worker.run(f.context)).status,'progress');
  assert.equal(f.db.prepare('SELECT event_id FROM raw_capture_events').get().event_id,pending.projection.eventId);
  assert.equal(f.cursor().pending,null);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_conversations WHERE id=?').get(id).n,0);
  assert.equal(rows(f.db),1,'the other worker session was captured');
});
