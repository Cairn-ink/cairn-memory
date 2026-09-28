import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryRuntime } from '../runtime.mjs';
import { openMemoryCore, openMemoryStore } from '../index.mjs';
import { ns, options, digest, ok, fixture, batch, register, finish, draft, inspect } from '../testing/episode-helpers.mjs';

test('E1 identity stable across restart, separated by namespace/client; private session never persisted', t => {
  const f = fixture(t), input = batch(), registered = register(f,input);
  assert.match(registered.sessionKey, /^s1:[0-9a-f]{64}$/);
  assert.notEqual(f.runtime.episodeSessionKey({ ...ns, projectId: 'other' }, input.client, input.sessionId), registered.sessionKey);
  assert.notEqual(f.runtime.episodeSessionKey(ns, 'other', input.sessionId), registered.sessionKey);
  const cold = createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } }); t.after(() => cold.close());
  assert.equal(cold.episodeSessionKey(ns, input.client, input.sessionId), registered.sessionKey);
  for (const table of ['session_episodes','episode_events','admission_claims','staged_capture_evidence']) assert.equal(JSON.stringify(f.db.prepare(`SELECT * FROM ${table}`).all()).includes(input.sessionId),false);
  f.db.exec('PRAGMA ignore_check_constraints=ON');
  f.db.prepare('UPDATE episode_identity SET secret=?').run('corrupt');
  f.db.exec('PRAGMA ignore_check_constraints=OFF');
  assert.throws(() => createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } }), /episode_identity_unavailable/);
  f.db.exec('DELETE FROM episode_identity');
  assert.throws(() => cold.episodeSessionKey(ns,input.client,input.sessionId), /episode_identity_unavailable/);
});

test('E2/E7 successful source-bound inspection, pinned correction, unpin and foreign/surrogate rejection', t => {
  const f=fixture(t), input=batch(), registered=register(f,input), job=draft(f,registered,input);
  f.runtime.commitEpisodeDraft(ns,job.commit);
  let detail=inspect(f,registered.episodeId);
  assert.equal(detail.episode.semanticSupport,'unassessed'); assert.equal(detail.sources.items[0].text,input.view.messages[0].content);
  const source=detail.sources.items[0], anchor={sourceId:source.id,digest:source.digest,start:0,end:9};
  assert.equal(f.core.correctEpisode({namespace:ns,episodeId:registered.episodeId,expectedRevision:detail.episode.revision,
    patch:{gist:{text:'Corrected 中文',anchors:[{...anchor,sourceId:'foreign'}]}}}).error.code,'invalid_input');
  const corrected=ok(f.core.correctEpisode({namespace:ns,episodeId:registered.episodeId,expectedRevision:detail.episode.revision,
    patch:{gist:{text:'Corrected 中文',anchors:[anchor]}}}));
  detail=inspect(f,registered.episodeId); assert.equal(detail.episode.editor.gist.pinned,true);
  assert.equal(f.core.correctEpisode({namespace:ns,episodeId:registered.episodeId,patch:{outcome:null}}).error.code,'invalid_input');
  ok(f.core.releaseEpisodeCorrection({namespace:ns,episodeId:registered.episodeId,expectedRevision:corrected.revision,fields:['gist']}));
  assert.equal(inspect(f,registered.episodeId).episode.editor.gist.pinned,false);
  const other=batch('other'); f.runtime.releaseEpisodeWriter(ns,{episodeId:registered.episodeId,token:job.writer.token});
  const next=register(f,other), bad=draft(f,next,other);
  assert.throws(()=>f.runtime.commitEpisodeDraft(ns,{...bad.commit,result:{...bad.commit.result,gist:{value:'\ud800',anchors:[{sourceIndex:0,start:0,end:1}]}}}),/invalid_input/);
  assert.throws(()=>f.runtime.commitEpisodeDraft(ns,{...bad.commit,result:{...bad.commit.result,gist:{value:'bad',anchors:[{sourceIndex:0,start:22,end:23}]}}}),/invalid_input/);
});

test('E3/E5 claims consume markers, keep admission unleased and fence expired/corrected workers', t=>{
  const f=fixture(t), input=batch(), registered=register(f,input), job=draft(f,registered,input);
  assert.equal(f.db.prepare('SELECT state FROM admission_claims').get().state,'reserved');
  assert.equal(f.db.prepare('SELECT token FROM admission_claims').get().token,null);
  assert.deepEqual(f.runtime.claimEpisodeWriter(ns,{episodeId:registered.episodeId,generation:'initial'}),{processing:true});
  f.runtime.failEpisodeDraft(ns,{episodeId:registered.episodeId,token:job.claim.token,code:'episode_failed'});
  assert.equal(f.runtime.claimEpisodeDraft(ns,{episodeId:registered.episodeId,generation:'initial',writerToken:job.writer.token,trigger:'batch',watermark:1}).consumed,true);
  assert.equal(inspect(f,registered.episodeId).episode.gist,null);
  assert.equal(finish(f,input).duplicate,false);
  assert.throws(()=>f.runtime.commitEpisodeDraft(ns,job.commit),/stale_episode/);
});

test('E6 pause preserves accepted work; project stop fences unfinished work without personal fallback',t=>{
  const f=fixture(t),input=batch(),r=register(f,input);
  const control=ok(f.core.getCaptureControl({namespace:ns}));
  const configured=openMemoryCore({path:f.path,...options});t.after(()=>configured.close());
  const paused=ok(configured.setCapturePaused({namespace:ns,expectedGeneration:control.generation,paused:true}));
  assert.notEqual(f.runtime.inspectCaptureEvidence(ns,input).evidence.view,null);
  assert.equal(finish(f,input).duplicate,false);
  assert.throws(()=>register(f,{...batch('paused'),generation:paused.generation}),/capture_disabled/);
  assert.equal(ok(f.core.getCaptureControl({namespace:ns})).generation,paused.generation);
  const resumed=ok(configured.setCapturePaused({namespace:ns,expectedGeneration:paused.generation,paused:false}));
  const stopped=ok(configured.setProjectCapture({namespace:ns,expectedGeneration:resumed.generation,enabled:false}));
  assert.throws(()=>register(f,{...batch('stopped'),generation:stopped.generation}),/capture_disabled/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM episode_events').get().n,1);
  assert.equal(inspect(f,r.episodeId).episode.namespace.scope,'project');
});

test('E7 conversation deletion forgets deduplicated/historical lineage with suppression, unrelated survives',t=>{
  const f=fixture(t),input=batch(),r=register(f,input);
  const memory=ok(f.core.admit({namespace:ns,memory:{content:'Synthetic remembered',kind:'fact'},receipts:[{client:'independent',sessionId:'independent',eventId:'independent',role:'user',excerpt:'Synthetic remembered'}]})).memory;
  const receipt={client:input.client,sessionId:r.sessionKey,eventId:input.eventId,role:'user',excerpt:input.view.messages[0].content};
  finish(f,input,[{content:'Synthetic remembered',kind:'fact',origin:'agent-inferred',confidence:0.8,fingerprint:digest('synthetic remembered'),receipts:[receipt],conflictHints:[]}]);
  const unrelated=ok(f.core.admit({namespace:ns,memory:{content:'Unrelated',kind:'fact'},receipts:[{...receipt,eventId:'other',excerpt:'Unrelated'}]})).memory;
  const job=draft(f,r,input);f.runtime.commitEpisodeDraft(ns,job.commit);
  const revision=inspect(f,r.episodeId).episode.revision;
  ok(f.core.forgetEpisode({namespace:ns,episodeId:r.episodeId,expectedRevision:revision}));
  assert.equal(f.core.get({namespace:ns,memoryId:memory.id}).error.code,'memory_not_found');
  assert.equal(f.core.get({namespace:ns,memoryId:unrelated.id}).ok,true);
  assert.equal(f.db.prepare('SELECT count(*) n FROM suppressed').get().n,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM episode_sources').get().n,0);
  assert.throws(()=>register(f,input),/capture_evidence_closed/);
  assert.equal(f.core.getEpisode({namespace:ns,episodeId:r.episodeId}).error.code,'episode_not_found');
});

test('E7 feature-off legacy correction invalidates dependent episodes',t=>{
  const f=fixture(t),input=batch(),r=register(f,input);
  const receipt={client:input.client,sessionId:r.sessionKey,eventId:input.eventId,role:'user',excerpt:input.view.messages[0].content};
  const admitted=finish(f,input,[{content:'Synthetic memory',kind:'preference',origin:'agent-inferred',confidence:0.8,fingerprint:digest('synthetic memory'),receipts:[receipt],conflictHints:[]}]);
  const job=draft(f,r,input);f.runtime.commitEpisodeDraft(ns,job.commit);
  const legacy=openMemoryStore({path:f.path});t.after(()=>legacy.close());
  const bound=legacy.scope({ownerId:ns.ownerId,projectId:ns.projectId});
  const memory=bound.get(admitted.memories[0].id);
  bound.correct(memory.id,{content:'Corrected memory',kind:'preference',receipt:{...receipt,excerpt:'Corrected memory'}},memory.revision);
  assert.equal(inspect(f,r.episodeId).episode.processing.state,'invalidated');
  assert.deepEqual(inspect(f,r.episodeId).sources.items,[]);
});

test('E9 inspection pages are bounded, namespace-bound, signed and stale after visibility mutation',t=>{
  const f=fixture(t);let r;
  for(let i=0;i<4;i++) r=register(f,batch(`page-${i}`));
  const first=inspect(f,r.episodeId,{policyLimit:2});assert.equal(first.policies.items.length,2);
  assert.equal(first.policies.exhausted,false);
  const next=inspect(f,r.episodeId,{policyLimit:2,policyCursor:first.policies.nextCursor});assert.equal(next.policies.items[0].position,3);
  register(f,batch('mutated'));
  assert.equal(f.core.getEpisode({namespace:ns,episodeId:r.episodeId,policyLimit:2,policyCursor:first.policies.nextCursor}).error.code,'cursor_stale');
});

test('E7 deleting a zero-memory origin removes copied passages without forgetting unrelated consumer memories',t=>{
  const f=fixture(t),a=batch('origin','Synthetic origin source','origin-session'),ar=register(f,a),aj=draft(f,ar,a);
  f.runtime.commitEpisodeDraft(ns,aj.commit);finish(f,a);
  const source=inspect(f,ar.episodeId).sources.items[0];
  const b=batch('consumer','Synthetic origin source','consumer-session'),br=register(f,b),bj=draft(f,br,b);
  bj.commit.sources=[{sourceId:source.id}];f.runtime.commitEpisodeDraft(ns,bj.commit);
  const receipt={client:b.client,sessionId:br.sessionKey,eventId:b.eventId,role:'user',excerpt:b.view.messages[0].content};
  const admitted=finish(f,b,[{content:'Independent consumer memory',kind:'fact',origin:'agent-inferred',confidence:0.8,
    fingerprint:digest('independent consumer memory'),receipts:[receipt],conflictHints:[]}]);
  ok(f.core.forgetEpisode({namespace:ns,episodeId:ar.episodeId,expectedRevision:inspect(f,ar.episodeId).episode.revision}));
  assert.equal(inspect(f,br.episodeId).episode.processing.state,'invalidated');
  assert.deepEqual(inspect(f,br.episodeId).sources.items,[]);
  assert.equal(f.core.get({namespace:ns,memoryId:admitted.memories[0].id}).ok,true);
});

test('E7 historical derived memory is forgotten through conversation lineage',t=>{
  const f=fixture(t),input=batch(),r=register(f,input);
  const receipt={client:input.client,sessionId:r.sessionKey,eventId:input.eventId,role:'user',excerpt:input.view.messages[0].content};
  const admitted=finish(f,input,[{content:'Old claim',kind:'fact',origin:'agent-inferred',confidence:0.8,fingerprint:digest('old claim'),receipts:[receipt],conflictHints:[]}]);
  const id=admitted.memories[0].id,revision=admitted.memories[0].revision;
  const replacement=ok(f.core.supersede({namespace:ns,memoryId:id,expectedRevision:revision,replacement:{content:'New independent claim',kind:'fact'},receipts:[{...receipt,eventId:'independent'}]}));
  assert.equal(ok(f.core.get({namespace:ns,memoryId:id})).memory.state,'historical');
  ok(f.core.forgetEpisode({namespace:ns,episodeId:r.episodeId,expectedRevision:inspect(f,r.episodeId).episode.revision}));
  assert.equal(f.core.get({namespace:ns,memoryId:id}).error.code,'memory_not_found');
  assert.equal(f.core.get({namespace:ns,memoryId:replacement.memory.id}).ok,true);
});

test('E2/E7 model revision preserves pinned prose and original anchors, and correction fences old commit',t=>{
  const f=fixture(t),a=batch(),r=register(f,a),job=draft(f,r,a);f.runtime.commitEpisodeDraft(ns,job.commit);
  let d=inspect(f,r.episodeId);const source=d.sources.items[0];
  ok(f.core.correctEpisode({namespace:ns,episodeId:r.episodeId,expectedRevision:d.episode.revision,
    patch:{gist:{text:'Pinned 中文',anchors:[{sourceId:source.id,digest:source.digest,start:0,end:9}]}}}));
  f.runtime.releaseEpisodeWriter(ns,{episodeId:r.episodeId,token:job.writer.token});
  const b=batch('new-evidence'),br=register(f,b),bj=draft(f,br,b);f.runtime.commitEpisodeDraft(ns,bj.commit);
  d=inspect(f,r.episodeId);assert.equal(d.episode.gist,'Pinned 中文');assert.equal(d.episode.anchors.gist[0].sourceId,source.id);
  f.runtime.releaseEpisodeWriter(ns,{episodeId:r.episodeId,token:bj.writer.token});
  const c=batch('third'),cr=register(f,c),cj=draft(f,cr,c);
  ok(f.core.releaseEpisodeCorrection({namespace:ns,episodeId:r.episodeId,expectedRevision:inspect(f,r.episodeId).episode.revision,fields:['gist']}));
  assert.throws(()=>f.runtime.commitEpisodeDraft(ns,cj.commit),/stale_episode/);
});

test('E11 mode validation is snapshotted and malformed episode capture is rejected', async t=>{
  for(const n of [1,17,2.5,null]) assert.throws(()=>openMemoryCore({path:':memory:',...options,sessionEpisodes:{mode:'episode-v1',draftEveryBatches:n}}),/invalid_input/);
  assert.throws(()=>openMemoryCore({path:':memory:',sessionEpisodes:{mode:'episode-v1'}}),/invalid_input/);
  const f=fixture(t),core=openMemoryCore({path:f.path,...options});t.after(()=>core.close());
  assert.equal((await core.capture({})).error.code,'invalid_input');
});

test('E2/E9 field limits reject atomically; inspection returns whole source prefixes under 64KiB',t=>{
  const f=fixture(t),input=batch('large','\x01'.repeat(800));
  input.view.messages=Array.from({length:16},(_,i)=>({id:`message-${i}`,role:'user',content:'\x01'.repeat(800)}));
  input.messages=input.view.messages.map(message=>({...message,occurredAt:null}));
  const r=register(f,input),job=draft(f,r,input);
  for(const patch of [{language:'中文'},{gist:{value:'x'.repeat(401),anchors:[{sourceIndex:0,start:0,end:1}]}},
    {gist:{value:'foreign',anchors:[{sourceIndex:99,start:0,end:1}]}}]) assert.throws(()=>f.runtime.commitEpisodeDraft(ns,{...job.commit,result:{...job.commit.result,...patch}}),/invalid_input/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM episode_sources').get().n,0);
  job.commit.sources=input.view.messages.map(message=>({eventId:input.eventId,messageId:message.id}));
  const field=(value,offset)=>({value,anchors:Array.from({length:4},(_,i)=>({sourceIndex:offset+i,start:0,end:1}))});
  job.commit.result={type:field('research',0),language:'en',gist:field('Synthetic large source inspection',4),outcome:field('Unassessed',8),nextStep:field('Review',12),disposition:null};
  f.runtime.commitEpisodeDraft(ns,job.commit);
  const page=inspect(f,r.episodeId);assert.equal(page.status,'budget_exhausted');assert.ok(page.sources.items.length>0);assert.ok(page.sources.items.length<16);
  assert.ok(Buffer.byteLength(JSON.stringify(page))<=65536);
  const next=inspect(f,r.episodeId,{sourceCursor:page.sources.nextCursor});
  assert.equal(page.sources.items.length+next.sources.items.length,16);
});

test('E7/E10 a second session deduplicates a preference without invalidating the first episode or its explicit tag', t => {
  const f = fixture(t), a = batch('preference-a', 'I prefer offline tools.', 'session-a'), ar = register(f, a);
  const item = (input, sessionKey) => ({ content: 'Prefer offline tools', kind: 'preference',
    origin: 'agent-inferred', confidence: 0.8, fingerprint: digest('prefer offline tools'), conflictHints: [],
    receipts: [{ client: input.client, sessionId: sessionKey, eventId: input.eventId, role: 'user', excerpt: input.view.messages[0].content }] });
  const memory = finish(f, a, [item(a, ar.sessionKey)]).memories[0];
  const detail = ok(f.core.get({ namespace: ns, memoryId: memory.id })), receipt = detail.receipts[0];
  ok(f.core.setProceduralMemory({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision,
    expectedTagRevision: 0, procedural: { anchors: [{ receiptId: receipt.id, digest: digest(receipt.excerpt), start: 0, end: 6 }] } }));
  const job = draft(f, ar, a); f.runtime.commitEpisodeDraft(ns, job.commit);
  const before = inspect(f, ar.episodeId), tag = ok(f.core.get({ namespace: ns, memoryId: memory.id })).procedural;
  const b = batch('preference-b', 'I prefer offline tools.', 'session-b'), br = register(f, b);
  assert.equal(finish(f, b, [item(b, br.sessionKey)]).memories[0].id, memory.id);
  const after = inspect(f, ar.episodeId), dedup = ok(f.core.get({ namespace: ns, memoryId: memory.id }));
  assert.deepEqual(after.episode, before.episode);
  assert.deepEqual(after.sources, before.sources);
  assert.equal(after.episode.processing.state, 'ready');
  assert.deepEqual(dedup.procedural, tag);
  assert.equal(dedup.receipts.length, 2);
  assert.equal(dedup.memory.revision, memory.revision + 1);
});

test('E5 admission finishes after the session writer expires while its own lease is live', t => {
  const f = fixture(t), input = batch(), r = register(f, input);
  const writer = f.runtime.claimEpisodeWriter(ns, { episodeId: r.episodeId, generation: 'initial' });
  const claim = f.runtime.claimAdmission(ns, { ...input, leaseMs: 125000, episodeWriterToken: writer.token });
  f.db.prepare('UPDATE session_episodes SET writer_expires_at=0 WHERE id=?').run(r.episodeId);
  assert.ok(f.db.prepare('SELECT lease_expires_at FROM admission_claims').get().lease_expires_at > Date.now());
  const result = f.runtime.finishAdmission(ns, { ...input, token: claim.token, items: [] });
  assert.equal(result.duplicate, false);
  assert.equal(f.db.prepare('SELECT state FROM admission_claims').get().state, 'completed');
});

test('E6 a pre-pause draft and admission may finish, but project stop closes accepted work across restart', t => {
  const f = fixture(t), input = batch(), r = register(f, input), job = draft(f, r, input);
  const paused = f.runtime.setCapturePaused(ns, { expectedGeneration: 'initial', paused: true });
  f.runtime.commitEpisodeDraft(ns, job.commit);
  assert.equal(finish(f, input).duplicate, false);
  assert.throws(() => register(f, { ...batch('paused'), generation: paused.generation }), /capture_disabled/);
  const resumed = f.runtime.setCapturePaused(ns, { expectedGeneration: paused.generation, paused: false });
  f.runtime.releaseEpisodeWriter(ns, { episodeId: r.episodeId, token: job.writer.token });
  const old = { ...batch('accepted'), generation: resumed.generation }; register(f, old);
  const claim = f.runtime.claimAdmission(ns, { ...old, leaseMs: 125000 });
  const stopped = f.runtime.setProjectCapture(ns, { expectedGeneration: resumed.generation, enabled: false });
  f.runtime.setProjectCapture(ns, { expectedGeneration: stopped.generation, enabled: true });
  assert.throws(() => f.runtime.finishAdmission(ns, { ...old, token: claim.token, items: [] }), /capture_evidence_closed/);
  const cold = createMemoryRuntime({ path: f.path }); t.after(() => cold.close());
  assert.throws(() => cold.claimAdmission(ns, { ...old, leaseMs: 125000 }), /capture_evidence_closed/);
});

test('E6 project stop discards draft-complete payloads awaiting admission and preserves completed episode records', t => {
  const f = fixture(t), input = batch(), r = register(f, input), job = draft(f, r, input);
  f.runtime.commitEpisodeDraft(ns, job.commit);
  const claim = f.runtime.claimAdmission(ns, { ...input, leaseMs: 125000, episodeWriterToken: job.writer.token });
  const before = inspect(f, r.episodeId).episode;
  const stopped = f.runtime.setProjectCapture(ns, { expectedGeneration: 'initial', enabled: false });
  assert.equal(f.runtime.inspectCaptureEvidence(ns, input).evidence.state, 'discarded');
  assert.equal(f.runtime.inspectCaptureEvidence(ns, input).evidence.view, null);
  assert.deepEqual(inspect(f, r.episodeId).episode, before);
  f.runtime.setProjectCapture(ns, { expectedGeneration: stopped.generation, enabled: true });
  assert.throws(() => f.runtime.finishAdmission(ns, { ...input, token: claim.token, items: [] }), /capture_evidence_closed/);
});

test('E4a/E7/E10 indexed evidence coexists with full episode staging, preserves dedup tags/sources and obeys conversation suppression', async t => {
  const f = fixture(t); f.db.exec('PRAGMA journal_mode=WAL');
  const a = batch('episode-preference', 'I prefer offline tools.', 'episode-session'), ar = register(f, a);
  const content = 'Prefer offline tools';
  const memory = finish(f, a, [{ content, kind: 'preference', origin: 'agent-inferred', confidence: 0.8,
    fingerprint: digest(content.toLowerCase()), conflictHints: [], receipts: [{ client: a.client,
      sessionId: ar.sessionKey, eventId: a.eventId, role: 'user', excerpt: a.view.messages[0].content }] }]).memories[0];
  const receipt = ok(f.core.get({ namespace: ns, memoryId: memory.id })).receipts[0];
  ok(f.core.setProceduralMemory({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision,
    expectedTagRevision: 0, procedural: { anchors: [{ receiptId: receipt.id, digest: digest(receipt.excerpt), start: 0, end: 6 }] } }));
  const job = draft(f, ar, a); f.runtime.commitEpisodeDraft(ns, job.commit);
  for (let i = 0; i < 64; i++) register(f, batch('protected-' + i, 'Synthetic protected source', 'protected-session'));
  const before = inspect(f, ar.episodeId), tag = ok(f.core.get({ namespace: ns, memoryId: memory.id })).procedural;
  const staged = f.db.prepare('SELECT * FROM staged_capture_evidence ORDER BY event_id').all();
  const calls = [], model = { contextWindow: 8192, countTokens: () => 1,
    extract({ input }) { calls.push('extract'); return { items: [{ content, kind: 'preference', confidence: 0.8,
      sourceIndices: [input.messages.length - 1] }] }; },
    classify({ input }) { calls.push('classify'); return { items: input.memories.map(row => ({ memoryId: row.id, parentIds: [] })) }; } };
  for (const method of ['qualify', 'qualifyCandidates', 'reconcile', 'relate', 'reviewBasis']) {
    Object.defineProperty(model, method, { get() { assert.fail('unexpected interpreter: ' + method); } });
  }
  const indexed = openMemoryCore({ path: f.path, model, captureSourcePolicy: 'indexed-evidence-v1' }); t.after(() => indexed.close());
  const request = { namespace: ns, client: 'synthetic', sessionId: 'indexed-session', eventId: 'indexed-preference',
    messages: [{ id: 'indexed-source', role: 'user', content: 'x'.repeat(800) + 'I prefer offline tools.' }] };
  assert.equal((await indexed.capture({ ...request, eventId: 'protected-0' })).error.code, 'event_payload_conflict');
  assert.deepEqual(calls, []);
  const captured = ok(await indexed.capture(request));
  assert.equal(captured.qualificationStatus, 'not-requested');
  assert.equal(captured.admission.memories[0].id, memory.id);
  const saved = ok(indexed.get({ namespace: ns, memoryId: memory.id }));
  assert.deepEqual(saved.procedural, tag);
  assert.equal(saved.receipts.length, 2);
  assert.equal(saved.receipts.find(row => row.eventId === 'indexed-source').excerpt, 'I prefer offline tools.');
  assert.deepEqual(inspect(f, ar.episodeId).episode, before.episode);
  assert.deepEqual(inspect(f, ar.episodeId).sources, before.sources);
  assert.deepEqual(f.db.prepare('SELECT * FROM staged_capture_evidence ORDER BY event_id').all(), staged);
  assert.equal(f.db.prepare('SELECT count(*) n FROM episode_events').get().n, 65);
  assert.equal(f.db.prepare("SELECT count(*) n FROM admission_claims WHERE state='completed'").get().n, 2);
  const count = calls.length;
  assert.equal(ok(await indexed.capture(request)).duplicate, true);
  assert.equal(calls.length, count);
  ok(f.core.forgetEpisode({ namespace: ns, episodeId: ar.episodeId, expectedRevision: before.episode.revision }));
  assert.equal(ok(await indexed.capture(request)).duplicate, true);
  assert.equal(calls.length, count);
  assert.equal(indexed.get({ namespace: ns, memoryId: memory.id }).error.code, 'memory_not_found');
  assert.equal(ok(await indexed.capture({ ...request, eventId: 'suppressed-indexed' })).admission.suppressedCount, 1);
});
