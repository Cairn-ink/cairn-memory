import { CoreError, tokenizeT1 } from "../../core/src/index.mjs";
import { copyReadScope, guardOwner, inputText, invalid, pgText } from "./memory-input.mjs";
import { createRawVisibility } from "./raw-visibility.mjs";
import { decode, encode, readStateToken, validateToken } from "./read-snapshot.mjs";
import { runOperation } from "./uow.mjs";

/** @import { ListRawMessages, RawCandidates, RawSegment } from "../../core/src/ports/index.d.ts" */
/** @import { RawReadOptions } from "./raw-visibility.mjs" */
/** @import { Query } from "./memory-rows.mjs" */
/** @typedef {ReturnType<typeof copyReadScope>} ReadSet */

const BATCH_SIZE = 128;
const OCCURRED_US = "(EXTRACT(EPOCH FROM r.occurred_at) * 1000000)::bigint";
const COLUMNS = `r.id, r.client, r.session_id, r.message_id, r.role, r.content, ${OCCURRED_US}::text AS occurred_us`;
const FILTER = `r.user_id = $1 AND ($2::text[] IS NULL OR r.client = ANY($2))
  AND (NOT $3::boolean OR r.occurred_at IS NOT NULL)
  AND ($4::bigint IS NULL OR ${OCCURRED_US}::numeric >= $4::numeric * 1000)
  AND ($5::bigint IS NULL OR ${OCCURRED_US}::numeric < $5::numeric * 1000)
  AND NOT EXISTS (SELECT 1 FROM capture_raw_fences f
    WHERE f.user_id = r.user_id AND f.client = r.client AND f.session_id = r.session_id)`;

/** @param {ReadSet} scope */
function params({ owner, clients, hasWindow, since, until }) {
  return [owner, clients, hasWindow, since, until];
}

/** @param {any} row @returns {RawSegment} */
function segment(row) {
  return { ref: { type: "raw", id: row.id, namespace: null }, client: row.client, sessionId: row.session_id,
    messageId: row.message_id, role: row.role, content: row.content,
    occurredAtMs: row.occurred_us === null ? null : Number(row.occurred_us) / 1000, score: row.score ?? 0 };
}

/** @param {string} cursor */
function pageAfter(cursor) {
  const [token, us, id, ...extra] = decode(cursor);
  if (extra.length || typeof token !== "string" || !pgText(id) || !id ||
      (us !== null && (typeof us !== "string" || !/^(?:0|-?[1-9][0-9]{0,18})$/u.test(us) ||
        BigInt(us) < -9223372036854775808n || BigInt(us) > 9223372036854775807n))) {
    throw new CoreError("invalid_cursor");
  }
  validateToken(token, true);
  return { token, us, id };
}

/** @param {RawReadOptions} options */
export function createPostgresRawReads(options) {
  const readVisibility = createRawVisibility(options);

  /** @type {RawCandidates["raw"]} */
  async function raw(tx, scope, queryText, intent, options) {
    guardOwner(tx, scope);
    const selection = copyReadScope(tx.owner, scope, true);
    const text = inputText(queryText);
    const limit = options?.limit;
    if (intent !== "search" && intent !== "context" || !Number.isSafeInteger(limit) || limit < 1) invalid();
    const coverage = { complete: true };
    if (!selection.keys.includes(null) || !tokenizeT1(text).length) return { segments: [], coverage };
    return runOperation(tx, async (query) => {
      const visible = await readVisibility(query, selection.owner);
      const segments = [];
      const batchSize = Math.min(BATCH_SIZE, limit);
      for (let offset = 0; segments.length < limit; offset += batchSize) {
        const { rows } = await query(`SELECT ${COLUMNS}, pgroonga_score(r.tableoid, r.ctid) AS score
          FROM raw_messages r WHERE ${FILTER} AND r.content &@~ pgroonga_query_escape($6)
          ORDER BY score DESC, r.occurred_at DESC NULLS LAST, r.id COLLATE "C" DESC LIMIT $7 OFFSET $8`,
        [...params(selection), text, batchSize, offset]);
        for (const row of rows) {
          const item = segment(row);
          if (await visible(item)) segments.push(item);
          if (segments.length === limit) break;
        }
        if (rows.length < batchSize) break;
      }
      return { segments, coverage };
    });
  }

  /** @type {ListRawMessages["listRaw"]} */
  async function listRaw(tx, scope, page) {
    guardOwner(tx, scope);
    const selection = copyReadScope(tx.owner, scope, true);
    if (!page || !Number.isSafeInteger(page.limit) || page.limit < 1) invalid();
    const { cursor, limit } = page;
    const start = cursor === null ? null : pageAfter(cursor);
    return runOperation(tx, async (query) => {
      const token = await readStateToken(query, selection);
      if (start && start.token !== token) throw new CoreError("cursor_stale");
      if (!selection.keys.includes(null)) return { items: [], nextCursor: null };
      const visible = await readVisibility(query, selection.owner);
      let us = start?.us ?? null;
      let id = start?.id ?? null;
      let nextCursor = null;
      const items = [];
      const batchSize = Math.min(BATCH_SIZE, limit + 1);
      while (items.length <= limit) {
        const { rows } = await query(`SELECT ${COLUMNS} FROM raw_messages r WHERE ${FILTER}
          AND ($7::text IS NULL OR
            ($6::bigint IS NOT NULL AND (r.occurred_at IS NULL OR ${OCCURRED_US} > $6))
            OR (${OCCURRED_US} IS NOT DISTINCT FROM $6 AND r.id COLLATE "C" > $7))
          ORDER BY r.occurred_at, r.id COLLATE "C" LIMIT $8`,
        [...params(selection), us, id, batchSize]);
        for (const row of rows) {
          const item = segment(row);
          if (!await visible(item)) continue;
          if (items.length === limit) return { items, nextCursor };
          items.push(item);
          if (items.length === limit) nextCursor = encode([token, row.occurred_us, row.id]);
        }
        if (rows.length < batchSize) break;
        ({ occurred_us: us, id } = rows.at(-1));
      }
      return { items, nextCursor: null };
    });
  }

  return { raw, listRaw };
}

/** @param {RawReadOptions} options */
export function createRawRefReader(options) {
  const readVisibility = createRawVisibility(options);
  /** @param {Query} query @param {ReadSet} scope @param {string[]} ids */
  return async function visibleRawIds(query, scope, ids) {
    const visibleIds = new Set();
    if (!scope.keys.includes(null) || !ids.length) return visibleIds;
    const { rows } = await query(`SELECT ${COLUMNS} FROM raw_messages r WHERE ${FILTER} AND r.id = ANY($6::text[])`,
      [...params(scope), ids]);
    if (!rows.length) return visibleIds;
    const visible = await readVisibility(query, scope.owner);
    for (const row of rows) {
      if (await visible(segment(row))) visibleIds.add(row.id);
    }
    return visibleIds;
  };
}
