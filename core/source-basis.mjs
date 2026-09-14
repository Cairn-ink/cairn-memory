import { readFileSync } from 'node:fs';
import { callModel } from './model-call.mjs';
import { countTokens } from './model-budget.mjs';
import { object, denseArray, fail } from './validation.mjs';
import { emitDiagnostic } from './model-diagnostics.mjs';
import { sourceParts, sourceAddressAnchor } from './source-addresses.mjs';

const system = readFileSync(new URL('./prompts/review-decision-basis.md', import.meta.url), 'utf8');
const addressedSystem = readFileSync(new URL('./prompts/review-addressed-basis.md', import.meta.url), 'utf8');
const contextFields = ['subject', 'applies', 'scope', 'commitment'];
const contextInstructions = `
In source-context-v1 mode each unit also requires context with exactly subject,
applies, scope and commitment. Each field is null when unresolved, or an exact
unique quote of at most 200 characters from the SAME receipt as that unit.
subject cites whose claim or decision this is, including reported attribution.
applies cites when the claim applies: event time is not report arrival time.
scope cites conditions and normal versus temporary or exceptional applicability.
commitment cites adoption, consideration, rejection or explicitly unadopted advice.
These are source quotes, not normalized labels, inferred dates or truth flags.
Do not borrow context from another receipt or invent missing context. Null means
unresolved, not universal applicability or adoption. Use the full supplied sources
to assess links; matching context quotes alone do not prove compatibility.
Preserve the existing eight-unit, ten-link and output-token bounds. Do not merge
different reasons merely to fit more context, or claim omitted context is known.
`;
const exact = (value, keys) => {
  object(value, keys);
  if (keys.some(key => !Object.hasOwn(value, key))) fail('invalid_model_output');
};
const at = (items, index) => {
  if (!Number.isSafeInteger(index) || index < 0 || index >= items.length) fail('invalid_model_output');
  return items[index];
};
const quoteAnchor = (text, excerpt) => {
  if (typeof text !== 'string' || !text.isWellFormed() || !text.trim().length || text.length > 200) {
    fail('invalid_model_output');
  }
  const start = excerpt.indexOf(text);
  if (start < 0 || excerpt.indexOf(text, start + 1) !== -1) fail('invalid_model_output');
  return { start, end: start + text.length, text };
};

/** Compile provenance and proposed role constraints, never semantic validity. */
export function compileDecisionBasis(output, sources, inputMode) {
  if (inputMode !== undefined && !['source-context-v1', 'source-addressed-v1'].includes(inputMode)) fail('invalid_input');
  const addressed = inputMode === 'source-addressed-v1';
  try { output = structuredClone(output); } catch { fail('invalid_model_output'); }
  exact(output, ['units', 'links']);
  const seen = new Set();
  const units = denseArray(output.units, 0, 8).map((unit, index) => {
    exact(unit, ['memory', 'receipt', ...(addressed ? ['startPart', 'endPart'] : ['quote']),
      'role', ...(inputMode ? ['context'] : [])]);
    if (!['decision', 'premise', 'update', ...(addressed ? ['premise-update'] : [])].includes(unit.role)) fail('invalid_model_output');
    const source = at(sources, unit.memory); const receipt = at(source.receipts, unit.receipt);
    const anchor = addressed
      ? sourceAddressAnchor({ startPart: unit.startPart, endPart: unit.endPart }, receipt.excerpt)
      : quoteAnchor(unit.quote, receipt.excerpt);
    const key = JSON.stringify([unit.memory, unit.receipt, unit.role, anchor.start, anchor.end]);
    if (seen.has(key)) fail('invalid_model_output'); seen.add(key);
    let context;
    if (inputMode) {
      exact(unit.context, contextFields);
      context = Object.fromEntries(contextFields.map(field => {
        const text = unit.context[field];
        if (text === null) return [field, null];
        return [field, addressed ? sourceAddressAnchor(text, receipt.excerpt) : quoteAnchor(text, receipt.excerpt)];
      }));
    }
    return { index, role: unit.role, memoryId: source.memory.id, revision: source.memory.revision,
      receiptId: receipt.id, anchor,
      ...(inputMode ? { context } : {}),
      interpretationStatus: 'model-proposed' };
  });
  const links = denseArray(output.links, 0, 10).map(link => {
    exact(link, ['from', 'to', 'relation']);
    const from = at(units, link.from); const to = at(units, link.to);
    if (from.index === to.index || !(link.relation === 'supports-decision'
      ? ['premise', 'premise-update'].includes(from.role) && to.role === 'decision'
      : link.relation === 'challenges-current-basis' && ['update', 'premise-update'].includes(from.role)
        && ['premise', 'premise-update'].includes(to.role))) {
      fail('invalid_model_output');
    }
    const key = JSON.stringify([link.from, link.to, link.relation]);
    if (seen.has(key)) fail('invalid_model_output'); seen.add(key);
    return { from: link.from, to: link.to, relation: link.relation, interpretationStatus: 'model-proposed' };
  });
  // A current-basis challenge must belong to a proposed decision chain. This
  // proves graph structure only, not adoption or agreement of time and scope.
  const supportedPremises = new Set(links.filter(link => link.relation === 'supports-decision').map(link => link.from));
  if (links.some(link => link.relation === 'challenges-current-basis' && !supportedPremises.has(link.to))) {
    fail('invalid_model_output');
  }
  return { units, links };
}

export async function reviewSourceBasis(model, sources, validateFresh, inputMode) {
  if (inputMode !== undefined && !['source-context-v1', 'source-addressed-v1'].includes(inputMode)) fail('invalid_input');
  const addressed = inputMode === 'source-addressed-v1';
  const prompt = addressed ? addressedSystem : system + (inputMode ? contextInstructions : '');
  const output = await callModel(model, 'reviewBasis', prompt, {
    ...(inputMode ? { inputMode } : {}),
    memories: sources.map((source, index) => ({ index,
      receipts: source.receipts.map(({ role, excerpt }, index) => ({ index, role, excerpt,
        ...(addressed ? { parts: sourceParts(excerpt) } : {}) })) })),
  }, { validateFresh, failureCode: 'rationale_failed' });
  // Adapter objects may have changing getters. Recheck the detached proposal
  // that compilation actually consumes, not an earlier serialization of it.
  let snapshot, text;
  try { snapshot = structuredClone(output); text = JSON.stringify(snapshot); }
  catch { emitDiagnostic(model, 'reviewBasis', 'core_validation', 'invalid_rationale'); fail('invalid_model_output'); }
  validateFresh();
  if (typeof text !== 'string' || text.length > 40_000 || countTokens(model, text) > 1024) {
    emitDiagnostic(model, 'reviewBasis', 'core_validation', 'invalid_rationale'); fail('invalid_model_output');
  }
  validateFresh();
  try { return compileDecisionBasis(snapshot, sources, inputMode); }
  catch { emitDiagnostic(model, 'reviewBasis', 'core_validation', 'invalid_rationale'); fail('invalid_model_output'); }
}
