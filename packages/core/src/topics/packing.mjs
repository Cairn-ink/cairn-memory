import { MODEL_INPUT_TOKENS, TEXT_FLOOR, modelRequestText, countTokens } from '../capture/request-size.mjs';

/** @import { ModelPort } from '../ports/model.d.ts' */
/** @import { ClassificationInput, ClassificationPacking } from './packing.mjs' */

/** Largest integer in [low, high] accepted by fits, given that low is.
 * @param {number} low @param {number} high @param {(value: number) => boolean} fits
 */
function largest(low, high, fits) {
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) low = middle; else high = middle - 1;
  }
  return low;
}

/**
 * Shorten memory text to a common cap before omitting topics from the catalog tail.
 * @param {Pick<ModelPort, 'countTokens'>} model
 * @param {string} system
 * @param {ClassificationInput} input
 * @param {{ check(): void }} [deadline]
 * @returns {ClassificationPacking}
 */
export function packClassification(model, system, input, deadline) {
  /** @param {ClassificationInput} value */
  const fits = (value) => {
    const text = modelRequestText(system, value);
    deadline?.check();
    const count = countTokens(model, text);
    deadline?.check();
    return count <= MODEL_INPUT_TOKENS;
  };
  if (fits(input)) return { input, memoriesShortened: 0, catalogItemsOmitted: 0, overflow: false };
  const lengths = input.memories.map((memory) => [...memory.content].length);
  /** @param {number} points @param {number} size */
  const view = (points, size) => ({ ...input,
    memories: input.memories.map((memory, index) => lengths[index] <= points ? memory
      : { ...memory, content: [...memory.content].slice(0, points).join(''), contentShortened: true }),
    map: input.map.slice(0, size), mapExhausted: input.mapExhausted && size === input.map.length });
  let size = input.map.length;
  if (!fits(view(TEXT_FLOOR, size))) {
    if (!fits(view(TEXT_FLOOR, 0))) {
      return { input: view(TEXT_FLOOR, 0), memoriesShortened: 0, catalogItemsOmitted: 0, overflow: true };
    }
    size = largest(0, size - 1, (kept) => fits(view(TEXT_FLOOR, kept)));
  }
  const points = largest(TEXT_FLOOR, Math.max(TEXT_FLOOR, ...lengths), (cap) => fits(view(cap, size)));
  return { input: view(points, size), memoriesShortened: lengths.filter((length) => length > points).length,
    catalogItemsOmitted: input.map.length - size, overflow: false };
}
