import { canonicalPair, compareUtf8, CoreError } from "@cairn-ink/core";
import { invalidateRationale } from "./rationale.mjs";
import { advanceInspectEpoch } from "./unit-of-work.mjs";
import { validateMemoryId, validateTime, writeNamespace, writeTime } from "./validation.mjs";

/** @import { ConflictEdge, ConflictEdgeStore, Namespace, Scope, SupersessionStore } from "@cairn-ink/core/ports" */
/** @import { State } from "./unit-of-work.mjs" */
/** @typedef {Parameters<SupersessionStore["record"]>[2] & {receiptIds: string[], createdAtMs: number}} Supersession */
/** @typedef {Parameters<ConflictEdgeStore["insert"]>[2] & {createdAtMs: number}} Conflict */
/** @typedef {{supersessions: Map<string, Supersession>, conflicts: Map<string, Conflict>}} RelationState */
/** @typedef {Awaited<ReturnType<SupersessionStore["read"]>>} SupersessionView */

/** @param {State} state @param {Namespace} namespace */
function ensureRelations(state, namespace) {
  let relations = state.relations.get(namespace);
  if (!relations) {
    relations = { supersessions: new Map(), conflicts: new Map() };
    state.relations.set(namespace, relations);
  }
  return relations;
}

/** @param {Conflict} edge @param {string} id */
function touches({ left, right }, id) {
  return left.id === id || right.id === id;
}

/** @param {RelationState | undefined} relations @param {string} id */
function deleteConflicts(relations, id) {
  if (!relations) return 0;
  let count = 0;
  for (const [key, edge] of relations.conflicts) {
    if (touches(edge, id)) {
      relations.conflicts.delete(key);
      count++;
    }
  }
  return count;
}

/** @param {State} state @param {Namespace} namespace @param {string} id */
export function eraseRelations(state, namespace, id) {
  const relations = state.relations.get(namespace);
  if (!relations) return;
  relations.supersessions.delete(id);
  for (const [previousId, { replacement }] of relations.supersessions) {
    if (replacement.id === id) relations.supersessions.delete(previousId);
  }
  deleteConflicts(relations, id);
  if (!relations.supersessions.size && !relations.conflicts.size) state.relations.delete(namespace);
}

/**
 * @param {ReturnType<typeof import("./unit-of-work.mjs").createUnitOfWork>["port"]} port
 * @param {ReturnType<typeof import("./fact-match.mjs").createFactMatcher>} matchFacts
 */
export function createRelationStores(port, matchFacts) {
  /** @param {State} state @param {Scope} scope @param {readonly string[]} ids */
  function readSupersessions(state, scope, ids) {
    /** @type {Map<string, SupersessionView>} */
    const result = new Map(ids.map((id) => [id, { supersededBy: null, supersedes: [] }]));
    const rows = state.rows.get(scope.namespace);
    const policy = matchFacts(state.facts, scope);
    for (const { previous, replacement } of state.relations.get(scope.namespace)?.supersessions.values() ?? []) {
      const predecessor = result.get(previous.id);
      const successor = result.get(replacement.id);
      if (!predecessor && !successor) continue;
      const previousEntry = rows?.get(previous.id);
      const replacementEntry = rows?.get(replacement.id);
      if (!previousEntry || !replacementEntry || policy.hides(previousEntry) || policy.hides(replacementEntry)) continue;
      if (predecessor) predecessor.supersededBy = replacement.id;
      successor?.supersedes.push(previous.id);
    }
    for (const view of result.values()) view.supersedes.sort(compareUtf8);
    return result;
  }

  /** @param {State} state @param {Scope} scope @param {readonly string[]} ids */
  function readConflicts(state, scope, ids) {
    /** @type {Map<string, ConflictEdge[]>} */
    const result = new Map(ids.map((id) => [id, []]));
    const rows = state.rows.get(scope.namespace);
    const policy = matchFacts(state.facts, scope);
    for (const { left, right, relation, source } of state.relations.get(scope.namespace)?.conflicts.values() ?? []) {
      const leftEdges = result.get(left.id);
      const rightEdges = result.get(right.id);
      if (!leftEdges && !rightEdges) continue;
      const leftEntry = rows?.get(left.id);
      const rightEntry = rows?.get(right.id);
      if (!leftEntry || !rightEntry || leftEntry.row.historical || rightEntry.row.historical ||
          leftEntry.row.revision !== left.revision || rightEntry.row.revision !== right.revision ||
          policy.hides(leftEntry) || policy.hides(rightEntry)) continue;
      leftEdges?.push({ memoryId: right.id, revision: right.revision, relation, source });
      rightEdges?.push({ memoryId: left.id, revision: left.revision, relation, source });
    }
    for (const edges of result.values()) {
      edges.sort((a, b) => compareUtf8(a.memoryId, b.memoryId) || compareUtf8(a.source, b.source));
    }
    return result;
  }

  /** @type {SupersessionStore} */
  const supersession = {
    async record(tx, scope, edge, receiptIds, nowMs) {
      return port.write(tx, scope, true, () => {
        const namespace = writeNamespace(scope);
        const { previous, replacement } = edge;
        const record = {
          previous: { id: previous.id, revision: previous.revision },
          replacement: { id: replacement.id, revision: replacement.revision },
          receiptIds: [...receiptIds], createdAtMs: nowMs,
        };
        if (record.previous.id === record.replacement.id) throw new CoreError("invalid_ref");
        return (getState) => {
          const state = getState();
          const { supersessions } = ensureRelations(state, namespace);
          if (supersessions.has(record.previous.id)) throw new CoreError("invalid_ref");
          supersessions.set(record.previous.id, record);
          advanceInspectEpoch(state, namespace);
        };
      });
    },
    async markHistorical(tx, scope, id, nowMs) {
      return port.write(tx, scope, "conditional", () => {
        const namespace = writeNamespace(scope);
        validateMemoryId(id);
        validateTime(nowMs);
        return (getState, markDirty) => {
          const state = getState();
          const row = state.rows.get(namespace)?.get(id)?.row;
          const dropped = deleteConflicts(state.relations.get(namespace), id);
          if (row) {
            Object.assign(row, { historical: true, revision: row.revision + 1, ...writeTime(nowMs) });
            invalidateRationale(state, namespace, id);
          }
          if (row || dropped) {
            advanceInspectEpoch(state, namespace);
            markDirty();
          }
        };
      });
    },
    async read(tx, scope, id) {
      return port(tx, scope, false, (state) => [...readSupersessions(state, scope, [id]).values()][0]);
    },
    async readMany(tx, scope, ids) {
      return port(tx, scope, false, (state) => readSupersessions(state, scope, ids));
    },
    async incomingCount(tx, scope, replacementId) {
      return port(tx, scope, false, (state) => {
        let count = 0;
        for (const { replacement } of state.relations.get(scope.namespace)?.supersessions.values() ?? []) {
          if (replacement.id === replacementId) count++;
        }
        return count;
      });
    },
  };

  /** @type {ConflictEdgeStore} */
  const conflicts = {
    async insert(tx, scope, edge, nowMs) {
      return port.write(tx, scope, "conditional", () => {
        const namespace = writeNamespace(scope);
        const [leftId] = canonicalPair(edge.left.id, edge.right.id);
        const [left, right] = leftId === edge.left.id ? [edge.left, edge.right] : [edge.right, edge.left];
        const { relation, source } = edge;
        if (relation !== "contradicts" || (source !== "explicit-hint" && source !== "inferred-hint")) {
          throw new CoreError("invalid_input");
        }
        const key = JSON.stringify([left.id, left.revision, right.id, right.revision, relation, source]);
        const record = {
          left: { id: left.id, revision: left.revision }, right: { id: right.id, revision: right.revision },
          relation, source, createdAtMs: nowMs,
        };
        return (getState, markDirty) => {
          const state = getState();
          const { conflicts } = ensureRelations(state, namespace);
          if (conflicts.has(key)) return { inserted: false };
          conflicts.set(key, record);
          advanceInspectEpoch(state, namespace);
          markDirty();
          return { inserted: true };
        };
      });
    },
    async list(tx, scope, id) {
      return port(tx, scope, false, (state) => [...readConflicts(state, scope, [id]).values()][0]);
    },
    async readMany(tx, scope, ids) {
      return port(tx, scope, false, (state) => readConflicts(state, scope, ids));
    },
    async invalidate(tx, scope, id) {
      return port.write(tx, scope, "conditional", () => {
        const namespace = writeNamespace(scope);
        return (getState, markDirty) => {
          const state = getState();
          const count = deleteConflicts(state.relations.get(namespace), id);
          if (count) {
            advanceInspectEpoch(state, namespace);
            markDirty();
          }
          return count;
        };
      });
    },
    async degree(tx, scope, id) {
      return port(tx, scope, false, (state) => {
        let count = 0;
        for (const edge of state.relations.get(scope.namespace)?.conflicts.values() ?? []) {
          if (touches(edge, id)) count++;
        }
        return count;
      });
    },
  };
  return { supersession, conflicts };
}
