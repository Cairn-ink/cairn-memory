import assert from 'node:assert/strict';
import test from 'node:test';
import { qualificationInput, qualificationSources } from '../claim-qualification-input.mjs';

const fields = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];
const receipt = { client: 'synthetic', sessionId: 'session', eventId: 'event', role: 'user', excerpt: 'I prefer tea' };
const input = () => ({ version: 1, slot: { subject: 'I', property: 'drink', scope: null, applies: null },
  value: 'tea', attribution: 'direct', commitment: 'adopted',
  anchors: [{ receiptIndex: 0, start: 0, end: 12, text: 'I prefer tea', fields: [...fields] }] });
const rejected = (value, receipts = [receipt]) => assert.throws(() => qualificationInput(value, receipts),
  error => error.code === 'invalid_input');

test('qualification input enforces closed required keys at every object boundary', () => {
  assert.deepEqual(qualificationInput(input(), [receipt]), input());
  for (const path of [[], ['slot'], ['anchors', 0]]) {
    const original = path.reduce((object, key) => object[key], input());
    for (const key of Object.keys(original)) {
      const value = input();
      delete path.reduce((object, key) => object[key], value)[key];
      rejected(value);
    }
    const value = input();
    path.reduce((object, key) => object[key], value).namespace = 'foreign';
    rejected(value);
  }
  for (const value of [null, undefined, [], 1, 'qualification']) rejected(value);
  rejected({ ...input(), boundRevision: 1 });
  rejected({ ...input(), version: 2 });
});

test('labels require canonical bounded text, preserve explicit unknown, and reject secrets', () => {
  for (const field of ['subject', 'property', 'scope', 'applies', 'value']) {
    const maximum = ['scope', 'applies'].includes(field) ? 120 : 160;
    const set = (value, text) => { (field === 'value' ? value : value.slot)[field] = text; return value; };
    for (const text of [null, 'a'.repeat(maximum), '😀'.repeat(maximum / 2)]) {
      assert.doesNotThrow(() => qualificationInput(set(input(), text), [receipt]));
    }
    for (const text of ['', undefined, 1, 'a'.repeat(maximum + 1), ' noncanonical ', 'two  spaces',
      'ｅ', 'e\u0301', '\uD800', '\uDC00', `sk-${'a'.repeat(40)}`]) rejected(set(input(), text));
  }
  for (const attribution of ['direct', 'reported', 'quoted', 'proposed', 'unknown']) {
    assert.equal(qualificationInput({ ...input(), attribution }, [receipt]).attribution, attribution);
  }
  for (const commitment of ['adopted', 'considered', 'rejected', 'unknown']) {
    assert.equal(qualificationInput({ ...input(), commitment }, [receipt]).commitment, commitment);
  }
  rejected({ ...input(), attribution: 'certain' });
  rejected({ ...input(), commitment: null });
});

test('anchors enforce dense finite arrays, exact slices and distinct covered field names', () => {
  for (const anchors of [[], Array(1), Array(5).fill(input().anchors[0])]) rejected({ ...input(), anchors });
  for (const patch of [{ receiptIndex: -1 }, { receiptIndex: 1 }, { receiptIndex: 0.5 },
    { start: -1 }, { start: 1.5 }, { end: 0 }, { end: 13 }, { end: Infinity },
    { end: Number.MAX_SAFE_INTEGER + 1 }, { text: 'forged' }, { text: '' },
    { fields: [] }, { fields: Array(1) }, { fields: ['value', 'value'] }, { fields: ['authority'] },
    { fields: ['value'] }]) {
    const value = input(); Object.assign(value.anchors[0], patch); rejected(value);
  }
  const reversed = input(); reversed.anchors[0].fields.reverse();
  assert.deepEqual(qualificationInput(reversed, [receipt]).anchors[0].fields, fields);
  const unknown = input();
  unknown.slot = { subject: null, property: null, scope: null, applies: null };
  unknown.value = null; unknown.attribution = 'unknown'; unknown.commitment = 'unknown';
  unknown.anchors[0].fields = ['value'];
  assert.doesNotThrow(() => qualificationInput(unknown, [receipt]));
  const long = input(); long.anchors[0].text = 'x'.repeat(200); long.anchors[0].end = 200;
  assert.doesNotThrow(() => qualificationInput(long, [{ ...receipt, excerpt: 'x'.repeat(201) }]));
  long.anchors[0].text += 'x'; long.anchors[0].end++;
  rejected(long, [{ ...receipt, excerpt: 'x'.repeat(201) }]);
});

test('duplicate anchors use receipt identity and ignore field ordering', () => {
  const value = input();
  value.anchors.push({ ...value.anchors[0], fields: [...fields].reverse() });
  rejected(value);
  value.anchors[1].receiptIndex = 1;
  rejected(value, [receipt, { ...receipt }]);
  assert.doesNotThrow(() => qualificationInput(value, [receipt, { ...receipt, eventId: 'another' }]));
});

test('UTF-16 anchor offsets preserve full surrogate pairs and reject malformed source strings', () => {
  const value = input(); value.anchors[0] = { ...value.anchors[0], start: 1, end: 3, text: '😀' };
  const sources = [{ ...receipt, excerpt: 'A😀B' }];
  assert.doesNotThrow(() => qualificationInput(value, sources));
  for (const [start, end, text] of [[1, 2, '\uD83D'], [2, 3, '\uDE00'], [1, 4, '😀']]) {
    rejected({ ...value, anchors: [{ ...value.anchors[0], start, end, text }] }, sources);
  }
  for (const field of Object.keys(receipt)) {
    assert.throws(() => qualificationSources('body', [{ ...receipt, [field]: '\uD800' }]),
      error => error.code === 'invalid_input');
  }
  assert.throws(() => qualificationSources('\uDC00', [receipt]), error => error.code === 'invalid_input');
});
