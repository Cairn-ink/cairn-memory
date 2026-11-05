import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { createMemoryCore } from '../contract.mjs';
import { captureSnapshot } from '../capture-input.mjs';
import { model, ns } from '../testing/episode-capture-helpers.mjs';

const layouts = [34, 38, 48, 51, 52, 53];
const submitted = { namespace: ns, client: 'synthetic', sessionId: 'retry-session', eventId: 'retry-event',
  messages: [{ id: 'message', role: 'user', content: 'Synthetic retained source' }] };
const config = path => ({ path, captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1' });
const nativeBusy = () => Object.assign(new Error('Synthetic native busy'), { code: 'ERR_SQLITE_ERROR', errcode: 5 });
async function fixture(t, layout, journal) {
  const base = ({34:18,38:23,48:33,51:18,52:23,53:33})[layout];
  const factory = layout >= 51 ? (await import('../testing/receipt-event-time-fixture.mjs')).eventTimeSafetyFixture : safetyFixture;
  const f = factory(t, base); await f.migrate();
  const writer = f.connect(); t.after(() => writer.close());
  assert.equal(writer.prepare('PRAGMA user_version').get().user_version, layout);
  assert.equal(writer.prepare('PRAGMA journal_mode='+journal).get().journal_mode, journal.toLowerCase());
  return { f, writer };
}
function assertAdmitted(writer, result, calls) {
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.processing, undefined, 'a completed failed source check must not leave a live lease');
  assert.equal(result.value.admission.memories.length, 1);
  assert.equal(calls(), 1, 'exactly one extraction');
  assert.equal(writer.prepare('SELECT count(*) n FROM memories').get().n, 1);
  assert.equal(writer.prepare('SELECT count(*) n FROM receipts').get().n, 1);
}
const port = count => model({ extract: ({input}) => { count(); return {items: [{content: input.messages[0].content,
  kind:'context', confidence:0.5, sourceIndices:[0]}]}; } });

// Actual abrupt process exits around both durable writes. No database file is
// opened through a raw fd; reopening SQLite performs its native recovery.
if (process.argv[2] === 'crash-child') {
  const [path, point] = process.argv.slice(3); let phase;
  const crash = code => { writeSync(1, 'crash-point:'+code+'\n'); process.kill(process.pid, 'SIGKILL'); };
  const core = createMemoryCore({...config(path), model: port(() => {
    writeSync(1, 'provider-entered\n'); crash(73);
  })}, { createRuntime(value) {
    const runtime = createMemoryRuntime(value, {attachRaw(db) {
      const exec = db.exec.bind(db);
      db.exec = sql => {
        if (sql === 'COMMIT' && point === phase+'-before-commit') crash(71);
        const result = exec(sql);
        if (sql === 'COMMIT' && point === phase+'-after-commit') crash(72);
        return result;
      };
    }});
    return {...runtime, claimCaptureEvidence(...args) { phase='claim'; try {return runtime.claimCaptureEvidence(...args);} finally {phase=undefined;} },
      assertCaptureEvidence(...args) { phase=Object.getOwnPropertySymbols(args[1]).length?'dispatch':undefined; try {return runtime.assertCaptureEvidence(...args);} finally {phase=undefined;} }};
  }});
  await core.capture(submitted); process.exit(74);
} else {
  for (const layout of layouts) for (const journal of ['DELETE','WAL']) {
    for (const method of ['filterCaptureSources','assertCaptureSources']) for (const recovery of ['same-process','reopen','lease-expiry','reopen-staging-disabled']) {
      test(`regression: source and cleanup busy v${layout} ${journal} ${method} ${recovery}`, async t => {
        const {f,writer} = await fixture(t,layout,journal); let once=false, blocked=true, calls=0, cleanups=0;
        const dependencies = {createRuntime(value) {
          let db;
          const runtime = createMemoryRuntime(value,{attachRaw(x){db=x;db.exec('PRAGMA busy_timeout=0');}});
          return {...runtime, [method](...args) {
            if (once) return runtime[method](...args); once=true;
            assert.equal(db.isTransaction,false);
            if(journal==='DELETE') {
              writer.exec('BEGIN EXCLUSIVE');
              try {return runtime[method](...args);} finally {writer.exec('ROLLBACK');}
            }
            const hook=t.mock.method(db,'prepare',()=>{throw nativeBusy();});
            try {return runtime[method](...args);} finally {hook.mock.restore();}
          }, abandonAdmission(...args) {cleanups++; if(blocked)throw nativeBusy();return runtime.abandonAdmission(...args);} };
        }};
        let core=createMemoryCore({...config(f.path),model:port(()=>calls++)},dependencies);
        t.after(()=>core.close());
        const first=await core.capture(submitted);
        assert.deepEqual(first,{ok:false,error:{code:'storage_busy',retryable:true}});
        assert.equal(calls,0); assert.equal(cleanups,1);
        const retained=writer.prepare('SELECT state,created_at,expires_at,payload,payload_bytes FROM staged_capture_evidence WHERE event_id=?').get(submitted.eventId);
        assert.equal(retained.state,'pending','P1-a: source busy must retain pending evidence');
        if(recovery==='same-process') {
          // A pre-dispatch retry must reuse its existing slot even when all
          // 64 payload slots are occupied. Fill with synthetic inert claims.
          writer.exec('BEGIN IMMEDIATE');
          try {
            for(let i=0;i<63;i++) {
              const event='capacity-'+i;
              writer.prepare(`INSERT INTO admission_claims
                (owner_id,scope,project_id,client,event_id,payload_digest,state,token,lease_expires_at)
                SELECT owner_id,scope,project_id,client,?,?,'reserved',NULL,NULL FROM admission_claims WHERE event_id=?`)
                .run(event,captureSnapshot({...submitted,eventId:event},'source-bound-v2').payloadDigest,submitted.eventId);
              writer.prepare(`INSERT INTO staged_capture_evidence
                (owner_id,scope,project_id,client,event_id,state,created_at,expires_at,payload,payload_bytes)
                SELECT owner_id,scope,project_id,client,?,'pending',created_at,expires_at,payload,payload_bytes
                FROM staged_capture_evidence WHERE event_id=?`).run(event,submitted.eventId);
            }
            writer.exec('COMMIT');
          } catch(error) {writer.exec('ROLLBACK');throw error;}
          assert.equal(writer.prepare('SELECT count(*) n FROM staged_capture_evidence').get().n,64);
        }
        blocked=false;
        if(recovery==='reopen'){core.close();core=createMemoryCore({...config(f.path),model:port(()=>calls++)});}
        if(recovery==='reopen-staging-disabled') {
          core.close();once=false;blocked=true;
          const reopened=config(f.path);delete reopened.captureEvidence;
          core=createMemoryCore({...reopened,model:port(()=>calls++)},dependencies);
          // A second blocked read/cleanup must retain the original phase,
          // although this core no longer requests new evidence staging.
          assert.deepEqual(await core.capture(submitted),{ok:false,error:{code:'storage_busy',retryable:true}});
          assert.equal(calls,0);blocked=false;
        }
        if(recovery==='lease-expiry')writer.exec('UPDATE admission_claims SET lease_expires_at=0');
        const retry=await core.capture(submitted);
        t.diagnostic(JSON.stringify({layout,journal,method,recovery,first,retry,calls}));
        assertAdmitted(writer,retry,()=>calls);
        const after=writer.prepare('SELECT created_at,expires_at,payload,payload_bytes FROM staged_capture_evidence WHERE event_id=?').get(submitted.eventId);
        const {state,...before}=retained; assert.deepEqual({...after},before,'reuse payload without changing retention or capacity');
        assert.equal((await core.capture(submitted)).value.duplicate,true); assert.equal(calls,1);
      });
    }
    for (const point of ['claim-before-commit','claim-after-commit','dispatch-before-commit','dispatch-after-commit','provider']) {
      test(`control: crash ${point} v${layout} ${journal}`,async t=>{
        const {f,writer}=await fixture(t,layout,journal);
        const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'crash-child',f.path,point],{encoding:'utf8',timeout:30000});
        assert.equal(child.error,undefined);
        assert.equal(child.status,null,child.stderr);assert.equal(child.signal,'SIGKILL',child.stderr);
        const code=point==='provider'?73:point.endsWith('before-commit')?71:72;
        assert.ok(child.stdout.includes('crash-point:'+code),child.stdout+child.stderr);
        assert.equal(child.stdout.includes('provider-entered'),point==='provider');
        let calls=0; const core=createMemoryCore({...config(f.path),model:port(()=>calls++)});t.after(()=>core.close());
        if(point==='dispatch-after-commit'||point==='provider') {
          // Conservative uncertainty remains identical: no reclaim of a
          // possibly dispatched lease, and expiry closes retained evidence.
          assert.equal((await core.capture(submitted)).value.processing,true);assert.equal(calls,0);
          writer.exec('UPDATE admission_claims SET lease_expires_at=0');
          assert.deepEqual(await core.capture(submitted),{ok:false,error:{code:'capture_evidence_closed',retryable:false}});
          assert.equal(writer.prepare('SELECT state FROM staged_capture_evidence').get().state,'failed');
          assert.equal(calls,0);
        } else {
          writer.exec('UPDATE admission_claims SET lease_expires_at=0');
          assertAdmitted(writer,await core.capture(submitted),()=>calls);
          assert.equal((await core.capture(submitted)).value.duplicate,true);assert.equal(calls,1);
        }
      });
    }
    test(`control: lease expires immediately before dispatch v${layout} ${journal}`,async t=>{
      const {f,writer}=await fixture(t,layout,journal);let calls=0,expired=false;
      const core=createMemoryCore({...config(f.path),model:port(()=>calls++)},{createRuntime(value){
        const runtime=createMemoryRuntime(value);
        return {...runtime,assertCaptureEvidence(...args){
          if(!expired&&Object.getOwnPropertySymbols(args[1]).length) {
            expired=true;writer.exec('UPDATE admission_claims SET lease_expires_at=0');
          }
          return runtime.assertCaptureEvidence(...args);
        }};
      }});t.after(()=>core.close());
      assertAdmitted(writer,await core.capture(submitted),()=>calls);assert.equal(expired,true);
      assert.equal((await core.capture(submitted)).value.duplicate,true);assert.equal(calls,1);
    });
    test(`control: dispatch write busy retries once v${layout} ${journal}`,async t=>{
      const {f,writer}=await fixture(t,layout,journal);let calls=0,once=false;
      const core=createMemoryCore({...config(f.path),model:port(()=>calls++)},{createRuntime(value){
        let db;const runtime=createMemoryRuntime(value,{attachRaw(x){db=x;}});
        return {...runtime,assertCaptureEvidence(...args){
          if(once||!Object.getOwnPropertySymbols(args[1]).length)return runtime.assertCaptureEvidence(...args);
          once=true;const exec=db.exec.bind(db);
          const hook=t.mock.method(db,'exec',sql=>{if(sql==='BEGIN IMMEDIATE')throw nativeBusy();return exec(sql);});
          try{return runtime.assertCaptureEvidence(...args);}finally{hook.mock.restore();}
        }};
      }});t.after(()=>core.close());
      assert.deepEqual(await core.capture(submitted),{ok:false,error:{code:'storage_busy',retryable:true}});
      assert.equal(calls,0);assertAdmitted(writer,await core.capture(submitted),()=>calls);
    });
    test(`control: source busy after provider stays conservative v${layout} ${journal}`,async t=>{
      const {f,writer}=await fixture(t,layout,journal);let calls=0,once=false;
      const core=createMemoryCore({...config(f.path),model:port(()=>calls++)},{createRuntime(value){
        let db;const runtime=createMemoryRuntime(value,{attachRaw(x){db=x;}});
        return {...runtime,assertCaptureSources(...args){
          if(!calls||once)return runtime.assertCaptureSources(...args);once=true;
          const hook=t.mock.method(db,'prepare',()=>{throw nativeBusy();});
          try{return runtime.assertCaptureSources(...args);}finally{hook.mock.restore();}
        }};
      }});t.after(()=>core.close());
      assert.deepEqual(await core.capture(submitted),{ok:false,error:{code:'storage_busy',retryable:true}});
      assert.equal(calls,1);
      assert.deepEqual(await core.capture(submitted),{ok:false,error:{code:'capture_evidence_closed',retryable:false}});
      assert.equal(calls,1);
    });
    test(`control: dispatch token ownership v${layout} ${journal}`,async t=>{
      const {f,writer}=await fixture(t,layout,journal);let calls=0,checked=false;
      const core=createMemoryCore({...config(f.path),model:port(()=>calls++)},{createRuntime(value){
        const runtime=createMemoryRuntime(value);
        return {...runtime,assertCaptureEvidence(...args){
          if(!checked&&Object.getOwnPropertySymbols(args[1]).length) {
            checked=true;const [namespace,input]=args;
            const before=writer.prepare('SELECT * FROM admission_claims').get();
            assert.match(input.token,/^source-check:/);
            assert.equal(before.token,input.token);
            for(const changed of [{token:input.token.slice(0,-1)+(input.token.endsWith('0')?'1':'0')},{payloadDigest:input.payloadDigest+'0'}]) {
              assert.throws(()=>runtime.assertCaptureEvidence(namespace,{...input,...changed}),{code:'stale_admission'});
              assert.deepEqual(writer.prepare('SELECT * FROM admission_claims').get(),before);
            }
            const dispatched=runtime.assertCaptureEvidence(...args);
            assert.equal(dispatched.token,input.token.slice('source-check:'.length),'restore the claim UUID without another draw');
            assert.equal(writer.prepare('SELECT token FROM admission_claims').get().token,dispatched.token);
            return dispatched;
          }
          return runtime.assertCaptureEvidence(...args);
        }};
      }});t.after(()=>core.close());
      assertAdmitted(writer,await core.capture(submitted),()=>calls);assert.equal(checked,true);
    });
    test(`control: stale pre-dispatch holder cannot dispatch or abandon v${layout} ${journal}`,async t=>{
      const {f,writer}=await fixture(t,layout,journal);let calls=0,checked=false;
      const core=createMemoryCore({...config(f.path),model:port(()=>calls++)},{createRuntime(value){
        const runtime=createMemoryRuntime(value);
        return {...runtime,assertCaptureEvidence(...args){
          if(!checked&&Object.getOwnPropertySymbols(args[1]).length) {
            checked=true;const [namespace,input]=args;
            const dispatched=runtime.assertCaptureEvidence(...args);
            const after=writer.prepare('SELECT * FROM admission_claims').get();
            const evidence=writer.prepare('SELECT * FROM staged_capture_evidence').get();
            assert.equal(after.token,input.token.slice('source-check:'.length));
            assert.throws(()=>runtime.assertCaptureEvidence(...args),{code:'stale_admission'});
            for(const retryable of [false,true]) {
              assert.deepEqual(runtime.abandonAdmission(namespace,{...input,retryable}),{abandoned:false});
            }
            assert.deepEqual(writer.prepare('SELECT * FROM admission_claims').get(),after);
            assert.deepEqual(writer.prepare('SELECT * FROM staged_capture_evidence').get(),evidence);
            return dispatched;
          }
          return runtime.assertCaptureEvidence(...args);
        }};
      }});t.after(()=>core.close());
      assertAdmitted(writer,await core.capture(submitted),()=>calls);assert.equal(checked,true);
    });
    for(const recovery of ['lease-expiry','abandonment']) test(`control: old owner cannot take over ${recovery} v${layout} ${journal}`,async t=>{
      const {f,writer}=await fixture(t,layout,journal);let calls=0,checked=false,claimArgs,successor;
      const core=createMemoryCore({...config(f.path),model:port(()=>calls++)},{createRuntime(value){
        const runtime=createMemoryRuntime(value);
        return {...runtime,claimCaptureEvidence(...args){claimArgs=args;return runtime.claimCaptureEvidence(...args);},
          assertCaptureEvidence(...args){
            if(!checked&&Object.getOwnPropertySymbols(args[1]).length) {
              checked=true;const [namespace,input]=args;
              assert.match(input.token,/^source-check:/);
              if(recovery==='lease-expiry')writer.exec('UPDATE admission_claims SET lease_expires_at=0');
              else assert.deepEqual(runtime.abandonAdmission(namespace,{...input,retryable:true}),{abandoned:true});
              successor=runtime.claimCaptureEvidence(namespace,claimArgs[1],undefined,undefined,claimArgs[4]);
              assert.match(successor.token,/^source-check:/);
              assert.notEqual(successor.token,input.token,'reclaim draws a new UUID');
              assert.notEqual(successor.token.slice('source-check:'.length),input.token.slice('source-check:'.length));
              const before=writer.prepare('SELECT * FROM admission_claims').get();
              assert.equal(before.token,successor.token);
              assert.throws(()=>runtime.assertCaptureEvidence(...args),{code:'stale_admission'});
              for(const token of [input.token,input.token.slice('source-check:'.length)]) {
                for(const retryable of [false,true])assert.deepEqual(runtime.abandonAdmission(namespace,{...input,token,retryable}),{abandoned:false});
              }
              assert.deepEqual(writer.prepare('SELECT * FROM admission_claims').get(),before);
            }
            return runtime.assertCaptureEvidence(...args);
          }};
      }});t.after(()=>core.close());
      assert.deepEqual(await core.capture(submitted),{ok:false,error:{code:'stale_admission',retryable:false}});
      assert.equal(checked,true);assert.equal(calls,0);
      assert.equal(writer.prepare('SELECT token FROM admission_claims').get().token,successor.token,'old-owner cleanup preserves successor');
      assertAdmitted(writer,await core.capture(submitted),()=>calls);
    });
    test(`control: concurrent pre-dispatch owners extract once v${layout} ${journal}`,async t=>{
      const {f,writer}=await fixture(t,layout,journal);let calls=0;
      const a=createMemoryCore({...config(f.path),model:port(()=>calls++)});
      const b=createMemoryCore({...config(f.path),model:port(()=>calls++)});
      t.after(()=>{a.close();b.close();});
      const results=await Promise.all([a.capture(submitted),b.capture(submitted)]);
      const admitted=results.filter(result=>result.ok&&!result.value.processing);
      assert.equal(admitted.length,1,JSON.stringify(results));assertAdmitted(writer,admitted[0],()=>calls);
      assert.equal((await a.capture(submitted)).value.duplicate,true);assert.equal(calls,1);
    });
  }
}
