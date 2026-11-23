import {
  CoreError, ERROR_CODES, coalesceNewTopics, compareCatalogTopics, compareSortKey, compareUtf8, isErrorCode,
  memoryGuards, placementProposal, titleKey,
} from "@cairn-ink/core";
import { decodePayload, encodePayload, newestFirst } from "./cursor.mjs";
import { writeTime } from "./memory-store.mjs";
import { validateLimit, validateTime } from "./validation.mjs";

/** @import {Scope, Topic, TopicStore} from "@cairn-ink/core/ports" */
/** @import {State} from "./unit-of-work.mjs" */
/** @import {Outcome, StoredTopic, TopicState} from "./topics.d.mts" */
/** @typedef {{id: string, updatedAtUs: bigint}} Member */

/** @param {State} state @param {Scope} scope */
function ensureTopicState(state, scope) {
  let scoped = state.topics.get(scope.namespace);
  if (!scoped) {
    scoped = { topics: new Map(), outcomes: new Map(), failures: new Map() };
    state.topics.set(scope.namespace, scoped);
  }
  return scoped;
}

/** @param {State} state @param {Scope} scope @param {ReturnType<typeof import("./fact-match.mjs").createFactMatcher>} matchFacts */
function visibility(state, scope, matchFacts) {
  const rows = state.rows.get(scope.namespace);
  const policy = matchFacts(state.facts, scope);
  /** @param {string} id */
  const current = (id) => {
    const entry = rows?.get(id);
    return entry && !entry.row.historical && !policy.hides(entry) ? entry.row : undefined;
  };
  return {
    current,
    /** @param {StoredTopic} topic @returns {Topic} */
    topic({ id, level, title, parentIds, sources }) {
      const visible = sources.every(({ memoryId, revision }) => current(memoryId)?.revision === revision);
      return { id, level, title: visible ? title : null, parentIds: [...parentIds] };
    },
  };
}

/** @param {TopicState} scoped @param {StoredTopic} topic @param {ReturnType<typeof visibility>['current']} current */
function visibleMembers(scoped, topic, current) {
  const children = topic.level === "L1" ? [topic.id] : [...scoped.topics.values()]
    .filter(({ parentIds }) => parentIds.includes(topic.id)).map(({ id }) => id);
  /** @type {Member[]} */
  const members = [];
  for (const [id, { revision, memberships }] of scoped.outcomes) {
    if (current(id)?.revision !== revision) continue;
    let newest;
    for (const child of children) {
      const placedAt = memberships.get(child);
      if (placedAt !== undefined && (newest === undefined || placedAt > newest)) newest = placedAt;
    }
    if (newest !== undefined) members.push({ id, updatedAtUs: newest });
  }
  return members.sort(newestFirst);
}

/**
 * @template T
 * @param {T[]} rows @param {{cursor: string | null, limit: number}} query
 * @param {Scope} scope @param {string} method @param {string | null} filter @param {number} revision
 */
function page(rows, { cursor, limit }, { owner, namespace }, method, filter, revision) {
  validateLimit(limit);
  let offset = 0;
  if (cursor !== null) {
    const [kind, tokenOwner, tokenNamespace, tokenFilter, version, start, ...extra] = decodePayload(cursor);
    if (extra.length || kind !== method || tokenOwner !== owner || tokenNamespace !== namespace ||
        tokenFilter !== filter || typeof version !== "number" || !Number.isSafeInteger(version) || version < 0 ||
        typeof start !== "number" || !Number.isSafeInteger(start) || start < 1) throw new CoreError("invalid_cursor");
    if (version !== revision) throw new CoreError("cursor_stale");
    offset = start;
  }
  const items = rows.slice(offset, offset + limit);
  const next = offset + items.length;
  return { items, nextCursor: next < rows.length ? encodePayload([method, owner, namespace, filter, revision, next]) : null };
}

/** @param {Map<string, StoredTopic> | undefined} topics @param {string} id @param {Topic["level"]} level */
function checkParent(topics, id, level) {
  const parent = topics?.get(id);
  if (!parent) throw new CoreError("not_found");
  if (parent.level !== level) throw new CoreError("invalid_ref");
}

/** @type {typeof import("./topics.d.mts").createTopicStore} */
export function createTopicStore(port, _flags, newId, now, matchFacts, {
  topicRetryAfterMs = 3_600_000, topicMaxAttempts = 3,
}) {
  /** @param {State} state @param {Scope} scope */
  const view = (state, scope) => visibility(state, scope, matchFacts);

  return {
    async pending(tx, scope, { limit }) {
      return port(tx, scope, false, (state) => {
        validateLimit(limit);
        if (limit > 5) throw new CoreError("invalid_input");
        const scoped = state.topics.get(scope.namespace);
        const { current } = view(state, scope);
        /** @type {number | undefined} */
        let nowMs;
        return [...(state.rows.get(scope.namespace)?.values() ?? [])]
          .map(({ row }) => row)
          .filter(({ id, revision }) => {
            if (!current(id) || scoped?.outcomes.get(id)?.revision === revision) return false;
            const failure = scoped?.failures.get(id);
            return failure?.revision !== revision || (ERROR_CODES[failure.code] === "retryable" &&
              failure.attempts < topicMaxAttempts && (nowMs ??= now()) - failure.failedAtMs >= topicRetryAfterMs);
          })
          .sort((a, b) => compareSortKey(writeTime(a.createdAtMs).updatedAtUs, writeTime(b.createdAtMs).updatedAtUs) ||
            compareUtf8(a.id, b.id))
          .slice(0, limit).map(({ id, revision }) => ({ memoryId: id, revision }));
      });
    },

    async catalog(tx, scope, query) {
      return port(tx, scope, false, (state) => {
        const { indexRevision } = state;
        const { topic } = view(state, scope);
        const topics = [...(state.topics.get(scope.namespace)?.topics.values() ?? [])].map(topic).sort(compareCatalogTopics);
        const result = page(topics, query, scope, "catalog", null, indexRevision);
        return { ...result, exhausted: result.nextCursor === null, indexRevision };
      });
    },

    async applyPlacement(tx, scope, basedOn, proposal) {
      return port.write(tx, scope, "conditional", () => (getState, markDirty, run) => {
        const { items } = placementProposal(proposal);
        const indexRevision = basedOn?.indexRevision;
        if (!Number.isSafeInteger(indexRevision) || indexRevision < 0) throw new CoreError("invalid_input");
        const state = getState();
        if (indexRevision !== state.indexRevision) throw new CoreError("revision_conflict");
        const guards = memoryGuards(basedOn.memoryRevisions, items.map(({ memoryId }) => memoryId));
        const revisions = new Map(guards.map(({ memoryId, revision }) => [memoryId, revision]));
        const { current, topic } = view(state, scope);
        for (const { memoryId, revision } of guards) {
          if (current(memoryId)?.revision !== revision) throw new CoreError("revision_conflict");
        }

        const previous = state.topics.get(scope.namespace);
        const existing = previous?.topics;
        for (const { parentIds, newL1 } of items) {
          for (const id of parentIds) checkParent(existing, id, "L1");
          for (const id of newL1?.parentL2Ids ?? []) checkParent(existing, id, "L2");
        }
        const titles = new Set([...(existing?.values() ?? [])].map(({ title, level }) => level + titleKey(title)));
        for (const { newL1 } of items) {
          if (newL1 && (titles.has("L1" + titleKey(newL1.title)) ||
              (newL1.newL2Title && titles.has("L2" + titleKey(newL1.newL2Title))))) {
            throw new CoreError("moc_title_conflict");
          }
        }
        const { newL1, newL2 } = coalesceNewTopics(items);

        const allocated = new Set([...state.topics.values()].flatMap(({ topics }) => [...topics.keys()]));
        /** @param {Topic["level"]} level @param {string} title @param {string[]} parentIds @returns {StoredTopic} */
        function create(level, title, parentIds) {
          const id = newId();
          if (typeof id !== "string" || !id || allocated.has(id)) throw new CoreError("internal_error");
          allocated.add(id);
          return { id, level, title, parentIds, sources: guards };
        }
        const l2s = new Map([...newL2].map(([key, plan]) => [key, create("L2", plan.title, [])]));
        const l1s = new Map([...newL1].map(([key, plan]) => [key, create("L1", plan.title, [
          ...plan.parentL2Ids, ...[...plan.newParentKeys].map((parent) => /** @type {StoredTopic} */ (l2s.get(parent)).id),
        ])]));
        const created = [...l2s.values(), ...l1s.values()];
        const placed = items.map(({ memoryId, parentIds, newL1 }) => ({
          memoryId,
          topicIds: newL1 ? [...parentIds, /** @type {StoredTopic} */ (l1s.get(titleKey(newL1.title))).id] : [...parentIds],
        }));

        let changed = created.length > 0;
        /** @type {bigint | undefined} */
        let placedAtUs;
        const readPlacementTime = () => {
          if (placedAtUs === undefined) {
            const nowMs = now();
            validateTime(nowMs);
            placedAtUs = writeTime(nowMs).updatedAtUs;
          }
          return placedAtUs;
        };
        /** @type {Map<string, Outcome>} */
        const updates = new Map();
        for (const { memoryId, topicIds } of placed) {
          const revision = /** @type {number} */ (revisions.get(memoryId));
          const before = previous?.outcomes.get(memoryId);
          if (before?.revision === revision && before.memberships.size === topicIds.length &&
              topicIds.every((id) => before.memberships.has(id))) continue;

          const memberships = new Map();
          for (const id of topicIds) {
            const previousTime = before?.revision === revision ? before.memberships.get(id) : undefined;
            memberships.set(id, previousTime ?? readPlacementTime());
          }
          if (topicIds.length || (before?.revision === revision && before.memberships.size)) changed = true;
          updates.set(memoryId, { revision, memberships });
        }

        if (changed || updates.size) {
          const scoped = ensureTopicState(state, scope);
          for (const row of created) scoped.topics.set(row.id, row);
          for (const [id, outcome] of updates) scoped.outcomes.set(id, outcome);
          if (changed) markDirty();
          else run.stateWritten = true;
        }
        return { placed, createdTopics: created.map(topic) };
      });
    },

    async markFailed(tx, scope, memoryIds, code) {
      return port.write(tx, scope, "conditional", () => (getState, _markDirty, run) => {
        if (!isErrorCode(code) || !Array.isArray(memoryIds) ||
            memoryIds.some((id) => typeof id !== "string" || !id)) throw new CoreError("invalid_input");
        const state = getState();
        const { current } = view(state, scope);
        /** @type {number | undefined} */
        let failedAtMs;
        for (const id of new Set(memoryIds)) {
          const row = current(id);
          if (!row) continue;
          const { failures } = ensureTopicState(state, scope);
          const previous = failures.get(id);
          const attempts = previous?.revision === row.revision ? previous.attempts + 1 : 1;
          failures.set(id, { revision: row.revision, code, attempts, failedAtMs: failedAtMs ??= now() });
          run.stateWritten = true;
        }
      });
    },

    async list(tx, scope, query) {
      return port(tx, scope, false, (state) => {
        const { level } = query;
        if (level !== undefined && level !== "L1" && level !== "L2") throw new CoreError("invalid_input");
        const scoped = state.topics.get(scope.namespace);
        const { current, topic } = view(state, scope);
        const rows = scoped ? [...scoped.topics.values()].filter((row) => !level || row.level === level)
          .flatMap((row) => {
            const members = visibleMembers(scoped, row, current);
            return members.length ? [{
              ...topic(row), memberCount: members.length, newestMemberIds: members.slice(0, 3).map(({ id }) => id),
            }] : [];
          }).sort(compareCatalogTopics) : [];
        return page(rows, query, scope, "list", level ?? null, state.indexRevision);
      });
    },

    async members(tx, scope, topicId, query) {
      return port(tx, scope, false, (state) => {
        const scoped = state.topics.get(scope.namespace);
        const topic = scoped?.topics.get(topicId);
        const rows = scoped && topic ? visibleMembers(scoped, topic, view(state, scope).current) : [];
        const result = page(rows, query, scope, "members", topicId, state.indexRevision);
        return { ...result, items: result.items.map(({ id, updatedAtUs }) => ({ kind: "memory", id, placedAtUs: updatedAtUs })) };
      });
    },

    async forMemory(tx, scope, memoryId) {
      return port(tx, scope, false, (state) => {
        const outcome = state.topics.get(scope.namespace)?.outcomes.get(memoryId);
        return outcome && outcome.revision === view(state, scope).current(memoryId)?.revision
          ? [...outcome.memberships.keys()].sort(compareUtf8) : [];
      });
    },

    async dropMemory(tx, scope, memoryId) {
      return port.write(tx, scope, "conditional", () => (getState, markDirty) => {
        const state = getState();
        const memberships = state.topics.get(scope.namespace)?.outcomes.get(memoryId)?.memberships;
        const dropped = memberships?.size ?? 0;
        if (memberships?.size) {
          memberships.clear();
          markDirty();
        }
        return { dropped };
      });
    },
  };
}
