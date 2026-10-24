import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../index.mjs';
import { fixture,ns,ok,denied,readPolicy,request } from '../testing/local-authority-fixtures.mjs';

test('B2b-02 absent, explicit decline, no-op, CAS and immutable targets are durable and atomic',t=>{
  const f=fixture(t),absent=f.get(); assert.equal(absent.revision,0); assert.equal(absent.consentGeneration,'initial');
  assert.equal(f.db.prepare('SELECT count(*) n FROM local_capture_controls').get().n,0);
  const declined=ok(f.set()); assert.equal(declined.automaticCaptureEnabled,false); assert.equal(declined.revision,1);
  assert.notEqual(declined.consentGeneration,'initial'); assert.deepEqual(ok(f.set()),declined);
  denied(f.set({expectedRevision:0}),'revision_conflict'); denied(f.set({expectedStoreId:'other'}),'revision_conflict');
  denied(f.set({targetId:'replacement'}),'revision_conflict'); assert.deepEqual(f.get(),declined);
  const reopened=openMemoryCore({path:f.path,rawConversations:{mode:'off',readPolicy}}); f.workspace.defer(()=>reopened.close());
  assert.deepEqual(ok(reopened.getLocalCaptureControl({namespace:ns,client:'claude-code'})),declined);
  const notice=ok(f.set({rawNoticeVersion:'local-plain-v1'})); assert.equal(notice.consentGeneration,declined.consentGeneration);
  const grant=ok(f.set({automaticCaptureEnabled:true})); assert.notEqual(grant.consentGeneration,notice.consentGeneration);
});

test('B2b-02 controls are exact owner/project/client scope even when target labels repeat',t=>{
  const f=fixture(t),before=f.grant();
  for(const [namespace,client] of [[ns,'codex'],[{...ns,projectId:'other'},'claude-code'],[{...ns,ownerId:'other'},'claude-code']]) {
    assert.equal(f.get(namespace,client).revision,0); ok(f.set({automaticCaptureEnabled:false},namespace,client));
  }
  assert.deepEqual(f.get(),before);
});

for(const field of ['storeId','targetId','expectedControlRevision','expectedConsentGeneration','expectedNamespaceGeneration','expectedRawRevision','client','namespace'])
test('B2b-03 stale startup '+field+' refuses before host policy/seal/model',async t=>{
  const f=fixture(t); f.grant(); const authority=f.snapshot();
  authority[field]=field==='namespace'?{...ns,projectId:'other'}:field==='client'?'codex':field.includes('Revision')?99:'wrong';
  const worker=f.worker({authority}); denied(await worker.captureRaw(f.request()),'revision_conflict');
  assert.equal(f.policyCalls,0);assert.equal(f.seals,0);assert.equal(f.calls,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_events').get().n,0);
});

for(const state of ['absent','disabled']) test('B2b-03 '+state+' authorization never dispatches',async t=>{
  const f=fixture(t);if(state==='disabled')ok(f.set());
  const worker=f.worker(); denied(await worker.captureRaw(f.request()),'capture_disabled');
  assert.equal(f.policyCalls,0);assert.equal(f.seals,0);assert.equal(f.calls,0);
});

for(const client of ['claude-code','codex']) for(const kind of ['ordinary','staged'])
test(`B2b-04/05 ${client} ${kind} revoke while extracting blocks publication and unmanaged replay`,async t=>{
  const f=fixture(t,{client,kind}); f.grant(); const worker=f.worker({duringExtract:()=>ok(f.set({automaticCaptureEnabled:false}))});
  const result=ok(await worker.captureRaw(f.request())); denied(result.interpretation,'capture_evidence_closed');
  assert.equal(f.calls,1);assert.equal(f.db.prepare('SELECT count(*) n FROM memories WHERE deleted=0').get().n,0);
  assert.equal(result.raw.parts[0].saved,true);
  const unmanaged=f.worker({unmanaged:true}); denied(await unmanaged.captureRaw(f.request()),'capture_evidence_closed');
  ok(f.set({automaticCaptureEnabled:true})); denied(await f.worker().captureRaw(f.request()),'capture_evidence_closed');
});

for(const kind of ['ordinary','staged']) test('B2b-06 '+kind+' notice-only during extraction preserves Memory and replay',async t=>{
  const f=fixture(t,{kind}); const grant=f.grant(),worker=f.worker({duringExtract:()=>ok(f.set({rawNoticeVersion:null}))});
  const req=f.request(),result=ok(await worker.captureRaw(req));ok(result.interpretation);
  assert.equal(f.get().consentGeneration,grant.consentGeneration);
  const fresh=f.worker();ok(ok(await fresh.captureRaw(req)).interpretation);assert.equal(f.calls,1);
});

test('B2b-06 notice closes pending reservations once, retains receipt and requires suffix gaps before next ordinal',async t=>{
  const f=fixture(t);f.grant();const worker=f.worker(),req=request(),part=req.messages[0];
  part.content='abc';part.part={index:0,start:0,totalUnits:6,totalBytes:6};
  const original=ok(await worker.captureRaw(req));assert.equal(original.raw.parts[0].saved,true);
  const before=f.db.prepare('SELECT revision FROM raw_owner_usage').get().revision;
  const changed=ok(f.set({rawNoticeVersion:null}));assert.equal(f.db.prepare('SELECT reserved_bytes n FROM raw_owner_usage').get().n,0);
  const after=f.db.prepare('SELECT revision FROM raw_owner_usage').get().revision;assert.equal(after,before+1);
  assert.deepEqual(ok(f.set({rawNoticeVersion:null})),changed);assert.equal(f.db.prepare('SELECT revision FROM raw_owner_usage').get().revision,after);
  assert.deepEqual(JSON.parse(f.db.prepare('SELECT result FROM raw_events').get().result),original.raw);
  ok(f.set({rawNoticeVersion:'local-plain-v1'}));const fresh=f.worker();
  const next=request({eventId:'next',messages:[{...part,id:'next',messageOrdinal:2,content:'fresh',part:{index:0,start:0,totalUnits:5,totalBytes:5}}]});
  denied(await fresh.captureRaw(next),'raw_part_out_of_order');
  const suffix=request({eventId:'suffix',messages:[{...part,content:'def',part:{index:1,start:3,totalUnits:6,totalBytes:6}}]});
  const gap=ok(await fresh.captureRaw(suffix));assert.deepEqual(gap.raw.parts,[{messageId:'source',index:1,saved:false,reason:'notice_required'}]);
  assert.equal(gap.interpretation.value.reason,'continuation');assert.equal(f.calls,1);
  ok(await fresh.captureRaw(next));assert.equal(f.calls,2);
});

test('B2b-07 authority closure failure rolls row revision and reservations back together',async t=>{
  const f=fixture(t);const original=f.grant(),req=f.request(),part=req.messages[0];part.part.totalUnits+=3;part.part.totalBytes+=3;
  ok(await f.worker().captureRaw(req));
  f.db.exec(`CREATE TRIGGER synthetic_control_failure BEFORE UPDATE ON raw_messages BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;`);
  denied(f.set({automaticCaptureEnabled:false}),'storage_error');assert.deepEqual(f.get(),original);
  assert.equal(f.db.prepare('SELECT reserved_bytes n FROM raw_owner_usage').get().n,3);
  assert.equal(f.db.prepare('SELECT assembly_state FROM raw_messages').get().assembly_state,'pending');
});

for(const client of ['claude-code','codex']) test('B2b-03 '+client+' consent revoked by preparation policy cannot reach sealing',async t=>{
  const f=fixture(t,{client});f.grant();
  const worker=f.worker({duringPolicy:()=>ok(f.set({automaticCaptureEnabled:false}))});
  denied(await worker.captureRaw(f.request()),'capture_disabled');assert.equal(f.policyCalls,1);
  assert.equal(f.seals,0);assert.equal(f.calls,0);
  for(const table of ['raw_events','raw_capture_events','admission_claims'])assert.equal(f.db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
});

for(const client of ['claude-code','codex']) for(const mutation of ['revoke','aba'])
test(`B2b-03 ${client} ${mutation} during first seal prevents the next seal dispatch`,async t=>{
  const f=fixture(t,{client}),grant=f.grant(),trace=[];let dispatched=0,worker;
  worker=f.worker({duringSeal:async()=>{
    dispatched++;trace.push('seal-'+dispatched);
    if(dispatched===1) {
      ok(f.set({automaticCaptureEnabled:false}));
      if(mutation==='aba')ok(f.set({automaticCaptureEnabled:true}));
      const observed=ok(worker.getLocalCaptureControl({namespace:ns,client}));
      assert.equal(observed.automaticCaptureEnabled,mutation==='aba');
      assert.notEqual(observed.consentGeneration,grant.consentGeneration);
      trace.push('revocation-visible');await Promise.resolve();trace.push('first-finished');
    }
  }});
  const req=f.request(),first=req.messages[0];
  req.messages.push({...first,id:'second-source',messageOrdinal:2,part:{...first.part}});
  denied(await worker.captureRaw(req),mutation==='aba'?'revision_conflict':'capture_disabled');
  assert.equal(f.calls,0);
  for(const table of ['raw_conversations','raw_events','raw_capture_events','raw_parts','admission_claims'])
    assert.equal(f.db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
  assert.deepEqual(trace,['seal-1','revocation-visible','first-finished']);assert.equal(f.seals,1);
});
