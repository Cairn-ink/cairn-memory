import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { ok } from '../testing/context-read-core-fixture.mjs';

const ns = { ownerId: 'sample', scope: 'personal', projectId: null };
const body = 'Ｆixture assembly  \r\n  1. Sort brass washers.   \r\n  2. Tighten each bolt.\r\n  password=sampleSecret987\r\n' + 'Repeat after inspection. '.repeat(9);
const content = 'The fixture uses brass washers.';
const replacement = 'The fixture uses steel washers.';
const occurredAt = '2024-02-03T04:05:00.000Z';
const receipt = { client: 'sample', sessionId: 'session', eventId: 'revised', role: 'user', excerpt: replacement };
const item = (text = content, kind = 'fact') => ({ content: text, kind, confidence: .9, sourceIndices: [0] });

async function fixture(t, options = {}, model = {}, observePut) {
  const { createInMemoryDocumentCardPort } = await import('../document-card.mjs');
  const cardPort = createInMemoryDocumentCardPort();
  const workspace = createTestWorkspace(t);
  const path = workspace.path + '/store.sqlite';
  const storage = observePut ? { ...cardPort, put(namespace, card) {
    observePut(path, card);
    return cardPort.put(namespace, card);
  } } : cardPort;
  const core = openMemoryCore({ path, cardPort: storage, model: { contextWindow: 8192, countTokens: () => 1,
    extract: () => ({ items: [item()] }), ...model }, ...options });
  workspace.defer(() => core.close());
  const capture = (patch = {}) => core.capture({ namespace: ns, client: 'sample', sessionId: 'session', eventId: 'capture',
    messages: [{ id: 'document', role: 'user', content: body, occurredAt },
      { id: 'other', role: 'user', content: 'An unrelated source.' }], ...patch }).then(ok);
  const current = memoryId => ok(core.get({ namespace: ns, memoryId })).memory;
  const only = () => { const cards = cardPort.list(ns); assert.equal(cards.length, 1); return cards[0]; };
  return { core, cardPort, capture, current, only };
}

test('admission stores only matching receipts and keeps redacted line structure', async t => {
  let request, committed;
  const { core, cardPort, capture, only } = await fixture(t, {}, {
    extract: ({ input }) => { request = input; return { items: [item(), { ...item('Other assertion.'), sourceIndices: [1] }] }; },
  }, (path, card) => {
    const reader = new DatabaseSync(path, { readOnly: true });
    try {
      const row = reader.prepare('SELECT state,memory_ids FROM admission_claims WHERE event_id=?').get('capture');
      committed = { state: row?.state, admitted: JSON.parse(row?.memory_ids ?? '[]'), linked: card.sourceMemoryIds };
    } finally { reader.close(); }
  });
  const result = await capture();
  const card = only();
  assert.deepEqual(committed, { state: 'completed', admitted: result.admission.memories.map(memory => memory.id),
    linked: [result.admission.memories[0].id] });
  assert.deepEqual(card.sourceMemoryIds, [result.admission.memories[0].id]);
  assert.deepEqual(card.source, { client: 'sample', sessionId: 'session', messageId: 'document', role: 'user' });
  assert.equal(card.date, occurredAt);
  assert.equal(card.title, 'Fixture assembly');
  assert.match(card.body, /^Fixture assembly\n  1\. Sort brass washers\.\n  2\. Tighten each bolt\.\n  password=\[REDACTED\]/);
  assert.match(request.messages[0].content, /^Fixture assembly 1\. Sort brass washers\. 2\. Tighten each bolt\. password=\[REDACTED\]/);
  assert.equal((await capture()).duplicate, true);
  assert.equal(cardPort.list(ns).length, 1);
  const id = card.sourceMemoryIds[0];
  ok(core.forget({ namespace: ns, memoryId: id, expectedRevision: ok(core.get({ namespace: ns, memoryId: id })).memory.revision }));
  assert.deepEqual(cardPort.list(ns), []);
  assert.equal(cardPort.get(ns, card.id), undefined);
});

test('oversize is counted after preserving layout and explicit forgetting prevents a replay', async t => {
  const { core, cardPort, capture, only } = await fixture(t, {}, { extract: () => ({ items: [] }) });
  const result = await capture({ messages: [{ id: 'document', role: 'user', content: body },
    { id: 'large', role: 'assistant', content: 'Indented\n' + ' '.repeat(4000) + 'end' }] });
  assert.equal(result.documentCards.droppedOversize, 1);
  const card = only();
  assert.deepEqual(card.sourceMemoryIds, []);
  ok(core.forgetCard({ namespace: ns, cardId: card.id }));
  await capture({ eventId: 'new-capture', messages: [{ id: 'document', role: 'user', content: body }] });
  assert.deepEqual(cardPort.list(ns), []);
});

for (const change of ['correct', 'supersede', 'ordered', 'confirmed']) test(change + ' marks the original card stale', async t => {
  const ordered = ['ordered', 'confirmed'].includes(change);
  let next = false;
  const { core, capture, current, only } = await fixture(t,
    change === 'confirmed' ? { decisionReview: 'required-v1' } : {}, {
      extract: () => ({ items: [next ? item(replacement, change === 'confirmed' ? 'decision' : 'fact') : item()] }),
      reconcile: () => ({ transitions: [{ replacementIndex: 0, predecessorIndex: 0, evidenceIndices: [0],
        relation: 'supersedes', valueChange: 'changed', adoption: 'explicit' }] }),
    });
  const first = (await capture(ordered ? { causal: { streamId: 'stream', sequence: 1 } } : {})).admission.memories[0];
  const guard = { namespace: ns, memoryId: first.id, expectedRevision: current(first.id).revision };
  let id = first.id;
  if (change === 'correct') ok(core.correct({ ...guard, content: replacement, kind: 'fact', receipt }));
  else if (change === 'supersede') id = ok(core.supersede({ ...guard, replacement: { content: replacement, kind: 'fact' }, receipts: [receipt] })).memory.id;
  else {
    next = true;
    const revised = await capture({ eventId: 'new', causal: { streamId: 'stream', sequence: 2 },
      messages: [{ id: 'change', role: 'user', content: replacement }] });
    id = revised.admission.memories[0].id;
    if (change === 'confirmed') {
      assert.equal(only().stale, undefined);
      ok(core.confirm({ namespace: ns, memoryId: id, expectedRevision: revised.admission.memories[0].revision, actionId: 'confirm', receipt }));
    }
  }
  const card = only();
  assert.equal(card.stale[0].memoryId, first.id);
  assert.equal(card.stale[0].replacement.memoryId, id);
  assert.equal(card.stale[0].replacement.content, replacement);
  assert.ok(Number.isFinite(Date.parse(card.stale[0].replacement.date)));
  assert.match(card.body, /brass washers/);
});

test('rejecting an awaiting memory hides its source card', async t => {
  const { core, cardPort, capture } = await fixture(t, { decisionReview: 'required-v1' },
    { extract: () => ({ items: [item('We decided to use brass washers.', 'decision')] }) });
  const { id, revision } = (await capture()).admission.memories[0];
  assert.equal(cardPort.list(ns).length, 1);
  ok(core.reject({ namespace: ns, memoryId: id, expectedRevision: revision, actionId: 'reject' }));
  assert.deepEqual(cardPort.list(ns), []);
});

for (const action of ['fence', 'delete']) test('a Raw ' + action + ' hides a card without memory receipts', async t => {
  const { core, cardPort, capture, only } = await fixture(t, { raw: true, rawSearch: false }, { extract: () => ({ items: [] }) });
  await capture({ client: 'codex', messages: [{ id: 'document', role: 'user', content: body, occurredAt }] });
  const card = only();
  assert.match(card.body, /\n  1\./);
  if (action === 'fence') ok(await core.fenceSession({ namespace: ns, client: 'codex', sessionId: 'session' }));
  else {
    const { conversations: [raw] } = ok(core.listRawConversations({ namespace: ns, client: 'codex' }));
    ok(await core.deleteConversation({ namespace: ns, conversationId: raw.id, expectedRevision: raw.revision, actionId: 'delete' }));
  }
  assert.equal(cardPort.get(ns, card.id), undefined);
});

for (const method of ['transitionQualified', 'transitionQualifiedSet']) test(method + ' marks every linked predecessor stale', async t => {
  const { routeDocumentCards } = await import('../document-card.mjs');
  const { core, cardPort, current, only } = await fixture(t);
  const admit = (value, label) => {
    const text = 'The fixture calls for ' + value + ' washers. Source ' + label + '.';
    const qualification = { version: 1,
      slot: { subject: 'fixture', property: 'washer material', scope: 'assembly', applies: 'current fixture' },
      value, attribution: 'direct', commitment: 'adopted',
      anchors: [{ receiptIndex: 0, start: 0, end: text.length, text,
        fields: ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'] }],
    };
    return ok(core.admit({ namespace: ns, memory: { content: text, kind: 'fact' },
      receipts: [{ ...receipt, eventId: label, excerpt: text }], qualification })).memory;
  };
  const previous = [admit('brass', 'first')];
  if (method === 'transitionQualifiedSet') previous.push(admit('brass', 'second'));
  const next = admit('steel', 'next');
  const ref = ({ id: memoryId, revision: expectedRevision }) => ({ memoryId, expectedRevision });
  const bind = (memory, slotId) => ok(core.bindQualifiedClaim({ namespace: ns, ...ref(memory), singleClaim: true, slotId })).slotId;
  const slot = bind(next, null);
  for (const memory of previous) bind(memory, slot);
  const { cards: [card] } = routeDocumentCards(ns, 'sample', 'session', [{ id: 'document', role: 'user', content: body }]);
  cardPort.put(ns, { ...card, sourceMemoryIds: previous.map(memory => memory.id) });
  const request = method === 'transitionQualified' ? { predecessor: ref(previous[0]) } : { predecessors: previous.map(ref) };
  const result = ok(core[method]({ namespace: ns, replacement: ref(next), ...request }));
  assert.equal(result.status, 'applied');
  assert.deepEqual(new Set(only().stale.map(entry => entry.memoryId)), new Set(previous.map(memory => memory.id)));
  const replacement = current(next.id);
  for (const { replacement: entry } of only().stale) assert.deepEqual(entry, {
    memoryId: next.id, revision: next.revision, date: replacement.updatedAt, content: replacement.content,
  });
});

test('deleting Raw evidence hides only the card from the removed source', async t => {
  const { splitRaw } = await import('../testing/raw-fixtures.mjs');
  const { core, cardPort, only } = await fixture(t, { raw: true, rawSearch: false });
  const rawCapture = async sessionId => ok(await core.captureRaw({ namespace: ns, client: 'codex', sessionId,
    eventId: sessionId, messages: splitRaw(body, { id: 'document', occurredAt }) }));
  const { raw } = await rawCapture('first');
  const first = only();
  await rawCapture('second');
  const second = cardPort.list(ns).find(card => card.id !== first.id);
  const [memoryId] = first.sourceMemoryIds;
  assert.deepEqual(second.sourceMemoryIds, [memoryId]);
  const conversation = ok(core.listRawConversations({ namespace: ns, client: 'codex' })).conversations
    .find(value => value.id === raw.conversationId);
  const outcome = ok(await core.deleteConversation({ namespace: ns, conversationId: conversation.id,
    expectedRevision: conversation.revision, actionId: 'delete' }));
  assert.equal(outcome.removedReceipts, 1);
  assert.equal(only().id, second.id);
  assert.equal(ok(core.get({ namespace: ns, memoryId })).receipts.length, 1);
});

for (const raw of [false, true]) test('forgetting an empty source episode hides its card with Raw ' + raw, async t => {
  const { interpretation } = await import('../testing/episode-capture-helpers.mjs');
  const workspace = createTestWorkspace(t);
  const path = workspace.path + '/store.sqlite';
  const { createInMemoryDocumentCardPort } = await import('../document-card.mjs');
  const cardPort = createInMemoryDocumentCardPort();
  const model = { contextWindow: 8192, countTokens: () => 1, extract: () => ({ items: [] }), interpretEpisode: interpretation };
  const capture = openMemoryCore({ path, cardPort, model, captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1',
    sessionEpisodes: { mode: 'episode-v1', draftEveryBatches: 2 } });
  workspace.defer(() => capture.close());
  const captured = ok(await capture.capture({ namespace: ns, client: 'codex', sessionId: 'session', eventId: 'capture',
    messages: [{ id: 'document', role: 'user', content: body, occurredAt }],
    episodeContext: { clientLabel: 'Sample', generation: 'initial', origin: 'ordinary' } }));
  const [card] = cardPort.list(ns);
  assert.deepEqual(card.sourceMemoryIds, []);
  const selected = raw ? openMemoryCore({ path, cardPort, raw: true, rawSearch: false }) : capture;
  if (raw) workspace.defer(() => selected.close());
  const episode = ok(selected.getEpisode({ namespace: ns, episodeId: captured.episode.id })).episode;
  ok(await selected.forgetEpisode({ namespace: ns, episodeId: episode.id, expectedRevision: episode.revision }));
  assert.equal(cardPort.get(ns, card.id), undefined);
});
