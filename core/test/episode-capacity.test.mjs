import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, ns, batch, register, finish, draft, inspect, digest } from '../testing/episode-helpers.mjs';
import { createMemoryRuntime } from '../runtime.mjs';

function large(id, session='private-host-session', units=780) {
  const input=batch(id,'x'.repeat(units),session);
  input.view.messages=Array.from({length:20},(_,i)=>({id:`${id}-${i}`,role:'user',content:'x'.repeat(units)}));
  input.messages=input.view.messages.map(message=>({...message,occurredAt:null}));
  input.payloadDigest=digest(JSON.stringify(input.view));return input;
}
const payloadCount=f=>f.db.prepare('SELECT count(*) n FROM staged_capture_evidence WHERE payload IS NOT NULL').get().n;
const usage=f=>f.db.prepare('SELECT coalesce(sum(payload_bytes),0) n FROM staged_capture_evidence').get().n;

test('E4a N16 two sessions admit 140 ~16KiB batches under successful drafts and sustained draft failure',t=>{
  for(const success of [true,false]) {
    const f=fixture(t,{draftEveryBatches:16});f.db.exec('PRAGMA journal_mode=WAL');
    for(let i=0;i<140;i++) {
      const input=large(`heavy-${i}`,`session-${i%2}`),r=register(f,input);
      if(r.position===1 || (r.position-1)%16===0) {
        const job=draft(f,r,input);
        if(success) f.runtime.commitEpisodeDraft(ns,job.commit);
        else f.runtime.failEpisodeDraft(ns,{episodeId:r.episodeId,token:job.claim.token,code:'episode_failed'});
        f.runtime.releaseEpisodeWriter(ns,{episodeId:r.episodeId,token:job.writer.token});
      }
      assert.equal(finish(f,input).duplicate,false);assert.ok(payloadCount(f)<=64);assert.ok(usage(f)<=1048576);
    }
    assert.equal(f.db.prepare("SELECT count(*) n FROM admission_claims WHERE state='completed'").get().n,140);
    assert.ok(f.db.prepare("SELECT count(*) n FROM staged_capture_evidence WHERE release_reason='capacity'").get().n>0);
    assert.equal(f.db.prepare('SELECT count(*) n FROM session_episodes WHERE draft_every=16').get().n,2);
  }
});

test('E4a protected quota bypasses, replay keeps decision, legacy retains backpressure; N8/129 baseline',t=>{
  const f=fixture(t);f.db.exec('PRAGMA journal_mode=WAL');
  for(let i=0;i<64;i++) register(f,batch(`protected-${i}`));
  const before=f.db.prepare('SELECT event_id,payload FROM staged_capture_evidence ORDER BY event_id').all();
  const bypass=batch('bypass'),r=register(f,bypass);assert.equal(r.staging,'not-staged');
  assert.deepEqual(f.db.prepare('SELECT event_id,payload FROM staged_capture_evidence ORDER BY event_id').all(),before);
  const view=f.runtime.inspectCaptureEvidence(ns,bypass).evidence;
  assert.equal(view.state,'not-staged');assert.equal(view.expiresAt,null);assert.equal(view.view,null);
  assert.equal(finish(f,bypass).duplicate,false);
  assert.equal(register(f,bypass).duplicate,true);
  const legacy=batch('legacy');assert.throws(()=>f.runtime.claimCaptureEvidence(ns,{...legacy,leaseMs:125000,view:legacy.view}),/capture_evidence_capacity/);
  const cold=createMemoryRuntime({path:f.path,sessionEpisodes:{mode:'episode-v1'}});t.after(()=>cold.close());
  assert.equal(cold.reserveEpisodeBatch(ns,bypass).staging,'not-staged');
  assert.equal(cold.claimAdmission(ns,{...bypass,leaseMs:125000}).duplicate,true);
  for(let i=0;i<129;i++) {const input=batch(`baseline-${i}`);assert.equal(register(f,input).staging,'not-staged');finish(f,input);}
  assert.equal(payloadCount(f),64);
  assert.equal(inspect(f,r.episodeId).episode.processing.missing,130);
});

test('E4a oldest minimal prefix, mixed legacy protection and all-or-nothing rollback',t=>{
  const f=fixture(t);f.db.exec('PRAGMA journal_mode=WAL');
  const legacy=batch('legacy');const legacyClaim=f.runtime.claimCaptureEvidence(ns,{...legacy,leaseMs:125000,view:legacy.view});
  f.runtime.finishAdmission(ns,{...legacy,token:legacyClaim.token,items:[]});
  for(let i=0;i<63;i++) {const input=batch(`eligible-${String(i).padStart(2,'0')}`);register(f,input);finish(f,input);}
  f.db.exec("UPDATE staged_capture_evidence SET created_at=100 WHERE event_mode='episode-v1'");
  const before=f.db.prepare('SELECT * FROM staged_capture_evidence ORDER BY event_id').all();
  f.db.exec("CREATE TRIGGER synthetic_registration_failure BEFORE INSERT ON episode_events WHEN NEW.event_id='fault' BEGIN SELECT RAISE(ABORT,'synthetic'); END");
  assert.throws(()=>register(f,batch('fault')));
  assert.deepEqual(f.db.prepare('SELECT * FROM staged_capture_evidence ORDER BY event_id').all(),before);
  assert.equal(f.db.prepare("SELECT count(*) n FROM admission_claims WHERE event_id='fault'").get().n,0);
  register(f,batch('new'));
  assert.equal(f.db.prepare("SELECT event_id FROM staged_capture_evidence WHERE state='released'").get().event_id,'eligible-00');
  assert.notEqual(f.db.prepare("SELECT payload FROM staged_capture_evidence WHERE event_id='legacy'").get().payload,null);
});

test('E4a byte pressure reclaims only required prefix and fences in-flight interpretation',t=>{
  const f=fixture(t);f.db.exec('PRAGMA journal_mode=WAL');
  let first,job;
  for(let i=0;i<64;i++) {
    const input=large(`bytes-${i}`,`session-${i}`),r=register(f,input);finish(f,input);
    if(i===0) {first=r;job=draft(f,r,input);}
  }
  assert.throws(()=>f.runtime.commitEpisodeDraft(ns,job.commit),/stale_episode/);
  assert.equal(inspect(f,first.episodeId).policies.items[0].gap,'capacity');
  assert.ok(usage(f)<=1048576);
});

test('E4a per-event staging overflow bypasses before reclaiming any eligible payload', async t=>{
  const {createStagedEvidenceStorage}=await import('../staged-evidence-storage.mjs');
  const f=fixture(t),input=batch('eligible');register(f,input);finish(f,input);
  const before=f.db.prepare('SELECT * FROM staged_capture_evidence').all();
  const storage=createStagedEvidenceStorage({db:f.db});
  assert.equal(storage.episodeCapacity(ns,{bytes:131073,payload:'synthetic'}),false);
  assert.deepEqual(f.db.prepare('SELECT * FROM staged_capture_evidence').all(),before);
});

test('E5 live drafts permit admission and expired attempts stay consumed; crash replay is in episode-concurrency.test.mjs',async t=>{
  const {execFileSync}=await import('node:child_process');
  const f=fixture(t),input=batch(),r=register(f,input),job=draft(f,r,input);
  const run=body=>JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',`
    import {createMemoryRuntime} from ${JSON.stringify(new URL('../runtime.mjs',import.meta.url).href)};
    const runtime=createMemoryRuntime({path:${JSON.stringify(f.path)},sessionEpisodes:{mode:'episode-v1'}});
    const ns=${JSON.stringify(ns)};const result=${body};runtime.close();console.log(JSON.stringify(result));`],{encoding:'utf8'}));
  assert.deepEqual(run(`runtime.claimEpisodeWriter(ns,{episodeId:${JSON.stringify(r.episodeId)},generation:'initial'})`),{processing:true});
  assert.equal(f.runtime.finishAdmission(ns,{...input,
    token:f.runtime.claimAdmission(ns,{...input,leaseMs:125000}).token,items:[]}).duplicate,false);
  f.db.exec('UPDATE episode_attempts SET expires_at=0; UPDATE session_episodes SET writer_expires_at=0');
  const successor=run(`runtime.claimEpisodeWriter(ns,{episodeId:${JSON.stringify(r.episodeId)},generation:'initial'})`);
  assert.ok(successor.token);
  assert.throws(()=>f.runtime.commitEpisodeDraft(ns,job.commit),/stale_episode/);
  assert.equal(f.runtime.claimEpisodeDraft(ns,{episodeId:r.episodeId,generation:'initial',writerToken:successor.token,trigger:'batch',watermark:1}).consumed,true);
  finish(f,input);
  assert.equal(run(`runtime.claimAdmission(ns,${JSON.stringify({...input,leaseMs:125000})})`).duplicate,true);
  assert.equal(f.runtime.releaseEpisodeWriter(ns,{episodeId:r.episodeId,token:job.writer.token}).released,false);
});

test('E5 concurrent processes admit independent sessions under shared capacity pressure',async t=>{
  const {spawn}=await import('node:child_process');
  const f=fixture(t);f.db.exec('PRAGMA journal_mode=WAL');
  const run=client=>new Promise((resolve,reject)=>{
    const script=`import {createMemoryRuntime} from ${JSON.stringify(new URL('../runtime.mjs',import.meta.url).href)};
      import {createHash} from 'node:crypto';
      const runtime=createMemoryRuntime({path:${JSON.stringify(f.path)},sessionEpisodes:{mode:'episode-v1',draftEveryBatches:16}}),ns=${JSON.stringify(ns)};
      for(let i=0;i<70;i++){
        const eventId=${JSON.stringify(client)}+i,view={messages:Array.from({length:20},(_,j)=>({id:eventId+'-'+j,role:'user',content:'x'.repeat(780)})),retainedSourceWindow:{maxUnitsPerMessage:800,truncatedMessageIndices:[]}};
        const input={client:${JSON.stringify(client)},clientLabel:'Synthetic process',sessionId:'private-session',eventId,generation:'initial',payloadDigest:createHash('sha256').update(JSON.stringify(view)).digest('hex'),view,messages:view.messages.map(message=>({...message,occurredAt:null}))};
        const {isStorageBusy}=await import(${JSON.stringify(new URL('../database.mjs',import.meta.url).href)});
        for(let retry=0;;retry++){
          try { runtime.reserveEpisodeBatch(ns,input); break; }
          catch(error){
            if(retry>=20 || !(error.code==='storage_busy' || isStorageBusy(error)))throw error;
            await new Promise(resolve=>setTimeout(resolve,25));
          }
        }
        const claim=runtime.claimAdmission(ns,{...input,leaseMs:125000});
        runtime.finishAdmission(ns,{...input,token:claim.token,items:[]});
      }runtime.close();`;
    const child=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['ignore','ignore','pipe']});let error='';
    child.stderr.on('data',chunk=>error+=chunk);child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(error)));
  });
  await Promise.all([run('process-a'),run('process-b')]);
  assert.equal(f.db.prepare("SELECT count(*) n FROM admission_claims WHERE state='completed'").get().n,140);
  assert.ok(payloadCount(f)<=64);assert.ok(usage(f)<=1048576);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('E4a N8/129 small-batch baseline releases all successful dispositions without capacity reclamation',t=>{
  const f=fixture(t);f.db.exec('PRAGMA journal_mode=WAL');let pending=[],attempts=0;
  for(let i=0;i<129;i++) {
    const input=batch(`small-${i}`),r=register(f,input);pending.push(input.eventId);
    if(i%8===0) {
      const job=draft(f,r,input);job.commit.dispositions=pending.map(eventId=>({eventId,omitted:0}));
      f.runtime.commitEpisodeDraft(ns,job.commit);attempts++;pending=[];
      finish(f,input);f.runtime.releaseEpisodeWriter(ns,{episodeId:r.episodeId,token:job.writer.token});
    } else finish(f,input);
    assert.ok(payloadCount(f)<=8);
  }
  assert.equal(attempts,17);assert.equal(payloadCount(f),0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM staged_capture_evidence WHERE release_reason='interpreted'").get().n,129);
  assert.equal(f.db.prepare("SELECT count(*) n FROM staged_capture_evidence WHERE release_reason='capacity'").get().n,0);
});

test('E4a/E7 failing a pre-forget bypass draft preserves capacity and the namespace forgotten fence', t => {
  const f = fixture(t); f.db.exec('PRAGMA journal_mode=WAL');
  for (let i = 0; i < 64; i++) register(f, batch('protected-' + i));
  const input = batch('bypass-failure', 'Synthetic bypass evidence', 'bypass-session'), r = register(f, input);
  assert.equal(r.staging, 'not-staged');
  const job = draft(f, r, input);
  const unrelated = f.core.admit({ namespace: ns, memory: { content: 'Unrelated memory', kind: 'fact' },
    receipts: [{ client: 'independent', sessionId: 'other', eventId: 'other', role: 'user', excerpt: 'Unrelated memory' }] }).value.memory;
  assert.equal(f.core.forget({ namespace: ns, memoryId: unrelated.id, expectedRevision: unrelated.revision }).ok, true);
  assert.throws(() => finish(f, input), /capture_evidence_closed/);
  f.runtime.failEpisodeDraft(ns, { episodeId: r.episodeId, token: job.claim.token, code: 'episode_failed' });
  const event = f.db.prepare('SELECT gap,gap_reasons FROM episode_events WHERE event_id=?').get(input.eventId);
  assert.equal(event.gap, 'forgotten');
  assert.deepEqual(JSON.parse(event.gap_reasons), ['capacity', 'forgotten', 'episode_failed']);
  assert.throws(() => finish(f, input), /capture_evidence_closed/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM memories WHERE deleted=0').get().n, 0);
  assert.equal(f.db.prepare('SELECT state FROM admission_claims WHERE event_id=?').get(input.eventId).state, 'reserved');
});
