import test from 'node:test';
import assert from 'node:assert/strict';
import { assemble, ARMS } from '../assembly/arms.mjs';
import { prepareItems } from '../assembly/units.mjs';

const unit = (id, tokens) => ({ id, tokens, text: id });
const items = [
  { id: 'a', body: unit('a#body', 4), spans: [unit('a#z9', 6), unit('a#s1', 2)] },
  { id: 'b', body: unit('b#body', 3), spans: [unit('b#s1', 3)] },
  { id: 'c', body: unit('c#body', 2), spans: [] },
];
const ranked = ['a', 'b', 'c'];
const expected = {
  2: { 'P-top': ['c#body'], 'P-top-s1': ['c#body'], 'P-cover': ['c#body'], 'P-cover-s1': ['c#body'], 'P-top+tail': ['c#body'] },
  6: { 'P-top': ['a#body', 'a#s1'], 'P-top-s1': ['a#body', 'c#body'], 'P-cover': ['a#body', 'c#body'], 'P-cover-s1': ['a#body', 'c#body'], 'P-top+tail': ['a#body', 'c#body'] },
  12: { 'P-top': ['a#body', 'a#z9', 'a#s1'], 'P-top-s1': ['a#body', 'a#z9', 'c#body'], 'P-cover': ['a#body', 'b#body', 'c#body', 'a#s1'], 'P-cover-s1': ['a#body', 'b#body', 'c#body', 'b#s1'], 'P-top+tail': ['a#body', 'a#z9', 'a#s1'] },
  15: { 'P-top': ['a#body', 'a#z9', 'a#s1', 'b#body'], 'P-top-s1': ['a#body', 'a#z9', 'b#body', 'c#body'], 'P-cover': ['a#body', 'b#body', 'c#body', 'a#z9'], 'P-cover-s1': ['a#body', 'b#body', 'c#body', 'a#z9'], 'P-top+tail': ['a#body', 'a#z9', 'a#s1', 'b#body'] },
  20: { 'P-top': ['a#body', 'a#z9', 'a#s1', 'b#body', 'b#s1', 'c#body'], 'P-top-s1': ['a#body', 'a#z9', 'b#body', 'b#s1', 'c#body'], 'P-cover': ['a#body', 'b#body', 'c#body', 'a#z9', 'a#s1', 'b#s1'], 'P-cover-s1': ['a#body', 'b#body', 'c#body', 'a#z9', 'b#s1'], 'P-top+tail': ['a#body', 'a#z9', 'a#s1', 'b#body', 'b#s1', 'c#body'] },
};
for (const [budget, arms] of Object.entries(expected)) for (const arm of ARMS) test(`${arm}, hand-computed budget ${budget}`, () => {
  const result = assemble(items, ranked, { arm, budget: Number(budget), overhead: 0 });
  assert.deepEqual(result.admitted.map(unit => unit.id), arms[arm]);
  assert.equal(result.used, result.admitted.reduce((sum, unit) => sum + unit.cost, 0));
  assert.ok(result.used <= Number(budget));
});

test('failed body suppresses cheap span and continues to the next item; exact fits and surcharge', () => {
  const oversized = [{ id: 'x', body: unit('x#body', 100), spans: [unit('x#s1', 1)] }, items[2]];
  for (const arm of ARMS) {
    assert.deepEqual(assemble(oversized, ['x', 'c'], { arm, budget: 2, overhead: 0 }).admitted.map(unit => unit.id), ['c#body']);
    assert.equal(assemble(items, ['c'], { arm, budget: 10, overhead: 8 }).used, 10);
    assert.equal(assemble(items, ['c'], { arm, budget: 9, overhead: 8 }).used, 0);
  }
});

test('P-top+tail starts tail at first failed bundle and never resumes bundles', () => {
  const result = assemble(items, ranked, { arm: 'P-top+tail', budget: 11, overhead: 0 });
  assert.deepEqual(result.admitted.map(unit => unit.id), ['a#body', 'b#body', 'c#body']);
  assert.equal(result.used, 9);
});

test('preparation passes only opaque IDs, texts and costs across the assembly boundary', () => {
  const prepared = prepareItems([{ id: 'x', content: 'hello', spans: [{ id: 'x#z', text: 'world', fact: 'SECRET' }], expresses: ['SECRET'], family: 'SECRET' }]);
  assert.deepEqual(prepared, [{ id: 'x', body: { id: 'x#body', text: 'hello', tokens: 1 }, spans: [{ id: 'x#z', text: 'world', tokens: 1 }] }]);
});

const reordered = {
  'P-top': ['b#body', 'b#s1', 'a#body', 'a#s1'],
  'P-top-s1': ['b#body', 'b#s1', 'a#body', 'c#body'],
  'P-cover': ['b#body', 'a#body', 'c#body', 'b#s1'],
  'P-cover-s1': ['b#body', 'a#body', 'c#body', 'b#s1'],
  'P-top+tail': ['b#body', 'b#s1', 'a#body', 'c#body'],
};
for (const arm of ARMS) test(`${arm} preserves ranking [b,a,c] despite item order [a,b,c]`, () => {
  assert.deepEqual(assemble(items, ['b', 'a', 'c'], { arm, budget: 12, overhead: 0 }).admitted.map(unit => unit.id), reordered[arm]);
});

const surcharged = [
  { id: 'a', body: unit('a#body', 12), spans: [unit('a#first', 14), unit('a#second', 10)] },
  { id: 'b', body: unit('b#body', 3), spans: [unit('b#first', 3)] },
];
const overheadCases = {
  42: { 'P-top': [['a#body', 20], ['a#first', 22]], 'P-top-s1': [['a#body', 20], ['a#first', 22]],
    'P-cover': [['a#body', 20], ['b#body', 11], ['b#first', 11]], 'P-cover-s1': [['a#body', 20], ['b#body', 11], ['b#first', 11]], 'P-top+tail': [['a#body', 20], ['b#body', 11]] },
  59: { 'P-top': [['a#body', 20], ['a#first', 22], ['b#body', 11]], 'P-top-s1': [['a#body', 20], ['a#first', 22], ['b#body', 11]],
    'P-cover': [['a#body', 20], ['b#body', 11], ['a#first', 22]], 'P-cover-s1': [['a#body', 20], ['b#body', 11], ['a#first', 22]], 'P-top+tail': [['a#body', 20], ['b#body', 11]] },
  60: { 'P-top': [['a#body', 20], ['a#first', 22], ['a#second', 18]], 'P-top-s1': [['a#body', 20], ['a#first', 22], ['b#body', 11]],
    'P-cover': [['a#body', 20], ['b#body', 11], ['a#first', 22]], 'P-cover-s1': [['a#body', 20], ['b#body', 11], ['a#first', 22]], 'P-top+tail': [['a#body', 20], ['a#first', 22], ['a#second', 18]] },
};
for (const [budget, cases] of Object.entries(overheadCases)) for (const arm of ARMS) test(`${arm} multi-unit O=8 at budget ${budget}, with exact fits and atomic tail boundary`, () => {
  const result = assemble(surcharged, ['a', 'b'], { arm, budget: Number(budget), overhead: 8 });
  assert.deepEqual(result.admitted.map(unit => [unit.id, unit.cost]), cases[arm]);
  assert.deepEqual(result.admitted.map(unit => unit.tokens), cases[arm].map(([, cost]) => cost - 8));
  assert.equal(result.used, cases[arm].reduce((sum, [, cost]) => sum + cost, 0));
});
test('the same complete a bundle costs 36 without overhead, and 60 with O=8', () => {
  for (const [overhead, budget] of [[0, 36], [8, 60]]) {
    const result = assemble(surcharged, ['a'], { arm: 'P-top+tail', budget, overhead });
    assert.equal(result.used, budget); assert.deepEqual(result.admitted.map(unit => unit.cost), [12 + overhead, 14 + overhead, 10 + overhead]);
  }
});
