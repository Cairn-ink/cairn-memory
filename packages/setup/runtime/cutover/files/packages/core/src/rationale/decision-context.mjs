import { CoreError, isCoreError } from '../errors.mjs';
import { RATIONALE_LIMITS } from './limits.mjs';
import { rationaleEdgeKey, rationaleGuards, readEvidence, receiptDigest, webHash } from './store-plan.mjs';

/** @import { RationaleAnchor, RationaleEdge, RationaleSource } from '../ports/index.d.ts' */
/** @import { DecisionContext, DecisionContextOptions } from './types.d.ts' */

/** @param {DecisionContextOptions} options @returns {Promise<DecisionContext>} */
export async function decisionContext({ uow, scope, store, retrieval, memoryId, revision, clock = webHash }) {
  if (!store) return { status: 'unassessed', refs: [] };
  const edges = store;
  const { owner, namespace } = scope;
  const selection = { owner, namespace };
  const readScope = { owner, namespaces: [namespace] };
  const page = { limit: RATIONALE_LIMITS.inspectEdges + 1 };
  const { root, paths, sources } = await uow.run(owner, { readOnly: true }, async tx => {
    const current = await retrieval.memories.readRevision(tx, selection, memoryId);
    // A missing root and a fenced root fail at the same site, so the two cannot be told apart.
    const [visible] = current
      ? await retrieval.fence.assertVisible(tx, readScope, [{ type: 'memory', id: memoryId, namespace }])
      : [];
    if (!current || !visible) throw new CoreError('memory_not_found');
    const [guard] = rationaleGuards([{ memoryId, revision: revision ?? current.revision }]);
    const [root] = await readEvidence(tx, selection, edges, [guard]);
    /** @type {Map<string, RationaleSource | null>} */
    const sources = new Map([[memoryId, root]]);

    /** @param {string} id */
    async function readEndpoint(id) {
      if (sources.has(id)) return sources.get(id);
      let evidence = null;
      const [visible] = await retrieval.fence.assertVisible(tx, readScope, [{ type: 'memory', id, namespace }]);
      if (visible) {
        const rev = await retrieval.memories.readRevision(tx, selection, id);
        if (rev) {
          try { [evidence] = await readEvidence(tx, selection, edges, [{ memoryId: id, revision: rev.revision }]); }
          catch (error) {
            // A visible memory can still have withheld or retired raw receipts.
            if (!isCoreError(error) || !['memory_not_found', 'revision_conflict', 'context_item_too_large'].includes(error.code)) throw error;
          }
        }
      }
      sources.set(id, evidence);
      return evidence;
    }

    /** @param {RationaleEdge[]} rows */
    async function visibleEdges(rows) {
      const result = [];
      for (const row of rows) {
        if (await readEndpoint(row.from.id) && await readEndpoint(row.to.id)) result.push(row);
      }
      return result;
    }

    const supports = await visibleEdges(await edges.incoming(tx, selection, memoryId, 'supports-decision', page));
    const direct = await visibleEdges(await edges.incoming(tx, selection, memoryId, 'challenges-premise', page));
    const paths = [...supports, ...direct];
    const premises = new Set(supports.map(row => row.from.id));
    premises.delete(memoryId); // Already read the root's direct challenges, including on self-support.
    for (const id of premises) {
      paths.push(...await visibleEdges(await edges.incoming(tx, selection, id, 'challenges-premise', page)));
    }
    return { root, paths, sources };
  });

  const unique = new Map(paths.map(edge => [rationaleEdgeKey(edge), edge]));
  if (unique.size > RATIONALE_LIMITS.inspectEdges) throw new CoreError('rationale_limit');
  const visited = new Set([root.memory.id]);
  /** @param {RationaleAnchor} anchor */
  async function checkAnchor({ id, revision, receiptId, digest }) {
    const source = sources.get(id);
    const receipt = source?.receipts.find(receipt => receipt.id === receiptId);
    if (source?.memory.revision !== revision || !receipt || await receiptDigest(receipt, clock) !== digest) {
      throw new CoreError('revision_conflict');
    }
    visited.add(id);
    if (visited.size > RATIONALE_LIMITS.inspectSources) throw new CoreError('rationale_limit');
  }

  /** @type {DecisionContext['refs']} */
  const refs = [];
  for (const { from, to, relation } of unique.values()) {
    await checkAnchor(from);
    await checkAnchor(to);
    refs.push({ id: from.id, revision: from.revision, relation, direction: 'incoming' });
  }
  return { status: refs.some(ref => ref.relation === 'challenges-premise') ? 'reconfirmation-suggested' : 'unassessed', refs };
}
