import { compareUtf8, CoreError } from "../../core/src/index.mjs";
import { copyArray, guardOwner, inputText, invalid, namespaceKey, writeTime } from "./memory-input.mjs";
import { advanceIndex, readRevisionNumber, timestampUs } from "./memory-rows.mjs";
import { readRelationBatches } from "./relation-read.mjs";
import { runOperation } from "./uow.mjs";

/** @import { SupersessionStore } from "../../core/src/ports/index.d.ts" */
/** @import { FactMatchPolicy } from "../../core/src/index.mjs" */
/** @import { Query } from "./memory-rows.mjs" */
/** @typedef {Awaited<ReturnType<SupersessionStore["read"]>>} View */

/** @param {Query} query @param {string} owner @param {string | null} ns @param {readonly string[]} ids
 * @param {FactMatchPolicy["hashSessionKey"]} [hashSessionKey] */
export async function readSupersessionViews(query, owner, ns, ids, hashSessionKey) {
  /** @type {Map<string, View>} */
  const views = new Map(ids.map(id => [id, { supersededBy: null, supersedes: [] }]));
  const batches = readRelationBatches(query, owner, ns, [...views.keys()],
    `SELECT previous_memory_id AS left_id, replacement_memory_id AS right_id
    FROM memory_supersessions WHERE user_id = $1
      AND (previous_memory_id = ANY($3::text[]) OR replacement_memory_id = ANY($3::text[]))`, false, hashSessionKey);
  for await (const { requested, edges, visible } of batches) {
    for (const { left_id: previous, right_id: replacement } of edges) {
      if (!visible.has(previous) || !visible.has(replacement)) continue;
      // A cross-batch edge appears in both queries. Fill only this batch's views.
      const predecessor = requested.has(previous) ? views.get(previous) : undefined;
      if (predecessor) predecessor.supersededBy = replacement;
      if (requested.has(replacement)) views.get(replacement)?.supersedes.push(previous);
    }
  }
  for (const view of views.values()) view.supersedes.sort(compareUtf8);
  return views;
}

/** @param {Pick<FactMatchPolicy, "hashSessionKey"> & {allowNonNullNamespace?: boolean}} [options] @returns {SupersessionStore} */
export function createPostgresSupersessionStore({ allowNonNullNamespace = false, hashSessionKey } = {}) {
  /** @type {NonNullable<SupersessionStore["readMany"]>} */
  async function readMany(tx, scope, ids) {
    guardOwner(tx, scope);
    const ns = namespaceKey(scope.namespace, allowNonNullNamespace);
    const requested = copyArray(ids).map(inputText);
    return runOperation(tx, query => readSupersessionViews(query, tx.owner, ns, requested, hashSessionKey));
  }

  return {
    async record(tx, scope, edge, receiptIds, nowMs) {
      guardOwner(tx, scope, true);
      const ns = namespaceKey(scope.namespace, allowNonNullNamespace);
      if (!edge?.previous || !edge.replacement) invalid();
      const previous = inputText(edge.previous.id);
      const replacement = inputText(edge.replacement.id);
      if (previous === replacement) throw new CoreError("invalid_ref");
      const previousRevision = readRevisionNumber(edge.previous.revision);
      const replacementRevision = readRevisionNumber(edge.replacement.revision);
      const receipts = copyArray(receiptIds).map(inputText);
      if (receipts.length > 4) invalid();
      const us = writeTime(nowMs);
      return runOperation(tx, async (query, run) => {
        const owner = tx.owner;
        const { rows } = await query(`INSERT INTO memory_supersessions (user_id, previous_memory_id, previous_revision,
          replacement_memory_id, replacement_revision, receipt_ids, created_at)
          SELECT $1, p.id, p.revision, r.id, r.revision, $7, ${timestampUs("$8")}
          FROM memories p JOIN memories r ON r.user_id = p.user_id
          WHERE p.user_id = $1 AND p.core_namespace IS NOT DISTINCT FROM $2 AND r.core_namespace IS NOT DISTINCT FROM $2
            AND p.id = $3 AND p.revision = $4 AND r.id = $5 AND r.revision = $6
          ON CONFLICT (previous_memory_id) DO NOTHING RETURNING previous_memory_id`,
        [owner, ns, previous, previousRevision, replacement, replacementRevision, receipts, us.toString()]);
        if (!rows.length) throw new CoreError("invalid_ref");
        await advanceIndex(query, owner, run);
      });
    },

    async markHistorical(tx, scope, id, nowMs) {
      guardOwner(tx, scope, true);
      const ns = namespaceKey(scope.namespace, allowNonNullNamespace);
      const key = inputText(id);
      const us = writeTime(nowMs);
      return runOperation(tx, async (query, run) => {
        const owner = tx.owner;
        const { rows } = await query(`UPDATE memories SET currentness = 'historical', revision = revision + 1,
          updated_at = ${timestampUs("$4")} WHERE user_id = $1 AND core_namespace IS NOT DISTINCT FROM $2 AND id = $3
          RETURNING id`, [owner, ns, key, us.toString()]);
        if (!rows.length) return;
        await query(`DELETE FROM memory_conflicts WHERE user_id = $1
          AND (left_memory_id = $2 OR right_memory_id = $2)`, [owner, key]);
        await advanceIndex(query, owner, run);
      });
    },

    async read(tx, scope, id) {
      const [view] = (await readMany(tx, scope, [id])).values();
      return view;
    },

    readMany,

    async incomingCount(tx, scope, replacementId) {
      guardOwner(tx, scope);
      const ns = namespaceKey(scope.namespace, allowNonNullNamespace);
      const id = inputText(replacementId);
      return runOperation(tx, async (query) => {
        const { rows: [row] } = await query(`SELECT count(*)::integer AS count FROM memory_supersessions s
          JOIN memories m ON m.user_id = s.user_id AND m.id = s.replacement_memory_id
          WHERE s.user_id = $1 AND m.core_namespace IS NOT DISTINCT FROM $2 AND s.replacement_memory_id = $3`,
        [tx.owner, ns, id]);
        return row.count;
      });
    },
  };
}
