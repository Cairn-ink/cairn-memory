import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareBoundedSelection } from '../selection-augmentation.mjs';

const ref = (memoryId, namespaceIndex = 0, revision = 1) => ({ namespaceIndex, memoryId, revision });
const item = id => ({ type: 'unfiled', ref: { memoryId: id, revision: 1 }, label: `Untrusted ${id}` });
const input = (count = 3) => ({ query: 'Why now?', maxRefs: 24, maps: [0, 1].map(namespaceIndex => ({ namespaceIndex,
  exhausted: false, items: Array.from({ length: count }, (_, i) => item(`m${i}`)) })) });
const code = expected => error => error.code === expected;

test('seed order precedes stable map order, repeated placements and groups add no authority', () => {
  const value = input();
  value.maps.reverse();
  value.maps[0].items.splice(1, 0, item('m0'),
    { type: 'moc', moc: { id: 'group', level: 'L1', title: 'Group', revision: 1 } },
    { type: 'ref', ref: { parentId: 'group', parentRevision: 1, childType: 'memory', childId: 'nested', childRevision: 2, relation: 'contains' }, label: 'Nested' },
    { type: 'ref', ref: { parentId: 'group', parentRevision: 1, childType: 'moc', childId: 'subgroup', childRevision: 1, relation: 'contains' }, label: 'Group' });
  const result = prepareBoundedSelection(value).augment({ refs: [ref('m2'), ref('m1', 1)] });
  assert.deepEqual(result, { selection: { refs: [ref('m2'), ref('m1', 1), ref('m0', 1), ref('nested', 1, 2), ref('m2', 1), ref('m0'), ref('m1')] },
    diagnostics: { strategy: 'seed-preserving-map-order', baseRefCount: 2, addedRefCount: 5, semanticCoverage: 'unassessed' } });
});

test('full and asymmetric bounds protect original choices and enforce twelve per namespace', () => {
  const value = input(15);
  const seed = [ref('m14', 1), ref('m14')];
  const full = prepareBoundedSelection(value).augment({ refs: seed });
  assert.deepEqual(full.selection.refs.slice(0, 2), seed);
  assert.equal(full.selection.refs.length, 24);
  for (const namespaceIndex of [0, 1]) assert.equal(full.selection.refs.filter(r => r.namespaceIndex === namespaceIndex).length, 12);
  assert.equal(full.diagnostics.addedRefCount, 22);
  for (const maxRefs of [2, 3, 12, 13, 23]) {
    const result = prepareBoundedSelection({ ...value, maxRefs }).augment({ refs: seed });
    assert.equal(result.selection.refs.length, maxRefs);
    assert.deepEqual(result.selection.refs.slice(0, 2), seed);
  }
  assert.throws(() => prepareBoundedSelection(value).augment({ refs: Array.from({ length: 13 }, (_, i) => ref(`m${i}`)) }), code('invalid_model_output'));
});

test('empty seeds and zero budgets stay empty, including empty and second-only maps', () => {
  for (const value of [input(), { ...input(), maxRefs: 0 }, { ...input(), maps: [] }, { ...input(), maps: input().maps.slice(1) }]) {
    assert.deepEqual(prepareBoundedSelection(value).augment({ refs: [] }), { selection: { refs: [] },
      diagnostics: { strategy: 'seed-preserving-map-order', baseRefCount: 0, addedRefCount: 0, semanticCoverage: 'unassessed' } });
  }
  assert.throws(() => prepareBoundedSelection({ ...input(), maxRefs: 0 }).augment({ refs: [ref('m0')] }));
  assert.equal(prepareBoundedSelection({ ...input(), maps: input().maps.slice(1) }).augment({ refs: [ref('m0', 1)] }).selection.refs.length, 3);
});

test('input authority and every output are detached across caller mutations and repeated calls', () => {
  const value = input(), prepared = prepareBoundedSelection(value);
  const frozen = object => { if (object && typeof object === 'object') { assert.ok(Object.isFrozen(object)); Object.values(object).forEach(frozen); } };
  frozen(prepared.input);
  value.maps[0].items[0].ref.memoryId = 'foreign'; value.query = 'Changed';
  assert.equal(prepared.input.query, 'Why now?');
  const seed = { refs: [ref('m0')] }, first = prepared.augment(seed), expected = structuredClone(first);
  seed.refs[0].memoryId = 'foreign';
  assert.deepEqual(first, expected);
  if (!Object.isFrozen(first.selection.refs)) first.selection.refs.pop();
  assert.deepEqual(prepared.augment({ refs: [ref('m0')] }), expected);
});

test('invalid selections reject without filtering, generated authority or prototype coercion', () => {
  const { augment } = prepareBoundedSelection(input());
  for (const value of [null, [], {}, { refs: null }, { refs: Array(1) }, { refs: Object.assign([], { extra: true }) },
    { refs: [], coverage: 'complete' }, { refs: [ref('m0'), ref('m0')] }, { refs: [ref('foreign')] },
    { refs: [ref('m0', 2)] }, { refs: [ref('m0', 0, 2)] }, { refs: [{ ...ref('m0'), excerpt: 'invented' }] },
    { refs: [null] }, Object.create({ refs: [] })]) assert.throws(() => augment(value), code('invalid_model_output'));
});

test('parent, nested and array accessors are rejected without invoking getters', () => {
  let getters = 0;
  const accessor = (object, key) => { Object.defineProperty(object, key, { enumerable: true, get() { getters++; throw new Error('Getter invoked'); } }); return object; };
  for (const value of [accessor({}, 'query'), { ...input(), maps: [accessor({}, 'namespaceIndex')] },
    { ...input(), maps: [{ ...input().maps[0], items: [accessor({}, 'type')] }] },
    { ...input(), maps: [{ ...input().maps[0], items: [{ ...item('m0'), ref: accessor({}, 'memoryId') }] }] }]) {
    assert.throws(() => prepareBoundedSelection(value), code('invalid_input'));
  }
  const { augment } = prepareBoundedSelection(input());
  for (const value of [accessor({}, 'refs'), { refs: [accessor({}, 'memoryId')] }, { refs: accessor([ref('m0')], '0') }]) {
    assert.throws(() => augment(value), code('invalid_model_output'));
  }
  assert.equal(getters, 0);
});

test('preparation rejects invalid budgets, conflicting revisions and oversized maps', () => {
  for (const maxRefs of [undefined, null, -1, 25, 1.5, '12']) assert.throws(() => prepareBoundedSelection({ ...input(), maxRefs }), code('invalid_input'));
  for (const mutate of [v => { v.query = ''; }, v => { v.query = '\ud800'; }, v => { v.query = 'x'.repeat(4001); },
    v => { v.maps[0].namespaceIndex = 2; }, v => { v.maps.push(v.maps[0]); },
    v => { v.maps[0].items.push({ ...item('m0'), ref: { memoryId: 'm0', revision: 2 } }); },
    v => { v.maps[0].items[0].label = '界'.repeat(8001); }]) {
    const value = input(); mutate(value); assert.throws(() => prepareBoundedSelection(value), code('invalid_input'));
  }
});

test('custom refs array prototype is rejected without invoking inherited serialization hooks', () => {
  let hooks = 0;
  const refs = [ref('m0')];
  Object.setPrototypeOf(refs, Object.assign(Object.create(Array.prototype), {
    toJSON() { hooks++; return []; },
  }));
  assert.throws(() => prepareBoundedSelection(input()).augment({ refs }), code('invalid_model_output'));
  assert.equal(hooks, 0);
});
