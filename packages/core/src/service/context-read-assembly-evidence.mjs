import { CoreError } from "../errors.mjs";
import { assertContextVisible, qualifyEvidence } from "./context-read-evidence.mjs";
import { canonicalGenerations, checkRow, evidenceFence, snapshotRefs } from "./context-read-fetch.mjs";
import { itemRef, namespaceSlot, readSetBinding } from "./context-read-input.mjs";
import { readTokenSigner } from "./context-read-tokens.mjs";

/** @import { ContextEvidenceRow, ContextRawTurn, ContextReadRef, ContextReadSelection, ContextReadSet,
  ContextReadStore, ReadContractStorage, StoredDocumentCardRecord, Tx } from "../ports/index.d.ts" */
/** @typedef {Awaited<ReturnType<ContextReadStore["snapshotState"]>>} Generations */
/** @typedef {ReturnType<typeof readTokenSigner>} Signer */

/** @param {ContextEvidenceRow} row @param {Signer} signer @param {boolean} lineageEnabled */
async function qualifyForAssembly(row, signer, lineageEnabled) {
  const item = await qualifyEvidence(row, signer);
  const receipts = row.type === "memory" && item.type === "memory" && item.provenance.sourceAccess === "available"
    ? item.provenance.sources.map(source => row.receipts.find(receipt => receipt.id === source.receiptId))
    : [];
  const sources = receipts.flatMap(receipt => receipt ? [receipt] : []);
  // Keep the public fetch fence replayable. The assembly-only witness also
  // protects the event times and lineage carried by those qualified receipts.
  return { item, sources, fence: await evidenceFence(signer, item, row, lineageEnabled),
    witness: JSON.stringify(sources.map(({ id, occurredAtMs, sourceTimesMs, rawTurns }) =>
      [id, occurredAtMs, sourceTimesMs, rawTurns])) };
}

/** @typedef {Awaited<ReturnType<typeof qualifyForAssembly>>} AssemblyEvidence */
/** @param {Pick<ReadContractStorage<StoredDocumentCardRecord>, "contextRead" | "uow" | "fence">} storage */
export function fetchForAssembly({ contextRead: store, uow, fence }) {
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
      return Promise.all(requested.map((ref, i) => {
        const row = rows[i];
        return !row || checkRow(ref, row) ? null :
          qualifyForAssembly(row, signer, expected[namespaceSlot(readSet, ref.scope)].lineage !== undefined);
      }));
    }
    const prepared = await uow.run(readSet.owner, { readOnly: true }, async tx => {
      await checkState(tx);
      const signer = readTokenSigner(await store.identity(tx));
      const scope = await signer.bind("snapshot-scope", readSetBinding(readSet));
      const rows = await evidence(tx, signer, refs);
      const selection = { owner: readSet.owner, namespaces: readSet.namespaces };
      const visible = refs.length ? await fence.assertVisible(tx, selection, refs.map(itemRef),
        intent === "history" ? "read" : undefined) : [];
      return { scope, rows: rows.map((row, i) => visible.some(({ id, type, namespace }) =>
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
          await assertContextVisible(fence, tx, readSet, delivered, intent, "snapshot_stale");
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
