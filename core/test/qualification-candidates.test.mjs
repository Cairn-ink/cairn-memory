import assert from 'node:assert/strict';
import test from 'node:test';
import { createQualificationCandidateSnapshot, compileQualificationCandidates } from '../qualification-candidates.mjs';

// Synthetic structural checks, not semantic entailment or model accuracy.
const receipt = (excerpt, eventId = 'source') => ({ client: 'synthetic', sessionId: 'session', eventId, role: 'user', excerpt });
const item = (receipts) => ({ content: 'Synthetic claim', kind: 'fact', confidence: 0.8, receipts });
const fields = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];
const entry = (itemIndex = 0, candidateIndex = 0) => ({ itemIndex,
  ...Object.fromEntries(fields.map((field) => [field, { value: ['attribution', 'commitment'].includes(field) ? 'unknown' : null,
    evidenceIndices: field === 'value' ? [candidateIndex] : [] }])) });
const output = (value = entry()) => ({ qualifications: [value] });
const invalid = (value, snapshot) => assert.throws(() => compileQualificationCandidates(value, snapshot), { code: 'invalid_model_output' });
function frozen(value) { assert.ok(Object.isFrozen(value)); for (const child of Object.values(value)) if (child && typeof child === 'object') frozen(child); }

test('QC1 full 800-unit excerpts partition deterministically without splitting astral pairs or dropping repeated evidence', () => {
  const text = 'a'.repeat(199) + '🚋' + '中'.repeat(199) + '🚋' + 'same '.repeat(79) + 'xyz';
  assert.equal(text.length, 800);
  const original = [item([receipt(text), receipt('repeat repeat', 'second')]), item([receipt('repeat repeat')])];
  const snapshot = createQualificationCandidateSnapshot(original); frozen(snapshot);
  const indices = snapshot.candidates.flat().map((candidate) => candidate.candidateIndex);
  assert.deepEqual(indices, Array.from({ length: indices.length }, (_, index) => index));
  assert.equal(snapshot.candidates[0][0].text.length, 199);
  for (const [itemIndex, admission] of original.entries()) for (const [receiptIndex, source] of admission.receipts.entries()) {
    const candidates = snapshot.candidates[itemIndex].filter((candidate) => candidate.receiptIndex === receiptIndex);
    assert.equal(candidates.map((candidate) => candidate.text).join(''), source.excerpt);
    let position = 0;
    for (const candidate of candidates) {
      assert.equal(candidate.start, position); assert.equal(candidate.end, position + candidate.text.length);
      assert.ok(candidate.text.length > 0 && candidate.text.length <= 200); assert.equal(candidate.text.isWellFormed(), true);
      assert.equal(source.excerpt.slice(candidate.start, candidate.end), candidate.text); position = candidate.end;
    }
    assert.equal(position, source.excerpt.length);
  }
  for (const modelItem of snapshot.input.items) for (const candidate of modelItem.candidates)
    assert.deepEqual(Object.keys(candidate).sort(), ['candidateIndex', 'role', 'text']);
  const detached = structuredClone(snapshot); original[0].receipts[0].excerpt = 'changed';
  assert.deepEqual(snapshot, detached);
  assert.deepEqual(createQualificationCandidateSnapshot(detached.items), snapshot);
  const boundary = 'a'.repeat(199) + '🚋' + 'b'.repeat(599);
  const maximum = createQualificationCandidateSnapshot(Array.from({ length: 5 }, () => item(
    Array.from({ length: 4 }, (_, index) => receipt(boundary, `source-${index}`)))));
  assert.deepEqual(maximum.candidates.map((list) => list.length), [20, 20, 20, 20, 20]);
  assert.deepEqual(maximum.candidates.flat().map((candidate) => candidate.candidateIndex),
    Array.from({ length: 100 }, (_, index) => index));
});

test('QC2 compiler derives coverage and exact offsets, groups references and canonicalizes candidate order', () => {
  const snapshot = createQualificationCandidateSnapshot([item([receipt('a'.repeat(400))])]);
  const value = entry(); value.subject = { value: 'User', evidenceIndices: [1, 0] };
  value.value = { value: 'Preference', evidenceIndices: [1] };
  const result = compileQualificationCandidates(output(value), snapshot)[0].qualification;
  assert.deepEqual(result.anchors, [
    { receiptIndex: 0, start: 0, end: 200, text: 'a'.repeat(200), fields: ['subject'] },
    { receiptIndex: 0, start: 200, end: 400, text: 'a'.repeat(200), fields: ['subject', 'value'] },
  ]);
  assert.equal(result.slot.subject, 'User'); assert.equal(result.value, 'Preference');
  assert.equal(Object.hasOwn(result, 'singleClaim'), false);
});

test('QC3 known fields require own evidence, all unknown still needs an explicit candidate, references are same-item', () => {
  const snapshot = createQualificationCandidateSnapshot([item([receipt('one')]), item([receipt('two')])]);
  const good = { qualifications: [entry(0, 0), entry(1, 1)] };
  assert.equal(compileQualificationCandidates(good, snapshot).length, 2);
  for (const field of fields) {
    const value = structuredClone(good);
    value.qualifications[0][field] = { value: field === 'attribution' ? 'direct' : field === 'commitment' ? 'adopted' : 'Known', evidenceIndices: [] };
    invalid(value, snapshot);
  }
  const absent = structuredClone(good); absent.qualifications[0].value.evidenceIndices = []; invalid(absent, snapshot);
  const foreign = structuredClone(good); foreign.qualifications[0].value.evidenceIndices = [1]; invalid(foreign, snapshot);
  const reversed = { qualifications: [...good.qualifications].reverse() };
  assert.deepEqual(compileQualificationCandidates(reversed, snapshot), compileQualificationCandidates(good, snapshot));
});

test('QC4 four distinct windows allowed, fifth rejected rather than truncated or silently omitted', () => {
  const snapshot = createQualificationCandidateSnapshot([item([receipt('a'.repeat(800)), receipt('b')])]);
  const value = entry(); value.value.evidenceIndices = [3, 2, 1, 0];
  assert.equal(compileQualificationCandidates(output(value), snapshot)[0].qualification.anchors.length, 4);
  value.subject.evidenceIndices = [4]; invalid(output(value), snapshot);
});

test('QC4 strict output refuses duplicate/missing/extra entries and forged coverage, offsets, or malformed fields', () => {
  const snapshot = createQualificationCandidateSnapshot([item([receipt('Synthetic source')])]);
  for (const value of [null, {}, { qualifications: [] }, { ...output(), extra: true },
    { qualifications: [entry(), entry()] }, output({ ...entry(), itemIndex: 1 }), output({ ...entry(), itemIndex: '0' }),
    output({ ...entry(), anchors: [] }), output({ ...entry(), singleClaim: true })]) invalid(value, snapshot);
  for (const field of fields) {
    const missing = entry(); delete missing[field]; invalid(output(missing), snapshot);
    for (const bad of [null, {}, { value: null }, { value: null, evidenceIndices: [0], fields: ['value'] },
      { value: null, evidenceIndices: [0, 0] }, { value: null, evidenceIndices: [-1] },
      { value: null, evidenceIndices: ['0'] }, { value: null, evidenceIndices: [0.5] },
      { value: null, evidenceIndices: Array(1) }]) invalid(output({ ...entry(), [field]: bad }), snapshot);
  }
  for (const value of ['x'.repeat(161), ' Ａ ', 'bad\ud800'])
    invalid(output({ ...entry(), subject: { value, evidenceIndices: [0] } }), snapshot);
});
