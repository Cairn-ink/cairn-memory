import { emitDiagnostic } from "../capture/model-call.mjs";
import { CoreError } from "../errors.mjs";
import { plainExtractionSpec, validatePlainCandidates, validatePlainExtraction } from "../extraction/extraction.mjs";
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
/** @typedef {{item: FinishItem, quantities?: ExtractedQuantity[]}} Candidate */
/** @typedef {Map<string, DocumentCardEmbedding>} CardVectors */

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
 */
export function captureDocumentSteps(deps, untilAborted) {
  const { storage, config, model, embedder, clock, gate, diagnostics } = deps;
  const { capabilities, uow, suppressions, raw, hydrate, inspect, fence, pause } = storage;
  const cards = capabilities.documentCards && config.documentCards?.enabled ? storage.documentCards : undefined;
  const ledger = model && capabilities.quantityLedger && config.quantityLedger?.enabled ? storage.quantityLedger : undefined;
  /** @param {DocumentCardSession} session */
  const sessionKey = session => deps.documentCardSessionKey ? deps.documentCardSessionKey(session) : session.sessionId;

  /** @param {readonly CaptureMessage[]} messages */
  const extractionSpec = messages => ledger ? plainExtractionSpec(messages, { quantities: true }) : plainExtractionSpec(messages);

  /** @param {unknown} output @param {{sourceCount: number, itemLimit: number}} policy */
  function validateExtraction(output, policy) {
    const checked = ledger ? validatePlainExtraction(output, policy, { quantities: true }) : undefined;
    const items = checked?.items ?? validatePlainCandidates(output, policy);
    for (let i = 0; i < (checked?.dropped.invalid_extraction_quantity ?? 0); i++) {
      emitDiagnostic(diagnostics, "extract", "core_validation", "invalid_extraction_quantity");
    }
    return items.map((item, index) => ({
      ...item, quantities: checked?.quantities.filter(quantity => quantity.item === index),
    }));
  }

  /** @param {Tx} tx @param {CaptureKey} key @param {readonly CaptureMessage[]} messages */
  async function screenReceipts(tx, key, messages) {
    const withheld = suppressions.receiptWithheld?.bind(suppressions);
    if (!withheld) return messages;
    const allowed = await Promise.all(messages.map(async message => {
      const receipt = sourceReceipt(key, message);
      return receipt.excerpt !== "" && await withheld(tx, key.scope, receipt) === false;
    }));
    return messages.filter((_, index) => allowed[index]);
  }

  /** @param {Tx} tx @param {CaptureKey} key @param {readonly CaptureMessage[]} messages */
  async function beforeEmbedding(tx, key, messages) {
    if (capabilities.rawArchive) {
      // Some stores require the Raw row to exist before they can decide receipt visibility.
      return await raw?.archiveAllowed(tx, key) === true ? messages : [];
    }
    return screenReceipts(tx, key, messages);
  }

  /**
   * Precompute search vectors without selecting or building any card. A withheld source can move
   * another message into the router's final limit. Only an exact search-text match can use a vector.
   * @param {CaptureKey} key
   * @param {readonly CaptureMessage[]} messages
   * @param {() => {signal: AbortSignal, check(): void}} transportFor
   * @returns {Promise<CardVectors | undefined>}
   */
  async function embedCards(key, messages, transportFor) {
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
    const { signal, check } = transportFor();
    await gate.assertOpen(key.scope.owner, "dispatch");
    let vectors;
    try {
      check();
      vectors = await untilAborted(signal, embedder.embed(texts, { signal }));
    } catch (error) {
      check();
      throw error;
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
   * @param {Candidate[]} candidates @param {FinishResult} result @param {CardVectors | undefined} vectors
   */
  async function write(tx, key, messages, candidates, result, vectors) {
    const { scope, client, sessionId } = key;
    const allowed = await screenReceipts(tx, key, messages);
    if (!allowed.length) return allowed;

    const suppressed = new Set(result.suppressedItems);
    const surviving = candidates.filter((_, index) => !suppressed.has(index));
    if (surviving.length !== result.memories.length) throw new CoreError("internal_error");
    const written = surviving.map(({ item, quantities }, index) => ({
      ...result.memories[index], receipts: item.receipts, quantities,
    }));
    const canonicalSessionKey = cards && sessionKey({ client, sessionId });
    if (cards && canonicalSessionKey) {
      for (const { position } of routeDocumentMessages(allowed).chosen) {
        const message = allowed[position];
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
      /** @type {Map<string, readonly Receipt[]>} */
      const inspected = new Map();
      for (const { id, receipts, quantities } of eligible) {
        const row = byMemory.get(id);
        if (row?.memory?.id !== id || row.memory.historical || !quantities ||
            row.memory.scope.owner !== scope.owner || row.memory.scope.namespace !== scope.namespace) continue;
        const userReceipts = receipts.filter(({ role }) => role === "user");
        if (!userReceipts.length) continue;
        /** @param {Receipt} receipt @param {readonly Receipt[]} retained */
        function canonicalReceipt(receipt, retained) {
          const message = byMessage.get(receipt.messageId);
          const excerpt = message && receiptExcerpt(message.content);
          const ids = new Set(retained.filter(candidate => candidate.id && sameReceipt(candidate, receipt) &&
            (candidate.excerpt === undefined || candidate.excerpt === excerpt)).map(candidate => candidate.id));
          return ids.size === 1 ? [...ids][0] : undefined;
        }
        let retained = row.receipts ?? [];
        if (inspect && userReceipts.some(receipt => canonicalReceipt(receipt, retained) === undefined)) {
          if (!inspected.has(id)) {
            /** @type {Receipt[]} */
            const receipts = [];
            let after, expectedEpoch;
            do {
              const page = await inspect.item(tx, scope, id, { limit: 50, after, expectedEpoch, includeQualification: false });
              receipts.push(...(page.item?.receipts ?? []));
              after = page.nextAnchor ?? undefined;
              expectedEpoch = page.epoch;
            } while (after);
            inspected.set(id, receipts);
          }
          retained = [...retained, ...(inspected.get(id) ?? [])];
        }
        /** @type {LedgerReceipt[]} */
        const citedReceipts = [];
        for (const receipt of userReceipts) {
          const receiptId = canonicalReceipt(receipt, retained);
          if (!receiptId) break;
          const { messageId, role, occurredAtMs } = receipt;
          citedReceipts.push({ receiptId, messageId, role, occurredAtMs, content: byMessage.get(messageId)?.content ?? "" });
        }
        if (citedReceipts.length !== userReceipts.length) continue;
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
        model: {
          countTokens: model.countTokens.bind(model),
          detectChanges: (request, options) => guarded(options?.signal, signal => detectChanges.call(model, request, { signal })),
          verifyChange: (request, options) => guarded(options?.signal, signal => verifyChange.call(model, request, { signal })),
        },
      });
      for (const [reason, count] of Object.entries(counters)) {
        if (count && /(?:failed|timeout|malformed_output|token_count_unavailable)$/u.test(reason)) {
          emitDiagnostic(diagnostics, "amendment", "core_call", reason);
        }
      }
      const hashes = new Map(earlier.map(({ id, contentHash }) => [id, contentHash]));
      const byMessage = new Map(messages.map(message => [message.id, message]));
      for (const { cardId, amendment } of amendments) {
        try {
          await uow.run(owner, { pauseLock: true }, async tx => {
            const state = pauseResult(await pause.get(tx, owner));
            if (state.paused || state.generation !== generation || caller?.aborted) return;
            const message = byMessage.get(amendment.sourceMessage.messageId);
            if (!message || !await sourceStillEligible(tx, message) ||
                (capabilities.rawArchive && await raw?.archiveAllowed(tx, key) !== true) ||
                !(await screenReceipts(tx, key, [message])).length) return;
            const card = await cards.get(tx, scope, cardId);
            if (!card?.sourceMessage || card.contentHash !== hashes.get(cardId) || !await visible(tx, scope, card)) return;
            await cards.amend(tx, scope, cardId, amendment);
          });
        } catch {
          emitDiagnostic(diagnostics, "amendment", "core_finish", "amend_failed");
        }
      }
    } catch {
      emitDiagnostic(diagnostics, "amendment", "core_call", "amendment_failed");
    }
  }

  return { cards, ledger, extractionSpec, validateExtraction, beforeEmbedding, embedCards, write, amend };
}
