import { CoreError } from "../../core/src/index.mjs";

/** @import { Scope } from "../../core/src/ports/common.d.ts" */
/** @typedef {import("./driver.mjs").Connection["query"]} Query */
/** @typedef {{client: string, sessionId: string}} Session */

/** @param {Query} query @param {Scope} scope @param {Session} ref */
export async function rawSession(query, scope, ref) {
  if (scope.namespace !== null || ref.client === "mcp" || !ref.sessionId.startsWith("mcp-save:")) return ref;
  const { rows } = await query(`SELECT DISTINCT source_kind = 'mcp' AS explicit_save FROM memories
    WHERE user_id = $1 AND core_namespace IS NULL AND source_client = $2 AND source_session_id = $3`,
  [scope.owner, ref.client, ref.sessionId]);
  if (rows.length > 1) throw new CoreError("raw_lineage_unavailable");
  return rows[0]?.explicit_save ? { ...ref, client: "mcp" } : ref;
}

/** @param {Query} query @param {Scope} scope @param {Session} ref @returns {Promise<Session[]>} */
export async function conversationSessions(query, scope, ref) {
  const physical = await rawSession(query, scope, ref);
  if (scope.namespace !== null || physical.client !== "mcp" || !physical.sessionId.startsWith("mcp-save:")) return [ref];
  // Reverse the same explicit-save provenance check when starting from the physical address.
  const { rows } = await query(`SELECT source_client FROM memories
    WHERE user_id = $1 AND core_namespace IS NULL AND source_session_id = $2
      AND source_client IS NOT NULL AND source_client <> 'mcp'
    GROUP BY source_client HAVING bool_and(source_kind = 'mcp')`, [scope.owner, physical.sessionId]);
  const clients = new Set([ref.client, physical.client, ...rows.map(row => row.source_client)]);
  return [...clients].map(client => ({ client, sessionId: ref.sessionId }));
}
