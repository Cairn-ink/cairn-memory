import { countTokens } from '../../core/model-budget.mjs';
import { fail, identifier, revision } from '../../core/validation.mjs';

const checkAbort = signal => {
  if (signal.aborted) throw new DOMException('Small candidate retention cancelled', 'AbortError');
};

function descriptors(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('invalid_input');
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(fields).some(key => typeof key !== 'string'
    || !fields[key].enumerable || !Object.hasOwn(fields[key], 'value'))) fail('invalid_input');
  return fields;
}

// Only ordinary JSON data enters the detached, immutable counted request.
function snapshot(value, depth = 0) {
  if (depth > 32) fail('invalid_input');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string' && value.isWellFormed()) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail('invalid_input');
    const fields = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(fields).length !== value.length + 1) fail('invalid_input');
    const result = [];
    for (let i = 0; i < value.length; i++) {
      const field = fields[i];
      if (!field?.enumerable || !Object.hasOwn(field, 'value')) fail('invalid_input');
      result.push(snapshot(field.value, depth + 1));
    }
    return Object.freeze(result);
  }
  const fields = descriptors(value);
  return Object.freeze(Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, snapshot(field.value, depth + 1)])));
}

/** Evaluation policy only. Source freshness remains the shared core's responsibility. */
export function createSmallCandidateRetentionModel(model) {
  if (!model || typeof model !== 'object') fail('model_not_configured');
  const fields = descriptors(model);
  if (typeof fields.rank?.value !== 'function') fail('model_not_configured');
  if (typeof fields.countTokens?.value !== 'function') fail('token_count_unavailable');
  if (!Number.isSafeInteger(fields.contextWindow?.value) || fields.contextWindow.value < 8192) fail('context_budget_exceeded');
  const rank = fields.rank.value.bind(model);
  const counter = Object.freeze({ countTokens: fields.countTokens.value.bind(model) });
  const ports = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value]));
  return Object.freeze({ ...ports, countTokens: counter.countTokens, async rank(request) {
    const shell = descriptors(request);
    if (Object.keys(shell).length !== 4 || !['system', 'input', 'maxOutputTokens', 'signal'].every(key => Object.hasOwn(shell, key))) fail('invalid_input');
    const { system: { value: system }, input: { value: input }, maxOutputTokens: { value: maximum }, signal: { value: signal } } = shell;
    if (typeof system !== 'string' || !system.isWellFormed() || system.length > 24000
      || maximum !== 1024 || !(signal instanceof AbortSignal)) fail('invalid_input');
    checkAbort(signal);
    const clean = snapshot(input);
    if (!clean || typeof clean !== 'object' || Array.isArray(clean) || Object.keys(clean).length !== 3 || typeof clean.query !== 'string' || !clean.query.trim()
      || clean.query.length > 4000 || !Number.isInteger(clean.limit) || clean.limit < 1 || clean.limit > 12
      || !Array.isArray(clean.candidates) || clean.candidates.length > 36) fail('invalid_input');
    const seen = new Set();
    const refs = clean.candidates.map(candidate => {
      try {
        if (!Number.isSafeInteger(candidate.namespaceIndex) || candidate.namespaceIndex < 0) fail('invalid_input');
        const memoryId = identifier(candidate.memory.id), rev = revision(candidate.memory.revision);
        const key = JSON.stringify([candidate.namespaceIndex, memoryId]);
        if (seen.has(key)) fail('invalid_input');
        seen.add(key);
        return Object.freeze({ namespaceIndex: candidate.namespaceIndex, memoryId, revision: rev });
      } catch { fail('invalid_input'); }
    });
    const actual = Object.freeze({ system, input: clean, maxOutputTokens: 1024 });
    const encoded = JSON.stringify(actual);
    if (countTokens(counter, encoded) > 6000) fail('context_budget_exceeded');
    checkAbort(signal);
    if (JSON.stringify(actual) !== encoded) fail('invalid_input');
    if (refs.length > clean.limit) {
      const output = await rank(Object.freeze({ ...actual, signal }));
      checkAbort(signal);
      return output;
    }
    const output = Object.freeze({ refs: Object.freeze(refs) });
    const serialized = JSON.stringify(output);
    if (serialized.length > 40000 || countTokens(counter, serialized) > 1024) fail('invalid_model_output');
    checkAbort(signal);
    if (JSON.stringify(output) !== serialized) fail('invalid_model_output');
    return output;
  } });
}
