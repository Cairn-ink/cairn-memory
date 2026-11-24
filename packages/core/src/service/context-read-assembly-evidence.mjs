import { CoreError } from "../errors.mjs";
import { documentCardAmendmentVisible, selectAmendmentsForRead } from "../routing/amendment-read.mjs";
import { assertContextVisible, contextCardVerdict, hasContextCardLoader, legacyContextCard, qualifyEvidence } from "./context-read-evidence.mjs";
import { canonicalGenerations, checkRow, evidenceFence, snapshotRefs } from "./context-read-fetch.mjs";
import { itemRef, namespaceSlot, readSetBinding } from "./context-read-input.mjs";
import { readTokenSigner } from "./context-read-tokens.mjs";

/** @import { ContextEvidenceRow, ContextRawTurn, ContextReadRef, ContextReadSelection, ContextReadSet,
  ContextReadStore, DocumentCardAmendment, ReadContractStorage, StoredDocumentCardRecord, Tx } from "../ports/index.d.ts" */
/** @typedef {Awaited<ReturnType<ContextReadStore["snapshotState"]>>} Generations */
/** @typedef {ReturnType<typeof readTokenSigner>} Signer */

/** @typedef {Pick<DocumentCardAmendment, "date" | "sentence" | "quote">} ReadAmendment */

/** @param {ContextEvidenceRow} row @param {Signer} signer @param {boolean} lineageEnabled
 * @param {readonly ReadAmendment[]} amendments @param {boolean} documentCard */
async function qualifyForAssembly(row, signer, lineageEnabled, amendments, documentCard) {
  const item = await qualifyEvidence(row, signer);
  const receipts = row.type === "memory" && item.type === "memory" && item.provenance.sourceAccess === "available"
    ? item.provenance.sources.map(source => row.receipts.find(receipt => receipt.id === source.receiptId))
    : [];
  const sources = receipts.flatMap(receipt => receipt ? [receipt] : []);
  // Keep the public fetch fence replayable. The assembly-only witness also
  // protects the event times and lineage carried by those qualified receipts.
  return { item, sources, amendments, documentCard, fence: await evidenceFence(signer, item, row, lineageEnabled),
    witness: JSON.stringify(sources.map(({ id, occurredAtMs, sourceTimesMs, rawTurns }) =>
      [id, occurredAtMs, sourceTimesMs, rawTurns])) + JSON.stringify(amendments) };
}

/** @typedef {Awaited<ReturnType<typeof qualifyForAssembly>>} AssemblyEvidence */
/** @param {Pick<ReadContractStorage<StoredDocumentCardRecord>, "contextRead" | "uow" | "fence" | "documentCards" | "capabilities">} storage */
export function fetchForAssembly({ contextRead: store, uow, fence, documentCards, capabilities }) {
  /** @param {ContextReadSet} readSet @param {ContextReadSelection} selection @param {Generations} observed
   * @param {readonly ContextReadRef[]} refs */
  return async (readSet, { intent, types }, observed, refs) => {
    if (!store) throw new CoreError("capability_unavailable");
    const readStore = store;
    const cards = types.includes("card");
    const expected = canonicalGenerations(observed, cards);
    /** @param {Tx} tx */
    async function checkState(tx) {
      const current = canonicalGenerations(await readStore.snapshotState(tx, readSet, types), cards);
      if (expected.length !== readSet.namespaces.length || JSON.stringify(current) !== JSON.stringify(expected)) {
        throw new CoreError("snapshot_stale");
      }
    }
    /** @param {Tx} tx @param {Signer} signer @param {readonly ContextReadRef[]} requested */
    async function evidence(tx, signer, requested) {
      const rows = requested.length ? structuredClone(await readStore.evidence(tx, readSet, requested, intent)) : [];
      return Promise.all(requested.map(async (ref, i) => {
        const row = rows[i];
        if (!row || checkRow(ref, row)) return null;
        /** @type {ReadAmendment[]} */
        const amendments = [];
        const lineage = expected[namespaceSlot(readSet, ref.scope)].lineage !== undefined;
        const legacy = !documentCards && !capabilities.documentCards && legacyContextCard(row, lineage);
        const documentCard = row.type === "card" && !legacy;
        if (documentCard) {
          const cardVisibility = await contextCardVerdict(documentCards, tx, ref, row.item);
          if (!cardVisibility) return null;
          const card = readStore.documentCardAmendmentSource && documentCards
            ? await Promise.resolve().then(() => documentCards.get(tx, ref.scope, ref.id)).catch(() => null) : null;
          const stored = card?.id === ref.id && card.scope.owner === ref.scope.owner && card.scope.namespace === ref.scope.namespace
            ? card.amendments : [];
          for (const amendment of selectAmendmentsForRead(stored)) {
            try {
              const projection = await readStore.documentCardAmendmentSource?.(tx, ref.scope, amendment.sourceMessage);
              if (projection && documentCardAmendmentVisible({ ...projection, scope: ref.scope, cardVisibility })) {
                const { date, sentence, quote } = amendment;
                amendments.push({ date, sentence, quote });
              }
            } catch {
              // Unavailable Raw evidence only withholds this amendment.
            }
          }
        }
        return qualifyForAssembly(row, signer, lineage, amendments, documentCard);
      }));
    }
    const prepared = await uow.run(readSet.owner, { readOnly: true }, async tx => {
      await checkState(tx);
      const signer = readTokenSigner(await store.identity(tx));
      const scope = await signer.bind("snapshot-scope", readSetBinding(readSet));
      const rows = await evidence(tx, signer, refs);
      const selection = { owner: readSet.owner, namespaces: readSet.namespaces };
      const fenceRefs = hasContextCardLoader(documentCards) ? refs.filter(ref => ref.type !== "card") : refs;
      const visible = fenceRefs.length ? await fence.assertVisible(tx, selection, fenceRefs.map(itemRef),
        intent === "history" ? "read" : undefined) : [];
      return { scope, rows: rows.map((row, i) => row?.documentCard || visible.some(({ id, type, namespace }) =>
        id === refs[i].id && type === refs[i].type && namespace === refs[i].scope.namespace) ? row : null) };
    });
    /** @param {readonly AssemblyEvidence[]} selected */
    const payload = selected => ({
      v: 1, scope: prepared.scope, intent, refs: snapshotRefs(readSet, selected.map(({ item }) => item.ref)),
      generations: canonicalGenerations(expected, selected.some(({ item }) => item.type === "card")),
      access: readSet.accessGenerations, fences: selected.map(row => row.fence),
    });
    return {
      rows: prepared.rows,
      payload,
      /** @param {readonly AssemblyEvidence[]} selected @param {readonly ContextRawTurn[]} rawTurns
       * @param {AbortSignal} [signal]
       * @returns {Promise<string | null | undefined>} Undefined requests a replacement after a stale Raw witness. */
      async deliver(selected, rawTurns, signal) {
        // Legacy context-read-facade.mjs:918–937. All final predicates share
        // this snapshot, after the host formatter and counter have finished.
        return uow.run(readSet.owner, { readOnly: true }, async tx => {
          await checkState(tx);
          const signer = readTokenSigner(await store.identity(tx));
          if (await signer.bind("snapshot-scope", readSetBinding(readSet)) !== prepared.scope) {
            throw new CoreError("snapshot_stale");
          }
          const delivered = selected.map(({ item }) => item.ref);
          const current = await evidence(tx, signer, delivered);
          if (selected.some((row, i) => row.fence !== current[i]?.fence || row.witness !== current[i]?.witness)) {
            throw new CoreError("snapshot_stale");
          }
          await assertContextVisible(fence, tx, readSet,
            selected.flatMap(({ item, documentCard }) => documentCard ? [] : [item.ref]), intent, "snapshot_stale");
          if (rawTurns.length) {
            let rawCurrent = false;
            try {
              rawCurrent = await store.raw?.revalidate(tx, readSet, rawTurns) === true;
            } catch {
              // A failed Raw check invalidates the Raw pack.
            }
            if (!rawCurrent) {
              if (signal?.aborted) throw new CoreError("snapshot_stale");
              return undefined;
            }
          }
          const snapshot = selected.length ? await signer.encode("snapshot", payload(selected)) : null;
          if (signal?.aborted) throw new CoreError("snapshot_stale");
          return snapshot;
        });
      },
    };
  };
}
