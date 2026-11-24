import {
  CoreError, ERROR_CODES, coalesceNewTopics, compareUtf8, isErrorCode, memoryGuards, placementProposal, titleKey,
} from "../../core/src/index.mjs";
import { decodeCursor, encodeCursor } from "../../core/src/retrieval/hosted-paging.mjs";
import { readCandidate, timestampUs } from "./memory-rows.mjs";
import { readVisibility } from "./memory-visibility.mjs";
import { requireLiveRun, runOperation } from "./uow.mjs";

/** @import { PlacementProposal } from "../../core/src/index.mjs" */
/** @import { Scope, Topic, TopicStore, Tx } from "../../core/src/ports/index.d.ts" */
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
const newestFirst = `placed_at DESC, memory_id COLLATE "C" DESC`;

/** @typedef {Awaited<ReturnType<typeof readVisibility>>} Visibility */
/** @import {FactMatchPolicy} from "../../core/src/index.mjs" */

/** @param {Visibility} visibility @param {string} owner @param {any[]} rows */
async function visibleRows(visibility, owner, rows) {
  const checked = await visibility.check(rows.map((row) => readCandidate(row, owner)));
  return rows.filter((_, index) => !checked[index].hidden);
}

/**
 * Refill by the last SQL candidate, including when an entire batch was hidden.
 * Public member offsets count only visible rows.
 * @param {Visibility} visibility @param {string} owner
 * @param {(after: any, size: number) => Promise<{rows: any[]}>} load
 * @param {number} [limit] @param {number} [skip]
 */
async function visiblePage(visibility, owner, load, limit = Infinity, skip = 0) {
  const items = [];
  let after = null;
  while (items.length < limit) {
    const size = Math.min(128, Math.max(16, skip + limit - items.length));
    const { rows } = await load(after, size);
    const visible = await visibleRows(visibility, owner, rows);
    items.push(...visible.slice(skip, skip + limit - items.length));
    skip = Math.max(0, skip - visible.length);
    if (rows.length < size) break;
    after = rows.at(-1);
  }
  return items;
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

/** @param {Query} query @param {string} owner */
async function readIndexRevision(query, owner) {
  // Hosted topic changes and core memory/fact changes both invalidate a page.
  const { rows: [row] } = await query(`
    SELECT (COALESCE((SELECT revision FROM topic_index_state WHERE user_id = $1), 0) +
      COALESCE((SELECT index_revision FROM core_owner_state WHERE user_id = $1), 0))::text AS revision`, [owner]);
  const revision = Number(row.revision);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new CoreError("internal_error");
  return revision;
}

/** @param {Query} query @param {string} owner */
async function advanceTopicIndex(query, owner) {
  await query(`
    INSERT INTO topic_index_state (user_id, revision) VALUES ($1, 1)
    ON CONFLICT (user_id) DO UPDATE SET revision = topic_index_state.revision + 1`, [owner]);
}

/**
 * @param {Query} query @param {string} owner @param {string} view @param {string | null} filter
 * @param {number} limit @param {string | null} cursor
 */
async function readPage(query, owner, view, filter, limit, cursor) {
  const indexRevision = await readIndexRevision(query, owner);
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

// Document cards are a separate capability. Keep the memory port's own methods
// while satisfying the card hooks that core-next added to TopicStore.
class WithoutDocumentCards {
  /** @param {Tx} tx @param {Scope} scope */
  async pendingCards(tx, scope) {
    personalOwner(tx, scope);
    return [];
  }

  /** @param {Tx} tx @param {Scope} scope @returns {Promise<never>} */
  async applyCardPlacement(tx, scope) {
    personalOwner(tx, scope, true);
    throw new CoreError("capability_unavailable");
  }

  /** @param {Tx} tx @param {Scope} scope */
  async markCardsFailed(tx, scope) {
    personalOwner(tx, scope, true);
    throw new CoreError("capability_unavailable");
  }

  /** @param {Tx} tx @param {Scope} scope */
  async forCard(tx, scope) {
    personalOwner(tx, scope);
    return [];
  }

  /** @param {Tx} tx @param {Scope} scope */
  async dropCard(tx, scope) {
    personalOwner(tx, scope, true);
    return { dropped: 0 };
  }
}

/**
 * @param {{now?: () => number, topicRetryAfterMs?: number, topicMaxAttempts?: number, hashSessionKey?: FactMatchPolicy["hashSessionKey"]}} [options]
 * @returns {Placement}
 */
export function createPostgresTopicStore({ now = Date.now, topicRetryAfterMs = 3_600_000, topicMaxAttempts = 3, hashSessionKey } = {}) {
  validateLimit(topicMaxAttempts, 3);
  if (!Number.isSafeInteger(topicRetryAfterMs) || topicRetryAfterMs < 0) throw new CoreError("invalid_input");

  /** @type {MemoryPlacement} */
  const placement = {
    async pending(tx, scope, options) {
      const owner = personalOwner(tx, scope);
      const { limit } = options;
      validateLimit(limit, BATCH_LIMIT);
      return runOperation(tx, async (query) => {
        const visibility = await readVisibility(query, owner, hashSessionKey);
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
      return runOperation(tx, async (query) => {
        const page = await readPage(query, owner, "catalog", null, limit, cursor);
        const visibility = await readVisibility(query, owner, hashSessionKey);
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

      return runOperation(tx, async (query) => {
        if (await readIndexRevision(query, owner) !== indexRevision) throw new CoreError("revision_conflict");
        const visibility = await readVisibility(query, owner, hashSessionKey);
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
        if (changed) await advanceTopicIndex(query, owner);
        return { placed, createdTopics };
      });
    },

    async markFailed(tx, scope, memoryIds, code) {
      const owner = personalOwner(tx, scope, true);
      if (!isErrorCode(code)) throw new CoreError("invalid_input");
      const ids = snapshotArray(memoryIds, undefined, false);
      if (ids.some((id) => typeof id !== "string" || !id)) throw new CoreError("invalid_input");
      return runOperation(tx, async (query) => {
        const visibility = await readVisibility(query, owner, hashSessionKey);
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
            status = CASE WHEN memory_placements.memory_revision = EXCLUDED.memory_revision
              THEN memory_placements.status ELSE 'failed' END`,
        [owner, visibleIds, code, new Date(now())]);
      });
    },

    async list(tx, scope, options) {
      const owner = personalOwner(tx, scope);
      const { level, cursor, limit } = options;
      validateLimit(limit);
      if (level !== undefined && level !== "L1" && level !== "L2") throw new CoreError("invalid_input");
      return runOperation(tx, async (query) => {
        const page = await readPage(query, owner, "list", level ?? null, limit, cursor);
        const visibility = await readVisibility(query, owner, hashSessionKey);
        const columns = visibility.candidateColumns([null]);
        const members = await visiblePage(visibility, owner, (after, size) => query(`
          SELECT ${columns} FROM memories m ${currentPlacementJoin}
          WHERE m.user_id = $1 AND ${currentMemory("m")} AND p.status = 'filed'
            AND ($2::text IS NULL OR m.id COLLATE "C" > $2)
            AND EXISTS (SELECT 1 FROM memory_topics mt WHERE mt.user_id = m.user_id
              AND mt.memory_id = m.id AND mt.memory_revision = m.revision)
          ORDER BY m.id COLLATE "C" LIMIT $3`, [owner, after?.id ?? null, size]));
        if (!members.length) return { items: [], nextCursor: null };
        const sources = await visibleTitleSources(query, owner, visibility);
        const { rows } = await query(`
          WITH direct AS (
            SELECT mt.topic_id, mt.memory_id, mt.placed_at FROM memory_topics mt
            ${currentMemberJoin}
            WHERE mt.user_id = $1 AND m.id = ANY($5::text[]) AND ${currentMemory("m")}
          ), effective AS (
            SELECT topic_id, memory_id, placed_at FROM direct WHERE $2::smallint IS DISTINCT FROM 2
            UNION ALL
            SELECT e.parent_id, d.memory_id, max(d.placed_at) FROM direct d
            JOIN topic_edges e ON e.user_id = $1 AND e.child_id = d.topic_id
            WHERE $2::smallint IS DISTINCT FROM 1 GROUP BY e.parent_id, d.memory_id
          ), ranked AS (
            SELECT topic_id, memory_id, row_number() OVER (
              PARTITION BY topic_id ORDER BY ${newestFirst}
            ) AS member_rank FROM effective
          ), summary AS (
            SELECT topic_id, count(*) AS member_count,
              array_agg(memory_id ORDER BY member_rank) FILTER (WHERE member_rank <= 3) AS newest_member_ids
            FROM ranked GROUP BY topic_id
          )
          SELECT * FROM (
            SELECT ${topicColumns("$6")}, s.member_count, s.newest_member_ids
            FROM summary s JOIN topics t ON t.user_id = $1 AND t.id = s.topic_id
            WHERE $2::smallint IS NULL OR t.level = $2
          ) listed ORDER BY ${topicOrder} LIMIT $3 OFFSET $4`,
        [owner, level === undefined ? null : level === "L1" ? 1 : 2, limit + 1, page.offset, members.map(({ id }) => id), sources]);
        const { items, nextCursor } = page.slice(rows);
        return { items: items.map((row) => ({
          ...toTopic(row), memberCount: Number(row.member_count), newestMemberIds: row.newest_member_ids,
        })), nextCursor };
      });
    },

    async members(tx, scope, topicId, options) {
      const owner = personalOwner(tx, scope);
      const { cursor, limit } = options;
      validateLimit(limit);
      return runOperation(tx, async (query) => {
        const page = await readPage(query, owner, "members", topicId, limit, cursor);
        if (!sqlText(topicId)) return { items: [], nextCursor: null };
        const visibility = await readVisibility(query, owner, hashSessionKey);
        const columns = visibility.candidateColumns([null]);
        const rows = await visiblePage(visibility, owner, (after, size) => query(`
          WITH child_topics AS (
            SELECT t.id FROM topics t WHERE t.user_id = $1 AND t.id = $2 AND t.level = 1
            UNION ALL
            SELECT e.child_id FROM topics t JOIN topic_edges e ON e.user_id = t.user_id AND e.parent_id = t.id
            WHERE t.user_id = $1 AND t.id = $2 AND t.level = 2
          ), current_members AS (
            SELECT mt.memory_id, max(mt.placed_at) AS placed_at
            FROM child_topics c JOIN memory_topics mt ON mt.topic_id = c.id ${currentMemberJoin}
            WHERE mt.user_id = $1 AND ${currentMemory("m")} GROUP BY mt.memory_id
          )
          SELECT ${columns}, memory_id, (extract(epoch FROM placed_at) * 1000000)::bigint::text AS placed_at_us
          FROM current_members c JOIN memories m ON m.user_id = $1 AND m.id = c.memory_id
          WHERE ($3::bigint IS NULL OR (c.placed_at, c.memory_id COLLATE "C") < (${timestampUs("$3")}, $4::text))
          ORDER BY ${newestFirst} LIMIT $5`,
        [owner, topicId, after?.placed_at_us ?? null, after?.memory_id ?? null, size]), limit + 1, page.offset);
        const { items, nextCursor } = page.slice(rows);
        return { items: items.map((row) => ({ kind: "memory", id: row.memory_id, placedAtUs: BigInt(row.placed_at_us) })), nextCursor };
      });
    },

    async forMemory(tx, scope, memoryId) {
      const owner = personalOwner(tx, scope);
      if (!sqlText(memoryId)) return [];
      return runOperation(tx, async (query) => {
        const visibility = await readVisibility(query, owner, hashSessionKey);
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
      return runOperation(tx, async (query) => {
        const visibility = await readVisibility(query, owner, hashSessionKey);
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
      return runOperation(tx, async (query) => {
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
        if (dropped || result.retired) await advanceTopicIndex(query, owner);
        return { dropped };
      });
    },
  };
  return Object.assign(new WithoutDocumentCards(), placement);
}
