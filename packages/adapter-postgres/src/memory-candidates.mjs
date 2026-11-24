import { tokenizeT1 } from "../../core/src/index.mjs";
import { copyReadScope, guardOwner, inputText, invalid } from "./memory-input.mjs";
import { readCandidate, WRITE_TIME_US } from "./memory-rows.mjs";
import { readVisibility } from "./memory-visibility.mjs";
import { MEMORY_FILTER, memoryScopeParams } from "./retrieval-scope.mjs";
import { runOperation } from "./uow.mjs";

/** @import { LexicalCandidates, VectorCandidates } from "../../core/src/ports/index.d.ts" */

const BATCH_SIZE = 128;
const NEWEST = 'updated_at DESC, id COLLATE "C" DESC';

/** @param {Pick<import("../../core/src/index.mjs").FactMatchPolicy, "hashSessionKey"> & {allowNonNullNamespace?: boolean}} [options]
 * @returns {{ lexical: LexicalCandidates, vector: VectorCandidates }} */
export function createPostgresMemoryCandidates({ hashSessionKey, allowNonNullNamespace = false } = {}) {
  return {
    lexical: {
      async lexical(tx, scope, queryText, depth) {
        guardOwner(tx, scope);
        const selection = copyReadScope(tx.owner, scope, allowNonNullNamespace);
        const text = inputText(queryText);
        if (!Number.isSafeInteger(depth) || depth < 1) invalid();
        if (!tokenizeT1(text).length) return { rows: [], matched: false };
        const namespaces = selection.keys.map(key => key === null ? null : JSON.parse(key));
        return runOperation(tx, async (query) => {
          const visibility = await readVisibility(query, selection.owner, hashSessionKey);
          const columns = visibility.candidateColumns(namespaces);
          const result = [];
          const batchSize = Math.min(BATCH_SIZE, depth);
          for (let offset = 0; result.length < depth; offset += batchSize) {
            const { rows } = await query(`SELECT ${columns}, pgroonga_score(tableoid, ctid) AS score
              FROM memories WHERE ${MEMORY_FILTER} AND text &@~ pgroonga_query_escape($7)
              ORDER BY score DESC, ${NEWEST} LIMIT $8 OFFSET $9`,
            [...memoryScopeParams(selection, false), text, batchSize, offset]);
            const checked = await visibility.check(rows.map(row => readCandidate(row, selection.owner)));
            for (const [i, { memory, hidden }] of checked.entries()) {
              if (hidden) continue;
              result.push({ ref: { type: /** @type {const} */ ("memory"), id: memory.id, namespace: memory.scope.namespace },
                score: rows[i].score, updatedAtUs: memory.updatedAtUs });
              if (result.length === depth) break;
            }
            if (rows.length < batchSize) break;
          }
          return { rows: result, matched: result.length > 0 };
        });
      },
    },
    vector: {
      async vector(tx, scope, queryVector, model, depth) {
        guardOwner(tx, scope);
        const selection = copyReadScope(tx.owner, scope, allowNonNullNamespace);
        if (!(queryVector instanceof Float32Array) || !inputText(model) || !Number.isSafeInteger(depth) || depth < 1) invalid();
        const values = Array.from(queryVector);
        if (!values.length || !values.every(Number.isFinite)) invalid();
        // Hosted vectors have a fixed dimensionality. Other query dimensions have zero coverage.
        const matchesDimension = values.length === 1536;
        const namespaces = selection.keys.map(key => key === null ? null : JSON.parse(key));
        const params = memoryScopeParams(selection, false);
        return runOperation(tx, async (query) => {
          const visibility = await readVisibility(query, selection.owner, hashSessionKey);
          const { rows: [counts] } = await query(`SELECT count(*)::text AS eligible,
            count(*) FILTER (WHERE $7::boolean AND embedding_model = $8)::text AS embedded
            FROM memories WHERE ${MEMORY_FILTER}`, [...params, matchesDimension, model]);
          let eligible = Number(counts.eligible);
          let embedded = Number(counts.embedded);
          const hiddenIds = [];
          if (eligible && visibility.selectedFacts(namespaces).length) {
            const columns = visibility.candidateColumns(namespaces);
            // Coverage includes every visible row, including rows from other models and beyond depth.
            let after = null;
            for (;;) {
              const { rows } = await query(`SELECT ${columns}, embedding_model FROM memories WHERE ${MEMORY_FILTER}
                AND ($7::text IS NULL OR id COLLATE "C" > $7) ORDER BY id COLLATE "C" LIMIT $8`,
              [...params, after, BATCH_SIZE]);
              const checked = await visibility.check(rows.map(row => readCandidate(row, selection.owner)));
              for (const [i, { memory, hidden }] of checked.entries()) {
                if (!hidden) continue;
                hiddenIds.push(memory.id);
                eligible--;
                if (matchesDimension && rows[i].embedding_model === model) embedded--;
              }
              if (rows.length < BATCH_SIZE) break;
              after = rows.at(-1).id;
            }
          }
          const coverage = { eligible, embedded, complete: eligible === embedded };
          if (!embedded) return { rows: [], coverage };
          // Exact ranking preserves depth for filtered owners and makes zero vectors orthogonal.
          const { rows } = await query(`SELECT id, core_namespace, ${WRITE_TIME_US}::text AS updated_us,
            COALESCE(NULLIF(embedding <=> $7::vector, 'NaN'::float8), 1) AS distance
            FROM memories WHERE ${MEMORY_FILTER} AND embedding_model = $8 AND id <> ALL($9::text[])
            ORDER BY distance, ${NEWEST} LIMIT $10`,
          [...params, JSON.stringify(values), model, hiddenIds, depth]);
          return { coverage, rows: rows.map(row => ({
            ref: { type: "memory", id: row.id, namespace: row.core_namespace === null ? null : JSON.parse(row.core_namespace) },
            updatedAtUs: BigInt(row.updated_us), distance: row.distance,
          })) };
        });
      },
    },
  };
}
