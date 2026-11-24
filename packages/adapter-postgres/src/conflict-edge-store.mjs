import { canonicalPair, compareUtf8 } from "../../core/src/index.mjs";
import { copyArray, guardOwner, inputText, invalid, namespaceKey, writeTime } from "./memory-input.mjs";
import { advanceIndex, readRevisionNumber, timestampUs } from "./memory-rows.mjs";
import { readRelationEndpoints } from "./relation-read.mjs";
import { runOperation } from "./uow.mjs";

/** @import {ConflictEdge, ConflictEdgeStore} from "../../core/src/ports/index.d.ts" */
/** @import {FactMatchPolicy} from "../../core/src/index.mjs" */

const TOUCHING = `user_id = $1 AND (left_memory_id = $3 OR right_memory_id = $3)
  AND EXISTS (SELECT 1 FROM memories WHERE user_id = $1 AND core_namespace IS NOT DISTINCT FROM $2 AND id = $3)`;

/** @param {Pick<FactMatchPolicy, "hashSessionKey"> & {allowNonNullNamespace?: boolean}} [options] @returns {ConflictEdgeStore} */
export function createPostgresConflictEdgeStore({ allowNonNullNamespace = false, hashSessionKey } = {}) {
  /** @type {NonNullable<ConflictEdgeStore["readMany"]>} */
  async function readMany(tx, scope, ids) {
    guardOwner(tx, scope);
    const ns = namespaceKey(scope.namespace);
    /** @type {Map<string, ConflictEdge[]>} */
    const result = new Map(copyArray(ids).map(id => [inputText(id), []]));
    if (!result.size) return result;
    return runOperation(tx, async (query) => {
      const { edges, visible } = await readRelationEndpoints(query, tx.owner, ns, [...result.keys()],
        `SELECT left_memory_id AS left_id, right_memory_id AS right_id, left_revision, right_revision, relation, source
        FROM memory_conflicts WHERE user_id = $1
          AND (left_memory_id = ANY($3::text[]) OR right_memory_id = ANY($3::text[]))`, hashSessionKey);
      for (const { left_id, right_id, left_revision, right_revision, relation, source } of edges) {
        const left = visible.get(left_id);
        const right = visible.get(right_id);
        if (left?.revision !== left_revision || right?.revision !== right_revision || left?.historical || right?.historical) continue;
        result.get(left_id)?.push({ memoryId: right_id, revision: right_revision, relation, source });
        result.get(right_id)?.push({ memoryId: left_id, revision: left_revision, relation, source });
      }
      for (const edges of result.values()) {
        edges.sort((a, b) => compareUtf8(a.memoryId, b.memoryId) || compareUtf8(a.source, b.source));
      }
      return result;
    });
  }

  return {
    async insert(tx, scope, edge, nowMs) {
      guardOwner(tx, scope, true);
      const ns = namespaceKey(scope.namespace, allowNonNullNamespace);
      if (!edge?.left || !edge.right) invalid();
      const { relation, source } = edge;
      if (relation !== "contradicts" || (source !== "explicit-hint" && source !== "inferred-hint")) invalid();
      const first = inputText(edge.left.id);
      const second = inputText(edge.right.id);
      const [left, right] = canonicalPair(first, second);
      const [leftRevision, rightRevision] = (left === first ? [edge.left, edge.right] : [edge.right, edge.left])
        .map(endpoint => readRevisionNumber(endpoint.revision));
      const us = writeTime(nowMs);
      return runOperation(tx, async (query) => {
        const owner = tx.owner;
        const { rows } = await query(`INSERT INTO memory_conflicts (user_id, left_memory_id, left_revision,
          right_memory_id, right_revision, relation, source, created_at)
          SELECT $1, l.id, l.revision, r.id, r.revision, $7, $8, ${timestampUs("$9")}
          FROM memories l JOIN memories r ON r.user_id = l.user_id
          WHERE l.user_id = $1 AND l.core_namespace IS NOT DISTINCT FROM $2 AND r.core_namespace IS NOT DISTINCT FROM $2
            AND l.id = $3 AND l.revision = $4 AND r.id = $5 AND r.revision = $6
            AND l.currentness = 'current' AND r.currentness = 'current'
          ON CONFLICT DO NOTHING RETURNING left_memory_id`,
        [owner, ns, left, leftRevision, right, rightRevision, relation, source, us.toString()]);
        const inserted = rows.length > 0;
        if (inserted) await advanceIndex(query, owner);
        return { inserted };
      });
    },

    async list(tx, scope, id) {
      const [edges] = (await readMany(tx, scope, [id])).values();
      return edges;
    },

    readMany,

    async invalidate(tx, scope, id) {
      guardOwner(tx, scope, true);
      const ns = namespaceKey(scope.namespace, allowNonNullNamespace);
      const key = inputText(id);
      return runOperation(tx, async (query) => {
        const { rows } = await query(`DELETE FROM memory_conflicts WHERE ${TOUCHING} RETURNING 1`, [tx.owner, ns, key]);
        if (rows.length) await advanceIndex(query, tx.owner);
        return rows.length;
      });
    },

    async degree(tx, scope, id) {
      guardOwner(tx, scope);
      const ns = namespaceKey(scope.namespace);
      const key = inputText(id);
      return runOperation(tx, async (query) => {
        const { rows: [row] } = await query(`SELECT count(*)::integer AS count FROM memory_conflicts WHERE ${TOUCHING}`,
          [tx.owner, ns, key]);
        return row.count;
      });
    },
  };
}
