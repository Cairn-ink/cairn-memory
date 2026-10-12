import { types } from 'node:util';
import { countTokens } from '../../core/model-budget.mjs';
import { fail } from '../../core/validation.mjs';
import { freeze } from '../longmemeval/mixed-validation.mjs';
import { prepareCardPlanRankRequest, compileCardPlan } from './card-plan-rank.mjs';

function fields(value, code) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string'
    || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) fail(code);
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
function check(signal) {
  if (aborted.call(signal)) throw new DOMException('Card planning cancelled', 'AbortError');
}

/** One actual core rank; take the genuine plan only after successful recall. */
export function createCardPlanRankInvocation(baseModel, options) {
  const base = fields(baseModel, 'model_not_configured'), ports = fields(options, 'invalid_input');
  if (Object.keys(ports).length !== 1 || typeof ports.planRank !== 'function') fail('invalid_input');
  if (typeof base.countTokens !== 'function') fail('token_count_unavailable');
  if (!Number.isSafeInteger(base.contextWindow) || base.contextWindow < 8192) fail('context_budget_exceeded');
  const counter = base.countTokens.bind(baseModel), planRank = ports.planRank;
  const bound = Object.fromEntries(Object.entries(base).map(([key, value]) =>
    [key, typeof value === 'function' ? value.bind(baseModel) : value]));
  let state = 'unused', compiled, taken = false;
  const model = Object.freeze({ ...bound, async rank(request) {
    if (state !== 'unused') fail('card_invocation_conflict');
    state = 'planning';
    try {
      const prepared = prepareCardPlanRankRequest(request, counter);
      // Preparation has validated this descriptor and the native AbortSignal.
      const signal = Object.getOwnPropertyDescriptor(request, 'signal').value;
      const raw = await planRank(Object.freeze({ ...prepared.request, signal }));
      check(signal);
      const genuine = compileCardPlan(prepared, raw), result = freeze({ refs: genuine.refs });
      const encoded = JSON.stringify(result);
      if (encoded.length > 40000 || countTokens({ countTokens: counter }, encoded) > 1024) fail('invalid_model_output');
      check(signal);
      compiled = genuine; state = 'returned';
      return result;
    } catch (error) { state = 'failed'; throw error; }
  } });
  return Object.freeze({ model, takePlan() {
    if (state !== 'returned' || taken) fail('invalid_card_plan');
    taken = true;
    return compiled;
  } });
}
