import { CoreError, tokenizeT1 } from "../../core/src/index.mjs";
import { copyReadScope, guardOwner, inputText, invalid, pgText } from "./memory-input.mjs";
import { timestampUs } from "./memory-rows.mjs";
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
// Tuple membership lets Postgres hash the withheld set as a filter on the timeline index scan.
const FILTER = `r.user_id = $1 AND ($2::text[] IS NULL OR r.client = ANY($2))
  AND (NOT $3::boolean OR r.occurred_at IS NOT NULL)
  AND ($4::bigint IS NULL OR r.occurred_at >= ${timestampUs("($4::bigint * 1000)")})
  AND ($5::bigint IS NULL OR r.occurred_at < ${timestampUs("($5::bigint * 1000)")})
  AND r.client <> ALL($6::text[])
  AND (r.client, r.session_id) NOT IN (
    SELECT f.client, f.session_id FROM jsonb_to_recordset($7::jsonb) AS f(client text, session_id text))
  AND NOT EXISTS (SELECT 1 FROM core_memory_receipts m
    WHERE m.user_id = r.user_id AND m.client = r.client AND m.session_id = r.session_id
      AND m.message_id = r.message_id AND m.forgotten_at IS NOT NULL)`;

/** @param {ReadSet} scope @param {{withheldClients: string[], sessions: string}} visibility */
function params({ owner, clients, hasWindow, since, until }, { withheldClients, sessions }) {
  return [owner, clients, hasWindow, since, until, withheldClients, sessions];
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
        BigInt(us) < -210866803200000000n || BigInt(us) > 9223372036854775807n))) {
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
      const visibility = await readVisibility(query, selection.owner, selection.clients);
      const segments = [];
      const batchSize = Math.min(BATCH_SIZE, limit);
      for (let offset = 0; segments.length < limit; offset += batchSize) {
        const { rows } = await query(`SELECT ${COLUMNS}, pgroonga_score(r.tableoid, r.ctid) AS score
          FROM raw_messages r WHERE ${FILTER} AND r.content &@~ pgroonga_query_escape($8)
          ORDER BY score DESC, r.occurred_at DESC NULLS LAST, r.id COLLATE "C" DESC LIMIT $9 OFFSET $10`,
        [...params(selection, visibility), text, batchSize, offset]);
        segments.push(...(await visibility.visibleBatch(rows.map(segment))).slice(0, limit - segments.length));
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
    return runOperation(tx, async (query, run) => {
      const token = await readStateToken(query, selection, run);
      if (start && start.token !== token) throw new CoreError("cursor_stale");
      if (!selection.keys.includes(null)) return { items: [], nextCursor: null };
      const visibility = await readVisibility(query, selection.owner, selection.clients);
      const items = [];
      const batchSize = Math.min(BATCH_SIZE, limit + 1);
      let nextCursor = null;
      // Separate the NULL tail so dated continuations are always a single index range.
      for (const unknown of [false, true]) {
        if (unknown ? selection.hasWindow : start?.us === null) continue;
        let after = start && (start.us === null) === unknown ? start : null;
        for (;;) {
          const values = [...params(selection, visibility), batchSize];
          let continuation = "";
          if (after) {
            if (unknown) {
              continuation = 'AND r.id COLLATE "C" > $9';
              values.push(after.id);
            } else {
              continuation = `AND (r.occurred_at, r.id COLLATE "C") > (${timestampUs("$9")}, $10::text COLLATE "C")`;
              values.push(after.us, after.id);
            }
          }
          const { rows } = await query(`SELECT ${COLUMNS} FROM raw_messages r WHERE ${FILTER}
            AND r.occurred_at IS ${unknown ? "" : "NOT "}NULL ${continuation}
            ORDER BY r.occurred_at, r.id COLLATE "C" LIMIT $8`, values);
          const checked = await visibility.visibleBatch(rows.map(segment));
          const byId = new Map(rows.map(row => [row.id, row]));
          for (const item of checked) {
            if (items.length === limit) return { items, nextCursor };
            items.push(item);
            if (items.length === limit) nextCursor = encode([token, byId.get(item.ref.id).occurred_us, item.ref.id]);
          }
          if (rows.length < batchSize) break;
          const last = rows.at(-1);
          after = { token, us: last.occurred_us, id: last.id };
        }
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
    const visibility = await readVisibility(query, scope.owner, scope.clients);
    const { rows } = await query(`SELECT ${COLUMNS} FROM raw_messages r WHERE ${FILTER} AND r.id = ANY($8::text[])`,
      [...params(scope, visibility), ids]);
    for (const item of await visibility.visibleBatch(rows.map(segment))) visibleIds.add(item.ref.id);
    return visibleIds;
  };
}
