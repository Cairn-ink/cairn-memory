import { buildDocumentCard, documentCardVisible } from "@cairn-ink/core/routing";
import { createMemoryService } from "@cairn-ink/core/service";
import { client, firstDay, message } from "./capture-documents-support.mjs";
import { assemblyClock, fixtureCount, formatAssembly } from "./context-assembly-cases.mjs";
import { check, equal, row, source } from "./support.mjs";

/** @import { ContextReadSet, DocumentCardWrite, ReadContextInput, ReadContractStorage,
 * StorageAdapter, StoredDocumentCardRecord, Tx } from "@cairn-ink/core/ports" */
/** @import { ConformanceCase } from "./index.d.mts" */

/** @type {ConformanceCase} */
export const DOCUMENT_CARD_CORRECTION_PRIVACY_CASE = {
  id: "T-CARD-CORRECT-RECEIPT-PRIVACY",
  title: "delivers a regenerated card without its replaced text or withheld receipt",
  needs: ["documentCards", "rawArchive", "inspect", "contextRead"],
  requests: { documentCardSearch: true },
  async run(ctx) {
    const storage = /** @type {StorageAdapter<StoredDocumentCardRecord> & ReadContractStorage<StoredDocumentCardRecord>} */ (ctx.adapter);
    const { documentCards: cards, memories, raw, uow } = storage;
    check(cards?.visibilityInputs && raw, "Expected card evidence and Raw archive");
    const load = cards.visibilityInputs.bind(cards);
    const scope = ctx.scope(null), sessionId = "workshop";
    /** @template T @param {(tx: Tx) => Promise<T>} work */
    const write = work => uow.run(scope.owner, { pauseLock: true }, work);
    /** @template T @param {(tx: Tx) => Promise<T>} work */
    const read = work => uow.run(scope.owner, { readOnly: true }, work);
    const original = "The telescope uses brass fasteners.";
    const corrected = "The telescope takes polymer rivets.";
    const previous = message("previous", original);
    const control = message("control", "A telescope inspection is due this week.");
    const cardTurn = message("workshop-notes", "Telescope service notes\n\nLog the date of each inspection.");
    const sourceMessage = { client, sessionId, messageId: cardTurn.id };
    const canonicalSessionKey = ctx.harness.hashSessionKey?.(client, sessionId) ?? sessionId;
    const { card: built } = await buildDocumentCard(cardTurn, { scope, client, canonicalSessionKey });
    check(built, "Expected a routed card");
    const seed = await row(ctx, original);
    const initialHash = await ctx.hash(cardTurn.content);
    const { link, card } = await write(async tx => {
      const turns = [previous, control, cardTurn];
      await raw.archive(tx, { scope, client, sessionId, eventId: cardTurn.id, payloadDigest: initialHash.slice(7) }, turns);
      const link = await memories.insert(tx, scope, seed, [previous, control].map(turn => ({
        client, sessionId, messageId: turn.id, role: turn.role, occurredAtMs: turn.occurredAtMs, excerpt: turn.content,
      })), firstDay);
      /** @type {DocumentCardWrite<StoredDocumentCardRecord>} */
      const card = { id: built.id, origin: "router", scope, title: built.title,
        body: built.body, contentHash: initialHash, date: built.date,
        sourceMessage, sourceMemories: [{ id: link.id, revision: link.revision }], sentences: [], stale: [] };
      equal((await cards.put(tx, scope, card)).status, "inserted", "Expected the original card");
      return { link, card };
    });
    const service = createMemoryService({
      storage, config: { documentCards: { enabled: true } }, clock: assemblyClock(),
      model: { model: "unused", contextWindow: 32_768, countTokens: () => 1,
        async call() { throw new Error("Read used extraction"); } },
      embedder: { model: "test", dimensions: ctx.embeddingDimensions ?? 1,
        async embed(texts) { return texts.map(() => Float32Array.from(ctx.embeddingDimensions ? ctx.vec(0) : [1])); } },
      gate: { async assertOpen() {} }, tokens: { countTokens: () => 1 },
      contextReadFormat: formatAssembly, contextReadCounter: { count: fixtureCount },
    });
    const { inspect, readContext, findCandidates, fetchEvidence } = service;
    check(readContext && findCandidates && fetchEvidence, "Expected Context Read service methods");
    const inspectMemory = () => inspect(scope, { memoryId: link.id, includeQualification: true });
    const before = await inspectMemory();
    check(before.mode === "item", "Expected inspect item output");
    const hiddenId = before.receipts.find(receipt => receipt.excerpt === original)?.id;
    const controlId = before.receipts.find(receipt => receipt.excerpt === control.content)?.id;
    check(hiddenId && controlId && hiddenId !== controlId, "Expected two distinct visible receipt IDs before correction");
    equal((await service.readCard(scope, card.id)).status, "found", "Expected the original card to be deliverable");

    const next = await service.correct(scope, link.id, link.revision, corrected, source);
    check(next.status === "saved" && next.item.revision > link.revision, "Expected an in-place correction without a new receipt");
    equal((await service.readCard(scope, card.id)).status, "not_found", "The old card body must be withheld");
    const body = "Check the telescope's polymer rivets during each inspection.";
    const contentHash = await ctx.hash(body);
    equal((await write(tx => cards.put(tx, scope, { ...card, body, contentHash,
      sourceMemories: [{ id: next.item.id, revision: next.item.revision }] }))).status, "replaced", "Expected a new card body");

    /** @param {unknown} value @param {string} surface */
    const excludesWithheldReceipt = (value, surface) => {
      const text = typeof value === "string" ? value : JSON.stringify(value, (_key, item) =>
        item instanceof Map ? [...item] : item);
      check(!text.includes(original), surface + " exposed the replaced text");
      check(!text.includes(hiddenId), surface + " exposed the withheld receipt ID");
    };
    const delivered = await service.readCard(scope, card.id);
    check(delivered.status === "found" && delivered.card.body === body, "Expected the regenerated card body");
    excludesWithheldReceipt(delivered, "Card payload");
    excludesWithheldReceipt(await read(tx => cards.get(tx, scope, card.id)), "Stored card projection");
    const [evidence] = await read(tx => load(tx, scope, [{ type: "card", namespace: scope.namespace, id: card.id }]));
    check(evidence && (await documentCardVisible(evidence)).visible, "Expected visible card evidence");
    excludesWithheldReceipt(evidence, "Card visibility evidence");
    const inspected = await inspectMemory();
    check(inspected.mode === "item" && inspected.memory.text === corrected &&
      inspected.receipts.some(receipt => receipt.id === controlId), "Expected the corrected memory and its visible receipt");
    excludesWithheldReceipt(inspected, "Inspect");

    /** @type {ContextReadSet} */
    const set = { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [1] };
    // The reference supplies native card candidates. SQLite supplies memory
    // candidates and checks the card through visibilityInputs above.
    const nativeCards = storage.capabilities.documentCardSearch;
    /** @type {ReadContextInput} */
    const request = { query: "telescope", types: nativeCards ? ["card", "memory"] : ["memory"],
      intent: "current", semantic: false };
    const found = await findCandidates(set, request);
    const fetched = await fetchEvidence(set, { refs: found.items.map(({ ref }) => ref), intent: "current" });
    check(fetched.items.some(item => item.type === "memory" && item.text === corrected &&
      item.provenance.sources.some(receipt => receipt.receiptId === controlId)), "Expected qualified memory evidence and sources");
    if (nativeCards) {
      check(fetched.items.some(item => item.type === "card" && item.body === body), "Expected qualified card evidence");
    }
    excludesWithheldReceipt(fetched, "Context Read evidence and sources");
    const memoryText = formatAssembly((await readContext(set, { ...request, types: ["memory"] })).assembly);
    check(memoryText.includes(corrected), "Expected formatted Context Read memory content");
    excludesWithheldReceipt(memoryText, "Formatted memory Context Read");
    if (nativeCards) {
      const cardText = formatAssembly((await readContext(set, { ...request, types: ["card"] })).assembly);
      check(cardText.includes(body), "Expected formatted Context Read card content");
      excludesWithheldReceipt(cardText, "Formatted card Context Read");
    }
  },
};
