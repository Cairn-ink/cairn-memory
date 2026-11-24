import { CoreError } from "../../core/src/index.mjs";
import { copyArray, guardOwner, inputText, invalid, namespaceKey, writeTime } from "./memory-input.mjs";
import { advanceIndex, MEMORY_COLUMNS, readEntry, readRevisionNumber, timestampUs } from "./memory-rows.mjs";
import { readVisibility } from "./memory-visibility.mjs";
import { runOperation } from "./uow.mjs";

/** @import { SupersessionStore } from "../../core/src/ports/index.d.ts" */
/** @typedef {Awaited<ReturnType<SupersessionStore["read"]>>} View */

/** @type {SupersessionStore["read"]} */
async function read(tx, scope, id) {
  guardOwner(tx, scope);
  const ns = namespaceKey(scope.namespace);
  const requested = inputText(id);
  /** @type {View} */
  const view = { supersededBy: null, supersedes: [] };
  return runOperation(tx, async (query) => {
    const owner = tx.owner;
    const { rows: edges } = await query(`SELECT previous_memory_id, replacement_memory_id
      FROM memory_supersessions WHERE user_id = $1
        AND (previous_memory_id = $2 OR replacement_memory_id = $2)
      ORDER BY previous_memory_id COLLATE "C"`, [owner, requested]);
    if (!edges.length) return view;
    const endpoints = [...new Set(edges.flatMap(edge => [edge.previous_memory_id, edge.replacement_memory_id]))];
    const { rows } = await query(`SELECT ${MEMORY_COLUMNS} FROM memories
      WHERE user_id = $1 AND core_namespace IS NOT DISTINCT FROM $2 AND id = ANY($3::text[])`, [owner, ns, endpoints]);
    const visibility = await readVisibility(query, owner);
    const checked = await visibility.check(rows.map(row => readEntry(row, owner)));
    const visible = new Set(checked.filter(entry => !entry.hidden).map(entry => entry.memory.id));
    for (const { previous_memory_id: previous, replacement_memory_id: replacement } of edges) {
      if (!visible.has(previous) || !visible.has(replacement)) continue;
      if (previous === requested) view.supersededBy = replacement;
      if (replacement === requested) view.supersedes.push(previous);
    }
    return view;
  });
}

/** @param {{allowNonNullNamespace?: boolean}} [options] @returns {SupersessionStore} */
export function createPostgresSupersessionStore({ allowNonNullNamespace = false } = {}) {
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

    read,

    async incomingCount(tx, scope, replacementId) {
      guardOwner(tx, scope);
      const ns = namespaceKey(scope.namespace);
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
