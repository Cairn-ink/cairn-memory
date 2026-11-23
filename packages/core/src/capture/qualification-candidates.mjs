// Capture boundaries read accessor-backed fields once through a snapshot. The engine may reread them.
// Proxies, functions and symbol values are refused with the entry's invalid code. Some engine entries accept stable Proxies.
import { CoreError } from '../errors.mjs';
import { QUALIFY_CANDIDATES_INLINE_PROMPT as system } from './generated/prompts.mjs';
import { adapterFits, callModel, emitDiagnostic, MIN_CONTEXT_WINDOW } from './model-call.mjs';
import { createQualificationTextCatalog } from './qualification-text-catalog.mjs';
import { countTokens, fittingCap, MODEL_INPUT_TOKENS, MODEL_OUTPUT_TOKENS, modelRequestText, prefixUnits } from './request-size.mjs';
import { boundedText } from '../privacy/text.mjs';
import { validateQualificationInput, validateQualificationSources } from './claim-qualification-input.mjs';
import { detach, fail, isWellFormedText, validateDenseArray, validateObject } from './validate.mjs';

/** @import { Role } from '../ports/common.d.ts' */
/** @import { ModelPort } from '../ports/model.d.ts' */
/** @import { QualificationItem, QualificationReport } from './automatic-qualification.mjs' */
/** @import { Deadline, ModelCallOptions } from './model-call.mjs' */
/** @typedef {ReturnType<typeof createQualificationCandidateSnapshot>} Snapshot */
/** @template {QualificationItem} Item @typedef {ReturnType<typeof createQualificationCandidateSnapshot<Item>>} ItemSnapshot */
/** @typedef {'invalid_qualification' | 'qualification_binding' | 'qualification_citation_budget' |
 *   'qualification_citation_integrity' | 'qualification_label_canonicality'} CompilationReason */

const FIELDS = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];
const LABEL_LIMITS = Object.freeze({ subject: 160, property: 160, scope: 120, applies: 120, value: 160 });
const builtSnapshots = new WeakSet();

/** @param {unknown} value @param {readonly string[]} keys */
function exact(value, keys) {
  const data = validateObject(value, keys);
  if (keys.some(key => !Object.hasOwn(data, key))) fail('invalid_model_output');
  return data;
}

/** @template T @param {T} value @returns {T} */
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/**
 * Immutable source mapping, detached from both caller and model-facing copies.
 * @template {QualificationItem} Item
 * @param {readonly Item[]} items
 */
export function createQualificationCandidateSnapshot(items) {
  return createSnapshot(detach(items, 'invalid_model_output'));
}

/** @template {QualificationItem} Item @param {readonly Item[]} items */
function createSnapshot(items) {
  try {
    const copied = /** @type {Item[]} */ (validateDenseArray(items, 1, 5));
    let candidateIndex = 0;
    const candidates = copied.map(item => {
      validateQualificationSources(item.content, item.receipts);
      if (boundedText(item.content, 600) !== item.content) fail('invalid_model_output');
      // A truncated excerpt can end in whitespace. Canonicalize it again before assigning offsets.
      item.receipts = item.receipts.map(receipt => {
        if (receipt.excerpt.length > 800) fail('invalid_model_output');
        return { ...receipt, excerpt: boundedText(receipt.excerpt, 800, true) };
      });
      /** @type {Array<{candidateIndex: number, receiptIndex: number, start: number, end: number, text: string, role: Role}>} */
      const entries = [];
      item.receipts.forEach((receipt, receiptIndex) => {
        if (boundedText(receipt.excerpt, 800) !== receipt.excerpt) fail('invalid_model_output');
        let start = 0, text = '';
        const flush = () => {
          if (!text.length) return;
          entries.push({ candidateIndex: candidateIndex++, receiptIndex, start, end: start + text.length,
            text, role: receipt.role });
          start += text.length;
          text = '';
        };
        for (const point of receipt.excerpt) {
          if (text.length + point.length > 200) flush();
          text += point;
        }
        flush();
      });
      return entries;
    });
    const input = { items: copied.map((item, itemIndex) => ({ itemIndex, content: item.content, kind: item.kind,
      candidates: candidates[itemIndex].map(({ candidateIndex, role, text }) => ({ candidateIndex, role, text })) })) };
    const snapshot = freeze({ items: copied, candidates, input });
    builtSnapshots.add(snapshot);
    return snapshot;
  } catch { fail('invalid_model_output'); }
}

/** Permit the engine's NFKC-only transformation of descriptive labels.
 * @param {unknown} value @param {number} limit
 */
function canonicalLabel(value, limit) {
  if (value === null) return null;
  if (!isWellFormedText(value) || value.length > limit) fail('invalid_model_output');
  const label = boundedText(value, limit);
  if (label !== value.normalize('NFKC')) fail('invalid_model_output');
  return label;
}

/** Compile selected evidence and canonical labels against their recorded source positions.
 * @param {unknown} output
 * @param {ReturnType<typeof createQualificationCandidateSnapshot>} snapshot
 */
export function compileQualificationCandidates(output, snapshot) {
  try {
    const trustedSnapshot = builtSnapshots.has(snapshot) ? snapshot : undefined;
    const [detached, copiedSnapshot] = detach(
      /** @type {const} */ ([output, trustedSnapshot ? undefined : snapshot]), 'invalid_model_output');
    return compileSnapshot(detached, trustedSnapshot ?? /** @type {typeof snapshot} */ (copiedSnapshot));
  } catch { fail('invalid_model_output'); }
}

/**
 * @template {QualificationItem} Item
 * @param {unknown} output
 * @param {Pick<ItemSnapshot<Item>, 'items' | 'candidates'>} sourceSnapshot
 * @param {(reason: CompilationReason) => void} [onFailure]
 */
function compileSnapshot(output, sourceSnapshot, onFailure) {
  /** @type {CompilationReason} */
  let reason = 'invalid_qualification';
  /** @param {CompilationReason} category @returns {never} */
  function reject(category) {
    reason = category;
    fail('invalid_model_output');
  }
  try {
    const { qualifications } = exact(output, ['qualifications']);
    const entries = validateDenseArray(qualifications, sourceSnapshot.items.length, sourceSnapshot.items.length);
    /** @type {Map<number, {qualification: ReturnType<typeof validateQualificationInput>}>} */
    const compiled = new Map();
    for (const raw of entries) {
      const entry = exact(raw, ['itemIndex', ...FIELDS]);
      const index = entry.itemIndex;
      if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index >= sourceSnapshot.items.length ||
          compiled.has(index)) reject('qualification_binding');
      const candidates = new Map(sourceSnapshot.candidates[index].map(candidate => [candidate.candidateIndex, candidate]));
      /** @type {Map<number, string[]>} */
      const selected = new Map();
      /** @type {Record<string, unknown>} */
      const values = {};
      for (const field of FIELDS) {
        const { value, evidenceIndices } = exact(entry[field], ['value', 'evidenceIndices']);
        if (Array.isArray(evidenceIndices) && evidenceIndices.length > 4) reject('qualification_citation_budget');
        const suppliedReferences = validateDenseArray(evidenceIndices, 0, 4);
        if (new Set(suppliedReferences).size !== suppliedReferences.length || suppliedReferences.some(id =>
          typeof id !== 'number' || !Number.isSafeInteger(id) || !candidates.has(id))) reject('qualification_citation_integrity');
        const references = /** @type {number[]} */ (suppliedReferences);
        const unknown = value === null || ((field === 'attribution' || field === 'commitment') && value === 'unknown');
        if (!unknown && !references.length) reject('qualification_citation_integrity');
        try {
          values[field] = Object.hasOwn(LABEL_LIMITS, field)
            ? canonicalLabel(value, LABEL_LIMITS[/** @type {keyof typeof LABEL_LIMITS} */ (field)]) : value;
        } catch { reject('qualification_label_canonicality'); }
        for (const id of references) {
          const fields = selected.get(id);
          if (fields) fields.push(field);
          else selected.set(id, [field]);
        }
      }
      if (!selected.size) reject('qualification_citation_integrity');
      if (selected.size > 4) reject('qualification_citation_budget');
      const anchors = [...selected].sort(([a], [b]) => a - b).map(([id, fields]) => {
        const { receiptIndex, start, end, text } = /** @type {NonNullable<ReturnType<typeof candidates.get>>} */ (candidates.get(id));
        return { receiptIndex, start, end, text, fields };
      });
      const { subject, property, scope, applies, value, attribution, commitment } = values;
      try {
        const qualification = validateQualificationInput({ version: 1,
          slot: { subject, property, scope, applies }, value, attribution, commitment, anchors }, sourceSnapshot.items[index].receipts);
        compiled.set(index, { qualification });
      } catch { reject('qualification_binding'); }
    }
    return sourceSnapshot.items.map((source, index) => {
      const { proceduralProposal, ...item } = /** @type {typeof source & {proceduralProposal?: boolean}} */ (source);
      return { ...item, ...compiled.get(index) };
    });
  } catch {
    onFailure?.(reason);
    fail('invalid_model_output');
  }
}

/** @template {QualificationItem} Item @param {ItemSnapshot<Item>} snapshot @param {number} index */
function singletonSnapshot(snapshot, index) {
  const source = snapshot.input.items[index];
  return { items: [snapshot.items[index]], candidates: [snapshot.candidates[index]],
    input: { items: [{ ...source, itemIndex: 0 }] } };
}

/** Fit receipt prefixes while keeping original candidate indices and source offsets.
 * @template {QualificationItem} Item
 * @param {ItemSnapshot<Item>} local @param {number} cap
 */
function shortenedSingleton(local, cap) {
  const cut = local.items[0].receipts.map(receipt => prefixUnits(receipt.excerpt, cap).length);
  const partial = new Set();
  const shown = local.candidates[0].flatMap(candidate => {
    const end = Math.min(candidate.end, cut[candidate.receiptIndex]);
    if (end <= candidate.start) return [];
    if (end === candidate.end) return [candidate];
    partial.add(candidate.candidateIndex);
    return [{ ...candidate, end, text: candidate.text.slice(0, end - candidate.start) }];
  });
  return { snapshot: { items: local.items, candidates: [shown] }, input: { items: [{
    ...local.input.items[0], candidates: shown.map(({ candidateIndex, role, text }) => ({
      candidateIndex, role, text, ...(partial.has(candidateIndex) ? { textShortened: true } : {}),
    })),
  }] } };
}

/** @param {unknown} input */
const request = input => ({ system, input, maxOutputTokens: MODEL_OUTPUT_TOKENS });

/** @param {Snapshot['input']} input @param {Deadline | undefined} deadline */
function catalogOf(input, deadline) {
  try { return createQualificationTextCatalog(input).catalog; }
  catch { deadline?.check(); fail('invalid_model_output'); }
}

/**
 * @template {QualificationItem} Item
 * @param {ModelPort | null | undefined} model
 * @param {ItemSnapshot<Item>} snapshot
 * @param {Deadline | undefined} deadline
 * @param {ModelCallOptions} options
 */
function plan(model, snapshot, deadline, { onDiagnostic, qualificationInputMode }) {
  const all = snapshot.items.map((_, index) => index);
  const whole = { groups: [{ indices: all, snapshot, input: snapshot.input }], itemsShortened: 0, itemsUnqualified: 0 };
  deadline?.check();
  if (typeof model?.call !== 'function' || !Number.isSafeInteger(model.contextWindow) ||
      model.contextWindow < MIN_CONTEXT_WINDOW) return whole;

  /** @param {unknown} input */
  function fits(input) {
    deadline?.check();
    let logical;
    try { logical = countTokens(/** @type {ModelPort} */ (model), modelRequestText(system, input)); }
    catch {
      deadline?.check();
      emitDiagnostic(onDiagnostic, 'qualifyCandidates', 'core_call', 'token_count_unavailable');
      fail('token_count_unavailable');
    } finally { deadline?.check(); }
    if (logical > MODEL_INPUT_TOKENS) return false;
    const fitting = adapterFits(/** @type {ModelPort} */ (model), 'qualifyCandidates', request(input), qualificationInputMode);
    deadline?.check();
    return fitting;
  }

  if (fits(snapshot.input)) return whole;
  const useCatalog = qualificationInputMode === 'adaptive-text-catalog-v1';
  deadline?.check();
  if (useCatalog) {
    const catalog = catalogOf(snapshot.input, deadline);
    if (fits(catalog)) return { ...whole, groups: [{ indices: all, snapshot, input: catalog }] };
  }

  /** @type {{indices: number[], snapshot: Pick<ItemSnapshot<Item>, 'items' | 'candidates'>, input: unknown}[]} */
  const groups = [];
  let itemsShortened = 0;
  let itemsUnqualified = 0;
  for (const index of all) {
    deadline?.check();
    const local = singletonSnapshot(snapshot, index);
    if (fits(local.input)) {
      groups.push({ indices: [index], snapshot: local, input: local.input });
      continue;
    }
    if (useCatalog) {
      const catalog = catalogOf(local.input, deadline);
      if (fits(catalog)) {
        groups.push({ indices: [index], snapshot: local, input: catalog });
        continue;
      }
    }
    const longest = Math.max(...local.items[0].receipts.map(receipt => receipt.excerpt.length));
    const cap = fittingCap(longest, units => fits(shortenedSingleton(local, units).input));
    if (cap === null) {
      emitDiagnostic(onDiagnostic, 'qualifyCandidates', 'core_call', 'context_budget_exceeded');
      itemsUnqualified++;
      continue;
    }
    groups.push({ indices: [index], ...shortenedSingleton(local, cap) });
    itemsShortened++;
  }
  return { groups, itemsShortened, itemsUnqualified };
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
  const snapshot = createSnapshot(items);
  deadline?.check();
  let planned;
  try { planned = plan(model, snapshot, deadline, options); }
  catch (error) {
    if (error instanceof CoreError) throw error;
    fail('invalid_model_output');
  }
  /** @type {Map<number, ReturnType<typeof compileSnapshot<Item>>[number]>} */
  const compiled = new Map();
  for (const group of planned.groups) {
    deadline?.check();
    try { options.validateFresh?.(); }
    catch (error) {
      if (error instanceof CoreError) throw error;
      fail('qualification_failed');
    }
    deadline?.check();
    const output = await callModel(model, 'qualifyCandidates', request(group.input), options);
    /** @type {CompilationReason} */
    let reason = 'invalid_qualification';
    try {
      compileSnapshot(output, group.snapshot, category => { reason = category; })
        .forEach((item, position) => compiled.set(group.indices[position], item));
      deadline?.check();
    } catch {
      deadline?.check();
      emitDiagnostic(options.onDiagnostic, 'qualifyCandidates', 'core_validation', reason);
      fail('invalid_model_output');
    }
  }
  report.itemsShortened = planned.itemsShortened;
  report.itemsUnqualified = planned.itemsUnqualified;
  return snapshot.items.map((source, index) => {
    const { proceduralProposal, ...item } = /** @type {typeof source & {proceduralProposal?: boolean}} */ (source);
    return compiled.get(index) ?? item;
  });
}

/**
 * Qualify with candidate citations, planning all groups in each batch before dispatch.
 * @template {QualificationItem} Item
 * @param {ModelPort | null | undefined} model
 * @param {readonly Item[]} items
 * @param {Deadline} [deadline]
 * @param {() => void} [validateFresh]
 * @param {QualificationReport} [report]
 * @param {ModelCallOptions} [callOptions]
 */
export async function qualifyCandidateItems(model, items, deadline, validateFresh, report = {}, callOptions = {}) {
  const copied = detach(items, 'invalid_model_output');
  /** @type {ModelCallOptions} */
  const options = { ...callOptions, qualificationInputMode: callOptions.qualificationInputMode ?? 'adaptive-text-catalog-v1',
    failureCode: 'qualification_failed', deadline,
    validateFresh: validateFresh ?? callOptions.validateFresh };
  if (!Array.isArray(copied)) fail('invalid_model_output');
  if (copied.length <= 5) return qualifyBatch(model, copied, deadline, report, options);
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
}
