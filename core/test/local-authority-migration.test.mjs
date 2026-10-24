import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { openDatabase } from '../database.mjs';
import { openMemoryCore } from '../index.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { readPolicy,plain,request,ns,ok,denied } from '../testing/local-authority-fixtures.mjs';

const options=version=>version===18?{}:version===23?{privateCards:true}:version===24?{rawConversations:true}:
  version===25?{rawCapture:true}:version===26?{rawLineage:true}:version===27?{rawDeletion:true}:{rawSources:true};
const schema=db=>db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
for(const version of [18,23,24,25,26,27,28]) test(`B2b-07 explicit public migration ${version}→29 is atomic, empty and feature-off safe`,t=>{
  const ws=createTestWorkspace(t,{prefix:'local-migration-'}),path=join(ws.path,'store.sqlite');
  const before=openDatabase(path,options(version));ws.defer(()=>before.close());
  assert.equal(before.prepare('PRAGMA user_version').get().user_version,version);
  const off=openMemoryCore({path});ws.defer(()=>off.close());
  assert.equal(before.prepare('PRAGMA user_version').get().user_version,version);
  assert.equal(off.getLocalCaptureControl,undefined);
  const selected=openMemoryCore({path,rawConversations:{mode:'off',readPolicy}});ws.defer(()=>selected.close());
  assert.equal(before.prepare('PRAGMA user_version').get().user_version,29);
  assert.equal(before.prepare('SELECT count(*) n FROM local_capture_controls').get().n,0);
  assert.equal(ok(selected.getLocalCaptureControl({namespace:ns,client:'claude-code'})).revision,0);
  const preserved=openDatabase(path);ws.defer(()=>preserved.close());
  assert.equal(preserved.prepare('PRAGMA user_version').get().user_version,29);
  assert.equal(before.prepare("SELECT count(*) n FROM sqlite_master WHERE name='card_raw_bindings'").get().n,1);
  assert.equal(selected.resolveSourceReferences,undefined);assert.equal(selected.getPrivateCardCapabilities,undefined);
});

for(const version of [24,25,26,27,28]) test(`B2b-07 ${version} partial29 artifacts refuse without repair`,t=>{
  const ws=createTestWorkspace(t,{prefix:'local-partial-'}),path=join(ws.path,'store.sqlite');
  const db=openDatabase(path,options(version));ws.defer(()=>db.close());
  if(version===24)db.exec('CREATE TABLE local_capture_controls(synthetic TEXT)');
  else db.exec('ALTER TABLE raw_capture_events ADD COLUMN local_target_id TEXT');
  const before=schema(db);assert.throws(()=>openDatabase(path,{localControls:true}),{code:'unsupported_database'});
  assert.deepEqual(schema(db),before);assert.equal(db.prepare('PRAGMA user_version').get().user_version,version);
});

for(const alteration of ['DROP TABLE card_raw_mutation_context','DROP INDEX raw_source_part_start','DROP TRIGGER card_raw_purge'])
test('B2b-07 claimed28 refuses missing prerequisite '+alteration,t=>{
  const ws=createTestWorkspace(t,{prefix:'local-source-partial-'}),path=join(ws.path,'store.sqlite');
  const db=openDatabase(path,{rawSources:true});ws.defer(()=>db.close());db.exec(alteration);
  const before=schema(db);assert.throws(()=>openDatabase(path,{localControls:true}),{code:'unsupported_database'});
  assert.deepEqual(schema(db),before);assert.equal(db.prepare('PRAGMA user_version').get().user_version,28);
});

for(const alteration of ['DROP TABLE local_capture_controls','DROP TRIGGER local_capture_binding_insert','DROP TRIGGER local_capture_binding_update'])
test('B2b-07 claimed29 refuses incomplete authority '+alteration,t=>{
  const ws=createTestWorkspace(t,{prefix:'local-authority-partial-'}),path=join(ws.path,'store.sqlite');
  const db=openDatabase(path,{localControls:true});ws.defer(()=>db.close());db.exec(alteration);
  assert.throws(()=>openDatabase(path),{code:'unsupported_database'});
});

test('B2b-07 injected final migration failure rolls the entire 24→29 opening transaction back',t=>{
  const ws=createTestWorkspace(t,{prefix:'local-rollback-'}),path=join(ws.path,'store.sqlite');
  const db=openDatabase(path,{rawConversations:true});ws.defer(()=>db.close());const before=schema(db);
  const original=DatabaseSync.prototype.exec;let injections=0;
  DatabaseSync.prototype.exec=function(sql){
    const result=Reflect.apply(original,this,[sql]);
    if(sql.includes('CREATE TRIGGER local_capture_binding_update')) { injections++;throw Error('synthetic migration failure'); }
    return result;
  };
  try { assert.throws(()=>openDatabase(path,{localControls:true}),/synthetic migration failure/); }
  finally { DatabaseSync.prototype.exec=original; }
  assert.equal(injections,1);assert.equal(db.prepare('PRAGMA user_version').get().user_version,24);assert.deepEqual(schema(db),before);
});

test('B2b-07 legacy unmanaged digest bytes survive migration; no implicit managed upgrade on collision',async t=>{
  const ws=createTestWorkspace(t,{prefix:'local-legacy-'}),path=join(ws.path,'store.sqlite');
  const legacy=openRawCaptureCore({path,model:{contextWindow:8192,countTokens:()=>1,extract:()=>({items:[]})}},
    {mode:'raw-v1',capBytes:1000000,port:plain(),readPolicy});ws.defer(()=>legacy.close());
  const req=request();ok(await legacy.captureRaw(req));
  const db=new DatabaseSync(path);ws.defer(()=>db.close());
  const row=db.prepare('SELECT binding_digest,projection_digest FROM raw_capture_events').get();
  assert.equal(row.binding_digest,createHash('sha256').update(JSON.stringify(['raw-capture-v1',{},{}])).digest('hex'));
  const core=openMemoryCore({path,rawConversations:{mode:'off',readPolicy}});ws.defer(()=>core.close());
  assert.deepEqual(db.prepare('SELECT binding_digest,projection_digest FROM raw_capture_events').get(),row);
  assert.equal(db.prepare('SELECT local_target_id FROM raw_capture_events').get().local_target_id,null);
  const absent=ok(core.getLocalCaptureControl({namespace:ns,client:req.client}));
  const grant=ok(core.setLocalCaptureControl({namespace:ns,client:req.client,targetId:'synthetic-target',expectedStoreId:absent.storeId,
    expectedRevision:0,automaticCaptureEnabled:true,rawNoticeVersion:'local-plain-v1'}));
  let calls=0;
  const managed=openMemoryCore({path,model:{contextWindow:8192,countTokens:()=>1,extract:()=>{calls++;return {items:[]};}},
    rawConversations:{mode:'raw-v1',capBytes:1000000,port:plain(),readPolicy,localAuthority:{version:'local-capture-authority-v1',
      targetId:grant.targetId,storeId:grant.storeId,namespace:ns,client:req.client,expectedControlRevision:grant.revision,
      expectedConsentGeneration:grant.consentGeneration,expectedNamespaceGeneration:'initial',expectedRawRevision:0}}});
  ws.defer(()=>managed.close());denied(await managed.captureRaw(req),'event_payload_conflict');assert.equal(calls,0);
});

test('B2b-04/07 a feature-off runtime opened before Raw migration discovers stored managed publication guards',async t=>{
  const ws=createTestWorkspace(t,{prefix:'local-before-migration-'}),path=join(ws.path,'store.sqlite');
  const old=createMemoryRuntime({path});ws.defer(()=>old.close());
  assert.throws(()=>old.assertCaptureEvidence(ns,{client:'claude-code',eventId:'absent',payloadDigest:'0'.repeat(64),token:'absent'}),{code:'capture_evidence_closed'});
  const control=openMemoryCore({path,rawConversations:{mode:'off',readPolicy}});ws.defer(()=>control.close());
  const db=new DatabaseSync(path);ws.defer(()=>db.close());
  const absent=ok(control.getLocalCaptureControl({namespace:ns,client:'claude-code'}));
  const settings={namespace:ns,client:'claude-code',targetId:'synthetic-target',expectedStoreId:absent.storeId,
    expectedRevision:0,automaticCaptureEnabled:true,rawNoticeVersion:'local-plain-v1'};
  const grant=ok(control.setLocalCaptureControl(settings));let checked=0;
  const core=openMemoryCore({path,model:{contextWindow:8192,countTokens:()=>1,extract:()=>{
    const pending=db.prepare('SELECT * FROM admission_claims').get();
    const input={client:pending.client,eventId:pending.event_id,payloadDigest:pending.payload_digest,token:pending.token};
    assert.equal(old.assertCaptureEvidence(ns,input),null);
    ok(control.setLocalCaptureControl({...settings,expectedRevision:grant.revision,automaticCaptureEnabled:false}));
    assert.throws(()=>old.assertCaptureEvidence(ns,input),{code:'capture_evidence_closed'});checked++;return {items:[]};
  }},rawConversations:{mode:'raw-v1',capBytes:1000000,port:plain(),readPolicy,
    localAuthority:{version:'local-capture-authority-v1',targetId:grant.targetId,storeId:grant.storeId,namespace:ns,client:'claude-code',
      expectedControlRevision:grant.revision,expectedConsentGeneration:grant.consentGeneration,expectedNamespaceGeneration:'initial',expectedRawRevision:0}}});
  ws.defer(()=>core.close());const result=ok(await core.captureRaw(request()));denied(result.interpretation,'capture_evidence_closed');assert.equal(checked,1);
});
