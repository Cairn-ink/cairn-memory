import assert from 'node:assert/strict';
import test from 'node:test';

test('the router weighs scripts and recognizes document markers and explicit requests', async () => {
  const { documentRoute } = await import('../document-card.mjs');
  assert.equal(documentRoute('assistant', '字'.repeat(267)), 'long_assistant');
  assert.equal(documentRoute('assistant', '字'.repeat(266)), null);
  assert.equal(documentRoute('user', '字'.repeat(534)), 'long_any');
  assert.equal(documentRoute('user', '字'.repeat(533)), null);
  const list = 'Materials\n1. Add washers\n2. Tighten bolts\n' + 'A'.repeat(174);
  assert.equal(documentRoute('user', list), 'structured:list');
  assert.equal(documentRoute('user', list.replaceAll('\n', ' ')), null);
  assert.equal(documentRoute('user', 'P'.repeat(210) + '\n| A | B |\n| C | D |'), 'structured:table');
  assert.equal(documentRoute('user', 'P'.repeat(210) + '\n```\nvalue\n```'), 'structured:code');
  assert.equal(documentRoute('user', 'Remember this wording. ' + 'P'.repeat(180)), 'explicit');
  assert.equal(documentRoute('assistant', 'Remember this wording. ' + 'P'.repeat(180)), null);
});

test('the card cap sorts explicit, assistant and other routes while counting uncut bodies', async () => {
  const { routeDocumentCards } = await import('../document-card.mjs');
  const ns = { ownerId: 'sample', scope: 'personal', projectId: null };
  const source = (id, content, role = 'user') => ({ id, content, role, occurredAt: '2024-01-01T00:00:00.000Z' });
  const doc = 'Notes\n- Add a washer\n- Tighten the bolt\n' + 'P'.repeat(190);
  const messages = [source('first', doc), source('oversize', 'Z'.repeat(4001)),
    source('assistant', doc, 'assistant'), source('second', doc),
    source('explicit', 'Remember this\n' + doc + 'P'.repeat(1600)),
    source('later-explicit', 'Remember that\n' + doc)];
  const route = values => routeDocumentCards(ns, 'client', 'session', values);
  const result = route(messages);
  assert.equal(result.droppedOversize, 1);
  assert.deepEqual(result.cards.map(card => card.source.messageId), ['explicit', 'later-explicit', 'assistant', 'first']);
  assert.equal(result.cards.at(-1).body, doc);
  assert.equal(route(messages).cards.at(-1).id, result.cards.at(-1).id);
  assert.equal(route([source('limit', 'Z'.repeat(4000))]).cards[0].body.length, 4000);
});
