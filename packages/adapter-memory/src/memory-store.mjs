import { CoreError, NEAR_DUPLICATE_DISTANCE, compareUtf8 } from "@cairn-ink/core";
import { cosineDistance } from "./cosine.mjs";
import { decodeCursor, encodeCursor, newestFirst } from "./cursor.mjs";
import { createFactMatcher } from "./fact-match.mjs";
import {
  attachReceipts, copyContent, copyReceipts, validateDuplicateBatch, validateLimit, validateMerge, validateSource, validateTime,
} from "./validation.mjs";

/** @typedef {import("@cairn-ink/core/ports").DuplicateQuery} DuplicateQuery */
/** @typedef {import("@cairn-ink/core/ports").MemoryMatch} MemoryMatch */
/** @typedef {import("@cairn-ink/core/ports").MemoryStore} MemoryStore */
/** @typedef {import("./unit-of-work.mjs").Row} Row */
/** @typedef {import("./unit-of-work.mjs").Entry} Entry */
/** @typedef {{match: "exact" | "near", distance: number}} MatchQuality */

/** @param {MemoryMatch & MatchQuality} a @param {MemoryMatch & MatchQuality} b */
function matchOrder(a, b) {
  if (a.match !== b.match) return a.match === "exact" ? -1 : 1;
  if (a.distance !== b.distance) return a.distance - b.distance;
  if (a.kind === "prior") return b.kind === "prior" ? b.batchIndex - a.batchIndex : -1;
  if (b.kind === "prior") return 1;
  return newestFirst({ id: a.id, updatedAtUs: a.writeTimeUs }, { id: b.id, updatedAtUs: b.writeTimeUs });
}

/** @param {number} nowMs */
function writeTime(nowMs) {
  return { updatedAtMs: nowMs, updatedAtUs: BigInt(nowMs) * 1000n };
}

/**
 * @param {ReturnType<typeof import("./unit-of-work.mjs").createUnitOfWork>["port"]} port
 * @param {import("@cairn-ink/core").Capabilities} capabilities
 * @param {() => string} newId
 * @param {ReturnType<typeof createFactMatcher>} [matchFacts]
 */
export function createMemoryStore(port, capabilities, newId, matchFacts = createFactMatcher(capabilities.vectorSuppression)) {
  let nearSkippedUnembedded = 0;

  /**
   * @param {DuplicateQuery} query @param {DuplicateQuery} candidate @param {number} nearDistance
   * @returns {MatchQuality | undefined}
   */
  function classify(query, candidate, nearDistance) {
    const exact = candidate.textHash === query.textHash || candidate.textHash === query.legacyHash;
    if (!exact && !capabilities.nearDuplicate) return undefined;
    const a = query.embedding;
    const b = candidate.embedding;
    if (!a || !b || a.length !== b.length) {
      if (exact) return { match: "exact", distance: 0 };
      nearSkippedUnembedded++;
      return undefined;
    }
    const distance = cosineDistance(a, b);
    if (exact) return { match: "exact", distance: distance ?? 0 };
    if (distance !== undefined && distance <= nearDistance) return { match: "near", distance };
  }

  /** @param {Row[]} rows @param {readonly DuplicateQuery[]} batch @param {number} nearDistance */
  function matches(rows, batch, nearDistance) {
    return batch.map((query, i) => {
      /** @type {(MemoryMatch & MatchQuality)[]} */
      const result = [];
      for (const row of rows) {
        const quality = classify(query, { textHash: row.textHash, embedding: row.embedding?.vector }, nearDistance);
        if (quality) result.push({ kind: "stored", ...quality, id: row.id, revision: row.revision, writeTimeUs: row.updatedAtUs });
      }
      for (let j = 0; j < i; j++) {
        const quality = classify(query, batch[j], nearDistance);
        if (quality) result.push({ kind: "prior", ...quality, batchIndex: j });
      }
      return result.sort(matchOrder);
    });
  }

  /** @param {Map<string, Entry> | undefined} namespace */
  function entriesIn(namespace) {
    return namespace ? [...namespace.values()] : [];
  }

  /** @type {MemoryStore} */
  const memories = {
    async findDuplicates(tx, scope, batch, options) {
      return port(tx, scope, false, (state) => {
        validateDuplicateBatch(batch);
        if (!options || typeof options !== "object" || !Number.isFinite(options.nearDistance) || options.nearDistance < 0 ||
          (options.excludeId !== undefined && typeof options.excludeId !== "string")) throw new CoreError("invalid_input");
        const { nearDistance, excludeId } = options;
        const policy = matchFacts(state.facts, scope);
        const rows = entriesIn(state.rows.get(scope.namespace))
          .filter((entry) => entry.row.id !== excludeId && !policy.hides(entry)).map(({ row }) => row);
        return matches(rows, batch, nearDistance);
      });
    },

    async readWritePolicy(tx, scope, batch, source, mode, editId) {
      return port(tx, scope, false, (state) => {
        validateDuplicateBatch(batch);
        validateSource(source);
        if ((mode !== "hash" && mode !== "full") ||
          (editId !== undefined && typeof editId !== "string")) throw new CoreError("invalid_input");
        const policy = matchFacts(state.facts, scope);
        const namespace = state.rows.get(scope.namespace);
        const entries = entriesIn(namespace).filter(({ row }) => row.id !== editId);
        const duplicates = matches(entries.map(({ row }) => row), batch, NEAR_DUPLICATE_DISTANCE);
        const hidden = new Set(entries.filter(policy.hides).map(({ row }) => row.id));
        const hiddenIds = new Set();
        for (const group of duplicates) {
          for (const match of group) {
            if (match.kind === "stored" && hidden.has(match.id)) hiddenIds.add(match.id);
          }
        }
        const edit = editId === undefined ? undefined : namespace?.get(editId)?.row;
        const sourceMemory = edit && { id: edit.id, createdAtMs: edit.createdAtMs };
        const blockedPositions = [];
        for (const [i, query] of batch.entries()) {
          if (policy.blocks(query, mode, sourceMemory)) blockedPositions.push(i);
        }
        return {
          matches: duplicates,
          hiddenIds: [...hiddenIds].sort(compareUtf8),
          blockedPositions,
          blockedSession: policy.blocksSession(source.client, source.sessionId),
        };
      });
    },

    async insert(tx, scope, row, receipts, nowMs) {
      return port.write(tx, scope, true, (getState) => {
        const content = copyContent(row);
        const evidence = attachReceipts([], copyReceipts(receipts));
        validateTime(nowMs);
        const id = newId();
        if (typeof id !== "string" || !id) throw new CoreError("internal_error");
        const { namespace } = scope;
        const { rows } = getState();
        let entries = rows.get(namespace);
        if (entries?.has(id)) throw new CoreError("internal_error");
        if (!entries) rows.set(namespace, entries = new Map());
        const created = { id, revision: 1, createdAtMs: nowMs, ...writeTime(nowMs) };
        entries.set(id, {
          row: { ...content, ...created, scope: { owner: tx.owner, namespace }, historical: false },
          receipts: evidence,
        });
        return created;
      });
    },

    async touchDuplicate(tx, scope, id, receipts, merge, nowMs) {
      return port.write(tx, scope, true, (getState) => {
        validateMerge(merge);
        validateTime(nowMs);
        const incoming = copyReceipts(receipts);
        const { namespace } = scope;
        const entry = getState().rows.get(namespace)?.get(id);
        if (!entry) throw new CoreError("memory_not_found");
        const evidence = attachReceipts(entry.receipts, incoming);
        const { row } = entry;
        const { confidence, kind = row.kind, origin = row.origin } = merge;
        const changed = confidence !== row.confidence || kind !== row.kind || origin !== row.origin;
        const revision = row.revision + Number(changed);
        Object.assign(row, { confidence, kind, origin, revision, ...writeTime(nowMs) });
        entry.receipts = evidence;
        return { outcome: changed ? "changed" : "touched", revision };
      });
    },

    async readRevision(tx, scope, id) {
      return port(tx, scope, false, (state) => {
        const row = state.rows.get(scope.namespace)?.get(id)?.row;
        return row ? { revision: row.revision, textHash: row.textHash } : null;
      });
    },

    async replaceContent(tx, scope, id, expectedRevision, next, receipts, nowMs) {
      return port.write(tx, scope, true, (getState) => {
        const content = copyContent(next);
        validateTime(nowMs);
        const evidence = receipts === null ? null : attachReceipts([], copyReceipts(receipts));
        const { namespace } = scope;
        const state = getState();
        const entries = state.rows.get(namespace);
        const entry = entries?.get(id);
        if (!entry) throw new CoreError("memory_not_found");
        const { row } = entry;
        if (row.revision !== expectedRevision) throw new CoreError("revision_conflict");
        if (row.historical) throw new CoreError("memory_historical");
        if (content.textHash === row.textHash) return { outcome: "unchanged", revision: row.revision };

        const policy = matchFacts(state.facts, scope);
        if (entriesIn(entries).some((other) => other.row.id !== id && other.row.textHash === content.textHash &&
          !policy.hides(other))) {
          throw new CoreError("memory_conflict");
        }
        const revision = row.revision + 1;
        Object.assign(row, content, { revision, ...writeTime(nowMs) });
        delete row.legacyHash;
        if (evidence !== null) entry.receipts = evidence;
        return { outcome: "changed", revision };
      });
    },

    async get(tx, scope, id) {
      return port(tx, scope, false, (state) => {
        const row = state.rows.get(scope.namespace)?.get(id)?.row;
        return row ? structuredClone(row) : null;
      });
    },

    async erase(tx, scope, id) {
      return port.write(tx, scope, true, (getState) => {
        const { namespace } = scope;
        const { rows } = getState();
        const entries = rows.get(namespace);
        if (!entries?.delete(id)) return false;
        if (!entries.size) rows.delete(namespace);
        return true;
      });
    },

    async exportPage(tx, scope, page) {
      return port(tx, scope, false, (state) => {
        const { cursor, limit } = page;
        validateLimit(limit);
        const after = cursor === null ? null : decodeCursor(cursor);
        const policy = matchFacts(state.facts, scope);
        const rows = entriesIn(state.rows.get(scope.namespace))
          .filter((entry) => (!after || newestFirst(entry.row, after) > 0) && !policy.hides(entry))
          .map(({ row }) => row).sort(newestFirst);
        const items = rows.slice(0, limit).map((row) => structuredClone(row));
        const last = items.at(-1);
        return {
          items,
          nextCursor: last && rows.length > limit ? encodeCursor(last.updatedAtUs, last.id) : null,
        };
      });
    },
  };

  return { memories, counters: () => ({ nearSkippedUnembedded }) };
}
