import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { lineageFixture,ns,ok,receipt } from '../testing/card-lineage-fixture.mjs';
import { transaction } from '../database.mjs';
import { cardBodyDigest,cardLineageStampInside,sealCardBodyInside,collectCardBodySourcesInside,exactCardInside } from '../card-lineage.mjs';
import { sourceReadSafety } from '../content-safety.mjs';
import { reserveContentIdentityInside } from '../content-suppression-storage.mjs';

test('one complete exact-byte authority retains removed sources and seals cumulative unions',async t=>{
  const f=await lineageFixture(t),a=f.note('note-a'),b=f.note('note-b');
  let card=f.draft([a]);const original=f.row(card.id);
  assert.equal(original.body_revision,1);
  assert.equal(f.db.prepare('SELECT body_digest FROM card_body_provenance').get().body_digest,cardBodyDigest(f.identity,ns,original));
  card=ok(f.call('editCardDraft',{actionId:'union',cardId:card.id,expectedRevision:card.revision,
    title:original.title,body:original.body,bindings:[b]}));
  assert.equal(card.bodyRevision,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM card_body_sources').get().n,2);
  assert.equal(cardLineageStampInside(f.db,ns,card.id)[1],2);
  const detail=ok(f.call('getCard',{cardId:card.id})).card;
  assert.deepEqual(detail.bindings.map(b=>b.source.sourceId),[b.sourceId]);
  ok(f.call('deleteSourceNote',{actionId:'delete-a',sourceId:a.sourceId,expectedRevision:a.revision}));
  assert.equal(f.row(card.id).state,'draft');assert.equal(f.row(card.id).body,original.body);
  assert.equal(ok(f.call('getCard',{cardId:card.id})).card,null);
});

test('same-body additions change provenance without epochs; prepared identity changes',async t=>{
  const f=await lineageFixture(t),a=f.note('note-a'),b=f.note('note-b'),card=f.draft([a]);
  const old=cardLineageStampInside(f.db,ns,card.id),epochs=f.db.prepare('SELECT * FROM card_epochs').all();
  transaction(f.db,()=>sealCardBodyInside(f.db,{identity:f.identity,namespace:ns,cardId:card.id,
    sources:collectCardBodySourcesInside(f.db,f.identity,ns,[b],ref=>sourceReadSafety(f.db,{identity:f.identity,namespace:ns,ref}).allowed)}));
  assert.notDeepEqual(cardLineageStampInside(f.db,ns,card.id),old);
  assert.deepEqual(f.db.prepare('SELECT * FROM card_epochs').all(),epochs);
  assert.equal(ok(f.call('getCard',{cardId:card.id})).card.body,'Synthetic retained body');
});

test('source/header/auth replacement, shrink, body rollback and unsealed additions refuse',async t=>{
  const f=await lineageFixture(t),a=f.note('note-a'),card=f.draft([a]);
  for(const table of ['card_body_sources','card_body_provenance','card_body_authorizations']) {
    assert.throws(()=>f.db.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`),/safety_/);
    assert.throws(()=>f.db.exec(`DELETE FROM ${table}`),/safety_immutable/);
    assert.throws(()=>f.db.exec(`UPDATE ${table} SET owner_id=owner_id`),/safety_immutable/);
  }
  assert.throws(()=>f.db.prepare('UPDATE private_cards SET body_revision=0 WHERE id=?').run(card.id),/safety_body_rollback/);
  assert.throws(()=>f.db.prepare('UPDATE private_cards SET title=? WHERE id=?').run('Changed bytes',card.id),/safety_body_rollback/);
  // A direct pointer advance without a new header is unreadable.
  f.db.prepare('UPDATE private_cards SET body_revision=2 WHERE id=?').run(card.id);
  assert.equal(ok(f.call('getCard',{cardId:card.id})).card,null);
  assert.throws(()=>f.db.prepare('UPDATE private_cards SET body_revision=1 WHERE id=?').run(card.id),/safety_body_rollback/);
});

test('commitments use the specified JSON domains, exact Unicode bytes and full sorted source tuples',async t=>{
  const f=await lineageFixture(t),a=f.note('z-source'),b=f.note('a-source');
  const card=ok(f.call('createCardDraft',{actionId:'unicode',drafting:'authored',input:{
    title:'Synthetic café \u{1f9ed}',body:'Synthetic e\u0301 and é remain distinct',sources:[a,b]}}));
  const row=f.row(card.id),h=f.db.prepare('SELECT * FROM card_body_provenance WHERE card_id=?').get(card.id);
  const hmac=(purpose,value)=>createHmac('sha256',f.identity.cursorSecret).update(Buffer.from(JSON.stringify([purpose,value]),'utf8')).digest('hex');
  const body=hmac('card-body-s2-v1',[f.storeId,ns,card.id,1,row.title,row.body]);
  assert.equal(h.body_digest,body);
  const sources=f.db.prepare('SELECT * FROM card_body_sources WHERE card_id=?').all(card.id).map(s=>[
    {ownerId:s.owner_id,scope:s.source_scope,projectId:s.source_project||null},s.source_kind,s.source_key,s.source_incarnation,
    JSON.parse(s.source_version),s.content_identity]).sort((a,b)=>Buffer.compare(Buffer.from(JSON.stringify(a)),Buffer.from(JSON.stringify(b))));
  assert.equal(h.provenance_digest,hmac('card-provenance-s2-v1',[f.storeId,ns,card.id,1,1,body,'complete','derived',null,sources]));
  assert.notEqual(body,hmac('card-body-s2-v1',[f.storeId,ns,card.id,1,row.title,row.body.normalize('NFC')]));
  assert.match(body,/^[0-9a-f]{64}$/);
});

test('malformed UTF-8 and normalization collisions refuse before sealing or delivering bytes',async t=>{
  const f=await lineageFixture(t),a=f.note('source'),card=f.draft([a]);
  for(const sql of ["CAST(x'80ff' AS TEXT)","'sk-' || 'synthetic' || '0000000000000000'"]) {
    f.db.exec('BEGIN');
    try {
      f.db.prepare(`UPDATE private_cards SET body=${sql},body_revision=body_revision+1 WHERE id=?`).run(card.id);
      assert.throws(()=>exactCardInside(f.db,ns,card.id),/source_unavailable/);
      assert.throws(()=>sealCardBodyInside(f.db,{identity:f.identity,namespace:ns,cardId:card.id,newBody:true,sources:[]}),/source_unavailable/);
    } finally {f.db.exec('ROLLBACK');}
  }
  assert.equal(ok(f.call('getCard',{cardId:card.id})).card.body,'Synthetic retained body');
});

test('deferred sealing foreign key rejects a source addition without its provenance header',async t=>{
  const f=await lineageFixture(t),a=f.note('a'),b=f.note('b'),card=f.draft([a]);
  const s=collectCardBodySourcesInside(f.db,f.identity,ns,[b],()=>true)[0];
  f.db.exec('BEGIN');
  try {
    reserveContentIdentityInside(f.db,ns,s.source_kind,s.source_key,s.source_incarnation,'writer');
    f.db.prepare('INSERT INTO card_body_sources VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(ns.ownerId,ns.scope,ns.projectId??'',card.id,1,
      s.source_scope,s.source_project,s.source_kind,s.source_key,s.source_incarnation,s.source_version,s.content_identity,2,s.evidence_origin,s.evidence_digest);
    assert.throws(()=>f.db.exec('COMMIT'),/FOREIGN KEY/);
  } finally {if(f.db.isTransaction)f.db.exec('ROLLBACK');}
  assert.equal(f.db.prepare('SELECT count(*) n FROM card_body_sources').get().n,1);
});

test('empty presentation bindings retain derived provenance and never become own writing',async t=>{
  const f=await lineageFixture(t),a=f.note('source');let card=f.draft([a]);
  card=ok(f.call('editCardDraft',{actionId:'remove-all',cardId:card.id,expectedRevision:card.revision,
    title:'Synthetic title',body:'Synthetic retained body',bindings:[]}));
  const h=f.db.prepare('SELECT * FROM card_body_provenance ORDER BY provenance_revision DESC LIMIT 1').get();
  assert.equal(h.origin,'derived');assert.equal(h.source_count,1);assert.equal(h.authorization_action,null);
  assert.deepEqual(ok(f.call('getCard',{cardId:card.id})).card.bindings,[]);
  ok(f.call('deleteSourceNote',{actionId:'delete-removed',sourceId:a.sourceId,expectedRevision:a.revision}));
  assert.equal(ok(f.call('getCard',{cardId:card.id})).card,null);
});

test('receipt closure binds exact parent Memory bytes independently of metadata revision and surviving receipts',async t=>{
  const f=await lineageFixture(t),memory=ok(f.core.admit({namespace:ns,memory:{content:'Synthetic original parent',kind:'fact'},receipts:[receipt('parent')]})).memory;
  const card=ok(f.call('createCardDraft',{actionId:'parent-card',drafting:'authored',input:{title:'Synthetic title',body:'Synthetic retained body',
    memoryRefs:[{type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision}],sourcePolicy:'retained-receipts-v1'}}));
  const old=f.db.prepare('SELECT revision,fingerprint FROM memories WHERE id=?').get(memory.id);
  f.db.prepare('UPDATE memories SET content=? WHERE id=?').run('Synthetic silently replaced parent',memory.id);
  assert.deepEqual(f.db.prepare('SELECT revision,fingerprint FROM memories WHERE id=?').get(memory.id),old);
  assert.equal(f.db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(memory.id).n,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM content_suppressions').get().n,0);
  assert.equal(ok(f.call('getCard',{cardId:card.id})).card,null);
});
