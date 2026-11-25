import { documentCardVisible } from "@cairn-ink/core/routing";
import { exactReceiptTurn } from "./context-raw-read.mjs";
import { receiptProjector } from "./inspect.mjs";
import { decodeJson, readEntry, readReceipts } from "./memory-rows.mjs";
import { exactScope } from "./placement-visibility.mjs";
import { importTextBlocked, rawFactPolicy } from "./raw-facts.mjs";
import { hasRawFence } from "./raw-lineage.mjs";
import { decodeRawRow, readRawRow } from "./raw-rows.mjs";
import { receiptAddressDenial } from "./receipt-identity.mjs";
import { scopeKey } from "./storage-values.mjs";
import { readFacts, scopedSuppression } from "./suppressions.mjs";

/** @import { RawSpanFact, StoredFact, TextFact } from "@cairn-ink/core" */
/** @import { DocumentCardAmendment, DocumentCardSourceMessage, ItemRef, RetrievalScope, Scope, StoredDocumentCardRecord, Tx } from "@cairn-ink/core/ports" */
/** @import { DocumentCardMemoryState, DocumentCardVisibilityInput } from "../../core/src/routing/visibility.mjs" */
/** @import { CardWrite } from "./document-card-rows.mjs" */
/** @import { Connection } from "./storage-values.mjs" */
/** @import { SessionHasher } from "./suppressions.mjs" */
/** @import { MigratedRawPolicy } from "./migrate/raw-privacy.mjs" */
/** @import { MigratedCaptureControls } from "./migrate/capture-controls.mjs" */
/** @import { PlacementVisibility } from "./placement-visibility.mjs" */
/** @import { RawRow } from "./raw-rows.mjs" */
/** @import { StoredReceipt } from "./receipt-identity.mjs" */
/** @typedef {ReturnType<typeof import("./receipt-read-safety.mjs").createReceiptReadSafety>} ReceiptReadSafety */

/** @param {DocumentCardSourceMessage} source */
export function cardSourceConflictKey(source) {
  return "card-conflict:" + receiptAddressDenial(source);
}

/** @param {DocumentCardSourceMessage} source */
function cardReceiptWithdrawalKey(source) {
  return "card-receipt-withdrawn:" + receiptAddressDenial(source);
}

/** @param {StoredFact[]} facts @returns {TextFact[]} */
function textFacts(facts) {
  return facts.flatMap(({ fact }) => fact.kind === "text" ? [fact] : []);
}

/** @param {SessionHasher} hashSession @param {ReceiptReadSafety} receiptReadSafety
 * @param {PlacementVisibility} memoryVisibility @param {MigratedRawPolicy} [migratedRaw]
 * @param {MigratedCaptureControls} [controls]
 */
export function createCardVisibility(hashSession, receiptReadSafety, memoryVisibility, migratedRaw, controls) {
  /** @param {Connection} db @param {Scope} scope @param {DocumentCardSourceMessage} source */
  function rawRow(db, scope, source) {
    return readRawRow(db, scope, migratedRaw?.storageSession(db, scope, source) ?? source, source.messageId);
  }

  /** @param {Connection} db @param {Scope} scope */
  function sources(db, scope) {
    const policy = scopedSuppression(db, scope, hashSession);
    const project = receiptProjector(db, scope, policy, receiptReadSafety);
    const visibleMemory = memoryVisibility(db, scope, policy);
    const maxLinks = 1000;
    const receipts = db.prepare(`SELECT i.id, i.excerpt, i.position, CAST(i.created_at_us AS TEXT) AS time,
        r.body, r.legacy_receipt_key, r.memory_id
      FROM cairn_receipts r LEFT JOIN cairn_inspect_receipts i USING (owner_id, namespace_key, memory_id, ordinal)
      WHERE r.owner_id = ? AND r.namespace_key = ? AND r.source_key = ? LIMIT ?`);
    const deleted = db.prepare(`SELECT deleted FROM cairn_memories WHERE ${exactScope} AND id = ?`);
    /** @type {Map<string, boolean | null>} */
    const verdicts = new Map();

    /** @param {DocumentCardSourceMessage} source @param {RawRow | undefined} row */
    function compute(source, row) {
      const sessionHash = hashSession(scope, source.client, source.sessionId);
      if (policy.legacy.has(cardSourceConflictKey(source)) || (row && policy.legacy.has(cardSourceConflictKey({
        client: row.client, sessionId: row.sessionId, messageId: source.messageId,
      }))) || hasRawFence(db, scope, sessionHash) ||
          controls?.rawReadable(scope) === false ||
          migratedRaw?.blocksSpan(db, scope, source, source.messageId) ||
          migratedRaw?.reservesMessage(db, scope, source, source.messageId)) return true;
      const address = { ...source, role: row?.message.role ?? /** @type {const} */ ("user"),
        occurredAtMs: row?.message.occurredAtMs ?? null };
      if (!receiptReadSafety(db, scope, policy, address, undefined, undefined)) return true;
      const withdrawn = policy.legacy.has(cardReceiptWithdrawalKey(source));
      if (!row) return withdrawn ? true : null;
      const sourceKey = JSON.stringify([source.client, source.sessionId, source.messageId]);
      let count = 0;
      for (const record of receipts.iterate(...scopeKey(scope), sourceKey, maxLinks + 1)) {
        if (++count > maxLinks) return true;
        const memoryId = String(record.memory_id), current = visibleMemory(memoryId);
        if (!current || current.historical) return true;
        let receipt;
        if (record.excerpt == null) {
          // Capture retains the address without copying an excerpt. Prove the
          // address and the exact admitted turn before using that lineage.
          const stored = /** @type {StoredReceipt} */ (decodeJson(record.body));
          const legacy = typeof record.legacy_receipt_key === "string" ? record.legacy_receipt_key : undefined;
          if (!receiptReadSafety(db, scope, policy, stored, stored.receiptKey ?? legacy, legacy,
            stored.legacyRawAncestryEmpty)) return true;
          receipt = stored;
        } else {
          receipt = project(record)?.receipt;
        }
        if (!receipt || receipt.client !== source.client || receipt.sessionId !== source.sessionId ||
            receipt.messageId !== source.messageId || !exactReceiptTurn(db, scope, memoryId, receipt, row)) return true;
      }
      return count === 0 && withdrawn;
    }

    /** @param {DocumentCardSourceMessage} source */
    function withheld(source) {
      const key = JSON.stringify([source.client, source.sessionId, source.messageId]);
      if (!verdicts.has(key)) verdicts.set(key, compute(source, rawRow(db, scope, source)));
      return verdicts.get(key) ?? null;
    }

    /** @param {string} id @returns {DocumentCardMemoryState} */
    function memoryState(id) {
      const entry = readEntry(db, scope, id);
      const revision = entry?.row.revision;
      if (deleted.get(...scopeKey(scope), id)?.deleted === 1 || policy.facts.some(({ fact }) =>
        fact.kind === "identity" && fact.memoryId === id &&
        (fact.throughRevision == null || (revision !== undefined && revision <= fact.throughRevision)))) {
        return { status: "forgotten" };
      }
      if (!entry) return { status: "unknown" };
      const row = visibleMemory(id);
      if (!row) return { status: "suppressed" };
      return row.historical ? { status: "historical", revision: row.revision }
        : { status: "visible", revision: row.revision, content: row.text, date: row.createdAtMs };
    }

    return { policy, memoryState, withheld };
  }

  /** @param {Scope} scope @param {CardWrite} card @param {DocumentCardVisibilityInput["memoryStates"]} memoryStates
   * @param {TextFact[]} facts @param {boolean | null} sourceWithheld @returns {DocumentCardVisibilityInput} */
  function input(scope, { id, origin, sourceMessage, title, body, sourceMemories }, memoryStates, facts, sourceWithheld) {
    const canonicalSessionKey = sourceMessage ? hashSession(scope, sourceMessage.client, sourceMessage.sessionId) : null;
    return { card: { id, scope, origin, sourceMessage, title, body, sourceMemories, canonicalSessionKey },
      requestedScope: scope, memoryStates, sourceWithheld, textFacts: facts, fingerprintKey: null };
  }

  return {
    fileable: fileableCard,
    /** @param {Connection} db @param {Scope} scope */
    inputReader(db, scope) {
      const { policy, withheld, memoryState } = sources(db, scope);
      const facts = textFacts(policy.facts);
      /** @param {CardWrite} card */
      return card => {
        const bindings = card.sourceMessage ? [card.sourceMessage, ...card.sentences.map(sentence => sentence.source)]
          : card.sentences.map(sentence => sentence.source);
        const raw = bindings.map(withheld);
        const matchesText = [card.title, card.body].some(text =>
          importTextBlocked(card.sourceMessage ? policy.facts : [], text, policy.legacy));
        if (!card.sourceMessage && (matchesText || raw.some(verdict => verdict !== false))) return null;
        const sourceWithheld = raw.includes(true) || matchesText;
        if (!sourceWithheld && raw.includes(null)) return null;
        const memoryStates = new Map(card.sourceMemories.map(({ id }) => [id, memoryState(id)]));
        return input(scope, card, memoryStates, facts, sourceWithheld);
      };
    },

    /** @param {Connection} db @param {Scope} scope */
    storedReader(db, scope) {
      const { policy, withheld, memoryState } = sources(db, scope);
      return {
        /** @param {CardWrite} card */
        card(card) {
          const bindings = card.sentences.map(sentence => sentence.source);
          if (card.sourceMessage) bindings.unshift(card.sourceMessage);
          return !bindings.some(source => withheld(source) === true) &&
            ![card.title, card.body].some(text => importTextBlocked(policy.facts, text, policy.legacy)) &&
            !card.sourceMemories.some(({ id, revision }) => {
              const state = memoryState(id);
              return state.status === "suppressed" || state.status === "forgotten" ||
                (card.sourceMessage === null && (state.status === "historical" ||
                  (state.status === "visible" && state.revision !== revision)));
            });
        },

        // Draft amendments can precede the archive. Presentation further requires
        // a qualified whole user turn and an exact quote in the Context Read layer.
        /** @param {DocumentCardAmendment} amendment */
        amendment(amendment) {
          return withheld(amendment.sourceMessage) !== true;
        },
      };
    },

    /** @param {Connection} db @param {Scope} scope @param {string} id */
    recordReceiptWithdrawals(db, scope, id) {
      const keep = db.prepare("INSERT INTO cairn_legacy_denials VALUES (?, ?, ?) ON CONFLICT DO NOTHING");
      for (const receipt of readReceipts(db, scope, id)) {
        const row = rawRow(db, scope, receipt);
        // Remember the qualifying address before its receipt is removed.
        if (row && exactReceiptTurn(db, scope, id, receipt, row)) {
          keep.run(...scopeKey(scope), cardReceiptWithdrawalKey(receipt));
        }
      }
    },

    /** @param {Connection} db @param {Scope} scope @param {StoredFact<RawSpanFact>} stored */
    *forgottenSpanSources(db, scope, stored) {
      const rows = db.prepare(`SELECT * FROM cairn_raw_messages WHERE ${exactScope} AND message_key = ?`)
        .iterate(...scopeKey(scope), JSON.stringify(stored.fact.messageKey));
      for (const row of rows) {
        const { client, sessionId, message } = decodeRawRow(row);
        const source = { client, sessionId, messageId: message.id };
        if (rawFactPolicy(scope, source, [stored], hashSession).purges(message)) yield source;
      }
    },

    /** @param {Connection} db @param {Scope} scope @param {string} id */
    erasedMemoryText(db, scope, id) {
      const facts = readFacts(db, scope).filter(({ fact }) =>
        fact.kind === "text" && fact.origin === "forget" && fact.sourceMemory?.id === id);
      if (!facts.length) return undefined;
      const policy = rawFactPolicy(scope, { client: "", sessionId: "" }, facts, hashSession);
      return (/** @type {string} */ content) => policy.purges({ id: "", role: "user", occurredAtMs: null, content });
    },

    /** @param {Connection} db @param {Scope} scope @param {ReadonlySet<string>} factIds */
    forPurge(db, scope, factIds) {
      const policy = scopedSuppression(db, scope, hashSession, factIds);
      const facts = textFacts(policy.facts);

      /** @param {DocumentCardSourceMessage} source */
      function sourceWithheld(source) {
        const row = rawRow(db, scope, source);
        if (!row) return null;
        return rawFactPolicy(scope, source, policy.facts, hashSession).purges(row.message);
      }

      /** @param {string} id @returns {DocumentCardMemoryState} */
      function memoryState(id) {
        const entry = readEntry(db, scope, id);
        if (policy.facts.some(({ fact }) => fact.kind === "identity" && fact.memoryId === id &&
          (fact.throughRevision == null || (entry && entry.row.revision <= fact.throughRevision)))) return { status: "forgotten" };
        if (!entry) return { status: "unknown" };
        if (policy.definitelyHides(entry)) return { status: "suppressed" };
        if (policy.hides(entry)) return { status: "unknown" };
        return { status: entry.row.historical ? "historical" : "visible", revision: entry.row.revision };
      }

      return {
        sourceWithheld,
        /** @param {CardWrite} card */
        input(card) {
          const memoryStates = new Map(card.sourceMemories.map(({ id }) => [id, memoryState(id)]));
          const bindings = card.sentences.map(sentence => sentence.source);
          if (card.sourceMessage) bindings.unshift(card.sourceMessage);
          const verdicts = bindings.map(sourceWithheld);
          const match = card.sourceMessage && [card.title, card.body].some(content =>
            rawFactPolicy(scope, card.sourceMessage, policy.facts.filter(({ fact }) => fact.kind === "text"), hashSession)
              .purges({ id: card.sourceMessage.messageId, content, occurredAtMs: card.date, role: "user" }));
          return input(scope, card, memoryStates, facts, match || verdicts.includes(true) ? true
            : verdicts.includes(null) ? null : false);
        },
      };
    },
  };
}

/** @param {NonNullable<import("@cairn-ink/core/ports").DocumentCardStore<StoredDocumentCardRecord>["visibilityInputs"]>} load
 * @param {Tx} tx @param {RetrievalScope} selection @param {readonly ItemRef[]} refs */
export async function visibleCardRefs(load, tx, selection, refs) {
  /** @type {ItemRef[]} */
  const visible = [];
  for (const namespace of selection.namespaces) {
    if (namespace === "") continue;
    const selected = refs.filter(ref => ref.type === "card" && ref.namespace === namespace);
    if (!selected.length) continue;
    const inputs = await load(tx, { owner: selection.owner, namespace }, selected);
    for (const [i, evidence] of inputs.entries()) {
      if (evidence && (!selection.clients || (evidence.card.sourceMessage && selection.clients.includes(evidence.card.sourceMessage.client))) &&
          (await documentCardVisible(evidence)).visible) visible.push(selected[i]);
    }
  }
  return visible;
}

/** @param {DocumentCardVisibilityInput | null} input @param {CardWrite} card */
async function fileableCard(input, card) {
  return input !== null && card.stale.length === 0 && card.sourceMemories.every(({ id, revision }) => {
    const memory = input.memoryStates.get(id);
    return memory?.status === "visible" && memory.revision === revision;
  }) && (await documentCardVisible(input)).visible;
}
