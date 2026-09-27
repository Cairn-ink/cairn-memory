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
    // Valid repeats are accepted; raw overlength repeats still reject before canonicalization.
    (v) => { v.qualifications.item_3.subject.evidenceSlots = [0, 0, 0, 0, 0]; },
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

test('canonicalization validates every raw slot and array descriptor before removing valid repeats', () => {
  const data = input(2), valid = encode(inline(data));
  for (const slots of [[0, 0, -1], [0, 0, 2], [0, 0, 0.5], [0, 0, '0'],
    [0, 0, Number.MAX_SAFE_INTEGER + 1], [0, 0, NaN], [0, 0, Infinity], [0, 0, null]]) {
    const malformed = structuredClone(valid), reasons = [];
    malformed.qualifications.item_3.subject.evidenceSlots = slots;
    assert.throws(() => decodeQualificationEvidencePool(data, malformed, reason => reasons.push(reason)), /invalid_pool_output/u);
    assert.deepEqual(reasons, ['qualification_slot_mapping']);
  }
  let getterCalls = 0;
  for (const change of [
    slots => { delete slots[1]; },
    slots => { Object.defineProperty(slots, '1', { enumerable: true, get() { getterCalls++; return 0; } }); },
    slots => { slots.extra = true; },
    slots => { slots[Symbol('extra')] = true; },
    slots => { Object.defineProperty(slots, '1', { value: 0, enumerable: false }); },
  ]) {
    const malformed = structuredClone(valid), slots = [0, 0]; change(slots);
    malformed.qualifications.item_3.subject.evidenceSlots = slots;
    assert.throws(() => decodeQualificationEvidencePool(data, malformed), /invalid_pool_output/u);
  }
  assert.equal(getterCalls, 0);
  for (const change of [
    entry => { entry.pool = [2, 2]; },
    entry => { entry.pool = [2, 5]; }, // Candidate belongs to the other item.
    entry => { entry.itemIndex = 7; },
  ]) {
    const malformed = structuredClone(valid), reasons = [];
    malformed.qualifications.item_3.subject.evidenceSlots = [0, 0];
    change(malformed.qualifications.item_3);
    assert.throws(() => decodeQualificationEvidencePool(data, malformed, reason => reasons.push(reason)), /invalid_pool_output/u);
    assert.deepEqual(reasons, ['qualification_pool_mapping']);
  }
});

test('valid repeats preserve first-seen order for every field across non-contiguous items and IDs without mutation', () => {
  const data = input(5), valid = encode(inline(data));
  for (const [position, entry] of Object.values(valid.qualifications).entries()) {
    entry.pool = GROUPS[position];
    for (const field of FIELDS) entry[field].evidenceSlots = entry.pool.length === 1 ? [0, 0, 0, 0]
      : [entry.pool.length - 1, 0, entry.pool.length - 1, 0];
  }
  const before = structuredClone(valid), inputBefore = structuredClone(data);
  const decoded = decodeQualificationEvidencePool(data, valid);
  for (const [position, entry] of decoded.qualifications.entries()) for (const field of FIELDS) {
    assert.deepEqual(entry[field].evidenceIndices, GROUPS[position].length === 1 ? GROUPS[position]
      : [GROUPS[position].at(-1), GROUPS[position][0]]);
  }
  assert.deepEqual(valid, before); assert.deepEqual(data, inputBefore);
});

test('Q2 decoder preserves no-observer error shape and reports only a fixed category', async () => {
  const data = input(1), malformed = encode(inline(data));
  malformed.qualifications.item_3.pool = [2, 2];
  let baseline;
  for (const observer of [undefined, () => { throw Error('SYNTHETIC_PROVIDER_PRIVATE'); },
    async () => { throw Error('SYNTHETIC_PROVIDER_PRIVATE'); }]) {
    assert.throws(() => decodeQualificationEvidencePool(data, malformed, observer), error => {
      const shape = JSON.stringify({ name: error.name, message: error.message });
      baseline ??= shape;
      assert.equal(shape, baseline);
      assert.equal(error.message, 'invalid_pool_output');
      return true;
    });
  }
  const events = [];
  assert.throws(() => decodeQualificationEvidencePool(data, malformed,
    reason => events.push(reason)), /invalid_pool_output/u);
  assert.deepEqual(events, ['qualification_pool_mapping']);
  assert.equal(JSON.stringify(events).includes('SYNTHETIC_PROVIDER_PRIVATE'), false);
});
