import assert from 'node:assert/strict';
import test from 'node:test';
import { packMocGroups } from '../moc-group-packing.mjs';
import { modelRequestText } from '../model-call.mjs';

const group = (namespaceIndex, mocId) => ({ namespaceIndex, mocId, revision: 1, title: `Title ${mocId}` });
const lanes = () => [0, 1].flatMap(namespaceIndex => ['standalone', 'connected'].map(origin => ({ namespaceIndex,
  origin, groups: Array.from({ length: 3 }, (_, index) => group(namespaceIndex, `${namespaceIndex}-${origin}-${index}`)) })));
const input = () => ({ query: 'synthetic query', maps: [0, 1].map(namespaceIndex => ({ namespaceIndex, groups: [] })),
  maxRefs: 4, maxRefsPerNamespace: 2 });
const refs = groups => groups.map(({ namespaceIndex, mocId, revision }) => ({ namespaceIndex, mocId, revision }));

test('whole group packing reserves namespace/origin lanes, counts exact omissions and preserves strict wire', () => {
  const seen = [];
  const model = { countTokens: text => {
    const request = JSON.parse(text); seen.push(request);
    return request.input.maps.reduce((sum, map) => sum + map.groups.length, 0) * 1000;
  } };
  const value = packMocGroups(model, 'system', input(), lanes());
  assert.equal(value.observedGroups, 12); assert.equal(value.packedRefs.length, 6);
  assert.equal(value.omittedRefs.length, 6); assert.equal(value.fitChecks, seen.length);
  assert.ok(value.fitChecks <= value.observedGroups + 3);
  const observed = lanes().flatMap(lane => lane.groups);
  assert.deepEqual([...value.packedRefs, ...value.omittedRefs].sort((a, b) => a.mocId.localeCompare(b.mocId)),
    refs(observed).sort((a, b) => a.mocId.localeCompare(b.mocId)));
  for (const lane of value.lanes) assert.ok(lane.packedRefs.some(ref => ref.mocId.endsWith('-0')));
  for (const map of value.input.maps) for (const item of map.groups) {
    assert.deepEqual(Object.keys(item), ['namespaceIndex', 'mocId', 'revision', 'title']);
    assert.deepEqual(item, observed.find(group => group.mocId === item.mocId));
  }
  assert.equal(model.countTokens(modelRequestText('system', value.input)), 6000);
});

test('reservation and empty-envelope overflow reject explicitly; counter/freshness errors propagate', () => {
  for (const countTokens of [() => 6001, text => JSON.parse(text).input.maps.some(map => map.groups.length > 1) ? 6001 : 1]) {
    assert.throws(() => packMocGroups({ countTokens }, 'system', input(), lanes()), { code: 'context_budget_exceeded' });
  }
  assert.throws(() => packMocGroups({ countTokens: () => { throw Error('counter'); } }, 'system', input(), lanes()),
    { code: 'token_count_unavailable' });
  let fresh = true;
  assert.throws(() => packMocGroups({ countTokens: () => { fresh = false; return 1; } }, 'system', input(), lanes(),
    () => { if (!fresh) throw Object.assign(Error('changed'), { code: 'index_revision_conflict' }); }),
  { code: 'index_revision_conflict' });
});

test('packing visits each remaining group once without assuming token monotonicity', () => {
  const source = [{ namespaceIndex: 0, origin: 'standalone', groups: ['a', 'b', 'c'].map(id => group(0, id)) }];
  const value = packMocGroups({ countTokens: text => {
    const ids = JSON.parse(text).input.maps.flatMap(map => map.groups.map(group => group.mocId));
    return ids.includes('b') ? 6001 : 1;
  } }, 'system', input(), source);
  assert.deepEqual(value.packedRefs.map(ref => ref.mocId), ['a', 'c']);
  assert.deepEqual(value.omittedRefs.map(ref => ref.mocId), ['b']);
  assert.equal(value.fitChecks, 4);
});
