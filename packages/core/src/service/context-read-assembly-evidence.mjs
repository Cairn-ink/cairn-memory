import { CoreError } from "../errors.mjs";
import { digest, ledgerRowDeliverable, ledgerRowInRange, ledgerRowKey, parseWindow, readIntent } from "../ledger/index.mjs";
import { weekStart, yearStart } from "../ledger/window.mjs";
import { documentCardAmendmentVisible, selectVisibleAmendmentsForRead } from "../routing/amendment-read.mjs";
import { compareUtf8 } from "../utf8.mjs";
import { assertContextVisible, contextCardVerdict, hasContextCardLoader, legacyContextCard, qualifyEvidence } from "./context-read-evidence.mjs";
import { canonicalGenerations, checkRow, evidenceFence, snapshotRefs } from "./context-read-fetch.mjs";
import { itemRef, namespaceSlot, readSetBinding } from "./context-read-input.mjs";
import { readTokenSigner } from "./context-read-tokens.mjs";

/** @import { ContextEvidenceRow, ContextLedgerDigestItem, ContextMemoryRef, ContextRawTurn, ContextReadRef,
  ContextReadSelection, ContextReadSet, ContextReadStore, DocumentCardAmendment, MemoryStore, QuantityLedgerRow,
  QuantityLedgerStore, ReadContractStorage, StoredDocumentCardRecord, Tx, VisibilityFence } from "../ports/index.d.ts" */
/** @import { LedgerMemoryState, LedgerReadState } from "../ledger/index.mjs" */
/** @typedef {Awaited<ReturnType<ContextReadStore["snapshotState"]>>} Generations */
/** @typedef {ReturnType<typeof readTokenSigner>} Signer */

/** @typedef {Pick<DocumentCardAmendment, "date" | "sentence" | "quote">} ReadAmendment */
/** @typedef {{ query: string, asOfMs: number }} LedgerRequest */

const MIN_EVENT_MS = -8_640_000_000_000_000;
export const staleLedger = new Error("stale quantity ledger");

/** @param {ContextReadStore} store @param {Pick<MemoryStore, "readRevision">} memories @param {QuantityLedgerStore} ledger
 * @param {VisibilityFence} fence @param {Tx} tx @param {Signer} signer @param {ContextReadSet} readSet
 * @param {LedgerRequest} request @returns {Promise<{ item: ContextLedgerDigestItem, witness: string } | null>} */
async function readLedgerDigest(store, memories, ledger, fence, tx, signer, readSet, { query, asOfMs }) {
  try {
    /** @type {ReturnType<typeof parseWindow> | undefined} */
    let window;
    /** @type {QuantityLedgerRow[]} */
    const checked = [];
    /** @type {string[]} */
    const rowKeys = [];
    /** @type {Map<string, ContextEvidenceRow & { type: "memory" }>} */
    const sourceRows = new Map();
    for (const namespace of readSet.namespaces) {
      const scope = { owner: readSet.owner, namespace };
      if (!readIntent(query, await ledger.terms(tx, scope))) continue;
      const range = window ??= parseWindow(query, asOfMs);
      const start = Math.min(range.fromMs, weekStart(range.toMs - 1), yearStart(range.toMs - 1));
      const earlier = { fromMs: MIN_EVENT_MS, toMs: range.fromMs };
      const rows = [...(await ledger.list(tx, scope, { fromMs: range.fromMs, toMs: range.toMs }))
        .filter(row => ledgerRowInRange(row, range)),
        ...(await ledger.list(tx, scope, earlier)).filter(row =>
          ledgerRowInRange(row, earlier) && (row.kind === "goal" || row.date >= start))];
      /** @type {ContextMemoryRef[]} */
      const refs = [];
      const memoryTextHashes = new Map();
      for (const id of new Set(rows.map(row => row.memoryId))) {
        const current = await memories.readRevision(tx, scope, id);
        if (!current) continue;
        refs.push({ type: "memory", scope, id, revision: current.revision });
        memoryTextHashes.set(id, current.textHash);
      }
      if (!refs.length) continue;
      const evidence = structuredClone(await store.evidence(tx, readSet, refs, "current"));
      const visible = await fence.assertVisible(tx, { owner: readSet.owner, namespaces: [namespace] }, refs.map(itemRef));
      const visibleIds = new Set(visible.flatMap(ref =>
        ref.type === "memory" && ref.namespace === namespace ? [ref.id] : []));
      /** @type {Map<string, LedgerMemoryState>} */
      const memoryStates = new Map();
      const retainedReceipts = new Map();
      const ns = namespaceSlot(readSet, scope);
      const scopedId = (/** @type {string} */ id) => JSON.stringify([ns, id]);
      for (const [i, ref] of refs.entries()) {
        const row = evidence[i];
        if (row?.type !== "memory" || checkRow(ref, row) || !visibleIds.has(ref.id) ||
            row.metadata.state !== "active" || row.sourceAccess !== "available") continue;
        memoryStates.set(ref.id, "current_visible");
        retainedReceipts.set(ref.id, new Set(row.receipts.slice(0, 16)
          .filter(receipt => receipt.role === "user").map(receipt => receipt.id)));
        sourceRows.set(scopedId(ref.id), row);
      }
      /** @type {LedgerReadState} */
      const state = { memoryStates, retainedReceipts, memoryTextHashes };
      const ordered = rows.map(row => ({ row, key: JSON.stringify([ns, ledgerRowKey(row), row.group, row.date, row.textHash]) }))
        .sort((a, b) => compareUtf8(a.key, b.key));
      for (const { row, key } of ordered) {
        if (!ledgerRowDeliverable(row, state)) continue;
        checked.push({ ...row, memoryId: scopedId(row.memoryId) });
        rowKeys.push(key);
      }
    }
    if (!window) return null;
    const result = digest(checked.filter(row => row.kind === "record"), checked.filter(row => row.kind === "goal"), window);
    if (!result) return null;
    const sources = [];
    const fences = [];
    for (const id of result.sources) {
      const row = sourceRows.get(id);
      if (!row) return null;
      const mac = await evidenceFence(signer, await qualifyEvidence(row, signer), row, false);
      const { scope, id: memoryId, revision } = row.ref;
      sources.push({ index: sources.length, role: /** @type {const} */ ("user"),
        memory: { ns: namespaceSlot(readSet, scope), type: /** @type {const} */ ("memory"), id: memoryId, rev: revision, f: mac.slice(0, 8) } });
      fences.push(mac);
    }
    const item = /** @type {const} */ ({ ref: sources[0].memory, rank: 1, kind: "quantity-ledger", body: result.body, sources });
    return { item, witness: JSON.stringify([item, rowKeys, fences]) };
  } catch {
    // Ledger evidence is optional when any read or visibility check fails.
    return null;
  }
}

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
/** @param {Pick<ReadContractStorage<StoredDocumentCardRecord>, "contextRead" | "uow" | "fence" | "documentCards" |
 * "quantityLedger"> & { memories?: Pick<MemoryStore, "readRevision"> }} storage */
export function fetchForAssembly({ contextRead: store, uow, fence, documentCards, memories, quantityLedger }) {
  const cardsEnabled = hasContextCardLoader(documentCards);
  /** @param {ContextReadSet} readSet @param {ContextReadSelection} selection @param {Generations} observed
   * @param {readonly ContextReadRef[]} refs @param {LedgerRequest} [ledgerRequest] */
  return async (readSet, { intent, types }, observed, refs, ledgerRequest) => {
    if (!store) throw new CoreError("capability_unavailable");
    const readStore = store;
    const ledgerFor = (/** @type {Tx} */ tx, /** @type {Signer} */ signer) => ledgerRequest && quantityLedger && memories
      ? readLedgerDigest(readStore, memories, quantityLedger, fence, tx, signer, readSet, ledgerRequest) : null;
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
        const legacy = !cardsEnabled && legacyContextCard(row, lineage);
        const documentCard = row.type === "card" && !legacy;
        if (documentCard) {
          const cardVisibility = await contextCardVerdict(documentCards, tx, ref, row.item);
          if (!cardVisibility) return null;
          const card = readStore.documentCardAmendmentSource && documentCards
            ? await Promise.resolve().then(() => documentCards.get(tx, ref.scope, ref.id)).catch(() => null) : null;
          const stored = card?.id === ref.id && card.scope.owner === ref.scope.owner && card.scope.namespace === ref.scope.namespace
            ? card.amendments : [];
          const visible = await selectVisibleAmendmentsForRead(stored, async ({ sourceMessage, quote }) => {
            try {
              const projection = await readStore.documentCardAmendmentSource?.(tx, readSet, ref.scope, { sourceMessage, quote });
              return !!projection && documentCardAmendmentVisible({ ...projection, scope: ref.scope, cardVisibility });
            } catch {
              return false;
            }
          });
          for (const { date, sentence, quote } of visible) amendments.push({ date, sentence, quote });
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
      const fenceRefs = cardsEnabled ? refs.filter(ref => ref.type !== "card") : refs;
      const visible = fenceRefs.length ? await fence.assertVisible(tx, selection, fenceRefs.map(itemRef),
        intent === "history" ? "read" : undefined) : [];
      const ledger = ledgerRequest ? await ledgerFor(tx, signer) : null;
      return { scope, ledger, rows: rows.map((row, i) => row?.documentCard || visible.some(({ id, type, namespace }) =>
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
      ledger: prepared.ledger?.item,
      payload,
      /** @param {readonly AssemblyEvidence[]} selected @param {readonly ContextRawTurn[]} rawTurns
       * @param {AbortSignal} [signal] @param {boolean} [ledgerIncluded]
       * @returns {Promise<string | null | undefined | typeof staleLedger>} Undefined indicates a stale Raw witness. */
      async deliver(selected, rawTurns, signal, ledgerIncluded) {
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
          if (ledgerIncluded && (await ledgerFor(tx, signer))?.witness !== prepared.ledger?.witness) {
            return staleLedger;
          }
          const snapshot = selected.length ? await signer.encode("snapshot", payload(selected)) : null;
          if (signal?.aborted) throw new CoreError("snapshot_stale");
          return snapshot;
        });
      },
    };
  };
}
