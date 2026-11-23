// Capture boundaries read accessor-backed fields once through a snapshot. The engine may reread them.
// Proxies, functions and symbol values are refused with the entry's invalid code. Some engine entries accept stable Proxies.
import { boundedText } from '../privacy/text.mjs';
import { validateQualificationInput, validateQualificationSources } from './claim-qualification-input.mjs';
import { detach, fail, isWellFormedText, validateDenseArray, validateObject } from './validate.mjs';

/** @import { MemoryKind, Role } from '../ports/common.d.ts' */

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

/** Immutable source mapping, detached from both caller and model-facing copies.
 * @template {{content: string, kind: MemoryKind, receipts: ReadonlyArray<{excerpt: string, role: Role}>}} Item
 * @param {readonly Item[]} items
 */
export function createQualificationCandidateSnapshot(items) {
  try {
    const copied = /** @type {Item[]} */ (validateDenseArray(structuredClone(items), 1, 5));
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
    const sourceSnapshot = trustedSnapshot ?? /** @type {typeof snapshot} */ (copiedSnapshot);
    const { qualifications } = exact(detached, ['qualifications']);
    const entries = validateDenseArray(qualifications, sourceSnapshot.items.length, sourceSnapshot.items.length);
    /** @type {Map<number, {qualification: ReturnType<typeof validateQualificationInput>}>} */
    const compiled = new Map();
    for (const raw of entries) {
      const entry = exact(raw, ['itemIndex', ...FIELDS]);
      const index = entry.itemIndex;
      if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index >= sourceSnapshot.items.length ||
          compiled.has(index)) fail('invalid_model_output');
      const candidates = new Map(sourceSnapshot.candidates[index].map(candidate => [candidate.candidateIndex, candidate]));
      /** @type {Map<number, string[]>} */
      const selected = new Map();
      /** @type {Record<string, unknown>} */
      const values = {};
      for (const field of FIELDS) {
        const { value, evidenceIndices } = exact(entry[field], ['value', 'evidenceIndices']);
        const suppliedReferences = validateDenseArray(evidenceIndices, 0, 4);
        if (new Set(suppliedReferences).size !== suppliedReferences.length || suppliedReferences.some(id =>
          typeof id !== 'number' || !Number.isSafeInteger(id) || !candidates.has(id))) fail('invalid_model_output');
        const references = /** @type {number[]} */ (suppliedReferences);
        const unknown = value === null || ((field === 'attribution' || field === 'commitment') && value === 'unknown');
        if (!unknown && !references.length) fail('invalid_model_output');
        values[field] = Object.hasOwn(LABEL_LIMITS, field)
          ? canonicalLabel(value, LABEL_LIMITS[/** @type {keyof typeof LABEL_LIMITS} */ (field)]) : value;
        for (const id of references) {
          const fields = selected.get(id);
          if (fields) fields.push(field);
          else selected.set(id, [field]);
        }
      }
      if (!selected.size || selected.size > 4) fail('invalid_model_output');
      const anchors = [...selected].sort(([a], [b]) => a - b).map(([id, fields]) => {
        const { receiptIndex, start, end, text } = /** @type {NonNullable<ReturnType<typeof candidates.get>>} */ (candidates.get(id));
        return { receiptIndex, start, end, text, fields };
      });
      const { subject, property, scope, applies, value, attribution, commitment } = values;
      const qualification = validateQualificationInput({ version: 1,
        slot: { subject, property, scope, applies }, value, attribution, commitment, anchors }, sourceSnapshot.items[index].receipts);
      compiled.set(index, { qualification });
    }
    return sourceSnapshot.items.map((source, index) => {
      const { proceduralProposal, ...item } = /** @type {typeof source & {proceduralProposal?: boolean}} */ (source);
      return { ...item, ...compiled.get(index) };
    });
  } catch { fail('invalid_model_output'); }
}
