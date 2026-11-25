import { randomUUID } from "node:crypto";
import { coalesceNewTopics, compareCatalogTopics, compareSortKey, compareUtf8, CoreError, ERROR_CODES, isErrorCode, titleKey } from "@cairn-ink/core";
import { decodeJson } from "./memory-rows.mjs";
import { placementArray, placementBatchLimit, placementInput, topicPage, validateLimit } from "./placement-input.mjs";
import { exactScope, placementPort } from "./placement-visibility.mjs";
import { invalidInput, scopeKey, sha256, writeTime } from "./storage-values.mjs";

/** @import { Scope, Topic, TopicStore } from "@cairn-ink/core/ports" */
/** @import { Connection, Port } from "./storage-values.mjs" */
/** @import { PlacementVisibility, ScopedVisibility } from "./placement-visibility.mjs" */
/** @typedef {ReturnType<typeof import("./index-revisions.mjs").createIndexRevisions>} IndexRevisions */
/** @typedef {{ topicRetryAfterMs?: number, topicMaxAttempts?: number }} TopicOptions */
/** @typedef {{ id: string, placedAtUs: bigint }} Member */

const write = { write: true };

/** @param {ScopedVisibility} visible @param {string} id */
function current(visible, id) {
  const row = visible(id);
  return row?.historical ? undefined : row;
}

/** @param {Connection} db @param {Scope} scope @param {ScopedVisibility} visible */
export function topicMembershipReader(db, scope, visible) {
  const keys = scopeKey(scope);
  const outcome = db.prepare(`SELECT revision FROM cairn_topic_outcomes WHERE ${exactScope} AND memory_id = ?`);
  const topics = db.prepare(`SELECT topic_id FROM cairn_topic_memberships
    WHERE ${exactScope} AND memory_id = ? ORDER BY topic_id`);
  return (/** @type {string} */ id) => {
    const row = current(visible, id);
    if (!row || outcome.get(...keys, id)?.revision !== row.revision) return null;
    return topics.all(...keys, id).map(({ topic_id }) => String(topic_id));
  };
}

/** @param {Connection} db @param {Scope} scope @param {ScopedVisibility} visible @param {string[]} ids */
export function inspectTopics(db, scope, visible, ids) {
  if (!ids.length) return [];
  const keys = scopeKey(scope);
  const topics = new Map(catalogTopics(db, scope, visible).map(topic => [topic.id, topic]));
  return db.prepare(`SELECT id, revision FROM cairn_topics WHERE ${exactScope}
    AND id IN (SELECT value FROM json_each(?)) ORDER BY wire_order, id`).all(...keys, JSON.stringify(ids))
    .map(({ id, revision }) => ({ id: String(id), mocRevision: Number(revision),
      title: topics.get(String(id))?.title ?? null }));
}

/** @param {Connection} db @param {Scope} scope @param {ScopedVisibility} visible */
function catalogTopics(db, scope, visible) {
  const keys = scopeKey(scope);
  const hidden = new Set(db.prepare(`SELECT topic_id, memory_id, revision FROM cairn_topic_sources WHERE ${exactScope}`)
    .all(...keys).filter(({ memory_id, revision }) => current(visible, String(memory_id))?.revision !== revision)
    .map(({ topic_id }) => topic_id));
  /** @type {Topic[]} */
  const topics = db.prepare(`SELECT id, level, title, parent_ids FROM cairn_topics WHERE ${exactScope}`)
    .all(...keys).map(({ id, level, title, parent_ids }) => ({
      id: String(id), level: level === "L1" ? "L1" : "L2",
      title: hidden.has(id) || title === null ? null : String(title), parentIds: decodeJson(parent_ids),
    }));
  return topics;
}

/** @param {Connection} db @param {Scope} scope @param {ScopedVisibility} visible */
function membersByTopic(db, scope, visible) {
  /** @type {Map<string, Member[]>} */
  const groups = new Map();
  const rows = db.prepare(`SELECT topic_id, memory_id, CAST(placed_at_us AS TEXT) AS time, revision
    FROM cairn_topic_memberships JOIN cairn_topic_outcomes USING (owner_id, namespace_key, memory_id)
    WHERE ${exactScope} ORDER BY placed_at_us DESC, memory_id DESC`).iterate(...scopeKey(scope));
  for (const { topic_id, memory_id, time, revision } of rows) {
    const id = String(memory_id);
    if (current(visible, id)?.revision !== revision) continue;
    const topic = String(topic_id);
    const member = { id, placedAtUs: BigInt(String(time)) };
    const group = groups.get(topic);
    if (group) group.push(member);
    else groups.set(topic, [member]);
  }
  return groups;
}

/** @param {Topic} topic @param {Topic[]} catalog @param {Map<string, Member[]>} groups */
function topicMembers(topic, catalog, groups) {
  if (topic.level === "L1") return groups.get(topic.id) ?? [];
  /** @type {Map<string, Member>} */
  const distinct = new Map();
  for (const { id, parentIds } of catalog) {
    if (!parentIds.includes(topic.id)) continue;
    for (const member of groups.get(id) ?? []) {
      const prior = distinct.get(member.id);
      if (!prior || member.placedAtUs > prior.placedAtUs) distinct.set(member.id, member);
    }
  }
  return [...distinct.values()].sort((a, b) => compareSortKey(b.placedAtUs, a.placedAtUs) || compareUtf8(b.id, a.id));
}

/** @param {Connection} db @param {Scope} scope @param {string} id */
function retireSource(db, scope, id) {
  const keys = scopeKey(scope);
  db.prepare(`UPDATE cairn_topics SET revision = revision + 1,
    title = CASE WHEN id IN (
      SELECT topic_id FROM cairn_topic_sources WHERE ${exactScope} AND memory_id = ?
    ) THEN NULL ELSE title END
    WHERE ${exactScope} AND id IN (
      SELECT topic_id FROM cairn_topic_sources WHERE ${exactScope} AND memory_id = ? AND revision != 0
      UNION
      SELECT topic_id FROM cairn_topic_memberships WHERE ${exactScope} AND memory_id = ?
    )`).run(...keys, id, ...keys, ...keys, id, ...keys, id);
  return db.prepare(`UPDATE cairn_topic_sources SET revision = 0
    WHERE ${exactScope} AND memory_id = ? AND revision != 0`).run(...keys, id).changes;
}

/** @param {Port} port @param {IndexRevisions} index @param {PlacementVisibility} visibility
 * @param {() => number} now @param {TopicOptions} options @param {boolean} legacyFiling @returns {TopicStore}
 */
export function createTopicStore(port, index, visibility, now, { topicRetryAfterMs = 3_600_000, topicMaxAttempts = 3 }, legacyFiling) {
  const access = placementPort(port);
  return {
    pending(tx, callerScope, { limit }) {
      return access(tx, callerScope, {}, (db, scope) => {
        validateLimit(limit, placementBatchLimit);
        const keys = scopeKey(scope);
        const visible = visibility(db, scope);
        const failures = db.prepare(`SELECT revision, code, attempts, failed_at_ms FROM cairn_topic_failures
          WHERE ${exactScope} AND memory_id = ?`);
        const pending = db.prepare(`SELECT m.id, m.revision FROM cairn_memories m
          WHERE m.owner_id = ? AND m.namespace_key = ? AND m.deleted = 0 AND m.historical = 0 AND NOT EXISTS (
            SELECT 1 FROM cairn_topic_outcomes o WHERE o.owner_id = m.owner_id AND o.namespace_key = m.namespace_key
              AND o.memory_id = m.id AND o.revision = m.revision
          ) ORDER BY m.created_at_ms, m.id`).iterate(...keys);
        const result = [];
        let nowMs;
        for (const { id, revision } of pending) {
          const memoryId = String(id);
          if (!visible(memoryId)) continue;
          const failure = failures.get(...keys, memoryId);
          if (failure?.revision === revision && (!isErrorCode(failure.code) || ERROR_CODES[failure.code] !== "retryable" ||
              Number(failure.attempts) >= topicMaxAttempts || (nowMs ??= now()) - Number(failure.failed_at_ms) < topicRetryAfterMs)) continue;
          result.push({ memoryId, revision: Number(revision) });
          if (result.length === limit) break;
        }
        return result;
      });
    },

    catalog(tx, callerScope, query) {
      return access(tx, callerScope, {}, (db, scope) => {
        const indexRevision = index.start(db, tx);
        const topics = catalogTopics(db, scope, visibility(db, scope)).sort(compareCatalogTopics);
        const result = topicPage(topics, query, scope, "catalog", null, indexRevision);
        return { ...result, exhausted: result.nextCursor === null, indexRevision };
      });
    },

    applyPlacement(tx, callerScope, basedOn, proposal) {
      return access(tx, callerScope, write, (db, scope) => {
        const { guards, items, indexRevision } = placementInput(basedOn, proposal);
        const keys = scopeKey(scope);
        const visible = visibility(db, scope);
        if (indexRevision !== index.start(db, tx) ||
            guards.some(({ memoryId, revision }) => current(visible, memoryId)?.revision !== revision)) {
          throw new CoreError("revision_conflict");
        }

        const findParent = db.prepare(`SELECT level FROM cairn_topics WHERE ${exactScope} AND id = ?`);
        const findTitle = db.prepare(`SELECT 1 FROM cairn_topics WHERE ${exactScope} AND level = ? AND title_hash = ?`);
        /** @param {string} id @param {Topic["level"]} level */
        function assertParent(id, level) {
          const row = findParent.get(...keys, id);
          if (!row) throw new CoreError("not_found");
          if (row.level !== level) throw new CoreError("invalid_ref");
        }
        for (const { parentIds, newL1 } of items) {
          for (const id of parentIds) assertParent(id, "L1");
          for (const id of newL1?.parentL2Ids ?? []) assertParent(id, "L2");
        }
        const { newL1, newL2 } = coalesceNewTopics(items);
        const addTopic = db.prepare("INSERT INTO cairn_topics VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)");
        const ordered = db.prepare(`SELECT title, wire_order FROM cairn_topics WHERE ${exactScope} ORDER BY wire_order`);
        const shift = db.prepare(`UPDATE cairn_topics SET wire_order = wire_order + 1 WHERE ${exactScope} AND wire_order >= ?`);
        const affected = new Set();
        const created = new Set();
        const retiredTitles = new Set();
        const outcome = db.prepare(`SELECT revision FROM cairn_topic_outcomes WHERE ${exactScope} AND memory_id = ?`);
        const memberships = db.prepare(`SELECT topic_id, CAST(placed_at_us AS TEXT) AS time FROM cairn_topic_memberships
          WHERE ${exactScope} AND memory_id = ?`);
        const sources = db.prepare(`SELECT topic_id FROM cairn_topic_sources WHERE ${exactScope} AND memory_id = ?`);
        const retireSources = db.prepare(`UPDATE cairn_topic_sources SET revision = 0
          WHERE ${exactScope} AND memory_id = ? AND revision = ?`);
        const plans = new Map(items.map(({ memoryId, parentIds, newL1 }) => {
          const revision = /** @type {NonNullable<ReturnType<ScopedVisibility>>} */ (visible(memoryId)).revision;
          const sameRevision = outcome.get(...keys, memoryId)?.revision === revision;
          const previous = new Map(sameRevision ? memberships.all(...keys, memoryId)
            .map(({ topic_id, time }) => [String(topic_id), BigInt(String(time))]) : []);
          const filingChanged = legacyFiling && (previous.size > 0) !== (parentIds.length > 0 || !!newL1);
          if (filingChanged) {
            for (const { topic_id } of sources.all(...keys, memoryId)) {
              const id = String(topic_id);
              retiredTitles.add(id);
              affected.add(id);
            }
            // This placement owns the single topic advance. Retire the old bindings
            // before writing the Memory revision so its trigger cannot count them again.
            retireSources.run(...keys, memoryId, revision);
          }
          return [memoryId, { revision: revision + Number(filingChanged), sameRevision, previous, filingChanged }];
        }));
        const addSource = db.prepare("INSERT INTO cairn_topic_sources VALUES (?, ?, ?, ?, ?)");
        /** @param {Topic["level"]} level @param {string} title @param {string[]} parentIds @returns {Topic} */
        function create(level, title, parentIds) {
          const titleHash = sha256(titleKey(title));
          if (findTitle.get(...keys, level, titleHash)) throw new CoreError("moc_title_conflict");
          const id = randomUUID();
          const canonical = titleKey(title);
          const rows = ordered.all(...keys);
          const following = rows.find(row => typeof row.title === "string" && compareUtf8(titleKey(row.title), canonical) > 0);
          const order = following?.wire_order ?? Number(rows.at(-1)?.wire_order ?? 0) + 1;
          shift.run(...keys, order);
          addTopic.run(...keys, id, level, title, titleHash, order, JSON.stringify(parentIds));
          created.add(id);
          for (const parentId of parentIds) affected.add(parentId);
          for (const guard of guards) addSource.run(...keys, id, guard.memoryId, plans.get(guard.memoryId)?.revision ?? guard.revision);
          return { id, level, title, parentIds };
        }
        const l2s = new Map([...newL2].map(([key, plan]) => [key, create("L2", plan.title, [])]));
        const l1s = new Map([...newL1].map(([key, plan]) => [key, create("L1", plan.title, [
          ...plan.parentL2Ids, ...[...plan.newParentKeys].map(parent => /** @type {Topic} */ (l2s.get(parent)).id),
        ])]));
        const createdTopics = [...l2s.values(), ...l1s.values()];
        const placed = items.map(({ memoryId, parentIds, newL1 }) => ({
          memoryId, topicIds: newL1 ? [...parentIds, /** @type {Topic} */ (l1s.get(titleKey(newL1.title))).id] : parentIds,
        }));

        const putOutcome = db.prepare(`INSERT INTO cairn_topic_outcomes VALUES (?, ?, ?, ?)
          ON CONFLICT (owner_id, namespace_key, memory_id) DO UPDATE SET revision = excluded.revision`);
        const remove = db.prepare(`DELETE FROM cairn_topic_memberships WHERE ${exactScope} AND memory_id = ?`);
        const add = db.prepare("INSERT INTO cairn_topic_memberships VALUES (?, ?, ?, ?, ?)");
        const advanceMemory = db.prepare(`UPDATE cairn_memories SET revision = ?, updated_at_us = ?
          WHERE ${exactScope} AND id = ?`);
        const invalidateConflicts = db.prepare(`DELETE FROM cairn_conflicts
          WHERE ${exactScope} AND (left_id = ? OR right_id = ?)`);
        let changed = createdTopics.length > 0;
        let placedAtUs;
        for (const { memoryId, topicIds } of placed) {
          const { revision, sameRevision, previous, filingChanged } =
            /** @type {NonNullable<ReturnType<typeof plans.get>>} */ (plans.get(memoryId));
          if (sameRevision && previous.size === topicIds.length && topicIds.every(id => previous.has(id))) continue;
          putOutcome.run(...keys, memoryId, revision);
          remove.run(...keys, memoryId);
          for (const id of topicIds) {
            add.run(...keys, memoryId, id, previous.get(id) ?? (placedAtUs ??= writeTime(now()).updatedAtUs));
          }
          for (const id of previous.keys()) if (!topicIds.includes(id)) affected.add(id);
          for (const id of topicIds) if (!previous.has(id)) affected.add(id);
          if (filingChanged) {
            advanceMemory.run(revision, placedAtUs ??= writeTime(now()).updatedAtUs, ...keys, memoryId);
            invalidateConflicts.run(...keys, memoryId, memoryId);
          }
          if (topicIds.length || previous.size) changed = true;
        }
        const bump = db.prepare(`UPDATE cairn_topics SET revision = revision + 1, title = CASE WHEN ? THEN NULL ELSE title END
          WHERE ${exactScope} AND id = ?`);
        for (const id of affected) if (!created.has(id)) bump.run(Number(retiredTitles.has(id)), ...keys, id);
        if (changed) index.markDirty(db, tx);
        return { placed, createdTopics };
      });
    },

    markFailed(tx, callerScope, memoryIds, code) {
      return access(tx, callerScope, write, (db, scope) => {
        if (!isErrorCode(code)) invalidInput();
        const ids = placementArray(memoryIds, Number.MAX_SAFE_INTEGER, false);
        if (ids.some(id => typeof id !== "string" || !id)) invalidInput();
        const keys = scopeKey(scope);
        const visible = visibility(db, scope);
        const put = db.prepare(`INSERT INTO cairn_topic_failures VALUES (?, ?, ?, ?, ?, 1, ?)
          ON CONFLICT (owner_id, namespace_key, memory_id) DO UPDATE SET
            attempts = CASE WHEN revision = excluded.revision THEN attempts + 1 ELSE 1 END,
            revision = excluded.revision, code = excluded.code, failed_at_ms = excluded.failed_at_ms`);
        let failedAtMs;
        for (const id of new Set(ids)) {
          const row = current(visible, id);
          if (row) put.run(...keys, id, row.revision, code, failedAtMs ??= now());
        }
      });
    },

    list(tx, callerScope, query) {
      return access(tx, callerScope, {}, (db, scope) => {
        const { level } = query;
        if (level !== undefined && level !== "L1" && level !== "L2") invalidInput();
        const visible = visibility(db, scope);
        const catalog = catalogTopics(db, scope, visible);
        const groups = membersByTopic(db, scope, visible);
        const rows = catalog.filter(topic => !level || topic.level === level).flatMap(topic => {
          const members = topicMembers(topic, catalog, groups);
          return members.length ? [{ ...topic, memberCount: members.length,
            newestMemberIds: members.slice(0, 3).map(({ id }) => id) }] : [];
        }).sort(compareCatalogTopics);
        return topicPage(rows, query, scope, "list", level ?? null, index.start(db, tx));
      });
    },

    members(tx, callerScope, topicId, query) {
      return access(tx, callerScope, {}, (db, scope) => {
        const visible = visibility(db, scope);
        const catalog = catalogTopics(db, scope, visible);
        const topic = catalog.find(({ id }) => id === topicId);
        const members = topic ? topicMembers(topic, catalog, membersByTopic(db, scope, visible)) : [];
        return topicPage(members.map(member => ({ kind: /** @type {const} */ ("memory"), ...member })),
          query, scope, "members", topicId, index.start(db, tx));
      });
    },

    forMemory(tx, callerScope, memoryId) {
      return access(tx, callerScope, {}, (db, scope) => topicMembershipReader(db, scope, visibility(db, scope))(memoryId) ?? []);
    },

    forMemories(tx, callerScope, memoryIds) {
      return access(tx, callerScope, {}, (db, scope) => {
        const ids = placementArray(memoryIds, 100);
        validateLimit(ids.length);
        if (ids.some(id => typeof id !== "string")) invalidInput();
        const visible = visibility(db, scope);
        const memberships = topicMembershipReader(db, scope, visible);
        /** @type {Map<string, {id: string, title: string | null}> | undefined} */
        let titles;
        return [...new Set(ids)].flatMap(memoryId => {
          const topicIds = memberships(memoryId);
          if (topicIds === null) return [];
          titles ??= new Map(catalogTopics(db, scope, visible).filter(topic => topic.level === "L1")
            .map(({ id, title }) => [id, { id, title }]));
          const catalog = titles;
          return [{ memoryId, topics: topicIds.flatMap(id => catalog.get(id) ?? []) }];
        });
      });
    },

    dropMemory(tx, callerScope, memoryId) {
      return access(tx, callerScope, write, (db, scope) => {
        const retired = retireSource(db, scope, memoryId);
        const dropped = Number(db.prepare(`DELETE FROM cairn_topic_memberships WHERE ${exactScope} AND memory_id = ?`)
          .run(...scopeKey(scope), memoryId).changes);
        if (dropped || retired) index.markDirty(db, tx);
        return { dropped };
      });
    },

    pendingCards(tx, callerScope, { limit }) {
      return access(tx, callerScope, {}, (_db, scope) => {
        scopeKey(scope);
        validateLimit(limit, placementBatchLimit);
        return [];
      });
    },
    forCard(tx, callerScope) {
      return access(tx, callerScope, {}, (_db, scope) => {
        scopeKey(scope);
        return [];
      });
    },
    applyCardPlacement(tx, callerScope) {
      return access(tx, callerScope, write, unavailableCardPlacement);
    },
    markCardsFailed(tx, callerScope) {
      return access(tx, callerScope, write, unavailableCardPlacement);
    },
    dropCard(tx, callerScope) {
      return access(tx, callerScope, write, unavailableCardPlacement);
    },
  };
}

/** @returns {never} */
function unavailableCardPlacement() {
  throw new CoreError("capability_unavailable");
}
