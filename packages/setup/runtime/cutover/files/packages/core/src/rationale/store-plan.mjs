import { identifier, isWellFormedText, revision, validateDenseArray, validateObject } from '../capture/validate.mjs';
import { CoreError, isCoreError } from '../errors.mjs';
import { sha256Hex } from '../privacy/fingerprint.mjs';
import { RATIONALE_LIMITS } from './limits.mjs';

/** @import { ClockAndHash, RationaleEdge, RationaleEdgeStore, RationaleGuard, RationaleReceipt,
 * RationaleSource, ReadSnapshot, Scope, Tx } from '../ports/index.d.ts' */
/** @import { RationaleProposal } from './types.d.ts' */
/** @typedef {{sources: RationaleSource[], indexToken: string}} RationaleSnapshot */

/** @type {Pick<ClockAndHash, 'sha256Hex'>} */
export const webHash = { sha256Hex };

/** @param {RationaleReceipt} receipt @param {Pick<ClockAndHash, 'sha256Hex'>} clock */
export function receiptDigest({ id, role, excerpt }, clock) {
  return clock.sha256Hex(JSON.stringify({ id, role, excerpt }));
}

/** @param {RationaleEdge} edge */
export function rationaleEdgeKey({ from, to, relation }) {
  return JSON.stringify([from.id, to.id, relation, from.receiptId, to.receiptId]);
}

/** @param {unknown} input @param {number} [max] */
export function rationaleGuards(input, max = RATIONALE_LIMITS.refs) {
  const refs = validateDenseArray(input, 1, max).map(value => {
    const { memoryId, revision: rev } = validateObject(value, ['memoryId', 'revision']);
    return { memoryId: identifier(memoryId), revision: revision(rev) };
  });
  if (new Set(refs.map(({ memoryId }) => memoryId)).size !== refs.length) throw new CoreError('invalid_input');
  return refs;
}

/**
 * @param {Tx} tx @param {Scope} scope @param {RationaleEdgeStore} store @param {readonly RationaleGuard[]} refs
 */
export async function readEvidence(tx, scope, store, refs) {
  const sources = await store.sourceEvidence(tx, scope, refs);
  if (sources.length !== refs.length) throw new CoreError('revision_conflict');
  return refs.map(({ memoryId, revision }, index) => {
    const { memory, receipts } = sources[index];
    if (receipts.length > RATIONALE_LIMITS.receipts) throw new CoreError('context_item_too_large');
    if (memory.id !== memoryId || memory.revision !== revision || !receipts.length) {
      throw new CoreError('revision_conflict');
    }
    const ids = new Set();
    return { memory: { id: memoryId, revision }, receipts: receipts.map(({ id, role, excerpt }) => {
      if (typeof id !== 'string' || !id || ids.has(id) || (role !== 'user' && role !== 'assistant') ||
          !isWellFormedText(excerpt) || !excerpt.length || excerpt.length > RATIONALE_LIMITS.excerptUnits) {
        throw new CoreError('revision_conflict');
      }
      ids.add(id);
      return { id, role, excerpt };
    }) };
  });
}

/**
 * @param {Tx} tx @param {Scope} scope @param {RationaleEdgeStore} store @param {ReadSnapshot} index
 * @param {readonly RationaleGuard[]} refs @param {RationaleSource[]} [admitted]
 * @returns {Promise<RationaleSnapshot>}
 */
export async function snapshotRationale(tx, scope, store, index, refs, admitted = []) {
  const pending = refs.slice(admitted.length);
  const sources = [...admitted, ...(pending.length ? await readEvidence(tx, scope, store, pending) : [])];
  const indexToken = await index.stateToken(tx, { owner: scope.owner, namespaces: [scope.namespace] });
  const snapshot = { sources, indexToken };
  if (JSON.stringify(snapshot).length > RATIONALE_LIMITS.snapshotUnits) throw new CoreError('context_item_too_large');
  return snapshot;
}

/**
 * @param {Tx} tx @param {Scope} scope @param {RationaleEdgeStore} store @param {ReadSnapshot} index
 * @param {readonly RationaleGuard[]} refs @param {RationaleSnapshot} expected
 */
export async function assertRationaleSnapshot(tx, scope, store, index, refs, expected) {
  let actual;
  try { actual = await snapshotRationale(tx, scope, store, index, refs); }
  catch (error) {
    if (isCoreError(error) && (error.code === 'memory_not_found' || error.code === 'context_item_too_large')) {
      throw new CoreError('revision_conflict');
    }
    throw error;
  }
  // Compare the complete ordered digest input for every retained receipt, plus the owner index token.
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new CoreError('revision_conflict');
}

/**
 * @param {RationaleSnapshot} snapshot @param {readonly RationaleProposal[]} proposals
 * @param {Pick<ClockAndHash, 'sha256Hex'>} clock
 */
export function planRationaleEdges({ sources }, proposals, clock) {
  /** @param {number} sourceIndex @param {number} receiptIndex */
  async function anchor(sourceIndex, receiptIndex) {
    const { memory, receipts } = sources[sourceIndex];
    const receipt = receipts[receiptIndex];
    return { ...memory, receiptId: receipt.id, digest: await receiptDigest(receipt, clock) };
  }
  return Promise.all(proposals.map(async ({ from, to, relation, fromReceipt, toReceipt }) => ({
    from: await anchor(from, fromReceipt), to: await anchor(to, toReceipt), relation,
  })));
}

/** @param {Tx} tx @param {Scope} scope @param {RationaleEdgeStore} store @param {readonly RationaleEdge[]} edges */
export async function insertRationaleEdges(tx, scope, store, edges) {
  let inserted = 0;
  // All successful inserts share this transaction's single owner index advance.
  for (const edge of edges) {
    inserted += Number((await store.insert(tx, scope, edge)).inserted);
    for (const id of new Set([edge.from.id, edge.to.id])) {
      if (await store.degree(tx, scope, id) > RATIONALE_LIMITS.degree) throw new CoreError('rationale_limit');
    }
  }
  return inserted;
}
