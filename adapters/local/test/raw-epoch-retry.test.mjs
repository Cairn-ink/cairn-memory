import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { workerFixture } from '../../../integrations/client/test/fixtures/local-worker-workspace.mjs';
import { createLocalRawWorker } from '../../../integrations/client/raw/local-worker.mjs';
import { captureLocal } from '../capture.mjs';
import { configuration } from '../configuration.mjs';

for (const change of ['epoch','memory','control']) test(`real worker ${change} contention preserves the correct retry disposition`, {timeout:30000}, async t => {
  const f = workerFixture(t); f.config.interpretation = 'raw-only'; f.save();
  const seed = f.request('seed','Synthetic other session'); seed.session_id = 'other-session';
  assert.equal((await captureLocal(configuration(f.config),seed,{env:{}})).status,200);
  const preload = join(f.workspace.path,'epoch-preload.mjs'), trace = join(f.workspace.path,'attempts.jsonl'), checks = join(f.workspace.path,'checks.jsonl');
  writeFileSync(preload, `
    import {registerHooks} from 'node:module';import {appendFileSync} from 'node:fs';
    let writes=0;
    globalThis.syntheticRetryCheck=name=>appendFileSync(${JSON.stringify(checks)},name+'\\n');
    globalThis.syntheticEpochChange=db=>{
      ${change === 'memory' ? `memory.remember({content:'Synthetic independent Memory '+(++writes),kind:'fact',receipt:{client:'synthetic',sessionId:'memory-writer',eventId:'memory-'+writes,role:'user',excerpt:'Synthetic independent evidence'}});` : `db.prepare('UPDATE namespace_epochs SET epoch=epoch+1').run();`}
      ${change === 'control' ? "db.prepare('INSERT INTO raw_capture_controls(owner_id,client,enabled,revision) VALUES(?,?,0,1) ON CONFLICT(owner_id,client) DO UPDATE SET revision=revision+1').run('"+f.namespace.ownerId+"','claude-code');" : ''}
      appendFileSync(${JSON.stringify(trace)},'attempt\\n');
    };
    registerHooks({load(url,context,next){const result=next(url,context);
      if(url.endsWith('/core/raw-capture-storage.mjs')){
        let source=result.source.toString();
        for(const [marker,name] of [
          ['authority.check(managed, request.namespace, request.client);','managed-authority'],
          ["privacy?.assertModeInside(input.namespace, input.client, sessionKey, hostInterpretation ? 'host' : 'engine');",'privacy-mode'],
          ['const previous = binding(input);','binding'],
          ['const token = await journal.prepareRegistration(input);','projection'],
          ['const closed = privacy?.fenceArrivalInside(input.namespace, input.client, sessionKey, rangeMessages);','privacy-arrival'],
          ["privacy?.assertModeInside(input.namespace, input.client, sessionKey, hostInterpretation ? 'host' : 'engine', true);",'privacy-commit-mode'],
          ['privacy?.recordRangeInside(input.namespace, input.client, sessionKey, rangeMessages);','privacy-range'],
        ]){if(!source.includes(marker))throw Error('missing check marker '+name);source=source.replace(marker,marker+' globalThis.syntheticRetryCheck('+JSON.stringify(name)+');');}
        return {...result,source};
      }
      if(url.endsWith('/core/raw-journal.mjs'))return {...result,source:result.source.toString().replace(
        'prepared.set(token,{ input,session,eventDigest,authority,fence,id,revision,sealedParts });',
        'globalThis.syntheticEpochChange(db); prepared.set(token,{ input,session,eventDigest,authority,fence,id,revision,sealedParts });')};return result;}});
    const memoryStore=${change === 'memory' ? ` (await import(${JSON.stringify(new URL('../../../core/index.mjs', import.meta.url).href)})).openMemoryStore({path:${JSON.stringify(f.databasePath)}})` : 'null'};
    const memory=memoryStore?.scope(${JSON.stringify({ownerId:f.namespace.ownerId,...(f.namespace.projectId ? {projectId:f.namespace.projectId} : {})})});
  `);
  const executable = join(f.workspace.path,'epoch-node.mjs');
  writeFileSync(executable, `#!${process.execPath}
    import {spawn} from 'node:child_process';
    if(process.argv[2]==='--version')process.stdout.write(process.version+'\\n');
    else {const child=spawn(${JSON.stringify(process.execPath)},['--import',${JSON.stringify(preload)},...process.argv.slice(2)],{stdio:'inherit',env:process.env});
      for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));child.once('close',code=>{process.exitCode=code??1;});}
  `,{mode:0o700});
  const worker = createLocalRawWorker({...f.options,nodeExecutable:executable,env:{}});
  await worker.initialize({...f.context,start:'beginning'});
  const result = await worker.run(f.context), cursor = f.cursor();
  t.diagnostic(JSON.stringify({result,pending:cursor.pending?.state,attempts:cursor.pending?.attempts,blockedReason:cursor.blockedReason}));
  assert.equal(readFileSync(trace,'utf8').trim().split('\n').length,change !== 'control' ? 4 : 1);
  const db = new DatabaseSync(f.databasePath); t.after(()=>db.close());
  assert.equal(db.prepare('SELECT count(*) n FROM raw_events').get().n,1);
  if (change === 'memory') {
    assert.equal(db.prepare('SELECT count(*) n FROM memories').get().n,4);
    const observed=readFileSync(checks,'utf8').trim().split('\n');
    const frequencies=Object.fromEntries([...new Set(observed)].map(name=>[name,observed.filter(check=>check===name).length]));
    assert.deepEqual(frequencies,{'managed-authority':4,'privacy-mode':4,binding:4,projection:4,'privacy-arrival':4,'privacy-commit-mode':4,'privacy-range':4});
    t.diagnostic(JSON.stringify({checks:frequencies}));
  }
  if (change === 'control') {assert.equal(result.status,'blocked');assert.equal(cursor.blockedReason,'authority_changed');return;}
  assert.equal(result.status,'waiting'); assert.equal(result.reason,'processing'); assert.equal(cursor.blockedReason,null);
  assert.equal(cursor.pending.state,'prepared'); assert.equal(cursor.pending.attempts,0);
  assert.equal(cursor.pending.lastAttemptAt,null); assert.equal(cursor.pending.nextEligibleAt,null);
  const eventId = cursor.pending.projection.eventId;
  const recovered = createLocalRawWorker({...f.options,env:{}});
  assert.equal((await recovered.run(f.context)).status,'progress'); assert.equal(f.cursor().pending,null);
  assert.equal(db.prepare('SELECT count(*) n FROM raw_events WHERE event_id=?').get(eventId).n,1);
  assert.equal((await recovered.run(f.context)).status,'ready'); assert.equal(db.prepare('SELECT count(*) n FROM raw_parts').get().n,2);
});
