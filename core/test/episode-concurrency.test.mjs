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
  process.on('message', message => {
    if (message.stage !== 'retry') return;
    process.send('retry-granted');
  });
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

test('E5 a live interpretation never blocks concurrent admission; lost-ack replay makes no calls',{timeout:30000},async t=>{
  const f=setup(t),a=child(t,f.path,'hold');
  assert.equal((await once(a,'message'))[0].stage,'interpreting');
  const b=child(t,f.path,'normal'),second=(await once(b,'message'))[0];
  assert.equal(ok(second.result).admission.status, 'completed');
  assert.deepEqual(second.calls, ['extract']);
  const completed=once(a,'message');a.send('continue');assert.equal(ok((await completed)[0].result).duplicate,true);
  const replay=ok(await f.core.capture(input()));assert.equal(replay.duplicate,true);assert.equal(f.model.calls.length,0);
});

test('E5 crash after durable interpretation before admission lease, restart recovers without another draft',{timeout:30000},async t=>{
  const f=setup(t),a=child(t,f.path,'crash-after-draft');
  assert.equal((await once(a,'message'))[0].stage,'drafted');
  assert.equal(f.db.prepare('SELECT state FROM admission_claims').get().state,'reserved');
  assert.equal(f.db.prepare('SELECT finished FROM episode_attempts').get().finished,1);
  const exit=once(a,'exit');a.kill('SIGKILL');await exit;
  const result=ok(await f.core.capture(input()));assert.equal(counts(f.model),0);assert.equal(counts(f.model,'extract'),1);
  assert.equal(result.episode.status,'processing');assert.equal(result.admission.status,'completed');
  assert.equal(ok(f.core.inspectCaptureEvidence({namespace:ns,client:'synthetic',eventId:input().eventId})).evidence.state,'released');
});

test('E5 fake clock recovers an expired stranded worker without letting it publish or consume successor leases',async t=>{
  const entered=deferred(),release=deferred();
  const f=setup(t,{interpretEpisode:async r=>{entered.resolve();await release.promise;return interpretation(r);}});
  const running=f.core.capture(input());await entered.promise;
  f.db.exec('UPDATE episode_attempts SET expires_at=0; UPDATE session_episodes SET writer_expires_at=0');
  const successor=openMemoryCore({path:f.path,...options,model:{...f.model,interpretEpisode:()=>{throw Error('must not retry');}}});t.after(()=>successor.close());
  const recovered=ok(await successor.capture(input()));assert.equal(recovered.admission.memories.length,0);
  release.resolve();const stale=ok(await running);
  assert.equal(stale.duplicate, true);
  assert.deepEqual(stale.admission, { status: 'completed', memoryIds: [], suppressedCount: 0 });
  assert.deepEqual(stale.episode.error, { code: 'episode_failed', retryable: false });
  assert.equal(f.db.prepare('SELECT state FROM admission_claims').get().state,'completed');
  assert.equal(f.db.prepare('SELECT interpretedAt FROM (SELECT json_extract(record,\'$.interpretedAt\') interpretedAt FROM session_episodes)').get().interpretedAt,null);
});

test('E3/E5 overlap registered after validation cannot acknowledge unfinished admission',t=>{
  const f=setup(t),a=createMemoryRuntime({path:f.path,sessionEpisodes:{mode:'episode-v1'}}),
    b=createMemoryRuntime({path:f.path,sessionEpisodes:{mode:'episode-v1'}});
  t.after(()=>{a.close();b.close();});
  const original=batch('original'),overlap={...original,eventId:'overlap'};
  assert.equal(a.validateEpisodeBatch(ns,overlap).overlap,false);
  b.reserveEpisodeBatch(ns,original);
  const claim=b.claimAdmission(ns,{...original,leaseMs:125000});
  const raced=a.reserveEpisodeBatch(ns,overlap);
  assert.equal(raced.overlap,true);assert.equal(raced.processing,true);
  assert.equal(f.db.prepare('SELECT count(*) n FROM episode_events').get().n,1);
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
  const f = setup(t);
  const a = child(t, f.path, `heavy-${arm}-a`), b = child(t, f.path, `heavy-${arm}-b`);
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

for (const stop of [false, true]) test(`E5 cross-process ${stop ? 'project stop' : 'pause'} between registration and draft claim`, async t => {
  const f = setup(t), worker = child(t, f.path, 'registered-hold');
  await stage(worker, 'registered');
  const control = stop ? ok(f.core.setProjectCapture({ namespace: ns, expectedGeneration: 'initial', enabled: false }))
    : ok(f.core.setCapturePaused({ namespace: ns, expectedGeneration: 'initial', paused: true }));
  const finished = stage(worker, 'result'); worker.send('continue'); const result = await finished;
  if (stop) {
    assertError(result.result, 'capture_evidence_closed'); assert.deepEqual(result.calls, []);
    assert.equal(f.db.prepare('SELECT state FROM staged_capture_evidence').get().state, 'discarded');
  } else {
    assert.equal(ok(result.result).episode.error.code, 'generation_conflict');
    assert.deepEqual(result.calls, ['extract']);
    ok(f.core.setCapturePaused({ namespace: ns, expectedGeneration: control.generation, paused: false }));
    assert.equal(ok(await f.core.capture(input())).duplicate, true); assert.equal(f.model.calls.length, 0);
  }
});

test('E5 crash before draft, pause, replay, unpause and replay preserve ordinary admission', async t => {
  const f = setup(t), worker = child(t, f.path, 'registered-hold'); await stage(worker, 'registered');
  const exit = once(worker, 'exit'); worker.kill('SIGKILL'); await exit;
  const paused = ok(f.core.setCapturePaused({ namespace: ns, expectedGeneration: 'initial', paused: true }));
  const resumed = ok(await f.core.capture(input()));
  assert.equal(resumed.episode.error.code, 'generation_conflict'); assert.equal(counts(f.model), 0);
  assert.equal(counts(f.model, 'extract'), 1);
  const gap = f.db.prepare('SELECT gap_reasons FROM episode_events').get();
  assert.deepEqual(JSON.parse(gap.gap_reasons), ['generation_conflict']);
  ok(f.core.setCapturePaused({ namespace: ns, expectedGeneration: paused.generation, paused: false }));
  assert.equal(ok(await f.core.capture(input())).duplicate, true); assert.equal(counts(f.model, 'extract'), 1);
});

test('E5 crash after PreCompact consumes its marker before generation checks on replay', async t => {
  const f = setup(t), worker = child(t, f.path, 'crash-after-precompact'); await stage(worker, 'drafted');
  const exit = once(worker, 'exit'); worker.kill('SIGKILL'); await exit;
  ok(f.core.setCapturePaused({ namespace: ns, expectedGeneration: 'initial', paused: true }));
  const value = input(); value.episodeContext.origin = 'precompact';
  const replay = ok(await f.core.capture(value));
  assert.equal(replay.episode.status, 'processing'); assert.equal(replay.admission.status, 'completed');
  assert.equal(counts(f.model), 0);
  assert.equal(counts(f.model, 'extract'), 1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM episode_attempts').get().n, 1);
});

test('E5/E8 crash after quick policy, then keep, then replay preserves skip without extra extract', { timeout: 30000 }, async t => {
  const f = setup(t), worker = child(t, f.path, 'crash-after-quick');
  assert.equal((await once(worker, 'message'))[0].stage, 'drafted');
  const exited = once(worker, 'exit'); worker.kill('SIGKILL'); await exited;
  const before = f.db.prepare('SELECT * FROM episode_events').get();
  assert.equal(before.policy, 'skip-quick'); assert.equal(before.admission, 'reserved');
  const detail = ok(f.core.getEpisode({ namespace: ns, episodeId: before.episode_id }));
  ok(await f.core.keepEpisode({ namespace: ns, episodeId: before.episode_id, expectedRevision: detail.episode.revision, actionId: 'after-crash' }));
  assert.deepEqual(f.db.prepare('SELECT * FROM episode_events').get(), before);
  assert.equal(ok(await f.core.capture(input())).admission.status, 'completed');
  assert.equal(counts(f.model, 'extract'), 1); assert.equal(counts(f.model), 0);
});

test('E5/E8 fake clock recovers a stranded keep lease in a new process after busy cleanup was lost', { timeout: 45000 }, async t => {
  let lock = false;
  const f = setup(t, { interpretEpisode: r => interpretation(r, 'quick-one-off-question'), extract: () => {
    if (lock) f.db.exec('BEGIN IMMEDIATE');
    return { items: [] };
  } });
  const first = ok(await f.core.capture(input()));
  const detail = ok(f.core.getEpisode({ namespace: ns, episodeId: first.episode.id }));
  const action = { namespace: ns, episodeId: first.episode.id, expectedRevision: detail.episode.revision, actionId: 'restart-busy' };
  lock = true; assertError(await f.core.keepEpisode(action), 'storage_busy');
  f.core.close(); f.db.exec('ROLLBACK');
  assert.equal(f.db.prepare('SELECT state FROM episode_keep_actions').get().state, 'pending');
  const worker = child(t, f.path, 'keep-retry'); await stage(worker, 'ready');
  let response = stage(worker, 'result'); worker.send(action);
  const pending = await response; assert.equal(ok(pending.result).admission.status, 'processing'); assert.deepEqual(pending.calls, []);
  f.db.exec('UPDATE episode_keep_actions SET lease_expires_at=0');
  response = stage(worker, 'result'); worker.send(action);
  const retried = await response; assert.equal(ok(retried.result).admission.status, 'completed'); assert.deepEqual(retried.calls, ['extract']);
});

test('E3/E5 reserved overlap waits for replay, then completed overlap counts zero', async t => {
  const f = setup(t), worker = child(t, f.path, 'registered-hold');
  await stage(worker, 'registered');
  const resent = { ...input(), eventId: 'new-event' };
  assert.equal(ok(await f.core.capture(resent)).admission.status, 'processing');
  assert.equal(f.db.prepare('SELECT observed FROM session_episodes').get().observed, 1);
  const completed = stage(worker, 'result'); worker.send('continue');
  const result = await completed; assert.equal(ok(result.result).admission.status, 'completed');
  assert.equal(result.calls.filter(call => call === 'extract').length, 1);
  assert.equal(ok(await f.core.capture(resent)).admission.status, 'covered');
  assert.equal(ok(await f.core.capture(input())).admission.status, 'completed');
  assert.equal(counts(f.model, 'extract'), 0);
  assert.equal(f.db.prepare('SELECT observed FROM session_episodes').get().observed, 1);
});

for (const disposition of ['abandoned', 'expired', 'released']) test(`E3/E5 ${disposition} original can rebind but cannot later double-admit`, async t => {
  const f = setup(t), runtime = createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } });
  t.after(() => runtime.close());
  const { episodeSnapshot } = await import('../episode-input.mjs');
  const snapshot = episodeSnapshot(input());
  const original = { client: snapshot.client, sessionId: snapshot.sessionId, eventId: snapshot.eventId,
    payloadDigest: snapshot.payloadDigest, clientLabel: 'Synthetic client', generation: 'initial', messages: snapshot.messages, view: snapshot.view };
  runtime.reserveEpisodeBatch(ns, original);
  if (disposition === 'abandoned') {
    const claim = runtime.claimAdmission(ns, { ...original, leaseMs: 125000 });
    runtime.abandonAdmission(ns, { ...original, token: claim.token });
  } else if (disposition === 'expired') f.db.exec('UPDATE staged_capture_evidence SET expires_at=0');
  else f.db.exec("UPDATE staged_capture_evidence SET state='released',payload=NULL,payload_bytes=0,release_reason='capacity'");
  assert.equal(ok(await f.core.capture({ ...input(), eventId: 'successor' })).admission.status, 'completed');
  assertError(await f.core.capture(input()), 'capture_evidence_closed');
  assert.equal(counts(f.model, 'extract'), 1);
  assert.equal(f.db.prepare('SELECT observed FROM session_episodes').get().observed, 2);
});

test('E3/E5 repeated abandoned ownership transfers fence every previous event', async t => {
  let failures = 2;
  const f = setup(t, { extract: () => { if (failures-- > 0) throw Error('scripted abandonment'); return { items: [] }; } });
  const first = input(), second = { ...first, eventId: 'second-owner' }, third = { ...first, eventId: 'third-owner' };
  assertError(await f.core.capture(first), 'extraction_failed');
  assertError(await f.core.capture(second), 'extraction_failed');
  assert.equal(ok(await f.core.capture(third)).admission.status, 'completed');
  for (const previous of [first, second]) assertError(await f.core.capture(previous), 'capture_evidence_closed');
  assert.equal(counts(f.model, 'extract'), 3);
  assert.equal(f.db.prepare('SELECT observed FROM session_episodes').get().observed, 3);
});

for (const bypass of [false, true]) test(`E3/E4a/E5 ${bypass ? 'capacity-bypassed' : 'staged'} partial overlap preserves a reserved original's messages`, async t => {
  const f = setup(t, { extract: ({ input }) => ({ items: input.messages.map(message => ({
    content: message.content, kind: 'context', confidence: 0.5, sourceIndices: [message.index],
  })) }) });
  const runtime = createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } });
  t.after(() => runtime.close());
  if (bypass) for (let i = 0; i < 64; i++) {
    runtime.reserveEpisodeBatch(ns, { ...batch(`protected-${i}`), client: 'quota' });
  }
  const { episodeSnapshot } = await import('../episode-input.mjs');
  const original = input(1, 'overlap', { messages: [input(1).messages[0], input(2).messages[0]] });
  const snapshot = episodeSnapshot(original);
  const registered = runtime.reserveEpisodeBatch(ns, { clientLabel: 'Synthetic client', generation: 'initial',
    client: snapshot.client, sessionId: snapshot.sessionId, eventId: snapshot.eventId,
    payloadDigest: snapshot.payloadDigest, messages: snapshot.messages, view: snapshot.view });
  assert.equal(registered.staging, bypass ? 'not-staged' : 'staged');
  assert.equal(f.db.prepare('SELECT state FROM admission_claims WHERE event_id=?').get(original.eventId).state, 'reserved');
  // Restart after registration, before any admission lease.
  runtime.close();
  const successor = input(3, 'overlap', { messages: [input(1).messages[0], input(3).messages[0]] });
  assert.equal(ok(await f.core.capture(successor)).admission.status, 'completed');
  assert.equal(ok(await f.core.capture(original)).admission.status, 'completed');
  assert.equal(ok(await f.core.capture(original)).admission.status, 'completed');
  const extracted = f.model.calls.filter(call => call.method === 'extract')
    .flatMap(call => call.request.input.messages.map(message => message.content));
  assert.deepEqual(extracted.sort(), [1, 2, 3].map(n => input(n).messages[0].content).sort());
  assert.equal(f.db.prepare('SELECT count(*) n FROM memories').get().n, 3);
  assert.equal(f.db.prepare('SELECT observed FROM session_episodes WHERE id=?').get(registered.episodeId).observed, 2);
  assert.equal(f.db.prepare('SELECT coverage_event_id FROM episode_messages WHERE episode_id=? AND message_id=?')
    .get(registered.episodeId, 'message-1').coverage_event_id, original.eventId);
});

test('E3/E4a/E5 partial takeover of an abandoned bypass leaves the original replay its remaining message', async t => {
  const f = setup(t), runtime = createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } });
  t.after(() => runtime.close());
  for (let i = 0; i < 64; i++) runtime.reserveEpisodeBatch(ns, { ...batch(`protected-${i}`), client: 'quota' });
  const { episodeSnapshot } = await import('../episode-input.mjs');
  const original = input(1, 'takeover', { messages: [input(1).messages[0], input(2).messages[0]] });
  const snapshot = episodeSnapshot(original);
  const key = { client: snapshot.client, sessionId: snapshot.sessionId, eventId: snapshot.eventId,
    clientLabel: 'Synthetic client', generation: 'initial', payloadDigest: snapshot.payloadDigest,
    messages: snapshot.messages, view: snapshot.view };
  const registered = runtime.reserveEpisodeBatch(ns, key);
  const claim = runtime.claimAdmission(ns, { ...key, leaseMs: 125000 });
  runtime.abandonAdmission(ns, { ...key, token: claim.token });
  const successor = input(3, 'takeover', { messages: [input(1).messages[0], input(3).messages[0]] });
  ok(await f.core.capture(successor)); ok(await f.core.capture(original));
  const extracted = f.model.calls.filter(call => call.method === 'extract')
    .map(call => call.request.input.messages.map(message => message.content));
  assert.deepEqual(extracted, [[1, 3].map(n => input(n).messages[0].content), [input(2).messages[0].content]]);
  assert.equal(f.db.prepare('SELECT observed FROM session_episodes WHERE id=?').get(registered.episodeId).observed, 2);
  assert.equal(f.db.prepare('SELECT coverage_event_id FROM episode_messages WHERE episode_id=? AND message_id=?')
    .get(registered.episodeId, 'message-1').coverage_event_id, successor.eventId);
});

test('E3/E5 fake clock recovers a stranded unspent draft lease after busy cleanup was lost at restart', { timeout: 30000 }, async t => {
  const { captureEpisodeMessages } = await import('../episode-capture.mjs');
  const f = setup(t), runtime = createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } });
  await assert.rejects(captureEpisodeMessages({ runtime: { ...runtime,
    episodeDraftSnapshot(...args) {
      f.db.exec('BEGIN IMMEDIATE');
      return runtime.episodeDraftSnapshot(...args);
    },
  }, ns, model: f.model, input: input() }), error => error.code === 'ERR_SQLITE_ERROR' && (error.errcode & 0xff) === 5);
  runtime.close(); f.db.exec('ROLLBACK');
  assert.equal(f.db.prepare('SELECT started FROM episode_attempts').get().started, 0);
  assert.equal(f.db.prepare('SELECT attempted FROM session_episodes').get().attempted, 0);
  assert.deepEqual(f.model.calls, []);
  f.db.exec('UPDATE episode_attempts SET expires_at=0; UPDATE session_episodes SET writer_expires_at=0');
  const worker = child(t, f.path, 'normal');
  const result = await stage(worker, 'result');
  assert.equal(ok(result.result).admission.status, 'completed');
  assert.deepEqual(result.calls, ['interpretEpisode', 'extract']);
  assert.equal(f.db.prepare('SELECT count(*) n FROM episode_attempts').get().n, 1);
  assert.equal(f.db.prepare('SELECT started FROM episode_attempts').get().started, 1);
  assert.equal(f.db.prepare('SELECT attempted FROM session_episodes').get().attempted, 1);
  assert.deepEqual(JSON.parse(f.db.prepare('SELECT gap_reasons FROM episode_events').get().gap_reasons), []);
});

test('E3/E5 fake clock recovers a stranded unstarted lazy lease after restart', async t => {
  const f = setup(t), runtime = createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } });
  const registered = runtime.reserveEpisodeBatch(ns, batch('pending', 'Synthetic pending evidence', 'earlier'));
  const writer = runtime.claimEpisodeWriter(ns, { episodeId: registered.episodeId, generation: 'initial' });
  runtime.claimEpisodeDraft(ns, { episodeId: registered.episodeId, writerToken: writer.token,
    generation: 'initial', trigger: 'lazy', watermark: 1, deferAttempt: true });
  runtime.close();
  f.db.exec('UPDATE episode_attempts SET expires_at=0; UPDATE session_episodes SET writer_expires_at=0');
  const worker = child(t, f.path, 'normal');
  const result = await stage(worker, 'result');
  assert.equal(ok(result.result).lazyEpisode.status, 'interpreted');
  assert.deepEqual(result.calls, ['interpretEpisode', 'interpretEpisode', 'extract']);
  assert.deepEqual({ ...f.db.prepare("SELECT started,finished FROM episode_attempts WHERE marker='lazy'").get() },
    { started: 1, finished: 1 });
});

test('E3/E5 a partial takeover records a gap for remaining failed staged evidence', async t => {
  const f = setup(t), runtime = createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } });
  t.after(() => runtime.close());
  const { episodeSnapshot } = await import('../episode-input.mjs');
  const original = input(1, 'failed-partial', { messages: [input(1).messages[0], input(2).messages[0]] });
  const snapshot = episodeSnapshot(original);
  const key = { client: snapshot.client, sessionId: snapshot.sessionId, eventId: snapshot.eventId,
    clientLabel: 'Synthetic client', generation: 'initial', payloadDigest: snapshot.payloadDigest,
    messages: snapshot.messages, view: snapshot.view };
  const registered = runtime.reserveEpisodeBatch(ns, key);
  const claim = runtime.claimAdmission(ns, { ...key, leaseMs: 125000 });
  runtime.abandonAdmission(ns, { ...key, token: claim.token });
  ok(await f.core.capture(input(3, 'failed-partial', { messages: [input(1).messages[0], input(3).messages[0]] })));
  assertError(await f.core.capture(original), 'capture_evidence_closed');
  assert.ok(JSON.parse(f.db.prepare('SELECT gap_reasons FROM episode_events WHERE event_id=?')
    .get(original.eventId).gap_reasons).includes('missing_evidence'));
  ok(await f.core.capture(input(2, 'failed-partial')));
  const extracted = f.model.calls.filter(call => call.method === 'extract')
    .flatMap(call => call.request.input.messages.map(message => message.content));
  assert.deepEqual(extracted.sort(), [1, 2, 3].map(n => input(n).messages[0].content).sort());
  assert.equal(f.db.prepare('SELECT observed FROM session_episodes WHERE id=?').get(registered.episodeId).observed, 3);
});

for (const stop of [true, false]) test(`E3/E5 ${stop ? 'stop closes' : 'pause preserves'} a crashed bypassed original's overlap ownership`, async t => {
  const f = setup(t), runtime = createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } });
  for (let i = 0; i < 64; i++) runtime.reserveEpisodeBatch(ns, { ...batch(`protected-${i}`), client: 'quota' });
  const { episodeSnapshot } = await import('../episode-input.mjs');
  const original = input(1, 'controls', { messages: [input(1).messages[0], input(2).messages[0]] });
  const snapshot = episodeSnapshot(original);
  const registered = runtime.reserveEpisodeBatch(ns, { clientLabel: 'Synthetic client', generation: 'initial',
    client: snapshot.client, sessionId: snapshot.sessionId, eventId: snapshot.eventId,
    payloadDigest: snapshot.payloadDigest, messages: snapshot.messages, view: snapshot.view });
  assert.equal(registered.staging, 'not-staged');
  runtime.close(); // Crash after registration, before an admission lease.
  const changed = stop
    ? ok(f.core.setProjectCapture({ namespace: ns, expectedGeneration: 'initial', enabled: false }))
    : ok(f.core.setCapturePaused({ namespace: ns, expectedGeneration: 'initial', paused: true }));
  if (!stop) {
    assert.equal(f.db.prepare('SELECT gap FROM episode_events WHERE event_id=?').get(original.eventId).gap, 'capacity');
  }
  const resumed = stop
    ? ok(f.core.setProjectCapture({ namespace: ns, expectedGeneration: changed.generation, enabled: true }))
    : ok(f.core.setCapturePaused({ namespace: ns, expectedGeneration: changed.generation, paused: false }));
  const successor = input(3, 'controls', { messages: [input(1).messages[0]],
    episodeContext: { clientLabel: 'Synthetic client', generation: resumed.generation, origin: 'ordinary' } });
  const result = ok(await f.core.capture(successor));
  if (stop) {
    assert.equal(result.admission.status, 'completed');
    assertError(await f.core.capture(original), 'capture_evidence_closed');
    assert.equal(f.db.prepare('SELECT gap FROM episode_events WHERE event_id=?').get(original.eventId).gap, 'discarded');
    assert.equal(f.db.prepare('SELECT coverage_event_id FROM episode_messages WHERE episode_id=? AND message_id=?')
      .get(registered.episodeId, 'message-1').coverage_event_id, successor.eventId);
    assert.deepEqual(f.model.calls.filter(call => call.method === 'extract')
      .flatMap(call => call.request.input.messages.map(message => message.content)), [input(1).messages[0].content]);
    assert.ok(f.model.calls.filter(call => call.method === 'interpretEpisode')
      .every(call => !JSON.stringify(call.request).includes(input(2).messages[0].content)));
    assert.equal(f.db.prepare('SELECT observed FROM session_episodes WHERE id=?').get(registered.episodeId).observed, 2);
  } else {
    assert.equal(result.admission.status, 'processing');
    assert.equal(counts(f.model, 'extract'), 0);
    assert.equal(ok(await f.core.capture(original)).admission.status, 'completed');
    assert.equal(ok(await f.core.capture(successor)).admission.status, 'covered');
    assert.deepEqual(f.model.calls.filter(call => call.method === 'extract')
      .flatMap(call => call.request.input.messages.map(message => message.content)), [1, 2].map(n => input(n).messages[0].content));
    assert.equal(f.db.prepare('SELECT observed FROM session_episodes WHERE id=?').get(registered.episodeId).observed, 1);
  }
});

for (const mutation of ['correction', 'capacity release']) {
  test(`E4/E5 ${mutation} during interpretation finishes its failure and admits this and the next batch`, async t => {
    const entered = deferred(), release = deferred();
    let hold = false;
    const f = setup(t, { interpretEpisode: async request => {
      if (hold) { entered.resolve(); await release.promise; }
      return interpretation(request);
    } }, { sessionEpisodes: { mode: 'episode-v1', draftEveryBatches: 2 } });
    const first = ok(await f.core.capture(input()));
    ok(await f.core.capture(input(2)));
    hold = true;
    const pending = f.core.capture(input(3));
    await entered.promise;
    if (mutation === 'correction') {
      const detail = ok(f.core.getEpisode({ namespace: ns, episodeId: first.episode.id }));
      const source = detail.sources.items[0];
      ok(f.core.correctEpisode({ namespace: ns, episodeId: first.episode.id, expectedRevision: detail.episode.revision,
        patch: { gist: { text: 'Pinned correction', anchors: [{ sourceId: source.id, digest: source.digest, start: 0, end: 1 }] } } }));
    } else {
      const runtime = createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } });
      t.after(() => runtime.close());
      for (let i = 0; i < 64; i++) runtime.reserveEpisodeBatch(ns, {
        ...batch(`pressure-${i}`, 'Protected', `pressure-${i}`), client: 'other',
      });
      assert.equal(ok(f.core.inspectCaptureEvidence({ namespace: ns, client: 'synthetic', eventId: input(2).eventId })).evidence.releaseReason, 'capacity');
    }
    release.resolve();
    const captured = ok(await pending);
    assert.deepEqual(captured.episode.error, { code: 'episode_failed', retryable: false });
    assert.equal(captured.admission.status, 'completed');
    assert.equal(ok(await f.core.capture(input(4))).admission.status, 'completed');
    assert.equal(counts(f.model), 2); assert.equal(counts(f.model, 'extract'), 4);
    assert.ok(f.db.prepare('SELECT finished FROM episode_attempts').all().every(row => row.finished === 1));
    const event = f.db.prepare('SELECT gap_reasons FROM episode_events WHERE event_id=?').get(input(3).eventId);
    assert.ok(JSON.parse(event.gap_reasons).includes('episode_failed'));
    assert.ok(f.db.prepare('SELECT gap_reasons FROM episode_events').all().every(row => !row.gap_reasons.includes('episode_timeout')));
    if (mutation === 'correction') assert.equal(ok(f.core.getEpisode({ namespace: ns, episodeId: first.episode.id })).episode.gist, 'Pinned correction');
  });
}

for (const started of [false, true]) {
  test(`E5 ${started ? 'started' : 'reserved'} draft and writer leases never gate ordinary admission`, async t => {
    const { episodeSnapshot } = await import('../episode-input.mjs');
    const f = setup(t), runtime = createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } });
    t.after(() => runtime.close());
    const snapshot = episodeSnapshot(input());
    const registered = runtime.reserveEpisodeBatch(ns, { client: snapshot.client, sessionId: snapshot.sessionId,
      eventId: snapshot.eventId, payloadDigest: snapshot.payloadDigest, generation: 'initial', clientLabel: 'Synthetic',
      messages: snapshot.messages, view: snapshot.view });
    const writer = runtime.claimEpisodeWriter(ns, { episodeId: registered.episodeId, generation: 'initial' });
    const claim = runtime.claimEpisodeDraft(ns, { episodeId: registered.episodeId, generation: 'initial',
      writerToken: writer.token, trigger: 'batch', watermark: 1, deferAttempt: true });
    if (started) runtime.startEpisodeAttempt(ns, { episodeId: registered.episodeId, token: claim.token });
    assert.equal(ok(await f.core.capture(input())).admission.status, 'completed');
    assert.equal(ok(await f.core.capture(input(2))).admission.status, 'completed');
    const attempt = f.db.prepare('SELECT started,finished,expires_at FROM episode_attempts').get();
    assert.equal(attempt.started, +started); assert.equal(attempt.finished, 0);
    assert.ok(attempt.expires_at > Date.now());
    assert.equal(counts(f.model), 0); assert.equal(counts(f.model, 'extract'), 2);
  });
}

test('E5 admission busy survives process restart; fake clock expires a genuinely stranded admission lease', { timeout: 25000 }, async t => {
  const f = setup(t, { extract: () => { f.db.exec('BEGIN IMMEDIATE'); return { items: [] }; } });
  try { assert.deepEqual(await f.core.capture(input()), { ok: false, error: { code: 'storage_busy', retryable: true } }); }
  finally { f.db.exec('ROLLBACK'); }
  assert.equal(f.db.prepare('SELECT state FROM staged_capture_evidence').get().state, 'pending');
  f.core.close();
  // The lost process cannot replay its cleanup map. Only its own admission lease
  // bounds recovery; the still-live interpretation writer must not block it.
  f.db.exec('UPDATE admission_claims SET lease_expires_at=0');
  const restarted = child(t, f.path, 'normal');
  const result = (await once(restarted, 'message'))[0];
  assert.equal(ok(result.result).admission.status, 'completed');
  assert.deepEqual(result.calls, ['extract']);
  assert.equal(f.db.prepare('SELECT state FROM staged_capture_evidence').get().state, 'released');
});
