import assert from 'node:assert/strict';
import { namespace, ok, call } from './card-support.mjs';

// Seed only the existing explicit Memory placement through the selected public
// core. All new Card organization/mapping operations use real stdio tools.
export async function organizeCard({ client, path, memory, card,
  coreModule = new URL('../../../core/contract.mjs', import.meta.url).href }) {
  const select = async intent => ok(await call(client, 'select_evidence', {
    query: 'review', types: ['memory', 'card'], intent }));
  const before = { current: await select('current'), history: await select('history') };
  const memoryMap = ok(await call(client, 'map_evidence', { type: 'memory' }));
  assert.equal(memoryMap.items.some(item => item.type === 'unfiled' && item.ref.memoryId === memory.id), true);
  const { openMemoryCore } = await import(coreModule);
  const core = openMemoryCore({ path });
  let memoryPlacement;
  let topicMemory;
  try {
    // An independent synthetic Memory topic avoids changing the interpretation
    // revision supporting this Card while testing Card-only filing.
    const admitted = ok(core.admit({ namespace, memory: { content: 'Synthetic organization topic', kind: 'fact' },
      receipts: [{ client: 'synthetic-organization', sessionId: 'topic', eventId: 'topic', role: 'user', excerpt: 'Synthetic organization topic' }] }));
    topicMemory = admitted.memory;
    memoryPlacement = ok(core.applyPlacement({ namespace, expectedIndexRevision: admitted.indexRevision,
      expectedMemoryRevisions: [{ memoryId: topicMemory.id, revision: topicMemory.revision }], proposal: { items: [{
        memoryId: topicMemory.id, parentIds: [], newL1: { title: 'Review sources', parentL2Ids: [], newL2Title: 'Memory review' },
      }] } }));
  } finally { core.close(); }
  const initial = ok(await call(client, 'map_evidence', { type: 'card' }));
  assert.equal(initial.items.some(item => item.type === 'unfiled' && item.ref.cardId === card.id), true);
  const ref = { type: 'card', cardId: card.id, revision: card.revision, bodyRevision: card.bodyRevision };
  const input = { actionId: 'explicit-card-placement', expectedIndexRevision: initial.indexRevision, refs: [ref],
    proposal: { items: [{ cardId: card.id, parentIds: [],
      newL1: { title: 'Review plans', parentL2Ids: [], newL2Title: 'Card review' } }] } };
  assert.equal((await call(client, 'apply_card_placement', { ...input, refs: [{ ...ref, revision: ref.revision + 99 }] })).error.code,
    'revision_conflict');
  for (const extra of [{ namespace }, { authority: { actionClass: 'organization' } }, { humanConfirmed: true }]) {
    assert.equal((await client.callTool({ name: 'apply_card_placement', arguments: { ...input, ...extra } })).isError, true);
  }
  assert.equal((await client.callTool({ name: 'apply_card_placement', arguments: { ...input, refs: [{ ...ref, namespace }] } })).isError, true);
  const placed = ok(await call(client, 'apply_card_placement', input));
  assert.deepEqual(ok(await call(client, 'apply_card_placement', input)), placed, 'exact organization replay is inert');
  assert.equal(JSON.stringify(placed).includes(card.body), false);
  assert.deepEqual(ok(await call(client, 'inspect_private_card', { cardId: card.id })).card, card,
    'organization preserves canonical Card body, revision and applicability review');
  const mappedCard = ok(await call(client, 'map_evidence', { type: 'card' }));
  const mappedMemory = ok(await call(client, 'map_evidence', { type: 'memory' }));
  assert.equal(mappedCard.items.some(item => item.type === 'ref' && item.ref.childType === 'card' && item.ref.childId === card.id), true);
  assert.equal(mappedMemory.items.some(item => item.type === 'ref' && item.ref.childType === 'memory' && item.ref.childId === topicMemory.id), true);
  assert.equal(JSON.stringify(mappedMemory).includes(card.id), false);
  assert.equal(JSON.stringify(mappedCard).includes(card.body), false);
  for (const intent of ['current', 'history']) {
    const after = await select(intent);
    assert.deepEqual(after.items.map(item => item.ref), before[intent].items.map(item => item.ref),
      `${intent} evidence refs do not depend on filing`);
  }
  const memoryTopic = memoryPlacement.createdMocs.find(topic => topic.level === 'L1');
  const cardTopic = placed.createdMocRefs.find(topic => topic.level === 'L1');
  const root = placed.createdMocRefs.find(topic => topic.level === 'L2');
  const children = ok(await call(client, 'map_evidence', { type: 'card', purpose: 'classification',
    parentRef: { mocId: root.mocId, revision: root.revision } }));
  assert.equal(children.items.some(item => item.type === 'topic' && item.topic.id === cardTopic.mocId), true);
  const endpoints = { memoryTopic: { mocId: memoryTopic.id, revision: memoryTopic.revision },
    cardTopic: { mocId: cardTopic.mocId, revision: cardTopic.revision },
    expectedMemoryIndexRevision: mappedMemory.indexRevision, expectedCardIndexRevision: mappedCard.indexRevision };
  const proposal = { actionId: 'propose-navigation-only', ...endpoints };
  assert.equal((await client.callTool({ name: 'propose_evidence_mapping', arguments: { ...proposal, state: 'active' } })).isError, true);
  const proposed = ok(await call(client, 'propose_evidence_mapping', proposal));
  assert.equal(proposed.state, 'proposed');
  const listed = ok(await call(client, 'list_evidence_mappings', { type: 'card', mocId: cardTopic.mocId, limit: 1 }));
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0].state, 'proposed');
  assert.equal(listed.items[0].navigable, false);
  assert.equal(listed.items[0].meaning, 'navigation-only');
  const tools = (await client.listTools()).tools;
  assert.equal(tools.some(tool => /review.*mapping|activate.*mapping|remove.*mapping/.test(tool.name)), false);
  return { endpoints, proposed, cardTopic, memoryTopic };
}
