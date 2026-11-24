import { CoreError } from "../errors.mjs";
import { detach } from "../capture/validate.mjs";
import { itemRef, legacyNamespace } from "./context-read-input.mjs";

/** @import { CallOptions, Tx, VisibilityFence } from "../ports/index.d.ts" */
/** @import { ContextCardEvidence, ContextEvidenceRow, ContextMemoryEvidence, ContextReadIntent,
  ContextReadRef, ContextReadSet } from "../ports/host.d.ts" */
/** @typedef {ReturnType<typeof import("./context-read-tokens.mjs").readTokenSigner>} Signer */
/** @typedef {ContextMemoryEvidence | ContextCardEvidence} Evidence */

const encoder = new TextEncoder();

/** @param {unknown} value */
export function responseBytes(value) {
  return encoder.encode(JSON.stringify({ ok: true, value })).length;
}

/** @param {ContextReadRef} ref @param {boolean} [ranked] */
export function legacyRef(ref, ranked = false) {
  const base = { type: ref.type, namespace: legacyNamespace(ref.scope) };
  const id = { [ref.type === "memory" ? "memoryId" : "cardId"]: ref.id };
  const revision = { revision: ref.revision };
  return { ...base, ...(ranked ? { ...revision, ...id } : { ...id, ...revision }),
    ...(ref.type === "card" && { bodyRevision: ref.bodyRevision }) };
}

/** @param {Evidence} item */
export function legacyEvidence(item) {
  const ref = legacyRef(item.ref);
  if (item.type === "card") {
    const { type, state, support, origin, builtAt, clusterKey, status, sourceRevisions,
      title, body, qualification, provenance, bindings, triggerMemoryRefs } = item;
    return { type, ref, state, support, origin,
      ...(origin === "engine" && { builtAt, clusterKey, status, sourceRevisions }),
      title, body, qualification, provenance, bindings, triggerMemoryRefs: triggerMemoryRefs.map(ref => legacyRef(ref)) };
  }
  const { type, state, reviewState, filing, kind, origin, confidence, text, qualification, provenance } = item;
  const sources = provenance.sources.map(({ type, scope, memoryId, memoryRevision, receiptId, contentIdentity, completeness }) =>
    ({ type, namespace: legacyNamespace(scope), memoryId, memoryRevision, receiptId, contentIdentity, completeness }));
  return { type, ref, state, reviewState, filing, kind, origin, confidence, content: text,
    qualification, provenance: { ...provenance, sources } };
}

/** @param {ContextEvidenceRow} row @param {Signer} signer @returns {Promise<Evidence>} */
export async function qualifyEvidence(row, signer) {
  if (row.type === "card") return row.item;
  const { ref, text, metadata, qualification, sourceAccess, receipts, receiptCoverage } = row;
  const { scope, id: memoryId, revision: memoryRevision } = ref;
  const selected = receipts.slice(0, 16);
  const sources = sourceAccess === "available" ? await Promise.all(selected.map(async receipt => ({
    type: /** @type {const} */ ("receipt"), scope, memoryId, memoryRevision, receiptId: receipt.id,
    contentIdentity: await signer.receipt([legacyNamespace(scope), memoryId, memoryRevision, receipt.id,
      receipt.client, receipt.sessionId, receipt.eventId, receipt.role, receipt.excerpt]),
    completeness: /** @type {const} */ ("excerpt-only"),
  }))) : [];
  let assessed = null;
  if (qualification) {
    const { anchors } = qualification;
    if (anchors !== undefined && !Array.isArray(anchors)) throw new CoreError("internal_error");
    assessed = { ...qualification, sourceText: "read-separately", ...(Array.isArray(anchors) && {
      anchors: anchors.map(anchor => {
        if (anchor === null || typeof anchor !== "object" || Array.isArray(anchor)) throw new CoreError("internal_error");
        const { text: _text, ...safe } = anchor;
        return safe;
      }),
    }) };
  }
  return { type: "memory", ref, ...metadata, text, qualification: assessed,
    provenance: {
      sources, sourceAccess,
      receiptMetadata: selected.map(({ id: receiptId }) => ({ memoryId, memoryRevision, receiptId })),
      completeness: "excerpt-only", conversationCoverage: "unknown", meaning: "unassessed",
      attribution: { status: "unassessed", commitment: "unknown" },
      corroboration: "not-assessed",
      coverage: { status: receiptCoverage.status, included: receiptCoverage.included, omitted: receiptCoverage.omitted },
    } };
}

/** @param {VisibilityFence} fence @param {Tx} tx @param {ContextReadSet} readSet @param {readonly ContextReadRef[]} refs
 * @param {ContextReadIntent} intent @param {"evidence_unavailable" | "cursor_stale" | "snapshot_stale"} code */
export async function assertContextVisible(fence, tx, readSet, refs, intent, code) {
  if (!refs.length) return;
  const selection = { owner: readSet.owner, namespaces: readSet.namespaces };
  const visible = await fence.assertVisible(tx, selection, refs.map(itemRef), intent === "history" ? "read" : undefined);
  if (refs.some(ref => !visible.some(row =>
    row.type === ref.type && row.namespace === ref.scope.namespace && row.id === ref.id))) throw new CoreError(code);
}

/** @template A, B @param {[A, B, CallOptions?]} args @returns {[A, B, CallOptions]} */
export function snapshotContextCall([readSet, input, options]) {
  const [set, request] = detach(/** @type {[A, B]} */ ([readSet, input]), "invalid_input");
  return [set, request, { signal: options?.signal, deadlineAtMs: options?.deadlineAtMs }];
}
