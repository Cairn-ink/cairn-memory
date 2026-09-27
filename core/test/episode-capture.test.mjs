import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../index.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { setup,input,interpretation,counts,ns,options,ok,assertError } from '../testing/episode-capture-helpers.mjs';
import { episodeRequest } from '../episode-capture.mjs';
import { batch,digest } from '../testing/episode-helpers.mjs';

for(const N of [2,8,16]) test(`E3 first/periodic N=${N}, B=1/8/9/17, duplicate and end caps`,async t=>{
  const f=setup(t,{}, {sessionEpisodes:{mode:'episode-v1',draftEveryBatches:N}});
  let id;
  for(let n=1;n<=17;n++) {
    const result=ok(await f.core.capture(input(n)));id=result.episode.id;
    assert.equal(counts(f.model),1+Math.floor((n-1)/N));
    const calls=f.model.calls.length;ok(await f.core.capture(input(n)));assert.equal(f.model.calls.length,calls);
  }
  const end={namespace:ns,client:'synthetic',sessionId:'private-session',generation:'initial',eventId:'end'};
  ok(await f.core.endEpisodeSession(end));const before=counts(f.model);
  ok(await f.core.endEpisodeSession({...end,eventId:'end-again'}));assert.equal(counts(f.model),before);
  ok(f.core.getEpisode({namespace:ns,episodeId:id}));assert.equal(counts(f.model),before);
  assert.ok(before<=1+Math.floor(16/N)+2);
});

test('E3 first+PreCompact coalesce; lazy oldest same client/project; repeated lazy/end and reopen caps',async t=>{
  const f=setup(t);const first=input(1,'a');first.episodeContext.origin='precompact';
  ok(await f.core.capture(first));assert.equal(counts(f.model),1);
  ok(await f.core.capture(input(2,'a')));const before=counts(f.model);
  ok(await f.core.capture(input(1,'b')));assert.equal(counts(f.model)-before,2);
  ok(await f.core.capture(input(3,'a'))); // A has no second lazy allowance.
  const prior=counts(f.model);ok(await f.core.capture(input(2,'b')));assert.ok(counts(f.model)-prior<=1);
  const end={namespace:ns,client:'synthetic',sessionId:'a',generation:'initial',eventId:'end'};
  ok(await f.core.endEpisodeSession(end));const ended=counts(f.model);
  ok(await f.core.capture(input(4,'a')));const afterReopen=counts(f.model);ok(await f.core.endEpisodeSession({...end,eventId:'new-end'}));assert.equal(counts(f.model),afterReopen);
  const reopened=openMemoryCore({path:f.path,...options,model:f.model});t.after(()=>reopened.close());
  ok(await reopened.endEpisodeSession(end));assert.equal(counts(f.model),afterReopen);
});

test('E1/E2/E8 a fresh quick skips only its batch; seven debounced batches admit normally',async t=>{
  const f=setup(t,{interpretEpisode:r=>interpretation(r,'quick-one-off-question'),
    extract:({input})=>({items:input.messages.map(message=>({content:message.content,
      kind:'context',confidence:0.5,sourceIndices:[message.index]}))})});
  const first=ok(await f.core.capture(input()));assert.equal(counts(f.model,'extract'),0);
  for(let n=2;n<=8;n++)assert.equal(ok(await f.core.capture(input(n))).admission.memories.length,1);
  assert.equal(counts(f.model),1);assert.equal(counts(f.model,'extract'),7);
  assert.equal(counts(f.model,'qualifyCandidates'),7);
  assert.equal(f.db.prepare('SELECT count(*) n FROM memories').get().n,7);
  const details=ok(f.core.getEpisode({namespace:ns,episodeId:first.episode.id}));
  assert.equal(details.episode.semanticSupport,'unassessed');assert.equal(details.sources.items.length,1);
  assert.deepEqual(details.policies.items.map(p=>p.policy),['skip-quick',...Array(7).fill('normal')]);
  const evidence=ok(f.core.inspectCaptureEvidence({namespace:ns,client:'synthetic',eventId:input().eventId})).evidence;
  assert.equal(evidence.state,'released');assert.equal(evidence.expiresAt,null);assert.equal(evidence.view,null);
  const payload=JSON.stringify(f.model.calls);
  for(const forbidden of ['private-session','Synthetic client','2026-09-28','generation'])assert.ok(!payload.includes(forbidden),forbidden);
  // Existing placement classification carries namespace routing; episode interpretation does not.
  assert.ok(!JSON.stringify(f.model.calls.filter(call=>call.method==='interpretEpisode')).includes('ownerId'));
  assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM episode_messages').all()).includes('evidence'));
});

for(const failure of ['throw','timeout','malformed','oversized','budget']) test(`E4/E8 ${failure} draft consumes attempt and falls through after prior quick`,async t=>{
  let attempt=0;
  const f=setup(t,{interpretEpisode:r=>{
    if(++attempt===1)return interpretation(r,'quick-one-off-question');
    if(failure==='throw')throw Error('raw private provider error');
    if(failure==='timeout')throw Object.assign(Error('timeout'),{code:'model_timeout'});
    if(failure==='malformed')return {gist:'wrong'};
    if(failure==='oversized'){const value=interpretation(r);value.gist.value='x'.repeat(401);return value;}
    return interpretation(r);
  }});
  const first=ok(await f.core.capture(input()));
  if(failure==='budget') f.model.countTokens=text=>text.includes('classificationTarget')?6001:1;
  for(let n=2;n<=9;n++)ok(await f.core.capture(input(n)));
  const state=ok(f.core.getEpisode({namespace:ns,episodeId:first.episode.id}));
  assert.equal(state.episode.processing.attempted,9);assert.equal(state.episode.processing.covered,1);
  assert.equal(state.episode.processing.state,'incomplete');assert.equal(counts(f.model,'extract'),8);
  assert.ok(state.policies.items.at(-1).gap);assert.equal(state.policies.items.at(-1).admission,'completed');
  assert.equal(ok(f.core.inspectCaptureEvidence({namespace:ns,client:'synthetic',eventId:input(9).eventId})).evidence.state,'admitted');
  ok(await f.core.capture(input(10)));assert.equal(counts(f.model),failure==='budget'?1:2);
});

test('E2 strict Unicode, time, foreign and split-code-point output; E3 K4 message reuse after release/restart',async t=>{
  const f=setup(t);const first=ok(await f.core.capture(input()));
  const restarted=openMemoryCore({path:f.path,...options,model:f.model});t.after(()=>restarted.close());
  const overlap={...input(),eventId:'overlap'};
  const before=f.model.calls.length;assert.equal(ok(await restarted.capture(overlap)).overlap,true);
  assert.equal(f.model.calls.length,before);
  for(const patch of [{content:'Changed'}, {role:'assistant'}, {occurredAt:null}]) {
    const rows=f.db.prepare('SELECT * FROM episode_messages').all();
    assertError(await restarted.capture({...overlap,messages:[{...overlap.messages[0],...patch}]}),'event_payload_conflict');
    assert.deepEqual(f.db.prepare('SELECT * FROM episode_messages').all(),rows);
  }
  ok(await restarted.capture({...input(2),messages:[input().messages[0],...input(2).messages]}));
  assert.equal(ok(restarted.getEpisode({namespace:ns,episodeId:first.episode.id})).episode.processing.observed,2);
  for(const patch of [{content:'\ud800'}, {occurredAt:'2026-01-01'}, {occurredAt:'2026-02-30T00:00:00.000Z'}])
    assertError(await restarted.capture({...input(3),messages:[{...input(3).messages[0],...patch}]}),'invalid_input');
  const d=ok(restarted.getEpisode({namespace:ns,episodeId:first.episode.id}));
  ok(restarted.forgetEpisode({namespace:ns,episodeId:d.episode.id,expectedRevision:d.episode.revision}));
  assert.equal(f.db.prepare('SELECT count(*) n FROM episode_messages').get().n,2);
  assert.equal(f.db.prepare('SELECT count(*) n FROM episode_sources').get().n,0);
  assertError(await restarted.capture(input()),'capture_evidence_closed');
});

test('E4 prior-only overflow drops context; whole-source omissions are explicit',()=>{
  const view={messages:[{id:'now',role:'user',content:'Current'}]};
  const snapshot={targetEventId:'event',events:[{eventId:'event',view}],sources:Array.from({length:16},(_,i)=>({id:`prior-${i}`,role:'user',text:'x'.repeat(800)})),record:{anchors:{},gist:null}};
  const request=episodeRequest({countTokens:text=>text.length},snapshot);
  assert.ok(request.priorOmitted>0);assert.equal(request.input.sources[0].text,'Current');
});

for(const failed of [false,true]) test(`E4a heavy day 140 x ~16 KiB across two sessions, N16, failure=${failed}`,async t=>{
  const f=setup(t,{interpretEpisode:r=>{if(failed)throw Error('synthetic');return interpretation(r);}}, {sessionEpisodes:{mode:'episode-v1',draftEveryBatches:16}});
  for(let n=1;n<=140;n++) {
    const value=input(n,n%2?'a':'b');value.messages=Array.from({length:20},(_,i)=>({id:`m-${n}-${i}`,role:'user',content:`Batch ${n} `+'x'.repeat(780)}));
    const result=ok(await f.core.capture(value));assert.ok(result.admission);
    assert.equal(f.db.prepare('SELECT count(*) n FROM admission_claims WHERE state=\'completed\'').get().n,n);
    const usage=f.db.prepare('SELECT count(*) n,coalesce(sum(payload_bytes),0) bytes FROM staged_capture_evidence WHERE payload IS NOT NULL').get();
    assert.ok(usage.n<=64&&usage.bytes<=1048576);
  }
  assert.ok(counts(f.model)<=2*(1+Math.floor(69/16)+2));
  assert.equal(counts(f.model,'extract'),140);
  if(failed)assert.ok(f.db.prepare("SELECT count(*) n FROM staged_capture_evidence WHERE release_reason='capacity'").get().n>0);
});

test('E4a protected capacity bypass admits without interpreting; replay and restart preserve no-stage',async t=>{
  const f=setup(t),runtime=createMemoryRuntime({path:f.path,sessionEpisodes:{mode:'episode-v1'}});t.after(()=>runtime.close());
  for(let n=0;n<64;n++)runtime.reserveEpisodeBatch(ns,{...batch(`protected-${n}`,'Protected text',`protected-session-${n}`),client:'protected'});
  const captured=ok(await f.core.capture(input()));assert.equal(captured.episode.error.code,'capacity');
  assert.equal(counts(f.model),0);assert.equal(counts(f.model,'extract'),1);
  const staged=ok(f.core.inspectCaptureEvidence({namespace:ns,client:'synthetic',eventId:input().eventId})).evidence;
  assert.equal(staged.state,'not-staged');assert.equal(staged.expiresAt,null);
  assert.equal(f.db.prepare('SELECT count(*) n FROM staged_capture_evidence WHERE payload IS NOT NULL').get().n,64);
  const calls=f.model.calls.length;ok(await f.core.capture(input()));assert.equal(f.model.calls.length,calls);
});

test('E6 controls reject new paused/stop text across restart; retained keep excludes that text',async t=>{
  const f=setup(t);const first=ok(await f.core.capture(input()));
  const paused=ok(f.core.setCapturePaused({namespace:ns,expectedGeneration:'initial',paused:true}));
  const skipped=input(2);skipped.messages[0].content='NEVER_RETAIN_PAUSED_MARKER';skipped.episodeContext.generation=paused.generation;
  assertError(await f.core.capture(skipped),'capture_disabled');
  const details=ok(f.core.getEpisode({namespace:ns,episodeId:first.episode.id}));
  ok(await f.core.keepEpisode({namespace:ns,episodeId:first.episode.id,expectedRevision:details.episode.revision,actionId:'keep'}));
  assert.ok(!JSON.stringify(f.model.calls).includes('NEVER_RETAIN_PAUSED_MARKER'));
  const stopped=ok(f.core.setProjectCapture({namespace:ns,expectedGeneration:paused.generation,enabled:false}));
  const reopened=openMemoryCore({path:f.path,...options,model:f.model});t.after(()=>reopened.close());
  const next=input(3);next.episodeContext.generation=stopped.generation;assertError(await reopened.capture(next),'capture_disabled');
});

test('E8 keep uses retained evidence and action replay, never gist; stale action rejects',async t=>{
  const f=setup(t,{interpretEpisode:r=>interpretation(r,'quick-one-off-question')});
  const first=ok(await f.core.capture(input()));const details=ok(f.core.getEpisode({namespace:ns,episodeId:first.episode.id}));
  const action={namespace:ns,episodeId:first.episode.id,expectedRevision:details.episode.revision,actionId:'keep-once'};
  const kept=ok(await f.core.keepEpisode(action));assert.equal(kept.episode.policy,'explicit-keep');
  const extract=f.model.calls.find(call=>call.method==='extract');assert.equal(extract.request.input.messages[0].content,input().messages[0].content);
  assert.ok(!JSON.stringify(extract).includes('Synthetic 中文 activity'));
  const before=f.model.calls.length;assert.equal(ok(await f.core.keepEpisode(action)).duplicate,true);assert.equal(f.model.calls.length,before);
  assertError(await f.core.keepEpisode({...action,actionId:'stale',expectedRevision:1}),'revision_conflict');
});

for(const [name,mutate] of [
  ['foreign-anchor',value=>{value.gist.anchors[0].sourceIndex=999;}],
  ['split-surrogate',value=>{value.gist.anchors[0].start=1;value.gist.anchors[0].end=2;}],
  ['malformed-unicode',value=>{value.gist.value='\ud800';}],
  ['extra-field',value=>{value.trusted=true;}],
  ['missing-field',value=>{delete value.outcome;}],
]) test(`E2 ${name} rejects interpretation alone and admits normally`,async t=>{
  const f=setup(t,{interpretEpisode:r=>{const result=interpretation(r);mutate(result);return result;}});
  const value=input();value.messages[0].content='😀 中文 English source';
  const result=ok(await f.core.capture(value));assert.equal(result.episode.status,'failed');assert.equal(counts(f.model,'extract'),1);
  const inspected=ok(f.core.getEpisode({namespace:ns,episodeId:result.episode.id}));assert.equal(inspected.episode.gist,null);
});

test('E3/E4a N8/129 small-batch successful orchestration baseline; no quota exhaustion',async()=>{
  const {model}=await import('../testing/episode-capture-helpers.mjs');const port=model();
  const core=openMemoryCore({path:':memory:',...options,model:port});
  try {
    for(let n=1;n<=129;n++)ok(await core.capture(input(n)));
    assert.equal(counts(port),17);assert.equal(counts(port,'extract'),129);
  } finally {core.close();}
});

test('E8 quick anchors exclusively in old context cannot skip current admission; end cannot change past policy',async t=>{
  let ordinal=0;
  const f=setup(t,{interpretEpisode:r=>{
    const result=interpretation(r,'quick-one-off-question');
    if(++ordinal>1)result.type.anchors=[{sourceIndex:r.input.sources.length-1,start:0,end:1}];
    return result;
  }},{sessionEpisodes:{mode:'episode-v1',draftEveryBatches:2}});
  const first=ok(await f.core.capture(input()));ok(await f.core.capture(input(2)));ok(await f.core.capture(input(3)));
  const before=ok(f.core.getEpisode({namespace:ns,episodeId:first.episode.id}));assert.equal(before.policies.items[2].policy,'normal');
  ok(await f.core.capture(input(4)));ok(await f.core.endEpisodeSession({namespace:ns,client:'synthetic',sessionId:'private-session',generation:'initial',eventId:'end'}));
  const after=ok(f.core.getEpisode({namespace:ns,episodeId:first.episode.id}));assert.equal(after.policies.items[3].policy,'normal');
});

test('E8 failed explicit keep replay has a durable outcome and makes no further calls',async t=>{
  const f=setup(t,{interpretEpisode:r=>interpretation(r,'quick-one-off-question'),extract:()=>{throw Error('scripted failure');}});
  const result=ok(await f.core.capture(input()));const detail=ok(f.core.getEpisode({namespace:ns,episodeId:result.episode.id}));
  const action={namespace:ns,episodeId:result.episode.id,expectedRevision:detail.episode.revision,actionId:'failed-keep'};
  assertError(await f.core.keepEpisode(action),'extraction_failed');const calls=f.model.calls.length;
  assertError(await f.core.keepEpisode(action),'extraction_failed');assert.equal(f.model.calls.length,calls);
  assert.equal(ok(f.core.getEpisode({namespace:ns,episodeId:result.episode.id})).keepActions.items[0].errorCode,'extraction_failed');
});

test('E4 actual 30-second abort precedes a fresh 125-second admission lease (mock clock, no sleep)',async t=>{
  const {deferred}=await import('../testing/episode-capture-helpers.mjs');const entered=deferred();let signal;
  t.mock.timers.enable({apis:['setTimeout']});
  const f=setup(t,{interpretEpisode:request=>{signal=request.signal;entered.resolve();return new Promise(()=>{});},
    extract:()=>{const row=f.db.prepare('SELECT state,lease_expires_at FROM admission_claims').get();assert.equal(row.state,'pending');assert.ok(row.lease_expires_at-Date.now()>124000);return {items:[]};}});
  const pending=f.core.capture(input());await entered.promise;
  const reserved=f.db.prepare('SELECT state,lease_expires_at FROM admission_claims').get();assert.equal(reserved.state,'reserved');assert.equal(reserved.lease_expires_at,null);
  t.mock.timers.tick(30000);const result=ok(await pending);assert.equal(signal.aborted,true);assert.equal(result.episode.error.code,'episode_timeout');
});

test('E3/E4a v16 ledger, parent, shell and staging registration roll back together',async t=>{
  const f=setup(t);f.db.exec("CREATE TRIGGER reject_staging BEFORE INSERT ON staged_capture_evidence BEGIN SELECT RAISE(ABORT,'synthetic'); END");
  assertError(await f.core.capture(input()),'storage_error');assert.equal(f.model.calls.length,0);
  for(const table of ['episode_messages','episode_events','admission_claims','session_episodes','staged_capture_evidence'])
    assert.equal(f.db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
  f.db.exec('DROP TRIGGER reject_staging');ok(await f.core.capture(input()));
});

for(const client of ['claude','codex'])test(`E6 synthetic ${client} producer generations exclude paused/partial text across restart and re-enable`,async t=>{
  const f=setup(t);const first={...input(),client};ok(await f.core.capture(first));
  const stopped=ok(f.core.setProjectCapture({namespace:ns,expectedGeneration:'initial',enabled:false}));
  const withheld={...input(2),client,messages:[{id:'partial-line',role:'user',content:'PAUSED_PARTIAL_MARKER'}]};
  assertError(await f.core.capture(withheld),'generation_conflict');
  const enabled=ok(f.core.setProjectCapture({namespace:ns,expectedGeneration:stopped.generation,enabled:true}));
  const reopened=openMemoryCore({path:f.path,...options,model:f.model});t.after(()=>reopened.close());
  // Trusted producer skips to transcript end; only the next complete message is submitted.
  const fresh={...input(3),client,episodeContext:{...input().episodeContext,generation:enabled.generation}};
  ok(await reopened.capture(fresh));
  assert.ok(!JSON.stringify(f.model.calls).includes('PAUSED_PARTIAL_MARKER'));
  assert.equal(f.db.prepare("SELECT count(*) n FROM episode_messages WHERE message_id='partial-line'").get().n,0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM session_episodes WHERE scope='personal'").get().n,0);
});
