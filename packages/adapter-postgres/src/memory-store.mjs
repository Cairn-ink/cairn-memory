import { compareUtf8, CoreError, NEAR_DUPLICATE_DISTANCE } from "../../core/src/index.mjs";
import {
  copyContent, copyMerge, copyQueries, copyReceipts, copySource, guardOwner, inputText, invalid, namespaceKey, writeTime,
} from "./memory-input.mjs";
import {
  advanceIndex, attachReceipts, contentDigests, deleteActiveReceipts, selectMemory,
  storageHash, TEXT_HASH, timestampParts, timestampUs,
} from "./memory-rows.mjs";
import { duplicateMatches, exactCandidates } from "./memory-duplicates.mjs";
import { readVisibility } from "./memory-visibility.mjs";
import { memoryPage } from "./memory-read.mjs";
import { runOperation } from "./uow.mjs";

/** @import { FactMatchPolicy } from "../../core/src/index.mjs" */
/** @import { MemoryStore, Tx } from "../../core/src/ports/index.d.ts" */

const CONTENT_COLUMNS = "text, kind, origin, confidence, embedding, embedding_model, source_kind, source_client, source_session_id, core_digests";
const TARGET = "user_id = $1 AND core_namespace IS NOT DISTINCT FROM $2 AND id = $3";

/** @param {Awaited<ReturnType<typeof copyContent>>} content @param {unknown} digests */
function contentValues({ text, kind, origin, confidence, vector, model, source }, digests) {
  return [text, kind, origin, confidence, vector, model, source.kind, source.client, source.sessionId, JSON.stringify(digests)];
}

/** @param {Tx} tx @param {boolean} committed */
function readIndexRevision(tx, committed) {
  return runOperation(tx, async (query, run) => {
    // The owner lock or the read-only snapshot keeps the revision stable before the first advance.
    let value = run.indexStart;
    if (value === undefined || committed) {
      const { rows: [row] } = await query("SELECT index_revision::text FROM core_owner_state WHERE user_id = $1",
        [tx.owner]);
      value = BigInt(row?.index_revision ?? "0");
    }
    const revision = Number(value);
    if (!Number.isSafeInteger(revision) || revision < 0) throw new CoreError("internal_error");
    return revision;
  });
}

/** @param {Pick<FactMatchPolicy, "hashSessionKey"> & {nearDuplicate?: boolean, allowNonNullNamespace?: boolean}} [options]
 * @returns {MemoryStore} */
export function createPostgresMemoryStore({ nearDuplicate = true, allowNonNullNamespace = false, hashSessionKey } = {}) {
  return {
    async insert(tx, scope, row, receipts, nowMs) {
      guardOwner(tx, scope, true);
      const ns = namespaceKey(scope.namespace, allowNonNullNamespace);
      const content = copyContent(row);
      const evidence = copyReceipts(receipts);
      const updatedAtUs = writeTime(nowMs);
      const suppliedTime = row.createdAtMs;
      const createdAtMs = suppliedTime === undefined ? nowMs : suppliedTime;
      if (!Number.isSafeInteger(createdAtMs) || createdAtMs > nowMs) invalid();
      const created = timestampParts(createdAtMs);

      return runOperation(tx, async (query, run) => {
        const owner = tx.owner;
        const id = crypto.randomUUID();
        const digests = await contentDigests(content);
        const { rows } = await query(`INSERT INTO memories (user_id, id, core_namespace, text_hash,
          created_at, core_created_at_ms, updated_at, ${CONTENT_COLUMNS})
          VALUES ($1, $2, $3, $4, COALESCE(${timestampUs("$5")}, '-infinity'::timestamptz), $6,
            ${timestampUs("$7")}, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          ON CONFLICT (user_id, text_hash) DO NOTHING RETURNING id`,
        [owner, id, ns, storageHash(content.textHash), created.us, created.exact, updatedAtUs.toString(), ...contentValues(content, digests)]);
        if (!rows.length) throw new CoreError("memory_conflict");
        await attachReceipts(query, owner, id, evidence);
        await advanceIndex(query, owner, run);
        return { id, revision: 1, createdAtMs, updatedAtMs: nowMs, updatedAtUs };
      });
    },

    async touchDuplicate(tx, scope, id, receipts, merge, nowMs) {
      guardOwner(tx, scope, true);
      const ns = namespaceKey(scope.namespace, allowNonNullNamespace);
      const key = inputText(id);
      const incoming = copyReceipts(receipts);
      const values = copyMerge(merge);
      const us = writeTime(nowMs);
      return runOperation(tx, async (query, run) => {
        const owner = tx.owner;
        const entry = await selectMemory(query, owner, ns, key);
        if (!entry) throw new CoreError("memory_not_found");
        const { memory } = entry;
        const { kind = memory.kind, origin = memory.origin, confidence } = values;
        const changed = !memory.historical &&
          (kind !== memory.kind || origin !== memory.origin || confidence !== memory.confidence);
        const revision = memory.revision + Number(changed);
        const updated = changed || memory.updatedAtUs !== us;
        if (updated) {
          await query(`UPDATE memories SET updated_at = ${timestampUs("$4")},
            kind = COALESCE($5, kind), origin = COALESCE($6, origin), confidence = COALESCE($7, confidence),
            revision = $8 WHERE ${TARGET}`,
          [owner, ns, key, us.toString(), changed ? kind : null, changed ? origin : null,
            changed ? confidence : null, revision]);
        }
        const attached = await attachReceipts(query, owner, key, incoming);
        if (updated || attached) await advanceIndex(query, owner, run);
        return { outcome: changed ? "changed" : "touched", revision };
      });
    },

    async readRevision(tx, scope, id) {
      guardOwner(tx, scope);
      const ns = namespaceKey(scope.namespace, true);
      const key = inputText(id);
      return runOperation(tx, async (query) => {
        const { rows: [row] } = await query(`SELECT revision, ${TEXT_HASH} AS "textHash" FROM memories WHERE ${TARGET}`,
          [tx.owner, ns, key]);
        return row ?? null;
      });
    },

    async replaceContent(tx, scope, id, expectedRevision, next, receipts, nowMs) {
      guardOwner(tx, scope, true);
      const ns = namespaceKey(scope.namespace, allowNonNullNamespace);
      const key = inputText(id);
      if (!Number.isInteger(expectedRevision)) invalid();
      const content = copyContent(next);
      const evidence = receipts === null ? null : copyReceipts(receipts);
      const us = writeTime(nowMs);
      return runOperation(tx, async (query, run) => {
        const owner = tx.owner;
        const values = [owner, ns, key];
        const entry = await selectMemory(query, owner, ns, key);
        if (!entry) throw new CoreError("memory_not_found");
        const { memory } = entry;
        if (memory.revision !== expectedRevision) throw new CoreError("revision_conflict");
        if (memory.historical) throw new CoreError("memory_historical");
        if (content.textHash === memory.textHash || content.text === memory.text) {
          return { outcome: "unchanged", revision: memory.revision };
        }
        const storedHash = storageHash(content.textHash);
        const collisions = await exactCandidates(query, owner, "id", [storedHash], key);
        if (collisions.length) throw new CoreError("memory_conflict");

        const revision = memory.revision + 1;
        const digests = await contentDigests(content);
        await query(`UPDATE memories SET text_hash = $4, revision = $5,
          updated_at = ${timestampUs("$6")}, (${CONTENT_COLUMNS}) = ($7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
          WHERE ${TARGET}`, [...values, storedHash, revision, us.toString(), ...contentValues(content, digests)]);
        if (evidence !== null) {
          await deleteActiveReceipts(query, owner, key);
          await attachReceipts(query, owner, key, evidence);
        }
        await advanceIndex(query, owner, run);
        return { outcome: "changed", revision };
      }, true);
    },

    async indexRevision(tx) {
      return readIndexRevision(tx, false);
    },

    async committedIndexRevision(tx) {
      return readIndexRevision(tx, true);
    },

    async get(tx, scope, id) {
      guardOwner(tx, scope);
      const ns = namespaceKey(scope.namespace, true);
      const key = inputText(id);
      return runOperation(tx, async (query) => (await selectMemory(query, tx.owner, ns, key))?.memory ?? null);
    },

    async erase(tx, scope, id) {
      guardOwner(tx, scope, true);
      const ns = namespaceKey(scope.namespace, allowNonNullNamespace);
      const key = inputText(id);
      return runOperation(tx, async (query, run) => {
        const owner = tx.owner;
        const deleted = await query(`DELETE FROM memories WHERE ${TARGET} RETURNING id`, [owner, ns, key]);
        if (!deleted.rows.length) return false;
        await deleteActiveReceipts(query, owner, key);
        for (const table of ["memory_topics", "memory_placements"]) {
          await query(`DELETE FROM ${table} WHERE user_id = $1 AND memory_id = $2`, [owner, key]);
        }
        await query(`DELETE FROM memory_supersessions WHERE user_id = $1
          AND (previous_memory_id = $2 OR replacement_memory_id = $2)`, [owner, key]);
        await query(`DELETE FROM memory_conflicts WHERE user_id = $1
          AND (left_memory_id = $2 OR right_memory_id = $2)`, [owner, key]);
        await query(`UPDATE topic_title_sources SET memory_revision = 0
          WHERE user_id = $1 AND memory_id = $2 AND memory_revision <> 0`, [owner, key]);
        await advanceIndex(query, owner, run);
        return true;
      });
    },

    async findDuplicates(tx, scope, batch, options) {
      guardOwner(tx, scope);
      const { namespace } = scope;
      const selection = { owner: tx.owner, namespace };
      const ns = namespaceKey(namespace, true);
      const queries = copyQueries(batch);
      if (!options) invalid();
      const { nearDistance, excludeId } = options;
      if (!Number.isFinite(nearDistance) || nearDistance < 0) invalid();
      const excluded = excludeId === undefined ? undefined : inputText(excludeId);
      return runOperation(tx, async (query) => {
        const visibility = await readVisibility(query, tx.owner, hashSessionKey);
        const { matches, visible } = await duplicateMatches(query, selection, ns, visibility, queries, nearDuplicate, nearDistance, excluded);
        return matches.map(group => group.filter(match => match.kind === "prior" || visible.has(match.id)));
      });
    },

    async readWritePolicy(tx, scope, batch, source, mode, editId, options) {
      guardOwner(tx, scope);
      const { namespace } = scope;
      const selection = { owner: tx.owner, namespace };
      const ns = namespaceKey(namespace, true);
      const queries = copyQueries(batch);
      const incoming = copySource(source);
      if (mode !== "hash" && mode !== "full") invalid();
      const excluded = editId === undefined ? undefined : inputText(editId);
      return runOperation(tx, async (query) => {
        const visibility = await readVisibility(query, tx.owner, hashSessionKey);
        const edit = excluded === undefined ? null : await selectMemory(query, tx.owner, ns, excluded);
        const sourceMemory = edit && { id: edit.memory.id, createdAtMs: edit.memory.createdAtMs };
        const blockedSession = visibility.blocksSession(selection, incoming);
        const blockedPositions = queries.flatMap((item, i) => visibility.blocks(selection, item, mode, sourceMemory) ? [i] : []);
        const near = nearDuplicate && options?.nearDuplicate !== false;
        const { matches, visible } = await duplicateMatches(query, selection, ns, visibility, queries, near, NEAR_DUPLICATE_DISTANCE, excluded);
        const hiddenIds = [...new Set(matches.flatMap(group => group.flatMap(match =>
          match.kind === "stored" && !visible.has(match.id) ? [match.id] : [])))].sort(compareUtf8);
        return { matches, blockedPositions, blockedSession, hiddenIds };
      });
    },

    async exportPage(tx, scope, page) {
      guardOwner(tx, scope);
      return memoryPage(tx, { owner: tx.owner, keys: [namespaceKey(scope.namespace, true)], clients: null, since: null, until: null, hasWindow: false },
        page, true, hashSessionKey);
    },
  };
}
