import { emitDiagnostic } from "../capture/model-call.mjs";
import { CoreError } from "../errors.mjs";
import { plainExtractionSpec, validatePlainExtraction } from "../extraction/extraction.mjs";
import { writeLedgerQuantities } from "../ledger/index.mjs";
import { sha256Hex } from "../privacy/fingerprint.mjs";
import { receiptExcerpt } from "../privacy/text.mjs";
import {
  buildDocumentCard, detectCardAmendments, documentCardMemoryLinks, documentCardSearchText,
  documentCardVisible, routeDocumentMessages,
} from "../routing/index.mjs";
import { isMarkerOnly, redactDocumentText } from "../routing/redaction.mjs";
import { pauseResult } from "./pause.mjs";
import { validWriteEmbedding } from "./writes.mjs";

/** @import {CaptureKey, CaptureMessage, DocumentCardEmbedding, DocumentCardRecord, DocumentCardSession, FinishItem, FinishResult, ItemRef,
 * Receipt, Tx} from "../ports/index.d.ts" */
/** @import {ExtractedQuantity, LedgerReceipt} from "../ledger/index.mjs" */
/** @import {DocumentCardMemoryState} from "../routing/visibility.mjs" */
/** @typedef {import("./index.d.mts").MemoryServiceDeps} Deps */
/** @typedef {Map<string, DocumentCardEmbedding>} CardVectors */
/** @typedef {ReturnType<typeof validatePlainExtraction>["items"][number] & {quantities?: ExtractedQuantity[]}} ExtractedCandidate */
/** @typedef {Awaited<ReturnType<import("../ports/privacy.d.ts").FingerprintKeyProvider["userKey"]>>} FingerprintKey */
/** @typedef {{status: "failed", code: "fingerprint_key_mismatch"}} KeyMismatch */
/**
 * @typedef {{
 *   key: CaptureKey,
 *   messages: CaptureMessage[],
 *   excludedSources: Set<string>,
 *   sourceKey: FingerprintKey | undefined,
 *   readSourcePassages: (tx: Tx, positions: number[]) => Promise<import("../ports/privacy.d.ts").SuppressionSnapshot["passages"]>,
 *   selectWriteKey: (tx: Tx) => Promise<FingerprintKey>,
 *   filterSources: (positions: number[], passages: import("../ports/privacy.d.ts").SuppressionSnapshot["passages"],
 *     writeKey: FingerprintKey) => Promise<number[]>,
 *   abandonKeyMismatch: (tx: Tx) => Promise<KeyMismatch>,
 *   readEligible: (tx: Tx, key: CaptureKey, messages: readonly CaptureMessage[]) => Promise<number[]>,
 *   runAtGeneration: <T>(work: (tx: Tx) => Promise<T>) => Promise<T | null>,
 *   finish: (tx: Tx, items: readonly FinishItem[]) => Promise<FinishResult>,
 *   assertSendGeneration: () => Promise<void>,
 *   generation: number,
 *   signal: AbortSignal | undefined,
 * }} CaptureContext
 */
/** @typedef {ReturnType<typeof import("../capture/deadline.mjs").createCaptureDeadline>} CaptureDeadline */

/** @param {number | null} time */
function utcDate(time) {
  if (time === null || Math.abs(time) > 8.64e15) return null;
  const date = new Date(time).toISOString().split("T")[0];
  return date.length === 10 ? date : null;
}

/** @param {CaptureKey} key @param {CaptureMessage} message */
function sourceReceipt({ client, sessionId }, { id: messageId, role, occurredAtMs, content }) {
  return { client, sessionId, messageId, role, occurredAtMs, excerpt: receiptExcerpt(content) };
}

/** @param {Receipt} left @param {Receipt} right */
const sameReceipt = (left, right) =>
  left.client === right.client && left.sessionId === right.sessionId &&
  left.messageId === right.messageId && left.role === right.role && left.occurredAtMs === right.occurredAtMs;

/** @param {CaptureKey["scope"]} scope @param {"memory" | "card"} type @param {string} id @returns {ItemRef} */
const ref = ({ namespace }, type, id) => ({ type, namespace, id });

/** @param {CaptureKey["scope"]} scope */
const readScope = ({ owner, namespace }) => ({ owner, namespaces: [namespace] });

/**
 * @param {Deps} deps
 * @param {<T>(signal: AbortSignal, pending: Promise<T>) => Promise<T>} untilAborted
 * @param {(signal: AbortSignal | undefined, deadline: CaptureDeadline) => {signal: AbortSignal, check(): void}} transportFor
 * @param {(signal: AbortSignal | undefined, deadline: CaptureDeadline) => void} checkAbort
 */
export function captureDocumentSteps(deps, untilAborted, transportFor, checkAbort) {
  const { storage, config, model, embedder, clock, gate, diagnostics } = deps;
  const { capabilities, uow, suppressions, raw, hydrate, fence, pause } = storage;
  const cards = capabilities.documentCards && config.documentCards?.enabled ? storage.documentCards : undefined;
  const skipExtraction = model === null;
  const ledger = !skipExtraction && capabilities.quantityLedger && config.quantityLedger?.enabled
    ? storage.quantityLedger : undefined;
  if (!cards && !ledger) return;
  const captureUnavailable = skipExtraction ? !cards || capabilities.fingerprintKey === true : embedder === null;
  /** @param {DocumentCardSession} session */
  const sessionKey = session => deps.documentCardSessionKey ? deps.documentCardSessionKey(session) : session.sessionId;

  /** @param {readonly CaptureMessage[]} messages */
  const extractionSpec = messages => plainExtractionSpec(messages, { quantities: true });

  /** @param {unknown} output @param {{sourceCount: number, itemLimit: number}} policy */
  function validateExtraction(output, policy) {
    const checked = validatePlainExtraction(output, policy, { quantities: true });
    for (let i = 0; i < checked.dropped.invalid_extraction_quantity; i++) {
      emitDiagnostic(diagnostics, "extract", "core_validation", "invalid_extraction_quantity");
    }
    return checked.items.map((item, index) => ({
      ...item, quantities: checked.quantities.filter(quantity => quantity.item === index),
    }));
  }

  /** @param {Tx} tx @param {CaptureKey} key @param {readonly CaptureMessage[]} messages @param {boolean} [beforeArchive] */
  async function screenReceipts(tx, key, messages, beforeArchive = false) {
    const withheld = suppressions.receiptWithheld?.bind(suppressions);
    if (!withheld) return messages;
    const allowed = await Promise.all(messages.map(async message => {
      const receipt = sourceReceipt(key, message);
      return receipt.excerpt !== "" && (beforeArchive
        ? await withheld(tx, key.scope, receipt, message)
        : await withheld(tx, key.scope, receipt)) === false;
    }));
    return messages.filter((_, index) => allowed[index]);
  }

  /**
   * Precompute search vectors without selecting or building any card. A withheld source can move
   * another message into the router's final limit. Only an exact search-text match can use a vector.
   * @param {CaptureKey} key
   * @param {readonly CaptureMessage[]} messages
   * @param {() => {signal: AbortSignal, check(): void}} transportFor
   * @param {() => Promise<void>} assertSendGeneration
   * @returns {Promise<CardVectors | undefined>}
   */
  async function embedCards(key, messages, transportFor, assertSendGeneration) {
    if (!cards || !embedder || !messages.length) return;
    const texts = [...new Set(messages.flatMap(({ content }) => {
      const body = redactDocumentText(content, true);
      if (!body || body.length > 4000 || isMarkerOnly(body) ||
          (body.length < 200 && (redactDocumentText(content)?.length ?? 0) < 200)) return [];
      const firstLine = body.split("\n").find(line => line.trim());
      if (firstLine === undefined) return [];
      const title = firstLine.trim().slice(0, 200).replace(/[\uD800-\uDBFF]$/u, "");
      return [documentCardSearchText({ title, body })];
    }))];
    if (!texts.length) return;
    await gate.assertOpen(key.scope.owner, "pre-send");
    const { signal, check } = transportFor();
    await assertSendGeneration();
    await gate.assertOpen(key.scope.owner, "dispatch");
    let vectors;
    try {
      check();
      vectors = await untilAborted(signal, embedder.embed(texts, { signal }));
    } catch (error) {
      check();
      throw error;
    } finally {
      await gate.assertOpen(key.scope.owner, "post-send");
    }
    check();
    /** @type {CardVectors} */
    const embeddings = new Map();
    if (Array.isArray(vectors) && vectors.length <= texts.length) {
      for (const [index, text] of texts.entries()) {
        const vector = vectors[index];
        if (validWriteEmbedding(vector, embedder.dimensions)) embeddings.set(text, { model: embedder.model, vector });
      }
    }
    return embeddings;
  }

  /**
   * @param {Tx} tx @param {CaptureKey} key @param {readonly CaptureMessage[]} messages
   * @param {readonly FinishItem[]} items @param {FinishResult} result @param {CardVectors | undefined} vectors
   * @param {WeakMap<FinishItem["receipts"], ExtractedQuantity[]> | undefined} quantities
   * @param {Set<string> | undefined} screenedForEmbedding
   */
  async function write(tx, key, messages, items, result, vectors, quantities, screenedForEmbedding) {
    const { scope, client, sessionId } = key;
    const allowed = await screenReceipts(tx, key, messages);
    if (!allowed.length) return allowed;

    const suppressed = new Set(result.suppressedItems);
    const surviving = items.filter((_, index) => !suppressed.has(index));
    const mapped = suppressed.size === result.suppressedCount && surviving.length === result.memories.length;
    if (!mapped) emitDiagnostic(diagnostics, "extract", "core_finish", "capture_finish_mapping_unavailable");
    const ambiguous = new Set(mapped ? [] : surviving.flatMap(({ receipts }) => receipts.map(({ messageId }) => messageId)));
    const written = (mapped ? surviving : []).map(({ receipts }, index) => ({
      ...result.memories[index], receipts, quantities: quantities?.get(receipts),
    }));
    const canonicalSessionKey = cards && sessionKey({ client, sessionId });
    if (cards && canonicalSessionKey) {
      const cardSources = allowed.filter(({ id }) => !ambiguous.has(id) && (!embedder || screenedForEmbedding?.has(id)));
      for (const { position } of routeDocumentMessages(cardSources).chosen) {
        const message = cardSources[position];
        const { card } = await buildDocumentCard(message, { scope, client, canonicalSessionKey });
        if (!card) continue;
        const sourceMessage = { client, sessionId, messageId: message.id };
        const sourceMemories = documentCardMemoryLinks(sourceMessage, written);
        const embedding = vectors?.get(documentCardSearchText(card));
        if (embedder && !embedding) throw new CoreError("embedding_failed");
        const record = {
          id: card.id, scope, origin: /** @type {const} */ ("router"), title: card.title, body: card.body,
          contentHash: "sha256:" + await sha256Hex(card.body), date: card.date, sourceMessage, sourceMemories,
          sentences: card.sentences.map(({ start, end }) => ({ start, end, source: sourceMessage })), stale: [],
        };
        const { status } = embedding ? await cards.put(tx, scope, record, embedding) : await cards.put(tx, scope, record);
        if (status === "unchanged" || status === "replaced") {
          await cards.linkMemories(tx, scope, card.id, sourceMemories);
        }
      }
    }
    if (ledger) {
      const byMessage = new Map(allowed.map(message => [message.id, message]));
      const eligible = written.filter(({ quantities, receipts }) => quantities?.length &&
        receipts.every(receipt => {
          const message = byMessage.get(receipt.messageId);
          return message && sameReceipt(receipt, sourceReceipt(key, message));
        }));
      const refs = [...new Set(eligible.map(({ id }) => id))].map(id => ref(scope, "memory", id));
      const hydrated = refs.length ? await hydrate.hydrate(tx, readScope(scope), refs, "recall") : [];
      const byMemory = new Map(hydrated.filter(({ ref }) => ref.type === "memory" && ref.namespace === scope.namespace)
        .map(item => [item.ref.id, item]));
      for (const { id, receipts, quantities } of eligible) {
        if (!quantities) continue;
        const userReceipts = receipts.filter(({ role }) => role === "user");
        if (!userReceipts.length) continue;
        const unresolved = () => {
          for (const _ of quantities) emitDiagnostic(diagnostics, "extract", "core_finish", "ledger_receipt_unresolved");
        };
        const row = byMemory.get(id);
        if (row?.memory?.id !== id || row.memory.historical ||
            row.memory.scope.owner !== scope.owner || row.memory.scope.namespace !== scope.namespace) {
          unresolved();
          continue;
        }
        const sources = userReceipts.map(receipt => ({
          ...receipt, excerpt: receiptExcerpt(byMessage.get(receipt.messageId)?.content ?? ""),
        }));
        const ids = storage.capture.retainedReceiptIds
          ? await storage.capture.retainedReceiptIds(tx, scope, id, sources)
          : sources.map(receipt => {
            const ids = new Set(row.receipts?.filter(candidate => candidate.id && sameReceipt(candidate, receipt) &&
              (candidate.excerpt === undefined || candidate.excerpt === receipt.excerpt)).map(candidate => candidate.id));
            return ids.size === 1 ? [...ids][0] : undefined;
          });
        /** @type {LedgerReceipt[]} */
        const citedReceipts = [];
        for (const [index, { messageId, role, occurredAtMs }] of sources.entries()) {
          const receiptId = ids[index];
          if (!receiptId) break;
          citedReceipts.push({ receiptId, messageId, role, occurredAtMs, content: byMessage.get(messageId)?.content ?? "" });
        }
        if (citedReceipts.length !== sources.length) {
          unresolved();
          continue;
        }
        await writeLedgerQuantities(tx, scope, ledger, {
          memoryId: id, textHash: row.memory.textHash, captureTimeMs: clock.nowMs(), quantities, citedReceipts,
        });
      }
    }
    return allowed;
  }

  /** @param {Tx} tx @param {CaptureKey["scope"]} scope @param {DocumentCardRecord} card */
  async function visible(tx, scope, card) {
    const read = readScope(scope);
    const target = ref(scope, "card", card.id);
    const shown = await fence.assertVisible(tx, read, [target], "read");
    if (!shown.some(item => item.type === target.type && item.id === target.id && item.namespace === target.namespace)) {
      return false;
    }
    const refs = card.sourceMemories.map(({ id }) => ref(scope, "memory", id));
    const rows = refs.length ? await hydrate.hydrate(tx, read, refs, "read") : [];
    /** @type {Map<string, DocumentCardMemoryState>} */
    const memoryStates = new Map();
    for (const { memory } of rows) {
      if (memory?.scope.owner === scope.owner && memory.scope.namespace === scope.namespace) {
        memoryStates.set(memory.id, { status: memory.historical ? "historical" : "visible", revision: memory.revision });
      }
    }
    return (await documentCardVisible({
      card: { ...card, canonicalSessionKey: sessionKey(card.sourceMessage) }, requestedScope: scope, memoryStates,
      sourceWithheld: false,
    })).visible;
  }

  /**
   * @param {CaptureKey} key @param {readonly CaptureMessage[]} messages @param {number} generation
   * @param {() => Promise<void>} assertSendGeneration @param {AbortSignal | undefined} caller
   * @param {(tx: Tx, message: CaptureMessage) => Promise<boolean>} sourceStillEligible
   */
  async function amend(key, messages, generation, assertSendGeneration, caller, sourceStillEligible) {
    if (!cards || !config.documentCards?.amendments || !model || !messages.some(({ role }) => role === "user")) return;
    try {
      const { detectChanges, verifyChange } = model;
      if (typeof detectChanges !== "function" || typeof verifyChange !== "function") return;
      const { scope, client, sessionId } = key;
      const { owner } = scope;
      const dates = messages.map(({ occurredAtMs }) => utcDate(occurredAtMs)).filter(date => date !== null).sort();
      if (!dates.length) return;
      const earlier = await uow.run(owner, { readOnly: true }, async tx => {
        const eligible = [];
        for (const card of await cards.list(tx, scope)) {
          const source = card.sourceMessage;
          if (!source || (source.client === client && source.sessionId === sessionId)) continue;
          const date = utcDate(card.date);
          if (date === null || date > dates[0] || !await visible(tx, scope, card)) continue;
          eligible.push({ ...card, date });
        }
        return eligible;
      });
      const hashes = new Map(earlier.map(({ id, contentHash }) => [id, contentHash]));
      const byMessage = new Map(messages.map(message => [message.id, message]));

      /** @param {Tx} tx @param {CaptureMessage} message */
      async function correctionEligible(tx, message) {
        return await sourceStillEligible(tx, message) &&
          (!capabilities.rawArchive || await raw?.archiveAllowed(tx, key) === true);
      }

      /** @param {Tx} tx @param {string} cardId @param {CaptureMessage} message */
      async function canAmend(tx, cardId, message) {
        if (!(await screenReceipts(tx, key, [message])).length) return false;
        const card = await cards?.get(tx, scope, cardId);
        return !!card?.sourceMessage && card.contentHash === hashes.get(cardId) && await visible(tx, scope, card);
      }

      /** @template T @param {AbortSignal | undefined} deadline @param {(signal: AbortSignal) => Promise<T>} send */
      async function guarded(deadline, send) {
        const signal = AbortSignal.any([...(caller ? [caller] : []), ...(deadline ? [deadline] : [])]);
        signal.throwIfAborted();
        await gate.assertOpen(owner, "pre-send");
        await assertSendGeneration();
        await gate.assertOpen(owner, "dispatch");
        try {
          signal.throwIfAborted();
          return await untilAborted(signal, send(signal));
        } finally {
          await gate.assertOpen(owner, "post-send");
        }
      }

      const { amendments, counters } = await detectCardAmendments({
        capture: { scope, client, sessionId, date: dates[0], messages }, cards: earlier,
        limits: { timeoutMs: config.deadlines?.extract },
        async canVerify(id, source) {
          const message = byMessage.get(source.messageId);
          if (!message || !await uow.run(owner, { pauseLock: true }, tx => correctionEligible(tx, message))) return false;
          return uow.run(owner, { readOnly: true }, tx => canAmend(tx, id, message));
        },
        model: {
          countTokens: model.countTokens.bind(model),
          detectChanges: (request, options) => guarded(options?.signal, signal => detectChanges.call(model, request, { signal })),
          verifyChange: (request, options) => guarded(options?.signal, signal => verifyChange.call(model, request, { signal })),
        },
      });
      for (const [reason, count] of Object.entries(counters)) {
        if (count && /(?:failed|timeout|malformed_output|token_count_unavailable|skipped_ineligible)$/u.test(reason)) {
          emitDiagnostic(diagnostics, "amendment", "core_call", reason);
        }
      }
      for (const { cardId, amendment } of amendments) {
        try {
          await uow.run(owner, { pauseLock: true }, async tx => {
            const state = pauseResult(await pause.get(tx, owner));
            if (state.paused || state.generation !== generation || caller?.aborted) return;
            const message = byMessage.get(amendment.sourceMessage.messageId);
            if (message && await correctionEligible(tx, message) && await canAmend(tx, cardId, message)) {
              await cards.amend(tx, scope, cardId, amendment);
            }
          });
        } catch {
          emitDiagnostic(diagnostics, "amendment", "core_finish", "amend_failed");
        }
      }
    } catch {
      emitDiagnostic(diagnostics, "amendment", "core_call", "amendment_failed");
    }
  }

  /** @param {CaptureContext} context */
  function forCapture(context) {
    const { key, messages, excludedSources, sourceKey, readSourcePassages, selectWriteKey, filterSources,
      abandonKeyMismatch, readEligible, runAtGeneration, finish, assertSendGeneration, generation, signal } = context;
    const { capture } = storage;
    const archive = capabilities.rawArchive ? raw : undefined;
    // Candidate preparation and embedding preserve the receipts array through finish.
    /** @type {WeakMap<FinishItem["receipts"], ExtractedQuantity[]> | undefined} */
    const quantities = ledger ? new WeakMap() : undefined;
    /** @type {Set<string> | undefined} */
    let screenedForEmbedding;
    /** @type {CardVectors | undefined} */
    let vectors;
    /** @type {readonly CaptureMessage[] | undefined} */
    let finishedMessages;

    /** @param {ExtractedCandidate[]} candidates @param {{item: Pick<FinishItem, "receipts">}[]} prepared */
    function trackQuantities(candidates, prepared) {
      if (!quantities) return;
      for (const [index, candidate] of candidates.entries()) {
        if (candidate.quantities?.length) quantities.set(prepared[index].item.receipts, candidate.quantities);
      }
    }

    /** @param {Tx} tx @param {number[]} positions */
    async function currentSources(tx, positions) {
      const passages = await readSourcePassages(tx, positions);
      const writeKey = capabilities.fingerprintKey && passages.length ? await selectWriteKey(tx) : null;
      if (capabilities.fingerprintKey && passages.length && sourceKey !== undefined && writeKey?.id !== sourceKey?.id) {
        return null;
      }
      return filterSources(positions, passages, writeKey);
    }

    /** @param {number[]} positions */
    const allowedMessages = positions => positions.map(position => messages[position]).filter(({ id }) => !excludedSources.has(id));

    /** @param {CaptureDeadline} deadline @param {number[]} positions */
    async function embed(deadline, positions) {
      if (!cards || !embedder) return;
      const screened = await runAtGeneration(async tx => {
        const eligible = new Set(await readEligible(tx, key, messages));
        const allowed = await currentSources(tx, positions.filter(position => eligible.has(position)));
        if (allowed === null) return abandonKeyMismatch(tx);
        if (allowed.length) await capture.assertEligible(tx, key, allowed);
        if (archive && await archive.archiveAllowed(tx, key) !== true) return [];
        return screenReceipts(tx, key, allowedMessages(allowed), !!archive);
      });
      if (screened === null) return /** @type {const} */ ({ status: "paused" });
      if ("status" in screened) return screened;
      screenedForEmbedding = new Set(screened.map(({ id }) => id));
      vectors = await embedCards(key, screened, () => transportFor(signal, deadline), assertSendGeneration);
    }

    /** @param {Tx} tx @param {readonly CaptureMessage[]} allowed @param {readonly FinishItem[]} items @param {FinishResult} result */
    async function finishDocuments(tx, allowed, items, result) {
      if (allowed.length) finishedMessages = await write(tx, key, allowed, items, result, vectors, quantities, screenedForEmbedding);
    }

    async function afterCommit() {
      if (!finishedMessages?.length) return;
      await amend(key, finishedMessages, generation, assertSendGeneration, signal, async (tx, message) => {
        const position = messages.indexOf(message);
        if (!(await readEligible(tx, key, messages)).includes(position)) return false;
        return (await currentSources(tx, [position]))?.length === 1;
      });
    }

    /** @param {number[]} positions @param {CaptureDeadline} deadline */
    async function finishWithoutExtraction(positions, deadline) {
      const preEmbed = await runAtGeneration(async tx => {
        const eligible = new Set(await readEligible(tx, key, messages));
        return positions.filter(position => eligible.has(position));
      });
      if (preEmbed === null) return /** @type {const} */ ({ status: "paused" });
      const embeddingStopped = await embed(deadline, preEmbed);
      if (embeddingStopped) return embeddingStopped;

      const result = await runAtGeneration(async tx => {
        checkAbort(signal, deadline);
        await capture.assertEligible(tx, key, preEmbed);
        const allowed = await currentSources(tx, preEmbed);
        if (allowed === null) return abandonKeyMismatch(tx);
        checkAbort(signal, deadline);
        const result = await finish(tx, []);
        const rawMessages = allowedMessages(allowed);
        if (archive && rawMessages.length && await archive.archiveAllowed(tx, key) === true) {
          await archive.archive(tx, key, rawMessages);
          await finishDocuments(tx, rawMessages, [], result);
        } else if (!archive) {
          await finishDocuments(tx, rawMessages, [], result);
        }
        return result;
      });
      if (result === null) return /** @type {const} */ ({ status: "paused" });
      if ("status" in result) return result;
      await afterCommit();
      return /** @type {const} */ ({ status: "done", result });
    }

    return { trackQuantities, embed, finishDocuments, afterCommit, finishWithoutExtraction };
  }

  return { captureUnavailable, skipExtraction, forCapture,
    extractionSpec: ledger ? extractionSpec : undefined, validateExtraction: ledger ? validateExtraction : undefined };
}
