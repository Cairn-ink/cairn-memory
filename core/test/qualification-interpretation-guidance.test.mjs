import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createQualificationCandidateSnapshot, compileQualificationCandidates } from '../qualification-candidates.mjs';

const prompt = readFileSync(new URL('../prompts/qualify-candidates.md', import.meta.url), 'utf8');
const examples = [...prompt.matchAll(/```json\s*([\s\S]*?)```/g)].map(match => JSON.parse(match[1]));
const fields = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];
function snapshotFor(input) {
  return createQualificationCandidateSnapshot(input.items.map(item => ({ content: item.content, kind: item.kind, confidence: 0.8,
    receipts: item.candidates.map((candidate, index) => ({ client: 'synthetic', sessionId: 'prompt-example', eventId: `source-${index}`,
      role: candidate.role, excerpt: candidate.text })) })));
}

test('Q5 parsed coffee/sugar example compiles through real v2 source binding with exact anchors', () => {
  assert.equal(examples.length, 2); const [input, output] = examples; const snapshot = snapshotFor(input);
  assert.deepEqual(snapshot.input, input); const before = structuredClone(output);
  assert.ok(snapshot.input.items.every(item => item.candidates.every(candidate => candidate.text.length <= 200)));
  const qualification = compileQualificationCandidates(output, snapshot)[0].qualification;
  assert.deepEqual(qualification, { version: 1, slot: { subject: 'user', property: 'sweetener choice', scope: 'coffee', applies: 'weekends' },
    value: 'no sugar', attribution: 'direct', commitment: 'adopted', anchors: [{ receiptIndex: 0, start: 0,
      end: input.items[0].candidates[0].text.length, text: input.items[0].candidates[0].text, fields }] });
  assert.deepEqual(output, before);
});

test('Q2 guidance does not impose non-null quota or erase independent fields when commitment unknown', () => {
  const [input, example] = examples; const snapshot = snapshotFor(input);
  const unknown = { qualifications: [{ itemIndex: 0, ...Object.fromEntries(fields.map(field => [field,
    { value: ['attribution', 'commitment'].includes(field) ? 'unknown' : null, evidenceIndices: field === 'value' ? [0] : [] }])) }] };
  const compiled = compileQualificationCandidates(unknown, snapshot)[0].qualification;
  assert.deepEqual(compiled.slot, { subject: null, property: null, scope: null, applies: null });
  assert.equal(compiled.value, null); assert.equal(compiled.commitment, 'unknown'); assert.equal(compiled.attribution, 'unknown');
  assert.deepEqual(compiled.anchors[0].fields, ['value']);
  const partial = structuredClone(example); partial.qualifications[0].commitment = { value: 'unknown', evidenceIndices: [] };
  const supported = compileQualificationCandidates(partial, snapshot)[0].qualification;
  assert.equal(supported.value, 'no sugar'); assert.equal(supported.commitment, 'unknown');
  assert.equal(Object.hasOwn(supported, 'singleClaim'), false);
});
