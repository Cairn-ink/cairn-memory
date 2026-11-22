import test from 'node:test';
import assert from 'node:assert/strict';
import { extractedItems } from '../capture-input.mjs';
import { extractionRequest } from '../capture.mjs';
import { createOpenAIModel } from '../../adapters/openai/index.mjs';

const snapshot = { client: 'fixture', sessionId: 'session', ledger: true,
  messages: [{ id: 'message', role: 'user', content: 'I spent 6 on tea.' }] };
const item = { content: snapshot.messages[0].content, kind: 'fact', confidence: 0.9, sourceIndices: [0] };
const record = { item: 0, kind: 'record', measure: 'spend', value: 6, unit: 'USD', group: 'food',
  category: 'tea', period: 'none', comparator: 'none' };
const goal = { ...record, kind: 'goal', period: 'week', comparator: 'at_most' };

test('valid quantities bind to their original item and invalid entries are counted individually', () => {
  const bad = [{ item: 1 }, { value: Infinity }, { kind: 'goal' }, { kind: 'goal', period: 'day' },
    { kind: 'goal', comparator: 'at_least' }, { period: 'day' }, { comparator: 'at_least' },
    { unit: 1 }, { group: 'invalid' }, { surprise: true }, { item: -1 }, { item: 0.5 }];
  const drops = [];
  const [candidate] = extractedItems({ items: [item], quantities: [record, goal, ...bad.map(patch => ({ ...record, ...patch }))] },
    snapshot, undefined, reason => drops.push(reason));
  assert.deepEqual(candidate.quantities, [record, goal]);
  assert.deepEqual(drops, bad.map(() => 'invalid_extraction_quantity'));
  for (const output of [{ items: [item] }, { items: [item], quantities: [] }])
    assert.equal(extractedItems(output, snapshot)[0].quantities, undefined);
});

test('configured extraction adds a strict top-level list and validates its entries independently', async () => {
  const bodies = [], drops = [];
  const adapter = createOpenAIModel({ apiKey: 'synthetic-key', onDiagnostic: event => drops.push(event.reason),
    fetchImpl: async (url, init) => {
      bodies.push(JSON.parse(init.body));
      if (String(url).endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 10 });
      return Response.json({ object: 'response', status: 'completed', model: bodies.at(-1).model, error: null, incomplete_details: null, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text',
          text: JSON.stringify({ items: [item], quantities: [record, goal, { ...record, item: 1 }] }) }] }] });
    } });
  const base = extractionRequest({ ...snapshot, ledger: false }, {});
  const enabled = extractionRequest(snapshot, {});
  const actual = await adapter.extract({ ...enabled, maxOutputTokens: 1024, signal: new AbortController().signal });
  await adapter.extract({ ...base, maxOutputTokens: 1024, signal: new AbortController().signal });
  const [wire, , original] = bodies.map(body => body.text.format.schema);
  assert.ok(enabled.system.startsWith(base.system + '\nBesides items, return quantities:'));
  assert.deepEqual(Object.keys(wire.properties), ['items', 'quantities']);
  assert.deepEqual(wire.required, ['items', 'quantities']);
  assert.deepEqual(wire.properties.items, original.properties.items);
  assert.deepEqual(wire.properties.quantities.items.required, Object.keys(record));
  assert.equal(wire.properties.quantities.items.additionalProperties, false);
  assert.deepEqual(actual, { items: [item], quantities: [record, goal] });
  assert.deepEqual(drops, ['invalid_extraction_quantity']);
});
