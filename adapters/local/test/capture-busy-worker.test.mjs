import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { workerFixture } from '../../../integrations/client/test/fixtures/local-worker-workspace.mjs';
import { createLocalRawWorker } from '../../../integrations/client/raw/local-worker.mjs';
import { localCaptureReply } from '../../../integrations/client/raw/local-reply.mjs';
import { openMemoryCore } from '../../../core/index.mjs';
import { captureLocal } from '../capture.mjs';
import { configuration } from '../configuration.mjs';

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
