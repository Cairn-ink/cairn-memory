import { readFileSync } from 'node:fs';
import { qualificationInput, qualificationSources } from './claim-qualification-input.mjs';
import { boundedText, denseArray, fail, object } from './validation.mjs';
import { callModel } from './model-call.mjs';
import { emitDiagnostic } from './model-diagnostics.mjs';

const FIELDS = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];
const LABEL_LIMITS = Object.freeze({ subject: 160, property: 160, scope: 120, applies: 120, value: 160 });
const system = readFileSync(new URL('./prompts/qualify-candidates.md', import.meta.url), 'utf8');
const exact = (value, keys) => {
  object(value, keys);
  if (keys.some(key => !Object.hasOwn(value, key))) fail('invalid_model_output');
};
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
};

/** Immutable source mapping, detached from both caller and model-facing copies. */
export function createQualificationCandidateSnapshot(items) {
  try {
    const copied = structuredClone(denseArray(items, 1, 5));
    let candidateIndex = 0;
    const candidates = copied.map(item => {
      qualificationSources(item.content, item.receipts);
      if (boundedText(item.content, 600) !== item.content) fail('invalid_model_output');
      // Extraction truncates after normalization, so its 800-unit boundary can
      // end in whitespace. Admission canonicalizes that receipt again. Apply
      // the same boundedText operation here, before exposing any candidate or
      // compiling offsets, so both use the exact text that will be stored.
      // Never extend the retained source or change the v1 extraction contract.
      item.receipts = item.receipts.map(receipt => {
        if (receipt.excerpt.length > 800) fail('invalid_model_output');
        return { ...receipt, excerpt: boundedText(receipt.excerpt, 800, true) };
      });
      const entries = [];
      item.receipts.forEach((receipt, receiptIndex) => {
        if (boundedText(receipt.excerpt, 800) !== receipt.excerpt) fail('invalid_model_output');
        let start = 0, text = '';
        const flush = () => {
          if (!text.length) return;
          entries.push({ candidateIndex: candidateIndex++, receiptIndex, start, end: start + text.length,
            text, role: receipt.role });
          start += text.length; text = '';
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
    return freeze({ items: copied, candidates, input });
  } catch { fail('invalid_model_output'); }
}

// Descriptive labels, unlike exact source anchors, have a declared v2 NFKC
// compilation step. S1 still validates the result without sanitizing or truncating.
function canonicalLabel(value, limit) {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.isWellFormed() || value.length > limit) fail('invalid_model_output');
  return value.normalize('NFKC');
}

/** Compile selected evidence and canonical labels; never infer semantic support. */
function compileQualification(output, snapshot, onFailure) {
  let reason = 'invalid_qualification';
  const reject = (category) => { reason = category; fail('invalid_model_output'); };
  try {
    exact(output, ['qualifications']);
    const entries = denseArray(output.qualifications, snapshot.items.length, snapshot.items.length);
    const compiled = new Map();
    for (const entry of entries) {
      exact(entry, ['itemIndex', ...FIELDS]);
      const index = entry.itemIndex;
      if (!Number.isSafeInteger(index) || index < 0 || index >= snapshot.items.length || compiled.has(index)) {
        reject('qualification_binding');
      }
      const candidates = new Map(snapshot.candidates[index].map(candidate => [candidate.candidateIndex, candidate]));
      const selected = new Map();
      const values = {};
      for (const field of FIELDS) {
        exact(entry[field], ['value', 'evidenceIndices']);
        const value = entry[field].value;
        if (Array.isArray(entry[field].evidenceIndices) && entry[field].evidenceIndices.length > 4) {
          reject('qualification_citation_budget');
        }
        const references = denseArray(entry[field].evidenceIndices, 0, 4);
        if (new Set(references).size !== references.length || references.some(id =>
          !Number.isSafeInteger(id) || !candidates.has(id))) reject('qualification_citation_integrity');
        const unknown = value === null || (['attribution', 'commitment'].includes(field) && value === 'unknown');
        if (!unknown && !references.length) reject('qualification_citation_integrity');
        if (Object.hasOwn(LABEL_LIMITS, field)) {
          try {
            const label = canonicalLabel(value, LABEL_LIMITS[field]);
            if (label !== null && (label.length > LABEL_LIMITS[field]
              || boundedText(label, LABEL_LIMITS[field]) !== label)) {
              reject('qualification_label_canonicality');
            }
            values[field] = label;
          } catch { reject('qualification_label_canonicality'); }
        } else values[field] = value;
        for (const id of references) {
          if (!selected.has(id)) selected.set(id, []);
          selected.get(id).push(field);
        }
      }
      if (!selected.size) reject('qualification_citation_integrity');
      if (selected.size > 4) reject('qualification_citation_budget');
      const anchors = [...selected.keys()].sort((a, b) => a - b).map(id => {
        const { receiptIndex, start, end, text } = candidates.get(id);
        return { receiptIndex, start, end, text, fields: selected.get(id) };
      });
      let qualification;
      try {
        qualification = qualificationInput({ version: 1,
          slot: Object.fromEntries(['subject', 'property', 'scope', 'applies'].map(field => [field, values[field]])),
          value: values.value, attribution: values.attribution, commitment: values.commitment, anchors }, snapshot.items[index].receipts);
      } catch { reject('qualification_binding'); }
      compiled.set(index, qualification);
    }
    return snapshot.items.map((item, index) => ({ ...item, qualification: compiled.get(index) }));
  } catch {
    try { onFailure?.(reason); } catch { /* Diagnostics cannot change validation. */ }
    fail('invalid_model_output');
  }
}

export function compileQualificationCandidates(output, snapshot) {
  return compileQualification(output, snapshot);
}

export async function qualifyCandidateItems(model, items, deadline) {
  deadline?.check();
  const snapshot = createQualificationCandidateSnapshot(items);
  deadline?.check();
  const output = await callModel(model, 'qualifyCandidates', system, snapshot.input,
    { failureCode: 'qualification_failed', deadline });
  let reason = 'invalid_qualification';
  try {
    const result = compileQualification(output, snapshot, (category) => { reason = category; });
    deadline?.check();
    return result;
  }
  catch {
    deadline?.check();
    emitDiagnostic(model, 'qualifyCandidates', 'core_validation', reason);
    fail('invalid_model_output');
  }
}
