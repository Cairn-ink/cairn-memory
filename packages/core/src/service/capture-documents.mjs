import { createCaptureDeadline } from "../capture/deadline.mjs";
import { emitDiagnostic } from "../capture/model-call.mjs";
import { CoreError } from "../errors.mjs";
import { plainExtractionSpec, validatePlainExtraction } from "../extraction/extraction.mjs";
import { reconcileLedgerQuantities } from "../ledger/index.mjs";
import { QUANTITY_TEXT_FIELDS } from "../ledger/quantities.mjs";
import { fingerprintMemoryPassages, sha256Hex } from "../privacy/fingerprint.mjs";
import { prepareCoreText, receiptExcerpt } from "../privacy/text.mjs";
import { withholdsAnyPassage } from "../privacy/withholds.mjs";
import {
  buildDocumentCard, buildVerifyRequest, checkChangeCandidates, detectCardAmendments, documentCardMemoryLinks,
  documentCardSearchText, documentCardVisible, routeDocumentMessages,
} from "../routing/index.mjs";
import { redactDocumentText } from "../routing/redaction.mjs";
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
 *   unchangedPositions: (tx: Tx, positions: number[]) => Promise<number[]>,
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
  const { capabilities, uow, suppressions, raw, hydrate, fence, pause, keys } = storage;
  const cards = capabilities.documentCards && config.documentCards?.enabled ? storage.documentCards : undefined;
  const skipExtraction = model === null;
  const ledger = !skipExtraction && capabilities.quantityLedger && config.quantityLedger?.enabled
    ? storage.quantityLedger : undefined;
  if (!cards && !ledger) return;
  const captureUnavailable = skipExtraction ? !cards || capabilities.fingerprintKey === true : embedder === null;
  /** @param {DocumentCardSession} session */
  const sessionKey = session => deps.documentCardSessionKey ? deps.documentCardSessionKey(session) : session.sessionId;

  /**
   * @template T
   * @param {{signal: AbortSignal, check(): void}} transport
   * @param {() => Promise<T>} refresh
   */
  async function awaitRefresh(transport, refresh) {
    transport.check();
    try { return await untilAborted(transport.signal, refresh()); }
    finally { transport.check(); }
  }

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
   * @param {Tx} tx @param {CaptureKey["scope"]} scope @param {boolean} [allOrigins]
   * @returns {Promise<(texts: readonly string[]) => Promise<boolean>>}
   */
  async function readTextWithholding(tx, scope, allOrigins = false) {
    const facts = (await suppressions.snapshot(tx, scope, {})).passages
      .map(({ fact }) => fact).filter(({ origin }) => allOrigins || origin === "forget");
    const fingerprintKey = facts.length && capabilities.fingerprintKey
      ? await (keys.userKeyForWrite ? keys.userKeyForWrite(tx) : keys.userKey(scope.owner)) : null;
    const digesters = facts.length ? await keys.retainedDigesters?.(scope.owner) : undefined;
    return async texts => {
      if (!facts.length) return false;
      const passages = await Promise.all([...new Set(texts)].map(text =>
        fingerprintMemoryPassages(text, prepareCoreText(text), fingerprintKey, undefined, digesters)));
      return withholdsAnyPassage(passages.flat(), facts);
    };
  }

  /** @param {{body: string, sentences: readonly {start: number, end: number}[]}} card */
  const sentenceTexts = ({ body, sentences }) => sentences.map(({ start, end }) => body.slice(start, end));

  /** @param {import("../routing/index.mjs").DocumentCard} card */
  function cardPassageTexts(card) {
    const texts = sentenceTexts(card);
    if (card.title) texts.push(card.title);
    return texts;
  }

  /**
   * @param {Tx} tx @param {CaptureKey} key @param {readonly CaptureMessage[]} messages
   * @param {readonly FinishItem[]} items @param {FinishResult} result @param {CardVectors | undefined} vectors
   * @param {WeakMap<FinishItem["receipts"], ExtractedQuantity[]> | undefined} quantities
   * @param {Set<string> | undefined} screenedForEmbedding
   * @param {Set<string> | undefined} withheldEmbeddings
   */
  async function write(tx, key, messages, items, result, vectors, quantities, screenedForEmbedding, withheldEmbeddings) {
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
    /** @type {ReturnType<typeof readTextWithholding> | undefined} */
    let textWithholding;
    const canonicalSessionKey = cards && sessionKey({ client, sessionId });
    if (cards && canonicalSessionKey) {
      const cardSources = allowed.filter(({ id }) => !ambiguous.has(id) && (!embedder || screenedForEmbedding?.has(id)));
      const { chosen } = routeDocumentMessages(cardSources);
      for (const { position } of chosen) {
        const message = cardSources[position];
        const { card } = await buildDocumentCard(message, { scope, client, canonicalSessionKey });
        if (!card) continue;
        // Whole-source and extracted-memory checks can miss an exact forget of the title or a sentence.
        const withholds = await (textWithholding ??= readTextWithholding(tx, scope));
        if (await withholds(cardPassageTexts(card))) continue;
        const sourceMessage = { client, sessionId, messageId: message.id };
        const sourceMemories = documentCardMemoryLinks(sourceMessage, written);
        // A card that passes the stored-state checks can still have its embedding withheld.
        const embeddingWithheld = withheldEmbeddings?.has(message.id);
        const embedding = embeddingWithheld ? undefined : vectors?.get(documentCardSearchText(card));
        if (embedder && !embeddingWithheld && !embedding) throw new CoreError("embedding_failed");
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
        const captureTimeMs = clock.nowMs();
        const existingRows = await ledger.listForMemory(tx, scope, id);
        const rows = reconcileLedgerQuantities({
          memoryId: id, textHash: row.memory.textHash, captureTimeMs, quantities, citedReceipts, existingRows,
        });
        if (!rows.length) continue;
        const withholds = await (textWithholding ??= readTextWithholding(tx, scope));
        const permitted = [];
        for (const quantityRow of rows) {
          if (await withholds(QUANTITY_TEXT_FIELDS.map(field => quantityRow[field]))) {
            emitDiagnostic(diagnostics, "extract", "core_finish", "ledger_text_withheld");
          } else {
            permitted.push(quantityRow);
          }
        }
        if (permitted.length) await ledger.put(tx, scope, permitted);
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
   * @param {(tx: Tx, message: CaptureMessage, checkUnchanged?: boolean) => Promise<boolean>} sourceStillEligible
   */
  async function amend(key, messages, generation, assertSendGeneration, caller, sourceStillEligible) {
    if (!cards || !config.documentCards?.amendments || !model || !messages.some(({ role }) => role === "user")) return;
    try {
      const { detectChanges, verifyChange } = model;
      if (typeof detectChanges !== "function" || typeof verifyChange !== "function") return;
      const { scope, client, sessionId } = key;
      const { owner } = scope;
      const timeoutMs = config.deadlines?.extract ?? 30_000;
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
      const byCard = new Map(earlier.map(card => [card.id, card]));
      const byMessage = new Map(messages.map(message => [message.id, message]));

      /** @param {Tx} tx @param {CaptureMessage} message @param {boolean} [checkUnchanged] */
      async function correctionEligible(tx, message, checkUnchanged) {
        return await sourceStillEligible(tx, message, checkUnchanged) &&
          (!capabilities.rawArchive || await raw?.archiveAllowed(tx, key) === true);
      }

      /** @param {Tx} tx @param {string} cardId @param {CaptureMessage} message */
      async function canAmend(tx, cardId, message) {
        if (!(await screenReceipts(tx, key, [message])).length) return false;
        const card = await cards?.get(tx, scope, cardId);
        return !!card?.sourceMessage && card.contentHash === byCard.get(cardId)?.contentHash && await visible(tx, scope, card);
      }

      /**
       * @template T
       * @param {AbortSignal | undefined} deadline
       * @param {(signal: AbortSignal) => Promise<T>} send
       * @param {{eligible: () => Promise<boolean>, skip: () => T}} [verification]
       */
      async function guarded(deadline, send, verification) {
        const signal = AbortSignal.any([...(caller ? [caller] : []), ...(deadline ? [deadline] : [])]);
        const transport = verification && transportFor(caller, createCaptureDeadline(timeoutMs, clock));
        const refreshSignal = transport && AbortSignal.any([signal, transport.signal]);

        async function stillEligible() {
          if (!verification || !transport || !refreshSignal) return true;
          const check = () => {
            if (deadline?.aborted && refreshSignal.reason === deadline.reason) throw new CoreError("model_timeout");
            transport.check();
          };
          return awaitRefresh({ signal: refreshSignal, check }, verification.eligible);
        }

        signal.throwIfAborted();
        await gate.assertOpen(owner, "pre-send");
        await assertSendGeneration();
        if (verification) {
          signal.throwIfAborted();
          if (!await stillEligible()) return verification.skip();
        }
        await gate.assertOpen(owner, "dispatch");
        try {
          signal.throwIfAborted();
          // A deletion can commit while the dispatch gate is pending.
          if (verification && !await stillEligible()) return verification.skip();
          signal.throwIfAborted();
          return await untilAborted(signal, send(signal));
        } finally {
          await gate.assertOpen(owner, "post-send");
        }
      }

      const capture = { scope, client, sessionId, date: dates[0], messages };
      /** @type {readonly unknown[]} */
      let changes = [];
      /** @type {ReturnType<typeof checkChangeCandidates>["candidates"] | undefined} */
      let candidates;
      /** @type {{cardId: string, message: CaptureMessage} | undefined} */
      let target;
      const { amendments, counters } = await detectCardAmendments({
        capture, cards: earlier,
        limits: { timeoutMs },
        async canVerify(id, source) {
          const message = byMessage.get(source.messageId);
          if (!message || !await uow.run(owner, { pauseLock: true }, tx => correctionEligible(tx, message))) return false;
          if (!await uow.run(owner, { readOnly: true }, tx => canAmend(tx, id, message))) return false;
          target = { cardId: id, message };
          return true;
        },
        model: {
          countTokens: model.countTokens.bind(model),
          detectChanges: async (request, options) => {
            const result = await guarded(options?.signal, signal => detectChanges.call(model, request, { signal }));
            if (Array.isArray(result?.changes)) changes = result.changes;
            return result;
          },
          verifyChange(request, options) {
            const selected = target;
            target = undefined;
            const card = selected && byCard.get(selected.cardId);
            // Match the validated fields to the wire request so multiline text needs no parsing.
            candidates ??= checkChangeCandidates({
              changes, listedCards: earlier, captureMessages: messages, captureSession: capture,
            }).candidates;
            const texts = candidates.filter(candidate => candidate.card.id === selected?.cardId &&
              candidate.sourceMessage.messageId === selected.message.id &&
              buildVerifyRequest({ ...candidate, sessionDate: capture.date }).input === request.input)
              .flatMap(({ quote, newValue }) => [quote, newValue]);
            return guarded(options?.signal, signal => verifyChange.call(model, request, { signal }), {
              eligible: () => uow.run(owner, { pauseLock: true }, async tx => {
                const state = pauseResult(await pause.get(tx, owner));
                if (state.paused || state.generation !== generation) throw new CoreError("capture_paused");
                // canAmend checks the earlier card and its source through the visibility fence.
                if (!card || !selected || !texts.length ||
                    !await correctionEligible(tx, selected.message, true) ||
                    !await canAmend(tx, selected.cardId, selected.message)) return false;
                const withholds = await readTextWithholding(tx, scope, true);
                return !await withholds([card.body, ...sentenceTexts(card), ...texts]);
              }),
              skip: () => {
                emitDiagnostic(diagnostics, "amendment", "core_call", "verify_skipped_ineligible");
                return { applies: false, line: "" };
              },
            });
          },
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
              const withholds = await readTextWithholding(tx, scope);
              if (await withholds([amendment.quote, amendment.sentence])) {
                emitDiagnostic(diagnostics, "amendment", "core_finish", "amendment_text_withheld");
                return;
              }
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
    const { key, messages, excludedSources, sourceKey, readSourcePassages, unchangedPositions, selectWriteKey,
      filterSources, abandonKeyMismatch, readEligible, runAtGeneration, finish, assertSendGeneration, generation,
      signal } = context;
    const { capture } = storage;
    const archive = capabilities.rawArchive ? raw : undefined;
    // Candidate preparation and embedding preserve the receipts array through finish.
    /** @type {WeakMap<FinishItem["receipts"], ExtractedQuantity[]> | undefined} */
    const quantities = ledger ? new WeakMap() : undefined;
    /** @type {Set<string> | undefined} */
    let screenedForEmbedding;
    /** @type {Set<string> | undefined} */
    let withheldEmbeddings;
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

    /** @param {Tx} tx @param {number[]} positions */
    async function screenEmbeddingSources(tx, positions) {
      const eligible = new Set(await readEligible(tx, key, messages));
      // Erasure can blank a stored slot while the runner still holds the admitted copy.
      const unchanged = await unchangedPositions(tx, positions.filter(position => eligible.has(position)));
      if (!unchanged.length) return [];
      const allowed = await currentSources(tx, unchanged);
      if (allowed === null) return abandonKeyMismatch(tx);
      if (allowed.length) await capture.assertEligible(tx, key, allowed);
      if (archive && await archive.archiveAllowed(tx, key) !== true) return [];
      return screenReceipts(tx, key, allowedMessages(allowed), !!archive);
    }

    /** @param {CaptureDeadline} deadline @param {number[]} positions */
    async function embed(deadline, positions) {
      if (!cards || !embedder) return;
      const transport = transportFor(signal, deadline);
      const screened = await awaitRefresh(transport, () => runAtGeneration(tx => screenEmbeddingSources(tx, positions)));
      if (screened === null) return /** @type {const} */ ({ status: "paused" });
      if ("status" in screened) return screened;
      // Keep the router's input independent of the send-time payload checks.
      screenedForEmbedding = new Set(screened.map(({ id }) => id));

      // Precompute vectors for all potential cards. The finish may route a different subset.
      /** @type {{message: CaptureMessage, card: import("../routing/index.mjs").DocumentCard}[]} */
      const candidates = [];
      for (const message of screened) {
        const { card } = await buildDocumentCard(message, { ...key, canonicalSessionKey: key.sessionId });
        if (!card || (card.body.length < 200 && (redactDocumentText(message.content)?.length ?? 0) < 200)) continue;
        candidates.push({ message, card });
      }
      if (!candidates.length) return;

      const { owner } = key.scope;
      await gate.assertOpen(owner, "pre-send");
      await assertSendGeneration();
      const refreshed = await awaitRefresh(transport, () => runAtGeneration(async tx => {
        const eligible = await screenEmbeddingSources(tx, positions);
        if ("status" in eligible) return eligible;
        const allowed = new Set(eligible);
        if (!allowed.size) return [];
        const withholds = await readTextWithholding(tx, key.scope, true);
        const survivors = [];
        for (const { message, card } of candidates) {
          if (!allowed.has(message)) continue;
          const text = documentCardSearchText(card);
          const payload = [text, card.body, ...cardPassageTexts(card)];
          if (!await withholds(payload)) survivors.push({ message, text });
        }
        return survivors;
      }));
      if (refreshed === null) return /** @type {const} */ ({ status: "paused" });
      if ("status" in refreshed) return refreshed;
      const sentIds = new Set(refreshed.map(({ message }) => message.id));
      withheldEmbeddings = new Set(candidates.map(({ message }) => message.id).filter(id => !sentIds.has(id)));
      if (!refreshed.length) return;
      const texts = [...new Set(refreshed.map(({ text }) => text))];

      await gate.assertOpen(owner, "dispatch");
      let embedded;
      try {
        transport.check();
        embedded = await untilAborted(transport.signal, embedder.embed(texts, { signal: transport.signal }));
      } catch (error) {
        transport.check();
        throw error;
      } finally {
        await gate.assertOpen(owner, "post-send");
      }
      transport.check();
      vectors = new Map();
      if (Array.isArray(embedded) && embedded.length <= texts.length) {
        for (const [index, text] of texts.entries()) {
          const vector = embedded[index];
          if (validWriteEmbedding(vector, embedder.dimensions)) vectors.set(text, { model: embedder.model, vector });
        }
      }
    }

    /** @param {Tx} tx @param {readonly CaptureMessage[]} allowed @param {readonly FinishItem[]} items @param {FinishResult} result */
    async function finishDocuments(tx, allowed, items, result) {
      if (allowed.length) {
        finishedMessages = await write(tx, key, allowed, items, result, vectors, quantities, screenedForEmbedding, withheldEmbeddings);
      }
    }

    async function afterCommit() {
      if (!finishedMessages?.length) return;
      await amend(key, finishedMessages, generation, assertSendGeneration, signal, async (tx, message, checkUnchanged) => {
        const position = messages.indexOf(message);
        if (!(await readEligible(tx, key, messages)).includes(position)) return false;
        if (checkUnchanged && !(await unchangedPositions(tx, [position])).length) return false;
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
        // The card write and the Raw archive map positions back to the admitted copy, so withdraw a
        // blanked or changed slot first. A post-commit amendment check reads Raw instead.
        const unchanged = await unchangedPositions(tx, preEmbed);
        await capture.assertEligible(tx, key, unchanged);
        const allowed = await currentSources(tx, unchanged);
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
