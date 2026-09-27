import assert from 'node:assert/strict';
import test from 'node:test';

import { MIXED_ANSWER_MODEL, packMixedAnswer } from '../mixed-answer.mjs';
import { MixedComparisonError } from '../mixed-validation.mjs';
import { PUBLIC_ANSWER_INSTRUCTION } from '../public-comparison.mjs';

const question = { text: 'What did Mira decide? 🌱', date: '2025-01-02 09:30' };
const countTokens = text => text.length;
const packed = units => packMixedAnswer({ question, units, countTokens });
const denied = (options, code) => assert.throws(() => packMixedAnswer(options),
  error => error instanceof MixedComparisonError && error.code === code);

test('M5 exact shared answer bytes, stable selection and JSON key order', () => {
  const result = packed([{ text: 'First source.' }, { text: 'Second source.' }]);
  assert.deepEqual(result.request, { model: MIXED_ANSWER_MODEL,
    messages: [{ role: 'system', content: PUBLIC_ANSWER_INSTRUCTION },
      { role: 'user', content: JSON.stringify({ evidence: [
        { text: 'First source.' }, { text: 'Second source.' }], currentQuestion: question }) }],
    temperature: 0, max_tokens: 512, n: 1 });
  assert.equal(JSON.stringify(result.request).startsWith('{"model":'), true);
  assert.equal(result.inputTokens, JSON.stringify(result.request).length);
  assert.equal(result.totalEstimatedTokens, result.inputTokens + 512);
  assert.deepEqual(result.selectedIndices, [0, 1]);
  assert.deepEqual(result.duplicateIndices, []);
  assert.deepEqual(result.omittedIndices, []);
  assert.equal(Object.isFrozen(result.request.messages[1]), true);
});

test('M5 duplicate, over-budget whole unit and later smaller fit remain distinct', () => {
  const large = 'x'.repeat(123_000);
  const result = packed([{ text: 'first' }, { text: 'first' }, { text: large },
    { text: 'last' }]);
  assert.deepEqual(result.selectedIndices, [0, 3]);
  assert.deepEqual(result.duplicateIndices, [1]);
  assert.deepEqual(result.omittedIndices, [2]);
  assert.deepEqual(JSON.parse(result.request.messages[1].content).evidence,
    [{ text: 'first' }, { text: 'last' }]);
});

test('M5 empty evidence is valid, question-only overflow and invalid count fail', () => {
  assert.deepEqual(JSON.parse(packed([]).request.messages[1].content).evidence, []);
  denied({ question, units: [], countTokens: () => 122_489 }, 'question_context_exceeded');
  denied({ question, units: [], countTokens: () => NaN }, 'answer_token_count_unavailable');
  denied({ question, units: [], countTokens: () => Number.MAX_SAFE_INTEGER },
    'answer_token_count_unavailable');
});

test('M5 bounded own-data validation invokes no input getters', () => {
  let read = 0;
  const units = [{ text: 'okay' }];
  Object.defineProperty(units[0], 'text', { enumerable: true,
    get() { read += 1; return 'bad'; } });
  denied({ question, units, countTokens }, 'invalid_answer_options');
  assert.equal(read, 0);
  denied({ question, units: [{ text: '\ud800' }], countTokens }, 'invalid_answer_options');
  denied({ question, units: Array(1), countTokens }, 'invalid_answer_options');
  denied({ question, units: [{ text: '' }], countTokens }, 'invalid_answer_units');
  denied({ question, units: [{ text: 'x'.repeat(1024 * 1024 + 1) }], countTokens },
    'invalid_answer_units');
});
