import {
  CoreError, ERROR_CODES, coalesceNewTopics, compareCatalogTopics, compareSortKey, compareUtf8, isErrorCode,
  memoryGuards, placementProposal, titleKey, uniqueIds,
} from "@cairn-ink/core";
import { decodePayload, encodePayload, newestFirst } from "./cursor.mjs";
import { writeTime } from "./memory-store.mjs";
import { copyScope, snapshotArray, validateCardId, validateLimit, validateTime } from "./validation.mjs";

/** @import {PlacementProposal} from "@cairn-ink/core" */
/** @import {Scope, StoredDocumentCardRecord, Topic, TopicStore} from "@cairn-ink/core/ports" */
/** @import {State} from "./unit-of-work.mjs" */
/** @import {CardOutcome, Failure, Outcome, StoredTopic, TopicState} from "./topics.d.mts" */
/** @typedef {{id: string, updatedAtUs: bigint}} Member */

/** @param {State} state @param {Scope} scope */
function ensureTopicState(state, scope) {
  let scoped = state.topics.get(scope.namespace);
  if (!scoped) {
    scoped = { topics: new Map(), outcomes: new Map(), failures: new Map(), cardOutcomes: new Map(), cardFailures: new Map() };
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

/** @param {TopicState} scoped @param {StoredTopic} topic */
function memberTopics(scoped, topic) {
  return topic.level === "L1" ? [topic.id] : [...scoped.topics.values()]
    .filter(({ parentIds }) => parentIds.includes(topic.id)).map(({ id }) => id);
}

/** @template {Outcome | CardOutcome} T
 * @param {Map<string, T>} outcomes @param {string[]} children @param {(id: string, outcome: T) => boolean} isVisible */
function visibleMembers(outcomes, children, isVisible) {
  /** @type {Member[]} */
  const members = [];
  for (const [id, outcome] of outcomes) {
    if (!isVisible(id, outcome)) continue;
    const { memberships } = outcome;
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

/** @param {TopicState} scoped @param {CardOutcome} outcome */
function cardTopics(scoped, outcome) {
  return [...outcome.memberships.keys()].sort(compareUtf8)
    .map((id) => scoped.topics.get(id)).filter((topic) => topic?.level === "L1");
}

const placementBatchLimit = 5;
const placementArrayOptions = { strictKeys: true };

/** @param {State} state @param {Scope["namespace"]} namespace @param {string} cardId */
export function dropCardMemberships(state, namespace, cardId) {
  const memberships = state.topics.get(namespace)?.cardOutcomes.get(cardId)?.memberships;
  const dropped = memberships?.size ?? 0;
  memberships?.clear();
  return dropped;
}

/** @param {State} state @param {Scope["namespace"]} namespace @param {string} cardId */
export function dropCardPlacement(state, namespace, cardId) {
  const scoped = state.topics.get(namespace);
  scoped?.cardOutcomes.delete(cardId);
  scoped?.cardFailures.delete(cardId);
}

/** @param {Pick<StoredDocumentCardRecord, "sourceMemories">} card
 * @param {ReturnType<typeof visibility>["current"]} current */
function cardSourcesAreCurrent(card, current) {
  return card.sourceMemories.every((source) => {
    const row = source && current(source.id);
    return !!row && row.revision === source.revision;
  });
}

/** @param {readonly string[]} callerIds @param {import("@cairn-ink/core").ErrorCode} code */
function failureIds(callerIds, code) {
  if (!isErrorCode(code)) throw new CoreError("invalid_input");
  const ids = snapshotArray(callerIds);
  if (ids.some((id) => typeof id !== "string" || !id)) throw new CoreError("invalid_input");
  return new Set(ids);
}

/** @template T @param {T} value @param {readonly string[]} allowed */
function placementFields(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some((key) => !allowed.includes(key))) throw new CoreError("invalid_input");
  return value;
}

/** @param {PlacementProposal} proposal */
function snapshotPlacementProposal(proposal) {
  const { items } = placementFields(proposal, ["items"]);
  return {
    items: snapshotArray(items, { ...placementArrayOptions, maxLength: placementBatchLimit }).map((item) => {
      const { memoryId, parentIds, newL1 } = placementFields(item, ["memoryId", "parentIds", "newL1"]);
      const parents = snapshotArray(parentIds, { ...placementArrayOptions, maxLength: 3 });
      if (newL1 === undefined) return { memoryId, parentIds: parents };
      const { title, parentL2Ids, newL2Title } = placementFields(newL1, ["title", "parentL2Ids", "newL2Title"]);
      return { memoryId, parentIds: parents, newL1: {
        title, parentL2Ids: snapshotArray(parentL2Ids, { ...placementArrayOptions, maxLength: 3 }), newL2Title,
      } };
    }),
  };
}

/** @type {typeof import("./topics.d.mts").createTopicStore} */
export function createTopicStore(port, flags, newId, now, matchFacts, {
  topicRetryAfterMs = 3_600_000, topicMaxAttempts = 3,
}, cardVisible) {
  /** @param {State} state @param {string} owner @param {Scope["namespace"]} namespace */
  const view = (state, owner, namespace) => visibility(state, { owner, namespace }, matchFacts);
  /** @param {Failure} failure @param {() => number} readNow */
  const mayRetry = (failure, readNow) => ERROR_CODES[failure.code] === "retryable" &&
    failure.attempts < topicMaxAttempts && readNow() - failure.failedAtMs >= topicRetryAfterMs;

  /** @param {State} state @param {Scope} scope @param {string} cardId @param {string} contentHash
   * @param {ReturnType<typeof visibility>["current"]} current */
  async function visibleCardAt(state, scope, cardId, contentHash, current) {
    const card = state.documentCards.get(scope.namespace)?.get(cardId)?.card;
    return card?.contentHash === contentHash &&
      cardSourcesAreCurrent(card, current) &&
      await cardVisible(state, scope, card);
  }

  /** @param {State} state @param {Scope} scope @param {TopicState} scoped */
  async function visibleFiledCards(state, scope, scoped) {
    const { current } = visibility(state, scope, matchFacts);
    const ids = new Set();
    for (const [id, { contentHash, memberships }] of scoped.cardOutcomes) {
      if (memberships.size && await visibleCardAt(state, scope, id, contentHash, current)) ids.add(id);
    }
    return ids;
  }

  return {
    async pending(tx, scope, { limit }) {
      return port(tx, scope, false, (state) => {
        validateLimit(limit);
        if (limit > placementBatchLimit) throw new CoreError("invalid_input");
        const scoped = state.topics.get(scope.namespace);
        const { current } = view(state, tx.owner, scope.namespace);
        /** @type {number | undefined} */
        let nowMs;
        return [...(state.rows.get(scope.namespace)?.values() ?? [])]
          .map(({ row }) => row)
          .filter(({ id, revision }) => {
            if (!current(id) || scoped?.outcomes.get(id)?.revision === revision) return false;
            const failure = scoped?.failures.get(id);
            return failure?.revision !== revision || mayRetry(failure, () => nowMs ??= now());
          })
          .sort((a, b) => compareSortKey(writeTime(a.createdAtMs).updatedAtUs, writeTime(b.createdAtMs).updatedAtUs) ||
            compareUtf8(a.id, b.id))
          .slice(0, limit).map(({ id, revision }) => ({ memoryId: id, revision }));
      });
    },

    async pendingCards(tx, callerScope, query) {
      const scope = copyScope(callerScope);
      return port.read(tx, scope, (getState) => {
        const { limit } = query;
        validateLimit(limit);
        if (limit > placementBatchLimit) throw new CoreError("invalid_input");
        if (!flags.documentCards) return [];
        const state = getState();
        const scoped = state.topics.get(scope.namespace);
        const { current } = visibility(state, scope, matchFacts);
        /** @type {number | undefined} */
        let nowMs;
        return [...(state.documentCards.get(scope.namespace)?.values() ?? [])]
          .flatMap(({ card, createdAtMs }) => {
            if (!card || scoped?.cardOutcomes.get(card.id)?.contentHash === card.contentHash ||
                !cardSourcesAreCurrent(card, current)) return [];
            const failure = scoped?.cardFailures.get(card.id);
            return failure?.contentHash !== card.contentHash || mayRetry(failure, () => nowMs ??= now())
              ? [{ cardId: card.id, contentHash: card.contentHash, createdAtMs }] : [];
          })
          .sort((a, b) => a.createdAtMs - b.createdAtMs || compareUtf8(a.cardId, b.cardId))
          .slice(0, limit).map(({ cardId, contentHash }) => ({ cardId, contentHash }));
      });
    },

    async catalog(tx, scope, query) {
      return port(tx, scope, false, (state) => {
        const { indexRevision } = state;
        const { topic } = view(state, tx.owner, scope.namespace);
        const topics = [...(state.topics.get(scope.namespace)?.topics.values() ?? [])].map(topic).sort(compareCatalogTopics);
        const result = page(topics, query, { owner: tx.owner, namespace: scope.namespace }, "catalog", null, indexRevision);
        return { ...result, exhausted: result.nextCursor === null, indexRevision };
      });
    },

    async applyPlacement(tx, scope, basedOn, proposal) {
      return port.write(tx, scope, "conditional", () => {
        const { items } = placementProposal(snapshotPlacementProposal(proposal), undefined, placementBatchLimit);
        const indexRevision = basedOn?.indexRevision;
        if (!Number.isSafeInteger(indexRevision) || indexRevision < 0) throw new CoreError("invalid_input");
        const guards = memoryGuards(snapshotArray(basedOn.memoryRevisions, { ...placementArrayOptions, maxLength: items.length }),
          items.map(({ memoryId }) => memoryId));
        return (getState, markDirty, run) => {
          const state = getState();
          if (indexRevision !== state.indexRevision) throw new CoreError("revision_conflict");
          const revisions = new Map(guards.map(({ memoryId, revision }) => [memoryId, revision]));
          const { current, topic } = view(state, tx.owner, scope.namespace);
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
        };
      });
    },

    async markFailed(tx, scope, memoryIds, code) {
      return port.write(tx, scope, "conditional", () => {
        const ids = failureIds(memoryIds, code);
        return (getState, _markDirty, run) => {
          const state = getState();
          const { current } = view(state, tx.owner, scope.namespace);
          /** @type {number | undefined} */
          let failedAtMs;
          for (const id of ids) {
            const row = current(id);
            if (!row) continue;
            const { failures } = ensureTopicState(state, scope);
            const previous = failures.get(id);
            const attempts = previous?.revision === row.revision ? previous.attempts + 1 : 1;
            failures.set(id, { revision: row.revision, code, attempts, failedAtMs: failedAtMs ??= now() });
            run.stateWritten = true;
          }
        };
      });
    },

    async applyCardPlacement(tx, callerScope, basedOn, proposal) {
      const scope = copyScope(callerScope);
      const { namespace } = scope;
      return port.write(tx, scope, "conditional", () => {
        const { items: input } = placementFields(proposal, ["items"]);
        const items = snapshotArray(input, { ...placementArrayOptions, maxLength: placementBatchLimit }).map((item) => {
          const { cardId, parentIds } = placementFields(item, ["cardId", "parentIds"]);
          const parents = uniqueIds(snapshotArray(parentIds, { ...placementArrayOptions, maxLength: 3 }), 3);
          return { cardId: validateCardId(cardId), topicIds: parents };
        });
        const ids = new Set(items.map(({ cardId }) => cardId));
        if (!items.length || ids.size !== items.length) throw new CoreError("invalid_input");
        const indexRevision = basedOn?.indexRevision;
        if (!Number.isSafeInteger(indexRevision) || indexRevision < 0) throw new CoreError("invalid_input");
        const guards = snapshotArray(basedOn.cards, { ...placementArrayOptions, maxLength: ids.size }).map((guard) => {
          const { cardId, contentHash } = placementFields(guard, ["cardId", "contentHash"]);
          if (!ids.delete(cardId) || typeof contentHash !== "string" || !contentHash) throw new CoreError("invalid_input");
          return /** @type {const} */ ([cardId, contentHash]);
        });
        if (ids.size) throw new CoreError("invalid_input");
        const hashes = new Map(guards);
        return async (getState, markDirty, run) => {
          const state = getState();
          if (indexRevision !== state.indexRevision) throw new CoreError("revision_conflict");
          const previous = state.topics.get(namespace);
          const { current } = view(state, tx.owner, namespace);
          for (const [id, hash] of hashes) {
            if (!await visibleCardAt(state, scope, id, hash, current)) throw new CoreError("revision_conflict");
          }
          for (const { topicIds } of items) {
            if (topicIds.some((id) => previous?.topics.get(id)?.level !== "L1")) throw new CoreError("revision_conflict");
          }

          /** @type {Map<string, CardOutcome>} */
          const updates = new Map();
          let changed = false;
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
          for (const { cardId, topicIds } of items) {
            const contentHash = /** @type {string} */ (hashes.get(cardId));
            const before = previous?.cardOutcomes.get(cardId);
            const existing = before?.contentHash === contentHash ? before.memberships : undefined;
            if (existing?.size === topicIds.length && topicIds.every((id) => existing.has(id))) continue;
            const memberships = new Map(topicIds.map((id) => [id, existing?.get(id) ?? readPlacementTime()]));
            if (topicIds.length || existing?.size) changed = true;
            updates.set(cardId, { contentHash, memberships });
          }
          if (updates.size) {
            const { cardOutcomes } = ensureTopicState(state, scope);
            for (const [id, outcome] of updates) cardOutcomes.set(id, outcome);
            if (changed) markDirty();
            else run.stateWritten = true;
          }
          return { placed: items };
        };
      });
    },

    async markCardsFailed(tx, callerScope, cardIds, code) {
      const scope = copyScope(callerScope);
      return port.write(tx, scope, "conditional", () => {
        const ids = failureIds(cardIds, code);
        return (getState, _markDirty, run) => {
          const state = getState();
          const cards = state.documentCards.get(scope.namespace);
          /** @type {number | undefined} */
          let failedAtMs;
          for (const id of ids) {
            const card = cards?.get(id)?.card;
            if (!card) continue;
            const { contentHash } = card;
            const { cardFailures } = ensureTopicState(state, scope);
            const previous = cardFailures.get(id);
            const attempts = previous?.contentHash === contentHash ? previous.attempts + 1 : 1;
            cardFailures.set(id, { contentHash, code, attempts, failedAtMs: failedAtMs ??= now() });
            run.stateWritten = true;
          }
        };
      });
    },

    async list(tx, scope, query) {
      return port(tx, scope, false, async (state) => {
        const { level } = query;
        if (level !== undefined && level !== "L1" && level !== "L2") throw new CoreError("invalid_input");
        const namespace = scope.namespace;
        const scoped = state.topics.get(namespace);
        const { current, topic } = view(state, tx.owner, scope.namespace);
        const cards = flags.documentCards && scoped ? await visibleFiledCards(state, { owner: tx.owner, namespace }, scoped) : null;
        const rows = scoped ? [...scoped.topics.values()].filter((row) => !level || row.level === level)
          .flatMap((row) => {
            const children = memberTopics(scoped, row);
            const members = visibleMembers(scoped.outcomes, children, (id, outcome) => current(id)?.revision === outcome.revision);
            const cardCount = cards ? visibleMembers(scoped.cardOutcomes, children, (id) => cards.has(id)).length : 0;
            return members.length || cardCount ? [{
              ...topic(row), memberCount: members.length, newestMemberIds: members.slice(0, 3).map(({ id }) => id),
              ...(flags.documentCards && { cardCount }),
            }] : [];
          }).sort(compareCatalogTopics) : [];
        return page(rows, query, { owner: tx.owner, namespace: scope.namespace }, "list", level ?? null, state.indexRevision);
      });
    },

    async members(tx, scope, topicId, query) {
      return port(tx, scope, false, async (state) => {
        const namespace = scope.namespace;
        const scoped = state.topics.get(namespace);
        const topic = scoped?.topics.get(topicId);
        /** @type {Array<Member & {kind: "memory" | "card"}>} */
        const rows = [];
        if (scoped && topic) {
          const { current } = view(state, tx.owner, scope.namespace);
          const children = memberTopics(scoped, topic);
          const memories = visibleMembers(scoped.outcomes, children, (id, outcome) => current(id)?.revision === outcome.revision);
          for (const memory of memories) rows.push({ ...memory, kind: "memory" });
          if (flags.documentCards) {
            const cards = await visibleFiledCards(state, { owner: tx.owner, namespace }, scoped);
            for (const card of visibleMembers(scoped.cardOutcomes, children, (id) => cards.has(id))) {
              rows.push({ ...card, kind: "card" });
            }
            rows.sort((a, b) => newestFirst(a, b) || compareUtf8(b.kind, a.kind));
          }
        }
        const result = page(rows, query, { owner: tx.owner, namespace: scope.namespace }, "members", topicId, state.indexRevision);
        return { ...result, items: result.items.map(({ kind, id, updatedAtUs }) => ({ kind, id, placedAtUs: updatedAtUs })) };
      });
    },

    async forCard(tx, callerScope, cardId) {
      const scope = copyScope(callerScope);
      return port(tx, scope, false, async (state) => {
        validateCardId(cardId);
        const scoped = state.topics.get(scope.namespace);
        const outcome = scoped?.cardOutcomes.get(cardId);
        if (!scoped || !outcome?.memberships.size) return [];
        const { current } = view(state, tx.owner, scope.namespace);
        return await visibleCardAt(state, scope, cardId, outcome.contentHash, current)
          ? cardTopics(scoped, outcome).map(({ id }) => id) : [];
      });
    },

    async forCards(tx, callerScope, cardIds) {
      const scope = copyScope(callerScope);
      return port.read(tx, scope, async (getState) => {
        const ids = snapshotArray(cardIds, { strictKeys: true, maxLength: 100 });
        validateLimit(ids.length);
        ids.forEach(validateCardId);

        const state = getState();
        const scoped = state.topics.get(scope.namespace);
        if (!scoped) return [];
        const { current, topic } = view(state, scope.owner, scope.namespace);
        const rows = [];
        for (const cardId of new Set(ids)) {
          const outcome = scoped.cardOutcomes.get(cardId);
          if (!outcome || !await visibleCardAt(state, scope, cardId, outcome.contentHash, current)) continue;
          const topics = cardTopics(scoped, outcome).map((stored) => ({ id: stored.id, title: topic(stored).title }));
          rows.push({ cardId, topics });
        }
        return rows;
      });
    },

    async dropCard(tx, callerScope, cardId) {
      const scope = copyScope(callerScope);
      return port.write(tx, scope, "conditional", () => {
        validateCardId(cardId);
        return (getState, markDirty) => {
          const dropped = dropCardMemberships(getState(), scope.namespace, cardId);
          if (dropped) markDirty();
          return { dropped };
        };
      });
    },

    async forMemory(tx, scope, memoryId) {
      return port(tx, scope, false, (state) => {
        const outcome = state.topics.get(scope.namespace)?.outcomes.get(memoryId);
        return outcome && outcome.revision === view(state, tx.owner, scope.namespace).current(memoryId)?.revision
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
