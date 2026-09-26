import { PUBLIC_ANSWER_INSTRUCTION } from './public-comparison.mjs';
import { dense, exact, fail, freeze, snapshotJson, safeInteger, wellFormed } from './mixed-validation.mjs';

export const MIXED_ANSWER_MODEL = 'gpt-4.1-mini-2025-04-14';
export const MIXED_ANSWER_CONTEXT_WINDOW = 123_000;
export const MIXED_ANSWER_OUTPUT_TOKENS = 512;
export const MIXED_ANSWER_TIMEOUT_MS = 200_000;

function optionsData(options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)
    || Object.getPrototypeOf(options) !== Object.prototype) fail('invalid_answer_options');
  const keys = Reflect.ownKeys(options);
  if (keys.length !== 3 || ['question', 'units', 'countTokens'].some(key => !keys.includes(key))) {
    fail('invalid_answer_options');
  }
  const values = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      fail('invalid_answer_options');
    }
    values[key] = descriptor.value;
  }
  if (typeof values.countTokens !== 'function') fail('invalid_answer_options');
  return values;
}

function answerRequest(question, texts) {
  const evidence = texts.map(text => ({ text }));
  return { model: MIXED_ANSWER_MODEL, messages: [
    { role: 'system', content: PUBLIC_ANSWER_INSTRUCTION },
    { role: 'user', content: JSON.stringify({ evidence,
      currentQuestion: { text: question.text, date: question.date } }) },
  ], temperature: 0, max_tokens: MIXED_ANSWER_OUTPUT_TOKENS, n: 1 };
}

export function packMixedAnswer(options) {
  const { question: inputQuestion, units: inputUnits, countTokens } = optionsData(options);
  const data = snapshotJson({ question: inputQuestion, units: inputUnits },
    { bytes: 7 * 1024 * 1024, nodes: 128, depth: 4 }, 'invalid_answer_options');
  const question = exact(data.question, ['text', 'date'], 'invalid_answer_question');
  if (!wellFormed(question.text) || !question.text.trim()
    || Buffer.byteLength(question.text, 'utf8') > 16 * 1024
    || !wellFormed(question.date) || !question.date.trim()
    || Buffer.byteLength(question.date, 'utf8') > 128) fail('invalid_answer_question');
  const units = dense(data.units, 0, 6, 'invalid_answer_units');
  for (const unit of units) {
    exact(unit, ['text'], 'invalid_answer_units');
    if (!wellFormed(unit.text) || !unit.text
      || Buffer.byteLength(unit.text, 'utf8') > 1024 * 1024) fail('invalid_answer_units');
  }
  const measure = texts => {
    const request = answerRequest(question, texts);
    let inputTokens;
    try { inputTokens = countTokens(JSON.stringify(request)); }
    catch { fail('answer_token_count_unavailable'); }
    if (!safeInteger(inputTokens)) fail('answer_token_count_unavailable');
    const totalEstimatedTokens = inputTokens + MIXED_ANSWER_OUTPUT_TOKENS;
    if (!safeInteger(totalEstimatedTokens)) fail('answer_token_count_unavailable');
    return { request, inputTokens, reservedOutputTokens: MIXED_ANSWER_OUTPUT_TOKENS,
      totalEstimatedTokens };
  };
  const selectedIndices = [], duplicateIndices = [], omittedIndices = [];
  const selectedTexts = [], seen = new Set();
  let measured = measure([]);
  if (measured.totalEstimatedTokens > MIXED_ANSWER_CONTEXT_WINDOW) fail('question_context_exceeded');
  for (const [index, unit] of units.entries()) {
    if (seen.has(unit.text)) { duplicateIndices.push(index); continue; }
    seen.add(unit.text);
    const candidate = measure([...selectedTexts, unit.text]);
    if (candidate.totalEstimatedTokens > MIXED_ANSWER_CONTEXT_WINDOW) {
      omittedIndices.push(index);
      continue;
    }
    selectedIndices.push(index);
    selectedTexts.push(unit.text);
    measured = candidate;
  }
  return freeze({ request: measured.request, inputTokens: measured.inputTokens,
    reservedOutputTokens: measured.reservedOutputTokens,
    totalEstimatedTokens: measured.totalEstimatedTokens,
    selectedIndices, duplicateIndices, omittedIndices });
}
