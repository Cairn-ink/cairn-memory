import { CoreError } from "../../core/src/index.mjs";
import { pauseLockedWrite } from "./capture-lock.mjs";
import { DOCUMENT_CARD_SEARCH_TEXT_VERSION } from "../../core/src/routing/index.mjs";
import { CARD_COLUMNS, LIVE_CARD, PERSONAL_CARD, cardRow, copyCard, copyMessage, copySelector, copyStale,
  decodeCard, nonempty, personalOwner, readCard, sourceMessage, unionLinks } from "./document-card-rows.mjs";
import { createCardVisibility } from "./document-card-visibility.mjs";
import { copyArray, inputText, invalid, pgText } from "./memory-input.mjs";
import { advanceIndex } from "./memory-rows.mjs";
import { requireLiveRun, runOperation } from "./uow.mjs";

/** @import { DocumentCardAmendment, DocumentCardHideOptions, DocumentCardStore, Scope, StoredDocumentCardRecord, Tx } from "../../core/src/ports/index.d.ts" */
/** @import { CardWrite, Links } from "./document-card-rows.mjs" */
/** @import { DocumentCardOptions } from "./document-card-visibility.mjs" */
/** @import { Query } from "./memory-rows.mjs" */
/** @import { Run } from "./uow.mjs" */
/** @import { CardPurge } from "./raw-options.d.mts" */
/** @typedef {Required<DocumentCardStore<StoredDocumentCardRecord>>} Store */
/** @typedef {ReturnType<ReturnType<typeof createCardVisibility>>} Reader */
/** @typedef {ReturnType<typeof copySelector>} Selector */

const AMENDMENTS = "core_document_card_amendments";
const AMENDMENT_PARENT = "a.user_id = c.user_id AND a.card_id = c.id";
const LIVE_AMENDMENT = "a.hidden_reason IS NULL AND NOT a.purged";
const AMENDMENT_COLUMNS = `a.card_id, a.amendment_id, to_char(a.date, 'YYYY-MM-DD') AS date,
  a.sentence, a.quote, a.source_client, a.source_session_id, a.source_message_id, a.hidden_reason`;
const perCall = { perCall: true };

/** @param {any} row @returns {DocumentCardAmendment} */
function decodeAmendment(row) {
  const source = sourceMessage(row);
  if (source === null) invalid();
  return { amendmentId: row.amendment_id, date: row.date, sourceMessage: source, sentence: row.sentence, quote: row.quote };
}

/** @param {CardWrite["sourceMessage"]} source */
function messageValues(source) {
  return [source?.client ?? null, source?.sessionId ?? null, source?.messageId ?? null];
}

/** @param {any} row */
function hidden(row) {
  return row.hidden_reason !== null || row.tombstoned;
}

/** @param {Reader} reader @param {Links} links */
async function rejectFutureLinks(reader, links) {
  for (const { id, revision } of links) {
    const entry = await reader.memory(id);
    if (entry && revision > entry.memory.revision) invalid();
  }
}

/** @param {Reader} reader @param {Links} previous @param {Links} incoming @param {boolean} bodyChanged @param {boolean} union */
async function updateLinks(reader, previous, incoming, bodyChanged, union) {
  if (!previous.length || (bodyChanged && !union)) return incoming;
  const pinned = new Set();
  const retained = [];
  for (const link of previous) {
    const { correctedRevisions, unresolvedCorrection } = await reader.correction(link);
    const corrected = unresolvedCorrection || correctedRevisions.includes(link.revision);
    if (corrected && !bodyChanged) {
      pinned.add(link.id);
      retained.push(link);
    } else if (union && !corrected) {
      retained.push(link);
    }
  }
  return unionLinks([...retained, ...incoming.filter(link => !pinned.has(link.id))]);
}

/** @param {Query} query @param {string} owner @param {string[]} ids */
async function dropMemberships(query, owner, ids) {
  await query("DELETE FROM card_topics WHERE user_id = $1 AND card_id = ANY($2::text[])", [owner, ids]);
  await query("DELETE FROM card_placements WHERE user_id = $1 AND card_id = ANY($2::text[])", [owner, ids]);
}

/** @param {Parameters<CardPurge>[3]} sources @param {unknown[]} args */
function sourceSelectorsSql(sources, args) {
  if (!sources.length) return { card: "false", amendment: "false" };
  const target = `jsonb_to_recordset($${args.push(JSON.stringify(sources))}::jsonb)
    AS target(client text, "sessionId" text, "messageId" text)`;
  /** @param {string} alias */
  const match = alias => `EXISTS (SELECT 1 FROM ${target}
    WHERE (${alias}.source_client, ${alias}.source_session_id) = (target.client, target."sessionId")
      AND (target."messageId" IS NULL OR ${alias}.source_message_id = target."messageId"))`;
  const sentence = `EXISTS (SELECT 1 FROM ${target} JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(c.sentences) = 'array' THEN c.sentences ELSE '[]'::jsonb END) s
    ON (s #>> '{source,client}', s #>> '{source,sessionId}') = (target.client, target."sessionId")
      AND (target."messageId" IS NULL OR s #>> '{source,messageId}' = target."messageId"))`;
  return { card: `(${match("c")} OR ${sentence})`, amendment: match("a") };
}

/** @param {Query} query @param {string} owner @param {readonly Selector[] | undefined} selectors
 * @param {{id?: string, purge?: boolean, lock?: boolean, sources?: Parameters<CardPurge>[3], textMatches?: string[]}} [options] */
async function selectAffected(query, owner, selectors, { id, purge = false, lock = false, sources = [], textMatches = [] } = {}) {
  /** @type {unknown[]} */
  const args = [owner];
  const addresses = [...sources];
  const cardMatches = [];
  for (const selector of selectors ?? []) {
    if (selector.sourceMemoryId !== undefined) {
      cardMatches.push(`c.source_memories @> $${args.push(JSON.stringify([{ id: selector.sourceMemoryId }]))}::jsonb`);
    } else {
      addresses.push(selector.sourceMessage ?? selector.session);
    }
  }
  const { card: sourceMatch, amendment } = sourceSelectorsSql(addresses, args);
  if (textMatches.length) cardMatches.push(`c.id = ANY($${args.push(textMatches)}::text[])`);
  const card = selectors === undefined ? "true" : [...cardMatches, sourceMatch].join(" OR ");
  const constraints = `${PERSONAL_CARD} AND ${purge ? "NOT c.tombstoned" : LIVE_CARD}
    ${id === undefined ? "" : `AND c.id = $${args.push(id)}`}`;
  // Select both sets in one statement, with all selector parameters bound for both branches.
  const { rows } = await query(`SELECT ${CARD_COLUMNS}, (${card}) AS selected,
      ARRAY(SELECT a.amendment_id FROM ${AMENDMENTS} a WHERE ${AMENDMENT_PARENT}
        AND ${purge ? "NOT a.purged" : LIVE_AMENDMENT} AND ((${card}) OR (${amendment}))
        ORDER BY a.date, a.insertion_sequence) AS amendment_ids
    FROM document_cards c WHERE ${constraints} AND ((${card}) OR EXISTS (
      SELECT 1 FROM ${AMENDMENTS} a WHERE ${AMENDMENT_PARENT}
        AND ${purge ? "NOT a.purged" : LIVE_AMENDMENT} AND (${amendment})))
    ORDER BY c.id COLLATE "C" ${lock ? "FOR UPDATE OF c" : ""}`, args);
  return rows;
}

/** @param {Query} query @param {string} owner @param {string} cardId @param {string[]} ids
 * @param {string} reason @param {boolean} purge */
async function hideAmendments(query, owner, cardId, ids, reason, purge) {
  if (!ids.length) return [];
  const { rows } = await query(`WITH targets AS (
    SELECT a.amendment_id, a.hidden_reason IS NULL AND c.hidden_reason IS NULL AS newly_hidden
    FROM ${AMENDMENTS} a JOIN document_cards c ON ${AMENDMENT_PARENT}
    WHERE ${PERSONAL_CARD} AND c.id = $2 AND a.amendment_id = ANY($3::text[])
      AND ${purge ? "NOT a.purged" : LIVE_AMENDMENT}
  )
  UPDATE ${AMENDMENTS} a SET hidden_reason = $4
    ${purge ? ", purged = true, sentence = '', quote = ''" : ""}
    FROM targets t WHERE a.user_id = $1 AND a.card_id = $2 AND a.amendment_id = t.amendment_id
    RETURNING t.newly_hidden`, [owner, cardId, ids, reason]);
  return rows;
}

/** @param {Query} query @param {string} owner @param {any[]} affected @param {string} reason @param {boolean} purge */
async function hideSelection(query, owner, affected, reason, purge) {
  let hidden = 0;
  let changed = false;
  const ids = [];
  for (const row of affected) {
    const amendments = await hideAmendments(query, owner, row.id, row.amendment_ids, reason, purge);
    hidden += amendments.filter(({ newly_hidden }) => newly_hidden).length;
    changed ||= amendments.length > 0;
    if (row.selected) {
      ids.push(row.id);
      if (row.hidden_reason === null) hidden++;
    }
  }
  if (ids.length) {
    await query(`UPDATE document_cards c SET hidden_reason = $3
      ${purge ? `, tombstoned = true, title = '', body = '', sentences = '[]'::jsonb,
        embedding = NULL, embedding_model = NULL, embedding_text_version = NULL, embedding_content_hash = NULL` : ""}
      WHERE ${PERSONAL_CARD} AND c.id = ANY($2::text[])`, [owner, ids, reason]);
    await dropMemberships(query, owner, ids);
  }
  return { hidden, changed: changed || ids.length > 0 };
}

/** @param {Query} query @param {string} owner @param {string[]} ids @param {boolean} purge */
async function readAmendments(query, owner, ids, purge) {
  if (!ids.length) return [];
  const { rows } = await query(`SELECT ${AMENDMENT_COLUMNS} FROM ${AMENDMENTS} a
    JOIN document_cards c ON ${AMENDMENT_PARENT}
    WHERE ${PERSONAL_CARD} AND c.id = ANY($2::text[]) AND ${purge ? "NOT a.purged" : LIVE_AMENDMENT}
    ORDER BY a.date, a.insertion_sequence`, [owner, ids]);
  return rows;
}

/** @param {DocumentCardOptions} [options] @returns {Store & {purgeCards: CardPurge}} */
export function createPostgresDocumentCardStore(options = {}) {
  const visibility = createCardVisibility(options);

  /** @param {Tx} tx @param {Scope} scope @param {string} reason @param {DocumentCardHideOptions & {id?: string}} options
   * @param {Selector[]} [selectors] */
  async function hideCards(tx, scope, reason, { id, purge = false } = {}, selectors) {
    const owner = personalOwner(tx, scope, true);
    const why = nonempty(reason);
    return runOperation(tx, async (query, run) => {
      const affected = await selectAffected(query, owner, selectors, { id, purge, lock: true });
      const result = await hideSelection(query, owner, affected, why, purge);
      if (result.changed) await advanceIndex(query, owner, run, perCall);
      return { hidden: result.hidden };
    });
  }

  /** @param {Tx} tx @param {Scope} scope @param {string} [id] */
  async function readCards(tx, scope, id) {
    const owner = personalOwner(tx, scope);
    return runOperation(tx, async query => {
      const { rows } = await query(`SELECT ${CARD_COLUMNS} FROM document_cards c
        WHERE ${PERSONAL_CARD} AND ${LIVE_CARD} AND ($2::text IS NULL OR c.id = $2)
        ORDER BY c.updated_at DESC, c.id COLLATE "C" DESC`, [owner, id ?? null]);
      const reader = visibility(query, { owner, namespace: null });
      /** @type {StoredDocumentCardRecord[]} */
      const records = [];
      for (const row of rows) {
        const card = readCard(row, owner);
        if (card && await reader.stored(card)) records.push({ ...card, amendments: [] });
      }
      /** @type {Map<string, DocumentCardAmendment[]>} */
      const amendments = new Map(records.map(({ id }) => [id, []]));
      for (const row of await readAmendments(query, owner, [...amendments.keys()], false)) {
        const amendment = decodeAmendment(row);
        if (await reader.withheld(amendment.sourceMessage) !== true) amendments.get(row.card_id)?.push(amendment);
      }
      return records.map(card => ({ ...card, amendments: amendments.get(card.id) ?? [] }));
    });
  }

  return {
    async purgeCards(query, run, scope, sources, memoryId) {
      if (!sources.length && memoryId === undefined) return;
      const { owner } = scope;
      const textMatches = [];
      if (memoryId !== undefined) {
        const { rows } = await query(`SELECT c.id, c.title, c.body FROM document_cards c
          WHERE ${PERSONAL_CARD} AND NOT c.tombstoned`, [owner]);
        if (rows.length) {
          const matches = await visibility(query, scope).erasedMemoryText(memoryId);
          for (const { id, title, body } of rows) if (await matches(title) || await matches(body)) textMatches.push(id);
        }
      }
      const selectors = memoryId === undefined ? [] : [{ sourceMemoryId: memoryId }];
      const affected = await selectAffected(query, owner, selectors, { sources, textMatches, purge: true, lock: true });
      const reason = memoryId === undefined ? "raw_deleted" : "source_memory_forgotten";
      if ((await hideSelection(query, owner, affected, reason, true)).changed) await advanceIndex(query, owner, run, perCall);
    },

    async put(tx, scope, input, embedding) {
      const owner = personalOwner(tx, scope, true);
      const card = copyCard(owner, input);
      const model = embedding === undefined ? null : nonempty(embedding.model);
      const vector = embedding === undefined ? null : cardVector(embedding.vector);
      return runOperation(tx, async (query, run) => {
        const existing = await cardRow(query, owner, card.id, true);
        if (existing && hidden(existing)) return { status: "tombstoned" };
        const reader = visibility(query, card.scope);
        await rejectFutureLinks(reader, card.sourceMemories);
        if (existing?.content_hash === card.contentHash) return { status: "unchanged" };
        const previous = existing ? decodeCard(existing, owner) : null;
        const origin = previous?.origin ?? card.origin ?? "router";
        if ((card.sourceMessage !== null) !== (origin === "router")) invalid();
        const links = previous ? await updateLinks(reader, previous.sourceMemories, card.sourceMemories,
          card.body !== previous.body, !!(previous.sourceMessage && card.sourceMessage)) : card.sourceMemories;
        const values = [owner, card.id, card.contentHash, card.title, card.body, card.date, origin,
          ...messageValues(card.sourceMessage), JSON.stringify(links), JSON.stringify(card.sentences), JSON.stringify(card.stale),
          vector, model, model === null ? null : DOCUMENT_CARD_SEARCH_TEXT_VERSION, model === null ? null : card.contentHash];
        if (existing) {
          await query(`UPDATE document_cards c SET
            (content_hash, title, body, date_ms, origin, source_client, source_session_id, source_message_id,
              source_memories, sentences, stale, embedding, embedding_model, embedding_text_version, embedding_content_hash)
            = ($3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17), updated_at = clock_timestamp()
            WHERE ${PERSONAL_CARD} AND c.id = $2`, values);
          await dropMemberships(query, owner, [card.id]);
        } else {
          const { rows } = await query(`INSERT INTO document_cards
            (user_id, scope_id, id, content_hash, title, body, date_ms, origin, source_client, source_session_id, source_message_id,
              source_memories, sentences, stale, embedding, embedding_model, embedding_text_version, embedding_content_hash)
            VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
            ON CONFLICT DO NOTHING RETURNING id`, values);
          // Either unique key can collide, including with a row outside the personal scope.
          if (!rows.length) throw new CoreError("revision_conflict");
        }
        await advanceIndex(query, owner, run, perCall);
        return { status: existing ? "replaced" : "inserted" };
      });
    },

    async linkMemories(tx, scope, cardId, links) {
      const owner = personalOwner(tx, scope, true);
      const id = nonempty(cardId), incoming = unionLinks(links);
      return runOperation(tx, async (query, run) => {
        const row = await cardRow(query, owner, id, true);
        if (!row) return { status: "not_found" };
        if (hidden(row)) return { status: "tombstoned" };
        const card = decodeCard(row, owner);
        const reader = visibility(query, card.scope);
        await rejectFutureLinks(reader, incoming);
        const next = await updateLinks(reader, card.sourceMemories, incoming, false, true);
        const serialized = JSON.stringify(next);
        if (serialized === JSON.stringify(card.sourceMemories)) return { status: "unchanged" };
        await query(`UPDATE document_cards c SET source_memories = $3 WHERE ${PERSONAL_CARD} AND c.id = $2`,
          [owner, id, serialized]);
        await advanceIndex(query, owner, run, perCall);
        return { status: "linked" };
      });
    },

    async amend(tx, scope, cardId, amendment) {
      const owner = personalOwner(tx, scope, true);
      const id = nonempty(cardId), amendmentId = nonempty(amendment?.amendmentId);
      const date = nonempty(amendment.date);
      const parsed = new Date(date);
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || date.startsWith("0000") ||
          !Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) invalid();
      const source = copyMessage(amendment.sourceMessage);
      const values = [owner, id, amendmentId, date, inputText(amendment.sentence), inputText(amendment.quote), ...messageValues(source)];
      /** @param {Query} query @param {Run} run @returns {ReturnType<Store["amend"]>} */
      async function insert(query, run) {
        const row = await cardRow(query, owner, id, true);
        if (!row || hidden(row)) return { status: "hidden_card" };
        const card = readCard(row, owner);
        const reader = visibility(query, { owner, namespace: null });
        if (!card || !await reader.stored(card)) return { status: "hidden_card" };
        const { rows: recorded } = await query(`SELECT 1 FROM ${AMENDMENTS} a
          JOIN document_cards c ON ${AMENDMENT_PARENT}
          WHERE ${PERSONAL_CARD} AND c.id = $2 AND a.amendment_id = $3`, [owner, id, amendmentId]);
        if (recorded.length) return { status: "unchanged" };
        const { rows: [pause] } = await query("SELECT paused FROM memory_pause WHERE user_id = $1", [owner]);
        if (pause?.paused || await reader.withheld(source) === true) return { status: "hidden_card" };
        const { rows } = await query(`INSERT INTO ${AMENDMENTS}
          (user_id, card_id, amendment_id, date, sentence, quote, source_client, source_session_id, source_message_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (user_id, card_id, amendment_id) DO NOTHING RETURNING amendment_id`, values);
        if (!rows.length) return { status: "unchanged" };
        await advanceIndex(query, owner, run, perCall);
        return { status: "inserted" };
      }
      return requireLiveRun(tx, true).pauseLock ? pauseLockedWrite(tx, () => insert) : runOperation(tx, insert);
    },

    async hideAmendment(tx, scope, cardId, amendmentId, reason, { purge = false } = {}) {
      const owner = personalOwner(tx, scope, true);
      const id = nonempty(cardId), changeId = nonempty(amendmentId), why = nonempty(reason);
      return runOperation(tx, async (query, run) => {
        const row = await cardRow(query, owner, id, true);
        if (!row || row.tombstoned || (!purge && hidden(row))) return;
        if ((await hideAmendments(query, owner, id, [changeId], why, purge)).length) await advanceIndex(query, owner, run, perCall);
      });
    },

    async hide(tx, scope, id, reason) {
      await hideCards(tx, scope, reason, { id: nonempty(id) });
    },

    hideWhere(tx, scope, selector, reason, options) {
      return hideCards(tx, scope, reason, options, [copySelector(selector)]);
    },

    async purgeById(tx, scope, id, reason) {
      await hideCards(tx, scope, reason, { id: nonempty(id), purge: true });
    },

    async listForPurge(tx, scope, selectors, action) {
      const owner = personalOwner(tx, scope);
      const selection = selectors === undefined ? undefined : copyArray(selectors).map(copySelector);
      const evidence = { actionId: action?.actionId ?? "", factIds: action?.factIds.slice() ?? [] };
      return runOperation(tx, async query => {
        const affected = await selectAffected(query, owner, selection, { purge: true });
        const reader = visibility(query, { owner, namespace: null }, evidence);
        const rows = await readAmendments(query, owner, affected.map(({ id }) => id), true);
        const byCard = new Map();
        for (const row of rows) {
          const amendments = byCard.get(row.card_id) ?? new Map();
          amendments.set(row.amendment_id, row);
          byCard.set(row.card_id, amendments);
        }
        const result = [];
        for (const row of affected) {
          const card = row.selected ? readCard(row, owner) : null;
          const amendments = [];
          for (const id of row.amendment_ids) {
            const { amendmentId, sourceMessage } = decodeAmendment(byCard.get(row.id).get(id));
            amendments.push({ amendmentId, sourceMessage, sourceWithheld: await reader.withheld(sourceMessage) === true });
          }
          result.push({ cardId: row.id, input: card && await reader.input(card), amendments });
        }
        return result;
      });
    },

    async markStale(tx, scope, cardId, entry) {
      const owner = personalOwner(tx, scope, true);
      const id = nonempty(cardId), stale = copyStale(entry);
      return runOperation(tx, async (query, run) => {
        const { rows } = await query(`UPDATE document_cards c SET stale = c.stale || $3::jsonb
          WHERE ${PERSONAL_CARD} AND ${LIVE_CARD} AND c.id = $2 AND NOT (c.stale @> $3::jsonb) RETURNING c.id`,
        [owner, id, JSON.stringify([stale])]);
        if (rows.length) await advanceIndex(query, owner, run, perCall);
      });
    },

    async get(tx, scope, id) {
      return (await readCards(tx, scope, nonempty(id)))[0] ?? null;
    },

    list: readCards,

    async visibilityInputs(tx, scope, refs, { requireRaw = true, newCard } = {}) {
      const owner = personalOwner(tx, scope);
      const requestedScope = { owner, namespace: null };
      const ids = copyArray(refs).map(ref => {
        try {
          const id = ref?.id;
          return ref?.type === "card" && ref.namespace === null && pgText(id) && id ? id : null;
        } catch {
          return null;
        }
      });
      return runOperation(tx, async query => {
        const { rows } = await query(`SELECT ${CARD_COLUMNS} FROM document_cards c
          WHERE ${PERSONAL_CARD} AND c.id = ANY($2::text[])`, [owner, [...new Set(ids.filter(id => id !== null))]]);
        const byId = new Map(rows.map(row => [row.id, row]));
        const reader = visibility(query, requestedScope);
        return Promise.all(ids.map(async id => {
          if (id === null) return null;
          try {
            const row = byId.get(id);
            if (!row) return newCard?.card.id === id && newCard.card.scope.owner === owner && newCard.card.scope.namespace === null
              ? structuredClone(newCard) : null;
            if (hidden(row)) return null;
            const card = readCard(row, owner);
            if (!card) return null;
            const input = await reader.input(card, requireRaw);
            if (input.sourceWithheld === null || (!card.sourceMessage && input.sourceWithheld)) return null;
            return input;
          } catch {
            return null;
          }
        }));
      });
    },
  };
}

/** @param {import("../../core/src/routing/index.mjs").DocumentVector} vector */
function cardVector(vector) {
  if (!Array.isArray(vector) && !(vector instanceof Float32Array) && !(vector instanceof Float64Array)) invalid();
  const values = Array.from(vector);
  if (values.length !== 1536 || !values.every(x => Number.isFinite(x) && Number.isFinite(Math.fround(x)))) invalid();
  return JSON.stringify(values);
}
