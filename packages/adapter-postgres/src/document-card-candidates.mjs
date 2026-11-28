import { CoreError, tokenizeT1 } from "../../core/src/index.mjs";
import { DOCUMENT_CARD_SEARCH_TEXT_VERSION } from "../../core/src/routing/index.mjs";
import { CARD_COLUMNS, LIVE_CARD, PERSONAL_CARD, cardRef, nonempty, readCard } from "./document-card-rows.mjs";
import { createCardVisibility } from "./document-card-visibility.mjs";
import { copyReadScope, guardOwner, inputText, invalid } from "./memory-input.mjs";
import { runOperation } from "./uow.mjs";

/** @import { DocumentCardCandidates, RetrievalScope, Tx } from "../../core/src/ports/index.d.ts" */
/** @import { DocumentCardOptions } from "./document-card-visibility.mjs" */
/** @import { Query } from "./memory-rows.mjs" */
/** @typedef {ReturnType<ReturnType<typeof createCardVisibility>>} Reader */

const LIVE_PERSONAL = `${PERSONAL_CARD} AND ${LIVE_CARD}`;
const FILTER = `${LIVE_PERSONAL} AND ($2::text[] IS NULL OR c.source_client = ANY($2))
  AND (NOT $3::boolean OR c.date_ms IS NOT NULL)
  AND ($4::bigint IS NULL OR c.date_ms >= $4)
  AND ($5::bigint IS NULL OR c.date_ms < $5)`;
const EMBEDDED = `c.embedding IS NOT NULL AND c.embedding_model = $6 AND c.embedding_text_version = $7
  AND c.embedding_content_hash = c.content_hash`;
const NEWEST = 'c.updated_at DESC, c.id COLLATE "C" DESC';

/** @param {Tx} tx @param {RetrievalScope} scope @param {number} depth */
function selectionValues(tx, scope, depth) {
  guardOwner(tx, scope);
  const { owner, keys, clients, hasWindow, since, until } = copyReadScope(tx.owner, scope, true);
  if (keys.some(key => key !== null)) throw new CoreError("capability_unavailable");
  if (!Number.isSafeInteger(depth) || depth < 1) invalid();
  return [owner, clients, hasWindow, since, until];
}

/** @param {Query} query @param {Reader} visibility @param {string} owner @param {string} sql
 * @param {unknown[]} values @param {number} depth */
async function visibleRows(query, visibility, owner, sql, values, depth) {
  const result = [];
  const limit = Math.min(128, depth);
  for (let offset = 0; result.length < depth; offset += limit) {
    const { rows } = await query(`${sql} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]);
    for (const row of rows) {
      const card = readCard(row, owner);
      if (!card || !await visibility.visible(card)) continue;
      result.push(row);
      if (result.length === depth) break;
    }
    if (rows.length < limit) break;
  }
  return result;
}

/** @param {DocumentCardOptions} [options] @returns {DocumentCardCandidates} */
export function createPostgresDocumentCardCandidates(options = {}) {
  const visibility = createCardVisibility(options);
  return {
    async lexical(tx, scope, queryText, depth) {
      const values = selectionValues(tx, scope, depth);
      const text = inputText(queryText);
      if (!tokenizeT1(text).length) return { rows: [], matched: false };
      const owner = tx.owner;
      return runOperation(tx, async query => {
        const reader = visibility(query, { owner, namespace: null });
        const rows = await visibleRows(query, reader, owner, `SELECT ${CARD_COLUMNS}, pgroonga_score(c.tableoid, c.ctid) AS score
          FROM document_cards c WHERE ${FILTER}
            AND document_card_search_text(c.title, c.body) &@~ pgroonga_query_escape($6)
          ORDER BY score DESC, ${NEWEST}`, [...values, text], depth);
        return { rows: rows.map(row => ({ ref: cardRef(row.id), score: Number(row.score), updatedAtUs: BigInt(row.updated_us) })),
          matched: rows.length > 0 };
      });
    },

    async vector(tx, scope, embedding, model, depth) {
      const values = selectionValues(tx, scope, depth);
      const requestedModel = nonempty(model);
      if (!(embedding instanceof Float32Array)) invalid();
      const vector = Array.from(embedding);
      if (!vector.length || !vector.every(Number.isFinite)) invalid();
      const matchesDimension = vector.length === 1536;
      const version = DOCUMENT_CARD_SEARCH_TEXT_VERSION;
      const owner = tx.owner;
      return runOperation(tx, async query => {
        const { rows: [counts] } = await query(`SELECT count(*)::text AS eligible,
          count(*) FILTER (WHERE c.embedding IS NOT NULL AND c.embedding_model = $2
            AND c.embedding_text_version = $3 AND c.embedding_content_hash = c.content_hash)::text AS embedded
          FROM document_cards c WHERE ${LIVE_PERSONAL}`, [owner, requestedModel, version]);
        const eligible = Number(counts.eligible), embedded = matchesDimension ? Number(counts.embedded) : 0;
        const coverage = { eligible, embedded, complete: embedded === eligible };
        if (!embedded) return { rows: [], coverage };
        const reader = visibility(query, { owner, namespace: null });
        // The distance of a zero vector is defined as 1, as in memory retrieval.
        const distance = vector.some(value => value !== 0)
          ? "CASE WHEN vector_norm(c.embedding) = 0 THEN 1 ELSE c.embedding <=> $8::vector END"
          : "CASE WHEN $8::vector IS NOT NULL THEN 1::float8 END";
        const rows = await visibleRows(query, reader, owner, `SELECT ${CARD_COLUMNS}, ${distance} AS distance
          FROM document_cards c WHERE ${FILTER} AND ${EMBEDDED}
          ORDER BY distance, ${NEWEST}`, [...values, requestedModel, version, JSON.stringify(vector)], depth);
        return { rows: rows.map(row => ({ ref: cardRef(row.id), distance: Number(row.distance), updatedAtUs: BigInt(row.updated_us) })),
          coverage };
      });
    },
  };
}
