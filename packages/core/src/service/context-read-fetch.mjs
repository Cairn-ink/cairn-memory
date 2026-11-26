import { validateDenseArray, validateObject } from "../capture/validate.mjs";
import { CoreError } from "../errors.mjs";
import { entry } from "./entry.mjs";
import { assertContextVisible, contextCardVerdict, hasContextCardLoader, legacyContextCard, legacyEvidence, qualifyEvidence, responseBytes, snapshotContextCall } from "./context-read-evidence.mjs";
import { COMPACT_MEMORY_MAX_ITEMS, COMPACT_MEMORY_REPRESENTATION,
  contextReadSet, CONTEXT_HORIZON, fetchEvidenceInput, intentOf, readSetBinding, namespaceSlot,
  qualifiedRefs } from "./context-read-input.mjs";
import { isReadMac, readTokenSigner } from "./context-read-tokens.mjs";

/** @import { CallOptions, ContextEvidenceRow, ContextReadRef, ContextReadSet, ContextReadStore,
  FetchEvidenceInput, FetchEvidenceResult, MemoryService, ReadContractStorage, StoredDocumentCardRecord } from "../ports/index.d.ts" */
/** @typedef {Awaited<ReturnType<ContextReadStore["snapshotState"]>>} Generations */
/** @typedef {ReturnType<typeof readTokenSigner>} Signer */

const snapshotFields = ["v", "scope", "intent", "refs", "generations", "access", "fences"];

/** @param {ContextReadSet} readSet @param {readonly ContextReadRef[]} refs */
export function snapshotRefs(readSet, refs) {
  return refs.map(ref => [namespaceSlot(readSet, ref.scope), ref.type, ref.id, ref.revision,
    ...(ref.type === "card" ? [ref.bodyRevision] : [])]);
}

/** @param {ContextReadSet} readSet @param {unknown} value @param {string} scope */
function snapshotPayload(readSet, value, scope) {
  try {
    const data = validateObject(value, [...snapshotFields, "representation"]);
    const compact = data.representation === COMPACT_MEMORY_REPRESENTATION;
    if (Object.keys(data).length !== snapshotFields.length + Number(compact) ||
        Object.hasOwn(data, "representation") !== compact || !snapshotFields.every(key => Object.hasOwn(data, key)) ||
        data.v !== 1 || data.scope !== scope ||
        JSON.stringify(data.access) !== JSON.stringify(readSet.accessGenerations)) throw new CoreError("snapshot_stale");
    const intent = intentOf(data.intent);
    const maximum = compact ? COMPACT_MEMORY_MAX_ITEMS : CONTEXT_HORIZON;
    const tuples = validateDenseArray(data.refs, 1, maximum);
    const refs = qualifiedRefs(tuples.map(tuple => {
      const values = validateDenseArray(tuple, 4, 5);
      const [slot, type, id, revision, bodyRevision] = values;
      if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0 || slot >= readSet.namespaces.length ||
          values.length !== (type === "card" ? 5 : 4) || (compact && type !== "memory")) throw new CoreError("snapshot_stale");
      return { scope: { owner: readSet.owner, namespace: readSet.namespaces[slot] }, type, id, revision,
        ...(type === "card" && { bodyRevision }) };
    }), readSet, maximum);
    const fences = validateDenseArray(data.fences, refs.length, refs.length);
    if (!fences.every(isReadMac)) throw new CoreError("snapshot_stale");
    return { intent, refs, fences, generations: data.generations, compact };
  } catch {
    throw new CoreError("snapshot_stale");
  }
}

/** @param {Generations} state @param {boolean} cards */
export function canonicalGenerations(state, cards) {
  return state.map(({ memory, card, lineage }) => {
    if (!Number.isSafeInteger(memory) || memory < 0 ||
        (cards && (card === undefined || !Number.isSafeInteger(card) || card < 0))) throw new CoreError("internal_error");
    return { memory, ...(cards && { card, ...(lineage !== undefined && { lineage }) }) };
  });
}

/** @param {ContextReadRef} requested @param {ContextEvidenceRow | null | undefined} row */
export function checkRow(requested, row) {
  if (!row) return "evidence_unavailable";
  const actual = row.type === "memory" ? row.ref : row.item.ref;
  if (actual.type !== requested.type || actual.id !== requested.id ||
      actual.scope.owner !== requested.scope.owner || actual.scope.namespace !== requested.scope.namespace) {
    return "evidence_unavailable";
  }
  if (actual.revision !== requested.revision ||
      (requested.type === "card" && actual.type === "card" && actual.bodyRevision !== requested.bodyRevision)) {
    return "revision_conflict";
  }
}

/** @param {Signer} signer @param {FetchEvidenceResult["items"][number]} item @param {ContextEvidenceRow} row
 * @param {boolean} lineageEnabled */
export function evidenceFence(signer, item, row, lineageEnabled) {
  const legacy = legacyEvidence(item);
  const value = row.type === "card" && (lineageEnabled || row.lineageStamp !== null) ? [legacy, row.lineageStamp] : legacy;
  return signer.bind("snapshot-item", value);
}

/** @param {Pick<ReadContractStorage<StoredDocumentCardRecord>, "contextRead" | "capabilities" | "uow" | "fence" | "documentCards">} storage
 * @returns {NonNullable<MemoryService["fetchEvidence"]>} */
export function fetchEvidenceMethod({ contextRead: store, capabilities, uow, fence, documentCards }) {
  const cardsEnabled = hasContextCardLoader(documentCards);
  return entry(async (/** @type {ContextReadSet} */ value, /** @type {FetchEvidenceInput} */ args,
    /** @type {CallOptions} */ options = {}) => {
    const readSet = contextReadSet(value);
    const input = fetchEvidenceInput(args, readSet);
    if (!store || capabilities.contextRead !== true) throw new CoreError("capability_unavailable");
    if (options.signal?.aborted) throw new CoreError("evidence_unavailable");

    return uow.run(readSet.owner, { readOnly: true }, async tx => {
      const signer = readTokenSigner(await store.identity(tx));
      const scope = await signer.bind("snapshot-scope", readSetBinding(readSet));
      const previous = input.snapshot !== undefined ?
        snapshotPayload(readSet, await signer.decode("snapshot", input.snapshot), scope) : null;
      const { intent, refs } = previous ?? input;
      if (!refs || !intent) throw new CoreError("internal_error");

      const types = [...new Set(refs.map(ref => ref.type))];
      const generations = canonicalGenerations(await store.snapshotState(tx, readSet, types), types.includes("card"));
      if (generations.length !== readSet.namespaces.length) throw new CoreError("internal_error");
      if (previous && JSON.stringify(previous.generations) !== JSON.stringify(generations)) throw new CoreError("snapshot_stale");

      const rows = structuredClone(await store.evidence(tx, readSet, refs, intent));
      const failures = await Promise.all(refs.map(async (ref, i) => {
        const row = rows[i];
        const legacy = !cardsEnabled && row &&
          legacyContextCard(row, generations[namespaceSlot(readSet, ref.scope)].lineage !== undefined);
        if (row?.type === "card" && !legacy && !await contextCardVerdict(documentCards, tx, ref, row.item)) {
          return "evidence_unavailable";
        }
        return checkRow(ref, row);
      }));
      const unavailable = previous ? "snapshot_stale" : "evidence_unavailable";
      const fenceRefs = cardsEnabled ? refs.filter(ref => ref.type !== "card") : refs;
      if (failures.includes("evidence_unavailable")) throw new CoreError(unavailable);
      if (failures.includes("revision_conflict")) {
        await assertContextVisible(fence, tx, readSet, fenceRefs, intent, unavailable);
        throw new CoreError(previous ? "snapshot_stale" : "revision_conflict");
      }

      const selected = /** @type {readonly ContextEvidenceRow[]} */ (rows.slice(0, refs.length));
      const items = await Promise.all(selected.map(row => qualifyEvidence(row, signer)));
      const fences = await Promise.all(items.map((item, i) => evidenceFence(signer, item, selected[i],
        generations[namespaceSlot(readSet, item.ref.scope)].lineage !== undefined)));
      if (fences.some((full, i) => (previous && previous.fences[i] !== full) ||
          (input.fences?.[i] != null && input.fences[i] !== full.slice(0, 8)))) {
        await assertContextVisible(fence, tx, readSet, fenceRefs, intent, unavailable);
        throw new CoreError("snapshot_stale");
      }
      const snapshot = await signer.encode("snapshot", {
        v: 1, scope, intent, refs: snapshotRefs(readSet, refs), generations, access: readSet.accessGenerations, fences,
        ...(previous?.compact && { representation: COMPACT_MEMORY_REPRESENTATION }),
      });
      const tooLarge = responseBytes({ items: items.map(legacyEvidence), snapshot }) > input.responseByteLimit;
      if (options.signal?.aborted) throw new CoreError(unavailable);
      await assertContextVisible(fence, tx, readSet, fenceRefs, intent, unavailable);
      if (tooLarge) throw new CoreError("context_item_too_large");
      return { items, snapshot };
    });
  }, undefined, snapshotContextCall);
}
