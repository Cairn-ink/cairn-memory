import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { transaction } from '../database.mjs';
import { withContentWriteOperation } from '../content-write-context.mjs';
import { createEngineCardStorage } from '../engine-card-storage.mjs';
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
  const contextQuery = async (method, type, query) => ok(await trusted.call(f.core, method, {
    readSet: [ns], types: [type], intent: 'current', query, semantic: false, deadlineMs: 5000,
  }));
  return { ...f, contextQuery, async context(type) {
    const value = await contextQuery('contextRead', type, 'dome');
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
    });
  }

  test(`delete a Card title source and then another member on layout ${layout}`, async t => {
    const { call, context } = await fixture(t, layout);
    const map = () => ok(call('mapEvidence', { type: 'card' }));
    const a = authoredCard(call, title, 'Visitors arrive on weekends');
    const b = authoredCard(call, 'Closing', 'The caretaker locks the dome');
    const c = authoredCard(call, 'Opening', 'The caretaker opens the dome');
    const { mocId } = placeCards(call, 'create-topic', [a, c], newTopic(title)).createdMocRefs[0];
    placeCards(call, 'place-member', [b], { parentIds: [mocId] });
    const topic = () => map().items.find(item => item.topic?.id === mocId).topic;
    assert.equal(topic().title, title);
    assert.ok((await context('card')).includes(b.cardId));
    for (const ref of [a, b]) {
      assert.equal(ok(call('deleteKnowledgeCard', { actionId: `delete-${ref.cardId}`,
        cardId: ref.cardId, expectedRevision: ref.revision })).state, 'deleted');
      assert.equal(topic().title, null);
    }
    assert.equal(ok(call('getCard', { cardId: b.cardId })).card, null);
    assert.deepEqual(ok(call('listCards', { states: ['confirmed'] })).cards.map(row => row.id), [c.cardId]);
    assert.deepEqual(await context('card'), [c.cardId]);
  });
}

test('a retained binding to an already forgotten source does not block another member', async t => {
  const { core, db } = await fixture(t, 53);
  const { a, b, c, topic } = memoryTopic(core);
  assert.equal(forget(core, a).forgotten, true);
  assert.ok(db.prepare('SELECT 1 FROM moc_title_sources WHERE moc_id=? AND memory_id=?').get(topic.id, a.id));
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

for (const layout of [29, 53]) {
  test(`one forget removes a title from BM25 ranking and corpus statistics on layout ${layout}`, async t => {
    const { core, contextQuery } = await fixture(t, layout);
    const { a, b } = memoryTopic(core);
    const [control] = place(core, [[admit(core, 'Record the paper inventory'), newTopic('Glass library archive')]]).memories;
    const find = async () => {
      const result = await contextQuery('findCandidates', 'memory', title);
      assert.equal(result.trace.sources['moc-v1'].status, 'ok');
      return result.items.flatMap(item => item.channels.moc ? [[item.ref.memoryId, item.channels.moc.rawScore]] : []);
    };
    const before = await find();
    assert.ok(before.some(([id]) => id === b.id));
    const beforeScore = Math.log(1.2) * 2.2 / (1 + 1.2 * (0.25 + 0.75 * 3 / 2.5));
    assert.ok(before.some(([id, score]) => id === control.id && Math.abs(score - beforeScore) < 1e-15));

    assert.equal(forget(core, a).forgotten, true);

    assert.deepEqual(await find(), [[control.id, Math.log(4 / 3)]]);
    const assembled = await contextQuery('contextRead', 'memory', title);
    assert.deepEqual(assembled.metered.items.map(item => item.ref.id), [control.id]);
  });
}

test('forget purges an engine Card even when another title source has lost its note', async t => {
  const f = await fixture(t, 53);
  const { core, call, db, identity } = f;
  const memory = admit(core, 'The photographer arrives at dawn');
  const storage = createEngineCardStorage({ db, identity, ready() {} });
  const memories = storage.snapshot(ns, 512, () => {}).memories;
  assert.deepEqual(memories.map(row => row.id), [memory.id]);
  const engine = withContentWriteOperation('maintainCards', [ns], () =>
    storage.commit(ns, { key: 'field-report', memories }, { body: 'A field report.' }, new Date().toISOString(), () => {}));
  const note = f.note('archive-note');
  const other = authoredCard(call, 'Archive', 'Record the paper inventory', [note]);
  const { mocId } = placeCards(call, 'place', [cardRef(engine), other], newTopic(title)).createdMocRefs[0];

  ok(call('deleteSourceNote', { actionId: 'delete-note', sourceId: note.sourceId, expectedRevision: note.revision }));
  assert.equal(f.row(other.cardId).state, 'confirmed');
  assert.equal(ok(call('getCard', { cardId: other.cardId })).card, null);

  assert.equal(forget(core, memory).forgotten, true);
  assert.equal(core.get({ namespace: ns, memoryId: memory.id }).error.code, 'memory_not_found');
  assert.equal(f.row(engine.id).state, 'deleted');
  assert.equal(f.row(other.cardId).state, 'confirmed');
  assert.equal(db.prepare('SELECT revision FROM card_mocs WHERE id=?').get(mocId).revision, 1);
});

test('refiling a corrected title source advances its former topic revision on layout 29', async t => {
  const { core } = await fixture(t, 29);
  const { a, c, topic } = memoryTopic(core);
  const get = memory => ok(core.get({ namespace: ns, memoryId: memory.id }));
  const saved = ok(core.correct({ namespace: ns, memoryId: a.id, expectedRevision: a.revision,
    kind: 'fact', content: 'The photographer arrives at dusk', receipt: receipt('correction') })).memory;
  const previous = get(c).placements[0];
  assert.deepEqual(previous, { mocId: topic.id, mocRevision: topic.revision + 2, title: null });

  const placed = place(core, [[saved, newTopic('Glass library')]]);
  const current = get(c).placements[0];
  assert.deepEqual(current, { ...previous, mocRevision: previous.mocRevision + 1 });
  const mapped = ok(core.map({ namespace: ns })).items.filter(item => item.moc).map(item => item.moc);
  assert.deepEqual(mapped.map(row => [row.id, row.title, row.revision]), [
    [topic.id, null, current.mocRevision], [placed.createdMocs[0].id, 'Glass library', 1],
  ]);
});

function newTopic(title) {
  return { parentIds: [], newL1: { title, parentL2Ids: [] } };
}

function cardRef(saved) {
  return { type: 'card', namespace: ns, cardId: saved.id, revision: saved.revision, bodyRevision: saved.bodyRevision ?? 1 };
}

function authoredCard(call, name, body, sources) {
  const draft = ok(call('createCardDraft', { actionId: `draft-${name}`, drafting: 'authored',
    input: { title: name, body, ...(sources ? { sources } : { authoredInput: { text: body, occurredAt: null } }) } }));
  return cardRef(ok(call('confirmCardDraft', { actionId: `confirm-${name}`, cardId: draft.id,
    expectedRevision: draft.revision, applicability: 'current' })));
}

function placeCards(call, actionId, refs, placement) {
  return ok(call('applyCardPlacement', { actionId, refs,
    expectedIndexRevision: ok(call('mapEvidence', { type: 'card' })).indexRevision,
    proposal: { items: refs.map(ref => ({ cardId: ref.cardId, ...placement })) } }));
}
