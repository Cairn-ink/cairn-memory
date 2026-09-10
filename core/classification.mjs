import { readFileSync } from 'node:fs';
import { callModel } from './model-call.mjs';
import { placementProposal } from './placement-input.mjs';
import { fail } from './validation.mjs';
import { emitDiagnostic } from './model-diagnostics.mjs';

const system = readFileSync(new URL('./prompts/classify-placement.md', import.meta.url), 'utf8');

export async function classify({ model, snapshot, map, validateFresh }) {
  const input = { memories: snapshot.memories, map: map.items, mapExhausted: map.exhausted };
  const output = await callModel(model, 'classify', system, input,
    { validateFresh, failureCode: 'classification_failed' });
  let proposal;
  try {
    proposal = placementProposal(output, snapshot.memories.map((memory) => memory.id));
    const visibleGroups = new Map(map.items.filter((item) => item.type === 'moc')
      .map((item) => [item.moc.id, item.moc.level]));
    for (const item of proposal.items) {
      if (item.parentIds.some((id) => visibleGroups.get(id) !== 'L1')) fail('invalid_model_output');
      if (item.newL1 && (!map.exhausted || item.newL1.parentL2Ids.some((id) => visibleGroups.get(id) !== 'L2'))) {
        fail('invalid_model_output');
      }
    }
  } catch (error) {
    if (error?.code === 'token_count_unavailable') throw error;
    emitDiagnostic(model, 'classify', 'core_validation', 'invalid_classification');
    fail('invalid_model_output');
  }
  validateFresh();
  return { proposal, basedOn: { memoryRevisions: snapshot.memories.map((m) =>
    ({ memoryId: m.id, revision: m.revision })), indexRevision: snapshot.indexRevision,
  mapExhausted: map.exhausted } };
}
