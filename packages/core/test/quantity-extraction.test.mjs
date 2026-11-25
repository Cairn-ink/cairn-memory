import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { buildModelRequest, decodeModelOutput } from '../src/capture/wire.mjs';
import { plainExtractionSpec, validatePlainCandidates, validatePlainExtraction } from '../src/extraction/extraction.mjs';

const frozenParagraph = `Besides items, return quantities: a separate list written after the items. It never changes which items you write; most items have no quantity, and an empty list is normal. Add one entry for each amount the user reports about themselves in an item's content:
  item: the 0-based index of that item in items;
  kind: "record" for something that happened (a purchase or payment, steps walked, hours slept, a weight measured) or "goal" for a target or limit the user sets for themselves;
  measure: what is measured, lowercase English (spend, steps, sleep_hours, weight, distance, ...);
  value: the number exactly as stated, without currency symbols or thousands separators;
  unit: an ISO currency code for money (USD, TWD, EUR, ...), otherwise the unit as stated (steps, hours, kg, km);
  group: the broad class, one of food, transport, housing, shopping, bills, health, fitness, entertainment, work, other;
  category: the specific item in lowercase English, one or two words (coffee, lunch, groceries, taxi, daily_steps); "" if none;
  period: for a goal, the period it applies to (day, week, month, year); for a record, "none";
  comparator: for a goal, "at_most" or "at_least"; for a record, "none".
  An item that states several amounts gets one entry per amount. Project budgets, prices quoted by others, and amounts from the assistant are not quantities.`;
const frozenSchema = '{"type":"array","items":{"type":"object","additionalProperties":false,"required":["item","kind","measure","value","unit","group","category","period","comparator"],"properties":{"item":{"type":"integer","minimum":0},"kind":{"type":"string","enum":["record","goal"]},"measure":{"type":"string"},"value":{"type":"number"},"unit":{"type":"string"},"group":{"type":"string","enum":["food","transport","housing","shopping","bills","health","fitness","entertainment","work","other"]},"category":{"type":"string"},"period":{"type":"string","enum":["none","day","week","month","year"]},"comparator":{"type":"string","enum":["none","at_most","at_least"]}}}}';

const messages = [{ role: 'user', content: 'Tea cost 6 USD.' }, { role: 'assistant', content: 'Got it.' }];
const disabledPins = {
  system: [2594, '08aa15c586ba0eee113a610d6f8d196ee49441088b69e33b64f016c2cb9ad087'],
  input: [119, 'f68d149a3b943df4fba13376f6f0fe1bdcf3bf75f93e4d1a8729e03b944ba1de'],
  schema: [547, '0ec99f6c5eaf17b1a5ba3e564020ff0e16e1b123a99bae68b1f64e1cb188d599'],
};

test('plain extraction pins the original system, input and schema bytes', () => {
  for (const options of [undefined, {}, { quantities: false }]) {
    const spec = plainExtractionSpec(messages, options);
    for (const [part, expected] of Object.entries(disabledPins)) {
      const bytes = Buffer.from(part === 'system' ? spec[part] : JSON.stringify(spec[part]), 'utf8');
      assert.deepEqual([bytes.length, createHash('sha256').update(bytes).digest('hex')], expected, part);
    }
  }
});

function assertEnabled({ system, input, schema }, base) {
  assert.equal(system, base.system + '\n' + frozenParagraph);
  assert.equal(JSON.stringify(input), JSON.stringify(base.input));
  assert.deepEqual(Object.keys(schema.properties), ['items', 'quantities']);
  assert.deepEqual(schema.required, ['items', 'quantities']);
  assert.equal(schema.additionalProperties, false);
  assert.equal(JSON.stringify(schema.properties.items), JSON.stringify(base.schema.properties.items));
  assert.equal(JSON.stringify(schema.properties.quantities), frozenSchema);
}

test('quantity extraction appends the frozen paragraph and strict schema', () => {
  assertEnabled(plainExtractionSpec(messages, { quantities: true }), plainExtractionSpec(messages));
});

test('capture wire sends the same opt-in extension and includes it in sizing', () => {
  const { system, input } = plainExtractionSpec(messages);
  const args = { system, input, maxOutputTokens: 1024 };
  const base = buildModelRequest('extract', args);
  const enabled = buildModelRequest('extract', args, { quantities: true });
  assertEnabled(enabled.request, base.request);
  assert.equal(JSON.parse(enabled.sizingText).system, enabled.request.system);
  assert.deepEqual(enabled.validationSchema, enabled.request.schema);
});

const item = { kind: 'fact', content: 'Tea cost 6 USD.', confidence: 1, sourceIndices: [0] };
const record = {
  item: 0, kind: 'record', measure: 'spend', value: 6, unit: 'USD',
  group: 'food', category: 'tea', period: 'none', comparator: 'none',
};
const goal = { ...record, kind: 'goal', value: 12, period: 'week', comparator: 'at_most' };
const policy = { sourceCount: messages.length, itemLimit: 5 };
const enabled = { quantities: true };

const invalid = {
  'non-object entry': null,
  'array entry': [],
  'extra key': { ...record, extra: true },
  'missing key': Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'category')),
  'inherited key': Object.assign(Object.create({ item: 0 }), Object.fromEntries(Object.entries(record).slice(1))),
  'negative item': { ...record, item: -1 },
  'out-of-range item': { ...record, item: 1 },
  'fractional item': { ...record, item: 0.5 },
  'string item': { ...record, item: '0' },
  'infinite value': { ...record, value: Infinity },
  'NaN value': { ...record, value: NaN },
  'string value': { ...record, value: '6' },
  'nonserializable value': { ...record, value: () => 6 },
  'invalid kind': { ...record, kind: 'estimate' },
  'invalid group': { ...record, group: 'drinks' },
  'invalid measure': { ...record, measure: false },
  'invalid unit': { ...record, unit: [] },
  'invalid category': { ...record, category: '\uD800' },
  'record with comparator': { ...record, comparator: 'at_most' },
  'goal without period': { ...goal, period: 'none' },
  'goal without comparator': { ...goal, comparator: 'none' },
  'invalid goal period': { ...goal, period: 'shift' },
  'invalid goal comparator': { ...goal, comparator: 'exactly' },
};

for (const [name, bad] of Object.entries(invalid)) {
  test(`drops one quantity for ${name} and preserves its siblings`, () => {
    const raw = { items: [item], quantities: [record, bad, goal] };
    const request = buildModelRequest('extract', { ...plainExtractionSpec(messages), maxOutputTokens: 1024 }, enabled);
    const output = decodeModelOutput('extract', request, raw);
    assert.deepEqual(validatePlainExtraction(output, policy, enabled), {
      items: [item], quantities: [record, goal], dropped: { invalid_extraction_quantity: 1 },
    });
  });
}

test('missing and empty quantities leave items intact, and malformed lists count once', () => {
  for (const output of [{ items: [item] }, { items: [item], quantities: [] }]) {
    assert.deepEqual(validatePlainExtraction(output, policy, enabled), {
      items: [item], quantities: [], dropped: { invalid_extraction_quantity: 0 },
    });
  }
  assert.deepEqual(validatePlainExtraction({ items: [item], quantities: {} }, policy, enabled), {
    items: [item], quantities: [], dropped: { invalid_extraction_quantity: 1 },
  });
  assert.throws(() => validatePlainCandidates({ items: [item], quantities: [record] }, policy), {
    code: 'invalid_extraction_output_shape',
  });
});

test('holes and accessor entries count separately without reading accessor values', () => {
  const list = Array(3);
  const fail = () => assert.fail('unexpected accessor read');
  Object.defineProperty(list, 1, { get: fail, enumerable: true });
  list[2] = { ...record, get value() { return fail(); } };
  assert.deepEqual(validatePlainExtraction({ items: [item], quantities: list }, policy, enabled), {
    items: [item], quantities: [], dropped: { invalid_extraction_quantity: 3 },
  });
});

for (const period of ['day', 'week', 'month', 'year']) {
  test(`clears the ${period} period on a record without mutating model output`, () => {
    const raw = { items: [item], quantities: [record, { ...record, period }, goal] };
    const before = structuredClone(raw);
    const checked = validatePlainExtraction(raw, policy, enabled);
    assert.deepEqual(checked, {
      items: [item], quantities: [record, record, goal], dropped: { invalid_extraction_quantity: 0 },
    });
    assert.notEqual(checked.quantities[1], raw.quantities[1]);
    assert.deepEqual(raw, before);
  });
}

for (const bad of [{ ...record, period: 'day', comparator: 'at_most' }, { ...record, period: 'shift' }]) {
  test(`drops a record with period ${bad.period} and comparator ${bad.comparator} when invalid`, () => {
    const raw = { items: [item], quantities: [record, bad, goal] };
    assert.deepEqual(validatePlainExtraction(raw, policy, enabled), {
      items: [item], quantities: [record, goal], dropped: { invalid_extraction_quantity: 1 },
    });
  });
}
