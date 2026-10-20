import { denseArray, fail, identifier, object, revision } from './validation.mjs';
import { evidenceRef } from './private-evidence-input.mjs';
import { placementProposal } from './placement-input.mjs';

export const ORGANIZATION_METHODS = Object.freeze(['mapEvidence', 'applyCardPlacement',
  'proposeEvidenceMapping', 'reviewEvidenceMapping', 'listEvidenceMappings']);
export const ORGANIZATION_READS = Object.freeze(['mapEvidence', 'listEvidenceMappings']);
export const ORGANIZATION_WRITES = Object.freeze(['applyCardPlacement', 'proposeEvidenceMapping']);
export function topicRef(value) {
  object(value, ['mocId', 'revision']);
  return { mocId: identifier(value.mocId), revision: revision(value.revision) };
}
function page(input) {
  const limit = input.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) fail('invalid_input');
  if (input.cursor !== undefined && (typeof input.cursor !== 'string' || input.cursor.length > 8192)) fail('invalid_cursor');
  return limit;
}
export function organizationInput(method, input, ns) {
  const allowed = {
    mapEvidence: ['type', 'purpose', 'parentRef', 'limit', 'cursor'],
    applyCardPlacement: ['actionId', 'refs', 'expectedIndexRevision', 'proposal'],
    proposeEvidenceMapping: ['actionId', 'memoryTopic', 'cardTopic', 'expectedMemoryIndexRevision', 'expectedCardIndexRevision'],
    reviewEvidenceMapping: ['actionId', 'mappingId', 'expectedRevision', 'state', 'memoryTopic', 'cardTopic', 'expectedMemoryIndexRevision', 'expectedCardIndexRevision'],
    listEvidenceMappings: ['type', 'mocId', 'limit', 'cursor'],
  };
  object(input, ['namespace', ...allowed[method]]);
  if (method === 'mapEvidence' || method === 'listEvidenceMappings') {
    if (!['memory', 'card'].includes(input.type)) fail('invalid_input');
    const limit = page(input);
    if (method === 'listEvidenceMappings') return { type: input.type, mocId: identifier(input.mocId), limit };
    const purpose = input.purpose ?? 'recall';
    if (!['recall', 'classification'].includes(purpose)) fail('invalid_input');
    return { type: input.type, purpose, limit, ...(input.parentRef === undefined ? {} : { parentRef: topicRef(input.parentRef) }) };
  }
  identifier(input.actionId);
  if (method === 'applyCardPlacement') {
    const refs = denseArray(input.refs, 1, 5).map(value => evidenceRef(value, ns));
    if (refs.some(ref => ref.type !== 'card') || new Set(refs.map(ref => ref.cardId)).size !== refs.length) fail('invalid_input');
    object(input.proposal, ['items']);
    const items = denseArray(input.proposal.items, 1, 5).map(item => {
      object(item, ['cardId', 'parentIds', 'newL1']);
      const { cardId, ...rest } = item;
      return { memoryId: identifier(cardId), ...rest };
    });
    const proposal = placementProposal({ items }, refs.map(ref => ref.cardId));
    if (proposal.items.some(item => item.parentIds.length + Number(Boolean(item.newL1)) > 3 ||
        item.newL1 && item.newL1.parentL2Ids.length + Number(item.newL1.newL2Title !== undefined) > 3)) fail('invalid_input');
    return { refs, expectedIndexRevision: revision(input.expectedIndexRevision),
      items: proposal.items.map(({ memoryId, ...rest }) => ({ cardId: memoryId, ...rest })) };
  }
  const result = { memoryTopic: topicRef(input.memoryTopic), cardTopic: topicRef(input.cardTopic),
    expectedMemoryIndexRevision: revision(input.expectedMemoryIndexRevision),
    expectedCardIndexRevision: revision(input.expectedCardIndexRevision) };
  if (method === 'reviewEvidenceMapping') {
    if (!['active', 'removed'].includes(input.state)) fail('invalid_input');
    Object.assign(result, { mappingId: identifier(input.mappingId), expectedRevision: revision(input.expectedRevision), state: input.state });
  }
  return result;
}
