import test from 'node:test';
import assert from 'node:assert/strict';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { captureSnapshot } from '../capture-input.mjs';
import { createMemoryCore } from '../contract.mjs';
import { captureEpisodeMessages, endEpisode } from '../episode-capture.mjs';
import { model, input, counts, ns, ok, captureOperations, options } from '../testing/episode-capture-helpers.mjs';
import { MemoryStoreError } from '../validation.mjs';

// Regressions fail before B4 on every safety layout; the 15 unmigrated
// controls deliberately retain the exact results of main 26f9e467.
const safetyLayouts = [34,38,48,51,52,53];
const layouts = [...safetyLayouts,18,23,33];
const baseOf = layout => ({34:18,38:23,48:33,51:18,52:23,53:33})[layout] ?? layout;
async function fixture(t, layout) {
  const base = baseOf(layout), factory=layout >= 51 ? (await import('../testing/receipt-event-time-fixture.mjs')).eventTimeSafetyFixture : safetyFixture;
  const f=factory(t,base);
  if (layout !== base) await f.migrate();
  const verify=f.connect();
  try { assert.equal(verify.prepare('PRAGMA user_version').get().user_version,layout); } finally { verify.close(); }
  return f;
}
// DELETE uses a real second-connection EXCLUSIVE lock. WAL permits SHARED
// readers through that lock, so its control injects the native read failure at
// this exact boundary. Neither lock nor transaction spans an await.
function busy(t, writer, db, journal, work) {
  assert.equal(db.isTransaction, false);
  if (journal === 'DELETE') {
    writer.exec('BEGIN EXCLUSIVE');
    try { return work(); } finally { writer.exec('ROLLBACK'); }
  }
  const hook = t.mock.method(db,'prepare',sql => {
    throw Object.assign(new Error('Synthetic native WAL read contention'), {code:'ERR_SQLITE_ERROR',errcode:5});
  });
  try { return work(); } finally { hook.mock.restore(); assert.equal(db.prepare instanceof Function,true); }
}
for (const layout of layouts) for (const journal of (layout < 34 ? ['DELETE'] : ['DELETE','WAL'])) for (const method of ['filterCaptureSources','assertCaptureSources']) {
  test(`${layout < 34 ? 'control: unmigrated ' : ''}ordinary staged source busy v${layout} ${journal} ${method}`, async t => {
    const f = await fixture(t,layout);
    const writer = f.connect();
    assert.equal(writer.prepare('PRAGMA journal_mode='+journal).get().journal_mode, journal.toLowerCase());
    let locked = 0, sourceError, sourceDb, calls = 0;
    const port = model({ extract: ({input}) => { calls++; return {items: [{content:input.messages[0].content,kind:'context',confidence:0.5,sourceIndices:[0]}]}; } });
    const core = createMemoryCore({path:f.path, model:port, captureQualification:'source-bound-v2', captureEvidence:'staged-v1'}, {
      createRuntime(config) {
        const runtime = createMemoryRuntime(config, {attachRaw(db) {sourceDb=db; db.exec('PRAGMA busy_timeout=0');}});
        return Object.freeze({...runtime, [method](...args) {
          if (locked) return runtime[method](...args);
          locked++;
          try {return busy(t,writer,sourceDb,journal,()=>runtime[method](...args));}
          catch(error) {sourceError={name:error.name,code:error.code,errcode:error.errcode};throw error;}
          finally {assert.equal(sourceDb.isTransaction,false);}
        }});
      }
    });
    t.after(()=>{core.close();writer.close();});
    const submitted=input(); delete submitted.episodeContext; submitted.messages=submitted.messages.map(({occurredAt,...message})=>message);
    const first=await core.capture(submitted);
    const before={first, sourceError, calls,
      evidence:writer.prepare('SELECT state FROM staged_capture_evidence').all(),
      claims:writer.prepare('SELECT state,lease_expires_at FROM admission_claims').all()};
    const retention=writer.prepare('SELECT created_at,expires_at,payload,payload_bytes FROM staged_capture_evidence WHERE event_id=?').get(submitted.eventId);
    assert.equal(locked,1,'the chosen source boundary was reached');
    assert.equal(before.calls,0,'source contention precedes provider dispatch');
    if(layout>=34 && before.evidence[0].state==='pending') {
      // A retry owns one of the 64 retained payload slots; it must neither
      // charge that slot twice nor replace the existing retention clock.
      const admission=writer.prepare(`INSERT INTO admission_claims
        (owner_id,scope,project_id,client,event_id,payload_digest,state,token,lease_expires_at)
        VALUES(?,?,?,?,?,?,'reserved',NULL,NULL)`);
      const staged=writer.prepare(`INSERT INTO staged_capture_evidence
        (owner_id,scope,project_id,client,event_id,state,created_at,expires_at,payload,payload_bytes)
        SELECT owner_id,scope,project_id,client,?,'pending',created_at,expires_at,payload,payload_bytes
        FROM staged_capture_evidence WHERE event_id=?`);
      writer.exec('BEGIN IMMEDIATE');
      try {
        for(let i=0;i<63;i++) {
          const eventId='synthetic-capacity-'+i;
          const digest=captureSnapshot({...submitted,eventId},'source-bound-v2').payloadDigest;
          admission.run(ns.ownerId,ns.scope,ns.projectId,submitted.client,eventId,digest);
          staged.run(eventId,submitted.eventId);
        }
        writer.exec('COMMIT');
      } catch(error) {writer.exec('ROLLBACK');throw error;}
      assert.equal(writer.prepare('SELECT count(*) n FROM staged_capture_evidence').get().n,64);
    }
    const retry=await core.capture(submitted);
    t.diagnostic(JSON.stringify({layout,method,before,retry,calls}));
    if (layout < 34) {
      assert.deepEqual(first,{ok:false,error:{code:'extraction_failed',retryable:false}});
      assert.equal(before.evidence[0].state,'failed');
      assert.deepEqual(retry,{ok:false,error:{code:'capture_evidence_closed',retryable:false}});
    } else {
      assert.deepEqual(first,{ok:false,error:{code:'storage_busy',retryable:true}});
      assert.equal(before.evidence[0].state,'pending','retryable source busy must not terminally mark staged evidence');
      assert.equal(retry.ok,true,'released-lock retry remains possible: '+JSON.stringify(retry));
      assert.equal(retry.value.admission.memories.length,1);
      assert.deepEqual(writer.prepare('SELECT created_at,expires_at,payload,payload_bytes FROM staged_capture_evidence WHERE event_id=?').get(submitted.eventId),retention,
        'retry reuses the original payload and retention deadline');
      assert.equal(writer.prepare('SELECT count(*) n FROM receipts').get().n,1);
      assert.equal(writer.prepare('SELECT count(*) n FROM memories').get().n,1);
    }
    assert.equal(calls,layout < 34 ? 0 : 1);
    if (layout >= 34) { assert.equal(ok(await core.capture(submitted)).duplicate,true); assert.equal(calls,1); }
  });
}
for (const layout of layouts) for (const journal of (layout < 34 ? ['DELETE'] : ['DELETE','WAL'])) for (const entry of ['standalone','public']) {
  test(`${layout<34?'control: unmigrated ':''}episode source busy v${layout} ${journal} ${entry}`,async t=>{
    const f=await fixture(t,layout), writer=f.connect();
    writer.prepare('PRAGMA journal_mode='+journal).get(); let locked=0,db,sourceError,failures=0;
    const wrap=config=>{
      const runtime=createMemoryRuntime(config,{attachRaw(value){db=value;db.exec('PRAGMA busy_timeout=0');}});
      return Object.freeze({...runtime,failEpisodeDraft(...args){failures++;return runtime.failEpisodeDraft(...args);},assertCaptureSources(...args){
        if(locked)return runtime.assertCaptureSources(...args);locked++;
        assert.equal(db.isTransaction,false);
        try{return busy(t,writer,db,journal,()=>runtime.assertCaptureSources(...args));}
        catch(error){sourceError={name:error.name,code:error.code,errcode:error.errcode};throw error;}
        finally{assert.equal(db.isTransaction,false);}
      }});
    };
    const port=model();
    const core=entry==='public'?createMemoryCore({path:f.path,...options,model:port},{createRuntime:wrap}):null;
    const runtime=core?null:wrap({path:f.path,sessionEpisodes:{mode:'episode-v1'}});
    t.after(()=>{(core??runtime).close();writer.close();});
    const first=core?ok(await core.capture(input())):await captureEpisodeMessages({runtime,ns,model:port,input:input(),operations:captureOperations(runtime)});
    const before={episode:first.episode,sourceError,calls:counts(port),failures,attempted:writer.prepare('SELECT attempted FROM session_episodes').get().attempted,
      attempts:writer.prepare('SELECT started,finished,outcome_code FROM episode_attempts').all()};
    const endInput={client:'synthetic',sessionId:'private-session',generation:'initial',eventId:'retry'};
    const retry=core?ok(await core.endEpisodeSession({namespace:ns,...endInput})):await endEpisode({runtime,ns,model:port,input:endInput});
    t.diagnostic(JSON.stringify({layout,entry,before,retry,calls:counts(port)}));
    assert.deepEqual(first.episode.error,{code:'storage_busy',retryable:true});
    assert.equal(before.attempted,0);assert.deepEqual(before.attempts,[]);assert.equal(before.calls,0);assert.equal(before.failures,0);
    assert.equal(retry.episode.status,'interpreted');assert.equal(counts(port),1);
    const replay=core?ok(await core.endEpisodeSession({namespace:ns,...endInput})):await endEpisode({runtime,ns,model:port,input:endInput});
    assert.equal(replay.episode.status,'not-run'); assert.equal(counts(port),1);
  });
}
for (const layout of layouts.filter(layout=>layout<34)) test(`control: pre-source owned busy from model getter v${layout}`,async t=>{
  const f=safetyFixture(t,layout),writer=f.connect();let armed=false,hits=0,failures=0;
  const runtime=createMemoryRuntime({path:f.path,sessionEpisodes:{mode:'episode-v1'}});
  t.after(()=>{runtime.close();writer.close();});
  const wrapped={...runtime,claimEpisodeDraft(...args){const claim=runtime.claimEpisodeDraft(...args);armed=true;return claim;},
    failEpisodeDraft(...args){failures++;return runtime.failEpisodeDraft(...args);}};
  const port=model();Object.defineProperty(port,'countTokens',{get(){if(armed){armed=false;hits++;throw new MemoryStoreError('storage_busy');}return ()=>1;}});
  const first=await captureEpisodeMessages({runtime:wrapped,ns,model:port,input:input(),operations:captureOperations(runtime)});
  t.diagnostic(JSON.stringify({layout,hits,failures,episode:first.episode,attempted:writer.prepare('SELECT attempted FROM session_episodes').get().attempted}));
  assert.equal(hits,1);assert.equal(failures,1);
  assert.deepEqual(first.episode.error,{code:'episode_failed',retryable:false});
  assert.equal(writer.prepare('SELECT attempted FROM session_episodes').get().attempted,1);
});

// Controls: no other owned error, including a getter's owned busy, acquires
// source provenance or escapes the terminal draft failure path.
for (const layout of safetyLayouts) for (const code of ['storage_busy','source_excluded','storage_error'])
test(`control: unrelated owned ${code} stays terminal v${layout}`, async t => {
  const f=await fixture(t,layout), writer=f.connect(); let armed=false, failures=0, hits=0;
  const runtime=createMemoryRuntime({path:f.path,sessionEpisodes:{mode:'episode-v1'}});
  t.after(()=>{runtime.close();writer.close();});
  const wrapped={...runtime,claimEpisodeDraft(...args){const claim=runtime.claimEpisodeDraft(...args);armed=true;return claim;},
    failEpisodeDraft(...args){failures++;return runtime.failEpisodeDraft(...args);}};
  const port=model(); Object.defineProperty(port,'countTokens',{get(){if(armed){armed=false;hits++;throw new MemoryStoreError(code);}return ()=>1;}});
  const first=await captureEpisodeMessages({runtime:wrapped,ns,model:port,input:input(),operations:captureOperations(runtime)});
  assert.equal(hits,1);assert.equal(failures,1);assert.equal(counts(port),0);
  assert.deepEqual(first.episode.error,{code:code==='source_excluded'?'source_excluded':'episode_failed',retryable:false});
  assert.equal(writer.prepare('SELECT attempted FROM session_episodes').get().attempted,1);
});

for(const layout of safetyLayouts)for(const mode of ['ordinary','ordered','episode-admission','keep'])
test(`control: ${mode} source contention preserves its protocol v${layout}`,async t=>{
  const f=await fixture(t,layout),writer=f.connect();writer.prepare('PRAGMA journal_mode=DELETE').get();
  let armed=mode!=='keep',publish=mode!=='keep',hits=0,db;
  const port=model({extract:({input})=>({items:publish?[{content:input.messages[0].content,kind:'context',confidence:0.5,sourceIndices:[0]}]:[]})});
  const core=createMemoryCore({path:f.path,model:port,...(['keep','episode-admission'].includes(mode)?options:{})},{createRuntime(config){
    const runtime=createMemoryRuntime(config,{attachRaw(value){db=value;db.exec('PRAGMA busy_timeout=0');}});
    return Object.freeze({...runtime,filterCaptureSources(...args){
      if(!armed)return runtime.filterCaptureSources(...args);armed=false;hits++;
      return busy(t,writer,db,'DELETE',()=>runtime.filterCaptureSources(...args));
    }});
  }});
  t.after(()=>{core.close();writer.close();});
  let perform;
  if(mode==='keep'){
    const first=ok(await core.capture(input()));
    const detail=ok(core.getEpisode({namespace:ns,episodeId:first.episode.id}));
    const action={namespace:ns,episodeId:first.episode.id,expectedRevision:detail.episode.revision,actionId:'same-keep'};
    perform=()=>core.keepEpisode(action);armed=true;publish=true;
  }else{
    const submitted=input();
    if(mode!=='episode-admission'){delete submitted.episodeContext;submitted.messages=submitted.messages.map(({occurredAt,...message})=>message);}
    if(mode==='ordered')submitted.causal={streamId:'synthetic-stream',sequence:1};
    perform=()=>core.capture(submitted);
  }
  const baseline=counts(port,'extract');
  assert.deepEqual(await perform(),{ok:false,error:{code:'storage_busy',retryable:true}});
  assert.equal(hits,1);assert.equal(counts(port,'extract'),baseline);
  if(mode==='keep'){
    const action=writer.prepare('SELECT state,token,keep_state,keep_error_code FROM episode_keep_actions').get();
    // Capture cleanup already released this token. Keep cleanup correctly
    // refuses to rewrite a claim it no longer owns; the action stays pending.
    assert.equal(action.state,'reserved');assert.equal(action.token,null);
    assert.equal(action.keep_state,'pending');assert.equal(action.keep_error_code,null);
  }
  const result=ok(await perform());assert.equal(result.admission.memories.length,1);
  assert.equal(counts(port,'extract'),baseline+1);
  assert.equal(ok(await perform()).duplicate,true);assert.equal(counts(port,'extract'),baseline+1);
  if(mode==='ordered')assert.equal(writer.prepare('SELECT high_water FROM capture_streams').get().high_water,1);
  assert.equal(db.isTransaction,false);
});
