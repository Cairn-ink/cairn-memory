import {
  CoreError, ERROR_CODES, coalesceNewTopics, compareUtf8, isErrorCode, memoryGuards, placementProposal, titleKey,
} from "../../core/src/index.mjs";
import { decodeCursor, encodeCursor } from "../../core/src/retrieval/hosted-paging.mjs";
import { LIVE_CARD, nonempty, PERSONAL_CARD } from "./document-card-rows.mjs";
import { createPostgresDocumentCardStore } from "./document-cards.mjs";
import { advanceIndex, readCandidate, timestampUs } from "./memory-rows.mjs";
import { readVisibility } from "./memory-visibility.mjs";
import { requireLiveRun, runOperation } from "./uow.mjs";

/** @import { PlacementProposal } from "../../core/src/index.mjs" */
/** @import { CardPlacementProposal, Scope, Topic, TopicStore, Tx } from "../../core/src/ports/index.d.ts" */
/** @import { DocumentCardOptions } from "./document-card-visibility.mjs" */
/** @import { Run } from "./uow.mjs" */
/** @typedef {import("./driver.mjs").Connection["query"]} Query */
/** @typedef {Pick<Required<TopicStore>, "pending" | "catalog" | "applyPlacement" | "markFailed" |
 * "list" | "members" | "forMemory" | "forMemories" | "dropMemory">} MemoryPlacement */
/** @typedef {TopicStore & MemoryPlacement} Placement */

const BATCH_LIMIT = 5;
const RETRYABLE_CODES = Object.keys(ERROR_CODES).filter((code) =>
  isErrorCode(code) && ERROR_CODES[code] === "retryable");

const currentPlacementJoin = `
  LEFT JOIN memory_placements p ON p.user_id = m.user_id AND p.memory_id = m.id
    AND p.memory_revision = m.revision`;
const currentMemberJoin = `JOIN memories m ON m.user_id = mt.user_id AND m.id = mt.memory_id
    AND m.revision = mt.memory_revision
  JOIN memory_placements p ON p.user_id = m.user_id AND p.memory_id = m.id
    AND p.memory_revision = m.revision AND p.status = 'filed'`;
const currentCardPlacementJoin = `LEFT JOIN card_placements p ON
  (p.user_id, p.card_id, p.content_hash) = (c.user_id, c.id, c.content_hash)`;
const currentCardMemberJoin = `JOIN card_placements p ON
  (p.user_id, p.card_id, p.content_hash) = (ct.user_id, ct.card_id, ct.content_hash) AND p.status = 'filed'
  JOIN document_cards c ON (c.user_id, c.id, c.content_hash) = (ct.user_id, ct.card_id, ct.content_hash)
    AND c.scope_id = c.user_id AND ${LIVE_CARD}`;

// Restrict SQL to current personal rows. Suppression is evaluated by MemoryStore's matcher.
/** @param {string} alias */
const currentMemory = (alias) => `${alias}.currentness = 'current' AND ${alias}.core_namespace IS NULL
  AND NOT EXISTS (SELECT 1 FROM memory_forget_log f WHERE f.user_id = ${alias}.user_id AND f.memory_id = ${alias}.id)`;

/** @param {string} visibleSources */
const visibleTopicTitle = (visibleSources) => `CASE WHEN EXISTS (
    SELECT 1 FROM topic_title_sources s WHERE s.user_id = t.user_id AND s.topic_id = t.id
  ) AND NOT EXISTS (
    SELECT 1 FROM topic_title_sources s
    LEFT JOIN memories source ON source.user_id = s.user_id AND source.id = s.memory_id
      AND source.revision = s.memory_revision AND ${currentMemory("source")} AND source.id = ANY(${visibleSources}::text[])
    WHERE s.user_id = t.user_id AND s.topic_id = t.id AND source.id IS NULL
  ) THEN t.title END`;
/** @param {string} visibleSources */
const topicColumns = (visibleSources) => `t.id, t.level, ${visibleTopicTitle(visibleSources)} AS title,
  ARRAY(SELECT e.parent_id FROM topic_edges e
    JOIN topics parent ON parent.user_id = e.user_id AND parent.id = e.parent_id AND parent.level = 2
    WHERE e.user_id = t.user_id AND e.child_id = t.id AND t.level = 1
    ORDER BY e.parent_id COLLATE "C") AS parent_ids`;
const topicOrder = `level, coalesce(title, '') COLLATE "C", id COLLATE "C"`;
const mixedNewestFirst = `placed_at DESC, member_id COLLATE "C" DESC, member_kind COLLATE "C" DESC`;

/** @typedef {Awaited<ReturnType<typeof readVisibility>>} Visibility */

/** @param {Visibility} visibility @param {string} owner @param {any[]} rows */
async function visibleRows(visibility, owner, rows) {
  const checked = await visibility.check(rows.map((row) => readCandidate(row, owner)));
  return rows.filter((_, index) => !checked[index].hidden);
}

/**
 * Refill by the last SQL candidate, including when an entire batch was hidden.
 * Public member offsets count only visible rows.
 * @param {(after: any, size: number) => Promise<{rows: any[]}>} load
 * @param {(rows: any[]) => Promise<any[]>} filter
 * @param {number} [limit] @param {number} [skip]
 */
async function filteredPage(load, filter, limit = Infinity, skip = 0) {
  const items = [];
  let after = null;
  while (items.length < limit) {
    const size = Math.min(128, Math.max(16, skip + limit - items.length));
    const { rows } = await load(after, size);
    const visible = await filter(rows);
    items.push(...visible.slice(skip, skip + limit - items.length));
    skip = Math.max(0, skip - visible.length);
    if (rows.length < size) break;
    after = rows.at(-1);
  }
  return items;
}

/** @param {Visibility} visibility @param {string} owner @param {Parameters<typeof filteredPage>[0]} load
 * @param {number} [limit] @param {number} [skip] */
function visiblePage(visibility, owner, load, limit, skip) {
  return filteredPage(load, rows => visibleRows(visibility, owner, rows), limit, skip);
}

/** @param {Query} query @param {string} owner @param {Visibility} visibility @param {string[] | null} [topicIds] */
async function visibleTitleSources(query, owner, visibility, topicIds = null) {
  const columns = visibility.candidateColumns([null]);
  const rows = await visiblePage(visibility, owner, (after, size) => query(`
    SELECT ${columns} FROM memories m
    WHERE m.user_id = $1 AND ${currentMemory("m")} AND ($2::text IS NULL OR m.id COLLATE "C" > $2)
      AND EXISTS (SELECT 1 FROM topic_title_sources s
        WHERE s.user_id = m.user_id AND s.memory_id = m.id AND s.memory_revision = m.revision
          AND ($3::text[] IS NULL OR s.topic_id = ANY($3)))
    ORDER BY m.id COLLATE "C" LIMIT $4`, [owner, after?.id ?? null, topicIds, size]));
  return rows.map(({ id }) => id);
}

/** @param {unknown} value @returns {value is string} */
function sqlText(value) {
  return typeof value === "string" && !value.includes("\0") && !/[\uD800-\uDFFF]/u.test(value);
}

/** @param {Tx} tx @param {Scope} scope @param {boolean} [write] */
function personalOwner(tx, scope, write) {
  const owner = scope?.owner;
  const namespace = scope?.namespace;
  if (namespace != null) throw new CoreError("capability_unavailable");
  requireLiveRun(tx, write);
  if (owner !== tx.owner) throw new CoreError("internal_error");
  if (namespace !== null) throw new CoreError("invalid_input");
  return owner;
}

/**
 * Snapshot dense arrays without calling custom iterators or element getters.
 * @template T @param {readonly T[]} values @param {number} [max] @param {boolean} [strict] @returns {T[]}
 */
function snapshotArray(values, max = 0xffff_ffff, strict = true) {
  try {
    if (!Array.isArray(values)) throw new CoreError("invalid_input");
    const length = Object.getOwnPropertyDescriptor(values, "length")?.value;
    const keys = new Set(Reflect.ownKeys(values));
    if (!strict) keys.delete(Symbol.iterator);
    if (!Number.isSafeInteger(length) || length < 0 || length > max || values.length !== length ||
        !keys.delete("length") || keys.size !== length) throw new CoreError("invalid_input");
    const copy = [];
    for (let i = 0; i < length; i++) {
      const field = Object.getOwnPropertyDescriptor(values, i);
      if (!keys.has(String(i)) || !(i in values) || !field || !Object.hasOwn(field, "value") ||
          (strict && !field.enumerable) || !Object.is(field.value, values[i])) throw new CoreError("invalid_input");
      copy.push(field.value);
    }
    return copy;
  } catch {
    throw new CoreError("invalid_input");
  }
}

/** @template T @param {T} value @param {string[]} allowed */
function placementFields(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some((key) => !allowed.includes(key))) throw new CoreError("invalid_input");
  return value;
}

/** @param {PlacementProposal} proposal */
function snapshotProposal(proposal) {
  const { items } = placementFields(proposal, ["items"]);
  return placementProposal({ items: snapshotArray(items, BATCH_LIMIT).map((item) => {
    const { memoryId, parentIds, newL1 } = placementFields(item, ["memoryId", "parentIds", "newL1"]);
    const parents = snapshotArray(parentIds, 3);
    if (newL1 === undefined) return { memoryId, parentIds: parents };
    const { title, parentL2Ids, newL2Title } = placementFields(newL1, ["title", "parentL2Ids", "newL2Title"]);
    return { memoryId, parentIds: parents, newL1: { title, parentL2Ids: snapshotArray(parentL2Ids, 3), newL2Title } };
  }) }, undefined, BATCH_LIMIT);
}

/** @param {number} limit @param {number} [max] */
function validateLimit(limit, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > max) throw new CoreError("invalid_input");
}

/** @param {Query} query @param {string} owner @param {Run} run */
async function readIndexRevision(query, owner, run) {
  // The owner lock keeps the hosted counter stable while this run uses its recorded core revision.
  const { rows: [row] } = await query(`
    SELECT (COALESCE((SELECT revision FROM topic_index_state WHERE user_id = $1), 0) +
      COALESCE($2::bigint, (SELECT index_revision FROM core_owner_state WHERE user_id = $1), 0))::text AS revision`,
    [owner, run.indexStart?.toString() ?? null]);
  const revision = Number(BigInt(row.revision));
  if (!Number.isSafeInteger(revision) || revision < 0) throw new CoreError("internal_error");
  return revision;
}

/**
 * @param {Query} query @param {string} owner @param {string} view @param {string | null} filter
 * @param {number} limit @param {string | null} cursor @param {Run} run
 */
async function readPage(query, owner, view, filter, limit, cursor, run) {
  const indexRevision = await readIndexRevision(query, owner, run);
  let offset = 0;
  if (cursor !== null) {
    const decoded = decodeCursor(cursor);
    if (!Array.isArray(decoded) || encodeCursor(decoded) !== cursor || decoded.length !== 6 ||
        decoded[0] !== view || decoded[1] !== owner || decoded[2] !== null || decoded[3] !== filter ||
        !Number.isSafeInteger(decoded[4]) || decoded[4] < 0 ||
        !Number.isSafeInteger(decoded[5]) || decoded[5] < 1) throw new CoreError("invalid_cursor");
    if (decoded[4] !== indexRevision) throw new CoreError("cursor_stale");
    offset = decoded[5];
  }
  return {
    indexRevision, offset,
    /** @template T @param {T[]} rows */
    slice(rows) {
      return {
        items: rows.slice(0, limit),
        nextCursor: rows.length <= limit ? null : encodeCursor([view, owner, null, filter, indexRevision, offset + limit]),
      };
    },
  };
}

/** @param {{id: string, level: 1 | 2, title: string | null, parent_ids: string[]}} row @returns {Topic} */
function toTopic(row) {
  return { id: row.id, level: row.level === 1 ? "L1" : "L2", title: row.title, parentIds: row.parent_ids };
}

/** @param {Query} query @param {string} owner @param {PlacementProposal["items"]} items */
async function checkReferences(query, owner, items) {
  const l1Ids = items.flatMap(({ parentIds }) => parentIds);
  const l2Ids = items.flatMap(({ newL1 }) => newL1?.parentL2Ids ?? []);
  if (!l1Ids.length && !l2Ids.length) return;
  const { rows } = await query(`
    SELECT id, level FROM topics WHERE user_id = $1 AND id = ANY($2::text[])`,
  [owner, [...l1Ids, ...l2Ids]]);
  const found = new Map(rows.map(({ id, level }) => [id, level]));
  for (const [ids, level] of /** @type {const} */ ([[l1Ids, 1], [l2Ids, 2]])) {
    for (const id of ids) {
      if (!found.has(id)) throw new CoreError("not_found");
      if (found.get(id) !== level) throw new CoreError("invalid_ref");
    }
  }
}

/**
 * @param {Query} query @param {string} owner @param {Topic & { title: string }} topic
 * @param {string[]} ids @param {number[]} revisions
 */
async function insertTopic(query, owner, topic, ids, revisions) {
  await query(`
    INSERT INTO topics (user_id, id, level, title, title_key) VALUES ($1, $2, $3, $4, $5)`,
  [owner, topic.id, topic.level === "L1" ? 1 : 2, topic.title, titleKey(topic.title)]);
  await query(`
    INSERT INTO topic_title_sources (user_id, topic_id, memory_id, memory_revision)
    SELECT $1, $2, memory_id, revision FROM unnest($3::text[], $4::integer[]) AS batch(memory_id, revision)`,
  [owner, topic.id, ids, revisions]);
  if (topic.parentIds.length) {
    await query(`
      INSERT INTO topic_edges (user_id, parent_id, child_id)
      SELECT $1, parent, $2 FROM unnest($3::text[]) AS edge(parent)`,
    [owner, topic.id, topic.parentIds]);
  }
}

/** @param {Topic["level"]} level @param {string} title @param {string[]} [parentIds] */
function newTopic(level, title, parentIds = []) {
  return { id: crypto.randomUUID(), level, title, parentIds };
}

/**
 * @param {Query} query @param {string} owner @param {string} id @param {number} revision
 * @param {string[]} topicIds @param {string[]} retained @param {() => Date} placementTime
 */
async function replaceMemberships(query, owner, id, revision, topicIds, retained, placementTime) {
  await query(`
    INSERT INTO memory_placements (user_id, memory_id, memory_revision, status) VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, memory_id) DO UPDATE SET memory_revision = EXCLUDED.memory_revision,
      status = EXCLUDED.status, code = NULL, attempts = 0, placed_at = EXCLUDED.placed_at`,
  [owner, id, revision, topicIds.length ? "filed" : "unfiled"]);
  await query(`DELETE FROM memory_topics WHERE user_id = $1 AND memory_id = $2
    AND (memory_revision <> $3 OR NOT (topic_id = ANY($4::text[])))`, [owner, id, revision, topicIds]);
  const added = topicIds.filter((topicId) => !retained.includes(topicId));
  if (added.length) {
    await query(`
      INSERT INTO memory_topics (user_id, memory_id, topic_id, memory_revision, placed_at)
      SELECT $1, $2, topic_id, $3, $5 FROM unnest($4::text[]) AS topic_id`,
    [owner, id, revision, added, placementTime()]);
  }
}

/** @param {Parameters<TopicStore["applyCardPlacement"]>[2]} basedOn @param {CardPlacementProposal} proposal */
function snapshotCardProposal(basedOn, proposal) {
  const indexRevision = basedOn?.indexRevision;
  if (!Number.isSafeInteger(indexRevision) || indexRevision < 0) throw new CoreError("invalid_input");
  const items = snapshotArray(placementFields(proposal, ["items"]).items, BATCH_LIMIT).map(item => {
    const { cardId, parentIds } = placementFields(item, ["cardId", "parentIds"]);
    const topicIds = snapshotArray(parentIds, 3).map(nonempty);
    if (new Set(topicIds).size !== topicIds.length) throw new CoreError("invalid_input");
    return { cardId: nonempty(cardId), topicIds };
  });
  const ids = new Set(items.map(({ cardId }) => cardId));
  if (!items.length || ids.size !== items.length) throw new CoreError("invalid_input");
  const hashes = new Map(snapshotArray(basedOn.cards, ids.size).map(guard => {
    const { cardId, contentHash } = placementFields(guard, ["cardId", "contentHash"]);
    if (!ids.delete(cardId)) throw new CoreError("invalid_input");
    return [cardId, nonempty(contentHash)];
  }));
  if (ids.size) throw new CoreError("invalid_input");
  return { indexRevision, items, hashes };
}

/**
 * @param {DocumentCardOptions & {now?: () => number, topicRetryAfterMs?: number, topicMaxAttempts?: number,
 * documentCards?: ReturnType<typeof createPostgresDocumentCardStore>}} [options]
 * @returns {Placement}
 */
export function createPostgresTopicStore({
  now = Date.now, topicRetryAfterMs = 3_600_000, topicMaxAttempts = 3, documentCards, ...cardOptions
} = {}) {
  validateLimit(topicMaxAttempts, 3);
  if (!Number.isSafeInteger(topicRetryAfterMs) || topicRetryAfterMs < 0) throw new CoreError("invalid_input");
  const { hashSessionKey } = cardOptions;
  const { readFileableCards } = documentCards ?? createPostgresDocumentCardStore(cardOptions);

  /** @param {Query} query @param {string} owner @param {any[]} rows @param {string} [idField] */
  async function visibleCardRows(query, owner, rows, idField = "id") {
    const hashes = await readFileableCards(query, owner, rows.map(row => row[idField]));
    return rows.filter(row => hashes.get(row[idField]) === row.content_hash);
  }

  return {
    async pending(tx, scope, options) {
      const owner = personalOwner(tx, scope);
      const { limit } = options;
      validateLimit(limit, BATCH_LIMIT);
      return runOperation(tx, async (query, run) => {
        const visibility = await readVisibility(query, owner, hashSessionKey, run.visibilityFacts);
        const columns = visibility.candidateColumns([null]);
        const cutoff = new Date(now() - topicRetryAfterMs);
        const rows = await visiblePage(visibility, owner, (after, size) => query(`
          SELECT ${columns}, m.created_at::text AS created_at_key
          FROM memories m ${currentPlacementJoin}
          WHERE m.user_id = $1 AND ${currentMemory("m")}
            AND (p.memory_id IS NULL OR (p.status = 'failed' AND p.code = ANY($2::text[])
              AND p.attempts < $3 AND p.placed_at <= $4))
            AND ($5::timestamptz IS NULL OR (m.created_at, m.id COLLATE "C") > ($5, $6::text))
          ORDER BY m.created_at, m.id COLLATE "C" LIMIT $7`,
        [owner, RETRYABLE_CODES, topicMaxAttempts, cutoff, after?.created_at_key ?? null, after?.id ?? null, size]), limit);
        return rows.map(({ id, revision }) => ({ memoryId: id, revision }));
      });
    },

    async catalog(tx, scope, options) {
      const owner = personalOwner(tx, scope);
      const { cursor, limit } = options;
      validateLimit(limit);
      return runOperation(tx, async (query, run) => {
        const page = await readPage(query, owner, "catalog", null, limit, cursor, run);
        const visibility = await readVisibility(query, owner, hashSessionKey, run.visibilityFacts);
        const sources = await visibleTitleSources(query, owner, visibility);
        const { rows } = await query(`
          SELECT * FROM (SELECT ${topicColumns("$2")} FROM topics t WHERE t.user_id = $1) catalog
          ORDER BY ${topicOrder} LIMIT $3 OFFSET $4`, [owner, sources, limit + 1, page.offset]);
        const { items, nextCursor } = page.slice(rows);
        return { items: items.map(toTopic), nextCursor, exhausted: nextCursor === null, indexRevision: page.indexRevision };
      });
    },

    async applyPlacement(tx, scope, basedOn, proposal) {
      const owner = personalOwner(tx, scope, true);
      const { items } = snapshotProposal(proposal);
      const indexRevision = basedOn?.indexRevision;
      if (!Number.isSafeInteger(indexRevision) || indexRevision < 0) throw new CoreError("invalid_input");
      const ids = items.map(({ memoryId }) => memoryId);
      const guards = memoryGuards(snapshotArray(basedOn.memoryRevisions, ids.length), ids);
      const revisions = new Map(guards.map(({ memoryId, revision }) => [memoryId, revision]));

      return runOperation(tx, async (query, run) => {
        if (await readIndexRevision(query, owner, run) !== indexRevision) throw new CoreError("revision_conflict");
        const visibility = await readVisibility(query, owner, hashSessionKey, run.visibilityFacts);
        const columns = visibility.candidateColumns([null]);
        const { rows: candidates } = await query(`
          SELECT ${columns}, p.status, ARRAY(
            SELECT mt.topic_id FROM memory_topics mt
            WHERE mt.user_id = m.user_id AND mt.memory_id = m.id AND mt.memory_revision = m.revision
          ) AS topic_ids
          FROM memories m ${currentPlacementJoin}
          WHERE m.user_id = $1 AND m.id = ANY($2::text[]) AND ${currentMemory("m")}
          ORDER BY m.id COLLATE "C" FOR UPDATE OF m`, [owner, ids]);
        const rows = await visibleRows(visibility, owner, candidates);
        if (rows.length !== ids.length || rows.some(({ id, revision }) => revisions.get(id) !== revision)) {
          throw new CoreError("revision_conflict");
        }

        await checkReferences(query, owner, items);
        const { newL1, newL2 } = coalesceNewTopics(items);
        if (newL1.size) {
          const { rows: conflicts } = await query(`
            SELECT 1 FROM topics WHERE user_id = $1 AND
              ((level = 1 AND title_key = ANY($2::text[])) OR (level = 2 AND title_key = ANY($3::text[])))
            LIMIT 1`, [owner, [...newL1.keys()], [...newL2.keys()]]);
          if (conflicts.length) throw new CoreError("moc_title_conflict");
        }

        const parents = new Map([...newL2].map(([key, { title }]) => [key, newTopic("L2", title)]));
        const children = new Map([...newL1].map(([key, plan]) => [key, newTopic("L1", plan.title, [
          ...plan.parentL2Ids, ...[...plan.newParentKeys].map((key) => /** @type {Topic} */ (parents.get(key)).id),
        ].sort(compareUtf8))]));
        const createdTopics = [...parents.values(), ...children.values()];
        for (const topic of createdTopics) {
          await insertTopic(query, owner, topic, [...revisions.keys()], [...revisions.values()]);
        }

        const placed = items.map(({ memoryId, parentIds, newL1 }) => ({
          memoryId, topicIds: newL1
            ? [...parentIds, /** @type {Topic} */ (children.get(titleKey(newL1.title))).id] : parentIds,
        }));
        const existing = new Map(rows.map((row) => [row.id, row]));
        let changed = createdTopics.length > 0;
        /** @type {Date | undefined} */
        let placedAt;
        for (const { memoryId, topicIds } of placed) {
          const before = existing.get(memoryId);
          const hasOutcome = before.status === "filed" || before.status === "unfiled";
          const retained = before.status === "filed" ? before.topic_ids : [];
          if (hasOutcome && retained.length === topicIds.length && topicIds.every((id) => retained.includes(id))) continue;
          if (retained.length || topicIds.length) changed = true;
          await replaceMemberships(query, owner, memoryId, before.revision, topicIds, retained, () => placedAt ??= new Date(now()));
        }
        if (changed) await advanceIndex(query, owner, run);
        return { placed, createdTopics };
      });
    },

    async markFailed(tx, scope, memoryIds, code) {
      const owner = personalOwner(tx, scope, true);
      if (!isErrorCode(code)) throw new CoreError("invalid_input");
      const ids = snapshotArray(memoryIds, undefined, false);
      if (ids.some((id) => typeof id !== "string" || !id)) throw new CoreError("invalid_input");
      return runOperation(tx, async (query, run) => {
        const visibility = await readVisibility(query, owner, hashSessionKey, run.visibilityFacts);
        const columns = visibility.candidateColumns([null]);
        const { rows } = await query(`SELECT ${columns} FROM memories m
          WHERE m.user_id = $1 AND m.id = ANY($2::text[]) AND ${currentMemory("m")}`, [owner, ids.filter(sqlText)]);
        const visibleIds = (await visibleRows(visibility, owner, rows)).map(({ id }) => id);
        await query(`
          INSERT INTO memory_placements (user_id, memory_id, memory_revision, status, code, attempts, placed_at)
          SELECT m.user_id, m.id, m.revision, 'failed', $3, 1, $4
          FROM memories m WHERE m.user_id = $1 AND m.id = ANY($2::text[])
          ON CONFLICT (user_id, memory_id) DO UPDATE SET
            memory_revision = EXCLUDED.memory_revision, code = EXCLUDED.code, placed_at = EXCLUDED.placed_at,
            attempts = CASE WHEN memory_placements.memory_revision = EXCLUDED.memory_revision
              THEN least(memory_placements.attempts + 1, 3) ELSE 1 END,
            status = EXCLUDED.status
          WHERE memory_placements.memory_revision <> EXCLUDED.memory_revision OR memory_placements.status = 'failed'`,
        [owner, visibleIds, code, new Date(now())]);
      });
    },

    async pendingCards(tx, scope, { limit }) {
      const owner = personalOwner(tx, scope);
      validateLimit(limit, BATCH_LIMIT);
      return runOperation(tx, async query => {
        const cutoff = new Date(now() - topicRetryAfterMs);
        const rows = await filteredPage((after, size) => query(`
          SELECT c.id, c.content_hash, c.created_at::text AS created_at_key
          FROM document_cards c ${currentCardPlacementJoin}
          WHERE ${PERSONAL_CARD} AND ${LIVE_CARD}
            AND (p.card_id IS NULL OR (p.status = 'failed' AND p.code = ANY($2::text[])
              AND p.attempts < $3 AND p.placed_at <= $4))
            AND ($5::timestamptz IS NULL OR (c.created_at, c.id COLLATE "C") > ($5, $6::text))
          ORDER BY c.created_at, c.id COLLATE "C" LIMIT $7`,
        [owner, RETRYABLE_CODES, topicMaxAttempts, cutoff, after?.created_at_key ?? null, after?.id ?? null, size]),
        rows => visibleCardRows(query, owner, rows), limit);
        return rows.map(({ id, content_hash }) => ({ cardId: id, contentHash: content_hash }));
      });
    },

    async applyCardPlacement(tx, scope, basedOn, proposal) {
      const owner = personalOwner(tx, scope, true);
      const { indexRevision, items, hashes } = snapshotCardProposal(basedOn, proposal);
      const ids = [...hashes.keys()];
      return runOperation(tx, async (query, run) => {
        if (await readIndexRevision(query, owner, run) !== indexRevision) throw new CoreError("revision_conflict");
        await query(`SELECT c.id FROM document_cards c WHERE ${PERSONAL_CARD} AND c.id = ANY($2::text[])
          ORDER BY c.id COLLATE "C" FOR UPDATE OF c`, [owner, ids]);
        const visible = await readFileableCards(query, owner, ids);
        if (ids.some(id => visible.get(id) !== hashes.get(id))) throw new CoreError("revision_conflict");
        const parents = [...new Set(items.flatMap(({ topicIds }) => topicIds))];
        if (parents.length) {
          const { rows } = await query(`SELECT id FROM topics WHERE user_id = $1 AND level = 1 AND id = ANY($2::text[])`,
            [owner, parents]);
          if (rows.length !== parents.length) throw new CoreError("revision_conflict");
        }

        const { rows } = await query(`
          SELECT p.card_id, p.content_hash, p.status, ARRAY(
            SELECT ct.topic_id FROM card_topics ct
            WHERE (ct.user_id, ct.card_id, ct.content_hash) = (p.user_id, p.card_id, p.content_hash)
          ) AS topic_ids
          FROM card_placements p WHERE p.user_id = $1 AND p.card_id = ANY($2::text[])`, [owner, ids]);
        const current = new Map(rows.map(row => [row.card_id, row]));
        let changed = false;
        /** @type {Date | undefined} */
        let placedAt;
        for (const { cardId, topicIds } of items) {
          const hash = hashes.get(cardId);
          const before = current.get(cardId);
          const status = topicIds.length ? "filed" : "unfiled";
          const retained = before?.content_hash === hash && before?.status === "filed" ? before.topic_ids : [];
          const added = topicIds.filter(id => !retained.includes(id));
          const removed = retained.some(/** @param {string} id */ id => !topicIds.includes(id));
          if (!added.length && !removed && before?.content_hash === hash && before?.status === status) continue;
          await query(`DELETE FROM card_topics WHERE user_id = $1 AND card_id = $2
            AND (content_hash <> $3 OR NOT (topic_id = ANY($4::text[])) OR NOT (topic_id = ANY($5::text[])))`,
          [owner, cardId, hash, topicIds, retained]);
          if (added.length) {
            await query(`INSERT INTO card_topics (user_id, card_id, content_hash, topic_id, placed_at)
              SELECT $1, $2, $3, topic_id, $5 FROM unnest($4::text[]) AS topic_id`,
            [owner, cardId, hash, added, placedAt ??= new Date(now())]);
          }
          await query(`INSERT INTO card_placements (user_id, card_id, content_hash, status) VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id, card_id) DO UPDATE SET content_hash = EXCLUDED.content_hash,
              status = EXCLUDED.status, code = NULL, attempts = 0, placed_at = EXCLUDED.placed_at`,
          [owner, cardId, hash, status]);
          changed ||= added.length > 0 || removed;
        }
        if (changed) await advanceIndex(query, owner, run);
        return { placed: items };
      });
    },

    async markCardsFailed(tx, scope, cardIds, code) {
      const owner = personalOwner(tx, scope, true);
      if (!isErrorCode(code)) throw new CoreError("invalid_input");
      const ids = snapshotArray(cardIds, undefined, false).map(nonempty);
      if (!ids.length) return;
      return runOperation(tx, async query => {
        await query(`INSERT INTO card_placements (user_id, card_id, content_hash, status, code, attempts, placed_at)
          SELECT c.user_id, c.id, c.content_hash, 'failed', $3, 1, $4 FROM document_cards c
          WHERE ${PERSONAL_CARD} AND ${LIVE_CARD} AND c.id = ANY($2::text[])
          ORDER BY c.id COLLATE "C" FOR UPDATE OF c
          ON CONFLICT (user_id, card_id) DO UPDATE SET content_hash = EXCLUDED.content_hash,
            status = EXCLUDED.status, code = EXCLUDED.code, placed_at = EXCLUDED.placed_at,
            attempts = CASE WHEN card_placements.content_hash = EXCLUDED.content_hash
              THEN least(card_placements.attempts + 1, 3) ELSE 1 END
          WHERE card_placements.content_hash <> EXCLUDED.content_hash OR card_placements.status = 'failed'`,
        [owner, ids, code, new Date(now())]);
      });
    },

    async forCard(tx, scope, cardId) {
      const owner = personalOwner(tx, scope);
      const id = nonempty(cardId);
      return runOperation(tx, async query => {
        const { rows } = await query(`
          SELECT ct.topic_id, ct.card_id AS id, ct.content_hash FROM card_topics ct ${currentCardMemberJoin}
          JOIN topics t ON t.user_id = ct.user_id AND t.id = ct.topic_id AND t.level = 1
          WHERE ct.user_id = $1 AND ct.card_id = $2 ORDER BY ct.topic_id COLLATE "C"`, [owner, id]);
        return (await visibleCardRows(query, owner, rows)).map(({ topic_id }) => topic_id);
      });
    },

    async dropCard(tx, scope, cardId) {
      const owner = personalOwner(tx, scope, true);
      const id = nonempty(cardId);
      return runOperation(tx, async (query, run) => {
        // Keep the outcome so removing a membership does not requeue the card.
        const { rows } = await query(`DELETE FROM card_topics ct USING document_cards c
          WHERE ${PERSONAL_CARD} AND c.id = $2 AND (ct.user_id, ct.card_id) = (c.user_id, c.id)
          RETURNING ct.topic_id`, [owner, id]);
        if (rows.length) await advanceIndex(query, owner, run);
        return { dropped: rows.length };
      });
    },

    async list(tx, scope, options) {
      const owner = personalOwner(tx, scope);
      const { level, cursor, limit } = options;
      validateLimit(limit);
      if (level !== undefined && level !== "L1" && level !== "L2") throw new CoreError("invalid_input");
      return runOperation(tx, async (query, run) => {
        const page = await readPage(query, owner, "list", level ?? null, limit, cursor, run);
        const visibility = await readVisibility(query, owner, hashSessionKey, run.visibilityFacts);
        const columns = visibility.candidateColumns([null]);
        const members = await visiblePage(visibility, owner, (after, size) => query(`
          SELECT ${columns} FROM memories m ${currentPlacementJoin}
          WHERE m.user_id = $1 AND ${currentMemory("m")} AND p.status = 'filed'
            AND ($2::text IS NULL OR m.id COLLATE "C" > $2)
            AND EXISTS (SELECT 1 FROM memory_topics mt WHERE mt.user_id = m.user_id
              AND mt.memory_id = m.id AND mt.memory_revision = m.revision)
          ORDER BY m.id COLLATE "C" LIMIT $3`, [owner, after?.id ?? null, size]));
        const cards = await filteredPage((after, size) => query(`
          SELECT c.id, c.content_hash FROM document_cards c
          WHERE ${PERSONAL_CARD} AND ${LIVE_CARD} AND ($2::text IS NULL OR c.id COLLATE "C" > $2)
            AND EXISTS (SELECT 1 FROM card_topics ct JOIN card_placements p ON
              (p.user_id, p.card_id, p.content_hash) = (ct.user_id, ct.card_id, ct.content_hash)
              WHERE (ct.user_id, ct.card_id, ct.content_hash) = (c.user_id, c.id, c.content_hash) AND p.status = 'filed')
          ORDER BY c.id COLLATE "C" LIMIT $3`, [owner, after?.id ?? null, size]),
        rows => visibleCardRows(query, owner, rows));
        if (!members.length && !cards.length) return { items: [], nextCursor: null };
        const sources = await visibleTitleSources(query, owner, visibility);
        const { rows } = await query(`
          WITH direct AS (
            SELECT mt.topic_id, mt.memory_id AS member_id, mt.placed_at, 'memory' AS member_kind FROM memory_topics mt
            ${currentMemberJoin}
            WHERE mt.user_id = $1 AND m.id = ANY($5::text[]) AND ${currentMemory("m")}
            UNION ALL
            SELECT ct.topic_id, ct.card_id, ct.placed_at, 'card' FROM card_topics ct ${currentCardMemberJoin}
            WHERE ct.user_id = $1 AND ct.card_id = ANY($7::text[])
          ), effective AS (
            SELECT topic_id, member_id, placed_at, member_kind FROM direct WHERE $2::smallint IS DISTINCT FROM 2
            UNION ALL
            SELECT e.parent_id, d.member_id, max(d.placed_at), d.member_kind FROM direct d
            JOIN topic_edges e ON e.user_id = $1 AND e.child_id = d.topic_id
            WHERE $2::smallint IS DISTINCT FROM 1 GROUP BY e.parent_id, d.member_id, d.member_kind
          ), ranked AS (
            SELECT topic_id, member_id, member_kind, row_number() OVER (
              PARTITION BY topic_id, member_kind ORDER BY ${mixedNewestFirst}
            ) AS member_rank FROM effective
          ), summary AS (
            SELECT topic_id, count(*) FILTER (WHERE member_kind = 'memory') AS member_count,
              count(*) FILTER (WHERE member_kind = 'card') AS card_count,
              COALESCE(array_agg(member_id ORDER BY member_rank) FILTER (WHERE member_kind = 'memory' AND member_rank <= 3),
                ARRAY[]::text[]) AS newest_member_ids
            FROM ranked GROUP BY topic_id
          )
          SELECT * FROM (
            SELECT ${topicColumns("$6")}, s.member_count, s.newest_member_ids, s.card_count
            FROM summary s JOIN topics t ON t.user_id = $1 AND t.id = s.topic_id
            WHERE $2::smallint IS NULL OR t.level = $2
          ) listed ORDER BY ${topicOrder} LIMIT $3 OFFSET $4`,
        [owner, level === undefined ? null : level === "L1" ? 1 : 2, limit + 1, page.offset,
          members.map(({ id }) => id), sources, cards.map(({ id }) => id)]);
        const { items, nextCursor } = page.slice(rows);
        return { items: items.map((row) => ({
          ...toTopic(row), memberCount: Number(row.member_count), newestMemberIds: row.newest_member_ids,
          cardCount: Number(row.card_count),
        })), nextCursor };
      });
    },

    async members(tx, scope, topicId, options) {
      const owner = personalOwner(tx, scope);
      const { cursor, limit } = options;
      validateLimit(limit);
      return runOperation(tx, async (query, run) => {
        const page = await readPage(query, owner, "members", topicId, limit, cursor, run);
        if (!sqlText(topicId)) return { items: [], nextCursor: null };
        const visibility = await readVisibility(query, owner, hashSessionKey, run.visibilityFacts);
        const columns = visibility.candidateColumns([null]);
        const rows = await filteredPage((after, size) => query(`
          WITH child_topics AS (
            SELECT t.id FROM topics t WHERE t.user_id = $1 AND t.id = $2 AND t.level = 1
            UNION ALL
            SELECT e.child_id FROM topics t JOIN topic_edges e ON e.user_id = t.user_id AND e.parent_id = t.id
            WHERE t.user_id = $1 AND t.id = $2 AND t.level = 2
          ), current_members AS (
            SELECT mt.memory_id AS member_id, max(mt.placed_at) AS placed_at, 'memory' AS member_kind, NULL::text AS content_hash
            FROM child_topics c JOIN memory_topics mt ON mt.topic_id = c.id ${currentMemberJoin}
            WHERE mt.user_id = $1 AND ${currentMemory("m")} GROUP BY mt.memory_id
            UNION ALL
            SELECT ct.card_id, max(ct.placed_at), 'card', ct.content_hash
            FROM child_topics child JOIN card_topics ct ON ct.topic_id = child.id ${currentCardMemberJoin}
            WHERE ct.user_id = $1 GROUP BY ct.card_id, ct.content_hash
          )
          SELECT ${columns}, c.member_id, c.member_kind, c.content_hash,
            (extract(epoch FROM placed_at) * 1000000)::bigint::text AS placed_at_us
          FROM current_members c LEFT JOIN memories m ON c.member_kind = 'memory' AND m.user_id = $1 AND m.id = c.member_id
          WHERE ($3::bigint IS NULL OR (c.placed_at, c.member_id COLLATE "C", c.member_kind COLLATE "C") <
            (${timestampUs("$3")}, $4::text, $5::text))
          ORDER BY ${mixedNewestFirst} LIMIT $6`,
        [owner, topicId, after?.placed_at_us ?? null, after?.member_id ?? null, after?.member_kind ?? null, size]), async rows => {
          const memories = await visibleRows(visibility, owner, rows.filter(row => row.member_kind === "memory"));
          const cards = await visibleCardRows(query, owner, rows.filter(row => row.member_kind === "card"), "member_id");
          const visible = new Set([...memories, ...cards]);
          return rows.filter(row => visible.has(row));
        }, limit + 1, page.offset);
        const { items, nextCursor } = page.slice(rows);
        return { items: items.map(row => ({ kind: row.member_kind, id: row.member_id, placedAtUs: BigInt(row.placed_at_us) })), nextCursor };
      });
    },

    async forMemory(tx, scope, memoryId) {
      const owner = personalOwner(tx, scope);
      if (!sqlText(memoryId)) return [];
      return runOperation(tx, async (query, run) => {
        const visibility = await readVisibility(query, owner, hashSessionKey, run.visibilityFacts);
        const columns = visibility.candidateColumns([null]);
        const { rows } = await query(`
          SELECT ${columns}, ARRAY(
            SELECT mt.topic_id FROM memory_topics mt JOIN topics t ON t.user_id = mt.user_id AND t.id = mt.topic_id
            WHERE mt.user_id = m.user_id AND mt.memory_id = m.id AND mt.memory_revision = m.revision
            ORDER BY mt.topic_id COLLATE "C"
          ) AS topic_ids FROM memories m ${currentPlacementJoin}
          WHERE m.user_id = $1 AND m.id = $2 AND p.status = 'filed' AND ${currentMemory("m")}`, [owner, memoryId]);
        const [row] = await visibleRows(visibility, owner, rows);
        return row?.topic_ids ?? [];
      });
    },

    async forMemories(tx, scope, memoryIds) {
      const owner = personalOwner(tx, scope);
      const ids = snapshotArray(memoryIds, 100);
      validateLimit(ids.length);
      if (ids.some((id) => typeof id !== "string")) throw new CoreError("invalid_input");
      return runOperation(tx, async (query, run) => {
        const visibility = await readVisibility(query, owner, hashSessionKey, run.visibilityFacts);
        const columns = visibility.candidateColumns([null]);
        const { rows } = await query(`
          WITH requested AS (
            SELECT memory_id, min(position) AS position
            FROM unnest($2::text[]) WITH ORDINALITY AS input(memory_id, position) GROUP BY memory_id
          )
          SELECT ${columns}, ARRAY(
            SELECT t.id FROM memory_topics mt JOIN topics t ON t.user_id = mt.user_id AND t.id = mt.topic_id
            WHERE mt.user_id = m.user_id AND t.level = 1 AND mt.memory_id = m.id AND mt.memory_revision = p.memory_revision
              AND p.status = 'filed'
            ORDER BY t.id COLLATE "C"
          ) AS topic_ids
          FROM requested r JOIN memories m ON m.id = r.memory_id ${currentPlacementJoin}
          WHERE m.user_id = $1 AND ${currentMemory("m")} AND p.status IN ('filed', 'unfiled')
          ORDER BY r.position`, [owner, ids.filter(sqlText)]);
        const visible = await visibleRows(visibility, owner, rows);
        const topicIds = [...new Set(visible.flatMap(({ topic_ids }) => topic_ids))];
        const titles = new Map();
        if (topicIds.length) {
          const sources = await visibleTitleSources(query, owner, visibility, topicIds);
          const { rows: topics } = await query(`
            SELECT t.id, ${visibleTopicTitle("$3")} AS title FROM topics t
            WHERE t.user_id = $1 AND t.id = ANY($2::text[])`, [owner, topicIds, sources]);
          for (const { id, title } of topics) titles.set(id, title);
        }
        return visible.map(({ id, topic_ids }) => ({
          memoryId: id,
          topics: topic_ids.map((/** @type {string} */ id) => ({ id, title: titles.get(id) ?? null })),
        }));
      });
    },

    async dropMemory(tx, scope, memoryId) {
      const owner = personalOwner(tx, scope, true);
      if (!sqlText(memoryId)) return { dropped: 0 };
      return runOperation(tx, async (query, run) => {
        // A drop keeps the outcome. Memory erase owns removal of outcomes and
        // retires the same sources as part of its owner index advance.
        const { rows: [result] } = await query(`
          WITH refs AS (
            DELETE FROM memory_topics
            WHERE user_id = $1 AND memory_id = $2 RETURNING 1
          ), sources AS (
            UPDATE topic_title_sources SET memory_revision = 0
            WHERE user_id = $1 AND memory_id = $2 AND memory_revision <> 0 RETURNING 1
          )
          SELECT (SELECT count(*) FROM refs) AS dropped, EXISTS (SELECT 1 FROM sources) AS retired`,
        [owner, memoryId]);
        const dropped = Number(result.dropped);
        if (dropped || result.retired) await advanceIndex(query, owner, run);
        return { dropped };
      });
    },
  };
}
