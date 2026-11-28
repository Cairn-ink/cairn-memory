import { CoreError, isCoreError } from '../errors.mjs';
import { CLASSIFICATION_CATALOG_LIMIT, isClassificationCatalogLimit, readClassificationCatalog } from './catalog.mjs';
import { classifyPlacement } from './classify.mjs';

/** @import { PlacePendingBatchOptions, PlacePendingBatchResult, PlacePendingOptions } from './batch.mjs' */
/** @import { Tx } from '../ports/index.d.ts' */
/** @import { ClassificationCatalog, ClassificationSnapshot } from './classify.mjs' */
/** @import { PlacementProposal } from './proposal.mjs' */

/** @param {PlacePendingBatchOptions} options @returns {Promise<PlacePendingBatchResult>} */
export async function placePendingBatch({ uow, scope, placement, memories, catalogLimit, classify }) {
  return runPendingBatch({ uow, scope, placement, memories, catalogLimit }, (snapshot, catalog, validateFresh) =>
    classify({ memories: snapshot.memories }, catalog, { validateFresh }));
}

/** @param {PlacePendingOptions} options @returns {Promise<PlacePendingBatchResult>} */
export async function placePending({ uow, scope, placement, memories, catalogLimit, model, gate, deadline, signal, onDiagnostic }) {
  if (typeof gate?.assertOpen !== 'function') throw new CoreError('invalid_input');
  return runPendingBatch({ uow, scope, placement, memories, catalogLimit }, async (snapshot, catalog, validateFresh) => {
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
async function runPendingBatch({ uow, scope, placement, memories, catalogLimit = CLASSIFICATION_CATALOG_LIMIT }, classify) {
  if (!isClassificationCatalogLimit(catalogLimit)) throw new CoreError('invalid_input');
  const batch = await uow.run(scope.owner, { readOnly: true }, async (tx) => {
    const pending = await placement.pending(tx, scope, { limit: 5 });
    if (!pending.length) return null;

    const { indexRevision, catalogView } = await readClassificationCatalog(placement, tx, scope, catalogLimit);

    const snapshot = [];
    for (const { memoryId, revision } of pending) {
      const memory = await memories.get(tx, scope, memoryId);
      if (memory && !memory.historical && memory.revision === revision) {
        snapshot.push({ id: memory.id, revision, kind: memory.kind, content: memory.text });
      }
    }
    if (!snapshot.length) return null;
    return { snapshot: { memories: snapshot, indexRevision }, catalogView,
      basedOn: { indexRevision, memoryRevisions: snapshot.map(({ id, revision }) => ({ memoryId: id, revision })) } };
  });
  if (!batch) return { status: 'idle' };

  const { snapshot, catalogView, basedOn } = batch;
  /** @param {Tx} tx */
  const snapshotConflict = async (tx) => {
    for (const { memoryId, revision } of basedOn.memoryRevisions) {
      if ((await memories.readRevision(tx, scope, memoryId))?.revision !== revision) return 'revision_conflict';
    }
    const { indexRevision } = await placement.catalog(tx, scope, { cursor: null, limit: 1 });
    return indexRevision !== basedOn.indexRevision ? 'topic_index_moved' : null;
  };
  let revisionsChanged = false;
  const validateFresh = async () => {
    const conflict = await uow.run(scope.owner, { readOnly: true }, snapshotConflict);
    if (conflict) {
      revisionsChanged ||= conflict === 'revision_conflict';
      throw new CoreError(conflict);
    }
  };

  try {
    const proposal = await classify(snapshot, catalogView, validateFresh);
    const result = await uow.run(scope.owner, {}, (tx) => placement.applyPlacement(tx, scope, basedOn, proposal));
    return { status: 'applied', ...result };
  } catch (error) {
    if (!isCoreError(error)) throw error;
    const { code, kind, retryable } = error;
    if (kind !== 'paused' && !revisionsChanged) {
      try {
        await uow.run(scope.owner, {}, async (tx) => {
          // Hold the write lock from the guard reads through the receipt write.
          const conflict = await snapshotConflict(tx);
          if (conflict === 'revision_conflict') return;
          const ids = basedOn.memoryRevisions.map(({ memoryId }) => memoryId);
          await placement.markFailed(tx, scope, ids, conflict ?? code);
        });
      } catch {
        // A failed receipt write cannot replace the original error.
      }
    }
    return { status: 'failed', error: { code, retryable } };
  }
}
