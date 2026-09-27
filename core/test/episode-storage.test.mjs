import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
const storageTest = import.meta.url === pathToFileURL(process.argv[1]).href ? test : () => {};
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createMemoryRuntime } from '../runtime.mjs';
import { openMemoryCore, openMemoryStore } from '../index.mjs';

export const ns = { ownerId: 'synthetic', scope: 'project', projectId: 'project' };
export const options = { sessionEpisodes: { mode: 'episode-v1' }, captureEvidence: 'staged-v1', captureQualification: 'source-bound-v2' };
export const digest = text => createHash('sha256').update(text).digest('hex');
export const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
export function fixture(t, config = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'se1-synthetic-')), path = join(dir, 'store.sqlite');
  const runtime = createMemoryRuntime({ path, sessionEpisodes: { mode: 'episode-v1', ...config } });
  const db = new DatabaseSync(path); db.exec('PRAGMA foreign_keys=ON');
  const core = openMemoryCore({ path });
  t.after(() => { runtime.close(); core.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { runtime, core, db, path };
}
export function batch(id = 'one', text = 'Synthetic 中文 English 😀 evidence.', sessionId = 'private-host-session') {
  return { client: 'synthetic', clientLabel: 'Synthetic client', sessionId, eventId: id, payloadDigest: digest(id+text), generation: 'initial',
    view: { messages: [{ id: `message-${id}`, role: 'user', content: text }], retainedSourceWindow: { maxUnitsPerMessage: 800, truncatedMessageIndices: [] } } };
}
export function register(f, input = batch()) { return f.runtime.reserveEpisodeBatch(ns, input); }
export function finish(f, input, items = []) {
  const writer=f.db.prepare('SELECT writer_token FROM session_episodes WHERE id=(SELECT episode_id FROM episode_events WHERE event_id=?)').get(input.eventId)?.writer_token;
  const claim = f.runtime.claimAdmission(ns, { ...input, episodeWriterToken: writer, leaseMs: 125000 });
  return claim.duplicate ? claim : f.runtime.finishAdmission(ns, { ...input, token: claim.token, items });
}
export function draft(f, registered, input, overrides = {}) {
  const writer = f.runtime.claimEpisodeWriter(ns, { episodeId: registered.episodeId, generation: 'initial' });
  const claim = f.runtime.claimEpisodeDraft(ns, { episodeId: registered.episodeId, generation: 'initial', writerToken: writer.token,
    trigger: 'batch', watermark: registered.position });
  const field = value => ({ value, anchors: [{ sourceIndex: 0, start: 0, end: input.view.messages[0].content.length }] });
  const commit = { episodeId: registered.episodeId, token: claim.token,
    sources: [{ eventId: input.eventId, messageId: input.view.messages[0].id }],
    result: { type: field('work'), language: 'mixed', gist: field('Synthetic 中文 gist'), outcome: null, nextStep: field('Review evidence'), disposition: null },
    dispositions: [{ eventId: input.eventId, omitted: 0 }],
    modelMetadata: { adapter: 'scripted', model: null, profile: null, promptVersion: 'storage-test', digest: digest('prompt'), portVersion: 'episode-v1' }, ...overrides };
  return { claim, commit, writer };
}
export const inspect = (f, id, extra = {}) => ok(f.core.getEpisode({ namespace: ns, episodeId: id, ...extra }));

storageTest('E1 identity stable across restart, separated by namespace/client; private session never persisted', t => {
  const f = fixture(t), input = batch(), registered = register(f,input);
  assert.match(registered.sessionKey, /^s1:[0-9a-f]{64}$/);
  assert.notEqual(f.runtime.episodeSessionKey({ ...ns, projectId: 'other' }, input.client, input.sessionId), registered.sessionKey);
  assert.notEqual(f.runtime.episodeSessionKey(ns, 'other', input.sessionId), registered.sessionKey);
  const cold = createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } }); t.after(() => cold.close());
  assert.equal(cold.episodeSessionKey(ns, input.client, input.sessionId), registered.sessionKey);
  for (const table of ['session_episodes','episode_events','admission_claims','staged_capture_evidence']) assert.equal(JSON.stringify(f.db.prepare(`SELECT * FROM ${table}`).all()).includes(input.sessionId),false);
  f.db.prepare('UPDATE episode_identity SET secret=?').run('corrupt');
  assert.throws(() => createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } }), /episode_identity_unavailable/);
  f.db.exec('DELETE FROM episode_identity');
  assert.throws(() => cold.episodeSessionKey(ns,input.client,input.sessionId), /episode_identity_unavailable/);
});

storageTest('E2/E7 successful source-bound inspection, pinned correction, unpin and foreign/surrogate rejection', t => {
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

storageTest('E3/E5 claims consume markers, keep admission unleased and fence expired/corrected workers', t=>{
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

storageTest('E6 durable pause/stop generations fence admission, never fall back to personal',t=>{
  const f=fixture(t),input=batch(),r=register(f,input);
  const control=ok(f.core.getCaptureControl({namespace:ns}));
  const configured=openMemoryCore({path:f.path,...options});t.after(()=>configured.close());
  const paused=ok(configured.setCapturePaused({namespace:ns,expectedGeneration:control.generation,paused:true}));
  assert.throws(()=>finish(f,input),/capture_evidence_closed/);
  assert.throws(()=>register(f,{...batch('paused'),generation:paused.generation}),/capture_disabled/);
  assert.equal(ok(f.core.getCaptureControl({namespace:ns})).generation,paused.generation);
  const resumed=ok(configured.setCapturePaused({namespace:ns,expectedGeneration:paused.generation,paused:false}));
  const stopped=ok(configured.setProjectCapture({namespace:ns,expectedGeneration:resumed.generation,enabled:false}));
  assert.throws(()=>register(f,{...batch('stopped'),generation:stopped.generation}),/capture_disabled/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM episode_events').get().n,1);
  assert.equal(inspect(f,r.episodeId).episode.namespace.scope,'project');
});

storageTest('E7 conversation deletion forgets deduplicated/historical lineage with suppression, unrelated survives',t=>{
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

storageTest('E7 feature-off legacy correction invalidates dependent episodes',t=>{
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

storageTest('E9 inspection pages are bounded, namespace-bound, signed and stale after visibility mutation',t=>{
  const f=fixture(t);let r;
  for(let i=0;i<4;i++) r=register(f,batch(`page-${i}`));
  const first=inspect(f,r.episodeId,{policyLimit:2});assert.equal(first.policies.items.length,2);
  assert.equal(first.policies.exhausted,false);
  const next=inspect(f,r.episodeId,{policyLimit:2,policyCursor:first.policies.nextCursor});assert.equal(next.policies.items[0].position,3);
  register(f,batch('mutated'));
  assert.equal(f.core.getEpisode({namespace:ns,episodeId:r.episodeId,policyLimit:2,policyCursor:first.policies.nextCursor}).error.code,'cursor_stale');
});

storageTest('E7 deleting a zero-memory origin removes copied passages without forgetting unrelated consumer memories',t=>{
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

storageTest('E7 historical derived memory is forgotten through conversation lineage',t=>{
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

storageTest('E2/E7 model revision preserves pinned prose and original anchors, and correction fences old commit',t=>{
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

storageTest('E11 mode validation is snapshotted and mode-on capture is deferred to SE-2', async t=>{
  for(const n of [1,17,2.5,null]) assert.throws(()=>openMemoryCore({path:':memory:',...options,sessionEpisodes:{mode:'episode-v1',draftEveryBatches:n}}),/invalid_input/);
  assert.throws(()=>openMemoryCore({path:':memory:',sessionEpisodes:{mode:'episode-v1'}}),/invalid_input/);
  const f=fixture(t),core=openMemoryCore({path:f.path,...options});t.after(()=>core.close());
  assert.equal((await core.capture({})).error.code,'episode_capture_not_available');
});

storageTest('E2/E9 field limits reject atomically; inspection returns whole source prefixes under 64KiB',t=>{
  const f=fixture(t),input=batch('large','\x01'.repeat(800));
  input.view.messages=Array.from({length:16},(_,i)=>({id:`message-${i}`,role:'user',content:'\x01'.repeat(800)}));
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
