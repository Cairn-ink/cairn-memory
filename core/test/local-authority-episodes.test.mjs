import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRuntime } from '../runtime.mjs';
import { fixture,ns,ok } from '../testing/local-authority-fixtures.mjs';
import { interpretation } from '../testing/episode-capture-helpers.mjs';

for(const client of ['claude-code','codex']) for(const mutation of ['revoke','aba','notice','raw'])
test(`B2b-05/06 ${client} episode attempt commit enforces ${mutation} on its stored watermark`,async t=>{
  const f=fixture(t,{kind:'episode',client});f.grant();let calls=0;
  const worker=f.worker({model:{interpretEpisode:value=>{
    calls++;
    if(['revoke','aba'].includes(mutation))ok(f.set({automaticCaptureEnabled:false}));
    if(mutation==='aba')ok(f.set({automaticCaptureEnabled:true}));
    if(mutation==='notice')ok(f.set({rawNoticeVersion:null}));
    if(mutation==='raw')ok(f.control.setRawCaptureControl({ownerId:ns.ownerId,client,expectedRevision:0,enabled:false}));
    return interpretation(value);
  }}});
  const result=ok(await worker.captureRaw(f.request()));assert.equal(calls,1);assert.equal(result.raw.parts[0].saved,true);
  const published=f.db.prepare('SELECT record FROM session_episodes').all().filter(row=>JSON.parse(row.record).gist).length;
  const sources=f.db.prepare('SELECT count(*) n FROM episode_sources').get().n;
  if(['revoke','aba'].includes(mutation)) {assert.equal(published,0);assert.equal(sources,0);assert.equal(f.calls,0);}
  else {assert.equal(published,1);assert.ok(sources>0);assert.equal(f.calls,1);}
});

for(const client of ['claude-code','codex']) test('B2b-05 '+client+' attempt start cannot borrow later event grant',async t=>{
  const f=fixture(t,{kind:'episode',client});f.grant();
  // A committed first attempt supplies a real immutable watermark event. A
  // separate synthetic unfinished attempt exercises the existing start seam.
  ok(await f.worker().captureRaw(f.request()));
  const episode=f.db.prepare('SELECT * FROM session_episodes').get(),original=f.db.prepare('SELECT * FROM episode_attempts').get();
  f.db.prepare(`INSERT INTO episode_attempts(episode_id,marker,watermark,token,expires_at,revision,source_fence,generation,started)
    VALUES(?,?,?,?,?,?,?,?,0)`).run(episode.id,'synthetic-start',original.watermark,'synthetic-start-token',Date.now()+60000,
      episode.revision,episode.source_fence,original.generation);
  ok(f.set({automaticCaptureEnabled:false}));ok(f.set({automaticCaptureEnabled:true}));
  const next=f.request({eventId:'new-event',messages:[{...f.request().messages[0],id:'new-source',messageOrdinal:2}]});
  ok(await f.worker().captureRaw(next));
  // Keep the synthetic attempt revision current so only its authority binding,
  // rather than the unrelated episode revision fence, determines refusal.
  const current=f.db.prepare('SELECT revision,source_fence FROM session_episodes').get();
  f.db.prepare('UPDATE episode_attempts SET revision=?,source_fence=? WHERE token=?').run(current.revision,current.source_fence,'synthetic-start-token');
  const runtime=createMemoryRuntime({path:f.path});f.workspace.defer(()=>runtime.close());
  assert.throws(()=>runtime.startEpisodeAttempt(ns,{episodeId:episode.id,token:'synthetic-start-token'}),{code:'capture_evidence_closed'});
  assert.equal(f.db.prepare('SELECT started FROM episode_attempts WHERE token=?').get('synthetic-start-token').started,0);
});
