import { readFileSync } from 'node:fs';
import { countTokens } from '../../core/model-budget.mjs';
import { fail } from '../../core/validation.mjs';

const baseline = readFileSync(new URL('../../core/prompts/relate-rationale.md', import.meta.url), 'utf8');
const guidance = readFileSync(new URL('./prompts/rationale-temporal-guidance.md', import.meta.url), 'utf8');
const checkAbort = signal => {
  if (signal.aborted) throw new DOMException('Temporal rationale review cancelled', 'AbortError');
};
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

/** Evaluation-only prompt arm. It does not alter core, schema, output, or model defaults. */
export function createTemporalRationaleModel(model) {
  if (!model || typeof model !== 'object' || typeof model.relate !== 'function') fail('model_not_configured');
  if (typeof model.countTokens !== 'function') fail('token_count_unavailable');
  if (!Number.isSafeInteger(model.contextWindow) || model.contextWindow < 8192) fail('context_budget_exceeded');
  const relate = model.relate.bind(model);
  const counter = Object.freeze({ countTokens: model.countTokens.bind(model) });
  return Object.freeze({ ...model, contextWindow: model.contextWindow,
    countTokens: counter.countTokens, async relate(request) {
      if (!request || Object.keys(request).sort().join(',') !== 'input,maxOutputTokens,signal,system' ||
          request.system !== baseline || request.maxOutputTokens !== 1024 ||
          !(request.signal instanceof AbortSignal)) fail('invalid_input');
      const signal = request.signal;
      checkAbort(signal);
      let input;
      try { input = freeze(structuredClone(request.input)); }
      catch { fail('invalid_input'); }
      if (!input || typeof input !== 'object' || Array.isArray(input) ||
          Object.keys(input).join(',') !== 'memories' || !Array.isArray(input.memories) ||
          input.memories.some(memory => !memory || typeof memory !== 'object' ||
            Array.isArray(memory) || Object.hasOwn(memory, 'focus'))) fail('invalid_input');
      const actual = Object.freeze({ system: `${baseline}\n${guidance}`, input, maxOutputTokens: 1024 });
      const encoded = JSON.stringify(actual);
      if (countTokens(counter, encoded) > 6000) fail('context_budget_exceeded');
      checkAbort(signal);
      // The detached input is immutable while arbitrary counter/provider callbacks run.
      const output = await relate(Object.freeze({ ...actual, signal }));
      checkAbort(signal);
      return output;
    } });
}
