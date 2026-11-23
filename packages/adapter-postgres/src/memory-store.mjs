import { compareUtf8, CoreError, NEAR_DUPLICATE_DISTANCE } from "../../core/src/index.mjs";
import {
  copyContent, copyMerge, copyQueries, copyReceipts, copySource, guardOwner, inputText, invalid, namespaceKey, writeTime,
} from "./memory-input.mjs";
import {
  advanceIndex, attachReceipts, contentDigests, MEMORY_COLUMNS, readEntry, selectMemory,
  storageHash, TEXT_HASH, timestampParts, timestampUs,
} from "./memory-rows.mjs";
import { readVisibility } from "./memory-visibility.mjs";
import { memoryPage } from "./memory-read.mjs";
import { runOperation } from "./uow.mjs";

/** @import { DuplicateQuery, MemoryMatch, MemoryStore, Scope } from "../../core/src/ports/index.d.ts" */
/** @import { MemoryEntry, Query } from "./memory-rows.mjs" */

const CONTENT_COLUMNS = "text, kind, origin, confidence, embedding, embedding_model, source_kind, source_client, source_session_id, core_digests";
const TARGET = "user_id = $1 AND core_namespace IS NOT DISTINCT FROM $2 AND id = $3";

/** @param {Awaited<ReturnType<typeof copyContent>>} content @param {unknown} digests */
function contentValues({ text, kind, origin, confidence, vector, model, source }, digests) {
  return [text, kind, origin, confidence, vector, model, source.kind, source.client, source.sessionId, JSON.stringify(digests)];
}

/** @param {Query} query @param {Scope} scope @param {string | null} ns
 * @param {readonly string[] | null} hashes @param {string | undefined} excluded */
async function candidates(query, scope, ns, hashes, excluded) {
  const { rows } = await query(`SELECT ${MEMORY_COLUMNS} FROM memories
    WHERE user_id = $1 AND core_namespace IS NOT DISTINCT FROM $2
      AND ($3::text[] IS NULL OR text_hash = ANY($3) OR core_text_hash = ANY($3))
      AND ($4::text IS NULL OR id <> $4)`, [scope.owner, ns, hashes, excluded ?? null]);
  return rows.map(row => readEntry(row, scope.owner));
}

/** @param {string} hash */
function hashForms(hash) {
  return [hash, hash.slice(7)];
}

/** @param {DuplicateQuery[]} queries @param {boolean} near */
function candidateHashes(queries, near) {
  if (near && queries.some(q => q.embedding?.length === 1536)) return null;
  return [...new Set(queries.flatMap(({ textHash, legacyHash }) =>
    legacyHash === undefined ? hashForms(textHash) : [...hashForms(textHash), ...hashForms(legacyHash)]))];
}

/** @param {ArrayLike<number> | null | undefined} a @param {ArrayLike<number> | null | undefined} b */
function distance(a, b) {
  if (!a || !b || a.length !== b.length) return undefined;
  let aa = 0;
  let bb = 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    // Compare prior items at the same precision as rows persisted by pgvector.
    const x = Math.fround(a[i]);
    const y = Math.fround(b[i]);
    aa += x * x;
    bb += y * y;
    dot += x * y;
  }
  if (!aa || !bb || !Number.isFinite(dot)) return undefined;
  return 1 - Math.max(-1, Math.min(1, dot / Math.sqrt(aa * bb)));
}

/** @param {DuplicateQuery} query @param {{textHash: string, historical?: boolean}} candidate
 * @param {ArrayLike<number> | null | undefined} embedding @param {boolean} near @param {number} threshold */
function quality(query, candidate, embedding, near, threshold) {
  const { textHash } = candidate;
  const exact = hashForms(query.textHash).includes(textHash) ||
    (query.legacyHash !== undefined && hashForms(query.legacyHash).includes(textHash));
  if (!exact && (!near || candidate.historical)) return null;
  const cosine = distance(query.embedding, embedding);
  if (exact) return { match: /** @type {const} */ ("exact"), distance: cosine ?? 0 };
  if (cosine !== undefined && cosine <= threshold) return { match: /** @type {const} */ ("near"), distance: cosine };
  return null;
}

/** @param {MemoryMatch} a @param {MemoryMatch} b */
function matchOrder(a, b) {
  if (a.match !== b.match) return a.match === "exact" ? -1 : 1;
  const byDistance = (a.distance ?? 0) - (b.distance ?? 0);
  if (byDistance) return byDistance;
  if (a.kind === "prior") return b.kind === "prior" ? b.batchIndex - a.batchIndex : -1;
  if (b.kind === "prior") return 1;
  if (a.writeTimeUs !== b.writeTimeUs) return a.writeTimeUs > b.writeTimeUs ? -1 : 1;
  return compareUtf8(b.id, a.id);
}

/** @param {MemoryEntry[]} entries @param {DuplicateQuery[]} batch @param {boolean} near @param {number} threshold */
function matches(entries, batch, near, threshold) {
  return batch.map((query, i) => {
    /** @type {MemoryMatch[]} */
    const result = [];
    for (const { memory } of entries) {
      const match = quality(query, memory, memory.embedding?.vector, near, threshold);
      if (match) result.push({ kind: "stored", ...match, id: memory.id, revision: memory.revision,
        writeTimeUs: memory.updatedAtUs });
    }
    for (let j = 0; j < i; j++) {
      const prior = batch[j];
      const match = quality(query, prior, prior.embedding, near, threshold);
      if (match) result.push({ kind: "prior", ...match, batchIndex: j });
    }
    return result.sort(matchOrder);
  });
}

/** @param {{nearDuplicate?: boolean}} [options] @returns {MemoryStore} */
export function createPostgresMemoryStore({ nearDuplicate = true } = {}) {
  return {
    async insert(tx, scope, row, receipts, nowMs) {
      guardOwner(tx, scope, true);
      const ns = namespaceKey(scope.namespace);
      const content = copyContent(row);
      const evidence = copyReceipts(receipts);
      const updatedAtUs = writeTime(nowMs);
      const suppliedTime = row.createdAtMs;
      const createdAtMs = suppliedTime === undefined ? nowMs : suppliedTime;
      if (!Number.isSafeInteger(createdAtMs) || createdAtMs > nowMs) invalid();
      const created = timestampParts(createdAtMs);

      return runOperation(tx, async (query) => {
        const owner = tx.owner;
        const id = crypto.randomUUID();
        const digests = await contentDigests(content);
        const [storedHash, logicalHash] = await storageHash(query, owner, id, content.textHash);
        await query(`INSERT INTO memories (user_id, id, core_namespace, text_hash, core_text_hash,
          created_at, core_created_at_ms, updated_at, ${CONTENT_COLUMNS})
          VALUES ($1, $2, $3, $4, $5, COALESCE(${timestampUs("$6")}, '-infinity'::timestamptz), $7,
            ${timestampUs("$8")}, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
        [owner, id, ns, storedHash, logicalHash, created.us, created.exact, updatedAtUs.toString(), ...contentValues(content, digests)]);
        await attachReceipts(query, owner, id, evidence);
        await advanceIndex(query, owner);
        return { id, revision: 1, createdAtMs, updatedAtMs: nowMs, updatedAtUs };
      });
    },

    async touchDuplicate(tx, scope, id, receipts, merge, nowMs) {
      guardOwner(tx, scope, true);
      const ns = namespaceKey(scope.namespace);
      const key = inputText(id);
      const incoming = copyReceipts(receipts);
      const values = copyMerge(merge);
      const us = writeTime(nowMs);
      return runOperation(tx, async (query) => {
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
        if (updated || attached) await advanceIndex(query, owner);
        return { outcome: changed ? "changed" : "touched", revision };
      });
    },

    async readRevision(tx, scope, id) {
      guardOwner(tx, scope);
      const ns = namespaceKey(scope.namespace);
      const key = inputText(id);
      return runOperation(tx, async (query) => {
        const { rows: [row] } = await query(`SELECT revision, ${TEXT_HASH} AS "textHash" FROM memories WHERE ${TARGET}`,
          [tx.owner, ns, key]);
        return row ?? null;
      });
    },

    async replaceContent(tx, scope, id, expectedRevision, next, receipts, nowMs) {
      guardOwner(tx, scope, true);
      const ns = namespaceKey(scope.namespace);
      const key = inputText(id);
      if (!Number.isInteger(expectedRevision)) invalid();
      const content = copyContent(next);
      const evidence = receipts === null ? null : copyReceipts(receipts);
      const us = writeTime(nowMs);
      return runOperation(tx, async (query) => {
        const owner = tx.owner;
        const values = [owner, ns, key];
        const entry = await selectMemory(query, owner, ns, key);
        if (!entry) throw new CoreError("memory_not_found");
        const { memory } = entry;
        if (memory.revision !== expectedRevision) throw new CoreError("revision_conflict");
        if (memory.historical) throw new CoreError("memory_historical");
        if (hashForms(content.textHash).includes(memory.textHash) || content.text === memory.text) {
          return { outcome: "unchanged", revision: memory.revision };
        }
        const collisions = await candidates(query, memory.scope, ns, hashForms(content.textHash), key);
        if (collisions.length) {
          const visibility = await readVisibility(query, owner);
          if ((await visibility.check(collisions)).some(row => !row.hidden)) throw new CoreError("memory_conflict");
        }

        const revision = memory.revision + 1;
        const digests = await contentDigests(content);
        const [storedHash, logicalHash] = await storageHash(query, owner, key, content.textHash);
        await query(`UPDATE memories SET text_hash = $4, core_text_hash = $5, revision = $6,
          updated_at = ${timestampUs("$7")}, (${CONTENT_COLUMNS}) = ($8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          WHERE ${TARGET}`, [...values, storedHash, logicalHash, revision, us.toString(), ...contentValues(content, digests)]);
        if (evidence !== null) {
          await query("DELETE FROM core_memory_receipts WHERE user_id = $1 AND memory_id = $2", [owner, key]);
          await attachReceipts(query, owner, key, evidence);
        }
        await advanceIndex(query, owner);
        return { outcome: "changed", revision };
      }, true);
    },

    async get(tx, scope, id) {
      guardOwner(tx, scope);
      const ns = namespaceKey(scope.namespace);
      const key = inputText(id);
      return runOperation(tx, async (query) => (await selectMemory(query, tx.owner, ns, key))?.memory ?? null);
    },

    async erase(tx, scope, id) {
      guardOwner(tx, scope, true);
      const ns = namespaceKey(scope.namespace);
      const key = inputText(id);
      return runOperation(tx, async (query) => {
        const owner = tx.owner;
        const deleted = await query(`DELETE FROM memories WHERE ${TARGET} RETURNING id`, [owner, ns, key]);
        if (!deleted.rows.length) return false;
        for (const table of ["core_memory_receipts", "memory_topics", "memory_placements"]) {
          await query(`DELETE FROM ${table} WHERE user_id = $1 AND memory_id = $2`, [owner, key]);
        }
        await query(`DELETE FROM memory_supersessions WHERE user_id = $1
          AND (previous_memory_id = $2 OR replacement_memory_id = $2)`, [owner, key]);
        await query(`DELETE FROM memory_conflicts WHERE user_id = $1
          AND (left_memory_id = $2 OR right_memory_id = $2)`, [owner, key]);
        await query(`UPDATE topic_title_sources SET memory_revision = 0
          WHERE user_id = $1 AND memory_id = $2 AND memory_revision <> 0`, [owner, key]);
        await advanceIndex(query, owner);
        return true;
      });
    },

    async findDuplicates(tx, scope, batch, options) {
      guardOwner(tx, scope);
      const { namespace } = scope;
      const selection = { owner: tx.owner, namespace };
      const ns = namespaceKey(namespace);
      const queries = copyQueries(batch);
      if (!options) invalid();
      const { nearDistance, excludeId } = options;
      if (!Number.isFinite(nearDistance) || nearDistance < 0) invalid();
      const excluded = excludeId === undefined ? undefined : inputText(excludeId);
      return runOperation(tx, async (query) => {
        const entries = await candidates(query, selection, ns, candidateHashes(queries, nearDuplicate), excluded);
        if (!entries.length) return matches([], queries, nearDuplicate, nearDistance);
        const visibility = await readVisibility(query, tx.owner);
        const visible = (await visibility.check(entries)).filter(entry => !entry.hidden);
        return matches(visible, queries, nearDuplicate, nearDistance);
      });
    },

    async readWritePolicy(tx, scope, batch, source, mode, editId) {
      guardOwner(tx, scope);
      const { namespace } = scope;
      const selection = { owner: tx.owner, namespace };
      const ns = namespaceKey(namespace);
      const queries = copyQueries(batch);
      const incoming = copySource(source);
      if (mode !== "hash" && mode !== "full") invalid();
      const excluded = editId === undefined ? undefined : inputText(editId);
      return runOperation(tx, async (query) => {
        const visibility = await readVisibility(query, tx.owner);
        const edit = excluded === undefined ? null : await selectMemory(query, tx.owner, ns, excluded);
        const sourceMemory = edit && { id: edit.memory.id, createdAtMs: edit.memory.createdAtMs };
        const blockedSession = visibility.blocksSession(selection, incoming);
        const blockedPositions = queries.flatMap((item, i) => visibility.blocks(selection, item, mode, sourceMemory) ? [i] : []);
        const entries = await candidates(query, selection, ns, candidateHashes(queries, nearDuplicate), excluded);
        const duplicates = matches(entries, queries, nearDuplicate, NEAR_DUPLICATE_DISTANCE);
        const matched = new Set(duplicates.flatMap(group => group.flatMap(match => match.kind === "stored" ? [match.id] : [])));
        const checked = await visibility.check(entries.filter(({ memory }) => matched.has(memory.id)));
        const hiddenIds = checked.filter(entry => entry.hidden).map(entry => entry.memory.id).sort(compareUtf8);
        return { matches: duplicates, blockedPositions, blockedSession, hiddenIds };
      });
    },

    async exportPage(tx, scope, page) {
      guardOwner(tx, scope);
      return memoryPage(tx, { owner: tx.owner, keys: [namespaceKey(scope.namespace)], clients: null, since: null, until: null, hasWindow: false },
        page, true);
    },
  };
}
