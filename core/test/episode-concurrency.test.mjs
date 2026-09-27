import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { openMemoryCore } from '../index.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { setup,input,interpretation,counts,deferred,ns,options,ok,assertError } from '../testing/episode-capture-helpers.mjs';
import { batch } from '../testing/episode-helpers.mjs';

function child(t,path,mode) {
  const process=fork(new URL('../testing/episode-capture-child.mjs',import.meta.url),[path,mode],{stdio:['ignore','ignore','pipe','ipc']});
  process.on('message',message=>{if(message.stage==='retry')process.send('retry-granted');});
  let stderr='';process.stderr.on('data',data=>{stderr+=data;});
  process.on('exit',(code,signal)=>{if(code!==0&&!signal)process.emit('error',Error(stderr));});
  t.after(()=>{if(process.exitCode===null)process.kill('SIGKILL');});
  return process;
}

function stage(process,name) {
  return new Promise((resolve,reject)=>{
    const onMessage=message=>{if(message.stage===name){cleanup();resolve(message);}};
    const onError=error=>{cleanup();reject(error);};
    const cleanup=()=>{process.off('message',onMessage);process.off('error',onError);};
    process.on('message',onMessage);process.on('error',onError);
  });
}

test('E5 two actual processes serialize interpretation; concurrent replay then lost-ack replay makes no calls',{timeout:30000},async t=>{
  const f=setup(t),a=child(t,f.path,'hold');
  assert.equal((await once(a,'message'))[0].stage,'interpreting');
  const b=child(t,f.path,'normal'),second=(await once(b,'message'))[0];
  assert.equal(ok(second.result).processing,true);assert.deepEqual(second.calls,[]);
  const completed=once(a,'message');a.send('continue');assert.equal(ok((await completed)[0].result).duplicate,false);
  const replay=ok(await f.core.capture(input()));assert.equal(replay.duplicate,true);assert.equal(f.model.calls.length,0);
});

test('E5 crash after durable interpretation before admission lease, restart recovers without another draft',{timeout:30000},async t=>{
  const f=setup(t),a=child(t,f.path,'crash-after-draft');
  assert.equal((await once(a,'message'))[0].stage,'drafted');
  assert.equal(f.db.prepare('SELECT state FROM admission_claims').get().state,'reserved');
  assert.equal(f.db.prepare('SELECT finished FROM episode_attempts').get().finished,1);
  const exit=once(a,'exit');a.kill('SIGKILL');await exit;
  f.db.exec('UPDATE session_episodes SET writer_expires_at=0');
  const result=ok(await f.core.capture(input()));assert.equal(counts(f.model),0);assert.equal(counts(f.model,'extract'),1);
  assert.equal(result.episode.reason,'replay');
  assert.equal(ok(f.core.inspectCaptureEvidence({namespace:ns,client:'synthetic',eventId:input().eventId})).evidence.state,'released');
});

test('E5 expired worker cannot publish, release successor or consume its memory lease',async t=>{
  const entered=deferred(),release=deferred();
  const f=setup(t,{interpretEpisode:async r=>{entered.resolve();await release.promise;return interpretation(r);}});
  const running=f.core.capture(input());await entered.promise;
  f.db.exec('UPDATE episode_attempts SET expires_at=0; UPDATE session_episodes SET writer_expires_at=0');
  const successor=openMemoryCore({path:f.path,...options,model:{...f.model,interpretEpisode:()=>{throw Error('must not retry');}}});t.after(()=>successor.close());
  const recovered=ok(await successor.capture(input()));assert.equal(recovered.admission.memories.length,0);
  release.resolve();const stale=await running;assert.ok(stale.ok||stale.error.code==='stale_admission');
  assert.equal(f.db.prepare('SELECT state FROM admission_claims').get().state,'completed');
  assert.equal(f.db.prepare('SELECT interpretedAt FROM (SELECT json_extract(record,\'$.interpretedAt\') interpretedAt FROM session_episodes)').get().interpretedAt,null);
});

test('E3/E5 overlap registered after validation cannot acknowledge unfinished admission',t=>{
  const f=setup(t),a=createMemoryRuntime({path:f.path,sessionEpisodes:{mode:'episode-v1'}}),
    b=createMemoryRuntime({path:f.path,sessionEpisodes:{mode:'episode-v1'}});
  t.after(()=>{a.close();b.close();});
  const original=batch('original'),overlap={...original,eventId:'overlap'};
  assert.equal(a.validateEpisodeBatch(ns,{...overlap,messages:overlap.view.messages}).overlap,false);
  b.reserveEpisodeBatch(ns,original);
  const raced=a.reserveEpisodeBatch(ns,overlap);
  assert.equal(raced.overlap,true);assert.equal(raced.processing,true);
  assert.equal(f.db.prepare('SELECT count(*) n FROM episode_events').get().n,1);
  const claim=b.claimAdmission(ns,{...original,leaseMs:125000});
  b.finishAdmission(ns,{...original,token:claim.token,items:[]});
  const completed=a.reserveEpisodeBatch(ns,overlap);
  assert.equal(completed.overlap,true);assert.equal(completed.processing,false);
  assert.equal(f.model.calls.length,0);
});

for(const mutation of ['forget','discard','stop','pause'])test(`E5/E6/E7 ${mutation} during interpreter respects fences`,async t=>{
  const entered=deferred(),release=deferred();
  const f=setup(t,{interpretEpisode:async r=>{entered.resolve();await release.promise;return interpretation(r);}});
  const pending=f.core.capture(input());await entered.promise;
  const row=f.db.prepare('SELECT id,revision FROM session_episodes').get();
  if(mutation==='forget')ok(f.core.forgetEpisode({namespace:ns,episodeId:row.id,expectedRevision:row.revision}));
  if(mutation==='discard')ok(f.core.discardCaptureEvidence({namespace:ns,client:'synthetic',eventId:input().eventId}));
  if(mutation==='stop')ok(f.core.setProjectCapture({namespace:ns,expectedGeneration:'initial',enabled:false}));
  if(mutation==='pause')ok(f.core.setCapturePaused({namespace:ns,expectedGeneration:'initial',paused:true}));
  release.resolve();const result=await pending;
  if(mutation==='pause')assert.equal(ok(result).episode.status,'interpreted');
  else {assertError(result,'capture_evidence_closed');assert.equal(counts(f.model,'extract'),0);}
});

test('E4a both completion orders release empty admission atomically; N8 backlog sources survive',async t=>{
  const f=setup(t);const first=ok(await f.core.capture(input()));
  assert.equal(ok(f.core.inspectCaptureEvidence({namespace:ns,client:'synthetic',eventId:input().eventId})).evidence.state,'released');
  for(let n=2;n<=8;n++)ok(await f.core.capture(input(n)));
  assert.equal(ok(f.core.inspectCaptureEvidence({namespace:ns,client:'synthetic',eventId:input(2).eventId})).evidence.state,'admitted');
  ok(await f.core.endEpisodeSession({namespace:ns,client:'synthetic',sessionId:'private-session',eventId:'end',generation:'initial'}));
  for(let n=2;n<=8;n++)assert.equal(ok(f.core.inspectCaptureEvidence({namespace:ns,client:'synthetic',eventId:input(n).eventId})).evidence.state,'released');
  assert.ok(ok(f.core.getEpisode({namespace:ns,episodeId:first.episode.id})).sources.items.length>0);
});

test('E4a capacity reclamation fences an in-flight admitted-backlog draft',async t=>{
  const entered=deferred(),release=deferred();let hold=false;
  const f=setup(t,{interpretEpisode:async r=>{if(hold){entered.resolve();await release.promise;}return interpretation(r);}});
  ok(await f.core.capture(input()));ok(await f.core.capture(input(2)));hold=true;
  const ending=f.core.endEpisodeSession({namespace:ns,client:'synthetic',sessionId:'private-session',eventId:'end',generation:'initial'});await entered.promise;
  const runtime=createMemoryRuntime({path:f.path,sessionEpisodes:{mode:'episode-v1'}});t.after(()=>runtime.close());
  for(let n=0;n<64;n++)runtime.reserveEpisodeBatch(ns,{...batch(`pressure-${n}`,'Protected',`pressure-${n}`),client:'other'});
  release.resolve();assert.equal(ok(await ending).episode.status,'failed');
  assert.equal(ok(f.core.inspectCaptureEvidence({namespace:ns,client:'synthetic',eventId:input(2).eventId})).evidence.releaseReason,'capacity');
});

test('E5 end versus lazy coalesces under one writer, with at most two jobs on later capture',async t=>{
  let hold=false;const entered=deferred(),release=deferred();
  const f=setup(t,{interpretEpisode:async r=>{if(hold){entered.resolve();await release.promise;}return interpretation(r);}});
  ok(await f.core.capture(input()));ok(await f.core.capture(input(2)));hold=true;
  const ending=f.core.endEpisodeSession({namespace:ns,client:'synthetic',sessionId:'private-session',eventId:'end',generation:'initial'});await entered.promise;
  hold=false;const later=ok(await f.core.capture(input(1,'later')));assert.equal(later.lazyEpisode,undefined);
  release.resolve();assert.equal(ok(await ending).episode.status,'interpreted');assert.equal(counts(f.model),3);
});

for(const arm of ['success','failure'])test(`E4a two concurrent processes admit 140 ~16KiB captures, N16 ${arm}`,{timeout:180000},async t=>{
  const f=setup(t),a=child(t,f.path,`heavy-${arm}-a`),b=child(t,f.path,`heavy-${arm}-b`);
  await Promise.all([stage(a,'ready'),stage(b,'ready')]);
  const results=Promise.all([stage(a,'result'),stage(b,'result')]);a.send('start');b.send('start');
  for(const result of await results){assert.equal(result.admitted,70);assert.ok(result.calls<=7);}
  assert.equal(f.db.prepare("SELECT count(*) n FROM admission_claims WHERE state='completed'").get().n,140);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('E7 correction during keep qualification fences admission; deletion of kept memory lineage suppresses replay',async t=>{
  const {rationaleModel}=await import('../testing/rationale-model.mjs');
  const scripted=rationaleModel();const entered=deferred(),release=deferred();
  const f=setup(t,{interpretEpisode:r=>interpretation(r,'quick-one-off-question'),extract:scripted.extract,
    qualifyCandidates:async r=>{entered.resolve();await release.promise;return scripted.qualifyCandidates(r);}});
  const captured=ok(await f.core.capture(input()));const detail=ok(f.core.getEpisode({namespace:ns,episodeId:captured.episode.id}));
  const action={namespace:ns,episodeId:captured.episode.id,expectedRevision:detail.episode.revision,actionId:'keep'};
  const pending=f.core.keepEpisode(action);await entered.promise;
  const source=detail.sources.items[0];ok(f.core.correctEpisode({namespace:ns,episodeId:detail.episode.id,expectedRevision:detail.episode.revision,
    patch:{gist:{text:'Pinned correction',anchors:[{sourceId:source.id,digest:source.digest,start:0,end:1}]}}}));
  release.resolve();assertError(await pending,'revision_conflict');assert.equal(f.db.prepare('SELECT count(*) n FROM memories').get().n,0);
  f.model.qualifyCandidates=scripted.qualifyCandidates;
  const updated=ok(f.core.getEpisode({namespace:ns,episodeId:captured.episode.id}));
  const kept=ok(await f.core.keepEpisode({...action,actionId:'keep-new',expectedRevision:updated.episode.revision}));assert.equal(kept.admission.memories.length,1);
  const again=ok(f.core.getEpisode({namespace:ns,episodeId:captured.episode.id}));assert.equal(again.memoryLinks.items.length,1);
  ok(f.core.forgetEpisode({namespace:ns,episodeId:captured.episode.id,expectedRevision:again.episode.revision}));
  assertError(await f.core.keepEpisode(action),'episode_not_found');assert.equal(f.db.prepare('SELECT count(*) n FROM memories WHERE deleted=0').get().n,0);
});
