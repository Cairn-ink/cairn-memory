import { validateQualificationInput, validateQualificationSources } from './claim-qualification-input.mjs';
import { QUALIFY_MEMORIES_PROMPT as system } from './generated/prompts.mjs';
import { callModel, emitDiagnostic, MIN_CONTEXT_WINDOW, modelError } from './model-call.mjs';
import { fittingCap, MODEL_OUTPUT_TOKENS, prefixUnits, requestFits } from './request-size.mjs';
import { detach, fail, validateDenseArray, validateObject } from './validate.mjs';

/** @import { MemoryKind, Role } from '../ports/common.d.ts' */
/** @import { ModelPort } from '../ports/model.d.ts' */
/** @import { Deadline, ModelCallOptions } from './model-call.mjs' */
/** @typedef {{content: string, kind: MemoryKind, receipts: ReadonlyArray<{excerpt: string, role: Role}>}} QualificationItem */
/** @typedef {{itemsShortened?: number, itemsUnqualified?: number}} QualificationReport */
/** @template Item @typedef {{index: number, item: Item, cap: number}} Entry */

/** @param {readonly Entry<QualificationItem>[]} group */
function request(group) {
  try {
    return { system, maxOutputTokens: MODEL_OUTPUT_TOKENS, input: { items: group.map(({ item, cap }, itemIndex) => ({
      itemIndex, content: item.content, kind: item.kind,
      sources: item.receipts.map(({ role, excerpt }, receiptIndex) => {
        const shown = prefixUnits(excerpt, cap);
        return { receiptIndex, role, excerpt: shown, ...(shown === excerpt ? {} : { excerptShortened: true }) };
      }),
    })) } };
  } catch { fail('invalid_model_output'); }
}

/**
 * @template {QualificationItem} Item
 * @param {ModelPort | null | undefined} model
 * @param {readonly Item[]} items
 * @param {Deadline | undefined} deadline
 * @param {ModelCallOptions} options
 */
function plan(model, items, deadline, { onDiagnostic }) {
  const all = items.map((item, index) => ({ index, item, cap: Infinity }));
  if (typeof model?.call !== 'function' || !Number.isSafeInteger(model.contextWindow) ||
      model.contextWindow < MIN_CONTEXT_WINDOW) return { groups: [all], itemsUnqualified: 0 };

  const countFits = requestFits(model, 'qualify', deadline,
    (_stage, layer, reason) => emitDiagnostic(onDiagnostic, 'qualify', layer, reason));
  /** @param {Entry<Item>[]} group */
  const fits = (group) => {
    const args = request(group);
    return countFits(args.system, args.input);
  };
  if (fits(all)) return { groups: [all], itemsUnqualified: 0 };
  const groups = [];
  let itemsUnqualified = 0;
  for (const entry of all) {
    if (fits([entry])) { groups.push([entry]); continue; }
    const longest = Math.max(...entry.item.receipts.map(receipt => receipt.excerpt.length));
    const cap = fittingCap(longest, units => fits([{ ...entry, cap: units }]));
    if (cap !== null) { groups.push([{ ...entry, cap }]); continue; }
    emitDiagnostic(onDiagnostic, 'qualify', 'core_call', 'context_budget_exceeded');
    itemsUnqualified++;
  }
  return { groups, itemsUnqualified };
}

/**
 * @template {QualificationItem} Item
 * @param {ModelPort | null | undefined} model
 * @param {readonly Item[]} items
 * @param {Deadline | undefined} deadline
 * @param {QualificationReport} report
 * @param {ModelCallOptions} options
 */
async function qualifyBatch(model, items, deadline, report, options) {
  deadline?.check();
  const { groups, itemsUnqualified } = plan(model, items, deadline, options);
  /** @type {Map<number, ReturnType<typeof validateQualificationInput>>} */
  const qualifications = new Map();
  for (const group of groups) {
    const output = await callModel(model, 'qualify', request(group), options);
    try {
      const { qualifications: raw } = validateObject(output, ['qualifications']);
      const entries = validateDenseArray(raw, group.length, group.length);
      const seen = new Set();
      for (const rawEntry of entries) {
        const { itemIndex, qualification } = validateObject(rawEntry, ['itemIndex', 'qualification']);
        if (typeof itemIndex !== 'number' || !Number.isSafeInteger(itemIndex) || itemIndex < 0 ||
            itemIndex >= group.length || seen.has(itemIndex)) fail('invalid_model_output');
        seen.add(itemIndex);
        const { index, item, cap } = group[itemIndex];
        validateQualificationSources(item.content, item.receipts);
        const shown = item.receipts.map(receipt => ({ ...receipt, excerpt: prefixUnits(receipt.excerpt, cap) }));
        qualifications.set(index, validateQualificationInput(qualification, shown));
      }
      deadline?.check();
    } catch {
      deadline?.check();
      emitDiagnostic(options.onDiagnostic, 'qualify', 'core_validation', 'invalid_qualification');
      fail('invalid_model_output');
    }
  }
  report.itemsShortened = groups.flat().filter(entry => entry.cap !== Infinity).length;
  report.itemsUnqualified = itemsUnqualified;
  return items.map((item, index) => qualifications.has(index)
    ? { ...item, qualification: qualifications.get(index) } : item);
}

/**
 * Qualify with excerpt anchors. Only the detached items are used across batches.
 * @template {QualificationItem} Item
 * @param {ModelPort | null | undefined} model
 * @param {readonly Item[]} items
 * @param {Deadline} [deadline]
 * @param {QualificationReport} [report]
 * @param {() => void} [validateFresh]
 * @param {ModelCallOptions} [callOptions]
 */
export async function qualifyExtractedItems(model, items, deadline, report = {}, validateFresh, callOptions = {}) {
  try {
    const copied = detach(items, 'invalid_input');
    /** @type {ModelCallOptions} */
    const options = { ...callOptions, failureCode: 'qualification_failed', deadline,
      validateFresh: validateFresh ?? callOptions.validateFresh };
    if (!Array.isArray(copied)) fail('invalid_input');
    if (copied.length <= 5) return await qualifyBatch(model, copied, deadline, report, options);
    validateDenseArray(copied, 1, 20);
    const result = [];
    report.itemsShortened = 0;
    report.itemsUnqualified = 0;
    for (let start = 0; start < copied.length; start += 5) {
      const part = { itemsShortened: 0, itemsUnqualified: 0 };
      result.push(...await qualifyBatch(model, copied.slice(start, start + 5), deadline, part, options));
      report.itemsShortened += part.itemsShortened;
      report.itemsUnqualified += part.itemsUnqualified;
    }
    return result;
  } catch (error) {
    throw modelError(error);
  }
}
