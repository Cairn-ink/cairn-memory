import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeQualificationEvidencePool } from '../qualification-evidence-pool.mjs';
import { schemasFor } from '../schemas.mjs';

const FIELDS = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];
const IDS = [3, 7, 11, 19, 27];
const GROUPS = [[2, 13, 31, 47], [5], [9, 25], [40, 51, 72], [80, 90, 110, 130]];
const input = (count) => ({ items: IDS.slice(0, count).map((itemIndex, position) => ({ itemIndex,
  content: `synthetic-${position}`, kind: 'context',
  candidates: GROUPS[position].map((candidateIndex) => ({ candidateIndex, role: 'user', text: 'source' })),
})) });

function inline(data) {
  return { qualifications: data.items.map((item) => {
    const candidates = item.candidates.map((candidate) => candidate.candidateIndex);
    return { itemIndex: item.itemIndex,
      subject: { value: '海辺の案内', evidenceIndices: [candidates[0]] },
      property: { value: null, evidenceIndices: [] },
      scope: { value: null, evidenceIndices: [] },
      applies: { value: null, evidenceIndices: [] },
      value: { value: 'Résumé', evidenceIndices: [candidates.at(-1)] },
      attribution: { value: 'reported', evidenceIndices: [candidates[0]] },
      commitment: { value: 'unknown', evidenceIndices: [] } };
  }) };
}

function encode(value) {
  return { wireVersion: 'evidence-pool-v1', qualifications: Object.fromEntries(
    value.qualifications.map((entry) => {
      const pool = [...new Set(FIELDS.flatMap((field) => entry[field].evidenceIndices))];
      return [`item_${entry.itemIndex}`, { itemIndex: entry.itemIndex, pool,
        ...Object.fromEntries(FIELDS.map((field) => [field, { value: entry[field].value,
          evidenceSlots: entry[field].evidenceIndices.map((candidateIndex) => pool.indexOf(candidateIndex)) }])) }];
    })) };
}

test('evidence-pool-v1 differentially decodes original candidate IDs for 1–5 items', () => {
  for (let count = 1; count <= 5; count++) {
    const data = input(count);
    const original = inline(data);
    const encoded = encode(original);
    assert.deepEqual(decodeQualificationEvidencePool(data, encoded), original);
    const schema = schemasFor('qualifyCandidates', data);
    assert.equal(schema.properties.qualifications.required.length, count);
    assert.deepEqual(Object.keys(schema.$defs), ['text160', 'text120', 'attribution', 'commitment']);
    for (const entry of Object.values(encoded.qualifications)) {
      assert.ok(entry.pool.length >= 1 && entry.pool.length <= 4);
      assert.ok(FIELDS.every((field) => entry[field].evidenceSlots.every((slot) =>
        Number.isInteger(slot) && slot >= 0 && slot < entry.pool.length)));
    }
  }
});

test('four distinct citations and unused pool members do not add anchors', () => {
  const data = input(1);
  const original = inline(data);
  original.qualifications[0].subject.evidenceIndices = GROUPS[0];
  const encoded = encode(original);
  assert.equal(encoded.qualifications.item_3.pool.length, 4);
  assert.deepEqual(decodeQualificationEvidencePool(data, encoded), original);
  original.qualifications[0].subject.evidenceIndices = [GROUPS[0][0]];
  encoded.qualifications.item_3.subject.evidenceSlots = [0];
  assert.deepEqual(decodeQualificationEvidencePool(data, encoded), original,
    'Unreferenced pool members do not become core citations');
});

test('invalid pools, slots, coverage and accessor fields are rejected without reading getters', () => {
  const data = input(2);
  const valid = encode(inline(data));
  const reject = (change) => {
    const value = structuredClone(valid); change(value);
    assert.throws(() => decodeQualificationEvidencePool(data, value), /invalid_pool_output/u);
  };
  for (const change of [
    (v) => { v.wireVersion = 'inline-v0'; },
    (v) => { v.extra = true; },
    (v) => { delete v.qualifications.item_7; },
    (v) => { v.qualifications.item_999 = v.qualifications.item_7; },
    (v) => { v.qualifications.item_3.itemIndex = 7; },
    (v) => { v.qualifications.item_3.pool = []; },
    (v) => { v.qualifications.item_3.pool = [2, 2]; },
    (v) => { v.qualifications.item_3.pool = [2, 13, 31, 47, 99]; },
    (v) => { v.qualifications.item_3.pool = [2, 999]; },
    (v) => { v.qualifications.item_3.pool = [13]; },
    (v) => { v.qualifications.item_3.pool[0] = -1; },
    (v) => { v.qualifications.item_3.subject.evidenceSlots = [2]; },
    (v) => { v.qualifications.item_3.subject.evidenceSlots = [0, 0]; },
    (v) => { v.qualifications.item_3.subject.evidenceSlots = [0, 1, 2, 3, 4]; },
    (v) => { v.qualifications.item_3.subject.evidenceSlots = [0.5]; },
    (v) => { v.qualifications.item_3.subject.extra = true; },
    (v) => { delete v.qualifications.item_3.subject.value; },
  ]) reject(change);
  let getterCalls = 0;
  const accessor = structuredClone(valid);
  Object.defineProperty(accessor.qualifications.item_3, 'pool', { enumerable: true,
    get() { getterCalls++; return [2]; } });
  assert.throws(() => decodeQualificationEvidencePool(data, accessor), /invalid_pool_output/u);
  assert.equal(getterCalls, 0);
});
