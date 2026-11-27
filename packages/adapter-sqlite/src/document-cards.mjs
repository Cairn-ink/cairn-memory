import { advanceCardGeneration, cardColumns, cardWhere, copyCardSource, decodeCard, decodeCardAmendment,
  readCardAmendments, readCardLinks, readCardRow, readCardSource, sourceKeys, unionCardLinks,
  writeCardLinks } from "./document-card-rows.mjs";
import { decodeJson, readEntry } from "./memory-rows.mjs";
import { opaqueSessionHash } from "./migrate/raw-privacy.mjs";
import { exactScope, placementPort } from "./placement-visibility.mjs";
import { copySession } from "./raw-rows.mjs";
import { invalidInput, scopeKey, validateId, writeTime } from "./storage-values.mjs";
import { memoryCorrectionEvidence, readFacts } from "./suppressions.mjs";

/** @import { DocumentCardHideSelector, DocumentCardSourceMessage, DocumentCardStore, Scope, StoredDocumentCardRecord, Tx } from "@cairn-ink/core/ports" */
/** @import { CardWrite } from "./document-card-rows.mjs" */
/** @import { Connection, Port } from "./storage-values.mjs" */
/** @typedef {ReturnType<typeof import("./document-card-visibility.mjs").createCardVisibility>} Visibility */
/** @typedef {ReturnType<typeof import("./index-revisions.mjs").createIndexRevisions>} Index */
/** @typedef {{ cards: Set<string>, amendments: Map<string, Set<string>> }} Selection */

const write = { write: true };

/** @param {Connection} db @param {Scope} scope @param {CardWrite["sourceMemories"]} links */
function rejectFutureLinks(db, scope, links) {
  for (const { id, revision } of links) {
    const row = readEntry(db, scope, id)?.row;
    if (row && revision > row.revision) invalidInput();
  }
}

/** @param {Connection} db @param {Scope} scope @param {CardWrite["sourceMemories"]} previous
 * @param {CardWrite["sourceMemories"]} incoming @param {boolean} bodyChanged @param {boolean} union */
function updateLinks(db, scope, previous, incoming, bodyChanged, union) {
  if (!previous.length || (bodyChanged && !union)) return incoming;
  const facts = readFacts(db, scope);
  const pinned = new Set();
  const retained = previous.filter(link => {
    const { correctedRevisions, unresolvedCorrection } = memoryCorrectionEvidence(facts, readEntry(db, scope, link.id), link);
    const corrected = unresolvedCorrection || correctedRevisions.includes(link.revision);
    if (corrected && !bodyChanged) {
      pinned.add(link.id);
      return true;
    }
    return union && !corrected;
  });
  return unionCardLinks(incoming.filter(link => !pinned.has(link.id)), retained);
}

/** @param {unknown} input */
function requireText(input) {
  if (typeof input !== "string" || !input || /[\u0000\uD800-\uDFFF]/u.test(input)) invalidInput();
}

/** @returns {Selection} */
function cardSelection() {
  return { cards: new Set(), amendments: new Map() };
}

/** @param {Selection} selection @param {string} id @param {string} amendmentId */
function addAmendment({ amendments }, id, amendmentId) {
  if (!amendments.has(id)) amendments.set(id, new Set());
  amendments.get(id)?.add(amendmentId);
}

/** @param {Connection} db @param {Scope} scope @param {ReturnType<typeof copySession>} source
 * @param {Selection} selected @param {string} [messageId]
 * @param {import("./suppressions.mjs").SessionHasher} [hashSession] */
function selectAddress(db, scope, source, selected, messageId, hashSession) {
  const alias = hashSession && opaqueSessionHash(source.sessionId);
  const exact = messageId === undefined ? "" : " AND message_key = ?";
  const where = exactScope + " AND client_key = ?" + (alias ? "" : " AND session_key = ?") + exact;
  const keys = [...scopeKey(scope), JSON.stringify(source.client), ...(alias ? [] : [JSON.stringify(source.sessionId)]),
    ...(messageId === undefined ? [] : [JSON.stringify(messageId)])];
  const matches = (/** @type {import("node:sqlite").SQLOutputValue} */ sessionKey) =>
    !alias || hashSession?.(scope, source.client, decodeJson(sessionKey)) === alias;
  for (const { card_id, session_key } of db.prepare(`SELECT DISTINCT card_id, session_key
    FROM cairn_document_card_sources WHERE ${where}`).all(...keys)) {
    if (matches(session_key)) selected.cards.add(String(card_id));
  }
  for (const { card_id, amendment_id, session_key } of db.prepare(`SELECT card_id, amendment_id, session_key FROM cairn_document_card_amendments
    WHERE ${where} AND state != 'purged'`).all(...keys)) {
    if (matches(session_key)) addAmendment(selected, String(card_id), String(amendment_id));
  }
}

/** @param {Connection} db @param {Scope} scope @param {DocumentCardHideSelector} selector @param {Selection} selected */
function selectWhere(db, scope, { sourceMemoryId, sourceMessage, session }, selected) {
  if ([sourceMemoryId, sourceMessage, session].filter(value => value !== undefined).length !== 1) invalidInput();
  if (sourceMemoryId !== undefined) {
    validateId(sourceMemoryId);
    for (const { card_id } of db.prepare(`SELECT card_id FROM cairn_document_card_memories
      WHERE ${exactScope} AND memory_id = ?`).all(...scopeKey(scope), sourceMemoryId)) selected.cards.add(String(card_id));
  } else if (sourceMessage !== undefined) {
    const source = copyCardSource(sourceMessage);
    selectAddress(db, scope, source, selected, source.messageId);
  } else {
    selectAddress(db, scope, copySession(/** @type {NonNullable<typeof session>} */ (session)), selected);
  }
}

/** @param {Connection} db @param {Scope} scope @param {string} id */
function changeRevision(db, scope, id) {
  db.prepare(`UPDATE cairn_document_cards SET revision = revision + 1 WHERE ${exactScope} AND id = ?`)
    .run(...scopeKey(scope), id);
}

/** @param {Connection} db @param {Scope} scope @param {Pick<CardWrite, "id" | "sourceMessage" | "sentences">} card */
function replaceSources(db, scope, { id, sourceMessage, sentences }) {
  const keys = [...scopeKey(scope), id];
  db.prepare(`DELETE FROM cairn_document_card_sources WHERE ${cardWhere}`).run(...keys);
  const add = db.prepare("INSERT INTO cairn_document_card_sources VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  if (sourceMessage) add.run(...keys, 0, ...sourceKeys(sourceMessage), null, null);
  for (const [i, { start, end, source }] of sentences.entries()) {
    add.run(...keys, i + 1, ...sourceKeys(source), start, end);
  }
}

/** @param {Connection} db @param {Scope} scope @param {Selection} selected @param {string} reason
 * @param {boolean} erase @param {(db: Connection, scope: Scope, id: string) => unknown} [dropPlacement]
 */
function hideSelection(db, scope, selected, reason, erase, dropPlacement) {
  requireText(reason);
  const keys = scopeKey(scope);
  const ids = new Set([...selected.cards, ...selected.amendments.keys()]);
  const card = db.prepare(`UPDATE cairn_document_cards SET state = ?, hidden_reason = ?, revision = revision + 1
    ${erase ? ", title = NULL, body = NULL, content_hash = NULL, stale = NULL" : ""}
    WHERE ${exactScope} AND id = ? AND state ${erase ? "!= 'purged'" : "= 'active'"}`);
  const amendment = db.prepare(`UPDATE cairn_document_card_amendments SET state = ?, hidden_reason = ?
    ${erase ? ", sentence = NULL, quote = NULL" : ""}
    WHERE ${cardWhere} AND state ${erase ? "!= 'purged'" : "= 'active'"} AND amendment_id = ?`);
  const state = erase ? "purged" : "hidden";
  let hidden = 0, changed = false;
  for (const id of ids) {
    const parent = readCardRow(db, scope, id);
    if (!parent || parent.state === "purged" || (!erase && parent.state !== "active")) continue;
    const cardSelected = selected.cards.has(id);
    if (cardSelected) {
      card.run(state, reason, ...keys, id);
      if (parent.state === "active") hidden++;
      dropPlacement?.(db, scope, id);
      if (erase) {
        db.prepare(`DELETE FROM cairn_document_card_sources WHERE ${cardWhere}`).run(...keys, id);
        db.prepare(`DELETE FROM cairn_document_card_memories WHERE ${cardWhere}`).run(...keys, id);
      }
      changed = true;
    }
    let amendmentChanged = false;
    for (const row of readCardAmendments(db, scope, id, erase)) {
      const amendmentId = String(row.amendment_id);
      if (!cardSelected && !selected.amendments.get(id)?.has(amendmentId)) continue;
      amendment.run(state, reason, ...keys, id, amendmentId);
      if (parent.state === "active" && row.state === "active") hidden++;
      amendmentChanged = true;
    }
    if (amendmentChanged && !cardSelected) {
      changeRevision(db, scope, id);
      changed = true;
    }
  }
  return { hidden, changed };
}

/** @param {Port} port @param {Index} index @param {Visibility} visibility @param {() => number} now
 * @param {(db: Connection, scope: Scope, id: string) => unknown} dropPlacement
 * @param {import("./suppressions.mjs").SessionHasher} [legacyHashSession]
 */
export function createDocumentCards(port, index, visibility, now, dropPlacement, legacyHashSession) {
  const access = placementPort(port);

  /** @param {Connection} db @param {Tx} tx @param {Scope} scope */
  function changed(db, tx, scope) {
    advanceCardGeneration(db, scope);
    index.advanceDerived(db, tx);
  }

  /** @param {Connection} db @param {Scope} scope @param {NonNullable<ReturnType<typeof readCardRow>>} row
   * @param {ReturnType<Visibility["storedReader"]>} readable */
  function record(db, scope, row, readable) {
    const card = decodeCard(db, scope, row);
    if (!readable.card(card)) return null;
    return { ...card, amendments: readCardAmendments(db, scope, card.id)
      .map(decodeCardAmendment).filter(readable.amendment) };
  }

  /** @param {Connection} db @param {Tx} tx @param {Scope} scope @param {Selection} selection
   * @param {string} reason @param {boolean} erase */
  function hide(db, tx, scope, selection, reason, erase) {
    const result = hideSelection(db, scope, selection, reason, erase, dropPlacement);
    if (result.changed) changed(db, tx, scope);
    return { hidden: result.hidden };
  }

  /** @type {DocumentCardStore<StoredDocumentCardRecord>} */
  const store = {
    put(tx, callerScope, input) {
      return access(tx, callerScope, write, (db, scope) => {
        const { id, title, body, contentHash, date, sourceMessage, origin, sentences, stale } = input;
        validateId(id);
        requireText(contentHash);
        if (input.scope?.owner !== scope.owner || input.scope?.namespace !== scope.namespace ||
            typeof title !== "string" || typeof body !== "string" || (date !== null && !Number.isSafeInteger(date)) ||
            (origin !== undefined && origin !== "router" && origin !== "manual" && origin !== "import") ||
            !Array.isArray(sentences) || !Array.isArray(stale)) invalidInput();
        const existing = readCardRow(db, scope, id);
        if (existing && existing.state !== "active") return { status: "tombstoned" };
        const incoming = unionCardLinks(input.sourceMemories);
        rejectFutureLinks(db, scope, incoming);
        if (existing?.content_hash === contentHash) return { status: "unchanged" };
        const source = sourceMessage === null ? null : copyCardSource(sourceMessage);
        const oldOrigin = existing ? existing.origin : origin ?? null;
        if ((source === null) !== (oldOrigin === "import" || oldOrigin === "manual")) invalidInput();
        const bound = sentences.map(({ start, end, source }) => {
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > body.length) invalidInput();
          return { start, end, source: copyCardSource(source) };
        });
        const history = stale.map(({ memoryId, replacementMemoryId }) => {
          validateId(memoryId);
          validateId(replacementMemoryId);
          return { memoryId, replacementMemoryId };
        });
        const links = existing ? updateLinks(db, scope, readCardLinks(db, scope, id), incoming,
          existing.body !== body, source !== null) : incoming;
        const time = writeTime(now());
        db.prepare(`INSERT INTO cairn_document_cards VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, 'active', NULL)
          ON CONFLICT (owner_id, namespace_key, id) DO UPDATE SET
          title = excluded.title, body = excluded.body, content_hash = excluded.content_hash, source_at_ms = excluded.source_at_ms,
          updated_at_us = excluded.updated_at_us, stale = excluded.stale, revision = revision + 1,
          body_revision = body_revision + (title != excluded.title OR body != excluded.body)`)
          .run(...scopeKey(scope), id, oldOrigin ?? null, title, body, contentHash, date,
            time.updatedAtMs, time.updatedAtUs, JSON.stringify(history));
        replaceSources(db, scope, { id, sourceMessage: source, sentences: bound });
        writeCardLinks(db, scope, id, links);
        if (existing) dropPlacement?.(db, scope, id);
        changed(db, tx, scope);
        return { status: existing ? "replaced" : "inserted" };
      });
    },

    linkMemories(tx, callerScope, id, links) {
      return access(tx, callerScope, write, (db, scope) => {
        validateId(id);
        const incoming = unionCardLinks(links);
        const row = readCardRow(db, scope, id);
        if (!row) return { status: "not_found" };
        if (row.state !== "active") return { status: "tombstoned" };
        rejectFutureLinks(db, scope, incoming);
        const previous = readCardLinks(db, scope, id);
        const next = updateLinks(db, scope, previous, incoming, false, true);
        if (next.length === previous.length && next.every(({ id, revision }, i) =>
          id === previous[i].id && revision === previous[i].revision)) {
          return { status: "unchanged" };
        }
        writeCardLinks(db, scope, id, next);
        changeRevision(db, scope, id);
        changed(db, tx, scope);
        return { status: "linked" };
      });
    },

    amend(tx, callerScope, id, { amendmentId, date, sourceMessage, sentence, quote }) {
      return access(tx, callerScope, write, (db, scope) => {
        validateId(id);
        requireText(amendmentId);
        if (readCardRow(db, scope, id)?.state !== "active") return { status: "hidden_card" };
        const keys = [...scopeKey(scope), id];
        if (db.prepare(`SELECT 1 FROM cairn_document_card_amendments WHERE ${cardWhere} AND amendment_id = ?`)
          .get(...keys, amendmentId)) return { status: "unchanged" };
        const source = copyCardSource(sourceMessage);
        if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(date) ||
            typeof sentence !== "string" || typeof quote !== "string") invalidInput();
        db.prepare(`INSERT INTO cairn_document_card_amendments VALUES (?, ?, ?, ?,
          (SELECT COALESCE(MAX(ordinal), 0) + 1 FROM cairn_document_card_amendments WHERE ${cardWhere}),
          ?, ?, ?, ?, ?, ?, 'active', NULL)`).run(...keys, amendmentId, ...keys, date, ...sourceKeys(source), sentence, quote);
        changeRevision(db, scope, id);
        changed(db, tx, scope);
        return { status: "inserted" };
      });
    },

    async hideAmendment(tx, callerScope, id, amendmentId, reason, { purge = false } = {}) {
      await access(tx, callerScope, write, (db, scope) => {
        validateId(id);
        requireText(amendmentId);
        if (!purge && !readCardAmendments(db, scope, id).some(row => row.amendment_id === amendmentId)) return;
        const selection = cardSelection();
        addAmendment(selection, id, amendmentId);
        if (purge || readCardRow(db, scope, id)?.state === "active") hide(db, tx, scope, selection, reason, true);
      });
    },

    async hide(tx, scope, id, reason) {
      await store.purgeById?.(tx, scope, id, reason);
    },

    hideWhere(tx, callerScope, selector, reason, { purge = false, retainText = false } = {}) {
      return access(tx, callerScope, write, (db, scope) => {
        const selection = cardSelection();
        selectWhere(db, scope, selector, selection);
        return hide(db, tx, scope, selection, reason, purge || !retainText);
      });
    },

    async purgeById(tx, callerScope, id, reason) {
      await access(tx, callerScope, write, (db, scope) => {
        validateId(id);
        const selection = cardSelection();
        selection.cards.add(id);
        hide(db, tx, scope, selection, reason, true);
      });
    },

    listForPurge(tx, callerScope, selectors, action) {
      return access(tx, callerScope, {}, (db, scope) => {
        const selection = cardSelection();
        if (selectors) {
          for (const selector of selectors) selectWhere(db, scope, selector, selection);
        } else {
          for (const { id } of db.prepare(`SELECT id FROM cairn_document_cards WHERE ${exactScope} AND state != 'purged'`)
            .all(...scopeKey(scope))) selection.cards.add(String(id));
        }
        const assessment = visibility.forPurge(db, scope, new Set(action?.factIds));
        return [...new Set([...selection.cards, ...selection.amendments.keys()])].flatMap(cardId => {
          const row = readCardRow(db, scope, cardId);
          if (!row || row.state === "purged") return [];
          const selected = selection.cards.has(cardId);
          const input = selected ? assessment.input(decodeCard(db, scope, row)) : null;
          const amendments = readCardAmendments(db, scope, cardId, true).flatMap(row => {
            const amendmentId = String(row.amendment_id);
            if (!selected && !selection.amendments.get(cardId)?.has(amendmentId)) return [];
            const sourceMessage = readCardSource(row);
            return [{ amendmentId, sourceMessage, sourceWithheld: assessment.sourceWithheld(sourceMessage) === true }];
          });
          return [{ cardId, input, amendments }];
        });
      });
    },

    markStale(tx, callerScope, id, { memoryId, replacementMemoryId }) {
      return access(tx, callerScope, write, (db, scope) => {
        validateId(id);
        validateId(memoryId);
        validateId(replacementMemoryId);
        const card = readCardRow(db, scope, id);
        if (card?.state !== "active") return;
        const stale = /** @type {CardWrite["stale"]} */ (decodeJson(card.stale));
        if (stale.some(item => item.memoryId === memoryId && item.replacementMemoryId === replacementMemoryId)) return;
        db.prepare(`UPDATE cairn_document_cards SET stale = ?, revision = revision + 1 WHERE ${exactScope} AND id = ?`)
          .run(JSON.stringify([...stale, { memoryId, replacementMemoryId }]), ...scopeKey(scope), id);
        changed(db, tx, scope);
      });
    },

    get(tx, callerScope, id) {
      return access(tx, callerScope, {}, (db, scope) => {
        validateId(id);
        const row = readCardRow(db, scope, id);
        return row?.state === "active" ? record(db, scope, row, visibility.storedReader(db, scope)) : null;
      });
    },

    list(tx, callerScope) {
      return access(tx, callerScope, {}, (db, scope) => {
        const readable = visibility.storedReader(db, scope);
        return db.prepare(`SELECT ${cardColumns} FROM cairn_document_cards WHERE ${exactScope} AND state = 'active' ORDER BY created_at_ms, id`)
          .all(...scopeKey(scope)).flatMap(row => record(db, scope, row, readable) ?? []);
      });
    },

    visibilityInputs(tx, callerScope, refs, { newCard } = {}) {
      return access(tx, callerScope, {}, (db, scope) => {
        // Raw is always available on SQLite. Provider refreshes with
        // requireRaw: false still use the same live evidence for existing cards.
        const build = visibility.inputReader(db, scope);
        return Array.from({ length: refs.length }, (_, i) => {
          try {
            const ref = refs[i];
            if (ref?.type !== "card" || ref.namespace !== scope.namespace || typeof ref.id !== "string" ||
                !ref.id || /[\u0000\uD800-\uDFFF]/u.test(ref.id)) return null;
            const row = readCardRow(db, scope, ref.id);
            if (!row && newCard?.card.id === ref.id && newCard.card.scope.owner === scope.owner &&
                newCard.card.scope.namespace === scope.namespace) return structuredClone(newCard);
            return row?.state === "active" ? build(decodeCard(db, scope, row)) : null;
          } catch {
            return null;
          }
        });
      });
    },
  };

  /** @param {Connection} db @param {Tx} tx @param {Scope} scope
   * @param {Iterable<ReturnType<typeof copySession> & {messageId?: string}>} sources */
  function purgeSources(db, tx, scope, sources, reason = "raw_deleted") {
    const selection = cardSelection();
    for (const source of sources) {
      selectAddress(db, scope, source, selection, source.messageId, legacyHashSession);
    }
    hide(db, tx, scope, selection, reason, true);
  }

  /** @param {Connection} db @param {Tx} tx @param {Scope} scope
   * @param {import("@cairn-ink/core").StoredFact<import("@cairn-ink/core").RawSpanFact>} stored */
  function purgeForgottenSpan(db, tx, scope, stored) {
    purgeSources(db, tx, scope, visibility.forgottenSpanSources(db, scope, stored), "forget");
  }

  /** @param {Connection} db @param {Tx} tx @param {Scope} scope @param {string} id */
  function purgeErasedMemory(db, tx, scope, id) {
    const selection = cardSelection();
    selectWhere(db, scope, { sourceMemoryId: id }, selection);
    const hasCards = db.prepare(`SELECT 1 FROM cairn_document_cards WHERE ${exactScope} AND state != 'purged' LIMIT 1`)
      .get(...scopeKey(scope));
    if (hasCards) {
      const matches = visibility.erasedMemoryText(db, scope, id);
      if (matches) {
        for (const row of db.prepare(`SELECT id, title, body FROM cairn_document_cards
          WHERE ${exactScope} AND state != 'purged'`).all(...scopeKey(scope))) {
          if (matches(String(row.title)) || matches(String(row.body))) selection.cards.add(String(row.id));
        }
      }
    }
    hide(db, tx, scope, selection, "source_memory_forgotten", true);
  }

  return { store, purgeSources, purgeForgottenSpan, purgeErasedMemory };
}
