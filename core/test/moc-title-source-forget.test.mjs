import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { openMemoryCore } from '../index.mjs';
import { lineageFixture, lineageHost, ns, ok, receipt } from '../testing/card-lineage-fixture.mjs';
import { host as contextHost } from '../testing/context-read-core-fixture.mjs';
import { localPlainPort } from '../testing/raw-capture-fixtures.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const title = 'Glass observatory';

async function fixture(t, layout) {
  const trusted = contextHost();
  const options = { decisionReview: 'required-v1', model: { countTokens: () => 1 }, contextRead: {
    version: 'context-read-v1', authority: trusted.authority, sources: ['moc-v1'],
    counter: { id: 'constant', countTokens: () => 1 },
  } };
  let f;
  if (layout === 53) {
    f = await lineageFixture(t, { base: 33, options });
  } else {
    const workspace = createTestWorkspace(t);
    const path = join(workspace.path, 'store.sqlite');
    const host = lineageHost();
    const core = openMemoryCore({ path, ...options, privateCards: host.options,
      rawConversations: { mode: 'raw-v1', port: localPlainPort(), capBytes: 1_000_000,
        readPolicy: () => ({ generation: 'current', reason: null }) } });
    const db = new DatabaseSync(path);
    workspace.defer(() => { core.close(); db.close(); });
    f = { core, db, call: (method, input) => host.call(core, method, input) };
  }
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, layout);
  return { ...f, async context(type) {
    const projection = { readSet: [ns], types: [type], intent: 'current' };
    const value = ok(await trusted.call(f.core, 'contextRead', { ...projection, query: 'dome', deadlineMs: 5000 }));
    return value.metered.items.map(item => item.ref.id);
  } };
}

function admit(core, content) {
  return ok(core.admit({ namespace: ns, memory: { content, kind: 'fact' }, receipts: [receipt(content)] })).memory;
}

function place(core, entries) {
  return ok(core.applyPlacement({ namespace: ns,
    expectedIndexRevision: ok(core.map({ namespace: ns })).indexRevision,
    expectedMemoryRevisions: entries.map(([memory]) => ({ memoryId: memory.id, revision: memory.revision })),
    proposal: { items: entries.map(([memory, placement]) => ({ memoryId: memory.id, ...placement })) },
  }));
}

function memoryTopic(core) {
  const first = admit(core, title);
  const last = admit(core, 'The caretaker opens the dome');
  const member = admit(core, 'The caretaker locks the dome');
  const created = place(core, [first, last].map(memory => [memory, { parentIds: [],
    newL1: { title, parentL2Ids: [] } }]));
  const [topic] = created.createdMocs;
  const [a, c] = created.memories;
  const [b] = place(core, [[member, { parentIds: [topic.id] }]]).memories;
  return { a, b, c, topic };
}

function forget(core, memory) {
  return ok(core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
}

function retireMemory(core, db, action, memory) {
  const input = { namespace: ns, memoryId: memory.id, expectedRevision: memory.revision };
  const content = 'The observatory has moved';
  switch (action) {
    case 'forget':
      assert.equal(forget(core, memory).forgotten, true);
      break;
    case 'correct':
      assert.equal(ok(core.correct({ ...input, content, kind: 'fact', receipt: receipt('correction') })).memory.content, content);
      break;
    case 'supersede':
      assert.equal(ok(core.supersede({ ...input, replacement: { content, kind: 'fact' }, receipts: [receipt('replacement')] })).previous.id, memory.id);
      break;
    case 'reject':
      // An older title binding can survive when its source is held for review.
      // Placement refuses awaiting sources, so seed that stored state directly.
      db.prepare("UPDATE memories SET review_state='awaiting' WHERE id=?").run(memory.id);
      assert.equal(ok(core.reject({ ...input, actionId: 'reject-source' })).forgotten, true);
      break;
  }
}

for (const layout of [53, 29]) {
  for (const action of ['forget', 'correct', 'supersede', 'reject', 'keep']) {
    test(`${action} a title source before forgetting another member on layout ${layout}`, async t => {
      const { core, db, context } = await fixture(t, layout);
      const { a, b, c, topic } = memoryTopic(core);
      const get = memory => core.get({ namespace: ns, memoryId: memory.id });
      assert.equal(ok(get(c)).placements[0].title, title);
      assert.ok((await context('memory')).includes(b.id));
      const expectedTitle = action === 'keep' ? title : null;
      if (action !== 'keep') retireMemory(core, db, action, a);
      assert.equal(ok(get(c)).placements[0].title, expectedTitle);

      assert.equal(forget(core, b).forgotten, true);
      assert.equal(get(b).error.code, 'memory_not_found');
      const listed = ok(core.list({ namespace: ns })).memories.map(memory => memory.id);
      assert.ok(listed.includes(c.id));
      assert.ok(!listed.includes(b.id));
      assert.deepEqual(await context('memory'), [c.id]);
      assert.equal(ok(get(c)).placements[0].title, expectedTitle);
      const map = ok(core.map({ namespace: ns })).items.find(item => item.moc?.id === topic.id);
      assert.equal(map.moc.title, expectedTitle);
      const sources = db.prepare('SELECT memory_id FROM moc_title_sources WHERE moc_id=? ORDER BY memory_id').all(topic.id);
      assert.deepEqual(sources.map(row => row.memory_id), action === 'keep' ? [a.id, c.id].sort() : [c.id]);
      if (layout === 53 && action !== 'keep') {
        const row = db.prepare('SELECT title,canonical_title FROM mocs WHERE id=?').get(topic.id);
        assert.equal(row.title, '');
        assert.notEqual(row.canonical_title, title.toLowerCase());
      }
    });
  }

  test(`delete a Card title source and then another member on layout ${layout}`, async t => {
    const { call, context, db } = await fixture(t, layout);
    const map = () => ok(call('mapEvidence', { type: 'card' }));
    const card = (name, body) => {
      const draft = ok(call('createCardDraft', { actionId: `draft-${name}`, drafting: 'authored',
        input: { title: name, body, authoredInput: { text: body, occurredAt: null } } }));
      const saved = ok(call('confirmCardDraft', { actionId: `confirm-${name}`, cardId: draft.id,
        expectedRevision: draft.revision, applicability: 'current' }));
      return { type: 'card', namespace: ns, cardId: saved.id, revision: saved.revision, bodyRevision: saved.bodyRevision };
    };
    const a = card(title, 'Visitors arrive on weekends');
    const b = card('Closing', 'The caretaker locks the dome');
    const c = card('Opening', 'The caretaker opens the dome');
    const place = (actionId, refs, placement) => ok(call('applyCardPlacement', { actionId, refs,
      expectedIndexRevision: map().indexRevision,
      proposal: { items: refs.map(ref => ({ cardId: ref.cardId, ...placement })) } }));
    const { mocId } = place('create-topic', [a, c], { parentIds: [], newL1: { title, parentL2Ids: [] } }).createdMocRefs[0];
    place('place-member', [b], { parentIds: [mocId] });
    const topic = () => map().items.find(item => item.topic?.id === mocId).topic;
    assert.equal(topic().title, title);
    assert.ok((await context('card')).includes(b.cardId));
    for (const ref of [a, b]) assert.equal(ok(call('deleteKnowledgeCard', { actionId: `delete-${ref.cardId}`,
      cardId: ref.cardId, expectedRevision: ref.revision })).state, 'deleted');
    assert.equal(ok(call('getCard', { cardId: b.cardId })).card, null);
    assert.deepEqual(ok(call('listCards', { states: ['confirmed'] })).cards.map(row => row.id), [c.cardId]);
    assert.deepEqual(await context('card'), [c.cardId]);
    assert.equal(topic().title, null);
    const sources = db.prepare('SELECT card_id FROM card_moc_title_sources WHERE moc_id=?').all(mocId);
    assert.deepEqual(sources.map(row => row.card_id), [c.cardId]);
  });
}

test('a retained binding to an already forgotten source does not block another member', async t => {
  const { core, db } = await fixture(t, 53);
  const { a, b, c, topic } = memoryTopic(core);
  assert.equal(forget(core, a).forgotten, true);
  db.prepare('INSERT OR IGNORE INTO moc_title_sources VALUES (?,?,?)').run(topic.id, a.id, a.revision);
  assert.equal(forget(core, b).forgotten, true);
  assert.equal(ok(core.get({ namespace: ns, memoryId: c.id })).placements[0].title, null);
});

test('a live title source with a read denial still blocks a member write', async t => {
  const { core, db } = await fixture(t, 53);
  const { b, c } = memoryTopic(core);
  // Isolate title validation from validation of changed membership rows.
  db.prepare('DELETE FROM moc_memory_refs WHERE memory_id=?').run(c.id);
  transaction(db, () => writeContentSuppressionInside(db, { namespace: ns, kind: 'memory', key: c.id,
    reason: 'privacy_erase', actionId: 'deny-live-source' }));
  const result = core.forget({ namespace: ns, memoryId: b.id, expectedRevision: b.revision });
  assert.equal(result.error.code, 'evidence_unavailable');
  assert.equal(ok(core.get({ namespace: ns, memoryId: b.id })).memory.id, b.id);
});
