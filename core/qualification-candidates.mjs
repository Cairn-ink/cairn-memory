import { qualificationInput, qualificationSources } from './claim-qualification-input.mjs';
import { standardInlineQualificationPrompt, qualificationCandidatesPrompt } from './qualification-candidates-prompt.mjs';
import { boundedText, denseArray, fail, object } from './validation.mjs';
import { callModel } from './model-call.mjs';
import { emitDiagnostic } from './model-diagnostics.mjs';
import { countTokens } from './model-budget.mjs';
import { createQualificationTextCatalog } from './qualification-text-catalog.mjs';
import { fittingCap, prefixUnits } from './model-packing.mjs';
import { isPromise } from 'node:util/types';

const FIELDS = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];
const LABEL_LIMITS = Object.freeze({ subject: 160, property: 160, scope: 120, applies: 120, value: 160 });
const legacySystem = standardInlineQualificationPrompt;
const episodeSystem = qualificationCandidatesPrompt(new URL('./prompts/qualify-episode-candidates.md', import.meta.url));
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
function compileQualification(output, snapshot, onFailure, episode = false) {
  let reason = 'invalid_qualification';
  const reject = (category) => { reason = category; fail('invalid_model_output'); };
  try {
    exact(output, ['qualifications']);
    const entries = denseArray(output.qualifications, snapshot.items.length, snapshot.items.length);
    const compiled = new Map();
    for (const entry of entries) {
      if (!episode) exact(entry, ['itemIndex', ...FIELDS]);
      else {
        object(entry, ['itemIndex', ...FIELDS, 'procedural']);
        if (['itemIndex', ...FIELDS].some(key => !Object.hasOwn(entry, key))) reject('qualification_binding');
      }
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
      let procedural;
      if (Object.hasOwn(entry, 'procedural')) {
        if (!['instruction','preference'].includes(snapshot.items[index].kind)) reject('qualification_binding');
        exact(entry.procedural, ['evidenceIndices']);
        const references = denseArray(entry.procedural.evidenceIndices, 1, 4);
        if (new Set(references).size !== references.length || references.some(id => !Number.isSafeInteger(id) || !candidates.has(id))) reject('qualification_citation_integrity');
        procedural = { anchors: references.map(id => {
          const { receiptIndex, start, end } = candidates.get(id);
          return { receiptIndex, start, end };
        }) };
      }
      compiled.set(index, { qualification, ...(procedural ? { procedural } : {}) });
    }
    return snapshot.items.map(({ proceduralProposal, ...item }, index) => ({ ...item, ...compiled.get(index) }));
  } catch {
    try { onFailure?.(reason); } catch { /* Diagnostics cannot change validation. */ }
    fail('invalid_model_output');
  }
}

export function compileQualificationCandidates(output, snapshot) {
  return compileQualification(output, snapshot);
}

function qualificationFit(model, deadline) {
  deadline?.check();
  if (model === null || model === undefined || !['object', 'function'].includes(typeof model)) return null;
  const reject = () => { emitDiagnostic(model, 'qualifyCandidates', 'core_call', 'token_count_unavailable');
    fail('token_count_unavailable'); };
  let descriptor, inherited = false, lookupFailed = false;
  try {
    descriptor = Object.getOwnPropertyDescriptor(model, 'fitsQualificationRequest');
    if (descriptor === undefined) inherited = Reflect.has(model, 'fitsQualificationRequest');
  } catch { lookupFailed = true; }
  deadline?.check();
  // An inherited capability could be a throwing getter or a mutable function.
  // Accept only an explicit own-data callable; never invoke a prototype value.
  if (lookupFailed || inherited) reject();
  // Without an adapter capability, plan by the core count alone. A port that
  // is missing or misconfigured is left to the guarded call's own errors.
  if (descriptor === undefined && (typeof model.qualifyCandidates !== 'function' ||
      !Number.isSafeInteger(model.contextWindow) || model.contextWindow < 8192)) return null;
  if (descriptor !== undefined && (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function')) {
    reject();
  }
  const fit = descriptor?.value;
  return (request) => {
    deadline?.check();
    let logical;
    try { logical = countTokens(model, JSON.stringify(request)); }
    catch { deadline?.check(); reject(); }
    finally { deadline?.check(); }
    if (logical > 6000) return false;
    if (!fit) return true;
    let result;
    try {
      deadline?.check();
      result = fit.call(model, structuredClone(request));
      if (isPromise(result)) {
        // Reject the nonboolean synchronously without leaving a native
        // rejected promise unobserved. Never adopt arbitrary thenables.
        Promise.prototype.then.call(result, undefined, () => {});
      }
    } catch { deadline?.check(); reject(); }
    finally { deadline?.check(); }
    if (typeof result !== 'boolean') reject();
    return result;
  };
}

function singletonSnapshot(snapshot, index) {
  const source = snapshot.input.items[index];
  return freeze({ items: [snapshot.items[index]], candidates: [snapshot.candidates[index]],
    input: { items: [{ itemIndex: 0, content: source.content, kind: source.kind,
      candidates: source.candidates }] } });
}

// One item with each receipt's text cut to a prefix of at most `cap` units.
// Candidates keep their original indices and every receipt keeps its first
// one; a candidate wholly past the cut is not sent, a straddling one is cut
// and marked. Anchors compile from the shown text, a prefix of the source.
function shortenedSingleton(local, cap) {
  const cut = local.items[0].receipts.map((receipt) => prefixUnits(receipt.excerpt, cap).length);
  const partial = new Set();
  const shown = local.candidates[0].flatMap((candidate) => {
    const end = Math.min(candidate.end, cut[candidate.receiptIndex]);
    if (end <= candidate.start) return [];
    if (end === candidate.end) return [candidate];
    partial.add(candidate.candidateIndex);
    return [{ ...candidate, end, text: candidate.text.slice(0, end - candidate.start) }];
  });
  const source = local.input.items[0];
  return { snapshot: { items: local.items, candidates: [shown] },
    input: { items: [{ itemIndex: 0, content: source.content, kind: source.kind,
      candidates: shown.map(({ candidateIndex, role, text }) => ({ candidateIndex, role, text,
        ...(partial.has(candidateIndex) ? { textShortened: true } : {}) })) }] } };
}

/**
 * Plan every group before the first request: all items, else their text
 * catalog, else one request per item (inline, then catalog). An item that
 * cannot fit alone is sent with its receipt text cut to a common prefix of at
 * least 120 units; if even that cannot fit it stays unqualified. Size never
 * fails the capture. `report` receives how many items were shortened or left
 * unqualified.
 */
export async function qualifyCandidateItems(model, items, deadline, assertCaptureEvidence, episode = false, report = {}) {
  deadline?.check();
  const system = episode ? episodeSystem : legacySystem;
  const snapshot = createQualificationCandidateSnapshot(items);
  deadline?.check();
  const all = snapshot.items.map((_, index) => index);
  let groups = [{ indices: all, snapshot, input: snapshot.input }];
  const unqualified = [];
  let shortened = 0;
  const fits = qualificationFit(model, deadline);
  const catalogOf = (input) => {
    try { return createQualificationTextCatalog(input).catalog; }
    catch { deadline?.check(); fail('invalid_model_output'); }
  };
  if (fits && !fits({ system, input: snapshot.input, maxOutputTokens: 1024 })) {
    deadline?.check();
    const catalog = catalogOf(snapshot.input);
    deadline?.check();
    if (fits({ system, input: catalog, maxOutputTokens: 1024 })) groups = [{ indices: all, snapshot, input: catalog }];
    else {
      groups = [];
      for (const index of all) {
        deadline?.check();
        const local = singletonSnapshot(snapshot, index);
        if (fits({ system, input: local.input, maxOutputTokens: 1024 })) {
          groups.push({ indices: [index], snapshot: local, input: local.input });
          continue;
        }
        const localCatalog = catalogOf(local.input);
        deadline?.check();
        if (fits({ system, input: localCatalog, maxOutputTokens: 1024 })) {
          groups.push({ indices: [index], snapshot: local, input: localCatalog });
          continue;
        }
        const longest = Math.max(...local.items[0].receipts.map((receipt) => receipt.excerpt.length));
        const cap = fittingCap(longest, (units) =>
          fits({ system, input: shortenedSingleton(local, units).input, maxOutputTokens: 1024 }));
        if (cap === null) {
          // Observable, but this item alone stays unqualified; the capture continues.
          emitDiagnostic(model, 'qualifyCandidates', 'core_call', 'context_budget_exceeded');
          unqualified.push(index);
          continue;
        }
        groups.push({ indices: [index], ...shortenedSingleton(local, cap) });
        shortened += 1;
      }
    }
  }
  const compiled = new Map();
  for (const planned of groups) {
    deadline?.check();
    // The capture layer supplies only its scoped, trusted staged-source check.
    // Never dispatch another group after explicit discard/forget during a
    // previously started provider call. Keep this outside compiler handling.
    assertCaptureEvidence?.();
    deadline?.check();
    const output = await callModel(model, 'qualifyCandidates', system, planned.input,
      { failureCode: 'qualification_failed', deadline,
        // Count callbacks run after the outer group check. Recheck the scoped
        // staged source after counting and before dispatch, and after response.
        validateFresh: assertCaptureEvidence });
    let reason = 'invalid_qualification';
    try {
      compileQualification(output, planned.snapshot, (category) => { reason = category; }, episode)
        .forEach((item, position) => compiled.set(planned.indices[position], item));
      deadline?.check();
    }
    catch {
      deadline?.check();
      emitDiagnostic(model, 'qualifyCandidates', 'core_validation', reason);
      fail('invalid_model_output');
    }
  }
  report.itemsShortened = shortened;
  report.itemsUnqualified = unqualified.length;
  return snapshot.items.map(({ proceduralProposal, ...item }, index) => compiled.get(index) ?? item);
}
