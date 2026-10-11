import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDevelopmentFreeze } from '../corpus.mjs';
import { buildBlindDevelopmentPacket, unblindDevelopmentJudgments } from '../judging.mjs';

test('blind packets contain source truth and actual packed evidence, never arm identity or failed answers', async () => {
  const corpus = await loadDevelopmentFreeze();
  const packed = { request: { messages: [{}, { content: JSON.stringify({ evidence: [{ text: 'Actual packed source only.' }] }) }] } };
  const observations = [{ id: 'D01', capture: { status: 'completed' }, arms: {
    baseline: { status: 'completed', packed, answer: 'Thirty-seven.' }, full: { status: 'unresolved', answer: 'Do not grade me.' },
  } }];
  const { mapping, packet } = buildBlindDevelopmentPacket({ observations, ...corpus });
  assert.equal(mapping.length, 1); assert.equal(packet.items.length, 1);
  const item = packet.items[0];
  assert.equal(item.answer, 'Thirty-seven.');
  assert.deepEqual(item.packedEvidence, [{ text: 'Actual packed source only.' }]);
  assert.deepEqual(item.sourceHistory, corpus.modelInputs[0].sessions);
  assert.deepEqual(Object.keys(item).sort(), ['label', 'question', 'sourceHistory', 'rubric', 'packedEvidence', 'answer'].sort());
  assert.equal(Object.hasOwn(packet, 'mapping'), false);
  const judgment = { label: item.label, verdict: 'correct', reviewedClaims: 1, unsupportedClaims: 0,
    staleClaims: 0, severeError: false, rationale: 'Supported count.' };
  assert.equal(unblindDevelopmentJudgments(mapping, [judgment])[0].arm, 'baseline');
  assert.throws(() => unblindDevelopmentJudgments(mapping, [judgment, judgment]), /identity/);
  assert.throws(() => unblindDevelopmentJudgments(mapping, [{ ...judgment, label: 'foreign' }]), /identity/);
  assert.throws(() => unblindDevelopmentJudgments(mapping, [{ ...judgment, arm: 'full' }]), /identity/);
  assert.throws(() => buildBlindDevelopmentPacket({ ...corpus, observations: [...observations, ...observations] }), /identities/);
});
