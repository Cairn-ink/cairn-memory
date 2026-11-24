import { decodeReceipts, MEMORY_COLUMNS, memoryReceiptsSql, readEntry } from "./memory-rows.mjs";
import { createVisibility, decodeVisibilityFacts, visibilityFactsSql } from "./memory-visibility.mjs";

/** @import {MemoryEntry, Query} from "./memory-rows.mjs" */
/** @import {FactMatchPolicy} from "../../core/src/index.mjs" */

/**
 * Load edges and the inputs to the memory visibility check in one statement.
 * The edge query uses left_id and right_id for its endpoint columns.
 * @param {Query} query @param {string} owner @param {string | null} namespace
 * @param {string[]} ids @param {string} edgeSql @param {FactMatchPolicy["hashSessionKey"]} [hashSessionKey]
 */
export async function readRelationEndpoints(query, owner, namespace, ids, edgeSql, hashSessionKey) {
  const { rows: [batch] } = await query(`WITH edges AS (${edgeSql}), endpoint_ids AS (
    SELECT left_id AS id FROM edges UNION SELECT right_id FROM edges
  ), endpoints AS (
    SELECT ${MEMORY_COLUMNS} FROM memories
    WHERE user_id = $1 AND core_namespace IS NOT DISTINCT FROM $2 AND id IN (SELECT id FROM endpoint_ids)
  ), facts AS (
    SELECT * FROM (${visibilityFactsSql()}) AS owner_facts WHERE EXISTS (SELECT 1 FROM endpoints)
  )
  SELECT ARRAY(SELECT to_jsonb(e) FROM edges e) AS edges,
    ARRAY(SELECT to_jsonb(m) FROM endpoints m) AS endpoints,
    ARRAY(SELECT to_jsonb(f) FROM facts f) AS facts,
    ARRAY(SELECT to_jsonb(r) FROM (${memoryReceiptsSql(`ARRAY(
      SELECT id FROM endpoints WHERE EXISTS (SELECT 1 FROM facts WHERE body->>'kind' IN ('session', 'window'))
    )`)}) AS r) AS receipts`, [owner, namespace, ids]);
  /** @type {MemoryEntry[]} */
  const entries = batch.endpoints.map(/** @param {any} row */ row => readEntry(row, owner));
  const visibility = createVisibility(decodeVisibilityFacts(batch.facts, owner),
    async () => decodeReceipts(batch.receipts), hashSessionKey);
  const checked = await visibility.check(entries);
  const visible = new Map(checked.filter(entry => !entry.hidden).map(({ memory }) => [memory.id, memory]));
  return { edges: batch.edges, visible };
}
