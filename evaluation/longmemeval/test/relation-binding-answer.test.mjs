import test from 'node:test';
import assert from 'node:assert/strict';
import { packMixedAnswer, packRelationBoundAnswer, RELATION_BINDING_INSTRUCTION } from '../mixed-answer.mjs';
import { PUBLIC_ANSWER_INSTRUCTION } from '../public-comparison.mjs';

const options = () => ({ question: { text: 'Which destination belongs to the requested device?', date: '2026-08-12' },
  units: [{ text: 'Quoted user source: device -> component.' }, { text: 'Quoted user source: component -> destination.' }],
  countTokens: text => text.length });
function requirePair(control, treatment) {
  assert.equal(control.request.messages[0].content, PUBLIC_ANSWER_INSTRUCTION);
  assert.equal(treatment.request.messages[0].content, RELATION_BINDING_INSTRUCTION);
  assert.notEqual(treatment.request.messages[0].content, control.request.messages[0].content);
  const changed = structuredClone(treatment.request);
  changed.messages[0].content = control.request.messages[0].content;
  assert.equal(JSON.stringify(changed), JSON.stringify(control.request));
}
test('RB2/RB8 serialized instruction-only pair is red-capable when treatment is disabled', () => {
  const control = packMixedAnswer(options());
  const build = process.env.CAIRN_RELATION_CONTROL_DISABLED === '1' ? packMixedAnswer : packRelationBoundAnswer;
  requirePair(control, build(options()));
  assert.throws(() => requirePair(control, packMixedAnswer(options())), { code: 'ERR_ASSERTION' });
});
test('RB3 named opt-in counts final instruction and keeps old bytes, validation and bounds', () => {
  const input = options(), before = JSON.stringify(input);
  const control = packMixedAnswer(input), treatment = packRelationBoundAnswer(input);
  requirePair(control, treatment);
  assert.equal(treatment.inputTokens, JSON.stringify(treatment.request).length);
  assert.ok(treatment.inputTokens > control.inputTokens);
  assert.equal(treatment.totalEstimatedTokens, treatment.inputTokens + 512);
  assert.equal(JSON.stringify(input), before);
  assert.ok(Object.isFrozen(treatment.request.messages));
  assert.throws(() => packRelationBoundAnswer({ ...options(), instruction: 'caller prompt' }), { code: 'invalid_answer_options' });
  let reads = 0;
  const hostile = options(); Object.defineProperty(hostile.units[0], 'text', { get() { reads++; return 'bad'; }, enumerable: true });
  assert.throws(() => packRelationBoundAnswer(hostile), { code: 'invalid_answer_options' }); assert.equal(reads, 0);
  assert.throws(() => packRelationBoundAnswer({ ...options(), countTokens: () => 122_489 }), { code: 'question_context_exceeded' });
});
