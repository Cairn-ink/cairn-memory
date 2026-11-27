import { CoreError, isCoreError } from '../errors.mjs';
import { CLASSIFICATION_CATALOG_LIMIT } from './catalog.mjs';
import { classifyPlacement } from './classify.mjs';

/** @import { PlacePendingBatchOptions, PlacePendingBatchResult, PlacePendingOptions } from './batch.mjs' */
/** @import { ClassificationCatalogItem } from './catalog.mjs' */
/** @import { ClassificationCatalog, ClassificationSnapshot } from './classify.mjs' */
/** @import { PlacementProposal } from './proposal.mjs' */

/** @param {PlacePendingBatchOptions} options @returns {Promise<PlacePendingBatchResult>} */
export async function placePendingBatch({ uow, scope, placement, memories, classify }) {
  return runPendingBatch({ uow, scope, placement, memories }, (snapshot, catalog, validateFresh) =>
    classify({ memories: snapshot.memories }, catalog, { validateFresh }));
}

/** @param {PlacePendingOptions} options @returns {Promise<PlacePendingBatchResult>} */
export async function placePending({ uow, scope, placement, memories, model, gate, deadline, signal, onDiagnostic }) {
  if (typeof gate?.assertOpen !== 'function') throw new CoreError('invalid_input');
  return runPendingBatch({ uow, scope, placement, memories }, async (snapshot, catalog, validateFresh) => {
    const { proposal } = await classifyPlacement({
      model, snapshot, catalog, validateFresh, gate, deadline, owner: scope.owner, signal, onDiagnostic,
    });
    return proposal;
  });
}

/**
 * @param {Omit<PlacePendingBatchOptions, 'classify'>} options
 * @param {(snapshot: ClassificationSnapshot, catalog: ClassificationCatalog, validateFresh: () => Promise<void>) =>
 *   Promise<PlacementProposal>} classify
 * @returns {Promise<PlacePendingBatchResult>}
 */
async function runPendingBatch({ uow, scope, placement, memories }, classify) {
  const batch = await uow.run(scope.owner, { readOnly: true }, async (tx) => {
    const pending = await placement.pending(tx, scope, { limit: 5 });
    if (!pending.length) return null;

    /** @type {ClassificationCatalogItem[]} */
    const map = [];
    let page = await placement.catalog(tx, scope, { cursor: null, limit: CLASSIFICATION_CATALOG_LIMIT });
    const { indexRevision } = page;
    while (true) {
      for (const { id, level, title } of page.items) map.push({ type: 'moc', moc: { id, level, title } });
      if (page.exhausted || map.length === CLASSIFICATION_CATALOG_LIMIT) break;
      page = await placement.catalog(tx, scope, { cursor: page.nextCursor, limit: CLASSIFICATION_CATALOG_LIMIT - map.length });
    }

    const snapshot = [];
    for (const { memoryId, revision } of pending) {
      const memory = await memories.get(tx, scope, memoryId);
      if (memory && !memory.historical && memory.revision === revision) {
        snapshot.push({ id: memory.id, revision, kind: memory.kind, content: memory.text });
      }
    }
    if (!snapshot.length) return null;
    return { snapshot: { memories: snapshot, indexRevision }, catalogView: { map, mapExhausted: page.exhausted },
      basedOn: { indexRevision, memoryRevisions: snapshot.map(({ id, revision }) => ({ memoryId: id, revision })) } };
  });
  if (!batch) return { status: 'idle' };

  const { snapshot, catalogView, basedOn } = batch;
  const validateFresh = () => uow.run(scope.owner, { readOnly: true }, async (tx) => {
    for (const { memoryId, revision } of basedOn.memoryRevisions) {
      if ((await memories.readRevision(tx, scope, memoryId))?.revision !== revision) {
        throw new CoreError('revision_conflict');
      }
    }
    const { indexRevision } = await placement.catalog(tx, scope, { cursor: null, limit: 1 });
    if (indexRevision !== basedOn.indexRevision) throw new CoreError('revision_conflict');
  });

  try {
    const proposal = await classify(snapshot, catalogView, validateFresh);
    const result = await uow.run(scope.owner, {}, (tx) => placement.applyPlacement(tx, scope, basedOn, proposal));
    return { status: 'applied', ...result };
  } catch (error) {
    if (!isCoreError(error)) throw error;
    const { code, kind, retryable } = error;
    if (kind !== 'paused' && kind !== 'conflict') {
      const ids = basedOn.memoryRevisions.map(({ memoryId }) => memoryId);
      try {
        await uow.run(scope.owner, {}, (tx) => placement.markFailed(tx, scope, ids, code));
      } catch {
        // A failed receipt write cannot replace the original error.
      }
    }
    return { status: 'failed', error: { code, retryable } };
  }
}
