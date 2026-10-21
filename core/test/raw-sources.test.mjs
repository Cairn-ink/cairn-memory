import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../database.mjs';
import { openDatabase as openV27 } from '../testing/raw-v27-database.mjs';
import { openMemoryCore } from '../contract.mjs';
import { sourceFixture, savedSource, anchor, resolve, draft, ns, ok, denied, localPlainPort } from '../testing/raw-source-fixtures.mjs';

test('P3c-01 schema28 stays additive and migration failure atomically preserves v27', t => {
  const f = sourceFixture(t);
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,28);
  assert.throws(() => openV27(f.path), { code: 'unsupported_database' });
  const path = f.workspace.path+'/v27.sqlite', old = openDatabase(path,{ rawDeletion: true }); old.close();
  const exec = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec = function(sql) {
    const result = exec.call(this,sql);
    if (sql.includes('CREATE TABLE card_raw_bindings')) throw Error('Synthetic schema28 abort');
    return result;
  };
  try { assert.throws(() => openDatabase(path,{ rawSources: true }),/Synthetic schema28 abort/); }
  finally { DatabaseSync.prototype.exec = exec; }
  const db = openDatabase(path); f.workspace.defer(() => db.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,27);
  assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name IN ('card_raw_bindings','raw_source_part_start')").get().n,0);
});

test('P3c-01 migration rollback after trigger replacement preserves the actual v27 writer and receipt invalidation', t => {
  const f = sourceFixture(t), path = f.workspace.path+'/after-trigger-v27.sqlite';
  const initial = openDatabase(path,{ rawDeletion: true });
  const oldTrigger = initial.prepare("SELECT sql FROM sqlite_master WHERE name='card_memory_revision_invalidation'").get().sql;
  initial.close();
  const old = openMemoryCore({ path,privateCards:f.host.options });
  const memory = ok(old.admit({ namespace:ns,memory:{ content:'Synthetic ordinary support.',kind:'fact' },
    receipts:[{ client:'synthetic',sessionId:'ordinary',eventId:'ordinary',role:'user',excerpt:'Synthetic ordinary support.' }] })).memory;
  const card = ok(f.host.call(old,'createCardDraft',{ namespace:ns,actionId:'draft',drafting:'authored',input:{
    sourcePolicy:'retained-receipts-v1',memoryRefs:[{ type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision }],
    title:'Synthetic title',body:'Synthetic authored body.',
  } }));
  const confirmed = ok(f.host.call(old,'confirmCardDraft',{ namespace:ns,cardId:card.id,expectedRevision:card.revision,
    actionId:'confirm',applicability:'current' }));
  old.close();
  const exec = DatabaseSync.prototype.exec; let replaced = false;
  DatabaseSync.prototype.exec = function(sql) {
    const result = exec.call(this,sql);
    if (sql.includes('CREATE TRIGGER card_memory_revision_invalidation') && sql.includes('card_raw_pending_invalidations')) {
      assert.equal(this.prepare("SELECT count(*) n FROM sqlite_master WHERE name IN ('card_raw_mutation_context','card_raw_pending_invalidations')").get().n,2);
      assert.match(this.prepare("SELECT sql FROM sqlite_master WHERE name='card_memory_revision_invalidation'").get().sql,/card_raw_pending_invalidations/);
      replaced = true;
      throw Error('Synthetic abort after schema28 trigger replacement');
    }
    return result;
  };
  try { assert.throws(() => openDatabase(path,{ rawSources:true }),/Synthetic abort after schema28 trigger replacement/); }
  finally { DatabaseSync.prototype.exec = exec; }
  assert.equal(replaced,true);
  const frozen = openV27(path); f.workspace.defer(() => frozen.close());
  assert.equal(frozen.prepare('PRAGMA user_version').get().user_version,27);
  assert.equal(frozen.prepare("SELECT count(*) n FROM sqlite_master WHERE name IN ('card_raw_bindings','raw_source_part_start','card_raw_mutation_context','card_raw_pending_invalidations')").get().n,0);
  assert.equal(frozen.prepare("SELECT sql FROM sqlite_master WHERE name='card_memory_revision_invalidation'").get().sql,oldTrigger);
  const writer = openMemoryCore({ path }); f.workspace.defer(() => writer.close());
  ok(writer.forget({ namespace:ns,memoryId:memory.id,expectedRevision:memory.revision }));
  assert.equal(frozen.prepare('SELECT revision FROM private_cards WHERE id=?').get(card.id).revision,confirmed.revision+1);
  assert.equal(frozen.prepare('SELECT count(*) n FROM card_effects WHERE entity_id=?').get(card.id).n,1);
});

for (const client of ['claude-code','codex']) {
  test(`P3c-02/06/07 ${client}: bare Raw source creates the existing authored Card without Memory or note`, async t => {
    const f = sourceFixture(t), source = await savedSource(f,'  A😀B source.  ',{ client });
    const refs = await resolve(f,[anchor(source,2,6)]);
    assert.equal(refs[0].type,'raw'); assert.equal(refs[0].contentIdentity.length,43);
    const read = ok(await f.call('getSource',{ namespace: ns,source: refs[0] }));
    assert.deepEqual(read.parts,[{ start: 2,end: 6,text: 'A😀B' }]);
    const card = ok(draft(f,refs));
    ok(f.call('confirmCardDraft',{ namespace: ns,cardId: card.id,expectedRevision: card.revision,actionId: 'confirm',applicability: 'current' }));
    const detail = ok(f.call('getCard',{ namespace: ns,cardId: card.id })).card;
    assert.equal(detail.support.status,'eligible'); assert.equal(detail.bindings[0].dependency,'source-only');
    assert.equal(detail.bindings[0].memoryRef,null);
    for (const table of ['memories','card_notes']) assert.equal(f.db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
    const evidence = ok(f.call('fetchEvidence',{ namespace: ns,intent: 'current',refs: [{ type: 'card',namespace: ns,
      cardId: card.id,revision: detail.revision,bodyRevision: detail.bodyRevision }] }));
    assert.equal(evidence.items[0].provenance.completeness,'selected-raw-span');
    denied(await f.call('resolveSourceReferences',{ namespace: ns,anchors: [anchor(source,4,6)] }),'source_unavailable');
  });

  test(`P3c-03 ${client}: completing a message preserves its already-resolved immutable prefix`, async t => {
    const f = sourceFixture(t), text = 'A'.repeat(4500), parts = (await import('../testing/raw-capture-fixtures.mjs')).splitRaw(text);
    const { request } = await import('../testing/raw-capture-fixtures.mjs');
    const first = ok(await f.core.captureRaw(request(parts[0],{ client,eventId: 'prefix' })));
    const source = { conversationId: first.raw.conversationId,messageId: parts[0].id,text,
      expectedConversationRevision: first.raw.revision };
    const refs = await resolve(f,[anchor(source,0,20)]), card = ok(draft(f,refs));
    ok(await f.core.captureRaw(request(parts[1],{ client,eventId: 'suffix' })));
    assert.equal(ok(await f.call('getSource',{ namespace: ns,source: refs[0] })).parts[0].text,'A'.repeat(20));
    ok(f.call('confirmCardDraft',{ namespace: ns,cardId: card.id,expectedRevision: card.revision,actionId: 'confirm' }));
    denied(await f.call('resolveSourceReferences',{ namespace: ns,anchors: [anchor(source,0,20)] }),'revision_conflict');
  });

  test(`P3c-04/11 ${client}: full enclosing bytes are shared across anchors and refused before opening`, async t => {
    const port = localPlainPort(), open = port.openRaw; let opens = 0;
    port.openRaw = async value => { opens++; return open(value); };
    const f = sourceFixture(t,{ port }), source = await savedSource(f,'Synthetic full retained source.',{ client });
    const entries = [anchor(source,0,3),anchor(source,4,8)], bytes = Buffer.byteLength(source.text);
    assert.equal((await resolve(f,entries,{ sourceByteLimit: bytes })).length,2); assert.equal(opens,1);
    denied(await f.call('resolveSourceReferences',{ namespace: ns,anchors: entries,budgets: { sourceByteLimit: bytes-1 } }),'source_budget_exceeded');
    assert.equal(opens,1);
  });

  test(`P3c-07/08/10 ${client}: source deletion cancels drafts, retains qualified authored history and immutable replay`, async t => {
    const f = sourceFixture(t), source = await savedSource(f,undefined,{ client });
    const refs = await resolve(f,[anchor(source,0,8)]), pending = ok(draft(f,refs)), confirmed = ok(draft(f,refs,'confirmed'));
    ok(f.call('confirmCardDraft',{ namespace: ns,cardId: confirmed.id,expectedRevision: confirmed.revision,actionId: 'confirm',applicability: 'current' }));
    const before = ok(f.call('getCard',{ namespace: ns,cardId: confirmed.id })).card;
    ok(f.core.deleteConversation({ namespace: ns,conversationId: source.conversationId,
      expectedRevision: source.expectedConversationRevision,actionId: 'delete-source' }));
    assert.equal(ok(f.call('getCard',{ namespace: ns,cardId: pending.id })).card,null);
    const retained = ok(f.call('getCard',{ namespace: ns,cardId: confirmed.id })).card;
    assert.equal(retained.body,before.body); assert.equal(retained.support.status,'unavailable');
    assert.equal(retained.revision,before.revision+1); assert.equal(retained.bodyRevision,before.bodyRevision);
    assert.deepEqual(ok(draft(f,refs)),pending);
    denied(draft(f,refs,'fresh-action'),'source_unavailable');
    denied(await f.call('getSource',{ namespace: ns,source: refs[0] }),'source_unavailable');
    const old = openMemoryCore({ path: f.path,privateCards: f.host.options }); f.workspace.defer(() => old.close());
    denied(f.host.call(old,'getCard',{ namespace: ns,cardId: confirmed.id }),'source_unavailable');
    ok(f.host.call(old,'deleteKnowledgeCard',{ namespace: ns,cardId: retained.id,
      expectedRevision: retained.revision,actionId: 'owner-delete' }));
    assert.equal(f.db.prepare('SELECT count(*) n FROM card_raw_bindings').get().n,0);
    assert.equal(f.db.prepare('SELECT count(*) n FROM raw_parts').get().n,0);
  });

  test(`P3c-06/11 ${client}: pages authenticate whole references, bind budgets and access generation`, async t => {
    const port = localPlainPort(), open = port.openRaw; let opens = 0;
    port.openRaw = async value => { opens++; return open(value); };
    const f = sourceFixture(t,{ port }), source = await savedSource(f,'😀'.repeat(4500),{ client });
    const budgets = { sourceByteLimit: 64000 }, [ref] = await resolve(f,[anchor(source)],budgets);
    const baseline = opens;
    denied(await f.call('getSource',{ namespace: ns,source: ref,limit: 1 }),'source_budget_exceeded');
    assert.equal(opens,baseline);
    const input = { namespace: ns,source: ref,limit: 1,budgets };
    const first = ok(await f.call('getSource',input));
    assert.equal(first.parts.length,1); assert.equal(first.parts[0].start,0); assert.equal(first.coverage.status,'budget_exhausted');
    denied(await f.call('getSource',{ ...input,cursor: first.nextCursor,budgets: { sourceByteLimit: 32000 } }),'invalid_cursor');
    let cursor = first.nextCursor, text = first.parts[0].text;
    while (cursor) {
      const page = ok(await f.call('getSource',{ ...input,cursor }));
      text += page.parts[0].text; cursor = page.nextCursor;
    }
    assert.equal(text,source.text);
    f.host.revoke();
    denied(await f.call('getSource',{ ...input,cursor: first.nextCursor }),'cursor_stale');
  });
}
