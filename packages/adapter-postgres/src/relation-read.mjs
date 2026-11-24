import { memoryReceiptSourcesSql, readCandidate } from "./memory-rows.mjs";
import { createVisibility, endpointEvidenceSql, scopedEvidenceSql, visibilityFactsSql } from "./memory-visibility.mjs";

/** @import {Query} from "./memory-rows.mjs" */
/** @import {FactMatchPolicy} from "../../core/src/index.mjs" */
/** @import {Receipt} from "../../core/src/ports/index.d.ts" */

const BATCH_SIZE = 500;

/**
 * The edge query uses left_id and right_id for its endpoint columns.
 * @param {Query} query @param {string} owner @param {string | null} namespace
 * @param {string[]} ids @param {string} edgeSql @param {boolean} currentness
 * @param {FactMatchPolicy["hashSessionKey"]} [hashSessionKey]
 */
export async function* readRelationBatches(query, owner, namespace, ids, edgeSql, currentness, hashSessionKey) {
  // Each batch uses one statement snapshot for its edges, endpoints, facts, and receipt sources.
  const sql = `WITH edges AS (${edgeSql}), edge_ids AS (
    SELECT left_id AS id FROM edges UNION SELECT right_id FROM edges
  ), facts AS (${visibilityFactsSql({ rowEvidence: true })}),
  evidence AS (${scopedEvidenceSql("$2")}), endpoints AS (
    SELECT id, ${endpointEvidenceSql(currentness)} AS payload FROM memories CROSS JOIN evidence
    WHERE user_id = $1 AND core_namespace IS NOT DISTINCT FROM $2 AND id IN (SELECT id FROM edge_ids)
  )
  SELECT 'edge' AS kind, to_jsonb(e) AS payload FROM edges e
  UNION ALL SELECT 'endpoint', payload FROM endpoints
  UNION ALL SELECT 'fact', to_jsonb(f) FROM facts f WHERE EXISTS (SELECT 1 FROM endpoints)
  UNION ALL SELECT 'receipt', to_jsonb(r) FROM (${memoryReceiptSourcesSql(`ARRAY(
    SELECT id FROM endpoints WHERE (SELECT needs_source FROM evidence)
  )`)}) r`;

  for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
    const batch = ids.slice(offset, offset + BATCH_SIZE);
    const { rows } = await query(sql, [owner, namespace, batch]);
    const edges = [];
    const endpoints = [];
    const facts = [];
    /** @type {Map<string, Pick<Receipt, "client" | "sessionId">[]>} */
    const receipts = new Map();
    for (const { kind, payload } of rows) {
      switch (kind) {
        case "edge": edges.push(payload); break;
        case "endpoint": endpoints.push({ ...readCandidate(payload, owner), historical: payload.currentness === "historical" }); break;
        case "fact": facts.push(payload); break;
        case "receipt": {
          const { memory_id, client, sessionId } = payload;
          let sources = receipts.get(memory_id);
          if (!sources) receipts.set(memory_id, sources = []);
          sources.push({ client, sessionId });
          break;
        }
      }
    }
    const visibility = createVisibility(facts, owner, async () => receipts, hashSessionKey);
    const checked = await visibility.check(endpoints);
    const visible = new Map(checked.flatMap(({ memory, historical, hidden }) =>
      hidden ? [] : [[memory.id, { revision: memory.revision, historical }]]));
    yield { requested: new Set(batch), edges, visible };
  }
}
