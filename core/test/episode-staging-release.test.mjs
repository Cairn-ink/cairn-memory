import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, ns, batch, register, finish, draft, inspect } from './episode-storage.test.mjs';
import { createMemoryRuntime } from '../runtime.mjs';

const evidence=(f,input)=>f.runtime.inspectCaptureEvidence(ns,input).evidence;
test('E4a/E8/E11 normal release works in both completion orders, empty admission and cold replay',t=>{
  for(const order of ['admission-first','draft-first']) {
    const f=fixture(t),input=batch(order),r=register(f,input);
    if(order==='admission-first') finish(f,input);
    const job=draft(f,r,input);
    f.runtime.commitEpisodeDraft(ns,job.commit);
    if(order==='draft-first') {
      assert.equal(evidence(f,input).state,'pending');finish(f,input);
    }
    assert.equal(evidence(f,input).state,'released');assert.equal(evidence(f,input).view,null);
    assert.equal(evidence(f,input).expiresAt,null);assert.equal(evidence(f,input).releaseReason,'interpreted');
    assert.equal(inspect(f,r.episodeId).sources.items.length,1);
    f.db.exec('UPDATE staged_capture_evidence SET expires_at=0');
    assert.equal(evidence(f,input).state,'released');
    const cold=createMemoryRuntime({path:f.path});t.after(()=>cold.close());
    const replay=cold.claimAdmission(ns,{...input,leaseMs:125000});assert.equal(replay.duplicate,true);
    assert.deepEqual(replay.memoryIds,[]);
    assert.throws(()=>cold.claimAdmission(ns,{...input,payloadDigest:'f'.repeat(64),leaseMs:125000}),/event_payload_conflict/);
  }
});

test('E4 expired live payload records gap and fences drafts; failures retain staging',t=>{
  const f=fixture(t),input=batch(),r=register(f,input),job=draft(f,r,input);
  f.runtime.failEpisodeDraft(ns,{episodeId:r.episodeId,token:job.claim.token,code:'episode_timeout'});
  assert.equal(evidence(f,input).state,'pending');assert.notEqual(evidence(f,input).view,null);
  finish(f,input);assert.equal(evidence(f,input).state,'admitted');
  f.db.exec('UPDATE staged_capture_evidence SET expires_at=0');
  assert.equal(evidence(f,input).state,'expired');
  assert.equal(inspect(f,r.episodeId).policies.items[0].gap,'expired');
});

test('E5 source expiry and correction cannot publish an in-flight draft',t=>{
  const f=fixture(t),input=batch(),r=register(f,input),job=draft(f,r,input);
  f.db.exec('UPDATE staged_capture_evidence SET expires_at=0');
  assert.throws(()=>f.runtime.commitEpisodeDraft(ns,job.commit),/stale_episode/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM episode_sources').get().n,0);
});

test('E8 only a fresh anchored draft can persist skip-quick; empty admission releases and policy survives replay',t=>{
  const f=fixture(t),input=batch(),r=register(f,input),job=draft(f,r,input);
  job.commit.result.type.value='quick-one-off-question';
  f.runtime.commitEpisodeDraft(ns,job.commit);
  const revision=inspect(f,r.episodeId).episode.revision;
  f.runtime.setEpisodePolicy(ns,{client:input.client,eventId:input.eventId,payloadDigest:input.payloadDigest,policy:'skip-quick',expectedRevision:revision});
  finish(f,input);
  assert.equal(evidence(f,input).state,'released');
  assert.equal(inspect(f,r.episodeId).policies.items[0].policy,'skip-quick');
  assert.equal(finish(f,input).duplicate,true);
  assert.throws(()=>f.runtime.setEpisodePolicy(ns,{client:input.client,eventId:input.eventId,payloadDigest:input.payloadDigest,policy:'normal'}),/stale_admission/);
  f.runtime.releaseEpisodeWriter(ns,{episodeId:r.episodeId,token:job.writer.token});
  const next=batch('non-drafted'),nr=register(f,next);
  assert.throws(()=>f.runtime.setEpisodePolicy(ns,{client:next.client,eventId:next.eventId,payloadDigest:next.payloadDigest,policy:'skip-quick',expectedRevision:inspect(f,nr.episodeId).episode.revision}),/revision_conflict/);
  finish(f,next);assert.equal(inspect(f,r.episodeId).policies.items[1].policy,'normal');
});

test('E4a/E11 live episode payload survives expired admission lease and stale owner cannot finish',t=>{
  const f=fixture(t),input=batch();register(f,input);
  const first=f.runtime.claimAdmission(ns,{...input,leaseMs:125000});
  f.db.exec('UPDATE admission_claims SET lease_expires_at=0');
  const second=f.runtime.claimAdmission(ns,{...input,leaseMs:125000});assert.notEqual(first.token,second.token);
  assert.throws(()=>f.runtime.finishAdmission(ns,{...input,token:first.token,items:[]}),/stale_admission/);
  f.runtime.finishAdmission(ns,{...input,token:second.token,items:[]});
  assert.equal(evidence(f,input).state,'admitted');
});
