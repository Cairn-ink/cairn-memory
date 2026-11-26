import { rankScores, scoreBM25, termFrequencies, tokenizeT1 } from "@cairn-ink/core";
import { currentMemoryReceipts } from "./context-read.mjs";
import { receiptAddressKey } from "./receipt-read-safety.mjs";

/** @import { ContextEvidenceRow, ContextMemoryRef, ContextRawReadStore, ContextRawTurn, ContextReadSet, ContextReadStore,
 * DocumentCardSourceMessage, Receipt, Scope } from "@cairn-ink/core/ports" */
/** @import { RawEntry } from "./raw.mjs" */
/** @import { StoredReceipt } from "./receipt-read-safety.mjs" */
/** @import { State } from "./unit-of-work.mjs" */
/** @typedef {Extract<ContextEvidenceRow, { type: "memory" }>["receipts"][number]} QualifiedReceipt */
/** @typedef {ReturnType<typeof import("./raw.mjs").createRawPorts>} Archive */

const MAX_INVENTORY = 4096;
const MAX_RECEIPT_SCAN = 16_384;
const MAX_TEXT_UNITS = 4 * 1024 * 1024;
const encoder = new TextEncoder();

/** @param {RawEntry} row */
const conversation = ({ client, sessionId }) => JSON.stringify([client, sessionId]);

/** @param {Scope} scope @param {RawEntry} row @returns {Promise<ContextRawTurn>} */
async function rawTurn(scope, row) {
  const { role, messageId, occurredAtMs, content } = row;
  const turn = { scope, conversationId: conversation(row), messageId, role, occurredAtMs,
    ranges: [{ start: 0, text: content }] };
  const value = await crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify(turn)));
  const witness = Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, "0")).join("");
  return { ...turn, witness };
}

/** @param {Scope} scope @param {Pick<Receipt, "client" | "sessionId" | "messageId">} source */
const sourceSlot = ({ namespace }, { client, sessionId, messageId }) => JSON.stringify([namespace, client, sessionId, messageId]);

/** @param {State} state @param {ContextMemoryRef} ref @param {StoredReceipt} receipt @param {RawEntry} raw */
function exactLineage(state, { scope, id }, receipt, raw) {
  if (!receipt.captureEventId) return false;
  const claim = state.claims.get(JSON.stringify([receipt.client, receipt.captureEventId]));
  if (claim?.status !== "finished" || claim.key.scope.namespace !== scope.namespace ||
      claim.key.sessionId !== receipt.sessionId || !claim.result.memories.some(memory => memory.id === id)) return false;
  const admitted = claim.messages?.find(message => message.id === receipt.messageId);
  return Boolean(admitted?.content && admitted.content === raw.content && admitted.role === raw.role && raw.role === receipt.role);
}

/** @param {State} state @param {Pick<ContextReadSet, "owner" | "namespaces">} readSet
 * @param {Set<string> | undefined} candidates @param {() => boolean} expired */
function receiptLinks(state, readSet, candidates, expired) {
  /** @type {Map<string, { ref: ContextMemoryRef, receipt: StoredReceipt }[]>} */
  const links = new Map();
  let scanned = 0;
  for (const namespace of readSet.namespaces) {
    const scope = { owner: readSet.owner, namespace };
    for (const { row, receipts } of state.rows.get(namespace)?.values() ?? []) {
      scanned += 1 + receipts.length;
      if (scanned > MAX_RECEIPT_SCAN || expired()) return null;
      for (const receipt of receipts) {
        const slot = sourceSlot(scope, receipt);
        if (candidates && !candidates.has(slot)) continue;
        const matches = links.get(slot) ?? [];
        matches.push({ ref: { type: "memory", scope, id: row.id, revision: row.revision }, receipt });
        links.set(slot, matches);
      }
    }
  }
  return links;
}

/** @param {State} state @param {NonNullable<ReturnType<typeof receiptLinks>>} links
 * @param {Archive["sourceLineageVisible"]} sourceLineageVisible
 * @param {(ref: ContextMemoryRef) => Promise<readonly QualifiedReceipt[]>} readQualified
 * @param {(ref: ContextMemoryRef, receipt: StoredReceipt) => boolean} [retainsAddress] */
function checkLineage(state, links, sourceLineageVisible, readQualified, retainsAddress) {
  /** @type {Map<string, readonly QualifiedReceipt[]>} */
  const qualified = new Map();
  /** @param {Scope} scope @param {RawEntry} row */
  return async (scope, row) => {
    if (!row.content ||
        (state.receiptDenials.size && state.receiptDenials.has(await receiptAddressKey(scope.namespace, row))) ||
        !await sourceLineageVisible(state, scope, row)) return false;
    // A possible receipt link must still point to a qualified current Memory.
    // Missing ancestry is a denial.
    for (const { ref, receipt } of links.get(sourceSlot(scope, row)) ?? []) {
      if (!receipt.id) {
        if (!retainsAddress || !exactLineage(state, ref, receipt, row) || !retainsAddress(ref, receipt)) return false;
        continue;
      }
      if (!exactLineage(state, ref, receipt, row)) return false;
      const key = JSON.stringify([ref.scope.namespace, ref.id]);
      let receipts = qualified.get(key);
      if (!receipts) {
        receipts = await readQualified(ref);
        qualified.set(key, receipts);
      }
      if (!receipts.some(source => source.id === receipt.id)) return false;
    }
    return true;
  };
}

/** @param {Archive} archive
 * @param {ReturnType<typeof import("./fact-match.mjs").createFactMatcher>} matchFacts
 * @param {Parameters<typeof currentMemoryReceipts>[3]} receiptReadSafety */
export function createCardRawSourceChecks({ findVisibleSource, sourceLineageVisible }, matchFacts, receiptReadSafety) {
  /** @param {State} state @param {Scope} scope @param {RawEntry} row */
  async function lineageVisible(state, scope, row) {
    const links = receiptLinks(state, { owner: scope.owner, namespaces: [scope.namespace] },
      new Set([sourceSlot(scope, row)]), () => false);
    if (!links) return false;
    const policy = matchFacts(state.facts, scope);
    const current = checkLineage(state, links, sourceLineageVisible,
      ref => currentMemoryReceipts(state, ref, policy, receiptReadSafety),
      ({ id, revision }, receipt) => {
        const entry = state.rows.get(scope.namespace)?.get(id);
        return entry?.row.revision === revision && !entry.row.historical && !policy.hides(entry) &&
          entry.receipts.some(source => source.client === receipt.client && source.sessionId === receipt.sessionId &&
            source.messageId === receipt.messageId && source.captureEventId === receipt.captureEventId);
      });
    return current(scope, row);
  }

  /** @param {State} state @param {Scope} scope @param {DocumentCardSourceMessage} source */
  async function sourceVisible(state, scope, source) {
    const row = await findVisibleSource(state, scope, source);
    // A conflicting replay invalidates whole-message evidence for cards.
    return !!row && !state.rawConflicts.has(row.ref.id) && await lineageVisible(state, scope, row);
  }
  return { sourceVisible, lineageVisible };
}

/** @param {ReturnType<typeof import("./unit-of-work.mjs").createUnitOfWork>} work
 * @param {Archive} archive @param {ContextReadStore} store
 * @param {Parameters<typeof createCardRawSourceChecks>[1]} matchFacts
 * @param {Parameters<typeof createCardRawSourceChecks>[2]} receiptReadSafety
 * @param {{ raw: boolean, amendmentLineage?: ReturnType<typeof createCardRawSourceChecks>["lineageVisible"] }} options
 * @returns {ContextReadStore} */
export function withContextRawRead({ port }, { findVisibleSource, sourceLineageVisible, amendmentSource }, store, matchFacts, receiptReadSafety,
  { raw: rawEnabled, amendmentLineage }) {
  /** @type {ContextReadStore} */
  const context = amendmentLineage ? {
    ...store,
    async documentCardAmendmentSource(tx, readSet, scope, { sourceMessage, quote }) {
      if (scope.owner !== readSet.owner || !readSet.namespaces.includes(scope.namespace)) return null;
      return port(tx, scope, false, state => amendmentSource(state, scope, sourceMessage, quote,
        row => amendmentLineage(state, scope, row)));
    },
  } : store;
  if (!rawEnabled) return context;

  /** @param {State} state @param {NonNullable<ReturnType<typeof receiptLinks>>} links */
  function currentLineage(state, links) {
    return checkLineage(state, links, sourceLineageVisible, ref =>
      currentMemoryReceipts(state, ref, matchFacts(state.facts, ref.scope), receiptReadSafety));
  }
  /** @type {ContextRawReadStore} */
  const raw = {
    async search(tx, readSet, query, { limit, deadlineAtMs, signal }) {
      return port(tx, readSet, false, async state => {
        const expired = () => signal?.aborted || performance.now() >= (deadlineAtMs ?? Infinity);
        /** @type {ReturnType<ContextRawReadStore["search"]> extends Promise<infer T> ? T : never} */
        const partial = { turns: [], coverage: "partial" };
        /** @type {ReturnType<typeof currentLineage> | undefined} */
        let current;
        const documents = [];
        const df = new Map(), terms = tokenizeT1(query);
        let textUnits = 0, complete = true, totalLength = 0;
        for (const row of state.rawRows.values()) {
          if (expired()) return partial;
          if (!readSet.namespaces.includes(row.ref.namespace)) continue;
          const scope = { owner: readSet.owner, namespace: row.ref.namespace };
          const visible = await findVisibleSource(state, scope, row);
          if (!visible) continue;
          if (!current) {
            const links = receiptLinks(state, readSet, undefined, expired);
            if (!links) return partial;
            current = currentLineage(state, links);
          }
          if (!await current(scope, visible)) continue;
          textUnits += visible.content.length;
          if (documents.length >= MAX_INVENTORY || textUnits > MAX_TEXT_UNITS) {
            complete = false;
            break;
          }
          const tokens = termFrequencies(visible.content);
          totalLength += tokens.length;
          for (const term of tokens.frequencies.keys()) df.set(term, (df.get(term) ?? 0) + 1);
          documents.push({ ref: row.ref, row: visible, scope, tokens });
        }
        const ranked = [];
        for (const doc of documents) {
          if (expired()) return partial;
          const score = scoreBM25(terms, doc.tokens, { N: documents.length, totalLength, df });
          if (score !== null) ranked.push({ ...doc, score });
        }
        const rows = rankScores(ranked).slice(0, limit), matched = ranked.length;
        /** @type {ContextRawTurn[]} */
        const turns = [];
        for (const { row, scope } of rows) {
          if (expired()) break;
          turns.push(await rawTurn(scope, row));
        }
        return { turns, coverage: complete && turns.length === matched && !expired() ? "included" : "partial" };
      });
    },
    async revalidate(tx, readSet, turns) {
      return port(tx, readSet, false, async state => {
        const requested = [];
        for (const turn of turns) {
          if (turn.scope.owner !== readSet.owner || !readSet.namespaces.includes(turn.scope.namespace)) return false;
          const session = JSON.parse(turn.conversationId);
          if (!Array.isArray(session) || session.length !== 2 || !session.every(value => typeof value === "string")) return false;
          const [client, sessionId] = session;
          const source = { client, sessionId, messageId: turn.messageId };
          requested.push({ turn, source, slot: sourceSlot(turn.scope, source) });
        }
        const links = receiptLinks(state, readSet, new Set(requested.map(({ slot }) => slot)), () => false);
        if (!links) return false;
        const current = currentLineage(state, links);
        for (const { turn, source } of requested) {
          const row = await findVisibleSource(state, turn.scope, source);
          if (!row || !await current(turn.scope, row) ||
              JSON.stringify(await rawTurn(turn.scope, row)) !== JSON.stringify(turn)) return false;
        }
        return true;
      });
    },
  };
  return {
    ...context, raw,
    async evidence(tx, readSet, refs, intent) {
      const rows = await store.evidence(tx, readSet, refs, intent);
      return port(tx, readSet, false, state => Promise.all(rows.map(async row => {
        if (row?.type !== "memory" || row.sourceAccess !== "available") return row;
        const { scope, id } = row.ref;
        const stored = state.rows.get(scope.namespace)?.get(id)?.receipts;
        const receipts = await Promise.all(row.receipts.map(async receipt => {
          // Only enrich a receipt already qualified by the evidence store.
          const slot = sourceSlot(scope, receipt);
          const source = stored?.find(source => source.id === receipt.id && sourceSlot(scope, source) === slot);
          if (!source?.captureEventId) return receipt;
          const visible = await findVisibleSource(state, scope, receipt);
          if (!visible || !exactLineage(state, row.ref, source, visible)) return receipt;
          return { ...receipt, rawTurns: [{ scope, conversationId: conversation(visible), messageId: visible.messageId }],
            ...(visible.occurredAtMs !== null && { sourceTimesMs: [visible.occurredAtMs] }) };
        }));
        return { ...row, receipts };
      })));
    },
  };
}
