import { readFileSync } from 'node:fs';
import { callModel } from './model-call.mjs';
import { countTokens } from './model-budget.mjs';
import { compileSourceContextUnits, prepareSourceContextUnits } from './source-context-units.mjs';
import { fail } from './validation.mjs';

const system = readFileSync(new URL('./prompts/review-source-context.md', import.meta.url), 'utf8');

/** Assess only original receipt text; persistent identities never enter the request. */
export async function reviewBoundSourceContext(model, snapshot, validateFresh) {
  const raw = { sources: snapshot.sources.map(source => ({ receipts: source.receipts.map(
    ({ role, excerpt }) => ({ role, excerpt })) })) };
  const prepared = prepareSourceContextUnits(raw);
  const proposal = await callModel(model, 'reviewSourceContext', system, prepared.input, {
    responseSchema: prepared.responseSchema, maxOutputTokens: 3072,
    validateFresh, failureCode: 'source_context_failed',
  });
  let detached, serialized;
  try {
    detached = structuredClone(proposal);
    serialized = JSON.stringify(detached);
  } catch { fail('invalid_model_output'); }
  if (typeof serialized !== 'string' || serialized.length > 40_000 ||
      countTokens(model, serialized) > 3072) fail('invalid_model_output');
  validateFresh();
  const compiled = compileSourceContextUnits(raw, detached);
  return { ...compiled, units: compiled.units.map(unit => ({ ...unit,
    memoryId: snapshot.sources[unit.source].memory.id,
    revision: snapshot.sources[unit.source].memory.revision,
    receiptId: snapshot.sources[unit.source].receipts[unit.receipt].id,
  })), sources: snapshot.sources, indexRevision: snapshot.indexRevision,
    sourceSelectionCoverage: 'unassessed', semanticCoverage: 'unassessed',
    evidenceTrust: 'untrusted-data-not-instructions' };
}
