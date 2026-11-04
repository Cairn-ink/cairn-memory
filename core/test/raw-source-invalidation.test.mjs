import assert from 'node:assert/strict';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { fixture, config } from '../testing/raw-capture-fixtures.mjs';
import { sourceFixture, savedSource, anchor, resolve, draft, cardHost, localPlainPort, ns, ok, denied, request, splitRaw } from '../testing/raw-source-fixtures.mjs';

const model = { extract: ({ input }) => ({ items: ['north','south'].map(direction => ({
  content: 'Synthetic '+direction+' interpretation of '+input.messages[0].content.slice(0,40),
  kind: 'fact',confidence: .8,sourceIndices: [0],
})) }) };
const confirm = (f,card,actionId) => ok(f.call('confirmCardDraft',{ namespace: ns,cardId: card.id,
  expectedRevision: card.revision,actionId,applicability: 'current' }));
const effects = (f,id) => f.db.prepare('SELECT * FROM card_effects WHERE entity_id=? ORDER BY ordinal').all(id);
const snapshot = db => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({ name }) => [name,db.prepare(`SELECT * FROM "${name}"`).all().map(row => JSON.stringify(row)).sort()]);
const noPendingMutation = db => {
  for (const table of ['card_raw_mutation_context','card_raw_pending_invalidations'])
    assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
};

function preUpgradeFixture(t,kind) {
  const host = cardHost(), base = fixture(t,{ kind,model,deletion:true,coreOptions:{ privateCards:host.options } });
  const off = openMemoryCore({ path:base.path }); base.workspace.defer(() => off.close());
  const options = { path:base.path,model:base.model,...config(kind),privateCards:host.options };
  const raw = { mode:'raw-v1',sources:true,port:localPlainPort(),readPolicy:() => ({ generation:'synthetic',reason:null }) };
  let core = openRawCaptureCore(options,raw);
  base.workspace.defer(() => core.close());
  return { ...base,host,off,get core() { return core; },call:(method,input) => host.call(core,method,input),
    reopen() { core.close(); core = openRawCaptureCore(options,raw); } };
}

function receiptDraft(f,memories,actionId) {
  return ok(f.call('createCardDraft',{ namespace: ns,actionId,drafting: 'authored',input: {
    memoryRefs: memories.map(memory => ({ type: 'memory',namespace: ns,memoryId: memory.id,revision: memory.revision })),
    sourcePolicy: 'retained-receipts-v1',title: 'Synthetic title',body: 'Synthetic authored body.',
  } }));
}
function mixedDraft(f,memories,refs,actionId) {
  const card = receiptDraft(f,memories,actionId);
  const detail = ok(f.call('getCard',{ namespace: ns,cardId: card.id })).card;
  return ok(f.call('editCardDraft',{ namespace: ns,cardId: card.id,expectedRevision: card.revision,
    actionId: actionId+'-edit',title: detail.title,body: detail.body,bindings: [...detail.bindings.map(binding => binding.source),...refs] }));
}

for (const client of ['claude-code','codex']) {
  for (const mutation of ['deleteConversation','forgetEpisode','forget','correct']) {
    test(`P3c-08 ${client}: ${mutation} invalidates mixed Raw/multiple-Memory Cards once`, async t => {
      const episode = mutation === 'forgetEpisode';
      const f = preUpgradeFixture(t,episode ? 'episode' : 'ordinary');
      let source;
      const text = 'A'.repeat(4000)+'Independent tail.';
      if (episode) {
        let result;
        for (const [index,part] of splitRaw(text).entries()) result = ok(await f.core.captureRaw(request(part,
          { client,eventId: 'episode-'+index },'episode')));
        source = { conversationId: result.raw.conversationId,messageId: splitRaw(text)[0].id,text,
          expectedConversationRevision: f.db.prepare('SELECT revision FROM raw_conversations').get().revision };
      } else source = await savedSource(f,text,{ client });
      const memories = f.db.prepare('SELECT id,revision FROM memories WHERE deleted=0 ORDER BY id').all();
      // Only the first retained part is interpreted, so both Memories overlap
      // the first two refs while the retained tail is genuinely disjoint.
      assert.equal(memories.length,2);
      const refs = await resolve(f,[anchor(source,0,8),anchor(source,4,12)]);
      // Inspect the installed v28 trigger's actual SELECTs, rather than a
      // separately maintained approximation of its candidate queries.
      const trigger = f.db.prepare("SELECT sql FROM sqlite_master WHERE name='card_memory_revision_invalidation'").get().sql;
      const select = trigger.match(/SELECT DISTINCT c\.id,c\.revision FROM card_memory_bindings[\s\S]*?;/)[0].slice(0,-1);
      const epoch = trigger.match(/INSERT INTO card_epochs[\s\S]*?;/)[0].slice(0,-1);
      for (const sql of [select,epoch]) {
        const plan = f.db.prepare('EXPLAIN QUERY PLAN '+sql.replace(/OLD\.(id|owner_id|scope|project_id)/g,':$1'))
          .all({ id:memories[0].id,owner_id:ns.ownerId,scope:ns.scope,project_id:ns.projectId ?? '' }).map(row => row.detail);
        assert.ok(plan.some(detail => /SEARCH b USING (?:COVERING )?INDEX card_memory_dependents \(memory_id=\?\)/.test(detail)),plan.join('\n'));
        assert.equal(plan.some(detail => /SCAN c\b/.test(detail)),false,plan.join('\n'));
      }
      const disjoint = await resolve(f,[anchor(source,4000,4011)]);
      const pending = mixedDraft(f,memories,refs,'pending');
      const mixed = mixedDraft(f,memories,refs,'mixed'), confirmed = confirm(f,mixed,'confirm-mixed');
      const receipt = receiptDraft(f,memories,'receipt'), receiptConfirmed = confirm(f,receipt,'confirm-receipt');
      const separate = ok(draft(f,disjoint,'separate')), separateConfirmed = confirm(f,separate,'confirm-separate');
      const mixedEffects = effects(f,mixed.id), pendingEffects = effects(f,pending.id), receiptEffects = effects(f,receipt.id);
      const operations = f.db.prepare('SELECT * FROM card_operations ORDER BY action_id').all();
      const index = f.db.prepare('SELECT revision FROM card_moc_epochs').get().revision;
      const evidenceRef = { type: 'card',namespace: ns,cardId: mixed.id,revision: confirmed.revision,bodyRevision: confirmed.bodyRevision };
      const evidence = ok(f.call('fetchEvidence',{ namespace: ns,intent: 'current',refs: [evidenceRef] }));
      const off = f.off;
      let result, deletion;
      if (mutation === 'deleteConversation') {
        deletion = { namespace: ns,conversationId: source.conversationId,expectedRevision: source.expectedConversationRevision,actionId: 'delete' };
        result = ok(f.core.deleteConversation(deletion));
      } else if (episode) {
        const row = f.db.prepare('SELECT id,revision FROM session_episodes WHERE deleted=0').get();
        result = ok(off.forgetEpisode({ namespace: ns,episodeId: row.id,expectedRevision: row.revision }));
      } else if (mutation === 'forget') result = ok(off.forget({ namespace: ns,memoryId: memories[0].id,expectedRevision: memories[0].revision }));
      else result = ok(off.correct({ namespace: ns,memoryId: memories[0].id,expectedRevision: memories[0].revision,
        content: 'Synthetic explicit replacement.',kind: 'fact',receipt: { client:'synthetic',sessionId:'independent',
          eventId:'replacement',role:'user',excerpt:'Synthetic explicit replacement.' } }));
      assert.ok(result);
      const removedAll = mutation === 'deleteConversation' || episode;
      assert.equal(ok(f.call('getCard',{ namespace: ns,cardId: mixed.id })).card,null);
      const retained = f.db.prepare('SELECT revision,body FROM private_cards WHERE id=?').get(mixed.id);
      assert.equal(retained.revision,confirmed.revision+1);
      assert.equal(retained.body,'Synthetic authored body.');
      assert.equal(ok(f.call('getCard',{ namespace: ns,cardId: pending.id })).card,null);
      const purged = f.db.prepare('SELECT state,revision,title,body FROM private_cards WHERE id=?').get(pending.id);
      assert.deepEqual({ ...purged },{ state:'cancelled',revision:pending.revision+1,title:null,body:null });
      for (const table of ['card_bindings','card_memory_bindings','card_raw_bindings'])
        assert.equal(f.db.prepare(`SELECT count(*) n FROM ${table} WHERE card_id=?`).get(pending.id).n,0);
      assert.equal(effects(f,mixed.id).length,mixedEffects.length+1);
      assert.equal(effects(f,pending.id).length,pendingEffects.length+1);
      assert.deepEqual(effects(f,mixed.id).slice(0,mixedEffects.length),mixedEffects);
      assert.equal(ok(f.call('getCard',{ namespace: ns,cardId: receipt.id })).card,null);
      const receiptRetained = f.db.prepare('SELECT revision FROM private_cards WHERE id=?').get(receipt.id);
      const receiptDelta = removedAll ? 2 : 1;
      assert.equal(receiptRetained.revision,receiptConfirmed.revision+receiptDelta);
      assert.equal(effects(f,receipt.id).length,receiptEffects.length+receiptDelta);
      const separateRetained = ok(f.call('getCard',{ namespace: ns,cardId: separate.id })).card;
      assert.equal(f.db.prepare('SELECT revision FROM private_cards WHERE id=?').get(separate.id).revision,separateConfirmed.revision+(removedAll ? 1 : 0));
      if (removedAll) assert.equal(separateRetained,null);
      else assert.equal(separateRetained.support.status,'eligible');
      // MOC revision advances once per actually changed Card, including the
      // deliberately unchanged legacy receipt-only trigger behavior.
      assert.equal(f.db.prepare('SELECT revision FROM card_moc_epochs').get().revision-index,2+receiptDelta+(removedAll ? 1 : 0));
      denied(f.call('revalidateEvidence',{ namespace: ns,snapshot: evidence.snapshot }),'snapshot_stale');
      assert.deepEqual(f.db.prepare('SELECT * FROM card_operations ORDER BY action_id').all(),operations);
      if (deletion) {
        assert.deepEqual(ok(f.core.deleteConversation(deletion)),result);
        assert.equal(effects(f,mixed.id).length,mixedEffects.length+1);
      }
      f.reopen();
      assert.equal(ok(f.call('getCard',{ namespace: ns,cardId: mixed.id })).card,null);
      assert.equal(f.db.prepare('SELECT revision FROM private_cards WHERE id=?').get(mixed.id).revision,confirmed.revision+1);
      noPendingMutation(f.db);
    });
  }

  for (const failure of ['queue','work','flush','cleanup']) test(`P3c-08 ${client}: ${failure} rollback clears nested context before subsequent independent mutations`, async t => {
    const f = sourceFixture(t,{ model });
    const first = await savedSource(f,'Synthetic first retained source.',{ client,sessionId:'first' });
    const firstMemories = f.db.prepare('SELECT id,revision FROM memories WHERE deleted=0').all();
    const second = await savedSource(f,'Synthetic second retained source.',{ client,sessionId:'second' });
    const memories = f.db.prepare('SELECT id,revision FROM memories WHERE deleted=0').all();
    assert.equal(memories.length,4);
    const refs = await resolve(f,[anchor(first,0,8),anchor(first,4,12),anchor(second,0,8)]);
    const mixed = mixedDraft(f,memories,refs,'mixed'), confirmed = confirm(f,mixed,'confirm');
    const baselineEffects = effects(f,mixed.id);
    const deletion = { namespace: ns,conversationId:first.conversationId,expectedRevision:first.expectedConversationRevision,actionId:'delete-first' };
    const fault = { queue:'BEFORE INSERT ON card_raw_pending_invalidations',work:'BEFORE DELETE ON raw_conversations',
      flush:"BEFORE INSERT ON card_effects WHEN NEW.kind='evidence_invalidated'",cleanup:'BEFORE DELETE ON card_raw_mutation_context' }[failure];
    f.db.exec(`CREATE TRIGGER fail_mixed_effect ${fault} BEGIN SELECT RAISE(ABORT,'synthetic invalidation failure'); END;`);
    const before = snapshot(f.db);
    denied(f.core.deleteConversation(deletion),'storage_error');
    assert.deepEqual(snapshot(f.db),before);
    noPendingMutation(f.db);
    f.db.exec('DROP TRIGGER fail_mixed_effect');
    ok(f.core.deleteConversation(deletion));
    assert.equal(ok(f.call('getCard',{ namespace:ns,cardId:mixed.id })).card,null);
    assert.equal(f.db.prepare('SELECT revision FROM private_cards WHERE id=?').get(mixed.id).revision,confirmed.revision+1);
    assert.equal(f.db.prepare('SELECT count(*) n FROM memories WHERE deleted=1').get().n,firstMemories.length);
    ok(f.core.deleteConversation({ namespace:ns,conversationId:second.conversationId,expectedRevision:second.expectedConversationRevision,actionId:'delete-second' }));
    assert.equal(ok(f.call('getCard',{ namespace:ns,cardId:mixed.id })).card,null);
    assert.equal(f.db.prepare('SELECT revision FROM private_cards WHERE id=?').get(mixed.id).revision,confirmed.revision+2);
    assert.equal(effects(f,mixed.id).length,baselineEffects.length+2);
    assert.deepEqual(effects(f,mixed.id).slice(0,baselineEffects.length),baselineEffects);
    noPendingMutation(f.db);
  });

  test(`P3c-08 ${client}: receipt loss queues a Card whose Raw span is disjoint and preserves a foreign namespace`, async t => {
    const f = sourceFixture(t,{ model }), first = await savedSource(f,'Synthetic first retained source.',{ client,sessionId:'first' });
    const memories = f.db.prepare('SELECT id,revision FROM memories WHERE deleted=0').all();
    const other = await savedSource(f,'Synthetic independent retained source.',{ client,sessionId:'other' });
    const [ref] = await resolve(f,[anchor(other)]);
    const mixed = mixedDraft(f,memories,[ref],'mixed'), confirmed = confirm(f,mixed,'confirm');
    const foreign = { ...ns,scope:'project',projectId:'synthetic-other' };
    const foreignSource = await savedSource(f,'Synthetic foreign retained source.',{ client,sessionId:'foreign',namespace:foreign });
    const foreignRefs = ok(await f.call('resolveSourceReferences',{ namespace:foreign,anchors:[anchor(foreignSource)] })).sources;
    const foreignDraft = ok(f.call('createCardDraft',{ namespace:foreign,actionId:'foreign-draft',drafting:'authored',
      input:{ sources:foreignRefs,title:'Synthetic foreign title',body:'Synthetic foreign body.' } }));
    const foreignCard = ok(f.call('getCard',{ namespace:foreign,cardId:foreignDraft.id })).card;
    const beforeEffects = effects(f,mixed.id);
    ok(f.core.deleteConversation({ namespace:ns,conversationId:first.conversationId,expectedRevision:first.expectedConversationRevision,actionId:'delete-first' }));
    assert.equal(ok(f.call('getCard',{ namespace:ns,cardId:mixed.id })).card,null);
    assert.equal(f.db.prepare('SELECT revision FROM private_cards WHERE id=?').get(mixed.id).revision,confirmed.revision+1);
    assert.equal(effects(f,mixed.id).length,beforeEffects.length+1);
    assert.equal(ok(await f.call('getSource',{ namespace:ns,source:ref })).parts[0].text,other.text);
    assert.deepEqual(ok(f.call('getCard',{ namespace:foreign,cardId:foreignDraft.id })).card,foreignCard);
    noPendingMutation(f.db);
  });

  test(`P3c-08 ${client}: no-Raw receipt-only mutations retain independent revision/effect behavior`, async t => {
    const f = sourceFixture(t,{ model }), foreign = { ...ns,scope:'project',projectId:'retained-elsewhere' };
    await savedSource(f,'Synthetic retained elsewhere.',{ client,namespace:foreign });
    const memories = ['north','south'].map(direction => ok(f.core.admit({ namespace:ns,
      memory:{ content:'Synthetic ordinary '+direction,kind:'fact' },receipts:[{ client,sessionId:'ordinary',eventId:direction,
        role:'user',excerpt:'Synthetic ordinary '+direction }] })).memory);
    assert.equal(f.db.prepare('SELECT count(*) n FROM raw_conversations WHERE owner_id=? AND scope=? AND project_id=?').get(ns.ownerId,ns.scope,ns.projectId ?? '').n,0);
    const card = receiptDraft(f,memories,'ordinary'), confirmed = confirm(f,card,'confirm');
    const rawBefore = f.db.prepare('SELECT * FROM raw_conversations').all();
    for (const memory of memories) ok(f.core.forget({ namespace:ns,memoryId:memory.id,expectedRevision:memory.revision }));
    assert.equal(ok(f.call('getCard',{ namespace:ns,cardId:card.id })).card,null);
    assert.equal(f.db.prepare('SELECT revision FROM private_cards WHERE id=?').get(card.id).revision,confirmed.revision+2);
    assert.equal(effects(f,card.id).length,2);
    assert.deepEqual(f.db.prepare('SELECT * FROM raw_conversations').all(),rawBefore);
    noPendingMutation(f.db);
  });

  for (const count of [128,129]) test(`P3c-08/11 ${client}: aggregate ${count}-Card receipt-induced Raw invalidation boundary`, async t => {
    const f = sourceFixture(t,{ model }), source = await savedSource(f,'Synthetic deletion source.',{ client,sessionId:'deleted' });
    const memories = f.db.prepare('SELECT id,revision FROM memories WHERE deleted=0 ORDER BY id').all();
    const second = await savedSource(f,'Synthetic second source.',{ client,sessionId:'second' });
    const third = await savedSource(f,'Synthetic third source.',{ client,sessionId:'third' });
    const refs = await resolve(f,[anchor(second),anchor(third)]), cards = [];
    // Each Memory and each Raw conversation remains well under its own128
    // fanout. Only the union across the outer deletion reaches128/129.
    for (let index=0;index<count;index++) cards.push(mixedDraft(f,[memories[index % 2]],[refs[index % 2]],'card-'+index));
    const deletion = { namespace:ns,conversationId:source.conversationId,expectedRevision:source.expectedConversationRevision,actionId:'delete' };
    if (count===129) {
      const before = snapshot(f.db);
      denied(f.core.deleteConversation(deletion),'dependency_limit_reached');
      assert.deepEqual(snapshot(f.db),before); noPendingMutation(f.db);
      const last = cards.pop();
      ok(f.call('cancelCardDraft',{ namespace:ns,cardId:last.id,expectedRevision:last.revision,actionId:'cancel-extra' }));
    }
    const baseline = cards.map(card => effects(f,card.id));
    ok(f.core.deleteConversation(deletion));
    for (const [index,card] of cards.entries()) {
      const row = f.db.prepare('SELECT state,revision FROM private_cards WHERE id=?').get(card.id);
      assert.equal(row.state,'cancelled'); assert.equal(row.revision,card.revision+1);
      assert.equal(effects(f,card.id).length,baseline[index].length+1);
    }
    noPendingMutation(f.db);
  });

  test(`P3c-08/11 ${client}: direct Raw overlap union rejects129 and permits128 after rollback`, async t => {
    const f = sourceFixture(t,{ model:{ extract:() => ({ items:[{ content:'Synthetic shared interpretation.',kind:'fact',confidence:.8,sourceIndices:[0] }] }) } });
    let first = await savedSource(f,'Synthetic first source.',{ client,sessionId:'first' });
    const second = await savedSource(f,'Synthetic second source.',{ client,sessionId:'second' });
    first = { ...first,expectedConversationRevision:f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(first.conversationId).revision };
    const memories = f.db.prepare('SELECT id,revision FROM memories WHERE deleted=0').all();
    assert.equal(memories.length,1);
    assert.equal(f.db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(memories[0].id).n,2);
    const refs = await resolve(f,[anchor(first),anchor(second)]), cards = [];
    for (let index=0;index<129;index++) cards.push(ok(draft(f,[refs[index % 2]],'card-'+index)));
    const mutation = { namespace:ns,memoryId:memories[0].id,expectedRevision:memories[0].revision };
    const before = snapshot(f.db);
    denied(f.core.forget(mutation),'dependency_limit_reached');
    assert.deepEqual(snapshot(f.db),before); noPendingMutation(f.db);
    const extra = cards.pop();
    ok(f.call('cancelCardDraft',{ namespace:ns,cardId:extra.id,expectedRevision:extra.revision,actionId:'cancel-extra' }));
    ok(f.core.forget(mutation));
    for (const card of cards) {
      const row = f.db.prepare('SELECT state,revision FROM private_cards WHERE id=?').get(card.id);
      assert.equal(row.state,'cancelled'); assert.equal(row.revision,card.revision+1);
      assert.equal(effects(f,card.id).length,1);
    }
    noPendingMutation(f.db);
  });
}
