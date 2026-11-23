import { CoreError, isCoreError, isErrorCode } from '../errors.mjs';
import { cutRationaleText, RATIONALE_LIMITS } from './limits.mjs';
import { relate } from './relate.mjs';
import { assertRationaleSnapshot, insertRationaleEdges, planRationaleEdges, rationaleGuards,
  snapshotRationale, webHash } from './store-plan.mjs';

/** @import { ErrorCode } from '../errors.mjs' */
/** @import { RationaleDiscovery, RelatePlacedOptions, RelatePlacedReport } from './types.d.ts' */

// Enough rows to find a seventh unique memory even with every admitted memory in the result.
const DISCOVERY_DEPTH = RATIONALE_LIMITS.refs + RATIONALE_LIMITS.placed + 1;

/** @param {RelatePlacedOptions} options @returns {Promise<RelatePlacedReport>} */
export async function relatePlaced(options) {
  let proposed = 0;
  /** @type {RationaleDiscovery | undefined} */
  let discovery;
  try {
    const { uow, store, retrieval, model, gate, deadline, signal, onDiagnostic, clock = webHash } = options;
    const { owner, namespace } = options.scope;
    const scope = { owner, namespace };
    if (!store) return { status: 'skipped', reason: 'disabled', proposed: 0, inserted: 0 };
    if (Array.isArray(options.refs) && options.refs.length === 0) {
      return { status: 'skipped', reason: 'empty', proposed: 0, inserted: 0 };
    }
    const refs = rationaleGuards(options.refs, RATIONALE_LIMITS.placed);
    const readScope = { owner, namespaces: [namespace] };
    deadline?.check();
    const initial = await uow.run(owner, { readOnly: true }, async tx => {
      // Check every admitted source before lexical discovery, which can only add sources.
      const { sources: admitted } = await snapshotRationale(tx, scope, store, retrieval.snapshot, refs);
      if (!retrieval.rationaleSourceText) throw new CoreError('capability_unavailable');
      const sourceText = await retrieval.rationaleSourceText(tx, scope, refs);
      const fullQuery = sourceText.join('\n');
      const query = cutRationaleText(fullQuery, RATIONALE_LIMITS.queryUnits);
      const { rows } = await retrieval.lexical.lexical(tx, readScope, query, DISCOVERY_DEPTH, { signal, onDiagnostic });
      const seen = new Set(refs.map(({ memoryId }) => memoryId));
      let candidatesTruncated = false;
      for (const { ref } of rows) {
        if (ref.type !== 'memory' || ref.namespace !== namespace || seen.has(ref.id)) continue;
        seen.add(ref.id);
        if (refs.length === RATIONALE_LIMITS.refs) {
          candidatesTruncated = true;
          break;
        }
        const current = await retrieval.memories.readRevision(tx, scope, ref.id);
        if (!current) throw new CoreError('revision_conflict');
        refs.push({ memoryId: ref.id, revision: current.revision });
      }
      discovery = { candidateCount: refs.length, scanExhausted: rows.length < DISCOVERY_DEPTH,
        candidatesTruncated, queryTruncated: query.length !== fullQuery.length, semanticCoverage: 'unassessed' };
      const snapshot = await snapshotRationale(tx, scope, store, retrieval.snapshot, refs, admitted);
      return { snapshot, discovery };
    });
    const { snapshot } = initial;
    const validateFresh = () => uow.run(owner, { readOnly: true }, tx =>
      assertRationaleSnapshot(tx, scope, store, retrieval.snapshot, refs, snapshot));
    const proposals = await relate({ model, sources: snapshot.sources, validateFresh, deadline, gate, owner, signal, onDiagnostic });
    proposed = proposals.length;
    const edges = await planRationaleEdges(snapshot, proposals, clock);
    const inserted = await uow.run(owner, {}, async tx => {
      await assertRationaleSnapshot(tx, scope, store, retrieval.snapshot, refs, snapshot);
      deadline?.check();
      if (signal?.aborted) throw new CoreError('model_cancelled');
      const count = await insertRationaleEdges(tx, scope, store, edges);
      deadline?.check();
      if (signal?.aborted) throw new CoreError('model_cancelled');
      return count;
    });
    return { status: 'reviewed', proposed, inserted, discovery: initial.discovery };
  } catch (error) {
    /** @type {ErrorCode} */
    let code = 'rationale_failed';
    try {
      const reported = isCoreError(error) ? error.code : undefined;
      if (isErrorCode(reported)) code = reported;
    } catch { /* A port can throw an error whose properties are unreadable. */ }
    return { status: 'failed', error: { code, retryable: code === 'storage_busy' }, proposed, inserted: 0,
      ...(discovery && { discovery }) };
  }
}
