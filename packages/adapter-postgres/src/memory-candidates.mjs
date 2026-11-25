import { compareSortKey, compareUtf8, CoreError, tokenizeT1 } from "../../core/src/index.mjs";
import { copyReadScope, guardOwner, inputText, invalid } from "./memory-input.mjs";
import { SUPPRESSION_DISTANCE, SUPPRESSION_DISTANCE_TOLERANCE } from "../../core/src/privacy/fact-match.mjs";
import { toPostgresError } from "./errors.mjs";
import { CREATED_AT_US, readCandidate } from "./memory-rows.mjs";
import { readVisibility } from "./memory-visibility.mjs";
import { MEMORY_FILTER, memoryScopeParams } from "./retrieval-scope.mjs";
import { ANN_SETUP_BATCH, DISABLE_SORT, HNSW_ITERATIVE_SCAN, READ_SORT, RESTORE_SORT } from "./statement-batches.mjs";
import { queryBatchInRun, runOperation } from "./uow.mjs";

/** @import { LexicalCandidates, VectorCandidates } from "../../core/src/ports/index.d.ts" */

const BATCH_SIZE = 128;
const MAX_VECTOR_PAGES = 8;
const MAX_VECTOR_OVERFETCH = 512;
const VECTOR_DIMENSION = 1536;
const SUPPRESSION_CUTOFF = SUPPRESSION_DISTANCE + SUPPRESSION_DISTANCE_TOLERANCE;
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
        return runOperation(tx, async (query, run) => {
          const visibility = await readVisibility(query, selection.owner, hashSessionKey, run.visibilityFacts);
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
        const matchesDimension = values.length === VECTOR_DIMENSION;
        const namespaces = selection.keys.map(key => key === null ? null : JSON.parse(key));
        const params = memoryScopeParams(selection, false);
        return runOperation(tx, async (query, run) => {
          const batched = Boolean(run.connection.queryBatch);
          let previousSortOn = false;
          let sortDisabled = false;
          async function restoreSort() {
            if (!sortDisabled) return;
            await query(RESTORE_SORT);
            sortDisabled = false;
          }
          // Receipt queries inside ANN pagination use the caller's original setting.
          /** @type {typeof query} */
          const visibilityQuery = batched ? async (text, values) => {
            await restoreSort();
            return query(text, values);
          } : query;
          const visibility = await readVisibility(visibilityQuery, selection.owner, hashSessionKey, run.visibilityFacts);
          const facts = visibility.selectedFacts(namespaces);
          const { rows: [counts] } = await query(`SELECT count(*)::text AS eligible,
            count(*) FILTER (WHERE $7::boolean AND embedding_model = $8)::text AS embedded
            FROM memories WHERE ${MEMORY_FILTER}`, [...params, matchesDimension, model]);
          let eligible = Number(counts.eligible);
          let embedded = Number(counts.embedded);

          const identities = facts.flatMap(({ fact }) => fact.kind === "identity" ? [{
            id: fact.memoryId, namespace: fact.namespace == null ? null : JSON.stringify(fact.namespace),
            through_revision: fact.throughRevision ?? null,
          }] : []);
          const hiddenIds = new Set();
          if (identities.length) {
            const { rows } = await query(`SELECT DISTINCT m.id, m.embedding_model
              FROM jsonb_to_recordset($7::jsonb) AS f(id text, namespace text, through_revision bigint)
              CROSS JOIN LATERAL (
                SELECT id, embedding_model FROM memories m
                WHERE m.id = f.id AND ${MEMORY_FILTER} AND f.namespace IS NOT DISTINCT FROM m.core_namespace
                  AND (f.through_revision IS NULL OR m.revision <= f.through_revision)
                OFFSET 0
              ) m`, [...params, JSON.stringify(identities)]);
            for (const row of rows) {
              hiddenIds.add(row.id);
              eligible--;
              if (matchesDimension && row.embedding_model === model) embedded--;
            }
          }
          if (!embedded) return { rows: [], coverage: { eligible, embedded, complete: eligible === 0 } };

          const vectors = facts.flatMap(({ fact }) => {
            if (fact.kind !== "text" || fact.mode !== "full" || fact.text.embedding == null) return [];
            const vector = fact.text.embedding;
            // Normalize before the float32 cast so narrow but nonzero facts retain their direction.
            const norm = Math.hypot(...vector);
            return [{ namespace: fact.namespace == null ? null : JSON.stringify(fact.namespace),
              exempt_after_us: fact.explicitSaveExemptAfterUs ?? null,
              embedding: vector.length === VECTOR_DIMENSION && norm > 0 && Number.isFinite(norm)
                ? JSON.stringify(vector.map(x => x / norm)) : null }];
          });
          const columns = visibility.candidateColumns(namespaces, { skipEmbedding: true });
          const pageSize = Math.min(depth * 4, MAX_VECTOR_OVERFETCH);
          const zeroQuery = values.every(value => value === 0);
          const seen = new Set();
          /** @type {Awaited<ReturnType<VectorCandidates["vector"]>>["rows"]} */
          const result = [];

          /** @param {"ann" | "orthogonal" | "zero"} mode */
          async function collect(mode) {
            const ann = mode === "ann";
            const distance = ann ? "embedding <=> $8::vector" : "1::float8";
            const filter = ann ? `AND ($10::float8 IS NULL OR ${distance} > $10)
              AND ${distance} <> 'NaN'::float8` : mode === "zero" ? "AND vector_norm(embedding) = 0" : "";
            // WITH TIES uses only distance so the index can supply the entire
            // boundary group. Rank that group before taking any visible prefix.
            const boundary = ann ? `ORDER BY ${distance} FETCH FIRST $9 ROWS WITH TIES`
              : `ORDER BY ${NEWEST} LIMIT $9 OFFSET $10`;
            const vectorFacts = vectors.length ? `, vector_facts AS MATERIALIZED (
              SELECT * FROM jsonb_to_recordset($11::jsonb) AS f(namespace text, embedding vector(1536), exempt_after_us numeric)
            )` : "";
            const suppression = vectors.length ? `EXISTS (
              SELECT 1 FROM vector_facts f
              WHERE f.namespace IS NOT DISTINCT FROM m.core_namespace
                AND NOT (f.exempt_after_us IS NOT NULL AND m.source_kind IN ('mcp', 'web')
                  AND ${CREATED_AT_US} > f.exempt_after_us)
                AND (f.embedding IS NULL OR NOT ((m.embedding <=> f.embedding) > ${SUPPRESSION_CUTOFF}
                  AND (m.embedding <=> f.embedding) <> 'NaN'::float8))
            )` : "false";
            /** @type {number | null} */
            let afterDistance = null;
            for (let page = 0; page < MAX_VECTOR_PAGES; page++) {
              const arguments_ = [...params, model, JSON.stringify(values), pageSize, ann ? afterDistance : page * pageSize];
              if (vectors.length) arguments_.push(JSON.stringify(vectors));
              if (ann && previousSortOn && !sortDisabled) {
                await query(DISABLE_SORT);
                sortDisabled = true;
              }
              const { rows } = await query(`WITH candidates AS MATERIALIZED (
                  SELECT id, updated_at, ${distance} AS distance FROM memories
                  WHERE ${MEMORY_FILTER} AND embedding_model = $7 AND $8::vector IS NOT NULL ${filter}
                  ${boundary}
                )${vectorFacts}
                SELECT page.*, c.distance FROM candidates c CROSS JOIN LATERAL (
                  SELECT ${columns}, ${suppression} AS vector_hidden FROM memories m WHERE m.id = c.id AND m.user_id = $1
                  OFFSET 0
                ) page ORDER BY c.distance, c.updated_at DESC, c.id COLLATE "C" DESC`, arguments_);
              const pending = rows.filter(row => !seen.has(row.id) && Number.isFinite(row.distance));
              const checked = await visibility.check(pending.map(row => readCandidate(row, selection.owner)));
              for (const [i, { memory, hidden }] of checked.entries()) {
                seen.add(memory.id);
                if (hidden || pending[i].vector_hidden) {
                  if (!hiddenIds.has(memory.id)) {
                    eligible--;
                    embedded--;
                  }
                } else {
                  result.push({
                    ref: { type: "memory", id: memory.id, namespace: memory.scope.namespace },
                    updatedAtUs: memory.updatedAtUs, distance: pending[i].distance,
                  });
                }
              }
              result.sort((a, b) => a.distance - b.distance || compareSortKey(b.updatedAtUs, a.updatedAtUs) ||
                compareUtf8(b.ref.id, a.ref.id));
              if (result.length > depth) result.length = depth;
              afterDistance = rows.at(-1)?.distance ?? null;
              if (rows.length < pageSize ||
                  (result.length >= depth && (!ann || afterDistance !== null && afterDistance >= result[depth - 1].distance))) {
                return true;
              }
            }
            return false;
          }

          let checkedDepth;
          if (zeroQuery) {
            checkedDepth = await collect("orthogonal");
          } else {
            // Prefer HNSW over sorting a broad owner. For selective scopes the planner can
            // still choose a bounded exact sort on the filtered rows.
            const preferIndex = embedded > pageSize * MAX_VECTOR_PAGES;
            if (batched && preferIndex) {
              const [, { rows: [settings] }] = await queryBatchInRun(run, tx.readOnly, ANN_SETUP_BATCH, ["SET", "SELECT", "SET"]);
              if (settings?.enable_sort !== "on" && settings?.enable_sort !== "off") throw new CoreError("storage_error");
              previousSortOn = sortDisabled = settings.enable_sort === "on";
            } else {
              await query(HNSW_ITERATIVE_SCAN);
              if (preferIndex) {
                const { rows: [settings] } = await query(READ_SORT);
                previousSortOn = settings.enable_sort === "on";
                if (previousSortOn) {
                  await query(DISABLE_SORT);
                  sortDisabled = true;
                }
              }
            }
            try {
              checkedDepth = await collect("ann");
            } catch (error) {
              // PostgreSQL restores transaction-local settings on rollback after a SQL failure.
              // If only result processing failed, the setting can still be restored here.
              if (batched && sortDisabled && !run.statementFailure) {
                try {
                  await restoreSort();
                } catch {
                  run.failure = toPostgresError(error);
                }
              }
              throw error;
            }
            await restoreSort();
            // Zero vectors have no cosine index entry. They rank at distance 1.
            if (result.length < depth || result[depth - 1].distance >= 1) {
              const checkedZeros = await collect("zero");
              checkedDepth &&= checkedZeros;
            }
          }
          // Counts beyond checked pages are upper bounds. A bounded index scan can
          // also end short while same-model rows remain unchecked.
          const complete = eligible === embedded && checkedDepth && result.length >= Math.min(depth, embedded);
          return { coverage: { eligible, embedded, complete }, rows: result };
        });
      },
    },
  };
}
