import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../index.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { setup,input,interpretation,counts,ns,options,ok,assertError,captureOperations } from '../testing/episode-capture-helpers.mjs';
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
  for(const forbidden of ['private-session','Synthetic client','1901-02-03','generation'])assert.ok(!payload.includes(forbidden),forbidden);
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

test('E2 strict Unicode, time, foreign and split-code-point output; E3 durable message reuse after release/restart',async t=>{
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
  const f=setup(t,{interpretEpisode:r=>interpretation(r,'quick-one-off-question'),extract:()=>({invalid:'scripted terminal failure'})});
  const result=ok(await f.core.capture(input()));const detail=ok(f.core.getEpisode({namespace:ns,episodeId:result.episode.id}));
  const action={namespace:ns,episodeId:result.episode.id,expectedRevision:detail.episode.revision,actionId:'failed-keep'};
  assertError(await f.core.keepEpisode(action),'invalid_model_output');const calls=f.model.calls.length;
  assertError(await f.core.keepEpisode(action),'invalid_model_output');assert.equal(f.model.calls.length,calls);
  assert.equal(ok(f.core.getEpisode({namespace:ns,episodeId:result.episode.id})).keepActions.items[0].errorCode,'invalid_model_output');
});

test('E4 real 30-second abort precedes a fresh 125-second admission lease', { timeout: 45000 }, async t=>{
  const {deferred}=await import('../testing/episode-capture-helpers.mjs');const entered=deferred();let signal;
  const f=setup(t,{interpretEpisode:request=>{signal=request.signal;entered.resolve();return new Promise(()=>{});},
    extract:()=>{const row=f.db.prepare('SELECT state,lease_expires_at FROM admission_claims').get();assert.equal(row.state,'pending');assert.ok(row.lease_expires_at-Date.now()>124000);return {items:[]};}});
  const pending=f.core.capture(input());await entered.promise;
  const reserved=f.db.prepare('SELECT state,lease_expires_at FROM admission_claims').get();assert.equal(reserved.state,'reserved');assert.equal(reserved.lease_expires_at,null);
  const result=ok(await pending);assert.equal(signal.aborted,true);assert.equal(result.episode.error.code,'episode_timeout');
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

test('E8 transient busy keep releases its own claim and retries the same action', async t => {
  let lock = false;
  const f = setup(t, { interpretEpisode: r => interpretation(r, 'quick-one-off-question'),
    extract: () => {
      if (lock) f.db.exec('BEGIN IMMEDIATE');
      return { items: [] };
    } });
  const first = ok(await f.core.capture(input()));
  const detail = ok(f.core.getEpisode({ namespace: ns, episodeId: first.episode.id }));
  const action = { namespace: ns, episodeId: first.episode.id, expectedRevision: detail.episode.revision, actionId: 'busy' };
  lock = true;
  assertError(await f.core.keepEpisode(action), 'storage_busy');
  f.db.exec('ROLLBACK'); lock = false;
  const retry = ok(await f.core.keepEpisode(action));
  assert.equal(retry.admission.memories.length, 0);
  assert.equal(counts(f.model, 'extract'), 2);
  assert.equal(counts(f.model), 1);
  assert.equal(ok(await f.core.keepEpisode(action)).duplicate, true);
  assert.equal(counts(f.model, 'extract'), 2);
  const stored = f.db.prepare('SELECT token,keep_state,keep_error_code FROM episode_keep_actions').get();
  assert.equal(stored.keep_state, 'completed'); assert.equal(stored.keep_error_code, null);
  assert.equal(stored.token, null);
});

test('E8 keep coverage survives new drafts and all 27 actions page in creation order', async t => {
  const f = setup(t);
  const first = ok(await f.core.capture(input()));
  const detail = ok(f.core.getEpisode({ namespace: ns, episodeId: first.episode.id }));
  for (let n = 0; n < 27; n++) ok(await f.core.keepEpisode({ namespace: ns, episodeId: first.episode.id,
    expectedRevision: detail.episode.revision, actionId: 'keep-' + n }));
  let page = ok(f.core.getEpisode({ namespace: ns, episodeId: first.episode.id }));
  assert.equal(page.keepActions.items.length, 20); assert.equal(page.keepActions.exhausted, false);
  const coverage = page.keepActions.items[0].sourceCoverage;
  assert.deepEqual(coverage.sourceIds, detail.sources.items.map(source => source.id));
  assert.equal(coverage.revision, detail.episode.revision);
  assert.equal(page.policies.items[0].policy, 'normal');
  const second = ok(f.core.getEpisode({ namespace: ns, episodeId: first.episode.id, keepCursor: page.keepActions.nextCursor }));
  assert.equal(second.keepActions.items.length, 7); assert.equal(second.keepActions.exhausted, true);
  assert.equal(second.keepActions.nextCursor, null);
  const ordinals = [...page.keepActions.items, ...second.keepActions.items].map(action => action.ordinal);
  assert.equal(new Set(ordinals).size, 27); assert.deepEqual(ordinals, [...ordinals].sort((a, b) => a - b));
  assertError(f.core.getEpisode({ namespace: ns, episodeId: first.episode.id, keepLimit: 51 }), 'invalid_input');
  const next = input(2); next.episodeContext.origin = 'precompact'; ok(await f.core.capture(next));
  page = ok(f.core.getEpisode({ namespace: ns, episodeId: first.episode.id, keepLimit: 50 }));
  assert.equal(page.keepActions.items.length, 27);
  assert.deepEqual(page.keepActions.items[0].sourceCoverage, coverage);
  assert.ok(!page.sources.items.some(source => coverage.sourceIds.includes(source.id)));
});

test('E3 client episode-keep prefix is ordinary capture; abandoned overlaps can be registered anew', async t => {
  let failing = true;
  const f = setup(t, { extract: () => { if (failing) throw Error('synthetic failure'); return { items: [] }; } });
  const original = { ...input(), eventId: 'episode-keep:client-owned' };
  assertError(await f.core.capture(original), 'extraction_failed');
  failing = false;
  const retry = ok(await f.core.capture({ ...original, eventId: 'resent' }));
  assert.equal(retry.duplicate, false); assert.equal(retry.admission.memories.length, 0);
  assert.equal(f.db.prepare('SELECT observed FROM session_episodes').get().observed, 2);
  const identity = f.db.prepare('SELECT first_event_id,coverage_event_id FROM episode_messages').get();
  assert.equal(identity.first_event_id, original.eventId); assert.equal(identity.coverage_event_id, 'resent');
  const calls = f.model.calls.length;
  assert.equal(ok(await f.core.capture({ ...original, eventId: 'covered' })).overlap, true);
  assert.equal(f.model.calls.length, calls);
});

test('E3 full-message digest is shared by validation and registration, including time and the tail', t => {
  const f = setup(t), runtime = createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } });
  t.after(() => runtime.close());
  const original = batch('full', 'x'.repeat(800));
  original.messages[0].content += ' canonical tail';
  original.messages[0].occurredAt = '2026-09-28T00:00:00.000Z';
  const missing = { ...original }; delete missing.messages;
  assert.throws(() => runtime.reserveEpisodeBatch(ns, missing), { code: 'invalid_input' });
  runtime.reserveEpisodeBatch(ns, original);
  const claim = runtime.claimAdmission(ns, { ...original, leaseMs: 125000 });
  runtime.finishAdmission(ns, { ...original, token: claim.token, items: [] });
  const overlap = { ...original, eventId: 'full-overlap' };
  assert.equal(runtime.validateEpisodeBatch(ns, overlap).overlap, true);
  assert.equal(runtime.reserveEpisodeBatch(ns, overlap).overlap, true);
  for (const content of ['x'.repeat(800), original.messages[0].content + '!']) {
    const changed = { ...overlap, messages: [{ ...original.messages[0], content }] };
    for (const method of ['validateEpisodeBatch', 'reserveEpisodeBatch'])
      assert.throws(() => runtime[method](ns, changed), { code: 'event_payload_conflict' });
  }
});

for (const client of ['', 'x'.repeat(65), 'bad:client', 'bad client']) test(`E6 end rejects invalid client ${JSON.stringify(client)}`, async t => {
  const f = setup(t);
  assertError(await f.core.endEpisodeSession({ namespace: ns, client, sessionId: 's', eventId: 'end', generation: 'initial' }), 'invalid_input');
  assert.equal(f.model.calls.length, 0);
});

test('E4 omission codes stay finite while all 24 omitted message positions remain inspectable', async t => {
  const f = setup(t, {}, { sessionEpisodes: { mode: 'episode-v1', draftEveryBatches: 2 } });
  const first = ok(await f.core.capture(input()));
  const older = input(2); older.messages = Array.from({ length: 24 }, (_, n) =>
    ({ id: 'omitted-' + n, role: 'user', content: 'Older synthetic source ' + n }));
  ok(await f.core.capture(older));
  f.model.countTokens = text => {
    const value = JSON.parse(text);
    return value.input?.classificationTarget && value.input.sources.length > 1 ? 6001 : 1;
  };
  ok(await f.core.capture(input(3)));
  const detail = ok(f.core.getEpisode({ namespace: ns, episodeId: first.episode.id }));
  const policy = detail.policies.items.find(item => item.eventId === older.eventId);
  assert.deepEqual(policy.gapReasons, ['omitted']); assert.equal(policy.omittedCount, 24);
  assert.deepEqual(policy.omittedMessageIndices, Array.from({ length: 24 }, (_, n) => n));
  assert.ok(detail.policies.items.flatMap(item => item.gapReasons).every(code => code.length <= 64));
});

test('E4 end and lazy report capacity when the newest batch was never staged', async t => {
  const f = setup(t), runtime = createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } });
  t.after(() => runtime.close());
  for (let n = 0; n < 64; n++) runtime.reserveEpisodeBatch(ns, { ...batch('protected-' + n, 'Protected', 'p-' + n), client: 'other' });
  ok(await f.core.capture(input())); ok(await f.core.capture(input(2)));
  const ended = ok(await f.core.endEpisodeSession({ namespace: ns, client: 'synthetic', sessionId: 'private-session', generation: 'initial', eventId: 'end' }));
  assert.equal(ended.episode.error.code, 'capacity');
  ok(await f.core.capture(input(3)));
  const later = ok(await f.core.capture(input(1, 'next-session')));
  assert.equal(later.lazyEpisode.error.code, 'capacity'); assert.equal(counts(f.model), 0);
  assert.ok(f.db.prepare('SELECT gap_reasons FROM episode_events').all().every(row => !row.gap_reasons.includes('context_budget_exceeded')));
});

test('E8 unknown keep storage errors stay storage_error and permit action retry', async t => {
  const { keepEpisodeCapture } = await import('../episode-capture.mjs');
  const f = setup(t, { interpretEpisode: r => interpretation(r, 'quick-one-off-question') });
  const first = ok(await f.core.capture(input()));
  const detail = ok(f.core.getEpisode({ namespace: ns, episodeId: first.episode.id }));
  const action = { namespace: ns, episodeId: first.episode.id, expectedRevision: detail.episode.revision, actionId: 'unknown-error' };
  const runtime = createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } });
  t.after(() => runtime.close());
  await assert.rejects(keepEpisodeCapture({ runtime: { ...runtime,
    assertEpisodeKeep() { throw Error('synthetic unclassified storage failure'); } }, ns, keepInput: action,
    input: { namespace: ns }, model: f.model, captureEvidence: 'staged-v1', captureQualification: 'source-bound-v2',
    operations: { abandonAdmission: value => runtime.abandonAdmission(ns, value) } }), { code: 'storage_error' });
  const stored = f.db.prepare('SELECT keep_state,keep_error_code FROM episode_keep_actions').get();
  assert.equal(stored.keep_state, 'retryable'); assert.equal(stored.keep_error_code, null);
  assert.equal(f.db.prepare("SELECT state FROM episode_keep_actions").get().state, 'reserved');
  assert.equal(ok(await f.core.keepEpisode(action)).admission.memories.length, 0);
  assert.equal(counts(f.model, 'extract'), 2);
});

test('E8 failed keep preserves completed quick policy, basis and admission exactly', async t => {
  const f = setup(t, { interpretEpisode: r => interpretation(r, 'quick-one-off-question'),
    extract: () => ({ invalid: true }) });
  const first = ok(await f.core.capture(input()));
  const before = f.db.prepare('SELECT * FROM episode_events').get();
  const detail = ok(f.core.getEpisode({ namespace: ns, episodeId: first.episode.id }));
  assertError(await f.core.keepEpisode({ namespace: ns, episodeId: first.episode.id,
    expectedRevision: detail.episode.revision, actionId: 'failed-keep' }), 'invalid_model_output');
  assert.deepEqual(f.db.prepare('SELECT * FROM episode_events').get(), before);
  assert.equal(before.policy, 'skip-quick'); assert.equal(before.policy_type, 'quick-one-off-question');
  assert.equal(before.admission, 'completed');
  assert.equal(ok(await f.core.capture(input())).admission.status, 'completed');
  assert.equal(counts(f.model, 'extract'), 1);
});

test('E4 interpretation provider failure emits the documented diagnostic exactly', async t => {
  const diagnostics = [];
  const f = setup(t, { interpretEpisode: () => { throw Error('synthetic provider failure'); },
    onDiagnostic: event => diagnostics.push(event) });
  const result = ok(await f.core.capture(input()));
  assert.equal(result.episode.error.code, 'episode_failed');
  assert.deepEqual(diagnostics, [{ version: 1, stage: 'interpretEpisode', layer: 'core_call', reason: 'provider_failure' }]);
});

test('E8 keep identity and ordinal are separate from capture events and draft attempts', async t => {
  const f = setup(t);
  const first = ok(await f.core.capture(input()));
  const detail = ok(f.core.getEpisode({ namespace: ns, episodeId: first.episode.id }));
  const before = f.db.prepare('SELECT ordinal FROM episode_controls').get().ordinal;
  const drafts = f.db.prepare('SELECT * FROM episode_attempts').all();
  ok(await f.core.keepEpisode({ namespace: ns, episodeId: first.episode.id,
    expectedRevision: detail.episode.revision, actionId: 'identity' }));
  const action = f.db.prepare('SELECT * FROM episode_keep_actions').get();
  assert.equal(action.client, 'synthetic'); assert.equal(action.keep_ordinal, 1);
  assert.equal(f.db.prepare('SELECT ordinal FROM episode_controls').get().ordinal, before);
  assert.deepEqual(f.db.prepare('SELECT * FROM episode_attempts').all(), drafts);
  assert.equal(f.db.prepare('SELECT count(*) n FROM admission_claims').get().n, 1);
  const captured = ok(await f.core.capture({ ...input(2), eventId: action.admission_key }));
  assert.equal(captured.admission.status, 'completed');
  assert.equal(f.db.prepare('SELECT count(*) n FROM admission_claims').get().n, 2);
  const runtime = createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } });
  const legacy = openMemoryCore({ path: f.path, model: f.model });
  t.after(() => { runtime.close(); legacy.close(); });
  const current = ok(f.core.getEpisode({ namespace: ns, episodeId: first.episode.id }));
  const next = { namespace: ns, episodeId: first.episode.id, expectedRevision: current.episode.revision, actionId: 'ordered-collision' };
  const prepared = runtime.prepareEpisodeKeep(ns, next);
  ok(await legacy.capture({ namespace: ns, client: 'synthetic', sessionId: 'legacy', eventId: prepared.key.eventId,
    causal: { streamId: 'legacy-stream', sequence: 1 }, messages: [{ id: 'legacy-message', role: 'user', content: 'Synthetic ordered evidence' }] }));
  assert.equal(ok(await f.core.keepEpisode(next)).admission.status, 'completed');
});

test('E6 end signal ID may collide with a forgotten capture event', async t => {
  const f = setup(t);
  const first = ok(await f.core.capture(input(1, 'forgotten')));
  const detail = ok(f.core.getEpisode({ namespace: ns, episodeId: first.episode.id }));
  ok(f.core.forgetEpisode({ namespace: ns, episodeId: first.episode.id, expectedRevision: detail.episode.revision }));
  ok(await f.core.capture(input(1, 'live'))); ok(await f.core.capture(input(2, 'live')));
  const result = ok(await f.core.endEpisodeSession({ namespace: ns, client: 'synthetic', sessionId: 'live',
    generation: 'initial', eventId: input(1, 'forgotten').eventId }));
  assert.equal(result.episode.status, 'interpreted');
});

test('E3 partial completed overlap extracts only previously unadmitted messages', async t => {
  const f = setup(t);
  ok(await f.core.capture(input()));
  const second = input(2); second.messages.unshift(input().messages[0]);
  const result = ok(await f.core.capture(second));
  assert.equal(result.admission.status, 'completed');
  assert.deepEqual(f.model.calls.filter(call => call.method === 'extract').at(-1).request.input.messages.map(m => m.content),
    [input(2).messages[0].content]);
  assert.equal(f.db.prepare('SELECT observed FROM session_episodes').get().observed, 2);
});

test('E8 keep cleanup recognizes SQLite primary and extended busy/locked codes only', async () => {
  const { createEpisodeStorage } = await import('../episode-storage.mjs');
  const kept = { key: { eventId: 'synthetic-action' } };
  for (const errcode of [5, 6, 261, 262]) {
    const store = createEpisodeStorage({ db: { exec() { throw Object.assign(Error('synthetic lock'), { code: 'ERR_SQLITE_ERROR', errcode }); } } });
    assert.doesNotThrow(() => store.failKeep(ns, kept, 'storage_busy'));
  }
  for (const metadata of [{ code: 'SQLITE_BUSY' }, { code: 'storage_busy' }, { errcode: 5 },
    { code: 'ERR_SQLITE_ERROR', errcode: 19 }]) {
    const error = Object.assign(Error('unclassified failure'), metadata);
    const store = createEpisodeStorage({ db: { exec() { throw error; } } });
    assert.throws(() => store.failKeep(ns, kept, 'storage_error'), value => value === error);
  }
});

for (const boundary of ['claimEpisodeDraft', 'snapshot-1', 'snapshot-2', 'snapshot-3', 'startEpisodeAttempt']) {
  test(`E3/E5 a held lock at ${boundary} spends no draft allowance or model call`, { timeout: 15000 }, async t => {
    const { captureEpisodeMessages, endEpisode } = await import('../episode-capture.mjs');
    const f = setup(t), runtime = createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } });
    t.after(() => runtime.close());
    let snapshots = 0, locked = false;
    const wrapped = { ...runtime };
    for (const method of ['claimEpisodeDraft', 'episodeDraftSnapshot', 'startEpisodeAttempt']) {
      wrapped[method] = (...args) => {
        const current = method === 'episodeDraftSnapshot' ? `snapshot-${++snapshots}` : method;
        if (!locked && current === boundary) {
          locked = true; f.db.exec('BEGIN IMMEDIATE');
          try { return runtime[method](...args); }
          finally { f.db.exec('ROLLBACK'); }
        }
        return runtime[method](...args);
      };
    }
    const captured = await captureEpisodeMessages({ runtime: wrapped, ns, model: f.model, input: input(), operations: captureOperations(runtime) });
    assert.deepEqual(captured.episode.error, { code: 'storage_busy', retryable: true });
    assert.equal(captured.admission.status, 'completed');
    assert.equal(locked, true); assert.equal(counts(f.model), 0); assert.equal(counts(f.model, 'extract'), 1);
    assert.equal(f.db.prepare('SELECT attempted FROM session_episodes').get().attempted, 0);
    assert.equal(f.db.prepare('SELECT count(*) n FROM episode_attempts').get().n, 0);
    assert.deepEqual(JSON.parse(f.db.prepare('SELECT gap_reasons FROM episode_events').get().gap_reasons), []);
    assert.equal(f.db.prepare('SELECT state FROM admission_claims').get().state, 'completed');
    // The end path exposes the same retryable local error without laundering it.
    locked = false; snapshots = 0;
    const ended = await endEpisode({ runtime: wrapped, ns, model: f.model,
      input: { client: 'synthetic', sessionId: 'private-session', generation: 'initial', eventId: 'end' } });
    assert.deepEqual(ended.episode.error, { code: 'storage_busy', retryable: true });
    assert.equal(f.db.prepare('SELECT count(*) n FROM episode_attempts').get().n, 0);
    assert.equal(ok(await f.core.capture(input())).admission.status, 'completed');
    assert.equal(counts(f.model), 0); assert.equal(counts(f.model, 'extract'), 1);
  });
}

for (const boundary of ['commitEpisodeDraft', 'snapshot-4', 'snapshot-5', 'failEpisodeDraft']) {
  test(`E3/E5 paid draft lock at ${boundary} records its failure within budget and admits immediately`, { timeout: 15000 }, async t => {
    const { captureEpisodeMessages } = await import('../episode-capture.mjs');
    const f = setup(t, boundary === 'failEpisodeDraft' ? { interpretEpisode: () => ({ invalid: true }) } : {});
    const runtime = createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } });
    t.after(() => runtime.close());
    let snapshots = 0, locked = false, failures = 0;
    const wrapped = { ...runtime };
    for (const method of ['episodeDraftSnapshot', 'commitEpisodeDraft', 'failEpisodeDraft']) {
      wrapped[method] = (...args) => {
        if (method === 'failEpisodeDraft') failures++;
        const current = method === 'episodeDraftSnapshot' ? `snapshot-${++snapshots}` : method;
        if (!locked && current === boundary) {
          locked = true; f.db.exec('BEGIN IMMEDIATE');
          if (method === 'failEpisodeDraft') {
            try { return runtime[method](...args); }
            finally { f.db.exec('ROLLBACK'); }
          }
          return runtime[method](...args);
        }
        if (method === 'failEpisodeDraft' && failures === 1) {
          try { return runtime[method](...args); }
          finally { f.db.exec('ROLLBACK'); }
        }
        return runtime[method](...args);
      };
    }
    const captured = await captureEpisodeMessages({ runtime: wrapped, ns, model: f.model,
      input: input(), operations: captureOperations(runtime) });
    assert.equal(locked, true);
    const code = boundary === 'failEpisodeDraft' ? 'invalid_model_output' : 'episode_failed';
    assert.deepEqual(captured.episode.error, { code, retryable: false });
    assert.equal(captured.admission.status, 'completed');
    assert.equal(failures, 2);
    assert.equal(counts(f.model), 1); assert.equal(counts(f.model, 'extract'), 1);
    const attempt = f.db.prepare('SELECT * FROM episode_attempts').get();
    assert.equal(attempt.started, 1); assert.equal(attempt.finished, 1);
    assert.equal(f.db.prepare('SELECT attempted FROM session_episodes').get().attempted, 1);
    assert.deepEqual(JSON.parse(f.db.prepare('SELECT gap_reasons FROM episode_events').get().gap_reasons), [code]);
    assert.equal(ok(await f.core.capture(input(2))).admission.status, 'completed');
    assert.equal(ok(await f.core.capture(input())).admission.status, 'completed');
    assert.equal(counts(f.model), 1); assert.equal(counts(f.model, 'extract'), 2);
    assert.equal(JSON.parse(f.db.prepare('SELECT record FROM session_episodes').get().record).processing.errorCode, code);
  });
}

test('E8 a raw keep assertion lock returns retryable storage_busy and the same action can complete', { timeout: 30000 }, async t => {
  let lock = true;
  const f = setup(t, { interpretEpisode: r => interpretation(r, 'quick-one-off-question'), extract: () => {
    if (lock) f.db.exec('BEGIN EXCLUSIVE');
    return { items: [] };
  } });
  const first = ok(await f.core.capture(input()));
  const detail = ok(f.core.getEpisode({ namespace: ns, episodeId: first.episode.id }));
  const action = { namespace: ns, episodeId: first.episode.id, expectedRevision: detail.episode.revision, actionId: 'assert-lock' };
  try {
    const result = await f.core.keepEpisode(action);
    assert.deepEqual(result, { ok: false, error: { code: 'storage_busy', retryable: true } });
  } finally { f.db.exec('ROLLBACK'); }
  assert.equal(f.db.prepare('SELECT keep_state FROM episode_keep_actions').get().keep_state, 'pending');
  lock = false;
  assert.equal(ok(await f.core.keepEpisode(action)).admission.status, 'completed');
  assert.equal(f.db.prepare('SELECT keep_state FROM episode_keep_actions').get().keep_state, 'completed');
  assert.equal(counts(f.model), 1); assert.equal(counts(f.model, 'extract'), 2);
});

for (const boundary of ['commitEpisodeDraft', 'snapshot-4', 'snapshot-5']) {
  const outcomes = boundary === 'commitEpisodeDraft'
    ? ['recorded', 'busy', 'recovered', 'no-outcome'] : ['recorded', 'busy'];
  for (const finalWrite of outcomes) {
    test(`E4/E5 lock beyond budget at ${boundary}; post-admission write ${finalWrite}; ` +
      'fake clock covers stranded lease recovery only',
    { timeout: 20000 }, async t => {
      const { captureEpisodeMessages } = await import('../episode-capture.mjs');
      const f = setup(t), runtime = createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } });
      t.after(() => runtime.close());
      let snapshots = 0, locked = false, failureWrites = 0, failureStart, writesBeforeAdmission;
      let admitted = false;
      const wrapped = { ...runtime,
        failEpisodeDraft(...args) {
          failureStart ??= performance.now(); failureWrites++;
          if (admitted && finalWrite === 'recovered') {
            // A separate connection recovers the genuinely stranded attempt just
            // before its original owner makes the extra post-admission write.
            f.db.exec('UPDATE episode_attempts SET expires_at=0; ' +
              'UPDATE session_episodes SET writer_expires_at=0');
            const successor = createMemoryRuntime({ path: f.path,
              sessionEpisodes: { mode: 'episode-v1' } });
            try {
              const episodeId = args[1].episodeId;
              const writer = successor.claimEpisodeWriter(ns, { episodeId, generation: 'initial' });
              successor.releaseEpisodeWriter(ns, { episodeId, token: writer.token });
            } finally { successor.close(); }
            const result = runtime.failEpisodeDraft(...args);
            assert.equal(result, undefined);
            return result;
          }
          if (admitted && finalWrite === 'no-outcome') return undefined;
          if (admitted && finalWrite === 'busy') {
            f.db.exec('BEGIN IMMEDIATE');
            try { return runtime.failEpisodeDraft(...args); }
            finally { f.db.exec('ROLLBACK'); }
          }
          return runtime.failEpisodeDraft(...args);
        },
        claimAdmission(...args) {
          // The owner exhausted finalization while a real SQLite lock was held.
          // Release at the admission boundary, not by advancing a production clock.
          assert.ok(performance.now() - failureStart >= 4900);
          assert.ok(failureWrites > 1 && failureWrites <= 21);
          writesBeforeAdmission = failureWrites;
          f.db.exec('ROLLBACK');
          return runtime.claimAdmission(...args);
        },
      };
      for (const method of ['episodeDraftSnapshot', 'commitEpisodeDraft']) wrapped[method] = (...args) => {
        const current = method === 'episodeDraftSnapshot' ? `snapshot-${++snapshots}` : method;
        if (!locked && current === boundary) { locked = true; f.db.exec('BEGIN IMMEDIATE'); }
        return runtime[method](...args);
      };
      const operations = captureOperations(runtime);
      const captured = await captureEpisodeMessages({ runtime: wrapped, ns, model: f.model,
        input: input(), operations: { ...operations, finishAdmission(value) {
          const result = operations.finishAdmission(value); admitted = true; return result;
        } } });
      assert.equal(locked, true); assert.equal(captured.admission.status, 'completed');
      assert.equal(failureWrites, writesBeforeAdmission + 1);
      const pending = ['busy', 'no-outcome'].includes(finalWrite);
      const storedCode = finalWrite === 'recovered' ? 'episode_timeout' : 'episode_failed';
      assert.deepEqual(captured.episode.error, {
        code: pending ? 'episode_outcome_pending' : storedCode, retryable: false });
      assert.equal(f.db.prepare('SELECT finished FROM episode_attempts').get().finished, pending ? 0 : 1);
      if (!pending) {
        assert.equal(counts(f.model), 1); assert.equal(counts(f.model, 'extract'), 1);
        const event = f.db.prepare('SELECT gap_reasons FROM episode_events').get();
        assert.deepEqual(JSON.parse(event.gap_reasons), [storedCode]);
        assert.equal(JSON.parse(f.db.prepare('SELECT record FROM session_episodes').get().record)
          .processing.errorCode, captured.episode.error.code);
        return;
      }
      // Replaying the same event neither finalizes nor repeats interpretation.
      const replay = ok(await f.core.capture(input()));
      assert.equal(replay.duplicate, true);
      assert.equal(replay.admission.status, 'completed');
      assert.equal(f.db.prepare('SELECT finished FROM episode_attempts').get().finished, 0);
      assert.equal(JSON.parse(f.db.prepare('SELECT record FROM session_episodes').get().record)
        .processing.errorCode, null);
      // A still-live, stranded attempt must not delay admission of a different batch.
      assert.equal(ok(await f.core.capture(input(2))).admission.status, 'completed');
      assert.equal(counts(f.model), 1); assert.equal(counts(f.model, 'extract'), 2);
      // Only this explicit lease-recovery test uses a fake clock.
      f.db.exec('UPDATE episode_attempts SET expires_at=0');
      const reopened = openMemoryCore({ path: f.path, ...options, model: f.model });
      t.after(() => reopened.close());
      assert.equal(ok(await reopened.capture(input())).admission.status, 'completed');
      assert.equal(f.db.prepare('SELECT finished FROM episode_attempts').get().finished, 1);
      assert.equal(JSON.parse(f.db.prepare('SELECT record FROM session_episodes').get().record).processing.errorCode, 'episode_timeout');
      const event = f.db.prepare('SELECT gap_reasons FROM episode_events WHERE event_id=?').get(input().eventId);
      assert.deepEqual(JSON.parse(event.gap_reasons), ['episode_timeout']);
      assert.equal(counts(f.model), 1); assert.equal(counts(f.model, 'extract'), 2);
    });
  }
}

test('E4/E5 admission busy preserves staged evidence and the same event retries immediately', { timeout: 20000 }, async t => {
  let lock = true;
  const f = setup(t, { extract: () => {
    if (lock) f.db.exec('BEGIN IMMEDIATE');
    return { items: [] };
  } });
  try { assert.deepEqual(await f.core.capture(input()), { ok: false, error: { code: 'storage_busy', retryable: true } }); }
  finally { f.db.exec('ROLLBACK'); }
  const evidence = f.db.prepare('SELECT state,payload FROM staged_capture_evidence').get();
  assert.equal(evidence.state, 'pending'); assert.notEqual(evidence.payload, null);
  lock = false;
  assert.equal(ok(await f.core.capture(input())).admission.status, 'completed');
  assert.equal(f.db.prepare('SELECT state FROM staged_capture_evidence').get().state, 'released');
  assert.equal(counts(f.model), 1); assert.equal(counts(f.model, 'extract'), 2);
});

for (const trigger of ['end', 'lazy']) {
  test(`E4 ${trigger} returns non-retryable pending outcome while failure recording stays locked`,
  { timeout: 15000 }, async t => {
    const { captureEpisodeMessages, endEpisode } = await import('../episode-capture.mjs');
    let failNext = false;
    const f = setup(t, { interpretEpisode: request => {
      if (failNext) { failNext = false; throw Error('scripted failure'); }
      return interpretation(request);
    } });
    const first = ok(await f.core.capture(input()));
    ok(await f.core.capture(input(2)));
    const runtime = createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } });
    t.after(() => runtime.close());
    let locked = false, failureWrites = 0;
    const wrapped = { ...runtime,
      failEpisodeDraft(...args) {
        failureWrites++;
        if (!locked) { f.db.exec('BEGIN IMMEDIATE'); locked = true; }
        return runtime.failEpisodeDraft(...args);
      },
      releaseEpisodeWriter(...args) {
        if (locked) { f.db.exec('ROLLBACK'); locked = false; }
        return runtime.releaseEpisodeWriter(...args);
      },
    };
    failNext = true;
    const result = trigger === 'end'
      ? await endEpisode({ runtime: wrapped, ns, model: f.model,
        input: { client: 'synthetic', sessionId: 'private-session', generation: 'initial' } })
      : await captureEpisodeMessages({ runtime: wrapped, ns, model: f.model,
        input: input(1, 'next-session'), operations: captureOperations(runtime) });
    const outcome = trigger === 'end' ? result.episode : result.lazyEpisode;
    assert.deepEqual(outcome.error, { code: 'episode_outcome_pending', retryable: false });
    assert.ok(failureWrites > 1 && failureWrites <= 21);
    const state = runtime.episodeCaptureState(ns, { episodeId: first.episode.id });
    assert.equal(state.unfinishedAttempt, true);
    assert.equal(state.record.processing.errorCode, null);
    assert.equal(counts(f.model), trigger === 'end' ? 2 : 3);
    if (trigger === 'lazy') assert.equal(result.admission.status, 'completed');
  });
}
