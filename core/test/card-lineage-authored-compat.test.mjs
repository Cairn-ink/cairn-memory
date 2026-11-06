import test from 'node:test';
import assert from 'node:assert/strict';
import { lineageFixture,ns,ok } from '../testing/card-lineage-fixture.mjs';
import { contentSafetyInventory } from '../content-safety-migration.mjs';
import { openMemoryCore } from '../index.mjs';
import { request,splitRaw } from '../testing/raw-capture-fixtures.mjs';

test('leading U+FEFF title/body bytes survive authored sealing and reads',async t=>{
  const f=await lineageFixture(t),source=f.note('bom-source');
  const title='\uFEFFSynthetic title',body='\uFEFFSynthetic body';
  const card=ok(f.call('createCardDraft',{actionId:'bom-card',drafting:'authored',input:{title,body,sources:[source]}}));
  const detail=ok(f.call('getCard',{cardId:card.id})).card;
  assert.equal(detail.title,title);assert.equal(detail.body,body);
  assert.equal(f.db.prepare('SELECT hex(CAST(body AS BLOB)) bytes FROM private_cards WHERE id=?').get(card.id).bytes,
    Buffer.from(body).toString('hex').toUpperCase());
});

test('leading U+FEFF submitted note remains a usable exact-byte source',async t=>{
  const f=await lineageFixture(t),text='\uFEFFSynthetic note';
  const source=ok(f.call('submitSourceNote',{actionId:'bom-note',text,occurredAt:null})).source;
  const card=f.draft([source]);
  assert.ok(ok(f.call('getCard',{cardId:card.id})).card);
  assert.equal(ok(f.call('getSource',{source})).parts.map(part=>part.text).join(''),text);
});

test('small Card pages and continuations work above the per-call scan budget',async t=>{
  const f=await lineageFixture(t);
  for(let i=0;i<1025;i++)ok(f.call('createCardDraft',{actionId:'bulk-'+i,drafting:'authored',input:{
    title:'Synthetic title',body:'Synthetic body',authoredInput:{text:'Synthetic original',occurredAt:null}}}));
  const first=ok(f.call('listCards',{states:['draft'],limit:1}));
  assert.equal(first.cards.length,1);assert.ok(first.nextCursor);
  const second=ok(f.call('listCards',{states:['draft'],limit:1,cursor:first.nextCursor}));
  assert.equal(second.cards.length,1);assert.ok(second.nextCursor);
  assert.ok(second.cards[0].id>first.cards[0].id);
  const ids=[];let cursor;
  do {
    const page=ok(f.call('listCards',{states:['draft','confirmed'],limit:50,...(cursor?{cursor}:{})}));
    ids.push(...page.cards.map(card=>card.id));cursor=page.nextCursor;
  } while(cursor);
  assert.equal(ids.length,1025);assert.equal(new Set(ids).size,1025);
  assert.deepEqual(ids,[...ids].sort());
  // Force a full bounded scan of denied bodies. A content-free continuation
  // must still advance and eventually reach the end without leaking IDs.
  f.db.exec('DROP TRIGGER safety_header_delete; DELETE FROM card_body_provenance;');
  // Restore the attested declaration before the next public read.
  const {cardLineageDDL}=await import('../card-lineage-schema.mjs');
  f.db.exec(cardLineageDDL.match(/CREATE TRIGGER safety_header_delete[\s\S]*?END;/)[0]);
  const hidden=ok(f.call('listCards',{states:['draft'],limit:1}));
  assert.deepEqual(hidden.cards,[]);assert.ok(hidden.nextCursor);
  const end=ok(f.call('listCards',{states:['draft'],limit:1,cursor:hidden.nextCursor}));
  assert.deepEqual(end.cards,[]);assert.equal(end.nextCursor,null);
});

test('authored operation audit is owner-wide, actor-bound, idempotent and keeps the first timestamp',async t=>{
  const f=await lineageFixture(t),input={actionId:'one-action',text:'Synthetic source',occurredAt:null};
  const first=f.call('submitSourceNote',input),inventory=contentSafetyInventory(f.db);
  f.host.authorizedAt='2026-02-01T00:00:00.000Z';assert.deepEqual(f.call('submitSourceNote',input),first);
  assert.equal(contentSafetyInventory(f.db),inventory);
  assert.equal(f.db.prepare('SELECT authorized_at FROM card_body_authorizations').get().authorized_at,'2026-01-01T00:00:00.000Z');
  f.host.actorId='other-human';assert.equal(f.call('submitSourceNote',input).error.code,'action_conflict');
  f.host.actorId='synthetic-human';
  assert.equal(f.call('submitSourceNote',{...input,namespace:{...ns,projectId:'other-project'}}).error.code,'action_conflict');
  assert.equal(f.call('submitSourceNote',{...input,text:'Changed text'}).error.code,'action_conflict');
  assert.equal(contentSafetyInventory(f.db),inventory);
});

test('own writing requires human audit, has zero external sources, and identical-byte keep-as-own creates a new body',async t=>{
  const f=await lineageFixture(t),a=f.note('external'),first=f.draft([a]),confirmed=f.confirm(first);
  f.host.kind='operation';
  const own={actionId:'authored-input',drafting:'authored',input:{title:'Synthetic own title',body:'Synthetic own body',authoredInput:{text:'Synthetic own text',occurredAt:null}}};
  const before=contentSafetyInventory(f.db);
  assert.equal(f.call('createCardDraft',own).error.code,'authority_required');assert.equal(contentSafetyInventory(f.db),before);
  f.host.kind='authored-input';const ownCard=ok(f.call('createCardDraft',own));
  assert.equal(f.db.prepare('SELECT count(*) n FROM card_body_sources WHERE card_id=?').get(ownCard.id).n,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM card_notes').get().n,1,'no fabricated external note');
  assert.equal(ok(f.call('getCard',{cardId:ownCard.id})).card.support.status,'eligible');
  f.host.kind='keep-as-own';
  const replaced=ok(f.call('editKnowledgeCard',{actionId:'keep-own',cardId:confirmed.id,expectedRevision:confirmed.revision,
    title:'Synthetic title',body:'Synthetic retained body',bindings:[],applicability:'current'}));
  assert.equal(replaced.bodyRevision,confirmed.bodyRevision+1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM card_body_sources WHERE card_id=? AND body_revision=?').get(confirmed.id,confirmed.bodyRevision).n,1);
  f.host.kind=null;ok(f.call('deleteSourceNote',{actionId:'delete-old-external',sourceId:a.sourceId,expectedRevision:a.revision}));
  assert.ok(ok(f.call('getCard',{cardId:confirmed.id})).card,'new human body discards the old dependency');
});

test('missing actor evidence refuses every new mutation before any acknowledgement',async t=>{
  const f=await lineageFixture(t),before=contentSafetyInventory(f.db);f.host.actorId='';
  assert.equal(f.call('submitSourceNote',{actionId:'missing-actor',text:'Synthetic source',occurredAt:null}).error.code,'authority_required');
  assert.equal(contentSafetyInventory(f.db),before);
});

test('confirmation preserves the accumulated body/provenance and ordinary authored DTOs',async t=>{
  const f=await lineageFixture(t),a=f.note('a'),b=f.note('b');let card=f.draft([a]);
  card=ok(f.call('editCardDraft',{actionId:'body-change',cardId:card.id,expectedRevision:card.revision,
    title:'Synthetic changed title',body:'Synthetic changed body',bindings:[b]}));
  const headers=f.db.prepare('SELECT * FROM card_body_provenance').all();card=f.confirm(card);
  assert.equal(card.bodyRevision,2);assert.deepEqual(f.db.prepare('SELECT * FROM card_body_provenance').all(),headers);
  const detail=ok(f.call('getCard',{cardId:card.id})).card;
  assert.equal(detail.origin,'authored');assert.equal(detail.state,'confirmed');assert.equal(detail.title,'Synthetic changed title');
  assert.deepEqual(detail.bindings.map(b=>b.source.sourceId),[b.sourceId]);
  assert.equal('provenanceDigest' in detail,false,'no new public DTO fields');
});

test('human rewrite can replace an unavailable old Raw body without reading its old sources',async t=>{
  const f=await lineageFixture(t,{base:33,raw:true}),part=splitRaw('Synthetic original Raw source.')[0];
  const saved=ok(await f.core.captureRaw(request(part,{namespace:ns,eventId:'raw'})));
  const conversationId=saved.raw.conversationId,revision=f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(conversationId).revision;
  const source=ok(await f.call('resolveSourceReferences',{anchors:[{rawAnchor:{conversationId,messageId:part.id,start:0,end:8,precision:'exact'},expectedConversationRevision:revision}]})).sources[0];
  const card=f.confirm(f.draft([source]));f.core.close();
  const reopened=openMemoryCore({path:f.path,privateCards:f.host.options});
  try {
    const denied=f.host.call(reopened,'getCard',{cardId:card.id});
    assert.equal(denied.ok,false,'old Raw source has no materializer');assert.equal(denied.error.code,'source_unavailable');
    f.host.kind='user-rewrite';
    const own=ok(f.host.call(reopened,'editKnowledgeCard',{actionId:'new-human-body',cardId:card.id,expectedRevision:card.revision,
      title:'Synthetic new human title',body:'Synthetic new human body',bindings:[],applicability:'current'}));
    assert.equal(own.bodyRevision,card.bodyRevision+1);
    assert.equal(ok(f.host.call(reopened,'getCard',{cardId:card.id})).card.body,'Synthetic new human body');
  } finally {reopened.close();}
});

for(const confirmed of [false,true])test(`explicit ${confirmed?'delete':'cancel'} purges Card bytes and retains immutable lineage`,async t=>{
  const f=await lineageFixture(t),a=f.note('source');let card=f.draft([a]);if(confirmed)card=f.confirm(card);
  const before=f.db.prepare('SELECT * FROM card_body_provenance').all();
  const result=ok(f.call(confirmed?'deleteKnowledgeCard':'cancelCardDraft',{actionId:'purge-card',cardId:card.id,expectedRevision:card.revision}));
  assert.equal(result.state,confirmed?'deleted':'cancelled');assert.equal(f.row(card.id).title,null);assert.equal(f.row(card.id).body,null);
  assert.deepEqual(f.db.prepare('SELECT * FROM card_body_provenance').all(),before);
  assert.equal(ok(f.call('getCard',{cardId:card.id})).card,null);
  const effects=ok(f.call('listCardEffects',{limit:50}));assert.doesNotMatch(JSON.stringify(effects),/Synthetic retained body/);
});

test('a human can keep an invalidated draft as own writing with identical supplied bytes',async t=>{
  const f=await lineageFixture(t),a=f.note('external'),card=f.draft([a]);
  ok(f.call('deleteSourceNote',{actionId:'erase-external',sourceId:a.sourceId,expectedRevision:a.revision}));
  assert.equal(ok(f.call('getCard',{cardId:card.id})).card,null);
  f.host.kind='keep-as-own';
  const rewritten=ok(f.call('editCardDraft',{actionId:'human-draft-rewrite',cardId:card.id,expectedRevision:f.row(card.id).revision,
    title:'Synthetic title',body:'Synthetic retained body',bindings:[]}));
  assert.equal(rewritten.bodyRevision,card.bodyRevision+1);
  const current=ok(f.call('getCard',{cardId:card.id})).card;
  assert.equal(current.body,'Synthetic retained body');assert.equal(current.support.status,'eligible');
  assert.equal(f.db.prepare('SELECT count(*) n FROM card_body_sources WHERE card_id=? AND body_revision=?').get(card.id,rewritten.bodyRevision).n,0);
});
