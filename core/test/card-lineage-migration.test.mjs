import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../index.mjs';
import { migrateCardLineage,contentSafetyInventory } from '../content-safety-migration.mjs';
import { safetyFixture,copySqliteFixture,readSqliteFixture,quiescence,ns,ok,receipt } from '../testing/content-safety-s2h-fixture.mjs';
import { lineageHost } from '../testing/card-lineage-fixture.mjs';

test('canonical legacy seeding preserves leading U+FEFF bytes and positive edges, never invents own writing',async t=>{
  const f=safetyFixture(t,23),host=lineageHost(),core=openMemoryCore({path:f.path,privateCards:host.options});
  const card=ok(host.call(core,'createCardDraft',{namespace:ns,actionId:'legacy-own',drafting:'authored',
    input:{title:'\uFEFFSynthetic legacy title',body:'\uFEFFSynthetic legacy body',authoredInput:{text:'\uFEFFSynthetic note',occurredAt:null}}}));
  core.close();const db=f.connect(),before=db.prepare('SELECT title,body FROM private_cards WHERE id=?').get(card.id);db.close();
  copySqliteFixture(f.path,f.backupPath);
  const result=await migrateCardLineage({path:f.path,backupPath:f.backupPath,expected:{base:23,storeId:f.storeId},quiescence});
  assert.deepEqual(result.counts,{complete:0,unknown:1,knownSuppressed:0});
  const after=f.connect();t.after(()=>after.close());
  assert.deepEqual(after.prepare('SELECT title,body FROM private_cards WHERE id=?').get(card.id),before);
  assert.equal(after.prepare('SELECT body_revision FROM private_cards').get().body_revision,1);
  assert.equal(after.prepare('SELECT count(*) n FROM card_body_authorizations').get().n,0);
  assert.ok(after.prepare("SELECT 1 FROM card_body_sources WHERE content_identity='' AND source_version LIKE '%note-v1%'").get());
  const reopened=openMemoryCore({path:f.path,privateCards:host.options});t.after(()=>reopened.close());
  assert.equal(ok(host.call(reopened,'getCard',{namespace:ns,cardId:card.id})).card,null);
  const listed=ok(host.call(reopened,'listCards',{namespace:ns,states:['draft']}));
  assert.deepEqual(listed.cards,[]);assert.equal(listed.nextCursor,null);assert.equal(listed.coverage.included,0);
});

test('offline migration requires backup, quiescence and supported base; failures leave bytes unchanged',async t=>{
  const f=safetyFixture(t,18);copySqliteFixture(f.path,f.backupPath);
  await assert.rejects(migrateCardLineage({path:f.path,backupPath:f.backupPath,expected:{base:18,storeId:f.storeId},quiescence}),/unsupported_database/);
  const before=f.connect(),inventory=contentSafetyInventory(before);before.close();
  await assert.rejects(migrateCardLineage({path:f.path,backupPath:f.backupPath,expected:{base:18,storeId:f.storeId},quiescence:{}}),/invalid_input/);
  const after=f.connect();assert.equal(contentSafetyInventory(after),inventory);after.close();
});

test('adding lineage to installed suppression preserves the complete denial population and domain',async t=>{
  const f=safetyFixture(t,23);await f.migrate();
  const core=openMemoryCore({path:f.path}),memory=ok(core.admit({namespace:ns,memory:{content:'Synthetic erased Memory',kind:'fact'},receipts:[receipt('erased')]})).memory;
  ok(core.forget({namespace:ns,memoryId:memory.id,expectedRevision:memory.revision}));core.close();
  const db=f.connect();
  const names=['content_suppressions','owner_suppression_epochs','content_identity_reservations'];
  const before=names.map(table=>db.prepare('SELECT * FROM '+table).all());
  const domain=db.prepare('SELECT suppression_domain FROM content_safety_control').get().suppression_domain;db.close();
  copySqliteFixture(f.path,f.backupPath);
  const result=await migrateCardLineage({path:f.path,backupPath:f.backupPath,expected:{storeId:f.storeId,base:23,suppressionDomain:domain},quiescence});
  assert.equal(result.suppressionDomain,domain);const after=f.connect();t.after(()=>after.close());
  assert.deepEqual(names.map(table=>after.prepare('SELECT * FROM '+table).all()),before);
  assert.ok(before.every(rows=>rows.length>0),'nonempty facts, counters and reservations were preserved');
});

test('malformed confirmed numbering rolls the entire offline migration back, including file bytes',async t=>{
  const f=safetyFixture(t,23),host=lineageHost(),core=openMemoryCore({path:f.path,privateCards:host.options});
  let card=ok(host.call(core,'createCardDraft',{actionId:'draft',drafting:'authored',input:{title:'Synthetic title',body:'Synthetic body',authoredInput:{text:'Synthetic source',occurredAt:null}}}));
  card=ok(host.call(core,'confirmCardDraft',{actionId:'confirm',cardId:card.id,expectedRevision:card.revision}));core.close();
  const db=f.connect();db.prepare('UPDATE private_cards SET body_revision=NULL WHERE id=?').run(card.id);db.close();
  copySqliteFixture(f.path,f.backupPath);const bytes=readSqliteFixture(f.path);
  await assert.rejects(migrateCardLineage({path:f.path,backupPath:f.backupPath,expected:{storeId:f.storeId,base:23},quiescence}),/unsupported_database/);
  assert.deepEqual(readSqliteFixture(f.path),bytes);
});

test('legacy owner-wide action collisions refuse migration without adopting an actor or changing bytes',async t=>{
  const f=safetyFixture(t,23),host=lineageHost(),core=openMemoryCore({path:f.path,privateCards:host.options});
  for(const namespace of [ns,{...ns,projectId:'another-synthetic-project'}])ok(host.call(core,'submitSourceNote',{
    namespace,actionId:'legacy-reused-action',text:'Synthetic legacy note',occurredAt:null}));
  core.close();copySqliteFixture(f.path,f.backupPath);const bytes=readSqliteFixture(f.path);
  await assert.rejects(migrateCardLineage({path:f.path,backupPath:f.backupPath,expected:{storeId:f.storeId,base:23},quiescence}),/action_conflict/);
  assert.deepEqual(readSqliteFixture(f.path),bytes);
});


for(const currentBody of [false,true])test(`installed correction denials count as known-suppressed during lineage migration, current body ${currentBody}`,async t=>{
  const f=safetyFixture(t,23);await f.migrate();
  const host=lineageHost(),core=openMemoryCore({path:f.path,privateCards:host.options});
  const memory=ok(core.admit({namespace:ns,memory:{content:'Synthetic original',kind:'fact'},receipts:[receipt('original')]})).memory;
  let card=ok(host.call(core,'createCardDraft',{namespace:ns,actionId:'draft',drafting:'authored',input:{title:'Synthetic title',body:'Synthetic old body',
    memoryRefs:[{type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision}],sourcePolicy:'retained-receipts-v1'}}));
  card=ok(host.call(core,'confirmCardDraft',{namespace:ns,actionId:'confirm',cardId:card.id,expectedRevision:card.revision}));
  const corrected=ok(core.correct({namespace:ns,memoryId:memory.id,expectedRevision:memory.revision,content:'Synthetic corrected',kind:'fact',receipt:receipt('corrected')})).memory;
  if(currentBody)ok(host.call(core,'createCardDraft',{actionId:'current-body',drafting:'authored',input:{title:'Synthetic current title',body:'Synthetic current body',
    memoryRefs:[{type:'memory',namespace:ns,memoryId:corrected.id,revision:corrected.revision}],sourcePolicy:'retained-receipts-v1'}}));
  core.close();
  const before=f.connect(),domain=before.prepare('SELECT suppression_domain FROM content_safety_control').get().suppression_domain;
  const facts=before.prepare('SELECT * FROM content_suppressions').all(),epochs=before.prepare('SELECT * FROM owner_suppression_epochs').all();
  const stored=before.prepare('SELECT title,body,body_revision,state FROM private_cards WHERE id=?').get(card.id);
  before.close();copySqliteFixture(f.path,f.backupPath);
  const result=await migrateCardLineage({path:f.path,backupPath:f.backupPath,expected:{storeId:f.storeId,base:23,suppressionDomain:domain},quiescence});
  t.diagnostic(JSON.stringify({facts,counts:result.counts}));
  assert.equal(result.counts.knownSuppressed,1,'existing canonical correction fact must win over unknown legacy completeness');
  assert.deepEqual(result.counts,{complete:0,unknown:Number(currentBody),knownSuppressed:1});
  const after=f.connect();t.after(()=>after.close());
  assert.deepEqual(after.prepare('SELECT * FROM content_suppressions').all(),facts);
  assert.deepEqual(after.prepare('SELECT * FROM owner_suppression_epochs').all(),epochs);
  assert.deepEqual(after.prepare('SELECT title,body,body_revision,state FROM private_cards WHERE id=?').get(card.id),stored);
  const headers=after.prepare('SELECT completeness,origin FROM card_body_provenance WHERE card_id=?').all(card.id);
  assert.deepEqual(headers.map(h=>[h.completeness,h.origin]),[['unknown','legacy-unknown']]);
  assert.ok(after.prepare("SELECT 1 FROM card_body_sources WHERE card_id=? AND source_kind='memory'").get(card.id));
  assert.ok(after.prepare("SELECT 1 FROM card_body_sources WHERE card_id=? AND source_kind='receipt'").get(card.id));
  const reopened=openMemoryCore({path:f.path,privateCards:host.options});t.after(()=>reopened.close());
  assert.equal(ok(host.call(reopened,'getCard',{cardId:card.id})).card,null,'known suppression does not grant legacy completeness');
  assert.deepEqual(ok(host.call(reopened,'listCards',{states:['draft','confirmed']})).cards,[]);
});
