import { readFileSync } from 'node:fs';
import { callModel } from './model-call.mjs';
import { placementProposal } from './placement-input.mjs';
import { fail } from './validation.mjs';
import { emitDiagnostic } from './model-diagnostics.mjs';
import { packClassification } from './model-packing.mjs';

const system = readFileSync(new URL('./prompts/classify-placement.md', import.meta.url), 'utf8');

export async function classify({ model, snapshot, map, validateFresh, deadline }) {
  // A request that does not fit is packed; placement may use only the topics it shows.
  const packed = packClassification(model, system,
    { memories: snapshot.memories, map: map.items, mapExhausted: map.exhausted }, deadline);
  const { input } = packed;
  const output = await callModel(model, 'classify', system, input,
    { validateFresh, failureCode: 'classification_failed', deadline });
  let proposal;
  let reason = 'invalid_classification';
  const reject = category => { reason = category; fail('invalid_model_output'); };
  try {
    proposal = placementProposal(output, snapshot.memories.map((memory) => memory.id),
      category => { reason = category; });
    const visibleGroups = new Map(input.map.filter((item) => item.type === 'moc')
      .map((item) => [item.moc.id, item.moc.level]));
    for (const item of proposal.items) {
      if (item.parentIds.some((id) => visibleGroups.get(id) !== 'L1')) reject('classification_parent_visibility');
      if (item.newL1) {
        if (!input.mapExhausted) reject('classification_create_policy');
        if (item.newL1.parentL2Ids.some((id) => visibleGroups.get(id) !== 'L2')) {
          reject('classification_parent_visibility');
        }
      }
    }
  } catch (error) {
    deadline?.check();
    if (error?.code === 'token_count_unavailable') throw error;
    emitDiagnostic(model, 'classify', 'core_validation', reason);
    fail('invalid_model_output');
  }
  validateFresh();
  deadline?.check();
  const { memoriesShortened, catalogItemsOmitted } = packed;
  return { proposal, basedOn: { memoryRevisions: snapshot.memories.map((m) =>
    ({ memoryId: m.id, revision: m.revision })), indexRevision: snapshot.indexRevision,
  mapExhausted: input.mapExhausted },
  ...(memoriesShortened || catalogItemsOmitted
    ? { classificationTruncated: { memoriesShortened, catalogItemsOmitted } } : {}) };
}
