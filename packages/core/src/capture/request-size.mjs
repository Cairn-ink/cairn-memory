import { CoreError } from '../errors.mjs';

/** @import { ModelPort, ModelStage } from '../ports/model.d.ts' */
/** @typedef {'model_timeout' | 'token_count_unavailable' | 'context_budget_exceeded'} SizingReason */
/** @typedef {(stage: ModelStage, layer: 'core_call', reason: SizingReason) => void} Report */

export const MODEL_INPUT_TOKENS = 6000;
export const MODEL_OUTPUT_TOKENS = 1024;
export const TEXT_FLOOR = 120;

/** @type {ReadonlySet<ModelStage>} */
const diagnosticStages = new Set(['extract', 'qualify', 'reconcile', 'classify', 'rationale']);

/** @param {string} system @param {unknown} input @param {number} [maxOutputTokens] */
export const modelRequestText = (system, input, maxOutputTokens = MODEL_OUTPUT_TOKENS) =>
  JSON.stringify({ system, input, maxOutputTokens });

/**
 * @param {Pick<ModelPort, 'countTokens'>} model
 * @param {string} text
 * @param {() => void} [afterReturn]
 */
export function countTokens(model, text, afterReturn) {
  if (typeof model?.countTokens !== 'function') throw new CoreError('token_count_unavailable');
  let count;
  try { count = model.countTokens(text); }
  catch { throw new CoreError('token_count_unavailable'); }
  if (!Number.isSafeInteger(count) || count < 0) throw new CoreError('token_count_unavailable');
  afterReturn?.();
  return count;
}

/**
 * Check the exact request envelope against the guarded model call's input budget.
 * @param {Pick<ModelPort, 'contextWindow' | 'countTokens'>} model
 * @param {ModelStage} stage
 * @param {{ check(): void }} [deadline]
 * @param {Report} [report]
 */
export function requestFits(model, stage, deadline, report) {
  /** @param {SizingReason} reason */
  const diagnose = (reason) => {
    if (!report || !diagnosticStages.has(stage)) return;
    try { Promise.resolve(report(stage, 'core_call', reason)).catch(() => {}); }
    catch { /* Diagnostics never change the sizing result. */ }
  };
  const check = () => {
    try { deadline?.check(); }
    catch (error) { diagnose('model_timeout'); throw error; }
  };
  /** @param {string} system @param {unknown} input */
  return (system, input) => {
    const text = modelRequestText(system, input);
    check();
    const contextWindow = model?.contextWindow;
    if (!Number.isSafeInteger(contextWindow) || contextWindow < 8192) {
      diagnose('context_budget_exceeded');
      throw new CoreError('context_budget_exceeded');
    }
    let count;
    try { count = countTokens(model, text); }
    catch (error) { diagnose('token_count_unavailable'); throw error; }
    check();
    return count <= MODEL_INPUT_TOKENS;
  };
}

/** The longest prefix of whole code points within `units` UTF-16 units.
 * @param {string} text
 * @param {number} units
 */
export function prefixUnits(text, units) {
  if (text.length <= units) return text;
  let end = units;
  if (end > 0 && /[\uD800-\uDBFF]/u.test(text[end - 1])) end -= 1;
  return text.slice(0, end);
}

/**
 * Find the largest common source-text cap that fits, or null if the floor fails.
 * @param {number} longest
 * @param {(cap: number) => boolean} fits
 */
export function fittingCap(longest, fits) {
  if (!fits(TEXT_FLOOR)) return null;
  let low = TEXT_FLOOR;
  let high = Math.max(TEXT_FLOOR, longest);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) low = middle;
    else high = middle - 1;
  }
  return low;
}
