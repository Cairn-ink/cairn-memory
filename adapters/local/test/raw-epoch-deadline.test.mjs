import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fixture } from './fixtures/workspace.mjs';
import { workerFixture } from '../../../integrations/client/test/fixtures/local-worker-workspace.mjs';
import { createLocalRawWorker } from '../../../integrations/client/raw/local-worker.mjs';

function slowPreparation(f, conflicts, firstMs=700, laterMs=700) {
  const preload = join(f.workspace.path,'slow-preparation.mjs'), trace = join(f.workspace.path,'attempts.jsonl');
  writeFileSync(preload, `
    import {registerHooks} from 'node:module';import {appendFileSync} from 'node:fs';import {randomUUID} from 'node:crypto';
    const invocation=randomUUID();
    let attempt=0;
    globalThis.syntheticSlowPreparation=()=>{
      attempt++;appendFileSync(${JSON.stringify(trace)},JSON.stringify({attempt,uptimeMs:process.uptime()*1000})+'\\n');
      if(attempt<=${conflicts})memory.remember({content:'Synthetic independent write '+attempt,kind:'fact',receipt:{client:'synthetic',sessionId:'writer',eventId:invocation+'-'+attempt,role:'user',excerpt:'Synthetic evidence'}});
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,attempt===1?${firstMs}:${laterMs});
    };
    registerHooks({load(url,context,next){const result=next(url,context);if(!url.endsWith('/core/raw-journal.mjs'))return result;
      const source=result.source.toString(),marker='prepared.set(token,{ input,session,eventDigest,authority,fence,id,revision,sealedParts });';
      if(!source.includes(marker))throw Error('missing preparation marker');
      return {...result,source:source.replace(marker,'globalThis.syntheticSlowPreparation(); '+marker)};}});
    const {openMemoryStore}=await import(${JSON.stringify(new URL('../../../core/index.mjs',import.meta.url).href)});
    const store=openMemoryStore({path:${JSON.stringify(f.databasePath)}}), memory=store.scope(${JSON.stringify({ownerId:f.namespace.ownerId})});
  `);
  return {preload,attempts:()=>readFileSync(trace,'utf8').trim().split('\n').map(JSON.parse)};
}
for (const conflicts of [0,3]) test(`real CLI keeps the startup process budget across ${conflicts} epoch conflicts`, async t => {
  const f=fixture(t,{client:'claude-code'});f.config.interpretation='raw-only';f.config.timeouts={captureMs:1500,processMs:2000};f.save();
  const probe=slowPreparation(f,conflicts),start=performance.now();
  const ended=await f.run(f.request('process-budget','Synthetic deadline'),{preloads:[probe.preload]});
  const reply=f.reply(ended),attempts=probe.attempts();
  t.diagnostic(JSON.stringify({conflicts,elapsedMs:performance.now()-start,attempts,reply,childExit:ended.code}));
  if(!conflicts)assert.equal(reply.status,200);
  else {
    assert.deepEqual(reply,{status:409,body:{error:'storage_busy'}});
    assert.ok(attempts.length<=2,'the third preparation cannot fit the original budget');
    assert.ok(attempts.every(row=>row.uptimeMs<2000),'no preparation starts after the process budget');
  }
});

test('five real worker runs defer deadline-limited epoch churn without spending recovery attempts', {timeout:30000}, async t => {
  const f=workerFixture(t);f.config.interpretation='raw-only';f.config.timeouts={captureMs:800,processMs:2000};f.save();
  const probe=slowPreparation(f,100,0,1000),executable=join(f.workspace.path,'deadline-node.mjs');
  writeFileSync(executable, `#!${process.execPath}
    import {spawn} from 'node:child_process';
    if(process.argv[2]==='--version')process.stdout.write(process.version+'\\n');
    else {const child=spawn(${JSON.stringify(process.execPath)},['--import',${JSON.stringify(probe.preload)},...process.argv.slice(2)],{stdio:'inherit',env:process.env});
      for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));child.once('close',code=>{process.exitCode=code??1;});}
  `,{mode:0o700});
  const worker=createLocalRawWorker({...f.options,nodeExecutable:executable,env:{}});
  await worker.initialize({...f.context,start:'beginning'});
  let event, previousAttempts=0;
  for(let run=0;run<5;run++) {
    const result=await worker.run(f.context),cursor=f.cursor();
    t.diagnostic(JSON.stringify({run,result,pending:cursor.pending}));
    assert.equal(result.status,'waiting');assert.equal(result.reason,'processing');
    assert.equal(cursor.blockedReason,null);assert.equal(cursor.pending.state,'prepared');
    assert.equal(cursor.pending.attempts,0);assert.equal(cursor.pending.nextEligibleAt,null);assert.equal(cursor.pending.lastAttemptAt,null);
    const attempts=probe.attempts();assert.ok(attempts.length-previousAttempts<=2,'churn must defer before the process watchdog');previousAttempts=attempts.length;
    event??=cursor.pending.projection.eventId;assert.equal(cursor.pending.projection.eventId,event);
  }
  const clean=createLocalRawWorker({...f.options,env:{}});
  assert.equal((await clean.run(f.context)).status,'progress');assert.equal(f.cursor().pending,null);
  assert.equal((await clean.run(f.context)).status,'ready');
});

test('uncontended synchronous preparation cannot acknowledge after the process deadline', async t => {
  const f=fixture(t,{client:'claude-code'});f.config.interpretation='raw-only';f.config.timeouts={captureMs:1500,processMs:2000};f.save();
  const probe=slowPreparation(f,0,2200,2200);
  const ended=await f.run(f.request('late-process','Synthetic process expiry'),{preloads:[probe.preload]});
  t.diagnostic(JSON.stringify({code:ended.code,stderr:ended.stderr,attempts:probe.attempts()}));
  assert.equal(ended.code,124);assert.equal(ended.stdout,'');assert.match(ended.stderr,/local_capture_deadline/);
});
