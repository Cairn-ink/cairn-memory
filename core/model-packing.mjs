import { countTokens } from './model-budget.mjs';
import { emitDiagnostic } from './model-diagnostics.mjs';
import { MODEL_INPUT_TOKENS, modelRequestText } from './model-call.mjs';

// Every shortened candidate or memory keeps at least this many code points of
// its text: the width of the navigation label a selector already chose from.
export const TEXT_FLOOR = 120;

// Failures carry the same diagnostics the guarded call would have emitted.
function counter(model, stage, deadline) {
  const check = () => {
    try { deadline?.check(); }
    catch (error) { emitDiagnostic(model, stage, 'core_call', 'model_timeout'); throw error; }
  };
  return (text) => {
    check();
    let count;
    try { count = countTokens(model, text); }
    catch (error) { emitDiagnostic(model, stage, 'core_call', 'token_count_unavailable'); throw error; }
    check();
    return count;
  };
}

// The largest integer in [low, high] accepted by `fits`, given that low is.
function largest(low, high, fits) {
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) low = middle; else high = middle - 1;
  }
  return low;
}

/** Whether a whole request fits, counted exactly as the guarded call counts it. */
export function requestFits(model, stage, deadline) {
  const count = counter(model, stage, deadline);
  return (system, input) => count(modelRequestText(system, input)) <= MODEL_INPUT_TOKENS;
}

/** The longest prefix of whole code points within `units` UTF-16 units. */
export function prefixUnits(text, units) {
  if (text.length <= units) return text;
  let end = units;
  if (end > 0 && /[\uD800-\uDBFF]/u.test(text[end - 1])) end -= 1;
  return text.slice(0, end);
}

/**
 * The largest common source-text cap, at least `TEXT_FLOOR` units, for which
 * `fits(cap)` holds; null when even the floor does not fit.
 */
export function fittingCap(longest, fits) {
  if (!fits(TEXT_FLOOR)) return null;
  return largest(TEXT_FLOOR, Math.max(TEXT_FLOOR, longest), fits);
}

/**
 * Fit select's navigation maps into the model input limit. A request that
 * already fits is returned as the same object. Otherwise items are kept in a
 * round-robin order over namespaces, each page keeping a prefix of its own
 * order, and a page that lost items is shown as not exhausted. `overflow`
 * means even empty maps do not fit, so the guarded call must refuse.
 */
export function packSelect(model, system, input) {
  const count = counter(model, 'select');
  const fits = (value) => count(modelRequestText(system, value)) <= MODEL_INPUT_TOKENS;
  if (fits(input)) return { input, omitted: 0, overflow: false };
  const total = input.maps.reduce((sum, map) => sum + map.items.length, 0);
  const order = [];
  for (let position = 0; order.length < total; position++) {
    input.maps.forEach((map, index) => { if (position < map.items.length) order.push(index); });
  }
  const view = (size) => {
    const kept = input.maps.map(() => 0);
    for (const index of order.slice(0, size)) kept[index]++;
    return { ...input, maps: input.maps.map((map, index) => ({ ...map,
      items: map.items.slice(0, kept[index]),
      exhausted: map.exhausted && kept[index] === map.items.length })) };
  };
  if (!fits(view(0))) return { input: view(0), omitted: total, overflow: true };
  const kept = largest(0, total - 1, (size) => fits(view(size)));
  return { input: view(kept), omitted: total - kept, overflow: false };
}

/**
 * Fit rank's candidates into the model input limit. A request that already
 * fits is returned as the same object. Otherwise candidates are admitted in
 * their existing order while each still fits in its smallest form: text at the
 * floor and one receipt identity. Admitted candidates then share the largest
 * common receipt-list cap that fits, and after that the largest common text
 * cap: anything under a cap stays whole. `textOf(candidate)` returns null for a
 * candidate that may only be sent whole, or `{ points, receipts, view }`: its
 * text length in code points, its receipt count (0 if its list cannot be
 * capped) and `view(n, r)`, the candidate with n code points of text and at
 * most r receipts. Identity fields are never shortened. Only whole requests are
 * measured, so the returned request fits whatever the counter's behavior on
 * fragments. `included` lists the original indices sent, in order.
 */
export function packRank(model, system, input, textOf) {
  const count = counter(model, 'rank');
  const fits = (candidates) => count(modelRequestText(system, { ...input, candidates })) <= MODEL_INPUT_TOKENS;
  const all = input.candidates.map((_, index) => index);
  if (count(modelRequestText(system, input)) <= MODEL_INPUT_TOKENS) {
    return { input, included: all, omitted: 0, shortened: 0, overflow: false };
  }
  const texts = input.candidates.map(textOf);
  const at = (index, cap, receiptCap) => {
    const text = texts[index];
    return text && (text.points > cap || (text.receipts ?? 0) > receiptCap)
      ? text.view(cap, receiptCap) : input.candidates[index];
  };
  const views = (indices, cap, receiptCap) => indices.map((index) => at(index, cap, receiptCap));
  let included = all;
  if (!fits(views(all, TEXT_FLOOR, 1))) {
    if (!fits([])) {
      return { input: { ...input, candidates: [] }, included: [], omitted: all.length, shortened: 0, overflow: true };
    }
    included = [];
    for (const index of all) if (fits(views([...included, index], TEXT_FLOOR, 1))) included.push(index);
  }
  // The smallest forms are known to fit; widen receipt lists first, then text.
  const receiptCap = largest(1, Math.max(1, ...included.map((index) => texts[index]?.receipts ?? 0)),
    (receipts) => fits(views(included, TEXT_FLOOR, receipts)));
  const cap = largest(TEXT_FLOOR, Math.max(TEXT_FLOOR, ...included.map((index) => texts[index]?.points ?? 0)),
    (points) => fits(views(included, points, receiptCap)));
  const candidates = views(included, cap, receiptCap);
  return { input: { ...input, candidates }, included, omitted: all.length - included.length,
    shortened: candidates.filter((candidate, position) => candidate !== input.candidates[included[position]]).length,
    overflow: false };
}

/**
 * Fit classify's memories and topic catalog into the model input limit. A
 * request that already fits is returned as the same object. Memory bodies are
 * first cut to a common prefix cap of at least the floor with the catalog
 * complete; only if that cannot fit is the catalog's tail left out, which marks
 * it incomplete so no new topic may be proposed. IDs and revisions stay whole.
 */
export function packClassification(model, system, input, deadline) {
  const count = counter(model, 'classify', deadline);
  const fits = (value) => count(modelRequestText(system, value)) <= MODEL_INPUT_TOKENS;
  if (fits(input)) return { input, memoriesShortened: 0, catalogItemsOmitted: 0, overflow: false };
  const lengths = input.memories.map((memory) => [...memory.content].length);
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
