import { readFileSync } from 'node:fs';
import { callModel } from './model-call.mjs';
import { countTokens } from './model-budget.mjs';
import { object, denseArray, fail } from './validation.mjs';
import { emitDiagnostic } from './model-diagnostics.mjs';

const system = readFileSync(new URL('./prompts/review-decision-basis.md', import.meta.url), 'utf8');
const exact = (value, keys) => {
  object(value, keys);
  if (keys.some(key => !Object.hasOwn(value, key))) fail('invalid_model_output');
};
const at = (items, index) => {
  if (!Number.isSafeInteger(index) || index < 0 || index >= items.length) fail('invalid_model_output');
  return items[index];
};

/** Compile provenance and proposed role constraints, never semantic validity. */
export function compileDecisionBasis(output, sources) {
  try { output = structuredClone(output); } catch { fail('invalid_model_output'); }
  exact(output, ['units', 'links']);
  const seen = new Set();
  const units = denseArray(output.units, 0, 8).map((unit, index) => {
    exact(unit, ['memory', 'receipt', 'quote', 'role']);
    if (!['decision', 'premise', 'update'].includes(unit.role)) fail('invalid_model_output');
    const source = at(sources, unit.memory); const receipt = at(source.receipts, unit.receipt);
    const quote = unit.quote;
    if (typeof quote !== 'string' || !quote.isWellFormed() || !quote.trim().length || quote.length > 200) {
      fail('invalid_model_output');
    }
    const start = receipt.excerpt.indexOf(quote);
    if (start < 0 || receipt.excerpt.indexOf(quote, start + 1) !== -1) fail('invalid_model_output');
    const key = JSON.stringify([unit.memory, unit.receipt, unit.role, quote]);
    if (seen.has(key)) fail('invalid_model_output'); seen.add(key);
    return { index, role: unit.role, memoryId: source.memory.id, revision: source.memory.revision,
      receiptId: receipt.id, anchor: { start, end: start + quote.length, text: quote },
      interpretationStatus: 'model-proposed' };
  });
  const links = denseArray(output.links, 0, 10).map(link => {
    exact(link, ['from', 'to', 'relation']);
    const from = at(units, link.from); const to = at(units, link.to);
    if (from.index === to.index || !(link.relation === 'supports-decision'
      ? from.role === 'premise' && to.role === 'decision'
      : link.relation === 'challenges-current-basis' && from.role === 'update' && to.role === 'premise')) {
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

export async function reviewSourceBasis(model, sources, validateFresh) {
  const output = await callModel(model, 'reviewBasis', system, {
    memories: sources.map((source, index) => ({ index,
      receipts: source.receipts.map(({ role, excerpt }, index) => ({ index, role, excerpt })) })),
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
  try { return compileDecisionBasis(snapshot, sources); }
  catch { emitDiagnostic(model, 'reviewBasis', 'core_validation', 'invalid_rationale'); fail('invalid_model_output'); }
}
